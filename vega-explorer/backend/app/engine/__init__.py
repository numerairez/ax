"""Lead engine: given an investigation context (a filter path), score candidate
next views and explain why each one is interesting. See core.py for the context
and registry.py for adding lead kinds."""

from . import registry
from .core import MAX_VALUES, PERIOD, Engine, Measure, investigate
from .registry import lead_kind

registry.load()

__all__ = ["MAX_VALUES", "PERIOD", "Engine", "Measure", "investigate", "lead_kind"]
