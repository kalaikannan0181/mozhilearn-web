from __future__ import annotations

import unittest
from pathlib import Path

from transformers import AutoTokenizer

from hindi_to_mundari.text_forms import build_text_forms, format_translation_output

MODULE_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = MODULE_ROOT / "TTS"


class TextFormsTests(unittest.TestCase):
    def test_devanagari_translation_is_never_labelled_as_roman(self):
        translation = "आञ आमा येखे हिन्दी अदा पक्का मेनाः चि आञे पुराएः दुलाड़ा रेकाञ आर आमे अची पुराएः शिकायना"
        forms = build_text_forms({
            "mundari_roman": translation,
            "source": "hindi_mundari_dataset_processed",
            "verified": 1,
        })
        output = format_translation_output("हिंदी", forms, "Verified database translation")
        lines = output.splitlines()

        self.assertEqual(forms["mundari_translation"], translation)
        self.assertIsNone(forms["mundari_roman"])
        self.assertEqual(lines[lines.index("Mundari Translation:") + 1], translation)
        roman_value = lines[lines.index("Mundari Roman:") + 1]
        self.assertEqual(roman_value, "Unavailable (no verified Roman form in source data)")
        self.assertNotEqual(roman_value, translation)

    def test_existing_verified_latin_form_is_retained(self):
        forms = build_text_forms({
            "mundari_roman": "Namaste",
            "source": "verified_dataset",
            "verified": 1,
        })

        self.assertEqual(forms["mundari_roman"], "Namaste")
        self.assertTrue(forms["romanization_verified"])
        self.assertEqual(forms["romanization_source"], "verified_dataset")
        self.assertEqual(forms["tts_input_script"], "Odia")
        self.assertNotEqual(forms["tts_input"], "Namaste")

    def test_translation_is_converted_to_tokenizer_supported_tts_input(self):
        translation = "आञ आमा येखे हिन्दी अदा पक्का मेनाः चि आञे पुराएः दुलाड़ा रेकाञ आर आमे अची पुराएः शिकायना"
        forms = build_text_forms({
            "mundari_roman": translation,
            "source": "hindi_mundari_dataset_processed",
            "verified": 1,
        })
        tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), local_files_only=True)
        source_ids = tokenizer(translation, return_tensors="pt")["input_ids"].flatten().tolist()
        roman_ids = tokenizer("Namaste", return_tensors="pt")["input_ids"].flatten().tolist()
        tts_ids = tokenizer(forms["tts_input"], return_tensors="pt")["input_ids"].flatten().tolist()

        self.assertEqual(forms["tts_input_script"], "Odia")
        self.assertNotEqual(forms["tts_input"], translation)
        self.assertEqual(source_ids, [])
        self.assertEqual(roman_ids, [])
        self.assertTrue(tts_ids)
        self.assertNotIn(tokenizer.unk_token_id, tts_ids)

    def test_seven_class1_roman_values_get_distinct_model_script_inputs(self):
        tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), local_files_only=True)
        source_values = ["Uli", "Kela", "Miyad", "Bariya", "Apiya", "Upuna", "Moreya"]

        for source_roman in source_values:
            with self.subTest(source_roman=source_roman):
                forms = build_text_forms({
                    "mundari_roman": source_roman,
                    "source": "lesson-1-class1-source",
                    "verified": 1,
                })
                token_ids = tokenizer(forms["tts_input"], return_tensors="pt")["input_ids"].flatten().tolist()

                self.assertEqual(forms["mundari_roman"], source_roman)
                self.assertEqual(forms["tts_input_script"], "Odia")
                self.assertNotEqual(forms["tts_input"], source_roman)
                self.assertTrue(token_ids)
                self.assertNotIn(tokenizer.unk_token_id, token_ids)


if __name__ == "__main__":
    unittest.main()