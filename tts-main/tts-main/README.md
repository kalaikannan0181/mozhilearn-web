# Hindi-to-Mundari Audio Pipeline

The audio path is Hindi speech recognition, verified Hindi-to-Mundari database lookup, then separate text forms:

- `mundari_translation` preserves the source value from the database. The corpus loader currently stores its Mundari column in the legacy `mundari_roman` field; most of those values are Devanagari.
- `mundari_roman` is returned only when a verified source row actually contains Latin-script text. No generic Romanizer is applied to unsupported Mundari text; missing Romanization stays unavailable.
- `tts_input` is a separate script conversion using `indic-transliteration`: Devanagari text converts Devanagari→Odia; supplied Latin text converts IAST→Odia. The source Roman string is not changed. The local MMS tokenizer vocabulary is Odia-script based, so converted input is rejected if any character is outside the tokenizer vocabulary. This verifies script/token compatibility, not the Mundari pronunciation accuracy.

The Devanagari-to-Odia step is script conversion for TTS, not translation or Romanization. The database is read without rewriting verified values.

Run the tests from this directory with:

```powershell
python -m unittest discover -s tests -v
```

The bundled `TTS` directory currently has tokenizer/config files but no model checkpoint weights. Tokenizer tests run locally; audio synthesis remains unavailable until weights are supplied. Install `tts-requirements.txt` only in an environment that will run the model service.