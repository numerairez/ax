from __future__ import annotations

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import structure
from .engine import investigate, registry
from .store import Dataset, Store

app = FastAPI(title="Vega Explorer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

store = Store()


@app.get("/api/datasets")
def list_datasets() -> list[dict]:
    return [ds.meta() for ds in store.datasets.values()]


@app.get("/api/datasets/{dataset_id}")
def get_dataset(dataset_id: str) -> dict:
    ds = _ds(dataset_id)
    return {"meta": ds.meta(), "rows": ds.records()}


@app.post("/api/datasets")
def upload_dataset(file: UploadFile = File(...)) -> dict:
    try:
        ds = store.add_upload(file.filename or "upload.csv", file.file)
    except Exception as e:  # noqa: BLE001 - surface parse errors to the user
        raise HTTPException(400, f"Could not read {file.filename}: {e}") from e
    return ds.meta()


@app.post("/api/datasets/connect")
def connect_dataset(body: dict = Body(...)) -> dict:
    """Register a file or glob on this machine as a dataset, read in place."""
    try:
        ds = store.connect(str(body.get("path") or ""), body.get("name") or None)
    except Exception as e:  # noqa: BLE001 - surface read errors to the user
        raise HTTPException(400, f"Could not connect: {e}") from e
    return ds.meta()


@app.post("/api/datasets/{dataset_id}/refresh")
def refresh_dataset(dataset_id: str) -> dict:
    _ds(dataset_id)
    try:
        return store.refresh(dataset_id).meta()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Could not refresh: {e}") from e


@app.delete("/api/datasets/{dataset_id}")
def delete_dataset(dataset_id: str) -> dict:
    try:
        store.delete(dataset_id)
        structure.STRUCT_DIR.joinpath(f"{dataset_id}.json").unlink(missing_ok=True)
    except KeyError:
        raise HTTPException(404, "Only uploaded or connected datasets can be deleted") from None
    return {"ok": True}


@app.get("/api/lead-kinds")
def lead_kinds() -> list[dict]:
    return [{"name": k.name, "icon": k.icon, "description": k.description} for k in registry.ordered()]


def _ds(dataset_id: str) -> Dataset:
    ds = store.datasets.get(dataset_id)
    if ds is None:
        raise HTTPException(404, f"No dataset '{dataset_id}'")
    return ds


@app.get("/api/datasets/{dataset_id}/structure")
def get_structure(dataset_id: str) -> dict:
    return structure.load(_ds(dataset_id))


@app.put("/api/datasets/{dataset_id}/structure")
def put_structure(dataset_id: str, body: dict = Body(...)) -> dict:
    try:
        return structure.save(_ds(dataset_id), body)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.delete("/api/datasets/{dataset_id}/structure")
def reset_structure(dataset_id: str) -> dict:
    return structure.reset(_ds(dataset_id))


@app.post("/api/datasets/{dataset_id}/investigate")
def post_investigate(dataset_id: str, body: dict = Body(...)) -> dict:
    ds = _ds(dataset_id)
    try:
        return investigate(ds, structure.load(ds), body)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
