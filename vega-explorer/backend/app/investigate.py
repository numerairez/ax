"""Lead engine: given an investigation context (a filter path), score candidate
next views and explain why each one is interesting.

Lead kinds
  breakdown  how the selection splits along a dimension, vs. its siblings
  trend      the selection over time, with the most anomalous period flagged
  driver     another measure whose distribution differs in the selection
  change     after brushing a time range: what drove the change vs. the prior period

Every lead carries an effect-size score and, where a test makes sense, a p-value.
p-values are Bonferroni-adjusted by the number of comparisons made so far in the
whole investigation, so chasing many leads makes the bar for "strong" higher.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from .store import Dataset
from .structure import COUNT

FREQ = {"day": "D", "week": "W", "month": "M", "quarter": "Q", "year": "Y"}
MAX_VALUES = 60
_frames: dict[tuple, pd.DataFrame] = {}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _frame(ds: Dataset, st: dict) -> pd.DataFrame:
    tf, grain = st.get("timeField"), st.get("timeGrain") or "month"
    key = (ds.id, len(ds.df), tf, grain)
    if key in _frames:
        return _frames[key]
    df = ds.df.copy()
    df["__count"] = 1
    if tf:
        s = df[tf]
        if not pd.api.types.is_datetime64_any_dtype(s):
            s = pd.to_datetime(pd.to_numeric(s, errors="coerce").astype("Int64").astype(str) + "-01-01", errors="coerce")
        df["__t"] = s
        df["__p"] = s.dt.to_period(FREQ.get(grain, "M")).dt.start_time
    _frames[key] = df
    return df


def _cond(df: pd.DataFrame, f: dict, st: dict) -> np.ndarray:
    field = f["field"]
    if f["op"] == "eq":
        return (df[field].astype(str) == str(f["value"])).to_numpy()
    lo, hi = f["value"]
    if field == st.get("timeField"):
        freq = FREQ.get(st.get("timeGrain") or "month", "M")
        lo = pd.Timestamp(lo).to_period(freq).start_time
        hi = pd.Timestamp(hi).to_period(freq).start_time
        col = df["__p"]
    else:
        col = df[field]
    return ((col >= lo) & (col <= hi)).to_numpy()


def _mask(df: pd.DataFrame, filters: list[dict], st: dict) -> np.ndarray:
    m = np.ones(len(df), dtype=bool)
    for f in filters:
        m &= _cond(df, f, st)
    return m


def _sf(z: float) -> float:
    """Upper tail of the standard normal."""
    return 0.5 * math.erfc(z / math.sqrt(2))


def _chi2_sf(x: float, k: int) -> float:
    """Chi-square upper tail via the Wilson-Hilferty normal approximation."""
    if k <= 0:
        return 1.0
    if x <= 0:
        return 1.0
    z = ((x / k) ** (1 / 3) - (1 - 2 / (9 * k))) / math.sqrt(2 / (9 * k))
    return _sf(z)


def _chi2_counts(a: pd.Series, b: pd.Series) -> float | None:
    """Test whether two count distributions over the same categories differ."""
    t = pd.concat([a, b], axis=1).fillna(0)
    t = t[t.sum(axis=1) > 0]
    if len(t) < 2 or t.to_numpy().sum() == 0:
        return None
    obs = t.to_numpy(dtype=float)
    exp = obs.sum(axis=1, keepdims=True) * obs.sum(axis=0, keepdims=True) / obs.sum()
    with np.errstate(divide="ignore", invalid="ignore"):
        x = np.nansum(np.where(exp > 0, (obs - exp) ** 2 / exp, 0))
    return _chi2_sf(float(x), len(t) - 1)


def _welch_p(a: pd.Series, b: pd.Series) -> float | None:
    if len(a) < 3 or len(b) < 3:
        return None
    se = math.sqrt(a.var() / len(a) + b.var() / len(b))
    if not se or math.isnan(se):
        return None
    return 2 * _sf(abs(a.mean() - b.mean()) / se)


def fmt(v: float | None) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "—"
    a = abs(v)
    if a >= 1e9:
        return f"{v / 1e9:.3g}B"
    if a >= 1e6:
        return f"{v / 1e6:.3g}M"
    if a >= 1e4:
        return f"{v / 1e3:.3g}k"
    if a >= 100:
        return f"{v:,.0f}"
    if a >= 1:
        return f"{v:.3g}"
    return f"{v:.2g}"


def _clean(x: Any) -> Any:
    if isinstance(x, dict):
        return {k: _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    if isinstance(x, (np.floating, float)):
        return None if math.isnan(float(x)) or math.isinf(float(x)) else float(x)
    if isinstance(x, np.integer):
        return int(x)
    if isinstance(x, (pd.Timestamp,)):
        return x.strftime("%Y-%m-%dT%H:%M:%S")
    if isinstance(x, np.bool_):
        return bool(x)
    return x


def _period_label(ts: pd.Timestamp, grain: str) -> str:
    return {
        "year": ts.strftime("%Y"),
        "quarter": f"Q{ts.quarter} {ts.year}",
        "month": ts.strftime("%b %Y"),
        "week": "week of " + ts.strftime("%d %b %Y"),
        "day": ts.strftime("%d %b %Y"),
    }.get(grain, ts.strftime("%Y-%m-%d"))


# ---------------------------------------------------------------------------
# engine
# ---------------------------------------------------------------------------


class Engine:
    def __init__(self, ds: Dataset, st: dict, req: dict):
        self.st = st
        self.df = _frame(ds, st)
        self.meta = {f["name"]: f for f in st["fields"]}
        self.measure = req.get("measure") or st.get("primaryMeasure") or COUNT
        if self.measure != COUNT and self.meta.get(self.measure, {}).get("role") != "measure":
            self.measure = COUNT
        self.col = "__count" if self.measure == COUNT else self.measure
        self.agg = "sum" if self.measure == COUNT else (self.meta[self.measure].get("agg") or "sum")
        self.mlabel = "Records" if self.measure == COUNT else f"{'Total' if self.agg == 'sum' else 'Avg'} {self.measure}"
        self.filters: list[dict] = req.get("filters") or []
        self.seen = set(req.get("seen") or [])
        self.tests_before = int(req.get("testsSoFar") or 0)
        self.grain = st.get("timeGrain") or "month"

        sel_m = _mask(self.df, self.filters, st)
        self.sel = self.df[sel_m]
        self.last = self.filters[-1] if self.filters else None
        if self.last:
            ctx_m = _mask(self.df, self.filters[:-1], st)
            self.ctx = self.df[ctx_m]
            self.bg = self.df[ctx_m & ~sel_m]
            self.bg_label = "outside this range" if self.last["op"] == "range" else f"where {self.last['field']} ≠ {self.last['value']}"
        else:
            self.ctx, self.bg, self.bg_label = self.df, None, ""
        self.has_bg = self.bg is not None and len(self.bg) > 0

        eq = {f["field"] for f in self.filters if f["op"] == "eq"}
        self.fixed = set(eq)
        for f in eq:  # ancestors of a filtered field are constant too
            p = self.meta.get(f, {}).get("parent")
            while p and p not in self.fixed:
                self.fixed.add(p)
                p = self.meta.get(p, {}).get("parent")
        self.dims = [n for n, f in self.meta.items() if f["role"] == "dimension" and n not in self.fixed]
        self.measures = [n for n, f in self.meta.items() if f["role"] == "measure"]
        self.tests = 0

    def total(self, frame: pd.DataFrame) -> float:
        return float(frame[self.col].agg(self.agg)) if len(frame) else float("nan")

    # -- lead kinds ---------------------------------------------------------

    def breakdowns(self) -> list[dict]:
        out = []
        for d in self.dims:
            sel = self.sel[self.sel[d].notna()]
            nvals = sel[d].nunique()
            if nvals < 2 or nvals > MAX_VALUES:
                continue
            g = sel.groupby(d, observed=True)[self.col].agg(self.agg)
            n_by = sel.groupby(d, observed=True).size()
            # Children of the filtered value don't occur among its siblings, so
            # comparing against the background is trivially lopsided: describe instead.
            child = self._descends_from_filter(d)
            lead = self._breakdown_vs_bg(d, sel, g, n_by) if self.has_bg and not child else self._breakdown_overview(d, g, n_by)
            if not lead:
                continue
            parent = self.meta[d].get("parent")
            if self.last and self.last["op"] == "eq" and parent == self.last["field"]:
                lead["bonus"] += 0.2
                lead["tags"].append("drill down")
            elif not self.filters and not parent:
                lead["bonus"] += 0.1  # start broad: top-level dimensions first
            out.append(lead)
        return out

    def _descends_from_filter(self, d: str) -> bool:
        eq = {f["field"] for f in self.filters if f["op"] == "eq"}
        p = self.meta[d].get("parent")
        while p:
            if p in eq:
                return True
            p = self.meta.get(p, {}).get("parent")
        return False

    def _breakdown_overview(self, d: str, g: pd.Series, n_by: pd.Series) -> dict | None:
        if self.agg == "sum":
            share = g.abs() / (g.abs().sum() or 1)
            top = share.sort_values(ascending=False)
            k = 1 if len(top) <= 5 else 3
            score = min(1.0, (top.iloc[:k].sum() - k / len(top)) * 1.5 + 0.2)
            if k == 1:
                reason = f"{top.index[0]} leads with {top.iloc[0]:.0%} of {self.mlabel.lower()} across {len(top)} {d} values"
            else:
                reason = f"Top 3 of {len(top)} {d} values hold {top.iloc[:k].sum():.0%} of {self.mlabel.lower()} — led by {top.index[0]} ({top.iloc[0]:.0%})"
        else:
            std = self.sel[self.col].std() or 1
            spread = (g.max() - g.min()) / std
            score = min(1.0, spread / 2.5)
            reason = f"{self.mlabel} ranges from {fmt(g.min())} ({g.idxmin()}) to {fmt(g.max())} ({g.idxmax()}) across {d}"
        rows = [{"value": str(v), "actual": g[v], "n": n_by[v]} for v in g.abs().sort_values(ascending=False).index[:25]]
        return self._lead("breakdown", d, f"{self.mlabel} by {d}", reason, score, None,
                          {"type": "breakdown", "field": d, "mode": "overview", "rows": rows})

    def _breakdown_vs_bg(self, d: str, sel: pd.DataFrame, g: pd.Series, n_by: pd.Series) -> dict | None:
        bg = self.bg[self.bg[d].notna()]
        if bg.empty:
            return None
        gb = bg.groupby(d, observed=True)[self.col].agg(self.agg)
        nb = bg.groupby(d, observed=True).size()
        idx = g.index.union(gb.index)
        if self.agg == "sum":
            s_sel = (g / (g.abs().sum() or 1)).reindex(idx, fill_value=0)
            s_bg = (gb / (gb.abs().sum() or 1)).reindex(idx, fill_value=0)
            tvd = 0.5 * float((s_sel - s_bg).abs().sum())
            over = (s_sel - s_bg)[g.index]
            v = over.idxmax() if over.max() > 0 else over.abs().idxmax()
            reason = f"{v} is {s_sel[v]:.0%} of {self.mlabel.lower()} here vs {s_bg[v]:.0%} {self.bg_label}"
            score = min(1.0, tvd * 1.8)
            p = _chi2_counts(n_by, nb)
            self.tests += 1
            expected = s_bg * g.sum()
            mode = "share"
        else:
            std = pd.concat([sel[self.col], bg[self.col]]).std() or 1
            gb_al = gb.reindex(g.index)
            dv = ((g - gb_al) / std).dropna()
            dv = dv[n_by.reindex(dv.index) >= 5]
            if dv.empty:
                return None
            w = n_by.reindex(dv.index)
            score = min(1.0, float((dv.abs() * w).sum() / w.sum()) / 0.8)
            v = dv.abs().idxmax()
            reason = f"{v}: {self.mlabel.lower()} {fmt(g[v])} here vs {fmt(gb_al[v])} {self.bg_label} ({dv[v]:+.1f} SD)"
            p = _welch_p(sel.loc[sel[d] == v, self.col], bg.loc[bg[d] == v, self.col])
            self.tests += len(dv)
            expected = gb_al
            mode = "mean"
        order = g.abs().sort_values(ascending=False).index[:25]
        rows = [{"value": str(k), "actual": g[k], "expected": expected.get(k), "n": n_by[k]} for k in order]
        return self._lead("breakdown", d, f"{self.mlabel} by {d}", reason, score, p,
                          {"type": "breakdown", "field": d, "mode": mode, "rows": rows, "highlight": str(v)})

    def trend(self) -> list[dict]:
        if not self.st.get("timeField"):
            return []
        # Only the span the selection covers: a time filter must not pad with empty periods.
        lo, hi = self.sel["__p"].min(), self.sel["__p"].max()
        periods = sorted(p for p in self.ctx["__p"].dropna().unique() if lo <= p <= hi)
        series = self.sel.groupby("__p")[self.col].agg(self.agg)
        series = series.reindex(periods, fill_value=0 if self.agg == "sum" else np.nan).dropna()
        if len(series) < 6:
            return []
        base = series.rolling(5, center=True, min_periods=3).median()
        resid = series - base
        mad = float((resid.abs()).median()) * 1.4826 or float(resid.std()) or 1.0
        z = resid / mad
        t = z.abs().idxmax()
        zt = float(z[t])
        p = 2 * _sf(abs(zt))
        self.tests += len(series)
        ratio = series[t] / base[t] if base[t] else float("nan")
        reason = (
            f"{_period_label(t, self.grain)} stands out: {fmt(series[t])} vs ~{fmt(base[t])} typical"
            + (f" ({ratio:.1f}×)" if ratio == ratio and ratio > 0 else "")
        )
        rest = None
        if self.has_bg:
            rb = self.bg.groupby("__p")[self.col].agg(self.agg).reindex(series.index)
            if self.agg == "sum" and rb.sum():
                rb = rb * (series.sum() / rb.sum())  # scale so shapes are comparable
            rest = rb
        rows = [
            {"t": k, "value": series[k], "baseline": base[k], "rest": None if rest is None else rest.get(k), "anomaly": bool(abs(z[k]) >= 3)}
            for k in series.index
        ]
        # Needs both statistical (z) and practical (ratio) size to score highly.
        practical = min(1.0, abs(ratio - 1) / 0.3) if ratio == ratio else 0.5
        score = min(1.0, abs(zt) / 7) * practical
        if not self.filters or p * max(1, self.tests_before + self.tests) >= 0.05:
            third = max(1, len(series) // 3)
            first, last = series.iloc[:third].mean(), series.iloc[-third:].mean()
            if first:
                drift = (last - first) / abs(first)
                overall = f"{self.mlabel} is {'up' if drift >= 0 else 'down'} {abs(drift):.0%} from the first to the last third of the period"
                reason = overall + ("" if score > 0.3 else "; no single period stands out reliably")
                score = max(score, min(1.0, abs(drift)))
        lead = self._lead("trend", self.st["timeField"], f"{self.mlabel} over time", reason, score, p,
                          {"type": "trend", "field": self.st["timeField"], "grain": self.grain, "rows": rows, "highlight": t,
                           "restLabel": "rest (scaled to match)" if self.agg == "sum" else "rest"})
        if not self.filters:
            lead["bonus"] += 0.4  # the natural starting point
        return [lead]

    def drivers(self) -> list[dict]:
        if not self.has_bg:
            return []
        out = []
        for m in self.measures:
            if m == self.measure:
                continue
            a, b = self.sel[m].dropna(), self.bg[m].dropna()
            if len(a) < 5 or len(b) < 5:
                continue
            pooled = math.sqrt((a.var() + b.var()) / 2)
            if not pooled or math.isnan(pooled):
                continue
            dd = (a.mean() - b.mean()) / pooled
            p = _welch_p(a, b)
            self.tests += 1
            edges = np.histogram_bin_edges(pd.concat([a, b]), bins=24)
            rows = []
            for grp, s in (("selection", a), ("rest", b)):
                h, _ = np.histogram(s, bins=edges)
                rows += [{"x0": edges[i], "x1": edges[i + 1], "share": h[i] / max(1, len(s)), "group": grp} for i in range(len(h))]
            reason = f"{m} averages {fmt(a.mean())} here vs {fmt(b.mean())} {self.bg_label} ({dd:+.1f} SD)"
            out.append(self._lead("driver", m, f"{m}: here vs elsewhere", reason, min(1.0, abs(dd) / 1.2), p,
                                  {"type": "driver", "field": m, "rows": rows, "means": {"selection": a.mean(), "rest": b.mean()}}))
        return out

    def changes(self) -> list[dict]:
        tf = self.st.get("timeField")
        if not (self.last and self.last["op"] == "range" and self.last["field"] == tf):
            return []
        after = self.sel
        k = after["__p"].nunique()
        before_periods = sorted(p for p in self.ctx["__p"].dropna().unique() if p < after["__p"].min())[-k:]
        before = self.ctx[self.ctx["__p"].isin(before_periods)]
        if before.empty:
            return []
        tot_a, tot_b = self.total(after), self.total(before)
        rel = (tot_a - tot_b) / abs(tot_b) if tot_b else float("nan")
        span = f"previous {k} {self.grain}{'s' if k > 1 else ''}"
        out = []
        for d in self.dims:
            ga = after.groupby(d, observed=True)[self.col].agg(self.agg)
            gb = before.groupby(d, observed=True)[self.col].agg(self.agg)
            idx = ga.index.union(gb.index)
            if len(idx) < 2 or len(idx) > MAX_VALUES:
                continue
            fill = 0 if self.agg == "sum" else np.nan
            ga, gb = ga.reindex(idx, fill_value=fill), gb.reindex(idx, fill_value=fill)
            delta = (ga - gb).dropna()
            if delta.abs().sum() == 0:
                continue
            v = delta.abs().idxmax()
            conc = float(abs(delta[v]) / delta.abs().sum())
            p = _chi2_counts(after.groupby(d, observed=True).size(), before.groupby(d, observed=True).size())
            self.tests += 1
            direction = "rose" if tot_a >= tot_b else "fell"
            if self.agg == "sum":
                reason = f"{self.mlabel} {direction} {fmt(abs(tot_a - tot_b))} ({rel:+.0%}) vs the {span}; {v} contributed {fmt(delta[v])} ({conc:.0%} of the movement)"
            else:
                reason = f"{self.mlabel} {direction} from {fmt(tot_b)} to {fmt(tot_a)} vs the {span}; biggest shift in {v} ({fmt(delta[v])})"
            score = min(1.0, 0.45 * conc + 0.55 * min(1.0, abs(rel) * 2 if rel == rel else 0.3))
            rows = [{"value": str(i), "before": gb[i], "after": ga[i], "delta": delta[i]} for i in delta.abs().sort_values(ascending=False).index[:20]]
            lead = self._lead("change", d, f"What drove the change, by {d}", reason, score, p,
                              {"type": "change", "field": d, "rows": rows, "span": span})
            lead["bonus"] += 0.5  # answer the question the brush asked, even if the evidence is weak
            out.append(lead)
        return out

    # -- assembly -----------------------------------------------------------

    def _lead(self, kind: str, field: str, title: str, reason: str, score: float, p: float | None, view: dict) -> dict:
        return {"id": f"{kind}:{field}", "kind": kind, "field": field, "title": title, "reason": reason,
                "score": float(score), "p": p, "bonus": 0.0, "tags": [], "view": view}

    def run(self) -> dict:
        leads = self.trend() + self.breakdowns() + self.drivers() + self.changes()
        total_tests = self.tests_before + self.tests
        for lead in leads:
            p = lead.pop("p")
            if p is None:
                lead["strength"], lead["pAdj"] = "descriptive", None
                factor = 0.75
            else:
                p_adj = min(1.0, p * max(1, total_tests))
                lead["pAdj"] = p_adj
                lead["strength"] = "strong" if p_adj < 0.001 else "suggestive" if p_adj < 0.05 else "weak"
                factor = {"strong": 1.0, "suggestive": 0.8, "weak": 0.4}[lead["strength"]]
            if lead["id"] in self.seen:
                lead["bonus"] -= 0.3
                lead["tags"].append("seen")
            lead["rank"] = lead["score"] * factor + lead.pop("bonus")
        leads.sort(key=lambda x: x["rank"], reverse=True)
        # Keep the menu varied: at most 3 leads of any one kind.
        per_kind: dict[str, int] = {}
        varied = []
        for lead in leads:
            per_kind[lead["kind"]] = per_kind.get(lead["kind"], 0) + 1
            if per_kind[lead["kind"]] <= 3:
                varied.append(lead)
        leads = varied
        caution = f"Only {len(self.sel)} records in this selection — treat patterns with care." if len(self.sel) < 30 else None
        return _clean(
            {
                "context": {
                    "n": len(self.sel),
                    "total": self.total(self.sel),
                    "measure": self.measure,
                    "measureLabel": self.mlabel,
                    "agg": self.agg,
                    "bgLabel": self.bg_label,
                    "bgN": len(self.bg) if self.has_bg else 0,
                    "caution": caution,
                },
                "leads": leads[:8],
                "tests": self.tests,
            }
        )


def investigate(ds: Dataset, st: dict, req: dict) -> dict:
    return Engine(ds, st, req).run()
