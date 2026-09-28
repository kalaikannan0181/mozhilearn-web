# Dataset collection workflow

This folder is reserved for a safe, read-only content pipeline.

## Required structure

- `data/raw/` — source files copied as-is
- `data/normalized/` — normalized rows with source provenance
- `data/validated/` — rows that passed schema validation
- `data/rejected/` — invalid rows rejected before import
- `data/templates/` — starter CSV templates synced to the database schema
- `data/reports/` — audit and quality reports

## Safe rules

- Never overwrite verified Lesson 1 translations already present in the database.
- Keep source material in Roman script only when the target field is `mundari_roman`.
- Use dry-run imports before any insert.
- Preserve `source`, `source_reference`, and `validation_status` metadata.
- Stop on suspicious or duplicated rows instead of creating guessed translations.

## Current source audit

The live source set under `lesson-1/mundari-content` is the starting point for the dataset phase. The verified web flow remains the protected baseline and is not modified during this step.
