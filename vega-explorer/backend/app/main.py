"""Narra's API, and the built frontend when frontend/dist exists.

Run the whole app with:

    python backend/app/main.py [--port 8000] [--host 127.0.0.1] [--no-browser]

(after `npm run build` in frontend/). For frontend development, run Vite's dev server
instead; it proxies /api to this server.
"""

from __future__ import annotations

if __name__ == "__main__":
    # Run as a script, this file isn't part of the `app` package and its relative imports
    # would fail, so put backend/ on the path and let uvicorn import it as app.main.
    import argparse
    import sys
    import threading
    import webbrowser
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    parser = argparse.ArgumentParser(prog="narra", description="Run Narra: the API and the built frontend on one port.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    args = parser.parse_args()
    try:
        import uvicorn
    except ImportError:
        sys.exit("Narra needs its Python packages first:  pip install -r backend/requirements.txt")
    url = f"http://{'localhost' if args.host in ('127.0.0.1', '0.0.0.0') else args.host}:{args.port}"
    print(f"Narra is starting at {url}  (Ctrl+C to stop)", flush=True)
    if not args.no_browser:
        threading.Timer(2.5, webbrowser.open, [url]).start()
    uvicorn.run("app.main:app", host=args.host, port=args.port)
    sys.exit(0)

from pathlib import Path

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from . import structure
from .engine import core, investigate, registry
from .store import SAMPLE_ROWS, Dataset, Store

app = FastAPI(title="Narra API")
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


@app.get("/api/method")
def method() -> dict:
    """The ranking constants and registered lead kinds, for the "How it works" page."""
    return {
        "strengths": [{"name": n, "pBelow": below, "factor": f} for n, below, f in core.STRENGTHS],
        "descriptiveFactor": core.DESCRIPTIVE_FACTOR,
        "seenPenalty": core.SEEN_PENALTY,
        "menuSize": core.MENU_SIZE,
        "smallSelection": core.SMALL_SELECTION,
        "maxValues": core.MAX_VALUES,
        "sampleRows": SAMPLE_ROWS,
        "kinds": [{"name": k.name, "icon": k.icon, "order": k.order, "quota": k.quota, "description": k.description} for k in registry.ordered()],
    }


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


# The built frontend (`npm run build` in frontend/), served from the same port as the API.
# Mounted last so every /api route above takes precedence.
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if (DIST / "index.html").exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")
else:

    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    def frontend_missing() -> str:
        return (
            "<h1>Narra</h1><p>The API is running, but the frontend hasn't been built yet. Run "
            "<code>npm install</code> and <code>npm run build</code> in <code>frontend/</code>, then reload this page.</p>"
        )
