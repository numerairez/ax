"""Detect (and persist user edits to) the analytical structure of a dataset.

The structure tells the lead engine how to reason about each field:
  role       dimension | measure | time | lat | lon | id | ignore
  agg        sum | mean          (measures only: is it additive or an average?)
  parent     another dimension   (hierarchy: city -> state -> region)
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pandas as pd

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


def detect(ds: Dataset) -> dict[str, Any]:
    df = ds.df
    n = len(df)
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
            elif _ID.search(name) or _looks_like_sequence(df[name], n):
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
        fields.append({"name": name, "role": role, "agg": agg, "parent": None})

    dims = [f["name"] for f in fields if f["role"] == "dimension"]
    for alias in _aliases(df, dims):
        next(f for f in fields if f["name"] == alias)["role"] = "ignore"
        dims.remove(alias)
    parents = _hierarchy(df, dims)
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
    return {
        "fields": fields,
        "timeField": time_field,
        "timeGrain": _grain(df, time_field) if time_field else None,
        "primaryMeasure": primary,
        "confirmed": False,
    }


def _looks_like_sequence(s: pd.Series, n: int) -> bool:
    """Integer row identifiers: nearly all distinct and densely packed (1, 2, 3...)."""
    v = s.dropna()
    if n <= 50 or not pd.api.types.is_integer_dtype(v) or v.nunique() < 0.95 * n:
        return False
    return (v.max() - v.min() + 1) <= 1.5 * v.nunique()


def _aliases(df: pd.DataFrame, dims: list[str]) -> list[str]:
    """Dimensions that are a 1:1 relabeling of an earlier one (country / iso3)."""
    out = []
    for i, a in enumerate(dims):
        for b in dims[i + 1 :]:
            if b in out or df[a].nunique() != df[b].nunique():
                continue
            if (df.groupby(a, observed=True)[b].nunique() <= 1).all():
                out.append(b)
    return out


def _hierarchy(df: pd.DataFrame, dims: list[str]) -> dict[str, str]:
    """child -> most specific parent, via functional dependencies child => parent."""
    uniq = {d: df[d].nunique() for d in dims}
    parents: dict[str, str] = {}
    for child in dims:
        best = None
        for cand in dims:
            if cand == child or uniq[cand] >= uniq[child] or uniq[cand] < 2:
                continue
            # Every child value maps to exactly one candidate value.
            if (df.groupby(child, observed=True)[cand].nunique(dropna=False) <= 1).all():
                if best is None or uniq[cand] > uniq[best]:
                    best = cand
        if best:
            parents[child] = best
    return parents


def _grain(df: pd.DataFrame, field: str) -> str:
    s = df[field]
    if not pd.api.types.is_datetime64_any_dtype(s):
        return "year"
    days = (s.max() - s.min()).days
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
    if _has_cycle({f["name"]: f.get("parent") for f in fields}):
        raise ValueError("The hierarchy contains a cycle.")
    times = [f["name"] for f in fields if f["role"] == "time"]
    out = {
        "fields": fields,
        "timeField": times[0] if times else None,
        "timeGrain": structure.get("timeGrain") or (_grain(ds.df, times[0]) if times else None),
        "primaryMeasure": structure.get("primaryMeasure") or COUNT,
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
