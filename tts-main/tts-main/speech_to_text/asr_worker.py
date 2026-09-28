from __future__ import annotations

import json
import sys
from pathlib import Path

MODULE_ROOT = Path(__file__).resolve().parents[1]
if str(MODULE_ROOT) not in sys.path:
    sys.path.insert(0, str(MODULE_ROOT))

from speech_to_text.hindi_asr import InvalidAudioError, ModelLoadError, TranscriptionError, initialize_model, transcribe_hindi_audio


def write_message(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> None:
    try:
        initialize_model()
        write_message({"event": "status", "status": "ready"})
    except ModelLoadError:
        write_message({"event": "status", "status": "unavailable"})

    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            request_id = request.get("id")
            audio_path = request.get("audio_path")
            if not isinstance(request_id, int) or not isinstance(audio_path, str):
                write_message({"id": request_id, "ok": False, "error": "invalid_request"})
                continue
            transcript = transcribe_hindi_audio(Path(audio_path))
            write_message({"id": request_id, "ok": True, "hindi_text": transcript})
        except ModelLoadError:
            write_message({"id": request.get("id") if isinstance(request, dict) else None, "ok": False, "error": "unavailable"})
        except InvalidAudioError:
            write_message({"id": request.get("id") if isinstance(request, dict) else None, "ok": False, "error": "invalid_audio"})
        except (TranscriptionError, OSError, ValueError):
            write_message({"id": request.get("id") if isinstance(request, dict) else None, "ok": False, "error": "transcription_failed"})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        write_message({"event": "status", "status": "unavailable"})
