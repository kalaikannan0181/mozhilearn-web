from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

MODULE_ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = MODULE_ROOT / "TTS"
PROJECT_ROOT = MODULE_ROOT
DB_PATH = MODULE_ROOT / "hindi_to_mundari" / "data" / "hindi_mundari.db"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
ROMAN_OUT = OUTPUT_DIR / "test_roman.wav"
SCRIPT_OUT = OUTPUT_DIR / "test_script.wav"
if str(MODULE_ROOT) not in sys.path:
    sys.path.insert(0, str(MODULE_ROOT))


def read_verified_db_sample():
    """Read only a database sample without modifying the database."""
    if not DB_PATH.exists():
        return None, None

    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        row = conn.execute(
            """
            SELECT mundari_roman, mundari_bani
            FROM translations
            WHERE verified = 1
              AND (
                 (mundari_roman IS NOT NULL AND trim(mundari_roman) != '')
                 OR (mundari_bani IS NOT NULL AND trim(mundari_bani) != '')
              )
            ORDER BY id
            LIMIT 1
            """
        ).fetchone()
    finally:
        conn.close()

    if row is None:
        return None, None
    return row[0], row[1]


def load_vocab_sample():
    vocab_path = MODEL_DIR / "vocab.json"
    if not vocab_path.exists():
        return []
    with vocab_path.open("r", encoding="utf-8") as handle:
        vocab = json.load(handle)
    return list(vocab.keys())[:30]


def rune_text_from_vocab():
    keys = load_vocab_sample()
    chars = [k for k in keys if len(k) == 1 and not k.isascii() and k.strip()]
    if len(chars) >= 3:
        return "".join(chars[:3])
    return "ଓ ଅ ମ"


def tokenizer_report(tokenizer):
    print("tokenizer class:", tokenizer.__class__.__name__)
    print("tokenizer language:", getattr(tokenizer, "language", None))
    print("is_uroman:", getattr(tokenizer, "is_uroman", None))
    print("vocab size:", getattr(tokenizer, "vocab_size", None))
    print("sampling rate:", getattr(tokenizer, "sampling_rate", None))
    sample = load_vocab_sample()
    print("first 30 vocabulary entries:", sample)


def count_unknown(input_ids, tokenizer):
    unknown_id = getattr(tokenizer, "unk_token_id", None)
    if unknown_id is None:
        return 0
    arr = input_ids.flatten().tolist()
    return sum(1 for v in arr if v == unknown_id)


def run_test(label, text, tokenizer, model, wav_path):
    print(f"\n=== {label} ===")
    print("input text:", repr(text))
    try:
        enc = tokenizer(text, return_tensors="pt")
        input_ids = enc["input_ids"]
        unknown_count = count_unknown(input_ids, tokenizer)
        tokenization_succeeded = True
        print("token IDs:", input_ids[0].tolist())
        print("number of unknown tokens:", unknown_count)
        print("tokenization succeeded:", tokenization_succeeded)
    except Exception as exc:
        print("token IDs:", "N/A")
        print("number of unknown tokens:", "N/A")
        print("tokenization succeeded:", False)
        print("tokenizer error:", exc)
        return {
            "label": label,
            "supported": False,
            "unknown": "N/A",
            "waveform_shape": None,
            "sample_rate": None,
            "wav_path": None,
            "tokenization_succeeded": False,
        }

    try:
        with __import__("torch").no_grad():
            output = model(**enc)
        waveform = output.waveform
        if isinstance(waveform, tuple):
            waveform = waveform[0]
        arr = waveform.detach().cpu().numpy()
        waveform_shape = tuple(arr.shape)
        sr = int(getattr(model.config, "sampling_rate", 16000))
        print("generated waveform shape:", waveform_shape)
        print("sampling rate:", sr)
        print("output WAV path:", wav_path)

        if tokenization_succeeded and unknown_count == 0:
            wav_path.parent.mkdir(parents=True, exist_ok=True)
            import scipy.io.wavfile as wav
            wav.write(str(wav_path), sr, arr[0].astype("float32") if arr.ndim > 1 else arr.astype("float32"))
            print("audio file written:", wav_path)
            return {
                "label": label,
                "supported": True,
                "unknown": unknown_count,
                "waveform_shape": waveform_shape,
                "sample_rate": sr,
                "wav_path": str(wav_path),
                "tokenization_succeeded": True,
            }

        print("Audio generation succeeded but tokenizer acceptance is not confirmed; leaving WAV unset.")
        return {
            "label": label,
            "supported": False,
            "unknown": unknown_count,
            "waveform_shape": waveform_shape,
            "sample_rate": sr,
            "wav_path": None,
            "tokenization_succeeded": True,
        }
    except Exception as exc:
        print("generated waveform shape:", "N/A")
        print("sampling rate:", "N/A")
        print("output WAV path:", wav_path)
        print("audio generation error:", exc)
        return {
            "label": label,
            "supported": False,
            "unknown": unknown_count,
            "waveform_shape": None,
            "sample_rate": None,
            "wav_path": None,
            "tokenization_succeeded": True,
        }


def main():
    print("=== MMS TTS tokenizer investigation: facebook/mms-tts-unr ===")
    try:
        from transformers import AutoTokenizer
    except Exception as exc:
        print("required dependencies missing:", exc)
        raise SystemExit(1)

    import sqlite3
    from hindi_to_mundari.text_forms import build_text_forms

    with sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True) as connection:
        translation_row = connection.execute(
            "SELECT mundari_roman, source, verified FROM translations WHERE verified = 1 AND source = 'verified_manual_2026' LIMIT 1"
        ).fetchone()
        if translation_row is None:
            translation_row = connection.execute(
                "SELECT mundari_roman, source, verified FROM translations WHERE verified = 1 AND source = 'hindi_mundari_dataset_processed' LIMIT 1"
            ).fetchone()
        roman_row = connection.execute(
            "SELECT mundari_roman, source, verified FROM translations WHERE verified = 1 AND mundari_roman GLOB '*[A-Za-z]*' LIMIT 1"
        ).fetchone()

    if translation_row is None:
        raise SystemExit("No verified Mundari source translation was found.")

    translation_text = translation_row[0]
    forms = build_text_forms({
        "mundari_roman": translation_text,
        "source": translation_row[1],
        "verified": translation_row[2],
    })
    roman_text = roman_row[0] if roman_row else "Namaste"
    tts_text = forms["tts_input"]
    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), local_files_only=True)
    print("TOKENIZER_LOAD: OK")
    tokenizer_report(tokenizer)

    def check_tokenizer(label, text):
        token_ids = tokenizer(text, return_tensors="pt")["input_ids"].flatten().tolist()
        unknown_id = tokenizer.unk_token_id
        accepted = bool(token_ids) and (unknown_id is None or unknown_id not in token_ids)
        unknown_count = token_ids.count(unknown_id) if unknown_id is not None else 0
        print(f"{label}: accepted={accepted}, unknown_count={unknown_count}, token_ids={token_ids}")
        return accepted

    print("\nMundari translation:", repr(translation_text))
    print("Verified Roman form:", repr(roman_text))
    print("TTS input (Odia):", repr(tts_text))
    translation_accepted = check_tokenizer("TRANSLATION_INPUT", translation_text)
    roman_accepted = check_tokenizer("ROMAN_INPUT", roman_text)
    tts_accepted = check_tokenizer("TTS_INPUT", tts_text or "")

    print("\n=== Final status ===")
    print(f"TRANSLATION_INPUT_ACCEPTED: {translation_accepted}")
    print(f"ROMAN_INPUT_ACCEPTED: {roman_accepted}")
    print(f"TTS_INPUT_ACCEPTED: {tts_accepted}")

    if not tts_accepted:
        raise SystemExit("The selected model-compatible TTS input was rejected by the tokenizer.")

    model_weights_present = any(MODEL_DIR.glob("model.safetensors")) or any(MODEL_DIR.glob("pytorch_model.bin"))
    if not model_weights_present:
        print("MODEL_WEIGHTS: missing; audio generation skipped")
        return

    import torch
    import scipy.io.wavfile as wav
    from transformers import VitsModel

    model = VitsModel.from_pretrained(str(MODEL_DIR), local_files_only=True)
    with torch.no_grad():
        waveform = model(**tokenizer(tts_text, return_tensors="pt")).waveform
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / "tts_input.wav"
    wav.write(str(output_path), int(model.config.sampling_rate), waveform[0].detach().cpu().numpy().astype("float32"))
    print(f"AUDIO_GENERATED: {output_path}")


if __name__ == "__main__":
    main()
