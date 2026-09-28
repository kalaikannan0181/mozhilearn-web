import { AlertTriangle, BookOpen, CheckCircle2, LoaderCircle, Mic, Square, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MundariPlayButton } from "./MundariPlayButton";
import { fetchClass1DemoContent, lookupClass1Hindi, transcribeHindiAudio, type Class1DemoContent, type Class1DemoItem } from "../lib/api";

type DemoMode = "live" | "demo";
type VoiceState = "IDLE" | "LISTENING" | "TRANSCRIBING" | "LOOKING_UP" | "VERIFIED" | "NOT_FOUND" | "ERROR";
type RecentMatch = { id: number; hindi: string; mundariRoman: string };

export function Class1VoiceDemoCard() {
  const [mode, setMode] = useState<DemoMode>("live");
  const [state, setState] = useState<VoiceState>("IDLE");
  const [content, setContent] = useState<Class1DemoContent | null>(null);
  const [contentError, setContentError] = useState("");
  const [hindiText, setHindiText] = useState("");
  const [selectedItem, setSelectedItem] = useState<Class1DemoItem | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingCancelledRef = useRef(false);
  const resultId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetchClass1DemoContent(controller.signal)
      .then((loaded) => { if (active) setContent(loaded); })
      .catch((caught) => {
        if (active && !(caught instanceof DOMException && caught.name === "AbortError")) {
          setContentError(caught instanceof Error ? caught.message : "Unable to load Class 1 lesson content.");
        }
      });
    return () => {
      active = false;
      controller.abort();
      recordingCancelledRef.current = true;
      if (mediaRecorderRef.current?.state !== "inactive") mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function startListening() {
    if (!content) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone recording is not supported in this browser.");
      setState("ERROR");
      return;
    }

    setError("");
    setFeedback("");
    setHindiText("");
    setSelectedItem(null);
    recordingCancelledRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      let recordingFailed = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        recordingFailed = true;
        setError("Microphone recording failed. Please try again.");
        setState("ERROR");
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        if (recordingCancelledRef.current || recordingFailed) return;
        const audio = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (!audio.size) {
          setError("No audio was recorded. Please try again.");
          setState("ERROR");
          return;
        }
        const extension = audio.type.toLowerCase().includes("mp4") ? "m4a" : "webm";
        void recognizeAndMatch(audio, `recording.${extension}`);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setState("LISTENING");
    } catch (caught) {
      const permissionDenied = caught instanceof DOMException && caught.name === "NotAllowedError";
      setError(permissionDenied
        ? "Microphone permission was denied. Allow microphone access and try again."
        : "The microphone could not start. Check your device settings and try again.");
      setState("ERROR");
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  }

  function stopListening() {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    if (state === "LISTENING") setState("TRANSCRIBING");
  }

  async function recognizeAndMatch(audio: Blob, filename: string) {
    setError("");
    setFeedback("");
    setState("TRANSCRIBING");
    try {
      const transcript = (await transcribeHindiAudio(audio, filename)).trim();
      if (!transcript) throw new Error("No Hindi speech was recognized. Please try again.");
      setHindiText(transcript);
      setState("LOOKING_UP");
      const lookup = await lookupClass1Hindi(transcript);
      const mundariRoman = lookup.mundari_roman;
      if (!lookup.success || !mundariRoman) {
        setSelectedItem(null);
        setFeedback("This phrase is not in the verified Class 1 demo dataset.");
        setState("NOT_FOUND");
        return;
      }

      const sourceItem = content && [...content.fruits, ...content.numbers, ...content.teacherScript, ...content.instructions]
        .find((item) => item.mundariRoman === lookup.mundari_roman);
      if (sourceItem) {
        setSelectedItem({ ...sourceItem, hindi: lookup.hindi_text || transcript, mundariRoman });
      } else {
        setSelectedItem(null);
      }
      setFeedback("Verified Class 1 phrase");
      setRecentMatches((current) => [{ id: ++resultId.current, hindi: transcript, mundariRoman }, ...current].slice(0, 4));
      setState("VERIFIED");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Hindi speech recognition failed.");
      setState("ERROR");
    }
  }

  async function selectDemoItem(item: Class1DemoItem) {
    setHindiText(item.hindi);
    setSelectedItem(null);
    setFeedback("");
    setError("");
    setState("LOOKING_UP");
    try {
      const lookup = await lookupClass1Hindi(item.hindi);
      if (!lookup.success || !lookup.mundari_roman) {
        setFeedback("This phrase is not in the verified Class 1 demo dataset.");
        setState("NOT_FOUND");
        return;
      }
      setSelectedItem({ ...item, hindi: lookup.hindi_text || item.hindi, mundariRoman: lookup.mundari_roman });
      setFeedback("Verified Class 1 phrase");
      setState("VERIFIED");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Class 1 phrase lookup failed.");
      setState("ERROR");
    }
  }

  function selectAudioFile(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.currentTarget.files?.[0] || null;
    event.currentTarget.value = "";
    if (!selectedFile) return;
    if (selectedFile.size > 30 * 1024 * 1024) {
      setError("Audio files must be 30 MB or smaller.");
      return;
    }

    setError("");
    setFeedback("");
    setHindiText("");
    setSelectedItem(null);
    setAudioFile(selectedFile);
    setState("IDLE");
  }

  function submitSelectedAudio() {
    if (!audioFile) return;
    void recognizeAndMatch(audioFile, audioFile.name);
  }

  const demoGroups = content ? [
    { label: "Fruit vocabulary", items: content.fruits },
    { label: "Numbers 1–5", items: content.numbers },
    { label: "Teacher script", items: content.teacherScript },
    { label: "Classroom commands", items: content.instructions },
    { label: "Lesson activities", items: content.activities },
    { label: "Assessment questions", items: content.assessments },
  ].filter((group) => group.items.length > 0) : [];
  const recognitionInProgress = state === "LISTENING" || state === "TRANSCRIBING" || state === "LOOKING_UP";

  return (
    <section className="mt-8 overflow-hidden rounded-xl border border-forest-200 bg-white shadow-[0_1px_3px_rgb(15_23_42/0.03)]" aria-labelledby="class1-voice-demo-title">
      <div className="border-b border-forest-100 bg-forest-50/70 px-5 py-5 sm:px-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-forest-700 uppercase">Class 1 · {content?.lesson.subject || "Foundational Numeracy"}</p>
            <h2 id="class1-voice-demo-title" className="mt-1 text-xl font-semibold text-slate-900">CLASS 1 — HINDI TO MUNDARI ROMAN</h2>
            <p className="mt-1 text-sm text-slate-600">{content?.lesson.title || "पाठ 1: फलों के नाम और 1 से 5 तक गिनती"}</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800">
            <AlertTriangle size={14} />TTS paused; verified Class 1 matches only
          </div>
        </div>

        <div className="mt-5 inline-flex rounded-lg border border-slate-200 bg-white p-1" role="group" aria-label="Voice demo mode">
          <button type="button" aria-pressed={mode === "live"} disabled={recognitionInProgress} onClick={() => { setMode("live"); setSelectedItem(null); setFeedback(""); }} className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold ${mode === "live" ? "bg-forest-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}><Mic size={15} />Live Voice</button>
          <button type="button" aria-pressed={mode === "demo"} disabled={recognitionInProgress} onClick={() => { setMode("demo"); setSelectedItem(null); setFeedback(""); }} className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold ${mode === "demo" ? "bg-forest-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}><BookOpen size={15} />Class 1 Demo</button>
        </div>
      </div>

      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div>
          {mode === "live" ? (
            <div>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                {state === "LISTENING" ? (
                  <button type="button" onClick={stopListening} className="inline-flex h-11 items-center gap-2 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800"><Square size={16} />Stop recording</button>
                ) : (
                  <button type="button" onClick={() => void startListening()} disabled={!content || recognitionInProgress} className="inline-flex h-11 items-center gap-2 rounded-lg bg-forest-700 px-4 text-sm font-semibold text-white hover:bg-forest-800 disabled:cursor-not-allowed disabled:opacity-60"><Mic size={17} />Start speaking</button>
                )}
                <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  <Upload size={16} />Choose audio
                  <input type="file" accept=".wav,.mp3,.m4a,.flac,.ogg,.webm,.mp4,.aac,audio/*" onChange={selectAudioFile} className="sr-only" />
                </label>
                {audioFile && <button type="button" onClick={submitSelectedAudio} disabled={recognitionInProgress} className="inline-flex h-11 items-center gap-2 rounded-lg border border-forest-200 bg-forest-50 px-4 text-sm font-semibold text-forest-800 disabled:opacity-50"><Upload size={16} />Transcribe</button>}
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase" aria-live="polite">Status: {state === "VERIFIED" ? "Verified Class 1 phrase" : state.replace(/_/g, " ")}</span>
              </div>
              <p className="mt-3 text-xs text-slate-500">Hindi audio is transcribed on the server with faster-whisper, then matched exactly to this lesson. Recognition is not browser speech recognition.</p>
              {audioFile && <p className="mt-2 truncate text-xs text-slate-500">Selected: {audioFile.name}</p>}
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2"><BookOpen size={16} className="text-forest-700" /><h3 className="text-sm font-semibold text-slate-900">Demo Phrases</h3></div>
              {contentError && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{contentError}</p>}
              {!content && !contentError && <p className="mt-3 text-sm text-slate-500">Loading verified Lesson 1 content…</p>}
              <div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {demoGroups.map((group) => (
                  <details key={group.label} open={mode === "demo"} className="rounded-lg border border-slate-200 bg-slate-50">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-700">{group.label} <span className="ml-1 text-xs font-normal text-slate-500">({group.items.length})</span></summary>
                    <div className="grid gap-2 border-t border-slate-200 p-2 sm:grid-cols-2">
                      {group.items.map((item) => (
                        <button key={item.id} type="button" onClick={() => void selectDemoItem(item)} disabled={recognitionInProgress} className={`min-h-14 rounded-md border px-3 py-2 text-left disabled:opacity-60 ${selectedItem?.id === item.id ? "border-forest-500 bg-forest-50" : "border-slate-200 bg-white hover:border-forest-300"}`}>
                          <span className="block text-sm font-semibold text-slate-800">{item.hindi}</span>
                          <span className="mt-0.5 block text-xs text-forest-800">{item.mundariRoman}</span>
                        </button>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">Hindi</p>
              <p className="mt-3 min-h-16 text-sm leading-6 text-slate-700">{hindiText || "Speak or select a Class 1 phrase."}</p>
            </div>
            <div className="rounded-lg border border-forest-100 bg-forest-50/50 p-4">
              <p className="text-xs font-bold tracking-widest text-forest-700 uppercase">Mundari Roman</p>
              <p className="mt-3 min-h-16 text-sm leading-6 text-slate-700">{selectedItem?.mundariRoman || (state === "NOT_FOUND" ? "Not available" : "Select a phrase or speak Hindi to find an exact lesson match.")}</p>
              {selectedItem && <MundariPlayButton text={selectedItem.mundariRoman} sourceType="class1-lookup" verified compact />}
            </div>
          </div>

          {feedback && <p role="status" className={`mt-3 text-sm ${state === "NOT_FOUND" ? "text-amber-800" : "text-forest-800"}`}>
            {state === "VERIFIED" && <CheckCircle2 size={14} className="mr-1 inline" />}{feedback}
          </p>}
          {selectedItem && <details className="mt-3 text-xs text-slate-600">
            <summary className="cursor-pointer font-semibold">Source and audio metadata</summary>
            <p className="mt-2">Source: {selectedItem.sourceFile}</p>
              {selectedItem.audioPrompt && <p className="mt-1">Audio Prompt source: {selectedItem.audioPrompt}</p>}
          </details>}
          {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <div className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-amber-800" role="status"><AlertTriangle size={14} />Only exact verified Class 1 matches are shown. TTS / Play remains disabled.</div>
        </div>

        <aside className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2"><BookOpen size={15} className="text-forest-700" /><h3 className="text-sm font-semibold text-slate-900">Recent Class 1 matches</h3></div>
          <div className="mt-3 space-y-3">
            {recentMatches.length === 0 && <p className="text-xs leading-5 text-slate-500">Exact matches from Live Voice will appear here.</p>}
            {recentMatches.map((match) => <div key={match.id} className="border-t border-slate-200 pt-3 first:border-t-0 first:pt-0"><p className="text-xs text-slate-600">{match.hindi}</p><p className="mt-1 text-xs font-semibold text-forest-800">{match.mundariRoman}</p></div>)}
          </div>
        </aside>
      </div>
    </section>
  );
}