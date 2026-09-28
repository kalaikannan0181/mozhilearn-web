import os
import sys
from pathlib import Path

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

PROJECT_ROOT = Path(__file__).resolve().parent
os.chdir(PROJECT_ROOT)
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from hindi_to_mundari.database import load_processed_dataset, find_translation, get_all_translations

print('imported:', load_processed_dataset())
print('count:', len(get_all_translations()))
print('match:', find_translation('वे भी कमजोर पड़ रहे हैं'))
print('match2:', find_translation('नमस्ते'))
