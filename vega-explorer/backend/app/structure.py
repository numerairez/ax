"""Detect (and persist user edits to) the analytical structure of a dataset.

The structure tells the lead engine how to reason about each field:
  role       dimension | measure | time | lat | lon | id | ignore
  agg        sum | mean          (measures only: is it additive or an average?)
  parent     another dimension   (hierarchy: city -> state -> region)
  target     another measure     (measures only: the plan, budget or limit it is judged against)

and lists calculated measures:
  calcs      [{name, num, den, scale}]   ratio of sums, e.g. breach rate = sum(breaches) / records.
             A ratio is aggregated as sum(num) / sum(den), never as an average of per-row ratios.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from . import db
from .db import ident
from .store import Dataset

STRUCT_DIR = Path(__file__).resolve().parent.parent / "structures"
COUNT = "__count__"  # virtual measure: number of records

_ID = re.compile(r"(^|_)(id|code|key|uuid|zip|postal)$|^iso", re.I)
_LAT = re.compile(r"^lat$|latitude", re.I)
_LON = re.compile(r"^(lon|lng|long)$|longitude", re.I)
_YEAR = re.compile(r"^year$|_year$", re.I)
# Measures that are levels/ratios: summing them is meaningless, average instead.
_MEAN = re.compile(
    r"price|rate|ratio|pct|percent|share|avg|mean|temp|humid|rating|discount|score|expectancy|"
    r"per_capita|length|width|height|_cm$|wind|return|fertility|bps|contributors|^open$|^close$|^high$|^low$|age|days",
    re.I,
)
_PRIMARY = re.compile(r"abs_variance|revenue|sales|amount|value|profit|messages|population|count|total", re.I)
_PRIMARY_MEAN = re.compile(r"close|price|temp_max|life|score", re.I)
_TARGET = re.compile(r"target|budget|plan|quota|goal|forecast|tolerance|limit|threshold", re.I)
_FLAG = re.compile(r"(^|_)(count|flag|is|has)(_|$)|^n_|_n$", re.I)
_UNIT = re.compile(r"(^|_)(usd|eur|gbp|amt|amount|value|total)(?=_|$)", re.I)


def detect(ds: Dataset) -> dict[str, Any]:
    n = ds.rows
    fields: list[dict[str, Any]] = []
    time_field = None
    for f in ds.fields:
        name, kind = f["name"], f["type"]
        role, agg = "dimension", None
        if kind == "temporal":
            role = "time"
        elif kind == "quantitative":
            if _LAT.search(name):
                role = "lat"
            elif _LON.search(name):
                role = "lon"
            elif _YEAR.search(name) and f.get("integer"):
                role = "time"
            elif _ID.search(name) or _looks_like_sequence(ds, f, n):
                role = "id"
            else:
                role, agg = "measure", "mean" if _MEAN.search(name) else "sum"
        else:
            if f["unique"] >= 0.9 * n and n > 50:
                role = "id"
            elif f["unique"] > 200 or f["unique"] <= 1:
                role = "ignore"
        if role == "time":
            if time_field is None:
                time_field = name
            else:
                role = "ignore"
        fields.append({"name": name, "role": role, "agg": agg, "parent": None, "target": None})

    dims = [f["name"] for f in fields if f["role"] == "dimension"]
    uniq = {f["name"]: f["unique"] for f in ds.fields}
    for alias in _aliases(ds, dims, uniq):
        next(f for f in fields if f["name"] == alias)["role"] = "ignore"
        dims.remove(alias)
    parents = _hierarchy(ds, dims, uniq)
    for f in fields:
        f["parent"] = parents.get(f["name"])

    measures = [f for f in fields if f["role"] == "measure"]
    sums = [f["name"] for f in measures if f["agg"] == "sum"]
    means = [f["name"] for f in measures if f["agg"] == "mean"]
    primary = (
        next((m for m in sums if _PRIMARY.search(m)), None)
        or next((m for m in means if _PRIMARY_MEAN.search(m)), None)
        or (sums[0] if sums else means[0] if means else COUNT)
    )
    targets(fields, primary)
    return {
        "fields": fields,
        "timeField": time_field,
        "timeGrain": _grain(ds, time_field) if time_field else None,
        "primaryMeasure": primary,
        "calcs": suggest_calcs(ds, fields),
        "confirmed": False,
    }


def targets(fields: list[dict], primary: str) -> None:
    """Pair measures with their plan/limit: revenue <- revenue_target, else the primary <- tolerance."""
    measures = [f for f in fields if f["role"] == "measure"]
    base = lambda name: _UNIT.sub("", _TARGET.sub("", name)).strip("_").lower()  # noqa: E731
    for t in measures:
        if not _TARGET.search(t["name"]):
            continue
        match = next((m for m in measures if m is not t and not _TARGET.search(m["name"]) and base(m["name"]) == base(t["name"]) and base(t["name"])), None)
        match = match or next((m for m in measures if m["name"] == primary and m is not t), None)
        if match and not match.get("target"):
            match["target"] = t["name"]


def suggest_calcs(ds: Dataset, fields: list[dict]) -> list[dict]:
    """Ratios worth having from the start: 0/1 flags become rates, and a measure over its limit."""
    prof = {f["name"]: f for f in ds.fields}
    out = []
    for f in fields:
        if f["role"] != "measure" or f["agg"] != "sum":
            continue
        p = prof[f["name"]]
        st = p.get("stats") or {}
        if p.get("integer") and st.get("min") == 0 and st.get("max") == 1 and _FLAG.search(f["name"]):
            stem = re.sub(r"(^|_)(count|flag)$|^(is|has)_", "", f["name"]) or f["name"]
            out.append({"name": f"{stem} rate", "num": f["name"], "den": COUNT, "scale": 1})
        if f.get("target"):
            out.append({"name": f"{f['name']} / {f['target']}", "num": f["name"], "den": f["target"], "scale": 1})
    return out


def _looks_like_sequence(ds: Dataset, f: dict, n: int) -> bool:
    """Integer row identifiers: nearly all distinct and densely packed (1, 2, 3...)."""
    is_int = ds.types.get(f["name"], "").split("(")[0] in ("TINYINT", "SMALLINT", "INTEGER", "BIGINT", "UTINYINT", "USMALLINT", "UINTEGER", "UBIGINT", "HUGEINT")
    if n <= 50 or not is_int or f["unique"] < 0.95 * n:
        return False
    return (f["stats"]["max"] - f["stats"]["min"] + 1) <= 1.5 * f["unique"]


def _fd_violations(ds: Dataset, key: str, others: list[str], nulls_count: bool) -> dict[str, int]:
    """For each other column, the most distinct values it takes within one value of `key`."""
    if not others:
        return {}
    cols = []
    for i, o in enumerate(others):
        q = ident(o)
        extra = f" + max(({q} IS NULL)::INT)" if nulls_count else ""
        cols.append(f"count(DISTINCT {q}){extra} AS c{i}")
    inner = f"SELECT {', '.join(cols)} FROM {ds.sql} WHERE {ident(key)} IS NOT NULL GROUP BY {ident(key)}"
    row = db.one(f"SELECT {', '.join(f'max(c{i})' for i in range(len(others)))} FROM ({inner})")
    return {o: int(v or 0) for o, v in zip(others, row)}


def _aliases(ds: Dataset, dims: list[str], uniq: dict[str, int]) -> list[str]:
    """Dimensions that are a 1:1 relabeling of an earlier one (country / iso3)."""
    out = []
    for i, a in enumerate(dims):
        same = [b for b in dims[i + 1 :] if b not in out and uniq[a] == uniq[b]]
        for b, worst in _fd_violations(ds, a, same, nulls_count=False).items():
            if worst <= 1:
                out.append(b)
    return out


def _hierarchy(ds: Dataset, dims: list[str], uniq: dict[str, int]) -> dict[str, str]:
    """child -> most specific parent, via functional dependencies child => parent."""
    parents: dict[str, str] = {}
    for child in dims:
        cands = [c for c in dims if c != child and 2 <= uniq[c] < uniq[child]]
        # Every child value maps to exactly one candidate value.
        ok = [c for c, worst in _fd_violations(ds, child, cands, nulls_count=True).items() if worst <= 1]
        if ok:
            parents[child] = max(ok, key=lambda c: (uniq[c], -cands.index(c)))
    return parents


def _grain(ds: Dataset, field: str) -> str:
    prof = next(f for f in ds.fields if f["name"] == field)
    if prof["type"] != "temporal" or not prof["stats"]["min"]:
        return "year"
    days = (datetime.fromisoformat(prof["stats"]["max"]) - datetime.fromisoformat(prof["stats"]["min"])).days
    if days > 365 * 8:
        return "year"
    if days > 120:
        return "month"
    if days > 21:
        return "week"
    return "day"


def load(ds: Dataset) -> dict[str, Any]:
    path = STRUCT_DIR / f"{ds.id}.json"
    if path.exists():
        saved = json.loads(path.read_text())
        names = {f["name"] for f in ds.fields}
        if {f["name"] for f in saved.get("fields", [])} == names:
            if "calcs" not in saved:
                # Saved before targets and calculated measures existed: the user never saw
                # these choices, so offer the suggestions on top of their confirmed fields.
                for f in saved["fields"]:
                    f.setdefault("target", None)
                targets(saved["fields"], saved.get("primaryMeasure") or COUNT)
                saved["calcs"] = suggest_calcs(ds, saved["fields"])
            return saved
    return detect(ds)


def save(ds: Dataset, structure: dict[str, Any]) -> dict[str, Any]:
    names = {f["name"] for f in ds.fields}
    fields = structure.get("fields", [])
    if {f["name"] for f in fields} != names:
        raise ValueError("Structure must list every field of the dataset exactly once.")
    dims = {f["name"] for f in fields if f["role"] == "dimension"}
    for f in fields:
        if f.get("parent") and (f["parent"] not in dims or f["parent"] == f["name"]):
            f["parent"] = None
        if f["role"] == "measure" and f.get("agg") not in ("sum", "mean"):
            f["agg"] = "sum"
        if f["role"] != "measure":
            f["agg"] = None
    measures = {f["name"] for f in fields if f["role"] == "measure"}
    for f in fields:
        if f.get("target") not in measures or f["role"] != "measure" or f.get("target") == f["name"]:
            f["target"] = None
    calcs = []
    for c in structure.get("calcs") or []:
        name = str(c.get("name") or "").strip()
        if not name:
            continue
        if name in names or name == COUNT or any(x["name"] == name for x in calcs):
            raise ValueError(f"Calculated measure “{name}” clashes with a field or another measure.")
        if c.get("num") not in measures | {COUNT} or c.get("den") not in measures | {COUNT}:
            raise ValueError(f"“{name}” must divide one measure (or Records) by another.")
        try:
            scale = float(c.get("scale") or 1)
        except (TypeError, ValueError):
            raise ValueError(f"“{name}”: scale must be a number.") from None
        calcs.append({"name": name, "num": c["num"], "den": c["den"], "scale": scale})
    if _has_cycle({f["name"]: f.get("parent") for f in fields}):
        raise ValueError("The hierarchy contains a cycle.")
    times = [f["name"] for f in fields if f["role"] == "time"]
    out = {
        "fields": fields,
        "timeField": times[0] if times else None,
        "timeGrain": structure.get("timeGrain") or (_grain(ds, times[0]) if times else None),
        "primaryMeasure": primary if (primary := structure.get("primaryMeasure")) in measures | {COUNT} | {c["name"] for c in calcs} else COUNT,
        "calcs": calcs,
        "confirmed": True,
    }
    STRUCT_DIR.mkdir(exist_ok=True)
    (STRUCT_DIR / f"{ds.id}.json").write_text(json.dumps(out, indent=2))
    return out


def reset(ds: Dataset) -> dict[str, Any]:
    (STRUCT_DIR / f"{ds.id}.json").unlink(missing_ok=True)
    return detect(ds)


def _has_cycle(parent: dict[str, str | None]) -> bool:
    for start in parent:
        seen, cur = set(), start
        while cur:
            if cur in seen:
                return True
            seen.add(cur)
            cur = parent.get(cur)
    return False
