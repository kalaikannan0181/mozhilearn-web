CREATE TABLE IF NOT EXISTS translations (
  id SERIAL PRIMARY KEY,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id),
  hindi_text TEXT NOT NULL,
  mundari_text TEXT NOT NULL,
  source VARCHAR(20) NOT NULL CHECK (source IN ('manual', 'ai')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'ai_generated', 'teacher_reviewed', 'native_reviewed', 'approved', 'rejected')
  ),
  teacher_notes TEXT,
  reviewer_notes TEXT,
  reviewer_id INTEGER,
  model_version VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS translations_lesson_id_idx
  ON translations (lesson_id);

CREATE INDEX IF NOT EXISTS translations_status_idx
  ON translations (status);
