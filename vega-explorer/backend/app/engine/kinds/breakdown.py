"""breakdown: how the selection splits along a dimension, vs. the comparison group.
Additive measures also get a like-for-like lead and a mix-effect check."""

from __future__ import annotations

import pandas as pd

from ...structure import COUNT
from ..core import MAX_VALUES, Engine
from ..registry import lead_kind
from ..stats import chi2_counts, fmt, std, welch_p


@lead_kind("breakdown", icon="▤", order=20)
def breakdowns(e: Engine) -> list[dict]:
    """How the selection splits along each dimension."""
    out = []
    for d in e.dims:
        a = e.stats(e.sel_w, d)
        if len(a) < 2 or len(a) > MAX_VALUES:
            continue
        b = e.stats(e.bg_w, d) if e.has_bg else None
        child = e.descends_from_filter(d)
        compare = b is not None and not child
        lead = (_vs_bg(e, d, a, b) if not b.empty else None) if compare else _overview(e, d, a)
        if not lead:
            continue
        like = _like_for_like(e, d, a, b) if compare and e.m.additive and e.m.id != COUNT else None
        if like:
            out.append(like)
            _flag_mix(e, lead, like)
        parent = e.meta[d].get("parent")
        if e.last and e.last["op"] == "eq" and parent == e.last["field"]:
            lead["bonus"] += 0.2
            lead["tags"].append("drill down")
        elif not e.filters and not parent:
            lead["bonus"] += 0.1  # start broad: top-level dimensions first
        out.append(lead)
    return out


def _overview(e: Engine, d: str, a: pd.DataFrame) -> dict | None:
    g, n_by = a["v"], a["n"]
    if e.m.additive:
        share = g.abs() / (g.abs().sum() or 1)
        top = share.sort_values(ascending=False)
        k = 1 if len(top) <= 5 else 3
        score = min(1.0, (top.iloc[:k].sum() - k / len(top)) * 1.5 + 0.2)
        if k == 1:
            reason = f"{top.index[0]} leads with {top.iloc[0]:.0%} of {e.mlabel.lower()} across {len(top)} {d} values"
        else:
            reason = f"Top 3 of {len(top)} {d} values hold {top.iloc[:k].sum():.0%} of {e.mlabel.lower()} — led by {top.index[0]} ({top.iloc[0]:.0%})"
    else:
        sd = std(e.stats(e.sel_w)) or 1
        spread = (g.max() - g.min()) / sd
        score = min(1.0, spread / 2.5)
        reason = f"{e.mlabel} ranges from {fmt(g.min())} ({g.idxmin()}) to {fmt(g.max())} ({g.idxmax()}) across {d}"
    rows = [{"value": str(v), "actual": g[v], "n": n_by[v]} for v in g.abs().sort_values(ascending=False).index[:25]]
    return e.lead("breakdown", d, f"{e.mlabel} by {d}", reason, score, None,
                  {"type": "breakdown", "field": d, "mode": "overview", "rows": rows})


def _vs_bg(e: Engine, d: str, a: pd.DataFrame, b: pd.DataFrame) -> dict | None:
    g, n_by, gb, nb = a["v"], a["n"], b["v"], b["n"]
    idx = g.index.union(gb.index)
    if e.m.additive:
        s_sel = (g / (g.abs().sum() or 1)).reindex(idx, fill_value=0)
        s_bg = (gb / (gb.abs().sum() or 1)).reindex(idx, fill_value=0)
        tvd = 0.5 * float((s_sel - s_bg).abs().sum())
        over = (s_sel - s_bg)[g.index]
        v = over.idxmax() if over.max() > 0 else over.abs().idxmax()
        reason = f"{v} is {s_sel[v]:.0%} of {e.mlabel.lower()} here vs {s_bg[v]:.0%} {e.bg_label}"
        score = min(1.0, tvd * 1.8)
        p = chi2_counts(n_by, nb)
        e.tests += 1
        expected = s_bg * g.sum()
        mode = "share"
    else:
        sd = std(e.pooled(a, b)) or 1
        gb_al = gb.reindex(g.index)
        dv = ((g - gb_al) / sd).dropna()
        dv = dv[n_by.reindex(dv.index) >= 5]
        if dv.empty:
            return None
        w = n_by.reindex(dv.index)
        score = min(1.0, float((dv.abs() * w).sum() / w.sum()) / 0.8)
        v = dv.abs().idxmax()
        reason = f"{v}: {e.mlabel.lower()} {fmt(g[v])} here vs {fmt(gb_al[v])} {e.bg_label} ({dv[v]:+.1f} SD)"
        p = welch_p(a.loc[v], b.loc[v])
        e.tests += len(dv)
        expected = gb_al
        mode = "mean"
    order = g.abs().sort_values(ascending=False).index[:25]
    rows = [{"value": str(k), "actual": g[k], "expected": expected.get(k), "n": n_by[k]} for k in order]
    return e.lead("breakdown", d, f"{e.mlabel} by {d}", reason, score, p,
                  {"type": "breakdown", "field": d, "mode": mode, "rows": rows, "highlight": str(v)})


def _like_for_like(e: Engine, d: str, a: pd.DataFrame, b: pd.DataFrame) -> dict | None:
    """Each value against the same value elsewhere, per record: a share can differ
    just because the selection holds a different mix, so compare like with like."""
    a_mean, b_mean, a_n, b_n = a["mean"], b["mean"], a["n"], b["n"]
    both = [k for k in a.index if a_n.get(k, 0) >= 3 and b_n.get(k, 0) >= 3]
    if not both:
        return None
    comp = {}
    for k in both:
        sd = std(e.pooled(a.loc[k], b.loc[k])) or 1
        comp[k] = ((a_mean[k] - b_mean[k]) / sd, welch_p(a.loc[k], b.loc[k]))
    e.tests += len(comp)
    k = max(comp, key=lambda x: abs(comp[x][0]))
    eff, p = comp[k]
    ratio = a_mean[k] / b_mean[k] if b_mean[k] else float("nan")
    unit = f"avg {e.m.name} per record"
    if p is not None and p < 0.05:
        how = f"{ratio:.1f}×" if ratio == ratio and ratio > 0 else f"{eff:+.1f} SD"
        reason = f"Like-for-like, {k} averages {fmt(a_mean[k])} per record here vs {fmt(b_mean[k])} for {k} {e.bg_label} ({how})"
    else:
        reason = (f"Like-for-like, no {d} is clearly different from the same {d} {e.bg_label}; the largest gap, "
                  f"{k} ({fmt(a_mean[k])} vs {fmt(b_mean[k])} per record), could be noise")
    # Weight the effect by how much of the selection that value carries.
    weight = float(a.loc[k, "a"] / (a["a"].sum() or 1))
    score = min(1.0, abs(eff) / 0.8) * (0.5 + 0.5 * min(1.0, weight * 2))
    order = a["s"].abs().sort_values(ascending=False).index
    rows = [{"value": str(x), "actual": a_mean[x], "expected": b_mean.get(x), "n": a_n[x], "nb": b_n.get(x, 0)} for x in order][:25]
    lead = e.lead("breakdown", d, f"{d} like-for-like: {unit}", reason, score, p,
                  {"type": "breakdown", "field": d, "mode": "like", "rows": rows, "highlight": str(k),
                   "xTitle": unit.capitalize(), "expectedTitle": f"same {d} {e.bg_label}"})
    lead["id"] = f"like:{d}"
    lead["tags"].append("like-for-like")
    lead["like"] = {str(x): comp[x] for x in comp}
    return lead


def _flag_mix(e: Engine, lead: dict, like: dict) -> None:
    """A share lead whose standout value is no different like-for-like is a mix effect."""
    comp = like.pop("like")
    v = lead["view"].get("highlight")
    share = next((r for r in lead["view"]["rows"] if r["value"] == v), None)
    if lead["view"].get("mode") != "share" or share is None:
        return
    if v not in comp:
        if like["view"]["rows"] and not any(r["value"] == v and r["nb"] for r in like["view"]["rows"]):
            lead["reason"] += f". Nothing {e.bg_label} has {v}, so there is no like-for-like comparison"
        return
    eff, p = comp[v]
    row = next(r for r in like["view"]["rows"] if r["value"] == v)
    a, b = row["actual"], row["expected"]
    ratio = a / b if b else float("nan")
    per = f"{fmt(a)} vs {fmt(b)} per record"
    # Does like-for-like point the same way as the share gap?
    same_way = (a > b) == (share["actual"] >= (share.get("expected") or 0))
    if abs(eff) < 0.2 or 0.8 <= ratio <= 1.25:
        lead["reason"] += f". That is mix, not performance: like-for-like, {v} is in line with {v} {e.bg_label} ({per})"
    elif not same_way:
        word = "lower" if a < b else "higher"
        lead["reason"] += f". That is mix: like-for-like, {v} is actually {word} than {v} {e.bg_label} ({per})"
    elif p is not None and p < 0.05:
        lead["reason"] += f", and not just mix: like-for-like it is {ratio:.1f}× ({per})" if ratio > 0 else f", and not just mix ({per})"
        return
    else:
        lead["reason"] += f". Like-for-like it is also {'higher' if a > b else 'lower'} ({per}), but on too few records to rule out mix"
        return
    lead["score"] *= 0.35
    lead["tags"].append("mix effect")
