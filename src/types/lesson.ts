export const lessonStatuses = [
  "draft",
  "ai_assisted",
  "needs_review",
  "approved",
  "published",
] as const;

export type LessonStatus = (typeof lessonStatuses)[number];

export interface Lesson {
  id: number;
  title: string;
  grade: number;
  subject: string;
  topic: string;
  learning_outcome_hindi: string | null;
  learning_outcome_mundari: string | null;
  status: LessonStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface LessonActivity {
  id: number;
  lesson_id: number;
  activity_name: string;
  hindi_guide: string | null;
  mundari_guide: string | null;
  created_at: string;
}

export interface LessonAssessment {
  id: number;
  lesson_id: number;
  question_no: number;
  hindi_question: string;
  mundari_question: string | null;
  expected_answer: string | null;
  created_at: string;
}

export type LessonDetail = Lesson & {
  activities: LessonActivity[];
  assessments: LessonAssessment[];
};

export type CreateLessonInput = {
  title: string;
  grade: number;
  subject: string;
  topic: string;
  learning_outcome_hindi: string;
  learning_outcome_mundari: string;
  status: LessonStatus;
  version: number;
};

export const translationStatuses = [
  "draft",
  "ai_generated",
  "teacher_reviewed",
  "native_reviewed",
  "approved",
  "rejected",
] as const;

export type TranslationStatus = (typeof translationStatuses)[number];

export interface Translation {
  id: number;
  lesson_id: number | null;
  hindi_text: string;
  mundari_text: string;
  source: "manual" | "ai";
  status: TranslationStatus;
  teacher_notes: string | null;
  reviewer_notes: string | null;
  reviewer_id: number | null;
  model_version: string | null;
  created_at: string;
  updated_at: string;
}

export type MaterialStatus = "ai_generated" | "teacher_reviewed" | "approved" | "published";

export interface WorksheetItem {
  hindi: string;
  mundari_roman: string | null;
  translation_id?: number | string | null;
  translation_status?: "verified" | "missing";
  translation_mismatch?: boolean;
}

export interface WorksheetSection {
  type: "header" | "vocabulary" | "matching" | "counting" | "activity" | "assessment";
  title?: string;
  instructions?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items?: any[];
  [key: string]: unknown;
}

export interface WorksheetContent {
  title: string;
  grade: number;
  subject: string;
  topic: string;
  instructions: string[];
  sections: WorksheetSection[];
}

export interface GeneratedWorksheet {
  id: number;
  lesson_id: number;
  created_by: number | null;
  title: string;
  content_json: WorksheetContent;
  status: MaterialStatus;
  generator_version: string;
  source_lesson_id: number;
  source_translation_ids: string[];
  created_at: string;
  updated_at: string;
  author_name?: string;
  lesson_title?: string;
}

export interface FlashcardItem {
  front_hindi: string;
  back_mundari_roman: string | null;
  translation_id?: number | string | null;
  translation_status: "verified" | "missing";
  translation_mismatch?: boolean;
  image_prompt?: string;
  lesson_id?: number;
}

export interface FlashcardsContent {
  title: string;
  lesson_id: number;
  cards: FlashcardItem[];
}

export interface GeneratedFlashcards {
  id: number;
  lesson_id: number;
  created_by: number | null;
  content_json: FlashcardsContent;
  status: MaterialStatus;
  generator_version: string;
  source_lesson_id: number;
  source_translation_ids: string[];
  created_at: string;
  updated_at: string;
  author_name?: string;
  lesson_title?: string;
}

