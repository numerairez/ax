"""The investigation context that every lead kind works from.

Given a filter path, the Engine defines
  sel   the records in the current selection
  bg    the comparison group, set by the baseline:
          siblings  records that differ only in the last filter (the default)
          prior     the same selection in the preceding period(s)
          yoy       the same selection a year earlier
and answers aggregate questions about them in SQL, so the data never leaves DuckDB.

Every lead carries an effect-size score and, where a test makes sense, a p-value.
p-values are Bonferroni-adjusted by the number of comparisons made so far in the
whole investigation, so chasing many leads makes the bar for "strong" higher.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .. import db
from ..db import ident, lit
from ..store import Dataset
from ..structure import COUNT
from . import registry
from .stats import SUMS, clean, combine, derive, period_label

FREQ = {"day": "D", "week": "W", "month": "M", "quarter": "Q", "year": "Y"}
OFFSET = {"day": "days", "week": "weeks", "month": "months", "quarter": "months", "year": "years"}
MAX_VALUES = 60
# Ranking: rank = score x evidence factor + adjustments. Exposed at /api/method.
STRENGTHS = [("strong", 0.001, 1.0), ("suggestive", 0.05, 0.8), ("weak", 1.0, 0.4)]  # (name, adjusted p below, factor)
DESCRIPTIVE_FACTOR = 0.75  # leads without a test: a summary, neither rewarded nor punished much
SEEN_PENALTY = -0.3  # already shown earlier on this path
MENU_SIZE = 8
SMALL_SELECTION = 30
PERIOD = "__p"  # group-by key for the time period
BASELINES = ("siblings", "prior", "yoy")


@dataclass(frozen=True)
class Measure:
    """sum(num) when additive, else sum(num) / sum(den). Both are SQL expressions over one row."""

    id: str
    name: str  # field name, or the calculated measure's name
    label: str
    num: str
    den: str
    additive: bool
    sources: frozenset[str]


class Engine:
    def __init__(self, ds: Dataset, st: dict, req: dict):
        self.ds, self.st, self.T = ds, st, ds.sql
        self.meta = {f["name"]: f for f in st["fields"]}
        self.calcs = {c["name"]: c for c in st.get("calcs") or []}
        self.all_measures = self._measures()
        mid = req.get("measure") or st.get("primaryMeasure") or COUNT
        self.m = self.all_measures.get(mid) or self.all_measures[COUNT]
        self.mlabel = self.m.label
        self.measures = [k for k in self.all_measures if k != COUNT]
        self.filters: list[dict] = req.get("filters") or []
        for f in self.filters:
            if f.get("field") not in self.meta or f.get("op") not in ("eq", "range"):
                raise ValueError(f"Bad filter: {f}")
        self.seen = set(req.get("seen") or [])
        self.tests_before = int(req.get("testsSoFar") or 0)
        self.only = req.get("kinds")
        self.tf = st.get("timeField")
        self.grain = st.get("timeGrain") or "month"
        if self.grain not in FREQ:
            self.grain = "month"
        self.P = self._period_expr() if self.tf else None
        self._cache: dict[tuple, dict[str, pd.DataFrame]] = {}
        self.tests = 0

        self.baseline = req.get("baseline") if req.get("baseline") in BASELINES else "siblings"
        if not self.tf:
            self.baseline = "siblings"
        self.last = self.filters[-1] if self.filters else None
        self.window = self.compare_window = None
        self.span = ""  # "previous 3 months": what a change is measured against
        if self.baseline == "siblings" or not self._time_baseline():
            self.baseline = "siblings"
            self._sibling_baseline()

        self.has_bg = self.bg_w is not None and self.count(self.bg_w) > 0
        eq = {f["field"] for f in self.filters if f["op"] == "eq"}
        self.fixed = set(eq)
        for f in eq:  # ancestors of a filtered field are constant too
            p = self.meta.get(f, {}).get("parent")
            while p and p not in self.fixed:
                self.fixed.add(p)
                p = self.meta.get(p, {}).get("parent")
        self.dims = [n for n, f in self.meta.items() if f["role"] == "dimension" and n not in self.fixed]

    # -- measures -----------------------------------------------------------

    def _measures(self) -> dict[str, Measure]:
        def val(name: str) -> str:
            return "1" if name == COUNT else f"coalesce(CAST({ident(name)} AS DOUBLE), 0)"

        out = {COUNT: Measure(COUNT, COUNT, "Records", "1", "1", True, frozenset())}
        for n, f in self.meta.items():
            if f["role"] != "measure":
                continue
            additive = (f.get("agg") or "sum") == "sum"
            out[n] = Measure(n, n, f"{'Total' if additive else 'Avg'} {n}", val(n), f"CAST({ident(n)} IS NOT NULL AS INTEGER)",
                             additive, frozenset({n}))
        for n, c in self.calcs.items():
            if not all(x == COUNT or self.meta.get(x, {}).get("role") == "measure" for x in (c["num"], c["den"])):
                continue
            num = val(c["num"]) if float(c.get("scale") or 1) == 1 else f"{float(c['scale'])!r} * {val(c['num'])}"
            out[n] = Measure(n, n, n, num, val(c["den"]), False, frozenset({c["num"], c["den"]} - {COUNT}))
        return out

    def measure(self, mid: str) -> Measure:
        return self.all_measures[mid]

    def target_of(self, m: Measure) -> Measure | None:
        t = self.meta.get(m.id, {}).get("target")
        return self.all_measures.get(t) if t else None

    # -- filters and baselines ---------------------------------------------

    def _period_expr(self) -> str:
        q = ident(self.tf)
        if self.ds.types.get(self.tf, "").startswith("TIMESTAMP"):
            return f"date_trunc('{self.grain}', {q})"
        return f"date_trunc('{self.grain}', make_date(TRY_CAST({q} AS INTEGER), 1, 1)::TIMESTAMP)"

    def trunc(self, v) -> pd.Timestamp:
        return pd.Timestamp(v).to_period(FREQ[self.grain]).start_time

    def cond(self, f: dict) -> str:
        q = ident(f["field"])
        if f["op"] == "eq":
            return f"CAST({q} AS VARCHAR) = {lit(str(f['value']))}"
        lo, hi = f["value"]
        if f["field"] == self.tf:
            return f"{self.P} BETWEEN {lit(self.trunc(lo))} AND {lit(self.trunc(hi))}"
        return f"{q} BETWEEN {lit(float(lo))} AND {lit(float(hi))}"

    def where(self, filters: list[dict]) -> str:
        return " AND ".join(f"({self.cond(f)})" for f in filters) or "TRUE"

    def _sibling_baseline(self) -> None:
        self.sel_w = self.where(self.filters)
        self.trend_w = self.sel_w
        if self.last:
            self.ctx_w = self.where(self.filters[:-1])
            self.bg_w = f"({self.ctx_w}) AND NOT coalesce({self.cond(self.last)}, FALSE)"
            self.bg_label = "outside this range" if self.last["op"] == "range" else f"where {self.last['field']} ≠ {self.last['value']}"
        else:
            self.ctx_w, self.bg_w, self.bg_label = "TRUE", None, ""
        self.trend_ctx_w = self.ctx_w
        self.trend_rest_w = self.bg_w

    def _time_baseline(self) -> bool:
        """Compare the selection's time window with the window before it (or a year before)."""
        tfilter = next((f for f in reversed(self.filters) if f["field"] == self.tf and f["op"] == "range"), None)
        base = [f for f in self.filters if f is not tfilter]
        base_w = self.where(base)
        if tfilter:
            lo, hi = sorted(self.trunc(v) for v in tfilter["value"])
        else:
            latest = db.one(f"SELECT max({self.P}) FROM {self.T} WHERE {base_w}")[0]
            if latest is None:
                return False
            lo = hi = pd.Timestamp(latest)
        k = (hi.to_period(FREQ[self.grain]) - lo.to_period(FREQ[self.grain])).n + 1
        step = {OFFSET[self.grain]: k * (3 if self.grain == "quarter" else 1)} if self.baseline == "prior" else {"years": 1}
        off = pd.DateOffset(**step)
        blo, bhi = self.trunc(lo - off), self.trunc(hi - off)
        between = lambda a, b: f"{self.P} BETWEEN {lit(a)} AND {lit(b)}"  # noqa: E731
        self.sel_w = f"({base_w}) AND {between(lo, hi)}"
        self.bg_w = f"({base_w}) AND {between(blo, bhi)}"
        self.ctx_w = f"({base_w}) AND ({between(lo, hi)} OR {between(blo, bhi)})"
        self.trend_w, self.trend_ctx_w, self.trend_rest_w = base_w, "TRUE", None
        label = lambda a, b: period_label(a, self.grain) + ("" if a == b else f" – {period_label(b, self.grain)}")  # noqa: E731
        self.window, self.compare_window = (lo, hi), (blo, bhi)
        self.window_label, self.compare_label = label(lo, hi), label(blo, bhi)
        if self.baseline == "prior":
            self.span = f"previous {k} {self.grain}s" if k > 1 else f"previous {self.grain}"
        else:
            self.span = "same period a year earlier"
        self.bg_label = f"in the {self.span} ({self.compare_label})"
        return True

    def descends_from_filter(self, d: str) -> bool:
        """Children of a filtered value don't occur among its siblings, so comparing them
        against the background is trivially lopsided. Only the last filter matters: the
        comparison group shares all the earlier ones."""
        if self.baseline != "siblings" or not self.last or self.last["op"] != "eq":
            return False
        p = self.meta[d].get("parent")
        while p:
            if p == self.last["field"]:
                return True
            p = self.meta.get(p, {}).get("parent")
        return False

    # -- queries ------------------------------------------------------------

    def count(self, where: str) -> int:
        return int(db.one(f"SELECT count(*) FROM {self.T} WHERE {where}")[0])

    def stats(self, where: str, by: str | None = None, m: Measure | None = None) -> pd.DataFrame | pd.Series:
        """Sufficient statistics (see stats.py) per value of `by` (a dimension, PERIOD, or None
        for one overall row). One query fetches every measure, so asking again for another
        measure over the same groups is free."""
        key = (where, by)
        if key not in self._cache:
            self._cache[key] = self._query(where, by)
        g = self._cache[key][(m or self.m).id]
        return g.iloc[0] if by is None else g

    def total(self, where: str, m: Measure | None = None) -> float:
        g = self.stats(where, None, m)
        return float(g["v"]) if g["n"] else float("nan")

    def _query(self, where: str, by: str | None) -> dict[str, pd.DataFrame]:
        ms = list(self.all_measures.values())
        cols = ["count(*) AS n"]
        for i, m in enumerate(ms):
            num, den = f"({m.num})", f"({m.den})"
            cols += [
                f"sum({num}) AS s{i}",
                f"sum({den}) AS w{i}",
                f"sum(CASE WHEN {den} > 0 THEN {num} * {num} / {den} END) AS q{i}",
                f"sum({den} * {den}) AS w2{i}",
                f"sum(abs({num})) AS a{i}",
            ]
        if by is None:
            sql = f"SELECT {', '.join(cols)} FROM {self.T} WHERE {where}"
        else:
            k = self.P if by == PERIOD else f"CAST({ident(by)} AS VARCHAR)"
            sql = f"SELECT {k} AS k, {', '.join(cols)} FROM {self.T} WHERE ({where}) AND {k} IS NOT NULL GROUP BY 1"
        raw = db.df(sql)
        if by is not None:
            raw = raw.set_index("k").sort_index()
            raw.index.name = None
        out = {}
        for i, m in enumerate(ms):
            g = raw[["n", f"s{i}", f"w{i}", f"q{i}", f"w2{i}", f"a{i}"]].copy()
            g.columns = SUMS
            g[SUMS] = g[SUMS].astype(float).fillna(0)
            out[m.id] = derive(g, m.additive)
        return out

    def periods(self, where: str) -> list[pd.Timestamp]:
        r = db.df(f"SELECT DISTINCT {self.P} AS p FROM {self.T} WHERE ({where}) AND {self.P} IS NOT NULL ORDER BY 1")
        return [pd.Timestamp(p) for p in r["p"]]

    def histogram(self, where: str, m: Measure, edges: np.ndarray) -> np.ndarray:
        """Den-weighted histogram of the per-record value num/den over fixed edges."""
        lo, nb = float(edges[0]), len(edges) - 1
        norm = nb / float(edges[-1] - edges[0])
        e_list = "[" + ", ".join(repr(float(x)) for x in edges) + "]::DOUBLE[]"
        # Same binning as numpy.histogram: estimate the bin, then correct it against the
        # actual edges so values sitting exactly on an edge land where numpy puts them.
        guess = f"least(greatest(floor((r - {lo!r}) * {norm!r}), 0), {nb - 1})::INTEGER"
        fix = f"i - (r < e[i + 1])::INTEGER + (r >= e[i + 2] AND i != {nb - 1})::INTEGER"
        res = db.df(
            f"SELECT {fix} AS b, sum(den) AS w FROM ("
            f"  SELECT r, den, {guess} AS i, {e_list} AS e FROM ("
            f"    SELECT ({m.num}) / ({m.den}) AS r, ({m.den}) AS den FROM {self.T} WHERE ({where}) AND ({m.den}) > 0))"
            f" GROUP BY 1"
        )
        h = np.zeros(nb)
        h[res["b"].to_numpy(dtype=int)] = res["w"].to_numpy(dtype=float)
        return h

    def value_range(self, where: str, m: Measure) -> tuple[float, float]:
        lo, hi = db.one(f"SELECT min(({m.num}) / ({m.den})), max(({m.num}) / ({m.den})) FROM {self.T} WHERE ({where}) AND ({m.den}) > 0")
        return (float(lo), float(hi)) if lo is not None else (float("nan"), float("nan"))

    def pooled(self, *frames: pd.DataFrame | pd.Series, m: Measure | None = None) -> pd.Series:
        return combine(*frames, additive=(m or self.m).additive)

    # -- assembly -----------------------------------------------------------

    def lead(self, kind: str, field: str, title: str, reason: str, score: float, p: float | None, view: dict) -> dict:
        return {"id": f"{kind}:{field}", "kind": kind, "field": field, "title": title, "reason": reason,
                "score": float(score), "p": p, "tags": [], "view": view, "adjust": [], "scoreNotes": []}

    def bonus(self, lead: dict, amount: float, why: str) -> None:
        """Add to (or, if negative, take from) a lead's rank, saying why: shown in "Why this chart?"."""
        lead["adjust"].append({"label": why, "value": float(amount)})

    def penalize(self, lead: dict, factor: float, why: str) -> None:
        """Scale a lead's score, saying why."""
        lead["score"] *= factor
        lead["scoreNotes"].append({"label": why, "factor": float(factor)})

    def run(self) -> dict:
        kinds = registry.ordered(self.only)
        leads = []
        for k in kinds:
            for lead in k.fn(self):
                lead.setdefault("icon", k.icon)
                leads.append(lead)
        total_tests = self.tests_before + self.tests
        for lead in leads:
            # A kind whose claim depends on the final comparison count (what is significant)
            # settles its wording, p and markers here, so the chart and the sentence agree.
            if fin := lead.pop("finalize", None):
                fin(lead, total_tests)
            p = lead.pop("p")
            if p is None:
                lead["strength"], lead["pAdj"], factor = "descriptive", None, DESCRIPTIVE_FACTOR
            else:
                p_adj = min(1.0, p * max(1, total_tests))
                lead["pAdj"] = p_adj
                lead["strength"], factor = next((name, f) for name, below, f in STRENGTHS if p_adj < below or name == "weak")
            if lead["id"] in self.seen:
                self.bonus(lead, SEEN_PENALTY, "already shown earlier on this path")
                lead["tags"].append("seen")
            adjust = sum(a["value"] for a in lead["adjust"])
            lead["rank"] = lead["score"] * factor + adjust
            lead["why"] = {"score": lead["score"], "scoreNotes": lead.pop("scoreNotes"), "factor": factor,
                           "adjust": lead.pop("adjust"), "rank": lead["rank"], "pRaw": p, "tests": total_tests}
        leads.sort(key=lambda x: x["rank"], reverse=True)
        # Keep the menu varied: a quota per kind, but always offer the next level
        # down the hierarchy, which is where a click naturally leads.
        quota = {k.name: k.quota for k in kinds}
        per_kind: dict[str, int] = {}
        varied = []
        for lead in leads:
            if "drill down" in lead["tags"]:
                varied.append(lead)
                continue
            kind = lead["id"].split(":")[0]  # like-for-like leads get their own quota
            per_kind[kind] = per_kind.get(kind, 0) + 1
            if per_kind[kind] <= quota.get(lead["kind"], 3):
                varied.append(lead)
        n = self.count(self.sel_w)
        caution = f"Only {n} records in this selection — treat patterns with care." if n < SMALL_SELECTION else None
        return clean(
            {
                "context": {
                    "n": n,
                    "total": self.total(self.sel_w) if n else None,
                    "measure": self.m.id,
                    "measureLabel": self.mlabel,
                    "agg": "sum" if self.m.additive else "mean",
                    "baseline": self.baseline,
                    "window": self.window_label if self.window else None,
                    "compareWindow": self.compare_label if self.window else None,
                    "bgLabel": self.bg_label,
                    "bgN": self.count(self.bg_w) if self.has_bg else 0,
                    "caution": caution,
                },
                "leads": varied[:MENU_SIZE],
                "candidates": len(leads),
                "tests": self.tests,
            }
        )


def investigate(ds: Dataset, st: dict, req: dict) -> dict:
    return Engine(ds, st, req).run()
