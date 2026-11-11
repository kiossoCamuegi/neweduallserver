import os
import asyncio
from pathlib import Path
from functools import lru_cache

MODEL_ROOT = Path(__file__).resolve().parents[1] / "models" / "huggingface"
os.environ.setdefault("HF_HOME", str(MODEL_ROOT))
os.environ.setdefault("TORCH_HOME", str(MODEL_ROOT.parent / "torch"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from detoxify import Detoxify
import torch


MODEL_NAME = os.getenv("TOXICITY_MODEL", "multilingual")
MAX_LENGTH = int(os.getenv("TOXICITY_MAX_LENGTH", "3000"))
TORCH_THREADS = max(1, int(os.getenv("TOXICITY_TORCH_THREADS", "2")))
MODEL_LOCK = asyncio.Lock()

torch.set_num_threads(TORCH_THREADS)
try:
    torch.set_num_interop_threads(1)
except RuntimeError:
    pass


class AnalyzeRequest(BaseModel):
    text: str = Field(default="", max_length=MAX_LENGTH)


app = FastAPI(title="Eduall Local Toxicity Analyzer", version="1.0")


@lru_cache(maxsize=1)
def model():
    return Detoxify(MODEL_NAME, device=os.getenv("TOXICITY_DEVICE", "cpu"))


@app.on_event("startup")
def warm_model():
    model().predict("texto de exemplar seguro")


@app.get("/health")
def health():
    try:
        model()
        return {"ready": True, "model": MODEL_NAME}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/analyze")
async def analyze(payload: AnalyzeRequest):
    text = payload.text.strip()
    if not text:
        return {"toxicity": 0.0, "scores": {"toxicity": 0.0}, "model": MODEL_NAME, "version": "0.5.4"}
    try:
        async with MODEL_LOCK:
            raw = await asyncio.to_thread(model().predict, text)
        scores = {str(key): float(value) for key, value in raw.items()}
        return {
            "toxicity": scores.get("toxicity", 0.0),
            "scores": scores,
            "model": f"detoxify-{MODEL_NAME}",
            "version": "0.5.4",
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Falha na análise local: {exc}") from exc
