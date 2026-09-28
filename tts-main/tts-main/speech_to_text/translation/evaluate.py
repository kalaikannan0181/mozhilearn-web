from __future__ import annotations

import csv
import sys
from pathlib import Path

import torch

if __package__ is None or __package__ == "":
    project_root = Path(__file__).resolve().parents[1]
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

from translation.translation_model import find_dataset_dir, load_model_and_vocab, load_tsv_pairs, project_root


def evaluate_model():
    data_dir = find_dataset_dir()
    test_pairs = load_tsv_pairs(data_dir / "test.tsv")
    model_dir = project_root() / "translation" / "models"
    model_path = model_dir / "model_best.pt"
    vocab_path = model_dir / "vocab.json"

    if not model_path.exists() or not vocab_path.exists():
        raise FileNotFoundError(
            "No trained model found. Train the model first by running: python translation/train_translation.py"
        )

    model, vocab, _ = load_model_and_vocab(model_path, vocab_path)
    predictions = []
    exact_matches = 0
    char_matches = 0
    total_chars = 0

    for hindi, expected in test_pairs:
        source_tokens = torch.tensor([vocab.get(ch, vocab["<pad>"]) for ch in hindi], dtype=torch.long)
        prediction = model.predict(source_tokens.unsqueeze(0), vocab)
        predictions.append((hindi, expected, prediction))

        cleaned_prediction = prediction.strip()
        cleaned_expected = expected.strip()

        if cleaned_prediction == cleaned_expected:
            exact_matches += 1

        max_len = max(len(cleaned_prediction), len(cleaned_expected))
        total_chars += max_len
        char_matches += sum(1 for i in range(min(len(cleaned_prediction), len(cleaned_expected))) if cleaned_prediction[i] == cleaned_expected[i])

    output_path = project_root() / "translation" / "output" / "test_predictions.tsv"
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t")
        writer.writerow(["hindi", "expected_mundari", "predicted_mundari"])
        for hindi, expected, prediction in predictions:
            writer.writerow([hindi, expected, prediction])

    total = len(test_pairs)
    exact_match_rate = exact_matches / total if total else 0.0
    char_accuracy = char_matches / total_chars if total_chars else 0.0

    print(f"Test examples: {total}")
    print(f"Exact match rate: {exact_match_rate:.4f}")
    print(f"Character-level accuracy: {char_accuracy:.4f}")
    print(f"Predictions saved to: {output_path}")


if __name__ == "__main__":
    print("Evaluating the Hindi -> Mundari translation model...")
    evaluate_model()
