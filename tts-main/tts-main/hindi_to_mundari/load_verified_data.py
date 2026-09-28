import csv
from pathlib import Path

from database import add_translation, create_database

# This script loads a CSV file with verified Hindi-to-Mundari entries.
# It only inserts rows when the data is real and trusted.
# It does not create guesses or invented translations.

BASE_DIR = Path(__file__).resolve().parent
CSV_PATH = BASE_DIR / "data" / "verified_translations_template.csv"


def load_verified_rows(csv_path=CSV_PATH):
    """Load rows from a CSV file into the SQLite database.

    The CSV must contain columns:
    hindi, mundari_roman, mundari_bani, source, verified

    Only rows with verified = 1 and non-empty Hindi text are accepted.
    """
    create_database()

    inserted = 0
    if not csv_path.exists():
        print(f"CSV file not found: {csv_path}")
        return 0

    with open(csv_path, "r", encoding="utf-8", newline="") as csv_file:
        reader = csv.DictReader(csv_file)

        for row in reader:
            hindi = (row.get("hindi") or "").strip()
            if not hindi:
                continue

            verified = str(row.get("verified") or "0").strip()
            if verified not in {"1", "true", "True", "TRUE"}:
                continue

            add_translation(
                hindi=hindi,
                mundari_roman=(row.get("mundari_roman") or "").strip() or None,
                mundari_bani=(row.get("mundari_bani") or "").strip() or None,
                source=(row.get("source") or "verified_dataset").strip() or "verified_dataset",
                verified=1,
            )
            inserted += 1

    return inserted


if __name__ == "__main__":
    count = load_verified_rows()
    if count == 0:
        print("No verified rows found in the template dataset. Add real Hindi-Mundari pairs only.")
    else:
        print(f"Inserted {count} verified row(s) into the database.")
