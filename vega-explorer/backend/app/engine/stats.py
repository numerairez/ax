"""Statistics on aggregated groups, so tests can run on what SQL returns instead of raw rows.

Each group carries sufficient statistics for a (possibly weighted) per-record value
r_i = num_i / den_i with weight den_i:

  n   rows               s   sum(num)           w   sum(den)
  q   sum(num^2 / den)   w2  sum(den^2)         a   sum(|num|)

For plain fields den is 1 for non-null rows, so this is the ordinary mean and sample
variance; for a ratio measure it is the den-weighted mean, which equals sum(num)/sum(den).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

SUMS = ["n", "s", "w", "q", "w2", "a"]


def derive(g: pd.DataFrame | pd.Series, additive: bool) -> pd.DataFrame | pd.Series:
    """Add v (the group's value), mean, var (sample) and neff (effective sample size)."""
    if isinstance(g, pd.Series):
        return derive(g.to_frame().T.astype(float), additive).iloc[0]
    g = g.copy()
    with np.errstate(divide="ignore", invalid="ignore"):
        w = g["w"].astype(float)
        mean = g["s"] / w.where(w != 0)
        neff = w * w / g["w2"].where(g["w2"] != 0)
        var = (g["q"] / w.where(w != 0) - mean * mean).clip(lower=0) * neff / (neff - 1).where(neff > 1)
    g["mean"], g["neff"], g["var"] = mean, neff, var
    g["v"] = g["s"] if additive else mean
    return g


def combine(*rows: pd.Series | pd.DataFrame, additive: bool = False) -> pd.Series:
    """Pool groups (rows of a stats frame, or whole frames) into one."""
    parts = [r[SUMS].sum() if isinstance(r, pd.DataFrame) else r[SUMS] for r in rows]
    return derive(pd.concat(parts, axis=1).sum(axis=1), additive)


def std(g: pd.Series) -> float:
    v = g["var"]
    return float(math.sqrt(v)) if v == v and v is not None else float("nan")


def welch_p(a: pd.Series, b: pd.Series) -> float | None:
    if not (a["neff"] >= 3 and b["neff"] >= 3):
        return None
    se = math.sqrt(a["var"] / a["neff"] + b["var"] / b["neff"])
    if not se or math.isnan(se):
        return None
    return 2 * sf(abs(a["mean"] - b["mean"]) / se)


def sf(z: float) -> float:
    """Upper tail of the standard normal."""
    return 0.5 * math.erfc(z / math.sqrt(2))


def chi2_sf(x: float, k: int) -> float:
    """Chi-square upper tail via the Wilson-Hilferty normal approximation."""
    if k <= 0:
        return 1.0
    if x <= 0:
        return 1.0
    z = ((x / k) ** (1 / 3) - (1 - 2 / (9 * k))) / math.sqrt(2 / (9 * k))
    return sf(z)


def chi2_counts(a: pd.Series, b: pd.Series) -> float | None:
    """Test whether two count distributions over the same categories differ."""
    t = pd.concat([a, b], axis=1).fillna(0)
    t = t[t.sum(axis=1) > 0]
    if len(t) < 2 or t.to_numpy().sum() == 0:
        return None
    obs = t.to_numpy(dtype=float)
    exp = obs.sum(axis=1, keepdims=True) * obs.sum(axis=0, keepdims=True) / obs.sum()
    with np.errstate(divide="ignore", invalid="ignore"):
        x = np.nansum(np.where(exp > 0, (obs - exp) ** 2 / exp, 0))
    return chi2_sf(float(x), len(t) - 1)


def corr_p(r: float, n: int) -> float | None:
    """Two-sided p for a correlation via the Fisher transform."""
    if n < 4 or r != r:
        return None
    r = max(-0.9999, min(0.9999, r))
    return 2 * sf(abs(math.atanh(r)) * math.sqrt(n - 3))


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


def clean(x: Any) -> Any:
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    if isinstance(x, (np.floating, float)):
        return None if math.isnan(float(x)) or math.isinf(float(x)) else float(x)
    if isinstance(x, np.integer):
        return int(x)
    if isinstance(x, (pd.Timestamp,)):
        return x.strftime("%Y-%m-%dT%H:%M:%S")
    if isinstance(x, np.bool_):
        return bool(x)
    return x


def period_label(ts: pd.Timestamp, grain: str) -> str:
    return {
        "year": ts.strftime("%Y"),
        "quarter": f"Q{ts.quarter} {ts.year}",
        "month": ts.strftime("%b %Y"),
        "week": "week of " + ts.strftime("%d %b %Y"),
        "day": ts.strftime("%d %b %Y"),
    }.get(grain, ts.strftime("%Y-%m-%d"))
