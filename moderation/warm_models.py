"""Descarrega e valida os modelos locais durante a instalação."""

from pathlib import Path
import os

from huggingface_hub import snapshot_download


ROOT = Path(__file__).resolve().parents[1]
MODELS = Path(os.getenv("MODERATION_MODELS_DIR", ROOT / "models")).resolve()
CLIP_DIR = MODELS / "clip-vit-base-patch32"
CLIP_REVISION = os.getenv(
    "MODERATION_CLIP_REVISION",
    "6b7c523703ae26e39be4b03774966f8571c7f523",
)


def download_clip():
    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id="Xenova/clip-vit-base-patch32",
        revision=CLIP_REVISION,
        local_dir=CLIP_DIR,
        allow_patterns=[
            "config.json",
            "preprocessor_config.json",
            "special_tokens_map.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "vocab.json",
            "merges.txt",
            "onnx/model_quantized.onnx",
        ],
    )
    required = [CLIP_DIR / "config.json", CLIP_DIR / "onnx" / "model_quantized.onnx"]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError(f"Modelo CLIP incompleto: {', '.join(missing)}")


def warm_toxicity():
    os.environ["HF_HOME"] = str(MODELS / "huggingface")
    os.environ["TRANSFORMERS_CACHE"] = str(MODELS / "huggingface" / "hub")
    os.environ["TORCH_HOME"] = str(MODELS / "torch")
    os.environ.pop("HF_HUB_OFFLINE", None)
    os.environ.pop("TRANSFORMERS_OFFLINE", None)
    from detoxify import Detoxify

    Detoxify("multilingual", device="cpu").predict("texto de exemplar seguro")


if __name__ == "__main__":
    download_clip()
    warm_toxicity()
    print(f"Modelos locais prontos em {MODELS}")
