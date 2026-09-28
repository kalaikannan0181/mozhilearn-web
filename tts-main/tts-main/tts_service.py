from __future__ import annotations

import json
import os
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = Path(os.environ.get("TTS_MODEL_DIR", Path(__file__).resolve().parent / "TTS")).resolve()
AUDIO_ROOT = Path(os.environ.get("TTS_AUDIO_ROOT", PROJECT_ROOT / "public" / "audio" / "mundari")).resolve()
HOST = os.environ.get("TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("TTS_PORT", "5100"))
REQUIRED_PACKAGES = ["torch", "transformers", "scipy", "numpy"]

model = None
tokenizer = None
model_error = ""


def model_weights_present() -> bool:
    return any(MODEL_DIR.glob("model.safetensors")) or any(MODEL_DIR.glob("pytorch_model.bin"))


def tokenizer_present() -> bool:
    files = {path.name.lower() for path in MODEL_DIR.iterdir()} if MODEL_DIR.exists() else set()
    return any(
        file_name in files
        for file_name in {
            "tokenizer_config.json",
            "tokenizer.json",
            "vocab.json",
            "merges.txt",
            "sentencepiece.model",
            "spiece.model",
        }
    )


def missing_python_packages() -> list[str]:
    missing: list[str] = []
    for package in REQUIRED_PACKAGES:
        try:
            __import__(package)
        except Exception:
            missing.append(package)
    return missing


def diagnostics_payload() -> dict:
    model_files = sorted([path.name for path in MODEL_DIR.iterdir()]) if MODEL_DIR.exists() else []
    checkpoint_found = model_weights_present()
    tokenizer_found = tokenizer_present()
    missing_packages = missing_python_packages()
    status = "ready" if checkpoint_found and tokenizer_found and not missing_packages else "unavailable"
    message = (
        "Mundari TTS unavailable: model weights missing."
        if not checkpoint_found
        else "Mundari TTS unavailable: tokenizer missing."
        if not tokenizer_found
        else f"Mundari TTS unavailable: missing Python packages: {', '.join(missing_packages)}."
        if missing_packages
        else "Mundari TTS is ready to serve audio."
    )
    return {
        "success": True,
        "status": status,
        "available": status == "ready",
        "modelId": "facebook/mms-tts-unr",
        "modelDir": str(MODEL_DIR),
        "modelFiles": model_files,
        "checkpointFound": checkpoint_found,
        "tokenizerFound": tokenizer_found,
        "requiredPythonPackages": REQUIRED_PACKAGES,
        "missingDependencies": missing_packages,
        "currentTtsEntryPoint": str(Path(__file__).resolve()),
        "currentExpressEndpoint": "/api/tts",
        "currentFrontendEntryPoint": "src/main.tsx -> src/App.tsx",
        "hardCodedPaths": [],
        "message": message,
    }


def load_model() -> None:
    global model, tokenizer, model_error
    if not model_weights_present():
        model_error = "Mundari TTS unavailable: model weights missing."
        return

    try:
        from transformers import AutoTokenizer, VitsModel

        tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), local_files_only=True)
        model = VitsModel.from_pretrained(str(MODEL_DIR), local_files_only=True)
        model.eval()
    except Exception as exc:
        model_error = f"Mundari TTS model could not be loaded: {exc}"


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class TtsHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path in {"/health", "/status"}:
            payload = diagnostics_payload()
            json_response(self, 200, payload)
            return
        json_response(self, 404, {"success": False, "message": "TTS endpoint not found."})

    def do_POST(self) -> None:
        if self.path not in {"/tts", "/synthesize"}:
            json_response(self, 404, {"success": False, "message": "TTS endpoint not found."})
            return

        try:
            size = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(size))
        except (ValueError, json.JSONDecodeError):
            json_response(self, 400, {"success": False, "status": "unavailable", "message": "Invalid JSON request."})
            return

        text = payload.get("tts_input", "") if isinstance(payload, dict) else ""
        if not isinstance(text, str) or not text.strip():
            json_response(self, 400, {"success": False, "status": "unavailable", "message": "Model-compatible tts_input is required."})
            return

        report = diagnostics_payload()
        if report["status"] != "ready":
            json_response(self, 503, {"success": False, **report, "status": "unavailable", "message": report["message"]})
            return

        if model is None or tokenizer is None:
            json_response(self, 503, {"success": False, "status": "unavailable", "message": model_error or "Mundari TTS model is unavailable."})
            return

        try:
            import scipy.io.wavfile as wav
            import torch

            inputs = tokenizer(text.strip(), return_tensors="pt")
            unknown_id = getattr(tokenizer, "unk_token_id", None)
            input_ids = inputs["input_ids"]
            if input_ids.numel() == 0 or (unknown_id is not None and int((input_ids == unknown_id).sum()) > 0):
                json_response(self, 422, {"success": False, "status": "unavailable", "message": "The Mundari MMS tokenizer did not accept this tts_input. Supply model-native Odia-script text."})
                return

            with torch.no_grad():
                waveform = model(**inputs).waveform
            values = waveform.detach().cpu().numpy()
            AUDIO_ROOT.mkdir(parents=True, exist_ok=True)
            filename = f"{uuid.uuid4().hex}.wav"
            wav.write(str(AUDIO_ROOT / filename), int(model.config.sampling_rate), values[0].astype("float32"))
            json_response(self, 200, {"success": True, "status": "ready", "mode": "model", "available": True, "audioUrl": f"/api/tts/audio/mundari/{filename}", "message": "Verified Mundari audio generated."})
        except Exception as exc:
            json_response(self, 500, {"success": False, "status": "unavailable", "message": f"Mundari TTS synthesis failed: {exc}"})


if __name__ == "__main__":
    load_model()
    print(f"Mundari TTS service listening on {HOST}:{PORT}; model_loaded={model is not None}; status={diagnostics_payload()['status']}")
    ThreadingHTTPServer((HOST, PORT), TtsHandler).serve_forever()