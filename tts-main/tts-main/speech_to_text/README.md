# SIH26042 - Hindi Speech Recognition (ASR)

This module is the first part of the SIH26042 project. It focuses only on Module 1: Hindi Speech Recognition.

## What this module does

- Reads a Hindi audio file placed in the `input/` folder
- Uses `faster-whisper` with the Whisper `small` model
- Sets the language to Hindi (`hi`)
- Recognizes the spoken Hindi text
- Prints the recognized text in the terminal
- Saves the text into `output/hindi_transcription.txt`

This is a local prototype for Windows 11 using CPU only. It does not include translation, Mundari text generation, Mundari TTS, or any web app.

## Folder explanation

- `input/` - place the Hindi audio file here
- `output/` - the recognized text is saved here
- `hindi_asr.py` - Python script that performs ASR
- `requirements.txt` - required Python packages
- `README.md` - instructions for this module

## Install dependencies

Open a terminal in the project folder and run:

```bash
cd SIH26042/speech_to_text
python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

If you are using PowerShell, the activation command is:

```powershell
.\.venv\Scripts\Activate.ps1
```

## Put an audio file in the input folder

Place any supported Hindi audio file inside:

```text
SIH26042/speech_to_text/input/
```

Supported types:
- `.wav`
- `.mp3`
- `.m4a`
- `.flac`

Example:

```text
SIH26042/speech_to_text/input/hindi.wav
```

## Run the program

From the project folder:

```bash
cd SIH26042/speech_to_text
.venv\Scripts\activate
python hindi_asr.py
```

## Example input

This is the type of Hindi speech the model expects:

```text
मेरा नाम कलई है। मैं तमिलनाडु में रहता हूँ।
```

## Example output

Terminal output:

```text
========================================
   SIH26042 - Hindi Speech Recognition
========================================

Audio file: input/hindi.wav

Detected language: Hindi

Recognized Hindi Text:
मेरा नाम कलई है। मैं तमिलनाडु में रहता हूँ।

Transcription saved to:
output/hindi_transcription.txt

========================================
       ASR COMPLETED
========================================
```

Saved file content:

```text
मेरा नाम कलई है। मैं तमिलनाडु में रहता हूँ।
```

## Important notes

- The script automatically picks the first supported audio file in the `input/` folder.
- It uses CPU mode and the `small` Whisper model for the first prototype.
- It is intentionally simple and beginner-friendly.
- Translation and TTS are not included yet because this module is only ASR.
