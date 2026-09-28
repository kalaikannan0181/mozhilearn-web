ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE translations
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE offline_packs
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE translations
  DROP CONSTRAINT IF EXISTS translations_status_check;

ALTER TABLE translations
  ADD CONSTRAINT translations_status_check
  CHECK (status IN ('draft', 'ai_generated', 'teacher_reviewed', 'native_reviewed', 'approved', 'rejected', 'published'));

CREATE INDEX IF NOT EXISTS lessons_created_by_idx ON lessons (created_by);
CREATE INDEX IF NOT EXISTS translations_created_by_idx ON translations (created_by);
CREATE INDEX IF NOT EXISTS offline_packs_created_by_idx ON offline_packs (created_by);

CREATE TABLE IF NOT EXISTS offline_pack_vocabulary (
  pack_id INTEGER NOT NULL REFERENCES offline_packs(id) ON DELETE CASCADE,
  vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id),
  PRIMARY KEY (pack_id, vocabulary_id)
);

CREATE TABLE IF NOT EXISTS offline_pack_classroom_phrases (
  pack_id INTEGER NOT NULL REFERENCES offline_packs(id) ON DELETE CASCADE,
  classroom_phrase_id INTEGER NOT NULL REFERENCES classroom_phrases(id),
  PRIMARY KEY (pack_id, classroom_phrase_id)
);

CREATE TABLE IF NOT EXISTS offline_pack_textbook_terms (
  pack_id INTEGER NOT NULL REFERENCES offline_packs(id) ON DELETE CASCADE,
  textbook_term_id INTEGER NOT NULL REFERENCES textbook_terms(id),
  PRIMARY KEY (pack_id, textbook_term_id)
);

CREATE TABLE IF NOT EXISTS offline_pack_number_vocabulary (
  pack_id INTEGER NOT NULL REFERENCES offline_packs(id) ON DELETE CASCADE,
  number_vocabulary_id INTEGER NOT NULL REFERENCES number_vocabulary(id),
  PRIMARY KEY (pack_id, number_vocabulary_id)
);
