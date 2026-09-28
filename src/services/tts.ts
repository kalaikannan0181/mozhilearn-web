import { apiFetch, getApiBaseUrl, readApiJson } from "../lib/apiClient";

export type TtsStatus = {
  available: boolean;
  model: string;
  status: "ready" | "loading_model" | "model_missing" | "model_load_failed" | "invalid_input" | "synthesis_failed" | "success" | "unavailable";
  success?: boolean;
  mode?: string;
  language?: string;
  weightsPresent?: boolean;
  tokenizerFound?: boolean;
  audioUrl?: string | null;
  message?: string;
  reason?: string;
};

export type TtsRequest = {
  source_text?: string;
  mundari_translation?: string;
  mundari_roman?: string;
  tts_input?: string;
  tts_input_script?: string;
  source_type?: string;
  source_id?: number;
};

const DEFAULT_TTS_MODEL = "facebook/mms-tts-unr";
const audioMap = new Map<string, HTMLAudioElement>();
let activeAudio: HTMLAudioElement | null = null;
let cachedStatus: { expiresAt: number; value: TtsStatus } | null = null;
let statusRequest: Promise<TtsStatus> | null = null;

function isLatinText(text: string): boolean {
  const letters = text.match(/\p{L}/gu) || [];
  return letters.length > 0 && letters.every((letter) => /\p{Script=Latin}/u.test(letter));
}

function resolveAudioUrl(audioUrl: string): string {
  const baseUrl = getApiBaseUrl();
  return baseUrl ? new URL(audioUrl, `${baseUrl}/`).toString() : audioUrl;
}

export async function getTTSStatus(language = "mundari"): Promise<TtsStatus> {
  if (cachedStatus && cachedStatus.expiresAt > Date.now()) return cachedStatus.value;
  if (statusRequest) return statusRequest;

  statusRequest = (async () => {
  const response = await apiFetch(`/api/tts/status?language=${encodeURIComponent(language)}`);
  const payload = await readApiJson<TtsStatus>(response, "Unable to check Mundari TTS status.");

  if (!response.ok) {
    throw new Error(payload.message || "Unable to check Mundari TTS status.");
  }

  const status = {
    ...payload,
    model: payload.model || DEFAULT_TTS_MODEL,
    status: (payload.status || (payload.available ? "ready" : "model_missing")) as TtsStatus["status"],
    available: Boolean(payload.available),
  };
  cachedStatus = { expiresAt: Date.now() + 15000, value: status };
  return status;
  })();

  try {
    return await statusRequest;
  } finally {
    statusRequest = null;
  }
}

export async function speakMundari(request: TtsRequest): Promise<{ success: boolean; available: boolean; audioUrl?: string | null; message?: string; reason?: string; status?: TtsStatus["status"] }> {
  const romanText = request.mundari_roman?.trim() || "";
  if (!isLatinText(romanText)) {
    throw new Error("A verified Mundari Roman translation is required for TTS.");
  }

  let ttsInput = request.tts_input?.trim() || "";
  let ttsInputScript = request.tts_input_script || "";
  if (!ttsInput || ttsInputScript !== "Odia") {
    const preparedResponse = await apiFetch("/api/ai/prepare-tts-inputs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: "tts", mundariRoman: romanText }] }),
    });
    const prepared = await readApiJson<{ success: boolean; items?: Array<{ id: string; tts_input: string | null; tts_input_script: string | null }> }>(preparedResponse, "Unable to prepare Mundari TTS input.");
    const item = prepared.items?.find((candidate) => candidate.id === "tts");
    ttsInput = item?.tts_input || "";
    ttsInputScript = item?.tts_input_script || "";
  }

  if (!ttsInput || ttsInputScript !== "Odia") {
    throw new Error("This verified Mundari Roman text cannot be converted to the model's Odia input script.");
  }

  const payload = {
    tts_input: ttsInput,
    tts_input_script: ttsInputScript,
    language: "mundari",
    source_text: request.source_text,
    mundari_translation: request.mundari_translation,
    mundari_roman: request.mundari_roman,
    source_type: request.source_type,
    source_id: request.source_id,
  };

  const response = await apiFetch("/api/tts/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await readApiJson<{ success: boolean; available?: boolean; audioUrl?: string | null; message?: string; reason?: string; status?: string }>(response, "Mundari TTS is unavailable.");

  if (!response.ok || !result.success) {
    if (response.status === 503) {
      return {
        ...result,
        success: false,
        available: false,
        status: (result.status || "model_missing") as TtsStatus["status"],
      };
    }
    throw new Error(result.message || result.reason || "Mundari TTS is unavailable.");
  }

  return {
    ...result,
    available: Boolean(result.available),
    status: (result.status || (result.available ? "success" : "model_missing")) as TtsStatus["status"],
  };
}

export function stopMundari() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
  }
  activeAudio = null;
}

export function playAudioUrl(audioUrl: string, key: string, onEnded?: () => void) {
  if (!audioUrl) return Promise.reject(new Error("Audio URL is required."));

  const cacheKey = `${DEFAULT_TTS_MODEL}|Odia|${key}`;
  const resolvedUrl = resolveAudioUrl(audioUrl);
  let cached = audioMap.get(cacheKey);
  if (!cached) {
    cached = new Audio();
    cached.crossOrigin = "use-credentials";
    cached.src = resolvedUrl;
  }
  if (!audioMap.has(cacheKey)) {
    audioMap.set(cacheKey, cached);
  }

  stopMundari();
  activeAudio = cached;
  cached.onended = onEnded || null;
  cached.currentTime = 0;
  return cached.play();
}
