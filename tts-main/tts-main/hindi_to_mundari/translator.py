import importlib.util
import sys
from pathlib import Path

# This file is the user-facing part of Module 2.
# It asks for Hindi input, searches the SQLite database,
# and prints the Mundari result if a verified match exists.

action = None
try:
    from .database import create_database, find_translation, load_processed_dataset
    from .text_forms import build_text_forms
except ImportError:
    try:
        from hindi_to_mundari.database import create_database, find_translation, load_processed_dataset
        from hindi_to_mundari.text_forms import build_text_forms
    except ImportError:
        module_path = Path(__file__).resolve().with_name("database.py")
        spec = importlib.util.spec_from_file_location("hindi_to_mundari_database", module_path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Could not import translation database from {module_path}")

        database_module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = database_module
        spec.loader.exec_module(database_module)
        create_database = database_module.create_database
        find_translation = database_module.find_translation
        load_processed_dataset = database_module.load_processed_dataset
        text_forms_path = Path(__file__).resolve().with_name("text_forms.py")
        text_forms_spec = importlib.util.spec_from_file_location("hindi_to_mundari_text_forms", text_forms_path)
        if text_forms_spec is None or text_forms_spec.loader is None:
            raise ImportError(f"Could not import Mundari text forms from {text_forms_path}")
        text_forms_module = importlib.util.module_from_spec(text_forms_spec)
        sys.modules[text_forms_spec.name] = text_forms_module
        text_forms_spec.loader.exec_module(text_forms_module)
        build_text_forms = text_forms_module.build_text_forms


def translate_hindi_to_mundari(hindi_text):
    """Return the stored Mundari translation for the given Hindi text.

    This function never invents a translation.
    If the database does not contain a verified entry, it returns None.
    """
    if hindi_text is None:
        return None

    result = find_translation(hindi_text)
    return result


def display_translation(hindi_text):
    """Print the result for the CLI in a simple beginner-friendly format."""
    create_database()  # Ensure the database exists before searching.

    # If the database is empty, import the existing processed Hindi-Mundari dataset.
    # This keeps the module connected to the project data instead of a blank database.
    try:
        import sqlite3
        from pathlib import Path

        db_path = Path(__file__).resolve().parent / "data" / "hindi_mundari.db"
        connection = sqlite3.connect(db_path)
        row_count = connection.execute("SELECT COUNT(*) FROM translations WHERE verified = 1").fetchone()[0]
        connection.close()

        if row_count == 0:
            load_processed_dataset()
        else:
            # If the database already has a few rows, still allow the processed
            # TSV dataset to fill in verified matches without guessing.
            load_processed_dataset()
    except Exception:
        pass

    result = translate_hindi_to_mundari(hindi_text)

    if result is None:
        print("Translation not found in verified database.")
        return

    forms = build_text_forms(result)
    print(f"Mundari Translation: {forms['mundari_translation'] or 'Not available'}")
    print(f"Mundari Roman: {forms['mundari_roman'] or 'Unavailable (no verified Roman form in source data)'}")

    if result.get("mundari_bani") in (None, ""):
        print("Mundari Bani: Not available")
    else:
        print(f"Mundari Bani: {result['mundari_bani']}")


if __name__ == "__main__":
    # This block runs only when the file is run directly.
    # It is a simple command-line interface.
    print("Module 2: Hindi Text -> Mundari Text")
    user_input = input("Enter Hindi text: ")
    display_translation(user_input)
