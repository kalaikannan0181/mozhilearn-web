from hindi_to_mundari.database import create_database, load_processed_dataset

# This script creates the SQLite database and table if they do not already exist.
# It also loads the real Hindi-Mundari TSV dataset into the database.

if __name__ == "__main__":
    database_path = create_database()
    imported = load_processed_dataset()
    print(f"Database ready: {database_path}")
    print(f"Imported {imported} verified rows from the processed dataset.")
