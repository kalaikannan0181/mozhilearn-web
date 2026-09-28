import { AlertCircle, Loader2, Volume2, VolumeX } from "lucide-react";
import { useMemo } from "react";
import { useMundariTTS } from "../hooks/useMundariTTS";

export type MundariPlayButtonProps = {
  text?: string;
  sourceText?: string;
  mundariRoman?: string;
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
  sourceText,
  mundariRoman,
  ttsInput,
  ttsInputScript,
  sourceType,
  sourceId,
  verified,
  disabled = false,
  className = "",
  compact = true,
}: MundariPlayButtonProps) {
  const { playerState, message, play, stop } = useMundariTTS();

  const enabledText = useMemo(
    () => (mundariRoman || text || "").trim(),
    [mundariRoman, text]
  );

  const isVerified = verified ?? ["library", "class1-lookup", "lesson", "worksheet-preview", "flashcard-preview"].includes(sourceType || "");
  const isVerifiedRoman = Boolean(enabledText) && /\p{Script=Latin}/u.test(enabledText) && !/[\p{Script=Devanagari}]/u.test(enabledText);

  async function handleToggle() {
    if (playerState === "playing") {
      stop();
      return;
    }
    await play({
      source_text: sourceText,
      mundari_roman: enabledText,
      mundari_translation: enabledText,
      tts_input: ttsInput,
      tts_input_script: ttsInputScript,
      source_type: sourceType,
        source_id: sourceId,
    });
  }

  const isButtonDisabled =
    disabled ||
    !isVerified ||
    !enabledText ||
    !isVerifiedRoman ||
    playerState === "loading" ||
    playerState === "unavailable";

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={handleToggle}
        disabled={isButtonDisabled}
        title={!isVerified || !isVerifiedRoman ? "Verified Mundari Roman translation required." : message}
        className={[
          "inline-flex items-center gap-1.5 rounded-lg border font-medium transition-colors",
          compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
          isButtonDisabled
            ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
            : "border-forest-200 bg-forest-50 text-forest-700 hover:bg-forest-100",
        ].join(" ")}
      >
        {playerState === "loading" ? (
          <Loader2 size={compact ? 13 : 15} className="animate-spin text-forest-700" />
        ) : playerState === "playing" ? (
          <Volume2 size={compact ? 13 : 15} className="animate-pulse text-forest-700" />
        ) : playerState === "error" ? (
          <AlertCircle size={compact ? 13 : 15} className="text-amber-600" />
        ) : playerState === "unavailable" ? (
          <VolumeX size={compact ? 13 : 15} className="text-slate-400" />
        ) : (
          <Volume2 size={compact ? 13 : 15} className="text-forest-700" />
        )}

        <span>
          {playerState === "loading"
            ? "Generating..."
            : playerState === "playing"
            ? "Playing..."
            : playerState === "error"
            ? "Retry"
            : playerState === "unavailable"
            ? "Mundari TTS unavailable"
            : "Play Mundari"}
        </span>
      </button>
    </div>
  );
}
