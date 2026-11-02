"""Lead kinds are plugins. A kind is a function that takes the Engine (the current
selection, its comparison group and helpers to query them) and returns leads:

    from app.engine import Engine, lead_kind

    @lead_kind("outliers", icon="⚑", order=70)
    def outliers(e: Engine) -> list[dict]:
        ...
        return [e.lead("outliers", field, title, reason, score, p_value, view)]

Every module in app/engine/kinds/ is loaded on startup. Kinds that live elsewhere
are loaded from the comma-separated module names in $VEGA_LEAD_KINDS.

A lead's `view` is drawn by the frontend view registry (frontend/src/investigate/views.ts)
by its `type`. Use an existing type, add one there, or use {"type": "template", ...}
to draw it with any chart from the chart library.
"""

from __future__ import annotations

import importlib
import os
import pkgutil
from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from .core import Engine


@dataclass
class LeadKind:
    name: str
    fn: Callable[["Engine"], list[dict]]
    icon: str
    order: int
    # At most this many leads of the kind reach the menu (drill-downs are exempt).
    quota: int
    description: str


KINDS: dict[str, LeadKind] = {}


def lead_kind(name: str, *, icon: str = "•", order: int = 100, quota: int = 3):
    def register(fn: Callable[["Engine"], list[dict]]):
        doc = (fn.__doc__ or "").strip().split("\n")[0]
        KINDS[name] = LeadKind(name, fn, icon, order, quota, doc)
        return fn

    return register


def load() -> dict[str, LeadKind]:
    from . import kinds

    for mod in pkgutil.iter_modules(kinds.__path__):
        importlib.import_module(f"{kinds.__name__}.{mod.name}")
    for name in filter(None, (s.strip() for s in os.environ.get("VEGA_LEAD_KINDS", "").split(","))):
        importlib.import_module(name)
    return KINDS


def ordered(only: list[str] | None = None) -> list[LeadKind]:
    ks = sorted(KINDS.values(), key=lambda k: (k.order, k.name))
    return [k for k in ks if only is None or k.name in only]
