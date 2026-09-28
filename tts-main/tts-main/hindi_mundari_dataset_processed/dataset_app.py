from __future__ import annotations

import csv
import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _count_rows(path: Path) -> int:
    if not path.exists():
        return 0
    with path.open("r", encoding="utf-8") as handle:
        reader = csv.reader(handle, delimiter="\t")
        count = 0
        for row in reader:
            if not row or len(row) < 2:
                continue
            if row[0].strip() == "hindi" and row[1].strip() == "mundari":
                continue
            count += 1
    return count


def load_dataset_summary() -> dict:
    files = {
        "train": BASE_DIR / "train.tsv",
        "validation": BASE_DIR / "validation.tsv",
        "test": BASE_DIR / "test.tsv",
    }

    summary = {}
    for split, path in files.items():
        summary[split] = {
            "path": str(path),
            "rows": _count_rows(path),
            "exists": path.exists(),
        }

    return summary


def main() -> None:
    summary = load_dataset_summary()
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
