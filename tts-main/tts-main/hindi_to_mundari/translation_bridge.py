from __future__ import annotations

import json
import sys
from pathlib import Path

MODULE_ROOT = Path(__file__).resolve().parents[1]
if str(MODULE_ROOT) not in sys.path:
    sys.path.insert(0, str(MODULE_ROOT))

from hindi_to_mundari.translator import translate_hindi_to_mundari
from hindi_to_mundari.text_forms import build_text_forms


def main() -> None:
    request = json.loads(sys.stdin.read())
    if isinstance(request, dict) and request.get("action") == "prepare_batch":
        items = request.get("items")
        if not isinstance(items, list):
            raise ValueError("items must be a list")
        results = []
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                continue
            forms = build_text_forms(item.get("mundari_translation"))
            results.append({"id": item["id"], "tts_input": forms["tts_input"], "tts_input_script": forms["tts_input_script"]})
        print(json.dumps({"items": results}, ensure_ascii=False))
        return

    if isinstance(request, dict) and request.get("action") == "prepare":
        text = request.get("mundari_translation")
        row = {
            "mundari_translation": text,
            "mundari_roman": request.get("mundari_roman"),
            "verified": request.get("verified") is True,
            "source": request.get("source"),
        }
        print(json.dumps({"forms": build_text_forms(row)}, ensure_ascii=False))
        return

    text = request.get("hindi_text") if isinstance(request, dict) else None
    result = translate_hindi_to_mundari(text)
    print(json.dumps({
        "translation": result,
        "forms": build_text_forms(result),
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        raise SystemExit(1)