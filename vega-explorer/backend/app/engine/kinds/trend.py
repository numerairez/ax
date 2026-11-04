"""trend: the selection over time, with unusual stretches flagged."""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..core import PERIOD, Engine
from ..registry import lead_kind
from ..stats import fmt, period_label, sf

ALPHA = 0.05  # an unusual period must survive the multiple-testing adjustment at this level


def typical(series: pd.Series) -> pd.Series:
    """Median of the two periods either side, leaving the period itself out, so a spike
    can't raise its own baseline (and a two-period spike can't hide its first half)."""
    v = series.to_numpy(dtype=float)
    out = []
    for i in range(len(v)):
        nb = np.concatenate([v[max(0, i - 2) : i], v[i + 1 : i + 3]])
        out.append(float(np.median(nb)) if len(nb) >= 2 else np.nan)
    return pd.Series(out, index=series.index)


def episodes(unusual: pd.Series, resid: pd.Series) -> list[list[pd.Timestamp]]:
    """Runs of consecutive unusual periods that deviate the same way."""
    runs: list[list[pd.Timestamp]] = []
    prev = None
    for t, flag in unusual.items():
        if flag and runs and prev is not None and unusual[prev] and np.sign(resid[t]) == np.sign(resid[prev]):
            runs[-1].append(t)
        elif flag:
            runs.append([t])
        prev = t
    return runs


@lead_kind("trend", icon="〜", order=10)
def trend(e: Engine) -> list[dict]:
    """The selection over time, with unusual stretches flagged."""
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
    base = typical(series)
    resid = series - base
    mad = float((resid.abs()).median()) * 1.4826 or float(resid.std()) or 1.0
    z = (resid / mad).fillna(0)
    p_each = z.abs().map(lambda x: 2 * sf(x))
    e.tests += len(series)
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
         "target": None if tgt is None else tgt.get(k), "anomaly": False}
        for k in series.index
    ]
    view = {"type": "trend", "field": e.tf, "grain": e.grain, "rows": rows,
            "restLabel": "rest (scaled to match)" if e.m.additive else "rest"}
    if target:
        view["targetLabel"] = f"target ({target.name})"
    if e.window:
        view["window"] = list(e.window)
        view["compareWindow"] = list(e.compare_window)
    third = max(1, len(series) // 3)
    first, last = series.iloc[:third].mean(), series.iloc[-third:].mean()
    drift = (last - first) / abs(first) if first else float("nan")

    def finalize(lead: dict, total_tests: int) -> None:
        # What counts as unusual depends on every comparison made so far, known only now.
        unusual = p_each * max(1, total_tests) < ALPHA
        runs = episodes(unusual, resid)
        for r in rows:
            r["anomaly"] = bool(unusual[r["t"]])
        best = max(runs, key=lambda run: z[run].abs().max()) if runs else None
        found = ""
        lead["p"], lead["score"] = None, 0.0
        if best:
            peak = max(best, key=lambda t: abs(resid[t]))
            ratio = series[peak] / base[peak] if base[peak] else float("nan")
            when = period_label(best[0], e.grain) + ("" if len(best) == 1 else f" – {period_label(best[-1], e.grain)}")
            at = "" if len(best) == 1 else f" at its peak ({period_label(peak, e.grain)})"
            found = (f"{when} stands out: {fmt(series[peak])}{at} vs ~{fmt(base[peak])} typical"
                     + (f" ({ratio:.1f}×)" if ratio == ratio and ratio > 0 else ""))
            # Needs both statistical (z) and practical (ratio) size to score highly.
            practical = min(1.0, abs(ratio - 1) / 0.3) if ratio == ratio else 0.5
            lead["score"] = min(1.0, abs(float(z[peak])) / 7) * practical
            lead["p"] = float(p_each[best].min())
            view["highlight"] = peak
            view["episode"] = [best[0], best[-1]]
        overall = (f"{e.mlabel} is {'up' if drift >= 0 else 'down'} {abs(drift):.0%} from the first to the last third of the period"
                   if drift == drift else "")
        if not e.filters and overall:
            # The natural opening: the overall direction, plus any stretch that stands out.
            lead["reason"] = overall + (f"; {found[0].lower() + found[1:]}" if found else "; no single period stands out reliably")
            lead["score"] = max(lead["score"], min(1.0, abs(drift)))
        elif found:
            lead["reason"] = found
        else:
            lead["reason"] = (overall + "; " if overall else "") + "no single period stands out reliably"
            lead["score"] = min(1.0, abs(drift)) if overall else 0.1

    lead = e.lead("trend", e.tf, f"{e.mlabel} over time", "", 0.0, None, view)
    lead["finalize"] = finalize
    if not e.filters:
        e.bonus(lead, 0.4, "start of an investigation: the trend is the natural first view")
    return [lead]
