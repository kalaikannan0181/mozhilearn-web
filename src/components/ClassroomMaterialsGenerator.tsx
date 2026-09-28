import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle,
  Download,
  Edit3,
  FileText,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { MundariPlayButton } from "./MundariPlayButton";
import {
  approveFlashcardsApi,
  approveWorksheetApi,
  deleteFlashcardsApi,
  deleteWorksheetApi,
  fetchFlashcardsApi,
  fetchWorksheetsApi,
  generateFlashcardsApi,
  generateWorksheetApi,
  getFlashcardsPdfUrl,
  getWorksheetPdfUrl,
  publishFlashcardsApi,
  publishWorksheetApi,
  updateFlashcardsApi,
  updateWorksheetApi,
} from "../lib/api";
import type {
  FlashcardItem,
  GeneratedFlashcards,
  GeneratedWorksheet,
  Lesson,
  MaterialStatus,
  WorksheetContent,
  WorksheetSection,
} from "../types/lesson";

interface ClassroomMaterialsGeneratorProps {
  lessons?: Lesson[];
  selectedLessonId?: number;
}

export function ClassroomMaterialsGenerator({
  lessons = [],
  selectedLessonId,
}: ClassroomMaterialsGeneratorProps) {
  const [activeLessonId, setActiveLessonId] = useState<number>(selectedLessonId || 1);
  const [activeTab, setActiveTab] = useState<"worksheet" | "flashcards">("worksheet");

  const [worksheets, setWorksheets] = useState<GeneratedWorksheet[]>([]);
  const [flashcardsList, setFlashcardsList] = useState<GeneratedFlashcards[]>([]);

  const [currentWorksheet, setCurrentWorksheet] = useState<GeneratedWorksheet | null>(null);
  const [currentFlashcards, setCurrentFlashcards] = useState<GeneratedFlashcards | null>(null);

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  // Editable worksheet state
  const [editedWorksheetContent, setEditedWorksheetContent] = useState<WorksheetContent | null>(null);

  // Load existing materials whenever activeLessonId changes
  useEffect(() => {
    if (!activeLessonId) return;
    loadMaterials(activeLessonId);
  }, [activeLessonId]);

  useEffect(() => {
    if (selectedLessonId) {
      setActiveLessonId(selectedLessonId);
    }
  }, [selectedLessonId]);

  async function loadMaterials(lessonId: number) {
    try {
      setErrorMessage("");
      const [wsList, fcList] = await Promise.all([
        fetchWorksheetsApi(lessonId),
        fetchFlashcardsApi(lessonId),
      ]);
      setWorksheets(wsList);
      setFlashcardsList(fcList);

      if (wsList.length > 0) {
        setCurrentWorksheet(wsList[0]);
        setEditedWorksheetContent(
          typeof wsList[0].content_json === "string"
            ? JSON.parse(wsList[0].content_json)
            : wsList[0].content_json
        );
      } else {
        setCurrentWorksheet(null);
        setEditedWorksheetContent(null);
      }

      if (fcList.length > 0) {
        setCurrentFlashcards(fcList[0]);
      } else {
        setCurrentFlashcards(null);
      }
    } catch (err) {
      // Non-fatal if simply no existing items
      console.error("Failed to load materials:", err);
    }
  }

  // Generate Worksheet
  async function handleGenerateWorksheet() {
    setIsGenerating(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const generated = await generateWorksheetApi(activeLessonId);
      setCurrentWorksheet(generated);
      setEditedWorksheetContent(
        typeof generated.content_json === "string"
          ? JSON.parse(generated.content_json)
          : generated.content_json
      );
      setWorksheets((prev) => [generated, ...prev]);
      setActiveTab("worksheet");
      setSuccessMessage("AI worksheet draft generated successfully! Review below.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to generate worksheet.");
    } finally {
      setIsGenerating(false);
    }
  }

  // Generate Flashcards
  async function handleGenerateFlashcards() {
    setIsGenerating(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const generated = await generateFlashcardsApi(activeLessonId);
      setCurrentFlashcards(generated);
      setFlashcardsList((prev) => [generated, ...prev]);
      setActiveTab("flashcards");
      setSuccessMessage("AI flashcards draft generated successfully! Review below.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to generate flashcards.");
    } finally {
      setIsGenerating(false);
    }
  }

  // Save edits to Worksheet
  async function handleSaveWorksheetEdits() {
    if (!currentWorksheet || !editedWorksheetContent) return;
    setIsSaving(true);
    setErrorMessage("");
    try {
      const updated = await updateWorksheetApi(currentWorksheet.id, {
        content_json: editedWorksheetContent,
        title: editedWorksheetContent.title,
        status: "teacher_reviewed",
      });
      setCurrentWorksheet(updated);
      setIsEditing(false);
      setSuccessMessage("Worksheet edits saved! Status updated to Teacher Reviewed.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save edits.");
    } finally {
      setIsSaving(false);
    }
  }

  // Approve Worksheet
  async function handleApproveWorksheet() {
    if (!currentWorksheet) return;
    setIsSaving(true);
    setErrorMessage("");
    try {
      const approved = await approveWorksheetApi(currentWorksheet.id);
      setCurrentWorksheet(approved);
      setSuccessMessage("Worksheet approved! It can now be published or downloaded as PDF.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to approve worksheet.");
    } finally {
      setIsSaving(false);
    }
  }

  // Publish Worksheet
  async function handlePublishWorksheet() {
    if (!currentWorksheet) return;
    if (currentWorksheet.status !== "approved") {
      setErrorMessage("Worksheet must be approved by teacher before publishing.");
      return;
    }
    setIsSaving(true);
    setErrorMessage("");
    try {
      const published = await publishWorksheetApi(currentWorksheet.id);
      setCurrentWorksheet(published);
      setSuccessMessage("Worksheet published successfully!");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to publish worksheet.");
    } finally {
      setIsSaving(false);
    }
  }

  // Delete Worksheet
  async function handleDeleteWorksheet() {
    if (!currentWorksheet) return;
    if (!confirm("Are you sure you want to delete this worksheet draft?")) return;
    setIsSaving(true);
    setErrorMessage("");
    try {
      await deleteWorksheetApi(currentWorksheet.id);
      setWorksheets((prev) => prev.filter((w) => w.id !== currentWorksheet.id));
      setCurrentWorksheet(null);
      setEditedWorksheetContent(null);
      setSuccessMessage("Worksheet draft deleted.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to delete worksheet.");
    } finally {
      setIsSaving(false);
    }
  }

  // Approve Flashcards
  async function handleApproveFlashcards() {
    if (!currentFlashcards) return;
    setIsSaving(true);
    setErrorMessage("");
    try {
      const approved = await approveFlashcardsApi(currentFlashcards.id);
      setCurrentFlashcards(approved);
      setSuccessMessage("Flashcards approved! Ready for printable PDF download.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to approve flashcards.");
    } finally {
      setIsSaving(false);
    }
  }

  // Publish Flashcards
  async function handlePublishFlashcards() {
    if (!currentFlashcards) return;
    if (currentFlashcards.status !== "approved") {
      setErrorMessage("Flashcards must be approved before publishing.");
      return;
    }
    setIsSaving(true);
    setErrorMessage("");
    try {
      const published = await publishFlashcardsApi(currentFlashcards.id);
      setCurrentFlashcards(published);
      setSuccessMessage("Flashcards published successfully!");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to publish flashcards.");
    } finally {
      setIsSaving(false);
    }
  }

  // Delete Flashcards
  async function handleDeleteFlashcards() {
    if (!currentFlashcards) return;
    if (!confirm("Are you sure you want to delete this flashcards set?")) return;
    setIsSaving(true);
    setErrorMessage("");
    try {
      await deleteFlashcardsApi(currentFlashcards.id);
      setFlashcardsList((prev) => prev.filter((f) => f.id !== currentFlashcards.id));
      setCurrentFlashcards(null);
      setSuccessMessage("Flashcards set deleted.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to delete flashcards.");
    } finally {
      setIsSaving(false);
    }
  }

  // Helper badge for status
  function renderStatusBadge(status?: MaterialStatus) {
    switch (status) {
      case "ai_generated":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 border border-amber-200">
            <Sparkles size={12} />
            AI Generated · Needs Teacher Review
          </span>
        );
      case "teacher_reviewed":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 border border-blue-200">
            <Edit3 size={12} />
            Teacher Reviewed
          </span>
        );
      case "approved":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
            <CheckCircle size={12} />
            Approved
          </span>
        );
      case "published":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-forest-100 px-2.5 py-1 text-xs font-semibold text-forest-800 border border-forest-300">
            <BookOpen size={12} />
            Published
          </span>
        );
      default:
        return null;
    }
  }

  const parsedWorksheetContent: WorksheetContent | null = currentWorksheet
    ? typeof currentWorksheet.content_json === "string"
      ? JSON.parse(currentWorksheet.content_json)
      : currentWorksheet.content_json
    : null;

  const parsedFlashcardsContent = currentFlashcards
    ? typeof currentFlashcards.content_json === "string"
      ? JSON.parse(currentFlashcards.content_json)
      : currentFlashcards.content_json
    : null;

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgb(15_23_42/0.03)] sm:p-6">
      {/* Top Banner */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-lg bg-forest-50 text-forest-700">
              <Sparkles size={18} />
            </div>
            <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-900">
              AI Classroom Material Generator
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Auto-generate bilingual worksheets and flashcards using verified lesson content from PostgreSQL.
          </p>
        </div>

        {/* Lesson selector if multiple lessons available */}
        {lessons.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600">Lesson:</label>
            <select
              value={activeLessonId}
              onChange={(e) => setActiveLessonId(Number(e.target.value))}
              className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-800 outline-none focus:border-forest-500"
            >
              {lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  Lesson {l.id}: {l.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Action Controls */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleGenerateWorksheet}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 rounded-xl bg-forest-700 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-forest-800 disabled:opacity-60"
          >
            {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
            Generate Worksheet
          </button>

          <button
            type="button"
            onClick={handleGenerateFlashcards}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 rounded-xl border border-forest-200 bg-forest-50 px-4 py-2.5 text-xs font-semibold text-forest-800 hover:bg-forest-100 disabled:opacity-60"
          >
            {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <Layers size={15} />}
            Generate Flashcards
          </button>
        </div>

        {/* Tab switch between Worksheet and Flashcards preview */}
        <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab("worksheet")}
            className={`rounded-lg px-3 py-1.5 transition ${
              activeTab === "worksheet"
                ? "bg-white font-semibold text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Worksheet {currentWorksheet ? `(${currentWorksheet.status})` : ""}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("flashcards")}
            className={`rounded-lg px-3 py-1.5 transition ${
              activeTab === "flashcards"
                ? "bg-white font-semibold text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Flashcards {currentFlashcards ? `(${currentFlashcards.status})` : ""}
          </button>
        </div>
      </div>

      {/* Messages */}
      {errorMessage && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 p-3.5 text-xs text-red-800 border border-red-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-50 p-3.5 text-xs text-emerald-800 border border-emerald-200">
          <CheckCircle size={16} className="mt-0.5 shrink-0 text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Loading state */}
      {isGenerating && (
        <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-12 text-center">
          <Loader2 size={32} className="animate-spin text-forest-700" />
          <p className="mt-3 text-sm font-semibold text-slate-900">
            Synthesizing approved classroom content...
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Reconciling Devanagari Hindi and verified Mundari Roman vocabulary.
          </p>
        </div>
      )}

      {/* ======================================================== */}
      {/* WORKSHEET PREVIEW TAB */}
      {/* ======================================================== */}
      {!isGenerating && activeTab === "worksheet" && (
        <div className="mt-6">
          {currentWorksheet && parsedWorksheetContent ? (
            <div className="space-y-6">
              {/* Header Bar with Status and Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4 border border-slate-200">
                <div className="flex items-center gap-3">
                  {renderStatusBadge(currentWorksheet.status)}
                  <span className="text-xs text-slate-500">
                    Version: {currentWorksheet.generator_version}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!isEditing ? (
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Edit3 size={13} />
                      Edit
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSaveWorksheetEdits}
                      disabled={isSaving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      <Check size={13} />
                      {isSaving ? "Saving..." : "Save edits"}
                    </button>
                  )}

                  {currentWorksheet.status !== "approved" && currentWorksheet.status !== "published" && (
                    <button
                      type="button"
                      onClick={handleApproveWorksheet}
                      disabled={isSaving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      <CheckCircle size={13} />
                      Approve
                    </button>
                  )}

                  {currentWorksheet.status === "approved" && (
                    <button
                      type="button"
                      onClick={handlePublishWorksheet}
                      disabled={isSaving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-forest-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-forest-800 disabled:opacity-60"
                    >
                      <BookOpen size={13} />
                      Publish
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleGenerateWorksheet}
                    disabled={isGenerating}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw size={13} />
                    Regenerate
                  </button>

                  <a
                    href={getWorksheetPdfUrl(currentWorksheet.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-forest-300 bg-forest-50 px-3 py-1.5 text-xs font-semibold text-forest-800 hover:bg-forest-100"
                  >
                    <Download size={13} />
                    Download PDF
                  </a>

                  <button
                    type="button"
                    onClick={handleDeleteWorksheet}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Status Notice */}
              {currentWorksheet.status === "ai_generated" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-xs text-amber-900 leading-relaxed">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-amber-600" />
                    AI Draft — Teacher Review Required
                  </p>
                  <p className="mt-1 text-amber-800">
                    Review vocabulary, matching, counting, and activity sections below. Ensure all Hindi and Mundari Roman translations are accurate before approving for classroom printing.
                  </p>
                </div>
              )}

              {/* Printable Worksheet Preview Container */}
              <div className="rounded-2xl border border-slate-300 bg-white p-6 shadow-sm">
                {/* Worksheet Header */}
                <div className="border-b-2 border-forest-700 pb-4 text-center">
                  <h1 className="text-xl font-bold text-forest-900">
                    {parsedWorksheetContent.title}
                  </h1>
                  <p className="mt-1 text-xs text-slate-600">
                    कक्षा (Grade) {parsedWorksheetContent.grade} · विषय (Subject): {parsedWorksheetContent.subject} · पाठ (Topic): {parsedWorksheetContent.topic}
                  </p>
                  <div className="mt-3 flex justify-between text-xs text-slate-500 border-t border-slate-100 pt-2">
                    <span>विद्यार्थी का नाम (Student Name): ________________________</span>
                    <span>दिनांक (Date): ____________</span>
                  </div>
                </div>

                {/* Instructions */}
                {parsedWorksheetContent.instructions && parsedWorksheetContent.instructions.length > 0 && (
                  <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">निर्देश (Instructions):</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-slate-600">
                      {parsedWorksheetContent.instructions.map((inst, i) => (
                        <li key={i}>{inst}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Sections */}
                <div className="mt-6 space-y-6">
                  {parsedWorksheetContent.sections?.map((section: WorksheetSection, sIdx: number) => (
                    <div key={sIdx} className="rounded-xl border border-slate-200 p-4">
                      <div className="border-b border-slate-100 pb-2">
                        <h3 className="font-semibold text-sm text-forest-900 uppercase tracking-wide">
                          {section.title || section.type}
                        </h3>
                        {section.instructions && (
                          <p className="text-xs text-slate-500 mt-0.5">{section.instructions}</p>
                        )}
                      </div>

                      {/* Section Content based on type */}
                      <div className="mt-3">
                        {section.type === "vocabulary" && (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {Array.isArray(section.items) &&
                              section.items.map((item, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"
                                >
                                  <div>
                                    <span className="font-bold text-slate-900 text-sm">
                                      {item.hindi}
                                    </span>
                                    <span className="mx-2 text-slate-400">↔</span>
                                    <span className="font-semibold text-amber-800 text-sm">
                                      {item.mundari_roman || "(Missing)"}
                                    </span>
                                    <MundariPlayButton text={item.mundari_roman || ""} sourceType="worksheet-preview" verified={item.translation_status === "verified"} compact />
                                  </div>
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                      item.translation_status === "verified"
                                        ? "bg-emerald-100 text-emerald-800"
                                        : "bg-amber-100 text-amber-800"
                                    }`}
                                  >
                                    {item.translation_status === "verified" ? "Verified" : "Missing"}
                                  </span>
                                </div>
                              ))}
                          </div>
                        )}

                        {section.type === "counting" && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                  <th className="p-2">संख्या (Number)</th>
                                  <th className="p-2">हिंदी (Hindi)</th>
                                  <th className="p-2">मुंडारी रोमन (Mundari Roman)</th>
                                  <th className="p-2">स्थिति (Status)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {Array.isArray(section.items) &&
                                  section.items.map((item, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50/50">
                                      <td className="p-2 font-bold text-forest-800 text-sm">
                                        {item.number}
                                      </td>
                                      <td className="p-2 font-medium text-slate-900">
                                        {item.hindi}
                                      </td>
                                      <td className="p-2 font-semibold text-amber-700">
                                        {item.mundari_roman}
                                      </td>
                                      <td className="p-2">
                                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                          Verified
                                        </span>
                                        <MundariPlayButton text={item.mundari_roman || ""} sourceType="worksheet-preview" verified={item.translation_status === "verified"} compact />
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {section.type === "matching" && (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {Array.isArray(section.pairs) &&
                              section.pairs.map((item, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 p-2.5 text-xs"
                                >
                                  <span className="font-medium text-slate-900">{item.hindi}</span>
                                  <span className="text-slate-400">.......... [ जोड़ें ] ..........</span>
                                  <span className="font-semibold text-forest-800">
                                    {item.mundari_roman}
                                  </span>
                                  <MundariPlayButton text={item.mundari_roman || ""} sourceType="worksheet-preview" verified={item.translation_status === "verified"} compact />
                                </div>
                              ))}
                          </div>
                        )}

                        {section.type === "activity" && (
                          <div className="space-y-3">
                            {Array.isArray(section.items) &&
                              section.items.map((item, idx) => (
                                <div key={idx} className="rounded-lg bg-slate-50 p-3 text-xs">
                                  <p className="font-semibold text-slate-900">
                                    {idx + 1}. {item.task_hindi || item.prompt_hindi || item.hindi}
                                  </p>
                                  {(item.task_mundari_roman || item.mundari_roman) && (
                                    <p className="mt-1 font-medium text-amber-800">
                                      मुंडारी: {item.task_mundari_roman || item.mundari_roman}
                                    </p>
                                  )}
                                  <MundariPlayButton text={item.task_mundari_roman || item.mundari_roman || ""} sourceType="worksheet-preview" verified={item.translation_status === "verified"} compact />
                                  <div className="mt-2 text-slate-400">उत्तर / रेखांकन: ____________________________________</div>
                                </div>
                              ))}
                          </div>
                        )}

                        {section.type === "assessment" && (
                          <div className="space-y-3">
                            {(Array.isArray(section.questions) ? section.questions : Array.isArray(section.items) ? section.items : [])
                              .map((item, idx) => (
                                <div key={idx} className="rounded-lg bg-slate-50 p-3 text-xs">
                                  <p className="font-semibold text-slate-900">
                                    {item.question_no || idx + 1}. {item.hindi_question || item.hindi}
                                  </p>
                                  {(item.mundari_question || item.mundari_roman) && (
                                    <p className="mt-1 font-medium text-amber-800">
                                      मुंडारी: {item.mundari_question || item.mundari_roman}
                                    </p>
                                  )}
                                  <MundariPlayButton text={item.mundari_question || item.mundari_roman || ""} sourceType="worksheet-preview" verified={item.translation_status === "verified"} compact />
                                  {item.expected_answer && (
                                    <p className="mt-1 text-[11px] text-slate-500">
                                      (Expected answer: {item.expected_answer})
                                    </p>
                                  )}
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 py-12 text-center">
              <FileText size={32} className="mx-auto text-slate-400" />
              <h3 className="mt-3 text-sm font-semibold text-slate-800">
                No worksheet generated yet
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Click &ldquo;Generate Worksheet&rdquo; above to auto-create a verified draft from Lesson {activeLessonId}.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* FLASHCARDS PREVIEW TAB */}
      {/* ======================================================== */}
      {!isGenerating && activeTab === "flashcards" && (
        <div className="mt-6">
          {currentFlashcards && parsedFlashcardsContent ? (
            <div className="space-y-6">
              {/* Header Bar with Status and Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4 border border-slate-200">
                <div className="flex items-center gap-3">
                  {renderStatusBadge(currentFlashcards.status)}
                  <span className="text-xs text-slate-500">
                    Cards: {parsedFlashcardsContent.cards?.length || 0}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {currentFlashcards.status !== "approved" && currentFlashcards.status !== "published" && (
                    <button
                      type="button"
                      onClick={handleApproveFlashcards}
                      disabled={isSaving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      <CheckCircle size={13} />
                      Approve All Cards
                    </button>
                  )}

                  {currentFlashcards.status === "approved" && (
                    <button
                      type="button"
                      onClick={handlePublishFlashcards}
                      disabled={isSaving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-forest-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-forest-800 disabled:opacity-60"
                    >
                      <BookOpen size={13} />
                      Publish Cards
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleGenerateFlashcards}
                    disabled={isGenerating}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw size={13} />
                    Regenerate
                  </button>

                  <a
                    href={getFlashcardsPdfUrl(currentFlashcards.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-forest-300 bg-forest-50 px-3 py-1.5 text-xs font-semibold text-forest-800 hover:bg-forest-100"
                  >
                    <Download size={13} />
                    Download Flashcards PDF
                  </a>

                  <button
                    type="button"
                    onClick={handleDeleteFlashcards}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Status Notice */}
              {currentFlashcards.status === "ai_generated" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-xs text-amber-900 leading-relaxed">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-amber-600" />
                    AI Flashcard Draft — Needs Teacher Review
                  </p>
                  <p className="mt-1 text-amber-800">
                    Front side displays Hindi prompt, back side displays Mundari Roman translation. Only approved cards can be included in classroom materials.
                  </p>
                </div>
              )}

              {/* Flashcards Grid */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {parsedFlashcardsContent.cards?.map((card: FlashcardItem, idx: number) => (
                  <div
                    key={idx}
                    className="relative flex flex-col justify-between rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm hover:border-forest-300 transition"
                  >
                    <div>
                      {/* Top Badges */}
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Card #{idx + 1}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            card.translation_status === "verified"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {card.translation_status === "verified" ? "Verified" : "Missing"}
                        </span>
                      </div>

                      {/* Front: Hindi */}
                      <div className="mt-3">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase">Front (Hindi)</p>
                        <p className="mt-0.5 text-2xl font-bold text-forest-900 tracking-wide">
                          {card.front_hindi}
                        </p>
                      </div>

                      {/* Back: Mundari Roman */}
                      <div className="mt-4 rounded-xl bg-amber-50/50 p-3 border border-amber-100">
                        <p className="text-[10px] font-semibold text-amber-700 uppercase">
                          Back (Mundari Roman)
                        </p>
                        <p className="mt-0.5 text-xl font-bold text-amber-900">
                          {card.back_mundari_roman || "(Missing translation)"}
                        </p>
                        <MundariPlayButton text={card.back_mundari_roman || ""} sourceType="flashcard-preview" verified={card.translation_status === "verified"} compact />
                      </div>

                      {/* Safe Educational Image Prompt */}
                      {card.image_prompt && (
                        <div className="mt-3 text-[11px] text-slate-500 italic bg-slate-50 rounded-lg p-2">
                          &ldquo;{card.image_prompt}&rdquo;
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 py-12 text-center">
              <Layers size={32} className="mx-auto text-slate-400" />
              <h3 className="mt-3 text-sm font-semibold text-slate-800">
                No flashcards generated yet
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Click &ldquo;Generate Flashcards&rdquo; above to generate cards for Lesson {activeLessonId}.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
