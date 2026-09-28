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
