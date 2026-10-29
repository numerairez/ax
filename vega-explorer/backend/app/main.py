from __future__ import annotations

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import structure
from .investigate import investigate
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
    ds = store.datasets.get(dataset_id)
    if ds is None:
        raise HTTPException(404, f"No dataset '{dataset_id}'")
    return {"meta": ds.meta(), "rows": ds.records()}


@app.post("/api/datasets")
async def upload_dataset(file: UploadFile = File(...)) -> dict:
    content = await file.read()
    try:
        ds = store.add_upload(file.filename or "upload.csv", content)
    except Exception as e:  # noqa: BLE001 - surface parse errors to the user
        raise HTTPException(400, f"Could not read {file.filename}: {e}") from e
    return ds.meta()


@app.delete("/api/datasets/{dataset_id}")
def delete_dataset(dataset_id: str) -> dict:
    try:
        store.delete(dataset_id)
        structure.STRUCT_DIR.joinpath(f"{dataset_id}.json").unlink(missing_ok=True)
    except KeyError:
        raise HTTPException(404, "Only uploaded datasets can be deleted") from None
    return {"ok": True}


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
    return investigate(ds, structure.load(ds), body)
