CREATE TABLE IF NOT EXISTS generated_worksheets (
  id SERIAL PRIMARY KEY,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content_json JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ai_generated', 'teacher_reviewed', 'approved', 'published')) DEFAULT 'ai_generated',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source_lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  source_translation_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  generator_version TEXT NOT NULL DEFAULT '1.0.0',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS generated_worksheets_lesson_id_idx ON generated_worksheets (lesson_id);
CREATE INDEX IF NOT EXISTS generated_worksheets_status_idx ON generated_worksheets (status);
CREATE INDEX IF NOT EXISTS generated_worksheets_created_by_idx ON generated_worksheets (created_by);

CREATE TABLE IF NOT EXISTS generated_flashcards (
  id SERIAL PRIMARY KEY,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Lesson Flashcards',
  content_json JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ai_generated', 'teacher_reviewed', 'approved', 'published')) DEFAULT 'ai_generated',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source_lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  source_translation_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  generator_version TEXT NOT NULL DEFAULT '1.0.0',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS generated_flashcards_lesson_id_idx ON generated_flashcards (lesson_id);
CREATE INDEX IF NOT EXISTS generated_flashcards_status_idx ON generated_flashcards (status);
CREATE INDEX IF NOT EXISTS generated_flashcards_created_by_idx ON generated_flashcards (created_by);
