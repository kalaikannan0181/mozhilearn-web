# Dataset Approval Workflow

The controlled path from source material to a possible live import is:

```text
SOURCE
  ↓
NORMALIZED
  ↓
AUTOMATED REVIEW
  ↓
HUMAN_DECISION
  ↓
APPROVED IMPORT MANIFEST
  ↓
DRY RUN
  ↓
LIVE IMPORT
```

## Decision rules

- `APPROVE` = explicit human authorization. It is never inferred from a review status.
- `HOLD` = never import.
- `REJECT` = never import.
- Duplicate, conflict, unresolved human-review, and missing-required-field rows are never eligible for a manifest.
- A row must have both `human_decision=APPROVE` and `review_status=SAFE_TO_IMPORT` to enter the approved manifest. Human review must resolve the blocking classification before setting the latter status.

## Commands

- `npm run dataset:manifest` validates the approval queue and writes `data/reports/class1_approved_import_manifest.csv`. A zero-row manifest still contains its header.
- `npm run dataset:dry-run` reads only that manifest and compares its rows with PostgreSQL using SELECT statements only. It never inserts, updates, or deletes rows. Conflicts, missing mappings, unresolved activity/assessment lesson IDs, or missing provenance stop the dry-run with a non-zero exit code.
- The real dataset importer must only be used after the manifest and dry-run are reviewed and explicit approvals are present. No current row is approved, and no live import is authorized by this workflow document.

The Roman Mundari values, category names, source-book names, and source provenance must remain exactly as supplied unless a human reviewer documents a decision. In particular, the workflow must not select between `Daḥ` and `Da`, or between `Hisi` and `Migel`, and must not silently merge phrase categories or textbook source-book identities.
