# Class 1 Lesson 1 Dataset Review Report

## Final status

READY FOR REVIEW

## Scope

This review covers the normalized Class 1 Lesson 1 dataset derived from the lesson source materials and the verified Hindi → Mundari Roman baseline.

No live import was performed. No PostgreSQL insert, update, or delete operation was executed during this review stage.

## Verified baseline preserved

- आम → Uli
- केला → Kela
- एक → Miyad
- दो → Bariya
- तीन → Apiya
- चार → Upuna
- पाँच → Moreya
- "यहाँ कितने आम हैं?" → "Nere chimina uli mena?"
- "आम गिनो" → "Uli leka me"

## Review outcome

- The normalized CSV files under data/normalized were reviewed and kept in read-only approval state.
- Roman-script values were preserved exactly as they appear in source material and were not guessed or converted from Devanagari.
- Source provenance was retained for each row through the source_file, source_sheet, source_row, and notes fields.
- The database was not modified, and the import flow was not activated.

## Safe review classification

- Lessons: review-ready
- Lesson activities: review-ready
- Lesson assessments: review-ready
- Vocabulary: review-ready
- Classroom phrases: review-ready
- Number vocabulary: review-ready
- Textbook terms: review-ready

## Approval note

This dataset is ready for a later controlled import only after explicit approval and execution of a guarded dry-run/import step under the project’s documented rules. For this stage, the correct status is: READY FOR REVIEW.
