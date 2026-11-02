"""driver: another measure whose distribution differs in the selection."""

from __future__ import annotations

import math

import numpy as np

from ..core import Engine
from ..registry import lead_kind
from ..stats import fmt, welch_p


@lead_kind("driver", icon="⇄", order=30)
def drivers(e: Engine) -> list[dict]:
    """Another measure that differs between the selection and the comparison group (Cohen's d)."""
    if not e.has_bg:
        return []
    out = []
    for mid in e.measures:
        m = e.measure(mid)
        # A ratio built from the current measure (or its parts) would only restate it.
        if mid == e.m.id or (m.sources & e.m.sources and (len(m.sources) > 1 or len(e.m.sources) > 1)):
            continue
        a, b = e.stats(e.sel_w, None, m), e.stats(e.bg_w, None, m)
        if a["neff"] < 5 or b["neff"] < 5:
            continue
        pooled = math.sqrt((a["var"] + b["var"]) / 2)
        if not pooled or math.isnan(pooled):
            continue
        dd = (a["mean"] - b["mean"]) / pooled
        p = welch_p(a, b)
        e.tests += 1
        lo, hi = e.value_range(f"({e.sel_w}) OR ({e.bg_w})", m)
        edges = np.histogram_bin_edges(np.array([lo, hi]), bins=24)
        rows = []
        for grp, where, g in (("selection", e.sel_w, a), ("rest", e.bg_w, b)):
            h = e.histogram(where, m, edges)
            total = g["w"] if g["w"] > 0 else 1
            rows += [{"x0": edges[i], "x1": edges[i + 1], "share": h[i] / total, "group": grp} for i in range(len(h))]
        verb = "is" if mid in e.calcs else "averages"
        reason = f"{mid} {verb} {fmt(a['mean'])} here vs {fmt(b['mean'])} {e.bg_label} ({dd:+.1f} SD)"
        out.append(e.lead("driver", mid, f"{mid}: here vs elsewhere", reason, min(1.0, abs(dd) / 1.2), p,
                          {"type": "driver", "field": mid, "rows": rows, "means": {"selection": a["mean"], "rest": b["mean"]},
                           "brushable": mid not in e.calcs}))
    return out
