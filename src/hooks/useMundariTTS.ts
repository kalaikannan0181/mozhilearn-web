import { useCallback, useEffect, useState } from "react";
import {
  getTTSStatus,
  playAudioUrl,
  speakMundari,
  stopMundari,
  type TtsRequest,
  type TtsStatus,
} from "../services/tts";

export type PlayerState = "idle" | "loading" | "playing" | "error" | "unavailable";

export function useMundariTTS() {
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [ttsStatus, setTtsStatus] = useState<TtsStatus | null>(null);
  const [message, setMessage] = useState<string>("Play Mundari");

  // Check TTS system availability on mount
  useEffect(() => {
    let active = true;
    getTTSStatus()
      .then((status) => {
        if (!active) return;
        setTtsStatus(status);
        if (!status.available) {
          setPlayerState("unavailable");
          setMessage(status.message || "Mundari TTS unavailable: model weights missing.");
        } else {
          setPlayerState("idle");
          setMessage("Play Mundari");
        }
      })
      .catch((error) => {
        if (!active) return;
        setPlayerState("unavailable");
        setMessage(error instanceof Error ? error.message : "Mundari TTS unavailable.");
      });

    return () => {
      active = false;
    };
  }, []);

  const play = useCallback(
    async (request: TtsRequest) => {
      const romanText = (request.mundari_roman || request.mundari_translation || "").trim();

      // Guard: Verified Mundari Roman text is required
      if (!romanText) {
        setPlayerState("unavailable");
        setMessage("Verified Mundari Roman translation required.");
        return;
      }

      setPlayerState("loading");
      setMessage("Generating...");

      try {
        const result = await speakMundari({
          source_text: request.source_text,
          mundari_roman: romanText,
          mundari_translation: request.mundari_translation || romanText,
          tts_input: request.tts_input,
          tts_input_script: request.tts_input_script,
          source_type: request.source_type,
          source_id: request.source_id,
        });

        if (!result.success || !result.audioUrl) {
          setPlayerState("unavailable");
          setMessage(result.message || "Mundari TTS unavailable: model weights missing.");
          return;
        }

        setPlayerState("playing");
        setMessage("Playing...");

        await playAudioUrl(
          result.audioUrl,
          `${result.audioUrl}|${request.tts_input_script || "Odia"}`,
          () => {
            setPlayerState("idle");
            setMessage("Play Mundari");
          }
        );
      } catch (error) {
        setPlayerState("error");
        setMessage(error instanceof Error ? error.message : "Retry");
      }
    },
    []
  );

  const stop = useCallback(() => {
    stopMundari();
    setPlayerState("idle");
    setMessage("Play Mundari");
  }, []);

  return {
    playerState,
    ttsStatus,
    message,
    play,
    stop,
  };
}
