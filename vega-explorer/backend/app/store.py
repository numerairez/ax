"""Dataset registry: built-in mock data plus user uploads persisted to disk."""

from __future__ import annotations

import io
import json
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .mock_data import BUILTIN

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
MAX_ROWS = 50_000


@dataclass
class Dataset:
    id: str
    name: str
    description: str
    source: str  # "builtin" | "upload"
    df: pd.DataFrame
    truncated_from: int | None = None
    fields: list[dict[str, Any]] = field(default_factory=list)

    def meta(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "source": self.source,
            "rows": len(self.df),
            "truncatedFrom": self.truncated_from,
            "fields": self.fields,
        }

    def records(self) -> list[dict[str, Any]]:
        out = self.df.copy()
        for f in self.fields:
            if f["type"] == "temporal":
                # No timezone suffix: browsers parse this as local time, which keeps
                # Vega's (local) time units aligned with the calendar date.
                out[f["name"]] = out[f["name"]].dt.strftime("%Y-%m-%dT%H:%M:%S")
        out = out.astype(object).where(pd.notna(out), None)
        return out.to_dict(orient="records")


def _infer(df: pd.DataFrame) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    df = df.copy()
    fields = []
    for col in df.columns:
        s = df[col]
        if pd.api.types.is_bool_dtype(s):
            df[col] = s.map({True: "true", False: "false"})
            kind = "nominal"
        elif pd.api.types.is_datetime64_any_dtype(s):
            df[col] = s.dt.tz_localize(None) if getattr(s.dt, "tz", None) is not None else s
            kind = "temporal"
        elif pd.api.types.is_numeric_dtype(s):
            kind = "quantitative"
        else:
            kind = "nominal"
            parsed = _try_dates(s)
            if parsed is not None:
                df[col] = parsed
                kind = "temporal"
            else:
                numeric = pd.to_numeric(s, errors="coerce")
                if s.notna().sum() and numeric.notna().sum() / s.notna().sum() > 0.95:
                    df[col] = numeric
                    kind = "quantitative"
        fields.append(_profile(col, df[col], kind))
    return df, fields


def _try_dates(s: pd.Series) -> pd.Series | None:
    sample = s.dropna().astype(str)
    if sample.empty or not sample.head(50).str.contains(r"\d{1,4}[-/.]\d{1,2}", regex=True).mean() > 0.9:
        return None
    try:
        parsed = pd.to_datetime(s, errors="coerce", format="mixed")
    except (ValueError, TypeError):
        return None
    return parsed if parsed.notna().sum() >= 0.9 * s.notna().sum() else None


def _profile(name: str, s: pd.Series, kind: str) -> dict[str, Any]:
    info: dict[str, Any] = {
        "name": name,
        "type": kind,
        "missing": int(s.isna().sum()),
        "unique": int(s.nunique(dropna=True)),
    }
    if kind == "quantitative":
        d = s.describe()
        info["stats"] = {k: _num(d.get(k)) for k in ("min", "25%", "50%", "75%", "max", "mean", "std")}
        info["integer"] = bool(pd.api.types.is_integer_dtype(s) or (s.dropna() % 1 == 0).all())
    elif kind == "temporal":
        info["stats"] = {"min": s.min().isoformat() if s.notna().any() else None, "max": s.max().isoformat() if s.notna().any() else None}
    else:
        info["top"] = [{"value": str(k), "count": int(v)} for k, v in s.value_counts().head(8).items()]
    return info


def _num(v: Any) -> float | None:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    return round(float(v), 4)


class Store:
    def __init__(self) -> None:
        self.datasets: dict[str, Dataset] = {}
        for key, (name, desc, gen) in BUILTIN.items():
            self._add(key, name, desc, "builtin", gen())
        UPLOAD_DIR.mkdir(exist_ok=True)
        for meta_path in sorted(UPLOAD_DIR.glob("*.meta.json")):
            meta = json.loads(meta_path.read_text())
            data_path = UPLOAD_DIR / meta["file"]
            try:
                df = parse_upload(data_path.name, data_path.read_bytes())
            except Exception:  # noqa: BLE001 - a broken upload shouldn't stop the server
                continue
            self._add(meta["id"], meta["name"], meta["description"], "upload", df)

    def _add(self, id_: str, name: str, desc: str, source: str, df: pd.DataFrame) -> Dataset:
        truncated = None
        if len(df) > MAX_ROWS:
            truncated = len(df)
            df = df.sample(MAX_ROWS, random_state=0).sort_index()
        df, fields = _infer(df)
        ds = Dataset(id_, name, desc, source, df.reset_index(drop=True), truncated, fields)
        self.datasets[id_] = ds
        return ds

    def add_upload(self, filename: str, content: bytes) -> Dataset:
        df = parse_upload(filename, content)
        if df.empty or len(df.columns) == 0:
            raise ValueError("The file contains no rows.")
        id_ = "up_" + uuid.uuid4().hex[:8]
        suffix = Path(filename).suffix.lower()
        (UPLOAD_DIR / f"{id_}{suffix}").write_bytes(content)
        name = Path(filename).stem.replace("_", " ").replace("-", " ").strip() or "Uploaded data"
        desc = f"Uploaded from {filename}"
        (UPLOAD_DIR / f"{id_}.meta.json").write_text(json.dumps({"id": id_, "name": name, "description": desc, "file": f"{id_}{suffix}"}))
        return self._add(id_, name, desc, "upload", df)

    def delete(self, id_: str) -> None:
        ds = self.datasets.get(id_)
        if ds is None or ds.source != "upload":
            raise KeyError(id_)
        del self.datasets[id_]
        for p in UPLOAD_DIR.glob(f"{id_}*"):
            p.unlink()


def parse_upload(filename: str, content: bytes) -> pd.DataFrame:
    return safe_column_names(_read(filename, content))


def _read(filename: str, content: bytes) -> pd.DataFrame:
    suffix = Path(filename).suffix.lower()
    if suffix in (".csv", ".txt"):
        return pd.read_csv(io.BytesIO(content), sep=None, engine="python")
    if suffix == ".tsv":
        return pd.read_csv(io.BytesIO(content), sep="\t")
    if suffix in (".json", ".jsonl", ".ndjson"):
        text = content.decode("utf-8-sig").strip()
        if suffix != ".json" or (text and text[0] != "[" and text[0] != "{"):
            return pd.read_json(io.StringIO(text), lines=True)
        data = json.loads(text)
        if isinstance(data, dict):
            # {"data": [...]} or {"col": [..], ...}
            lists = [v for v in data.values() if isinstance(v, list)]
            if len(lists) == 1 and lists[0] and isinstance(lists[0][0], dict):
                data = lists[0]
        return pd.json_normalize(data) if isinstance(data, list) else pd.DataFrame(data)
    raise ValueError(f"Unsupported file type '{suffix}'. Use CSV, TSV, JSON or JSON Lines.")


def safe_column_names(df: pd.DataFrame) -> pd.DataFrame:
    # Vega treats "." and "[]" in field names as nested access, so flatten them.
    return df.rename(columns=lambda c: re.sub(r"[.\[\]\\]", "_", re.sub(r"\s+", " ", str(c)).strip()))
