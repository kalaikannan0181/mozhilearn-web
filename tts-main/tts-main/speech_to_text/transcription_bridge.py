from __future__ import annotations

import json
import sys
from pathlib import Path

MODULE_ROOT = Path(__file__).resolve().parents[1]
if str(MODULE_ROOT) not in sys.path:
    sys.path.insert(0, str(MODULE_ROOT))

from speech_to_text.hindi_asr import transcribe_hindi_audio


def main() -> None:
    if len(sys.argv) != 2:
        raise ValueError("An audio file path is required.")

    transcript = transcribe_hindi_audio(Path(sys.argv[1]))
    print(json.dumps({"hindi_text": transcript}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        raise SystemExit(1)