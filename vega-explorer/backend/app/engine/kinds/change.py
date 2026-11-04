"""change: what drove the change between two time windows, by dimension."""

from __future__ import annotations

import numpy as np

from ...db import lit
from ..core import MAX_VALUES, PERIOD, Engine
from ..registry import lead_kind
from ..stats import chi2_counts, fmt


@lead_kind("change", icon="±", order=40)
def changes(e: Engine) -> list[dict]:
    """After brushing a time range, or against a prior-period baseline: which values drove the change."""
    if e.baseline != "siblings":
        after_w, before_w, span = e.sel_w, e.bg_w, e.span
        bonus = (0.25, f"you are comparing with the {e.span}, so what changed is the question")
        if not e.has_bg:
            return []
    else:
        if not (e.last and e.last["op"] == "range" and e.last["field"] == e.tf):
            return []
        after = e.stats(e.sel_w, PERIOD)
        if after.empty:
            return []
        k = len(after)
        before_periods = [p for p in e.periods(e.ctx_w) if p < after.index.min()][-k:]
        if not before_periods:
            return []
        before_w = f"({e.ctx_w}) AND {e.P} BETWEEN {lit(before_periods[0])} AND {lit(before_periods[-1])}"
        after_w = e.sel_w
        span = f"previous {k} {e.grain}{'s' if k > 1 else ''}"
        # Answer the question the brush asked, even if the evidence is weak.
        bonus = (0.5, "you brushed a time range: this answers what changed in it")
    tot_a, tot_b = e.total(after_w), e.total(before_w)
    rel = (tot_a - tot_b) / abs(tot_b) if tot_b else float("nan")
    out = []
    for d in e.dims:
        sa, sb = e.stats(after_w, d), e.stats(before_w, d)
        ga, gb = sa["v"], sb["v"]
        idx = ga.index.union(gb.index)
        if len(idx) < 2 or len(idx) > MAX_VALUES:
            continue
        fill = 0 if e.m.additive else np.nan
        ga, gb = ga.reindex(idx, fill_value=fill), gb.reindex(idx, fill_value=fill)
        delta = (ga - gb).dropna()
        if delta.abs().sum() == 0:
            continue
        v = delta.abs().idxmax()
        conc = float(abs(delta[v]) / delta.abs().sum())
        p = chi2_counts(sa["n"], sb["n"])
        e.tests += 1
        direction = "rose" if tot_a >= tot_b else "fell"
        if e.m.additive:
            reason = f"{e.mlabel} {direction} {fmt(abs(tot_a - tot_b))} ({rel:+.0%}) vs the {span}; {v} contributed {fmt(delta[v])} ({conc:.0%} of the movement)"
        else:
            reason = f"{e.mlabel} {direction} from {fmt(tot_b)} to {fmt(tot_a)} vs the {span}; biggest shift in {v} ({fmt(delta[v])})"
        score = min(1.0, 0.45 * conc + 0.55 * min(1.0, abs(rel) * 2 if rel == rel else 0.3))
        rows = [{"value": str(i), "before": gb[i], "after": ga[i], "delta": delta[i]} for i in delta.abs().sort_values(ascending=False).index[:20]]
        lead = e.lead("change", d, f"What drove the change, by {d}", reason, score, p,
                      {"type": "change", "field": d, "rows": rows, "span": span})
        e.bonus(lead, *bonus)
        out.append(lead)
    return out
