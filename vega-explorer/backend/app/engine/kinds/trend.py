"""trend: the selection over time, with the most anomalous period flagged."""

from __future__ import annotations

import numpy as np

from ..core import PERIOD, Engine
from ..registry import lead_kind
from ..stats import fmt, period_label, sf


@lead_kind("trend", icon="〜", order=10)
def trend(e: Engine) -> list[dict]:
    """The selection over time, with the most anomalous period flagged."""
    if not e.tf:
        return []
    per = e.stats(e.trend_w, PERIOD)
    if per.empty:
        return []
    # Only the span the selection covers: a time filter must not pad with empty periods.
    lo, hi = per.index.min(), per.index.max()
    periods = [p for p in e.periods(e.trend_ctx_w) if lo <= p <= hi]
    series = per["v"].reindex(periods, fill_value=0 if e.m.additive else np.nan).dropna()
    if len(series) < 6:
        return []
    base = series.rolling(5, center=True, min_periods=3).median()
    resid = series - base
    mad = float((resid.abs()).median()) * 1.4826 or float(resid.std()) or 1.0
    z = resid / mad
    t = z.abs().idxmax()
    zt = float(z[t])
    p = 2 * sf(abs(zt))
    e.tests += len(series)
    ratio = series[t] / base[t] if base[t] else float("nan")
    reason = (
        f"{period_label(t, e.grain)} stands out: {fmt(series[t])} vs ~{fmt(base[t])} typical"
        + (f" ({ratio:.1f}×)" if ratio == ratio and ratio > 0 else "")
    )
    rest = None
    if e.has_bg and e.trend_rest_w:
        rb = e.stats(e.trend_rest_w, PERIOD)["v"].reindex(series.index)
        if e.m.additive and rb.sum():
            rb = rb * (series.sum() / rb.sum())  # scale so shapes are comparable
        rest = rb
    target = e.target_of(e.m)
    tgt = e.stats(e.trend_w, PERIOD, target)["v"].reindex(series.index) if target else None
    rows = [
        {"t": k, "value": series[k], "baseline": base[k], "rest": None if rest is None else rest.get(k),
         "target": None if tgt is None else tgt.get(k), "anomaly": bool(abs(z[k]) >= 3)}
        for k in series.index
    ]
    # Needs both statistical (z) and practical (ratio) size to score highly.
    practical = min(1.0, abs(ratio - 1) / 0.3) if ratio == ratio else 0.5
    score = min(1.0, abs(zt) / 7) * practical
    if not e.filters or p * max(1, e.tests_before + e.tests) >= 0.05:
        third = max(1, len(series) // 3)
        first, last = series.iloc[:third].mean(), series.iloc[-third:].mean()
        if first:
            drift = (last - first) / abs(first)
            overall = f"{e.mlabel} is {'up' if drift >= 0 else 'down'} {abs(drift):.0%} from the first to the last third of the period"
            reason = overall + ("" if score > 0.3 else "; no single period stands out reliably")
            score = max(score, min(1.0, abs(drift)))
    view = {"type": "trend", "field": e.tf, "grain": e.grain, "rows": rows, "highlight": t,
            "restLabel": "rest (scaled to match)" if e.m.additive else "rest"}
    if target:
        view["targetLabel"] = f"target ({target.name})"
    if e.window:
        view["window"] = list(e.window)
        view["compareWindow"] = list(e.compare_window)
    lead = e.lead("trend", e.tf, f"{e.mlabel} over time", reason, score, p, view)
    if not e.filters:
        e.bonus(lead, 0.4, "start of an investigation: the trend is the natural first view")
    return [lead]
