from __future__ import annotations

import json
import os
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = Path(os.environ.get("TTS_MODEL_DIR", Path(__file__).resolve().parent / "TTS"))
AUDIO_ROOT = Path(os.environ.get("TTS_AUDIO_ROOT", PROJECT_ROOT / "public" / "audio" / "mundari"))
PORT = int(os.environ.get("TTS_PORT", "5100"))

model = None
tokenizer = None
model_error = ""


def model_weights_present() -> bool:
    return any(MODEL_DIR.glob("model.safetensors")) or any(MODEL_DIR.glob("pytorch_model.bin"))


def load_model() -> None:
    global model, tokenizer, model_error
    if not model_weights_present():
        model_error = "Mundari TTS model weights are missing."
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
        if self.path != "/health":
            json_response(self, 404, {"success": False, "message": "TTS endpoint not found."})
            return
        json_response(self, 200, {
            "success": True,
            "available": model is not None,
            "weightsPresent": model_weights_present(),
            "message": "Mundari TTS model is loaded." if model is not None else model_error,
        })

    def do_POST(self) -> None:
        if self.path != "/synthesize":
            json_response(self, 404, {"success": False, "message": "TTS endpoint not found."})
            return

        try:
            size = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(size))
        except (ValueError, json.JSONDecodeError):
            json_response(self, 400, {"success": False, "message": "Invalid JSON request."})
            return

        text = payload.get("tts_input", "") if isinstance(payload, dict) else ""
        if not isinstance(text, str) or not text.strip():
            json_response(self, 400, {"success": False, "message": "Model-compatible tts_input is required."})
            return
        if model is None or tokenizer is None:
            json_response(self, 503, {"success": False, "message": model_error or "Mundari TTS model is unavailable."})
            return

        try:
            import scipy.io.wavfile as wav
            import torch

            inputs = tokenizer(text.strip(), return_tensors="pt")
            unknown_id = getattr(tokenizer, "unk_token_id", None)
            input_ids = inputs["input_ids"]
            if input_ids.numel() == 0 or (unknown_id is not None and int((input_ids == unknown_id).sum()) > 0):
                json_response(self, 422, {"success": False, "message": "The Mundari MMS tokenizer did not accept this tts_input. Supply model-native Odia-script text."})
                return

            with torch.no_grad():
                waveform = model(**inputs).waveform
            values = waveform.detach().cpu().numpy()
            AUDIO_ROOT.mkdir(parents=True, exist_ok=True)
            filename = f"{uuid.uuid4().hex}.wav"
            wav.write(str(AUDIO_ROOT / filename), int(model.config.sampling_rate), values[0].astype("float32"))
            json_response(self, 200, {"success": True, "mode": "model", "available": True, "audioUrl": f"/api/tts/audio/mundari/{filename}", "message": "Verified Mundari audio generated."})
        except Exception as exc:
            json_response(self, 500, {"success": False, "message": f"Mundari TTS synthesis failed: {exc}"})


if __name__ == "__main__":
    load_model()
    print(f"Mundari TTS service listening on port {PORT}; model_loaded={model is not None}")
    ThreadingHTTPServer(("127.0.0.1", PORT), TtsHandler).serve_forever()