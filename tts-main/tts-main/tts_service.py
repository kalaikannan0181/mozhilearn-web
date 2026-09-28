from __future__ import annotations

import base64
import importlib.util
import io
import json
import os
import threading
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MODEL_DIR = Path(os.environ.get("TTS_MODEL_DIR", Path(__file__).resolve().parent / "TTS")).resolve()
HOST = os.environ.get("TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("TTS_PORT", "5100"))
REQUIRED_PACKAGES = ["torch", "transformers", "scipy", "numpy"]

model = None
tokenizer = None
model_error = ""
inference_lock = threading.Lock()


def model_weights_present() -> bool:
    patterns = ("model.safetensors", "model-*.safetensors", "pytorch_model.bin", "pytorch_model-*.bin")
    return any(any(MODEL_DIR.glob(pattern)) for pattern in patterns)


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
    return [package for package in REQUIRED_PACKAGES if importlib.util.find_spec(package) is None]


def diagnostics_payload() -> dict:
    checkpoint_found = model_weights_present()
    tokenizer_found = tokenizer_present()
    missing_packages = missing_python_packages()
    status = "ready" if model is not None and tokenizer is not None else "model_missing" if not checkpoint_found else "model_load_failed"
    if not checkpoint_found:
        message = "Mundari TTS unavailable: model weights missing."
    elif not tokenizer_found:
        status = "model_load_failed"
        message = "Mundari TTS unavailable: tokenizer files missing."
    elif missing_packages:
        status = "model_load_failed"
        message = "Mundari TTS unavailable: required Python packages are missing."
    elif model_error:
        status = "model_load_failed"
        message = "Mundari TTS unavailable: model could not be loaded."
    else:
        message = "Mundari TTS model is ready." if status == "ready" else "Mundari TTS model is loading."
    return {
        "success": status == "ready",
        "status": status,
        "available": status == "ready",
        "modelId": "facebook/mms-tts-unr",
        "checkpointFound": checkpoint_found,
        "tokenizerFound": tokenizer_found,
        "requiredPythonPackages": REQUIRED_PACKAGES,
        "missingDependencies": missing_packages,
        "inputScript": "Odia",
        "currentExpressEndpoint": "/api/tts",
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
        model_error = str(exc)


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
            if size <= 0 or size > 16384:
                json_response(self, 400, {"success": False, "status": "invalid_input", "message": "Request body must be at most 16 KB."})
                return
            payload = json.loads(self.rfile.read(size))
        except (ValueError, json.JSONDecodeError):
            json_response(self, 400, {"success": False, "status": "unavailable", "message": "Invalid JSON request."})
            return

        if not isinstance(payload, dict):
            json_response(self, 400, {"success": False, "status": "invalid_input", "message": "A JSON object is required."})
            return

        text = payload.get("tts_input", "")
        if not isinstance(text, str) or not text.strip() or len(text) > 2000:
            json_response(self, 400, {"success": False, "status": "invalid_input", "message": "Model-compatible tts_input of 1 to 2000 characters is required."})
            return
        if payload.get("tts_input_script") != "Odia":
            json_response(self, 400, {"success": False, "status": "invalid_input", "message": "tts_input_script must be Odia."})
            return
        if not any(character.isalpha() for character in text) or any(
            not character.isspace()
            and "ORIYA" not in unicodedata.name(character, "")
            and character not in ".,!?'-"
            for character in text
        ):
            json_response(self, 400, {"success": False, "status": "invalid_input", "message": "tts_input must contain only model-supported Odia script text."})
            return

        report = diagnostics_payload()
        if not report["available"]:
            reason = "model_missing" if not report["checkpointFound"] else "model_load_failed"
            json_response(self, 503, {"success": False, "available": False, "reason": reason, "status": report["status"], "message": report["message"]})
            return

        if model is None or tokenizer is None:
            json_response(self, 503, {"success": False, "available": False, "reason": "model_load_failed", "status": "model_load_failed", "message": "Mundari TTS model is unavailable."})
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

            with inference_lock, torch.no_grad():
                waveform = model(**inputs).waveform
            values = waveform.detach().cpu().numpy()
            audio_buffer = io.BytesIO()
            wav.write(audio_buffer, int(model.config.sampling_rate), values[0].astype("float32"))
            json_response(self, 200, {"success": True, "status": "success", "mode": "model", "available": True, "audio_base64": base64.b64encode(audio_buffer.getvalue()).decode("ascii"), "format": "wav", "modelId": "facebook/mms-tts-unr"})
        except Exception:
            json_response(self, 500, {"success": False, "available": False, "status": "synthesis_failed", "reason": "synthesis_failed", "message": "Mundari TTS synthesis failed."})


if __name__ == "__main__":
    load_model()
    print(f"Mundari TTS service listening on {HOST}:{PORT}; model_loaded={model is not None}; status={diagnostics_payload()['status']}")
    ThreadingHTTPServer((HOST, PORT), TtsHandler).serve_forever()