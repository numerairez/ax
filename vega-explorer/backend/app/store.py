"""Dataset registry backed by DuckDB: built-in mock data, uploaded files and
connected files (read in place, so they pick up changes on refresh)."""

from __future__ import annotations

import io
import json
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from . import db
from .db import ident, lit
from .mock_data import BUILTIN

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
# The chart library renders in the browser, so it gets a sample; the engine sees every row.
SAMPLE_ROWS = 50_000
READABLE = (".csv", ".txt", ".tsv", ".json", ".jsonl", ".ndjson", ".parquet")
_INT = {"TINYINT", "SMALLINT", "INTEGER", "BIGINT", "UTINYINT", "USMALLINT", "UINTEGER"}
_NUM = _INT | {"UBIGINT", "HUGEINT", "UHUGEINT", "FLOAT", "DOUBLE", "REAL"}
_DATE_FORMATS = "['%Y/%m/%d', '%m/%d/%Y', '%d/%m/%Y', '%Y/%m/%d %H:%M:%S', '%m/%d/%Y %H:%M', '%d.%m.%Y']"


@dataclass
class Dataset:
    id: str
    name: str
    description: str
    source: str  # "builtin" | "upload" | "connected"
    table: str
    rows: int = 0
    fields: list[dict[str, Any]] = field(default_factory=list)
    types: dict[str, str] = field(default_factory=dict)  # DuckDB column types
    location: str | None = None

    @property
    def sql(self) -> str:
        return ident(self.table)

    def meta(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "source": self.source,
            "rows": self.rows,
            "sampled": SAMPLE_ROWS if self.rows > SAMPLE_ROWS else None,
            "location": self.location,
            "fields": self.fields,
        }

    def records(self, limit: int = SAMPLE_ROWS) -> list[dict[str, Any]]:
        if self.rows > limit:
            out = db.df(
                f"SELECT * EXCLUDE (__r) FROM (SELECT *, row_number() OVER () AS __r FROM {self.sql}) "
                f"USING SAMPLE reservoir({int(limit)} ROWS) REPEATABLE (0) ORDER BY __r"
            )
        else:
            out = db.df(f"SELECT * FROM {self.sql}")
        for f in self.fields:
            if f["type"] == "temporal":
                # No timezone suffix: browsers parse this as local time, which keeps
                # Vega's (local) time units aligned with the calendar date.
                out[f["name"]] = out[f["name"]].dt.strftime("%Y-%m-%dT%H:%M:%S")
        out = out.astype(object).where(pd.notna(out), None)
        return out.to_dict(orient="records")

    def frame(self) -> pd.DataFrame:
        """The whole table as pandas. Only for small, local use (tests, scripts)."""
        return db.df(f"SELECT * FROM {self.sql}")


# ---------------------------------------------------------------------------
# loading: any source -> a typed table with safe column names
# ---------------------------------------------------------------------------


def _source_sql(path: Path | str) -> str:
    suffix = Path(str(path)).suffix.lower()
    q = lit(str(path))
    if suffix in (".csv", ".txt"):
        return f"read_csv({q}, sample_size = 20480, union_by_name = true)"
    if suffix == ".tsv":
        return f"read_csv({q}, delim = '\\t', sample_size = 20480, union_by_name = true)"
    if suffix in (".jsonl", ".ndjson"):
        return f"read_json_auto({q}, format = 'newline_delimited', union_by_name = true)"
    if suffix == ".json":
        return f"read_json_auto({q}, union_by_name = true)"
    if suffix == ".parquet":
        return f"read_parquet({q}, union_by_name = true)"
    raise ValueError(f"Unsupported file type '{suffix}'. Use CSV, TSV, JSON, JSON Lines or Parquet.")


def safe_name(c: str) -> str:
    # Vega treats "." and "[]" in field names as nested access, so flatten them.
    return re.sub(r"[.\[\]\\]", "_", re.sub(r"\s+", " ", str(c)).strip())


def _materialize(table: str, source: str, view: bool = False) -> None:
    """Create `table` from a source relation, normalizing types the way the app expects:
    temporal -> TIMESTAMP, numeric -> number, text that is really dates/numbers -> parsed,
    booleans and nested values -> text."""
    cols = db.df(f"DESCRIBE SELECT * FROM {source}")[["column_name", "column_type"]].itertuples(index=False)
    cols = list(cols)
    text = [c for c, t in cols if t == "VARCHAR"]
    parsed: dict[str, str] = {}
    if text:
        # How much of each text column parses as a date or a number?
        probes = []
        for c in text:
            q = ident(c)
            probes += [
                f"count({q})",
                f"count(coalesce(TRY_CAST({q} AS TIMESTAMP), try_strptime({q}, {_DATE_FORMATS})))",
                f"count(TRY_CAST({q} AS DOUBLE))",
            ]
        counts = db.one(f"SELECT {', '.join(probes)} FROM {source}")
        heads = db.one(
            "SELECT "
            + ", ".join(f"avg(regexp_matches({ident(c)}, '\\d{{1,4}}[-/.]\\d{{1,2}}')::INT)" for c in text)
            + f" FROM (SELECT * FROM {source} LIMIT 200)"
        )
        for i, c in enumerate(text):
            n, n_date, n_num = counts[3 * i : 3 * i + 3]
            if n and (heads[i] or 0) > 0.9 and n_date >= 0.9 * n:
                q = ident(c)
                parsed[c] = f"coalesce(TRY_CAST({q} AS TIMESTAMP), try_strptime({q}, {_DATE_FORMATS}))"
            elif n and n_num / n > 0.95:
                parsed[c] = f"TRY_CAST({ident(c)} AS DOUBLE)"
    select = []
    for c, t in cols:
        q = ident(c)
        base = t.split("(")[0]
        if c in parsed:
            expr = parsed[c]
        elif base in ("TIMESTAMP", "DATE", "TIMESTAMP_NS", "TIMESTAMP_MS", "TIMESTAMP_S") or base.startswith("TIMESTAMP"):
            expr = f"CAST({q} AS TIMESTAMP)"
        elif base == "BOOLEAN":
            expr = f"CASE WHEN {q} THEN 'true' WHEN NOT {q} THEN 'false' END"
        elif base in _INT:
            expr = q
        elif base in _NUM or base == "DECIMAL":
            expr = f"CAST({q} AS DOUBLE)"
        elif base == "VARCHAR":
            expr = q
        else:
            expr = f"CAST({q} AS VARCHAR)"
        select.append(f"{expr} AS {ident(safe_name(c))}")
    kind = "VIEW" if view else "TABLE"
    db.execute(f"CREATE OR REPLACE {kind} {ident(table)} AS SELECT {', '.join(select)} FROM {source}")


def _profile(ds: Dataset) -> None:
    desc = db.df(f"DESCRIBE {ds.sql}")
    ds.types = dict(zip(desc["column_name"], desc["column_type"]))
    kinds = {}
    for c, t in ds.types.items():
        base = t.split("(")[0]
        kinds[c] = "temporal" if base.startswith("TIMESTAMP") else "quantitative" if base in _NUM else "nominal"
    aggs = ["count(*)"]
    for c, k in kinds.items():
        q = ident(c)
        aggs += [f"count(*) - count({q})", f"count(DISTINCT {q})"]
        if k == "quantitative":
            aggs += [f"min({q})", f"quantile_cont({q}, 0.25)", f"median({q})", f"quantile_cont({q}, 0.75)", f"max({q})",
                     f"avg({q})", f"stddev_samp({q})", f"coalesce(bool_and({q} = floor({q})), true)"]
        elif k == "temporal":
            aggs += [f"min({q})", f"max({q})"]
    vals = list(db.one(f"SELECT {', '.join(aggs)} FROM {ds.sql}"))
    ds.rows = int(vals.pop(0))
    fields = []
    for c, k in kinds.items():
        info: dict[str, Any] = {"name": c, "type": k, "missing": int(vals.pop(0)), "unique": int(vals.pop(0))}
        if k == "quantitative":
            stats = [vals.pop(0) for _ in range(7)]
            info["stats"] = {key: _num(v) for key, v in zip(("min", "25%", "50%", "75%", "max", "mean", "std"), stats)}
            whole = vals.pop(0)
            info["integer"] = bool(ds.types[c].split("(")[0] in _INT or whole)
        elif k == "temporal":
            lo, hi = vals.pop(0), vals.pop(0)
            info["stats"] = {"min": lo.isoformat() if lo else None, "max": hi.isoformat() if hi else None}
        else:
            top = db.df(f"SELECT CAST({ident(c)} AS VARCHAR) AS v, count(*) AS n FROM {ds.sql} WHERE {ident(c)} IS NOT NULL "
                        f"GROUP BY 1 ORDER BY n DESC, v LIMIT 8")
            info["top"] = [{"value": v, "count": int(n)} for v, n in zip(top["v"], top["n"])]
        fields.append(info)
    ds.fields = fields


def _num(v: Any) -> float | None:
    if v is None or (isinstance(v, float) and v != v):
        return None
    return round(float(v), 4)


def _table_name(id_: str) -> str:
    return "ds_" + re.sub(r"[^A-Za-z0-9_]", "_", id_)


class Store:
    def __init__(self) -> None:
        self.datasets: dict[str, Dataset] = {}
        for key, (name, desc, gen) in BUILTIN.items():
            ds = Dataset(key, name, desc, "builtin", _table_name(key))
            frame = gen()
            db.cursor().register("__import", frame)
            try:
                _materialize(ds.table, "__import")
            finally:
                db.cursor().unregister("__import")
            self._register(ds)
        UPLOAD_DIR.mkdir(exist_ok=True)
        for meta_path in sorted(UPLOAD_DIR.glob("*.meta.json")):
            meta = json.loads(meta_path.read_text())
            try:
                self._load_saved(meta)
            except Exception:  # noqa: BLE001 - a broken upload shouldn't stop the server
                continue

    def _register(self, ds: Dataset) -> Dataset:
        _profile(ds)
        self.datasets[ds.id] = ds
        return ds

    def _load_saved(self, meta: dict) -> Dataset:
        if meta.get("path"):  # connected: a view over files read in place
            ds = Dataset(meta["id"], meta["name"], meta["description"], "connected", _table_name(meta["id"]), location=meta["path"])
            _materialize(ds.table, _source_sql(meta["path"]), view=True)
        else:
            ds = Dataset(meta["id"], meta["name"], meta["description"], "upload", _table_name(meta["id"]))
            _import_file(ds.table, UPLOAD_DIR / meta["file"])
        return self._register(ds)

    def add_upload(self, filename: str, stream: io.BufferedIOBase | io.BytesIO) -> Dataset:
        suffix = Path(filename).suffix.lower()
        if suffix not in READABLE:
            raise ValueError(f"Unsupported file type '{suffix}'. Use CSV, TSV, JSON, JSON Lines or Parquet.")
        id_ = "up_" + uuid.uuid4().hex[:8]
        path = UPLOAD_DIR / f"{id_}{suffix}"
        with path.open("wb") as out:
            while chunk := stream.read(1 << 20):
                out.write(chunk)
        name = Path(filename).stem.replace("_", " ").replace("-", " ").strip() or "Uploaded data"
        meta = {"id": id_, "name": name, "description": f"Uploaded from {filename}", "file": path.name}
        try:
            ds = self._load_saved(meta)
            if ds.rows == 0 or not ds.fields:
                raise ValueError("The file contains no rows.")
        except Exception:
            path.unlink(missing_ok=True)
            self.datasets.pop(id_, None)
            raise
        (UPLOAD_DIR / f"{id_}.meta.json").write_text(json.dumps(meta))
        return ds

    def connect(self, path: str, name: str | None = None) -> Dataset:
        """Register files on this machine (a path or a glob like /data/*.parquet) without copying them."""
        p = Path(path).expanduser()
        if Path(p.name).suffix.lower() not in READABLE:
            raise ValueError(f"Unsupported file type. Use one of: {', '.join(READABLE)}")
        if "*" not in str(p) and not p.is_file():
            raise ValueError(f"No such file: {p}")
        id_ = "cx_" + uuid.uuid4().hex[:8]
        label = name or p.stem.replace("*", "").replace("_", " ").replace("-", " ").strip() or "Connected data"
        meta = {"id": id_, "name": label, "description": f"Connected to {p}", "path": str(p)}
        ds = self._load_saved(meta)
        (UPLOAD_DIR / f"{id_}.meta.json").write_text(json.dumps(meta))
        return ds

    def refresh(self, id_: str) -> Dataset:
        """Re-read a connected or uploaded dataset's files and re-profile it."""
        ds = self.datasets[id_]
        if ds.source == "builtin":
            return ds
        meta_path = UPLOAD_DIR / f"{id_}.meta.json"
        return self._load_saved(json.loads(meta_path.read_text()))

    def delete(self, id_: str) -> None:
        ds = self.datasets.get(id_)
        if ds is None or ds.source == "builtin":
            raise KeyError(id_)
        del self.datasets[id_]
        db.execute(f"DROP {'VIEW' if ds.source == 'connected' else 'TABLE'} IF EXISTS {ds.sql}")
        for p in UPLOAD_DIR.glob(f"{id_}*"):
            p.unlink()


def _import_file(table: str, path: Path) -> None:
    if path.suffix.lower() == ".json":
        # Plain JSON comes in many shapes ({"data": [...]}, column dicts, nested records):
        # pandas normalizes those better than a SQL reader.
        frame = _read_json(path.read_bytes())
        db.cursor().register("__import", frame)
        try:
            _materialize(table, "__import")
        finally:
            db.cursor().unregister("__import")
        return
    _materialize(table, _source_sql(path))


def _read_json(content: bytes) -> pd.DataFrame:
    text = content.decode("utf-8-sig").strip()
    if text and text[0] not in "[{":
        return pd.read_json(io.StringIO(text), lines=True)
    data = json.loads(text)
    if isinstance(data, dict):
        # {"data": [...]} or {"col": [..], ...}
        lists = [v for v in data.values() if isinstance(v, list)]
        if len(lists) == 1 and lists[0] and isinstance(lists[0][0], dict):
            data = lists[0]
    return pd.json_normalize(data) if isinstance(data, list) else pd.DataFrame(data)
