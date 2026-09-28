from pathlib import Path
import os

try:
    from faster_whisper import WhisperModel
except Exception as import_error:  # If the package is missing, we show a clear message.
    WhisperModel = None
    WHISPER_IMPORT_ERROR = import_error
else:
    WHISPER_IMPORT_ERROR = None

SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac"}
_MODEL = None
_MODEL_LOAD_ERROR = None


class InvalidAudioError(Exception):
    """Raised when the selected file is missing or not a valid audio file."""


class ModelLoadError(Exception):
    """Raised when the Whisper model cannot be loaded."""


class TranscriptionError(Exception):
    """Raised when transcription fails."""


def initialize_model():
    """Load and cache Whisper once for the lifetime of this Python process."""
    global _MODEL, _MODEL_LOAD_ERROR
    if _MODEL is not None:
        return _MODEL
    if _MODEL_LOAD_ERROR is not None:
        raise _MODEL_LOAD_ERROR
    if WhisperModel is None:
        _MODEL_LOAD_ERROR = ModelLoadError("faster-whisper is unavailable")
        raise _MODEL_LOAD_ERROR
    try:
        model_name = os.environ.get('ASR_MODEL', 'small')
        _MODEL = WhisperModel(model_name, device='cpu', compute_type='int8')
    except Exception as exc:
        _MODEL_LOAD_ERROR = ModelLoadError('Whisper model could not be initialized')
        raise _MODEL_LOAD_ERROR from exc
    return _MODEL


def print_banner():
    print("=" * 40)
    print("   SIH26042 - Hindi Speech Recognition")
    print("=" * 40)


def find_audio_file(input_dir: Path) -> Path:
    """Find the first supported audio file in the input folder."""
    if not input_dir.exists():
        raise FileNotFoundError(f"Input folder not found: {input_dir}")

    audio_files = []
    for file in input_dir.iterdir():
        if file.is_file() and file.suffix.lower() in SUPPORTED_EXTENSIONS:
            audio_files.append(file)

    if not audio_files:
        raise FileNotFoundError(
            "No supported audio file found in input/. Supported types: .wav, .mp3, .m4a, .flac"
        )

    chosen_file = sorted(audio_files, key=lambda f: f.name.lower())[0]

    if chosen_file.stat().st_size <= 0:
        raise InvalidAudioError(f"Audio file is empty or invalid: {chosen_file.name}")

    return chosen_file


def transcribe_hindi_audio(audio_file: Path) -> str:
    """Transcribe in Hindi using the process-wide cached Whisper model."""
    model = initialize_model()

    try:
        segments, _ = model.transcribe(str(audio_file), language="hi")
        transcript = " ".join(segment.text for segment in segments).strip()
    except Exception as exc:
        raise TranscriptionError(f"Transcription failed: {exc}") from exc

    if not transcript:
        raise InvalidAudioError("No recognizable Hindi speech was detected in the audio file.")

    return transcript


def main():
    print_banner()

    base_dir = Path(__file__).resolve().parent
    input_dir = base_dir / "input"
    output_dir = base_dir / "output"
    output_dir.mkdir(exist_ok=True)

    try:
        audio_file = find_audio_file(input_dir)
    except FileNotFoundError as exc:
        print("\nError: Audio file not found.")
        print(f"{exc}")
        print("\nPlease place a Hindi audio file in: input/")
        return
    except InvalidAudioError as exc:
        print("\nError: Invalid audio file.")
        print(f"{exc}")
        return

    # Show the user which file was selected.
    print(f"\nAudio file: {audio_file.relative_to(base_dir).as_posix()}")
    print("\nDetected language: Hindi")

    try:
        transcript = transcribe_hindi_audio(audio_file)
    except ModelLoadError as exc:
        print("\nError: Model loading error.")
        print(str(exc))
        return
    except (InvalidAudioError, TranscriptionError) as exc:
        print("\nError: Transcription error.")
        print(str(exc))
        return

    print("\nRecognized Hindi Text:")
    print(transcript)

    output_file = output_dir / "hindi_transcription.txt"
    try:
        output_file.write_text(transcript, encoding="utf-8")
    except OSError as exc:
        print("\nError: Could not save transcription.")
        print(str(exc))
        return

    print("\nTranscription saved to:")
    print(output_file.relative_to(base_dir).as_posix())
    print("=" * 40)
    print("       ASR COMPLETED")
    print("=" * 40)


if __name__ == "__main__":
    main()
