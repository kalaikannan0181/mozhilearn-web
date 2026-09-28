DO $$
DECLARE
  target_table TEXT;
  target_tables TEXT[] := ARRAY['lessons', 'lesson_activities', 'lesson_assessments', 'vocabulary', 'classroom_phrases', 'textbook_terms', 'number_vocabulary'];
BEGIN
  FOREACH target_table IN ARRAY target_tables LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS source TEXT', target_table);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS source_reference TEXT', target_table);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL DEFAULT ''raw''', target_table);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL', target_table);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS reviewer_notes TEXT', target_table);
  END LOOP;
END $$;

DO $$
DECLARE
  target_table TEXT;
  constraint_name TEXT;
  target_tables TEXT[] := ARRAY['lessons', 'lesson_activities', 'lesson_assessments', 'vocabulary', 'classroom_phrases', 'textbook_terms', 'number_vocabulary'];
BEGIN
  FOREACH target_table IN ARRAY target_tables LOOP
    constraint_name := target_table || '_validation_status_check';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = constraint_name) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (validation_status IN (''raw'', ''machine_generated'', ''teacher_reviewed'', ''native_reviewed'', ''approved''))',
        target_table,
        constraint_name
      );
    END IF;
  END LOOP;
END $$;
