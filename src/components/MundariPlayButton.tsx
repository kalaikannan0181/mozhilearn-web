import { Loader2, Volume2, VolumeX } from "lucide-react";
import { useMemo, useState } from "react";
import { playAudioUrl, speakMundari, stopMundari } from "../services/tts";

export type MundariPlayButtonProps = {
  text?: string;
  ttsInput?: string;
  ttsInputScript?: string;
  sourceType?: string;
  sourceId?: number;
  verified?: boolean;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
};

export function MundariPlayButton({
  text,
  ttsInput,
  ttsInputScript,
  sourceType,
  sourceId,
  verified,
  disabled = false,
  className = "",
  compact = true,
}: MundariPlayButtonProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "unavailable" | "error">("idle");
  const [message, setMessage] = useState("Play Mundari");

  const enabledText = useMemo(() => (text || "").trim(), [text]);
  const isVerified = verified ?? ["library", "class1-lookup"].includes(sourceType || "");
  const isVerifiedRoman = /\p{Script=Latin}/u.test(enabledText) && !/[\p{Script=Devanagari}]/u.test(enabledText);

  async function handlePlay() {
    if (disabled || !isVerified || !enabledText || !isVerifiedRoman) {
      setStatus("unavailable");
      setMessage("Verified Mundari Roman translation required.");
      return;
    }

    setStatus("loading");
    setMessage("Generating...");

    try {
      const result = await speakMundari({
        source_text: text,
        mundari_roman: enabledText,
        tts_input: ttsInput,
        tts_input_script: ttsInputScript,
        source_type: sourceType,
        source_id: sourceId,
      });

      if (!result.success || !result.audioUrl) {
        setStatus("unavailable");
        setMessage(result.message || "Mundari TTS unavailable: model weights missing.");
        return;
      }

      await playAudioUrl(result.audioUrl, `${result.audioUrl}|${ttsInputScript || "Odia"}`);
      setStatus("playing");
      setMessage("Playing...");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Retry");
    }
  }

  function handleStop() {
    stopMundari();
    setStatus("idle");
    setMessage("Play Mundari");
  }

  const isDisabled = disabled || !isVerified || !enabledText || !isVerifiedRoman || status === "loading" || status === "unavailable";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={status === "playing" ? handleStop : handlePlay}
        disabled={isDisabled}
        className={[
          "inline-flex items-center gap-2 rounded-lg border text-sm font-medium transition-colors",
          compact ? "px-2.5 py-1.5" : "px-3 py-2",
          isDisabled ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400" : "border-forest-200 bg-forest-50 text-forest-700 hover:bg-forest-100",
        ].join(" ")}
      >
        {status === "loading" ? <Loader2 size={15} className="animate-spin" /> : status === "playing" ? <Volume2 size={15} className="animate-pulse" /> : status === "error" ? <VolumeX size={15} /> : <Volume2 size={15} />}
        {status === "loading" ? "Generating..." : status === "playing" ? "Playing..." : status === "error" ? "Retry" : status === "unavailable" ? "TTS unavailable" : "Play Mundari"}
      </button>
      {status === "unavailable" && <span className="text-[11px] font-medium text-slate-500">{message}</span>}
    </div>
  );
}
