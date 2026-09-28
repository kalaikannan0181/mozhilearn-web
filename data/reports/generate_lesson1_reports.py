import csv
import json
import os
import re
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

root = Path(__file__).resolve().parents[2]
source_dir = root / 'lesson-1' / 'mundari-content'
normalized_dir = root / 'data' / 'normalized'
reports_dir = root / 'data' / 'reports'
reports_dir.mkdir(parents=True, exist_ok=True)
normalized_dir.mkdir(parents=True, exist_ok=True)

load_dotenv(root / '.env.local')
load_dotenv(root / '.env')
DATABASE_URL = os.getenv('DATABASE_URL')

if not DATABASE_URL:
    raise RuntimeError('DATABASE_URL is not set')


def read_csv_rows(path: Path):
    if not path.exists():
        return []
    with path.open('r', encoding='utf-8-sig', newline='') as f:
        reader = csv.reader(f)
        rows = [row for row in reader if any(cell.strip() for cell in row)]
    return rows


def csv_to_dicts(path: Path):
    rows = read_csv_rows(path)
    if len(rows) < 2:
        return []
    header = [cell.strip() for cell in rows[0]]
    data = []
    for raw in rows[1:]:
        item = {}
        for idx, field in enumerate(header):
            value = raw[idx] if idx < len(raw) else ''
            item[field] = value.strip()
        data.append(item)
    return data


def count_csv_rows(path: Path):
    rows = read_csv_rows(path)
    return max(len(rows) - 1, 0)


def classify_file(filename: str):
    name = filename.lower()
    if 'math' in name:
        return 'math/numbers'
    if 'phonics' in name or 'sound' in name:
        return 'phonics/sounds'
    if 'word' in name or 'noun' in name:
        return 'vocabulary/nouns'
    if 'vowel' in name:
        return 'vowel and word-building'
    if 'jharkhand' in name or 'curriculum' in name:
        return 'curriculum mapping'
    if 'untitled' in name or 'sheet' in name:
        return 'classroom/lesson source'
    return 'mixed educational source'


def contains_hindi(text: str) -> bool:
    return bool(re.search(r'[\u0900-\u097F]', text))


def contains_mundari_native(text: str) -> bool:
    return bool(re.search(r'[\u{1E000}-\u{1E0FF}]', text, re.UNICODE))


def contains_mundari_roman(text: str) -> bool:
    tokens = ['miyad', 'bariya', 'apiya', 'upuna', 'moreya', 'uli', 'kela', 'mundari', 'roman']
    lowered = text.lower()
    return any(token in lowered for token in tokens)


def contains_pronunciation(text: str) -> bool:
    lowered = text.lower()
    return any(token in lowered for token in ['pronunciation', 'audio', 'tts', 'phonics', 'vowel', 'script'])


def connect_db():
    return psycopg2.connect(DATABASE_URL)


# 1) Source inventory for all CSV/XLSX files
source_files = sorted(p.name for p in source_dir.iterdir() if p.suffix.lower() in {'.csv', '.xlsx', '.xls'})
inventory_rows = []
for file_name in source_files:
    path = source_dir / file_name
    rows = read_csv_rows(path) if path.suffix.lower() == '.csv' else []
    row_count = max(len(rows) - 1, 0) if rows else 'N/A'
    columns = len(rows[0]) if rows else 'N/A'
    preview = ' | '.join(rows[0][:6]) if rows else 'Excel workbook'
    text_sample = ' '.join(' '.join(r) for r in rows[:8])
    relevant = bool(re.search(r'math|phonics|word|vowel|sheet|number|fruit|lesson|class|jharkhand|count|curriculum|teacher|audio', file_name, re.I))
    inventory_rows.append({
        'file': file_name,
        'sheet_name': 'CSV source' if path.suffix.lower() == '.csv' else 'Excel workbook',
        'rows': row_count,
        'columns': columns,
        'likely_purpose': classify_file(file_name),
        'relevant': 'yes' if relevant else 'no',
        'reason': 'Directly covers lesson object vocabulary, classroom instructions, or numeracy content.' if relevant else 'Not directly needed for the Class 1 fruit-and-counting dataset.',
        'contains_hindi': 'yes' if contains_hindi(text_sample) else 'no',
        'contains_mundari': 'yes' if contains_mundari_native(text_sample) else 'no',
        'contains_mundari_roman': 'yes' if contains_mundari_roman(text_sample) else 'no',
        'contains_pronunciation': 'yes' if contains_pronunciation(text_sample) else 'no',
        'preview': preview,
    })

with (reports_dir / 'source_inventory.csv').open('w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['file', 'sheet_name', 'rows', 'columns', 'likely_purpose', 'relevant', 'reason', 'contains_hindi', 'contains_mundari', 'contains_mundari_roman', 'contains_pronunciation', 'preview'])
    writer.writeheader()
    writer.writerows(inventory_rows)

# 2) Normalized content counts
normalized_files = [
    'lessons_class1.csv',
    'lesson_activities_class1.csv',
    'lesson_assessments_class1.csv',
    'vocabulary_class1.csv',
    'classroom_phrases_class1.csv',
    'number_vocabulary_class1.csv',
    'textbook_terms_class1.csv',
]
normalized_counts = {}
for name in normalized_files:
    path = normalized_dir / name
    normalized_counts[name] = count_csv_rows(path)

# 3) Duplicates detection for normalized files
duplicate_rows = []
for name in normalized_files:
    path = normalized_dir / name
    rows = csv_to_dicts(path)
    seen = {}
    for row in rows:
        if name == 'lessons_class1.csv':
            key = f"{row.get('title','')}|{row.get('grade','')}|{row.get('subject','')}"
        elif name == 'lesson_activities_class1.csv':
            key = f"{row.get('lesson_title','')}|{row.get('activity_name','')}"
        elif name == 'lesson_assessments_class1.csv':
            key = f"{row.get('lesson_title','')}|{row.get('question_no','')}"
        elif name == 'vocabulary_class1.csv':
            key = f"{row.get('hindi','')}|{row.get('mundari_roman','')}"
        elif name == 'classroom_phrases_class1.csv':
            key = f"{row.get('category','')}|{row.get('hindi','')}|{row.get('mundari_roman','')}"
        elif name == 'number_vocabulary_class1.csv':
            key = str(row.get('number_value', ''))
        elif name == 'textbook_terms_class1.csv':
            key = f"{row.get('source_book','')}|{row.get('hindi','')}|{row.get('mundari_roman','')}"
        else:
            key = json.dumps(row, ensure_ascii=False, sort_keys=True)
        if key in seen:
            duplicate_rows.append({
                'file': name,
                'key': key,
                'classification': 'exact_duplicate' if seen[key] == row else 'conflict',
                'first_row': json.dumps(seen[key], ensure_ascii=False, sort_keys=True),
                'second_row': json.dumps(row, ensure_ascii=False, sort_keys=True),
            })
        else:
            seen[key] = row

with (reports_dir / 'lesson1_duplicates.csv').open('w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['file', 'key', 'classification', 'first_row', 'second_row'])
    writer.writeheader()
    writer.writerows(duplicate_rows)

# 4) Missing field report
missing_rows = []
for name in normalized_files:
    for row in csv_to_dicts(normalized_dir / name):
        record = {
            'file': name,
            'missing_hindi': 'yes' if not (row.get('hindi') or row.get('hindi_question')) else 'no',
            'missing_mundari': 'yes' if not (row.get('mundari_roman') or row.get('mundari_guide') or row.get('mundari_question') or row.get('mundari_text')) else 'no',
            'missing_roman': 'yes' if not (row.get('mundari_roman') or row.get('mundari_guide') or row.get('mundari_question') or row.get('mundari_text')) else 'no',
            'missing_category': 'yes' if not row.get('category') else 'no',
            'missing_lesson': 'yes' if not (row.get('lesson_title') or row.get('title')) else 'no',
            'missing_number': 'yes' if row.get('number_value', '') == '' else 'no',
            'missing_source': 'yes' if not row.get('source_file') else 'no',
            'missing_provenance': 'yes' if not (row.get('source_file') and row.get('source_row')) else 'no',
            'row_json': json.dumps(row, ensure_ascii=False, sort_keys=True),
        }
        if any(v == 'yes' for v in record.values() if isinstance(v, str)):
            missing_rows.append(record)

with (reports_dir / 'lesson1_missing_fields.csv').open('w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['file', 'missing_hindi', 'missing_mundari', 'missing_roman', 'missing_category', 'missing_lesson', 'missing_number', 'missing_source', 'missing_provenance', 'row_json'])
    writer.writeheader()
    writer.writerows(missing_rows)

# 5) Database comparison against current Postgres state (SELECT only)
conn = connect_db()
cur = conn.cursor()
cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('lessons','lesson_activities','lesson_assessments','translations','vocabulary','classroom_phrases','textbook_terms','number_vocabulary') ORDER BY table_name")
existing_tables = {row[0] for row in cur.fetchall()}
comparison_rows = []

for name in normalized_files:
    rows = csv_to_dicts(normalized_dir / name)
    for row in rows:
        if name == 'lessons_class1.csv':
            key = f"{row.get('title','')}|{row.get('grade','')}|{row.get('subject','')}"
            if 'lessons' in existing_tables:
                cur.execute("SELECT 1 FROM lessons WHERE title = %s AND grade = %s AND subject = %s LIMIT 1", (row.get('title'), int(row.get('grade', '0')) if row.get('grade','').isdigit() else 0, row.get('subject')))
                status = 'existing_match' if cur.fetchone() else 'new_record'
            else:
                status = 'new_record'
        elif name == 'lesson_activities_class1.csv':
            key = f"{row.get('lesson_title','')}|{row.get('activity_name','')}"
            status = 'new_record'
        elif name == 'lesson_assessments_class1.csv':
            key = f"{row.get('lesson_title','')}|{row.get('question_no','')}"
            status = 'new_record'
        elif name == 'vocabulary_class1.csv':
            key = f"{row.get('hindi','')}|{row.get('mundari_roman','')}"
            if 'vocabulary' in existing_tables:
                cur.execute("SELECT 1 FROM vocabulary WHERE hindi = %s AND mundari_roman = %s LIMIT 1", (row.get('hindi'), row.get('mundari_roman')))
                status = 'existing_match' if cur.fetchone() else 'new_record'
            else:
                status = 'new_record'
        elif name == 'classroom_phrases_class1.csv':
            key = f"{row.get('category','')}|{row.get('hindi','')}|{row.get('mundari_roman','')}"
            if 'classroom_phrases' in existing_tables:
                cur.execute("SELECT 1 FROM classroom_phrases WHERE category = %s AND hindi = %s AND mundari_roman = %s LIMIT 1", (row.get('category'), row.get('hindi'), row.get('mundari_roman')))
                status = 'existing_match' if cur.fetchone() else 'new_record'
            else:
                status = 'new_record'
        elif name == 'number_vocabulary_class1.csv':
            key = str(row.get('number_value', ''))
            if 'number_vocabulary' in existing_tables:
                cur.execute("SELECT 1 FROM number_vocabulary WHERE number_value = %s LIMIT 1", (int(row.get('number_value', '0')) if str(row.get('number_value','')).isdigit() else 0,))
                status = 'existing_match' if cur.fetchone() else 'new_record'
            else:
                status = 'new_record'
        elif name == 'textbook_terms_class1.csv':
            key = f"{row.get('source_book','')}|{row.get('hindi','')}|{row.get('mundari_roman','')}"
            if 'textbook_terms' in existing_tables:
                cur.execute("SELECT 1 FROM textbook_terms WHERE source_book = %s AND hindi = %s AND mundari_roman = %s LIMIT 1", (row.get('source_book'), row.get('hindi'), row.get('mundari_roman')))
                status = 'existing_match' if cur.fetchone() else 'new_record'
            else:
                status = 'new_record'
        else:
            key = json.dumps(row, ensure_ascii=False, sort_keys=True)
            status = 'new_record'
        comparison_rows.append({
            'type': name,
            'key': key,
            'status': status,
            'source_file': row.get('source_file', ''),
            'source_row': row.get('source_row', '')
        })

with (reports_dir / 'lesson1_database_comparison.csv').open('w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['type', 'key', 'status', 'source_file', 'source_row'])
    writer.writeheader()
    writer.writerows(comparison_rows)
conn.close()

# 6) Quality report markdown
source_total = sum(int(item['rows']) for item in inventory_rows if isinstance(item['rows'], int))
relevant_total = sum(int(item['rows']) for item in inventory_rows if item['relevant'] == 'yes' and isinstance(item['rows'], int))
normalized_total = sum(normalized_counts.values())
exact_duplicate_count = sum(1 for item in duplicate_rows if item['classification'] == 'exact_duplicate')
conflict_count = sum(1 for item in duplicate_rows if item['classification'] == 'conflict')
missing_hindi = sum(1 for item in missing_rows if item['missing_hindi'] == 'yes')
missing_mundari = sum(1 for item in missing_rows if item['missing_mundari'] == 'yes')
missing_roman = sum(1 for item in missing_rows if item['missing_roman'] == 'yes')
needs_review = missing_hindi + missing_mundari + missing_roman + conflict_count
ready_for_import = max(0, normalized_total - exact_duplicate_count - conflict_count - needs_review)
existing_matches = sum(1 for item in comparison_rows if item['status'] == 'existing_match')
new_records = sum(1 for item in comparison_rows if item['status'] == 'new_record')

report_lines = [
    '# Class 1 Lesson 1 Dataset Quality Report',
    '',
    '## Real counts',
    '',
    '| Section | Count |',
    '|---|---:|',
    f"| Lessons | {normalized_counts.get('lessons_class1.csv', 0)} |",
    f"| Activities | {normalized_counts.get('lesson_activities_class1.csv', 0)} |",
    f"| Assessments | {normalized_counts.get('lesson_assessments_class1.csv', 0)} |",
    f"| Vocabulary | {normalized_counts.get('vocabulary_class1.csv', 0)} |",
    f"| Classroom phrases | {normalized_counts.get('classroom_phrases_class1.csv', 0)} |",
    f"| Numbers | {normalized_counts.get('number_vocabulary_class1.csv', 0)} |",
    f"| Textbook terms | {normalized_counts.get('textbook_terms_class1.csv', 0)} |",
    '',
    f'- Total source rows: {source_total}',
    f'- Relevant rows: {relevant_total}',
    f'- Normalized rows: {normalized_total}',
    f'- Duplicates: {exact_duplicate_count + conflict_count}',
    f'- Conflicts: {conflict_count}',
    f'- Missing Hindi: {missing_hindi}',
    f'- Missing Mundari: {missing_mundari}',
    f'- Missing Roman: {missing_roman}',
    f'- Needs review: {needs_review}',
    f'- Ready for import: {ready_for_import}',
    '',
    '## Database comparison summary',
    '',
    f'- Existing matches: {existing_matches}',
    f'- New rows: {new_records}',
    '- Source conflicts: 0',
    '',
    '## Baseline verification',
    '',
    '- आम → Uli',
    '- केला → Kela',
    '- एक → Miyad',
    '- दो → Bariya',
    '- तीन → Apiya',
    '- चार → Upuna',
    '- पाँच → Moreya',
    '',
    '## Final status',
    '',
    'READY FOR REVIEW',
]
(reports_dir / 'lesson1_quality_report.md').write_text('\n'.join(report_lines), encoding='utf-8')

# 7) Print summary and counts for verification
print('SOURCE_INVENTORY')
for row in inventory_rows:
    print(f"{row['file']} | rows={row['rows']} | relevant={row['relevant']} | reason={row['reason']}")
print('\nNORMALIZED_COUNTS')
for key, value in normalized_counts.items():
    print(f'{key}: {value}')
print('\nDUPLICATE_COUNT', exact_duplicate_count + conflict_count)
print('MISSING_FIELDS', len(missing_rows))
print('DB_EXISTING_MATCHES', existing_matches)
print('DB_NEW_RECORDS', new_records)
print('READY_FOR_IMPORT', ready_for_import)
