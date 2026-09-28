from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

WORKSPACE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = WORKSPACE_ROOT / "tts-main"
ENTRYPOINT = PROJECT_ROOT / "main.py"

if not ENTRYPOINT.exists():
    raise FileNotFoundError(
        f"Project entrypoint not found at: {ENTRYPOINT}\n"
        "Please ensure the project folder is present in the workspace root."
    )

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Use the project's configured Python environment when available.
venv_python = PROJECT_ROOT / ".venv" / "Scripts" / "python.exe"
if venv_python.exists():
    python_executable = str(venv_python)
else:
    python_executable = sys.executable

child_env = os.environ.copy()
child_env["PYTHONIOENCODING"] = "utf-8"
child_env["PYTHONUTF8"] = "1"

os.chdir(PROJECT_ROOT)
result = subprocess.run([python_executable, str(ENTRYPOINT)], env=child_env, check=False)
raise SystemExit(result.returncode)

