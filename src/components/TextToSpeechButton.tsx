import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type TtsStatus = "idle" | "loading" | "playing" | "unavailable" | "error";

export type TextToSpeechButtonProps = {
  text: string;
  language?: string;
  audioUrl?: string | null;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
};

export function TextToSpeechButton({
  text,
  language = "mundari",
  audioUrl,
  disabled = false,
  className = "",
  compact = true,
}: TextToSpeechButtonProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<TtsStatus>("idle");
  const [message, setMessage] = useState("Audio not available");

  useEffect(() => {
    if (!text || !text.trim()) {
      setStatus("unavailable");
      setMessage("Audio not available");
      return;
    }

    if (audioUrl) {
      setStatus("idle");
      setMessage("Play audio");
      return;
    }

    setStatus("unavailable");
    setMessage("Verified audio not available");
  }, [audioUrl, language, text]);

  const buttonLabel = useMemo(() => {
    if (status === "loading") return "Loading…";
    if (status === "playing") return "Playing…";
    if (status === "unavailable") return "Audio not available";
    return "Play";
  }, [status]);

  async function handlePlay() {
    if (disabled || !text || !text.trim()) {
      setStatus("unavailable");
      setMessage("Audio not available");
      return;
    }

    if (audioUrl) {
      try {
        setStatus("loading");
        if (!audioRef.current) {
          audioRef.current = new Audio(audioUrl);
        }
        audioRef.current.src = audioUrl;
        audioRef.current.currentTime = 0;
        await audioRef.current.play();
        setStatus("playing");
        setMessage("Playing audio");
      } catch {
        setStatus("error");
        setMessage("Unable to play audio");
      }
      return;
    }

    setStatus("unavailable");
    setMessage("Verified audio not available");
  }

  const isDisabled = disabled || status === "unavailable" || !text?.trim();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={handlePlay}
        disabled={isDisabled}
        className={[
          "inline-flex items-center gap-2 rounded-lg border text-sm font-medium transition-colors",
          compact ? "px-2.5 py-1.5" : "px-3 py-2",
          isDisabled ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400" : "border-forest-200 bg-forest-50 text-forest-700 hover:bg-forest-100",
        ].join(" ")}
      >
        {status === "playing" ? <Volume2 size={15} className="animate-pulse" /> : <Volume2 size={15} />}
        {buttonLabel}
      </button>
      {status === "unavailable" && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
          <VolumeX size={12} />
          {message}
        </span>
      )}
    </div>
  );
}
