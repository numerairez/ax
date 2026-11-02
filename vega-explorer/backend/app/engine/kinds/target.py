"""target: the measure against its plan, budget or limit, by dimension."""

from __future__ import annotations

from ... import db
from ...db import ident
from ..core import MAX_VALUES, Engine
from ..registry import lead_kind
from ..stats import fmt


@lead_kind("target", icon="◎", order=50)
def targets(e: Engine) -> list[dict]:
    """Values on the other side of their target from the selection as a whole (set per measure in the structure)."""
    t = e.target_of(e.m)
    if not t:
        return []
    tot_a, tot_t = e.total(e.sel_w), e.total(e.sel_w, t)
    rel = (tot_a - tot_t) / abs(tot_t) if tot_t else float("nan")
    if rel != rel:
        return []
    side = "above" if tot_a > tot_t else "below"
    overall = f"overall {e.mlabel.lower()} is {fmt(tot_a)} vs {fmt(tot_t)} target ({rel:+.0%})"
    defined = _defined_by_target(e, t)
    out = []
    for d in e.dims:
        if d in defined:
            continue
        a, b = e.stats(e.sel_w, d), e.stats(e.sel_w, d, t)
        if len(a) < 2 or len(a) > MAX_VALUES:
            continue
        actual, target = a["v"], b["v"].reindex(a.index)
        gap = (actual - target).dropna()
        if gap.empty or gap.abs().sum() == 0:
            continue
        relg = gap / target.reindex(gap.index).abs().where(lambda x: x > 0)
        # The story is the exceptions: values on the other side of target from the whole.
        exc = gap[gap > 0] if side == "below" else gap[gap < 0]
        pool = exc if not exc.empty else gap
        # Money-weighted for additive measures; relative for levels and rates.
        v = pool.abs().idxmax() if e.m.additive else relg.reindex(pool.index).abs().idxmax()
        rel_v = relg.get(v, float("nan"))
        size = min(1.0, abs(rel_v)) if rel_v == rel_v else 0.5
        if exc.empty:
            score = 0.25 * size
            lead_in = f"Every {d} is {side} target; {v} is furthest ({fmt(actual[v])} vs {fmt(target[v])})"
        else:
            share = float(exc.abs().sum() / gap.abs().sum())
            score = min(1.0, 0.5 * size + 0.5 * share)
            other = "above" if side == "below" else "below"
            lead_in = (f"{v} is {fmt(abs(gap[v]))} {other} target ({fmt(actual[v])} vs {fmt(target[v])}"
                       + (f", {rel_v:+.0%}" if rel_v == rel_v else "") + "), "
                       + (f"the only one of {len(gap)} {d} values {other} it" if len(exc) == 1 else f"one of {len(exc)} of {len(gap)} {d} values {other} it"))
        order = gap.sort_values(ascending=side == "above").index[:25]
        rows = [{"value": str(k), "actual": actual[k], "expected": target[k], "n": a.loc[k, "n"]} for k in order]
        out.append(e.lead("target", d, f"{e.mlabel} vs target, by {d}", f"{lead_in}, while {overall}", score, None,
                          {"type": "breakdown", "field": d, "mode": "target", "rows": rows, "highlight": str(v),
                           "expectedTitle": f"target ({t.name})"}))
    return out


def _defined_by_target(e: Engine, t) -> set[str]:
    """Dimensions where every row of each value sits on the same side of its target
    (a status like "Breach" / "Within tolerance"): comparing them to the target is circular."""
    if e.m.id not in e.meta or t.id not in e.meta or not e.dims:
        return set()
    side = f"sign({ident(e.m.id)} - {ident(t.id)})"
    cols = [f"count(DISTINCT CASE WHEN {ident(d)} IS NOT NULL THEN CAST({ident(d)} AS VARCHAR) || '|' || CAST({side} AS VARCHAR) END) = count(DISTINCT {ident(d)})"
            for d in e.dims]
    row = db.one(f"SELECT {', '.join(cols)} FROM {e.T} WHERE ({e.sel_w}) AND {ident(e.m.id)} != {ident(t.id)}")
    return {d for d, pure in zip(e.dims, row) if pure}
