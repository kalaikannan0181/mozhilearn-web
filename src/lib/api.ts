import type { CreateLessonInput, Lesson, LessonActivity, LessonAssessment, LessonDetail, Translation, TranslationStatus } from "../types/lesson";
import { apiFetch, readApiJson } from "./apiClient";

type LessonsResponse = {
  success: boolean;
  lessons: Lesson[];
};

type CreateLessonResponse = {
  success: boolean;
  message: string;
  lesson: Lesson;
};

export type CreateTranslationInput = {
  lesson_id: number;
  hindi_text: string;
  mundari_text: string;
  source: "manual" | "ai";
};

export type AiTranslationInput = {
  hindi_text: string;
  lesson_id?: number;
  preview?: boolean;
  output_script?: "roman";
};

export type AiTranslationResult = Pick<Translation, "mundari_text"> & {
  mundari_roman?: string | null;
  romanization_verified?: boolean;
  translationVerified?: boolean;
};

export type AudioTranslationResult = {
  hindi_text: string;
  mundari_translation: string;
  mundari_roman: string | null;
  romanization_verified: boolean;
  romanization_source: string | null;
  tts_input: string | null;
  tts_input_script: string | null;
};

export type Class1DemoItem = {
  id: string;
  kind: "fruit" | "number" | "teacher-script" | "instruction" | "activity" | "assessment";
  hindi: string;
  mundariRoman: string;
  sourceFile: string;
  audioPrompt: string | null;
};

export type Class1DemoContent = {
  lesson: LessonDetail;
  fruits: Class1DemoItem[];
  numbers: Class1DemoItem[];
  teacherScript: Class1DemoItem[];
  instructions: Class1DemoItem[];
  activities: Class1DemoItem[];
  assessments: Class1DemoItem[];
};

export type Class1LookupResult = {
  success: boolean;
  source: "class1_verified";
  hindi_text?: string;
  mundari_translation?: string | null;
  mundari_roman?: string;
  reason?: string;
};

export async function lookupClass1Hindi(hindiText: string): Promise<Class1LookupResult> {
  const response = await apiFetch("/api/ai/class1-lookup", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hindi_text: hindiText }),
  });
  const payload = await readApiJson<Class1LookupResult>(response, "Class 1 phrase lookup failed.");
  if (!response.ok) {
    throw new Error(payload.reason || "Class 1 phrase lookup failed.");
  }
  return payload;
}

export async function transcribeHindiAudio(audio: Blob, filename: string): Promise<string> {
  const extension = filename.split(".").pop()?.toLowerCase() || "";
  const response = await apiFetch(`/api/ai/transcribe-audio?extension=${encodeURIComponent(extension)}`, {
    method: "POST",
    headers: { "Content-Type": audio.type || "application/octet-stream" },
    body: audio,
  });
  const payload = await readApiJson<{
    success: boolean;
    transcription?: { hindi_text: string };
    recognition?: { engine: string; language: string };
    message?: string;
  }>(response, "Hindi speech recognition failed.");

  if (!response.ok || !payload.success || !payload.transcription?.hindi_text) {
    throw new Error(payload.message || "Hindi speech recognition failed.");
  }

  return payload.transcription.hindi_text;
}

const CLASS1_LESSON_TITLE = "पाठ 1: फलों के नाम और 1 से 5 तक गिनती";
const CLASS1_VOCABULARY_CODES = new Set(["OBJ_02", "OBJ_03", "OBJ_04", "OBJ_05", "OBJ_06"]);

export async function fetchClass1DemoContent(signal?: AbortSignal): Promise<Class1DemoContent> {
  const [lessons, vocabularyResponse, phraseResponse, numberResponse] = await Promise.all([
    fetchLessons(signal),
    apiFetch("/api/vocabulary", { signal }),
    apiFetch("/api/classroom-phrases", { signal }),
    apiFetch("/api/number-vocabulary?from=1&to=5", { signal }),
  ]);
  const [vocabularyPayload, phrasePayload, numberPayload] = await Promise.all([
    readApiJson<{ success: boolean; vocabulary?: Array<{ id: number; object_code: string; hindi: string; mundari_roman: string; audio_prompt: string | null }> }>(vocabularyResponse, "Unable to load Class 1 vocabulary."),
    readApiJson<{ success: boolean; classroom_phrases?: Array<{ id: number; category: string; hindi: string; mundari_roman: string }> }>(phraseResponse, "Unable to load Class 1 phrases."),
    readApiJson<{ success: boolean; number_vocabulary?: Array<{ id: number; number_value: number; hindi: string; mundari_roman: string }> }>(numberResponse, "Unable to load Class 1 numbers."),
  ]);

  if (!vocabularyResponse.ok || !vocabularyPayload.success || !phraseResponse.ok || !phrasePayload.success || !numberResponse.ok || !numberPayload.success) {
    throw new Error("Unable to load verified Class 1 lesson content.");
  }

  const lessonSummary = lessons.find((item) => item.grade === 1 && item.subject === "Foundational Numeracy" && item.title === CLASS1_LESSON_TITLE);
  if (!lessonSummary) throw new Error("Class 1 Lesson 1 is not available in the lesson database.");
  const lesson = await fetchLesson(lessonSummary.id);

  const toItem = (item: Class1DemoItem): Class1DemoItem => item;

  const content: Class1DemoContent = {
    lesson,
    fruits: (vocabularyPayload.vocabulary || [])
      .filter((item) => CLASS1_VOCABULARY_CODES.has(item.object_code))
      .map((item) => toItem({
        id: `fruit-${item.object_code}`,
        kind: "fruit",
        hindi: item.hindi,
        mundariRoman: item.mundari_roman,
        sourceFile: "Untitled spreadsheet - Sheet1 (3).csv",
        audioPrompt: item.audio_prompt,
      })),
    numbers: (numberPayload.number_vocabulary || []).map((item) => toItem({
      id: `number-${item.number_value}`,
      kind: "number",
      hindi: item.hindi,
      mundariRoman: item.mundari_roman,
      sourceFile: "Untitled spreadsheet - Sheet1.csv",
      audioPrompt: null,
    })),
    teacherScript: (phrasePayload.classroom_phrases || [])
      .filter((item) => item.category === "lesson_script")
      .map((item) => toItem({
        id: `teacher-script-${item.id}`,
        kind: "teacher-script",
        hindi: item.hindi,
        mundariRoman: item.mundari_roman,
        sourceFile: "Untitled spreadsheet - Sheet1 (3).csv",
        audioPrompt: null,
      })),
    instructions: (phrasePayload.classroom_phrases || [])
      .filter((item) => item.category === "instruction")
      .map((item) => toItem({
        id: `instruction-${item.id}`,
        kind: "instruction",
        hindi: item.hindi,
        mundariRoman: item.mundari_roman,
        sourceFile: "Untitled spreadsheet - Sheet1 (1).csv",
        audioPrompt: null,
      })),
    activities: lesson.activities
      .filter((activity) => Boolean(activity.hindi_guide && activity.mundari_guide))
      .map((activity) => toItem({
        id: `activity-${activity.id}`,
        kind: "activity",
        hindi: activity.hindi_guide || "",
        mundariRoman: activity.mundari_guide || "",
        sourceFile: "Untitled spreadsheet - Sheet1 (4).csv",
        audioPrompt: null,
      })),
    assessments: lesson.assessments
      .filter((assessment) => Boolean(assessment.hindi_question && assessment.mundari_question))
      .map((assessment) => toItem({
        id: `assessment-${assessment.id}`,
        kind: "assessment",
        hindi: assessment.hindi_question,
        mundariRoman: assessment.mundari_question || "",
        sourceFile: "Untitled spreadsheet - Sheet1 (4).csv",
        audioPrompt: null,
      })),
  };

  return content;
}

export type TtsStatus = {
  success: boolean;
  mode: string;
  language: string;
  available: boolean;
  modelAvailable?: boolean;
  weightsPresent?: boolean;
  serviceConfigured?: boolean;
  audioUrl: string | null;
  message: string;
};

export type TtsSynthesisResult = TtsStatus & {
  voice?: string | null;
};

export async function fetchTtsStatus(language = "mundari"): Promise<TtsStatus> {
  const response = await apiFetch(`/api/tts/status?language=${encodeURIComponent(language)}`);
  const payload = await readApiJson<TtsStatus>(response, "Unable to check Mundari TTS status.");
  if (!response.ok || !payload.success) throw new Error(payload.message || "Unable to check Mundari TTS status.");
  return payload;
}

export async function synthesizeTts(ttsInput: string, language = "mundari"): Promise<TtsSynthesisResult> {
  const response = await apiFetch("/api/tts/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tts_input: ttsInput, language }),
  });
  const payload = await readApiJson<TtsSynthesisResult>(response, "Mundari TTS is unavailable.");
  if (!response.ok || !payload.success) throw new Error(payload.message || "Mundari TTS is unavailable.");
  return payload;
}

export async function fetchLessons(signal?: AbortSignal): Promise<Lesson[]> {
  const response = await apiFetch("/api/lessons", { signal });
  const payload = await readApiJson<LessonsResponse>(response, "Unable to load lessons from the server.");

  if (!response.ok || !payload.success) {
    throw new Error("Unable to load lessons from the server.");
  }

  return payload.lessons;
}

export async function createLesson(input: CreateLessonInput): Promise<Lesson> {
  const response = await apiFetch("/api/lessons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await readApiJson<CreateLessonResponse>(response, "Unable to create the lesson.");

  if (!response.ok || !payload.success) {
    throw new Error(payload.message || "Unable to create the lesson.");
  }

  return payload.lesson;
}

export async function fetchLessonTranslations(lessonId: number): Promise<Translation[]> {
  const response = await apiFetch(`/api/lessons/${lessonId}/translations`);
  const payload = await readApiJson<{ success: boolean; translations: Translation[]; message?: string }>(response, "Unable to load translations.");

  if (!response.ok || !payload.success) {
    throw new Error(payload.message || "Unable to load translations.");
  }

  return payload.translations;
}

export async function createTranslation(input: CreateTranslationInput): Promise<Translation> {
  const response = await apiFetch("/api/translations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await readApiJson<{ success: boolean; translation: Translation; message?: string }>(response, "Unable to save translation.");

  if (!response.ok || !payload.success) {
    throw new Error(payload.message || "Unable to save translation.");
  }

  return payload.translation;
}

export async function updateTranslationReview(
  translationId: number,
  status: TranslationStatus,
  reviewerNotes?: string,
): Promise<Translation> {
  const response = await apiFetch(`/api/translations/${translationId}/review`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, reviewer_notes: reviewerNotes }),
  });
  const payload = await readApiJson<{ success: boolean; translation: Translation; message?: string }>(response, "Unable to update translation status.");

  if (!response.ok || !payload.success) {
    throw new Error(payload.message || "Unable to update translation status.");
  }

  return payload.translation;
}

export async function translateHindiToMundari(input: AiTranslationInput): Promise<AiTranslationResult> {
  const response = await apiFetch("/api/ai/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await readApiJson<{ success: boolean; translation: AiTranslationResult; message?: string }>(response, "Translation failed. Please try again.");

  if (!response.ok || !payload.success) {
    throw new Error(payload.message || "Translation failed. Please try again.");
  }

  return payload.translation;
}

export async function translateHindiAudioToMundari(audio: Blob, filename: string): Promise<AudioTranslationResult> {
  const extension = filename.split(".").pop()?.toLowerCase() || "";
  const response = await apiFetch(`/api/ai/translate-audio?extension=${encodeURIComponent(extension)}`, {
    method: "POST",
    headers: { "Content-Type": audio.type || "application/octet-stream" },
    body: audio,
  });
  const payload = await readApiJson<{
    success: boolean;
    transcription?: { hindi_text: string };
    translation?: Omit<AudioTranslationResult, "hindi_text">;
    message?: string;
  }>(response, "Hindi audio translation failed.");

  if (!response.ok || !payload.success || !payload.transcription || !payload.translation) {
    throw new Error(payload.message || "Hindi audio translation failed.");
  }

  return {
    hindi_text: payload.transcription.hindi_text,
    ...payload.translation,
  };
}

export async function fetchLesson(lessonId: number): Promise<LessonDetail> {
  const response = await apiFetch(`/api/lessons/${lessonId}`);
  const payload = await readApiJson<{ success: boolean; lesson: LessonDetail; message?: string }>(response, "Unable to load lesson.");
  if (!response.ok || !payload.success) throw new Error(payload.message || "Unable to load lesson.");
  return payload.lesson;
}

export async function fetchReviewQueue(status?: TranslationStatus): Promise<Translation[]> {
  const response = await apiFetch(status ? `/api/review/translations?status=${status}` : "/api/review/translations");
  const payload = await readApiJson<{ success: boolean; translations: Translation[]; message?: string }>(response, "Unable to load review queue.");
  if (!response.ok || !payload.success) throw new Error(payload.message || "Unable to load review queue.");
  return payload.translations;
}

export async function createActivity(lessonId: number, input: Omit<LessonActivity, "id" | "lesson_id" | "created_at">): Promise<LessonActivity> {
  const response = await apiFetch(`/api/lessons/${lessonId}/activities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const payload = await readApiJson<{ success: boolean; activity: LessonActivity; message?: string }>(response, "Unable to save activity.");
  if (!response.ok || !payload.success) throw new Error(payload.message || "Unable to save activity.");
  return payload.activity;
}

export async function createAssessment(lessonId: number, input: Omit<LessonAssessment, "id" | "lesson_id" | "created_at">): Promise<LessonAssessment> {
  const response = await apiFetch(`/api/lessons/${lessonId}/assessments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const payload = await readApiJson<{ success: boolean; assessment: LessonAssessment; message?: string }>(response, "Unable to save assessment.");
  if (!response.ok || !payload.success) throw new Error(payload.message || "Unable to save assessment.");
  return payload.assessment;
}

export type OfflinePack = { id: number; name: string; language: string; grade: number; version: number; status: "draft" | "published" | "archived"; created_at: string; updated_at: string };

export async function fetchPacks(): Promise<OfflinePack[]> {
  const response = await apiFetch("/api/packs");
  const payload = await readApiJson<{ success: boolean; data: OfflinePack[]; message?: string }>(response, "Unable to load offline packs.");
  if (!response.ok || !payload.success) throw new Error(payload.message || "Unable to load offline packs.");
  return payload.data;
}

export async function createOfflinePack(input: { name: string; language: string; grade: number }): Promise<OfflinePack> {
  const response = await apiFetch("/api/sync/packs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const payload = await readApiJson<{ success: boolean; pack: OfflinePack; message?: string }>(response, "Unable to create offline pack.");
  if (!response.ok || !payload.success) throw new Error(payload.message || "Unable to create offline pack.");
  return payload.pack;
}

export async function publishPack(packId: number): Promise<OfflinePack> {
  const response = await apiFetch(`/api/packs/${packId}/publish`, { method: "POST" });
  const payload = await readApiJson<{ success: boolean; data: OfflinePack; message?: string }>(response, "Unable to publish offline pack.");
  if (!response.ok || !payload.success) throw new Error(payload.message || "Unable to publish offline pack.");
  return payload.data;
}