CREATE TABLE IF NOT EXISTS offline_packs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  language VARCHAR(50) NOT NULL,
  grade INTEGER NOT NULL CHECK (grade > 0),
  version INTEGER NOT NULL CHECK (version > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS offline_pack_lessons (
  pack_id INTEGER NOT NULL REFERENCES offline_packs(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id),
  PRIMARY KEY (pack_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS offline_packs_lookup_idx
  ON offline_packs (language, grade, status, version DESC);

CREATE INDEX IF NOT EXISTS offline_pack_lessons_lesson_id_idx
  ON offline_pack_lessons (lesson_id);
