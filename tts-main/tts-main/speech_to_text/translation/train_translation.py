from __future__ import annotations

import random
import sys
from pathlib import Path

import torch
from torch import nn

if __package__ is None or __package__ == "":
    project_root = Path(__file__).resolve().parents[1]
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

from translation.translation_model import (
    CharSeq2SeqModel,
    PAD_TOKEN,
    build_vocab,
    encode_text,
    find_dataset_dir,
    load_tsv_pairs,
    project_root,
    save_training_state,
)


def train_model():
    data_dir = find_dataset_dir()
    train_pairs = load_tsv_pairs(data_dir / "train.tsv")
    validation_pairs = load_tsv_pairs(data_dir / "validation.tsv")

    if not train_pairs:
        raise ValueError("Training dataset is empty. Please add Hindi-Mundari pairs to train.tsv.")

    all_texts = []
    for hindi, mundari in train_pairs + validation_pairs:
        all_texts.append(hindi)
        all_texts.append(mundari)

    vocab = build_vocab(all_texts)
    pad_idx = vocab[PAD_TOKEN]
    device = torch.device("cpu")

    model = CharSeq2SeqModel(len(vocab), embed_dim=64, hidden_dim=128, pad_idx=pad_idx).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01)
    criterion = nn.CrossEntropyLoss(ignore_index=pad_idx)

    max_epoch = 8
    best_val_loss = float("inf")
    best_epoch = 0

    for epoch in range(1, max_epoch + 1):
        random.shuffle(train_pairs)
        model.train()
        total_loss = 0.0

        for hindi, mundari in train_pairs:
            source_tokens = torch.tensor(encode_text(hindi, vocab, add_eos=False), dtype=torch.long, device=device).unsqueeze(0)
            target_tokens = torch.tensor(encode_text(mundari, vocab, add_eos=True), dtype=torch.long, device=device).unsqueeze(0)

            decoder_input = target_tokens[:, :-1]
            decoder_target = target_tokens[:, 1:]

            logits = model(source_tokens, decoder_input)
            loss = criterion(logits.reshape(-1, len(vocab)), decoder_target.reshape(-1))

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += loss.item()

        average_train_loss = total_loss / max(1, len(train_pairs))

        model.eval()
        validation_loss = 0.0
        with torch.no_grad():
            for hindi, mundari in validation_pairs:
                source_tokens = torch.tensor(encode_text(hindi, vocab, add_eos=False), dtype=torch.long, device=device).unsqueeze(0)
                target_tokens = torch.tensor(encode_text(mundari, vocab, add_eos=True), dtype=torch.long, device=device).unsqueeze(0)

                decoder_input = target_tokens[:, :-1]
                decoder_target = target_tokens[:, 1:]
                logits = model(source_tokens, decoder_input)
                loss = criterion(logits.reshape(-1, len(vocab)), decoder_target.reshape(-1))
                validation_loss += loss.item()

        average_val_loss = validation_loss / max(1, len(validation_pairs))
        print(f"Epoch {epoch}/{max_epoch} | train_loss={average_train_loss:.4f} | val_loss={average_val_loss:.4f}")

        if average_val_loss < best_val_loss:
            best_val_loss = average_val_loss
            best_epoch = epoch
            save_training_state(model, vocab, project_root() / "translation" / "models", epoch, average_val_loss)

    print(f"Training complete. Best validation loss: {best_val_loss:.4f} at epoch {best_epoch}.")
    print(f"Model saved under: {project_root() / 'translation' / 'models'}")


if __name__ == "__main__":
    print("Starting Hindi -> Mundari translation training on CPU...")
    train_model()
