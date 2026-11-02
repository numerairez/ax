"""DuckDB connection and SQL helpers. Every dataset is a table (or, for connected
files, a view) and the engine pushes filtering and aggregation down to it."""

from __future__ import annotations

import os
import threading
from datetime import datetime

import duckdb
import pandas as pd

# In-memory by default: uploads are re-imported from their files on startup.
_con = duckdb.connect(os.environ.get("VEGA_DB", ":memory:"))
_con.execute("SET TimeZone = 'UTC'")
_local = threading.local()


def cursor() -> duckdb.DuckDBPyConnection:
    """One cursor per thread: FastAPI runs sync endpoints on a thread pool."""
    cur = getattr(_local, "cur", None)
    if cur is None:
        cur = _local.cur = _con.cursor()
    return cur


def df(sql: str) -> pd.DataFrame:
    return cursor().execute(sql).df()


def one(sql: str) -> tuple:
    return cursor().execute(sql).fetchone()


def execute(sql: str) -> None:
    cursor().execute(sql)


def ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def lit(v: object) -> str:
    """A SQL literal. Values are inlined (not bound) so WHERE clauses compose freely."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        f = float(v)
        if f != f or f in (float("inf"), float("-inf")):
            return "NULL"
        return repr(int(v)) if isinstance(v, int) else repr(f)
    if isinstance(v, (pd.Timestamp, datetime)):
        return f"TIMESTAMP '{pd.Timestamp(v).strftime('%Y-%m-%d %H:%M:%S')}'"
    return "'" + str(v).replace("'", "''") + "'"
