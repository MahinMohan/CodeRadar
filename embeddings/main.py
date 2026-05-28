import os
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from scipy.spatial.distance import cosine

MODEL_NAME = os.getenv("MODEL_NAME", "all-MiniLM-L6-v2")

app = FastAPI(title="CodeRadar Embeddings")
model: SentenceTransformer | None = None


@app.on_event("startup")
async def load_model():
    global model
    model = SentenceTransformer(MODEL_NAME)


class EmbedRequest(BaseModel):
    text: str


class EmbedBatchRequest(BaseModel):
    texts: list[str]


class SimilarityRequest(BaseModel):
    a: list[float]
    b: list[float]


@app.post("/embed")
def embed(req: EmbedRequest) -> dict:
    if model is None:
        raise HTTPException(503, "Model not loaded")
    vec = model.encode(req.text, normalize_embeddings=True)
    return {"embedding": vec.tolist()}


@app.post("/embed/batch")
def embed_batch(req: EmbedBatchRequest) -> dict:
    if model is None:
        raise HTTPException(503, "Model not loaded")
    vecs = model.encode(req.texts, normalize_embeddings=True, batch_size=32)
    return {"embeddings": [v.tolist() for v in vecs]}


@app.post("/similarity")
def similarity(req: SimilarityRequest) -> dict:
    score = 1.0 - cosine(np.array(req.a), np.array(req.b))
    return {"score": float(score)}


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
