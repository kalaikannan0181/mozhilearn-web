import csv
import re
import sqlite3
import unicodedata
from pathlib import Path

# This project uses a SQLite database stored on disk.
# A database is like a small spreadsheet that keeps structured data.
# Here, we store Hindi phrases and the matching Mundari translations.

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "hindi_mundari.db"


def normalize_hindi_text(text):
    """Clean user input without changing its meaning.

    We only remove unnecessary spaces and normalize common punctuation.
    We do not invent or translate words here.
    """
    if text is None:
        return ""

    cleaned = unicodedata.normalize("NFC", str(text).strip())
    cleaned = cleaned.replace("।", ".").replace("॥", ".")
    cleaned = cleaned.replace("،", ",").replace("؛", ";")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def create_database():
    """Create the database file and the translations table if missing."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    try:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS translations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hindi TEXT NOT NULL,
                mundari_roman TEXT,
                mundari_bani TEXT,
                source TEXT,
                verified INTEGER DEFAULT 0
            )
            """
        )
        connection.commit()
        return str(DB_PATH)
    finally:
        connection.close()


def load_processed_dataset():
    """Import the project dataset from the real Hindi-Mundari sources.

    This connects Module 2 to the existing processed TSV data and the verified
    manual CSV template so the translator can work with real Hindi-to-Mundari pairs
    instead of an empty database.
    """
    create_database()

    dataset_dir = PROJECT_ROOT / "hindi_mundari_dataset_processed"
    files = ["train.tsv", "validation.tsv", "test.tsv"]
    imported = 0

    connection = sqlite3.connect(DB_PATH)
    try:
        for file_name in files:
            file_path = dataset_dir / file_name
            if not file_path.exists():
                continue

            with file_path.open("r", encoding="utf-8") as handle:
                reader = csv.reader(handle, delimiter="\t")

                for row_index, row in enumerate(reader):
                    if not row or len(row) < 2:
                        continue

                    hindi = row[0].strip()
                    mundari = row[1].strip()

                    if row_index == 0 and hindi.lower() == "hindi" and mundari.lower() == "mundari":
                        continue

                    if not hindi or not mundari:
                        continue

                    if connection.execute(
                        "SELECT 1 FROM translations WHERE verified = 1 AND hindi = ? LIMIT 1",
                        (hindi,),
                    ).fetchone():
                        continue

                    connection.execute(
                        """
                        INSERT INTO translations (hindi, mundari_roman, mundari_bani, source, verified)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (hindi, mundari, None, "hindi_mundari_dataset_processed", 1),
                    )
                    imported += 1

        verified_csv = BASE_DIR / "data" / "verified_translations_template.csv"
        if verified_csv.exists():
            with verified_csv.open("r", encoding="utf-8", newline="") as handle:
                reader = csv.DictReader(handle)
                for row in reader:
                    hindi = (row.get("hindi") or "").strip()
                    verified = str(row.get("verified") or "0").strip()
                    if not hindi or verified not in {"1", "true", "True", "TRUE"}:
                        continue

                    if connection.execute(
                        "SELECT 1 FROM translations WHERE verified = 1 AND hindi = ? LIMIT 1",
                        (hindi,),
                    ).fetchone():
                        continue

                    connection.execute(
                        """
                        INSERT INTO translations (hindi, mundari_roman, mundari_bani, source, verified)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            hindi,
                            (row.get("mundari_roman") or "").strip() or None,
                            (row.get("mundari_bani") or "").strip() or None,
                            (row.get("source") or "verified_translations_template").strip() or "verified_translations_template",
                            1,
                        ),
                    )
                    imported += 1

        connection.commit()
        return imported
    finally:
        connection.close()


def _row_to_dict(row):
    """Convert one SQLite row into a dictionary for easier use in Python."""
    if row is None:
        return None

    return {
        "id": row[0],
        "hindi": row[1],
        "mundari_roman": row[2],
        "mundari_bani": row[3],
        "source": row[4],
        "verified": row[5],
    }


def add_translation(hindi, mundari_roman=None, mundari_bani=None, source="manual", verified=0):
    """Insert a new translation into the database.

    Example:
        add_translation("नमस्ते", "Namaste", "", "verified_dataset", 1)

    Important: this function does not create guesses.
    It stores only data that is already verified by a trusted source.
    """
    cleaned_hindi = str(hindi).strip()
    if not cleaned_hindi:
        raise ValueError("Hindi text cannot be empty.")

    connection = sqlite3.connect(DB_PATH)
    try:
        connection.execute(
            """
            INSERT INTO translations (hindi, mundari_roman, mundari_bani, source, verified)
            VALUES (?, ?, ?, ?, ?)
            """,
            (cleaned_hindi, mundari_roman, mundari_bani, source, int(verified)),
        )
        connection.commit()
        return True
    finally:
        connection.close()


def find_translation(hindi_text):
    """Find a matching Hindi phrase in the verified database.

    Matching order:
    1. exact match on the trimmed Hindi text
    2. normalized match (spaces/punctuation cleaned)

    This avoids random guessing and keeps the translation strictly dataset-based.
    """
    if hindi_text is None:
        return None

    query_text = str(hindi_text).strip()
    if not query_text:
        return None

    connection = sqlite3.connect(DB_PATH)
    try:
        # Exact match first. We look only at verified entries.
        exact_row = connection.execute(
            "SELECT * FROM translations WHERE verified = 1 AND hindi = ? LIMIT 1",
            (query_text,),
        ).fetchone()
        if exact_row is not None:
            return _row_to_dict(exact_row)

        # Normalized match second. This handles extra spaces and punctuation.
        normalized_query = normalize_hindi_text(query_text)
        rows = connection.execute(
            "SELECT * FROM translations WHERE verified = 1"
        ).fetchall()

        for row in rows:
            stored_hindi = row[1]
            if normalize_hindi_text(stored_hindi) == normalized_query:
                return _row_to_dict(row)

        return None
    finally:
        connection.close()


def get_all_translations():
    """Return every row in the table as a list of dictionaries."""
    connection = sqlite3.connect(DB_PATH)
    try:
        rows = connection.execute(
            "SELECT * FROM translations ORDER BY id"
        ).fetchall()
        return [_row_to_dict(row) for row in rows]
    finally:
        connection.close()
