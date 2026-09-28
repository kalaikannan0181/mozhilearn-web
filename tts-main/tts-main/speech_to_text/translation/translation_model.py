from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

import torch
from torch import nn


PAD_TOKEN = "<pad>"
SOS_TOKEN = "<s>"
EOS_TOKEN = "</s>"


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def find_dataset_dir() -> Path:
    """Find dataset files. The project prefers translation/data, then the project root."""
    project = project_root()
    candidates = [
        project / "translation" / "data",
        project,
        project.parent / "hindi_mundari_dataset_processed",
    ]

    for candidate in candidates:
        if candidate.exists():
            required = [candidate / "train.tsv", candidate / "validation.tsv", candidate / "test.tsv"]
            if all(path.exists() for path in required):
                return candidate

    raise FileNotFoundError(
        "Dataset not found. Please place train.tsv, validation.tsv, and test.tsv inside the project root or "
        f"inside {project / 'translation' / 'data'}."
    )


def load_tsv_pairs(path: Path) -> List[Tuple[str, str]]:
    """Read UTF-8 TSV files with two columns: Hindi and Mundari."""
    if not path.exists():
        raise FileNotFoundError(f"Required dataset file not found: {path}")

    pairs: List[Tuple[str, str]] = []
    with path.open("r", encoding="utf-8") as handle:
        reader = csv.reader(handle, delimiter="\t")
        for row_index, row in enumerate(reader):
            if not row or len(row) < 2:
                continue

            first = row[0].strip()
            second = row[1].strip()

            if row_index == 0 and first.lower() == "hindi" and second.lower() == "mundari":
                continue

            if not first or not second:
                continue

            pairs.append((first, second))

    if not pairs:
        raise ValueError(f"No valid Hindi-Mundari pairs were found in {path}.")

    return pairs


def build_vocab(texts: Iterable[str]) -> Dict[str, int]:
    """Create a simple character-level vocabulary. This is beginner friendly and runs on CPU."""
    chars = {PAD_TOKEN, SOS_TOKEN, EOS_TOKEN}
    for sentence in texts:
        chars.update(list(sentence))

    vocab = {char: idx for idx, char in enumerate(sorted(chars))}
    return vocab


def encode_text(text: str, vocab: Dict[str, int], add_eos: bool = True) -> List[int]:
    encoded = [vocab.get(ch, vocab[PAD_TOKEN]) for ch in text]
    if add_eos:
        encoded.append(vocab[EOS_TOKEN])
    return encoded


def decode_text(ids: Sequence[int], reverse_vocab: Dict[int, str]) -> str:
    text_chars = [reverse_vocab.get(int(i), "") for i in ids]
    result = "".join(text_chars)
    for token in (PAD_TOKEN, SOS_TOKEN, EOS_TOKEN):
        result = result.replace(token, "")
    return result


class CharSeq2SeqModel(nn.Module):
    def __init__(self, vocab_size: int, embed_dim: int = 64, hidden_dim: int = 128, pad_idx: int = 0):
        super().__init__()
        self.encoder_embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=pad_idx)
        self.encoder_gru = nn.GRU(embed_dim, hidden_dim, batch_first=True)

        self.decoder_embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=pad_idx)
        self.decoder_gru = nn.GRU(embed_dim, hidden_dim, batch_first=True)
        self.output_layer = nn.Linear(hidden_dim, vocab_size)

    def forward(self, source_tokens: torch.Tensor, target_tokens: torch.Tensor):
        encoder_embedded = self.encoder_embedding(source_tokens)
        _, encoder_hidden = self.encoder_gru(encoder_embedded)

        decoder_embedded = self.decoder_embedding(target_tokens)
        decoder_output, _ = self.decoder_gru(decoder_embedded, encoder_hidden)
        logits = self.output_layer(decoder_output)
        return logits

    @torch.no_grad()
    def predict(self, source_tokens: torch.Tensor, vocab: Dict[str, int], max_length: int = 80):
        device = source_tokens.device
        reverse_vocab = {idx: ch for ch, idx in vocab.items()}

        encoder_embedded = self.encoder_embedding(source_tokens)
        _, encoder_hidden = self.encoder_gru(encoder_embedded)

        generated = [vocab[SOS_TOKEN]]
        current_token = torch.tensor([vocab[SOS_TOKEN]], device=device)
        hidden = encoder_hidden

        for _ in range(max_length):
            decoder_embedded = self.decoder_embedding(current_token.unsqueeze(0))
            decoder_output, hidden = self.decoder_gru(decoder_embedded, hidden)
            logits = self.output_layer(decoder_output)
            next_index = int(torch.argmax(logits[0]).item())
            generated.append(next_index)

            if next_index == vocab[EOS_TOKEN]:
                break

            current_token = torch.tensor([next_index], device=device)

        return decode_text(generated, reverse_vocab)


def save_training_state(model: nn.Module, vocab: Dict[str, int], save_dir: Path, epoch: int, val_loss: float):
    save_dir.mkdir(parents=True, exist_ok=True)

    state = {
        "epoch": epoch,
        "val_loss": val_loss,
        "vocab": vocab,
        "model_state": model.state_dict(),
    }

    model_path = save_dir / f"model_epoch_{epoch}.pt"
    best_path = save_dir / "model_best.pt"
    torch.save(state, model_path)
    torch.save(state, best_path)

    vocab_path = save_dir / "vocab.json"
    with vocab_path.open("w", encoding="utf-8") as handle:
        json.dump(vocab, handle, ensure_ascii=False, indent=2)

    print(f"Saved checkpoint: {model_path}")
    print(f"Saved best model: {best_path}")
    print(f"Saved vocab: {vocab_path}")


def load_model_and_vocab(model_path: Path, vocab_path: Path):
    if not model_path.exists():
        raise FileNotFoundError(f"Model file not found: {model_path}")
    if not vocab_path.exists():
        raise FileNotFoundError(f"Vocabulary file not found: {vocab_path}")

    with vocab_path.open("r", encoding="utf-8") as handle:
        vocab = json.load(handle)

    reverse_vocab = {idx: ch for ch, idx in vocab.items()}
    max_index = max(vocab.values())
    model = CharSeq2SeqModel(vocab_size=max_index + 1, pad_idx=vocab[PAD_TOKEN])
    state = torch.load(model_path, map_location="cpu")
    model.load_state_dict(state["model_state"])
    model.eval()
    return model, vocab, reverse_vocab
