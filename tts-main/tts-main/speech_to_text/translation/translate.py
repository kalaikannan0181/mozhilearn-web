from __future__ import annotations

import argparse
import sys
from pathlib import Path

import torch

if __package__ is None or __package__ == "":
    project_root = Path(__file__).resolve().parents[1]
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

from translation.translation_model import load_model_and_vocab, project_root


def get_model_files():
    model_dir = project_root() / "translation" / "models"
    best_model = model_dir / "model_best.pt"
    vocab_file = model_dir / "vocab.json"

    if best_model.exists() and vocab_file.exists():
        return best_model, vocab_file

    raise FileNotFoundError(
        "No trained translation model found. Please run: python translation/train_translation.py"
    )


def translate_sentence(input_text: str) -> str:
    if not input_text or not input_text.strip():
        raise ValueError("Please provide a Hindi sentence to translate.")

    model_path, vocab_path = get_model_files()
    model, vocab, _ = load_model_and_vocab(model_path, vocab_path)

    source_sequence = [vocab.get(ch, vocab["<pad>"]) for ch in input_text.strip()]
    source_tokens = torch.tensor(source_sequence, dtype=torch.long)
    prediction = model.predict(source_tokens.unsqueeze(0), vocab)
    return prediction.strip()


def main():
    parser = argparse.ArgumentParser(description="Translate a Hindi sentence to Mundari text.")
    parser.add_argument("sentence", nargs="?", default="नमस्ते, आप कैसे हैं?", help="Hindi sentence to translate")
    args = parser.parse_args()

    try:
        result = translate_sentence(args.sentence)
        print(result)
    except Exception as exc:
        print(f"Translation error: {exc}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
