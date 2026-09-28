from __future__ import annotations

import json
import unicodedata
from pathlib import Path

from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate

MODULE_ROOT = Path(__file__).resolve().parents[1]
TTS_VOCAB_PATH = MODULE_ROOT / "TTS" / "vocab.json"


def is_latin_script(text: str) -> bool:
    letters = [character for character in text if character.isalpha()]
    return bool(letters) and all("LATIN" in unicodedata.name(character, "") for character in letters)


def transliterate_mundari_to_roman(
    text: str | None,
    *,
    existing_roman: str | None = None,
    verified: bool = False,
    source: str | None = None,
) -> str | None:
    """Return only an existing, verified Latin form; do not guess missing forms."""
    if not text or not existing_roman or not verified or not source:
        return None

    candidate = existing_roman.strip()
    if not candidate or not is_latin_script(candidate):
        return None

    return candidate


def transliterateMundariToRoman(
    text: str | None,
    *,
    existing_roman: str | None = None,
    verified: bool = False,
    source: str | None = None,
) -> str | None:
    return transliterate_mundari_to_roman(
        text,
        existing_roman=existing_roman,
        verified=verified,
        source=source,
    )


def mundari_to_tts_input(text: str | None) -> str | None:
    """Convert source text to Odia script and reject characters outside the TTS vocab."""
    if not text or not text.strip():
        return None

    with TTS_VOCAB_PATH.open("r", encoding="utf-8") as handle:
        vocabulary = json.load(handle)

    if any("DEVANAGARI" in unicodedata.name(character, "") for character in text):
        tts_input = transliterate(text, sanscript.DEVANAGARI, sanscript.ORIYA)
    elif any("ORIYA" in unicodedata.name(character, "") for character in text):
        tts_input = text
    elif is_latin_script(text):
        tts_input = transliterate(text, sanscript.IAST, sanscript.ORIYA)
    else:
        return None

    tts_input = unicodedata.normalize("NFD", tts_input)
    if not tts_input.strip() or any(character not in vocabulary and not character.isspace() for character in tts_input):
        return None

    return tts_input


def build_text_forms(translation: dict | str | None) -> dict:
    if isinstance(translation, dict):
        mundari_translation = translation.get("mundari_translation")
        if not isinstance(mundari_translation, str) or not mundari_translation.strip():
            mundari_translation = translation.get("mundari_roman")
        existing_roman = translation.get("mundari_roman")
        is_verified = translation.get("verified") == 1 or translation.get("verified") is True
        source = translation.get("source")
    else:
        mundari_translation = translation
        existing_roman = None
        is_verified = False
        source = None

    if not isinstance(mundari_translation, str) or not mundari_translation.strip():
        return {
            "mundari_translation": None,
            "mundari_roman": None,
            "romanization_verified": False,
            "romanization_source": None,
            "tts_input": None,
            "tts_input_script": None,
        }

    mundari_translation = mundari_translation.strip()
    mundari_roman = transliterate_mundari_to_roman(
        mundari_translation,
        existing_roman=existing_roman,
        verified=is_verified,
        source=source,
    )
    tts_input = mundari_to_tts_input(mundari_translation)

    return {
        "mundari_translation": mundari_translation,
        "mundari_roman": mundari_roman,
        "romanization_verified": mundari_roman is not None,
        "romanization_source": source if mundari_roman is not None else None,
        "tts_input": tts_input,
        "tts_input_script": "Odia" if tts_input is not None else None,
    }

def format_translation_output(hindi_text: str, forms: dict, status: str) -> str:
    roman_text = forms["mundari_roman"] or "Unavailable (no verified Roman form in source data)"
    translated_text = forms["mundari_translation"] or "Not available"
    lines = [
        "----------------------------------------",
        "SIH26042 Hindi → Mundari Translation",
        "----------------------------------------",
        "",
        "Hindi:",
        hindi_text,
        "",
        "Mundari Translation:",
        translated_text,
        "",
        "Mundari Roman:",
        roman_text,
        "",
        "Status:",
        status,
        "",
        "----------------------------------------",
    ]
    return "\n".join(lines) + "\n"