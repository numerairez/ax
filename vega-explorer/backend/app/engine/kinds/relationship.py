"""relationship: across the values of a dimension, does another measure move with this one?

Drawn with the chart library's scatter template, so it doubles as the example of a
lead whose view is any library chart: {"type": "template", "template": <id>, "f": slots}.
"""

from __future__ import annotations

import pandas as pd

from ...structure import COUNT
from ..core import MAX_VALUES, Engine, Measure
from ..registry import lead_kind
from ..stats import corr_p, fmt

MIN_VALUES = 8


def _intensity(m: Measure) -> str:
    # Totals mostly track how big a group is; compare per-record levels instead.
    return "mean" if m.additive else "v"


def _axis(m: Measure) -> str:
    return f"{m.name} per record" if m.additive and m.id != COUNT else m.label


@lead_kind("relationship", icon="⋰", order=60, quota=2)
def relationships(e: Engine) -> list[dict]:
    """Another measure whose level tracks this one across a dimension's values (Spearman)."""
    if e.m.id == COUNT:
        return []
    # Levels and rates stored as fields (quote age, rating) explain; totals mostly restate size,
    # and calculated ratios are often built from the measure itself. This also keeps the test count small.
    others = [e.measure(x) for x in e.measures if x != e.m.id and x not in e.calcs and not e.measure(x).additive]
    out = []
    for d in e.dims:
        ys = e.stats(e.sel_w, d)
        if not (MIN_VALUES <= len(ys) <= MAX_VALUES):
            continue
        y = ys[_intensity(e.m)][ys["n"] >= 3]
        best = None
        for m in others:
            x = e.stats(e.sel_w, d, m)[_intensity(m)]
            both = pd.concat([x.rename("x"), y.rename("y")], axis=1).dropna()
            if len(both) < MIN_VALUES or both["x"].nunique() < 3 or both["y"].nunique() < 3:
                continue
            r = float(both["x"].rank().corr(both["y"].rank()))
            p = corr_p(r, len(both))
            e.tests += 1
            if r == r and (best is None or abs(r) > abs(best[1])):
                best = (m, r, p, both)
        if not best:
            continue
        m, r, p, both = best
        xname, yname = _axis(m), _axis(e.m)
        hi = both["x"].idxmax()
        reason = (f"Across {len(both)} {d} values, {yname} {'rises' if r > 0 else 'falls'} as {xname} rises "
                  f"(rank correlation {r:+.2f}); {hi} has the highest {xname} ({fmt(both.loc[hi, 'x'])})")
        rows = [{d: str(k), xname: both.loc[k, "x"], yname: both.loc[k, "y"], "records": ys.loc[k, "n"]} for k in both.index]
        fields = [
            {"name": d, "type": "nominal", "missing": 0, "unique": len(rows)},
            {"name": xname, "type": "quantitative", "missing": 0, "unique": len(rows)},
            {"name": yname, "type": "quantitative", "missing": 0, "unique": len(rows)},
            {"name": "records", "type": "quantitative", "missing": 0, "unique": len(rows), "integer": True},
        ]
        # A correlation across groups is a clue about why, not evidence of it: weighted below direct comparisons.
        lead = e.lead("relationship", f"{d}:{m.id}", f"{yname} vs {xname}, by {d}", reason, 0.7 * min(1.0, abs(r) / 0.8), p,
                      {"type": "template", "template": "scatter", "field": d, "key": d, "rows": rows, "fields": fields,
                       "f": {"x": xname, "y": yname, "color": "", "shape": ""}, "o": {},
                       "guide": (f"Each point is one {d}: across = its {xname}, up = its {yname}. If the points drift from "
                                 f"bottom-left to top-right, the two rise together; top-left to bottom-right, one falls as the other rises. "
                                 f"A loose cloud means no relationship. Hover a point for its values; click it to investigate that {d}.")})
        lead["field"] = d
        out.append(lead)
    return out
