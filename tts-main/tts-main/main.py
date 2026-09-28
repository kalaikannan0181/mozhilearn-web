from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

PROJECT_ROOT = Path(__file__).resolve().parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from hindi_to_mundari.text_forms import build_text_forms, format_translation_output


def load_module_from_path(module_name: str, file_path: Path):
    """Load an existing Python module from its file path.

    This keeps the pipeline connected to the current ASR and translator files
    without copying their code into main.py.
    """
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load module: {file_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


asr_module = load_module_from_path(
    "speech_to_text.hindi_asr",
    PROJECT_ROOT / "speech_to_text" / "hindi_asr.py",
)
translator_module = load_module_from_path(
    "hindi_to_mundari.translator",
    PROJECT_ROOT / "hindi_to_mundari" / "translator.py",
)
database_module = load_module_from_path(
    "hindi_to_mundari.database",
    PROJECT_ROOT / "hindi_to_mundari" / "database.py",
)

find_audio_file = asr_module.find_audio_file
transcribe_hindi_audio = asr_module.transcribe_hindi_audio
InvalidAudioError = asr_module.InvalidAudioError
ModelLoadError = asr_module.ModelLoadError
TranscriptionError = asr_module.TranscriptionError

translate_hindi_to_mundari = translator_module.translate_hindi_to_mundari
create_database = database_module.create_database
load_processed_dataset = database_module.load_processed_dataset
find_translation = database_module.find_translation


def save_output(output_text: str, path: Path):
    """Save final merged pipeline result to a text file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(output_text, encoding="utf-8")


def run_pipeline(
    audio_path: Path | None = None,
    output_root: Path | None = None,
    initialize_database: bool = True,
):
    """Run the end-to-end pipeline:
    audio -> Hindi ASR -> Hindi text -> Mundari translation -> final output
    """
    current_audio_path = audio_path

    if current_audio_path is None:
        asr_input_dir = PROJECT_ROOT / "speech_to_text" / "input"
        try:
            current_audio_path = find_audio_file(asr_input_dir)
        except FileNotFoundError as exc:
            print("Error: No audio file found.")
            print(f"Please place a Hindi audio file in: {asr_input_dir}")
            return 1
        except InvalidAudioError as exc:
            print("Error: Invalid audio file.")
            print(str(exc))
            return 1

    if current_audio_path.suffix.lower() not in {".wav", ".mp3", ".m4a", ".flac"}:
        print("Error: Unsupported audio format.")
        print("Supported formats: .wav, .mp3, .m4a, .flac")
        return 1

    if not current_audio_path.exists():
        print("Error: Audio file not found.")
        print(f"File missing: {current_audio_path}")
        return 1

    if current_audio_path.stat().st_size <= 0:
        print("Error: Invalid or corrupted audio file.")
        print(f"The file is empty: {current_audio_path.name}")
        return 1

    try:
        hindi_text = transcribe_hindi_audio(current_audio_path)
    except ModelLoadError as exc:
        print("Error: Hindi ASR model could not be loaded.")
        print(str(exc))
        return 1
    except (InvalidAudioError, TranscriptionError) as exc:
        print("Error: Hindi speech could not be recognized.")
        print(str(exc))
        return 1

    if not hindi_text or not hindi_text.strip():
        print("Error: Empty Hindi transcription.")
        return 1

    if initialize_database:
        try:
            create_database()
            load_processed_dataset()
        except Exception as exc:
            print("Error: Database missing or database connection error.")
            print(str(exc))
            return 1

    translated = find_translation(hindi_text)

    if translated is None:
        translated = {
            "mundari_roman": None,
            "mundari_bani": None,
            "source": "none",
            "verified": 0,
        }

    forms = build_text_forms(translated)
    translation_status = (
        "Verified database translation"
        if translated and translated.get("verified") == 1
        else "Translation not found in verified database."
    )
    final_text = format_translation_output(hindi_text, forms, translation_status)
    output_root = Path(output_root) if output_root is not None else PROJECT_ROOT

    # Keep module 1 output in its expected location.
    asr_output_file = output_root / "speech_to_text" / "output" / "hindi_transcription.txt"
    asr_output_file.parent.mkdir(parents=True, exist_ok=True)
    asr_output_file.write_text(hindi_text, encoding="utf-8")

    # Save final merged result in the project root output folder.
    project_output_dir = output_root / "output"
    project_output_dir.mkdir(parents=True, exist_ok=True)
    final_output_path = project_output_dir / "final_translation.txt"
    save_output(final_text, final_output_path)

    print(final_text)
    print(f"Final result saved to: {final_output_path}")
    print(f"Hindi transcription saved to: {asr_output_file}")
    return 0


if __name__ == "__main__":
    print("Starting SIH26042 Hindi speech → Hindi text → Mundari text pipeline...")
    try:
        raise SystemExit(run_pipeline())
    except KeyboardInterrupt:
        print("\nPipeline stopped by user.")
        raise SystemExit(1)
