"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import NextImage from "next/image";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";
import { matchesAssessmentQuestionType } from "@/lib/question-types";

const navigationItems = [
  { label: "Dashboard", icon: "⌂" },
  { label: "Questions", icon: "?" },
  { label: "Assessments", icon: "▣" },
  { label: "Candidates", icon: "♙" },
  { 
    label: "Users", 
    icon: "♟"
  },
  {
    label: "Settings",
    icon: "⚙",
    options: [
      "Organization",
      { label: "Questions", options: ["Categories", "Sub Categories", "Topics", "Difficulty Levels", "Languages"] },
      { label: "Assessments", options: ["Examinations", "Default Settings"] },
      { label: "Candidates", options: ["Categories", "Sub Categories", "Settings", "Candidate Permissions"] },
      "Results",
    ],
  },
];

const navigationOptionIcons: Record<string, string> = {
  Organization: "⌂",
  Questions: "?",
  Categories: "▦",
  "Sub Categories": "☷",
  Topics: "◈",
  "Difficulty Levels": "▥",
  Languages: "文",
  Assessments: "▣",
  Examinations: "▤",
  "Default Settings": "⚙",
  Candidates: "♙",
  Settings: "⚙",
  "Candidate Permissions": "◉",
  Results: "▤",
};

const dashboardPages = [
  { label: "Questions", icon: "?", description: "Question bank" },
  { label: "Assessments", icon: "▣", description: "Assessment management" },
  { label: "Candidates", icon: "♙", description: "Candidate management" },
  { label: "Users", icon: "♟", description: "Users and roles" },
  { label: "Question Categories", icon: "▦", description: "Question categories" },
  { label: "Question Sub Categories", icon: "☷", description: "Question sub-categories" },
  { label: "Question Topics", icon: "◈", description: "Question topics" },
  { label: "Difficulty Levels", icon: "▥", description: "Difficulty levels" },
  { label: "Languages", icon: "文", description: "Question languages" },
  { label: "Examinations", icon: "▤", description: "Examination types" },
  { label: "Candidate Categories", icon: "▦", description: "Candidate categories" },
  { label: "Candidate Sub Categories", icon: "☷", description: "Candidate sub-categories" },
  { label: "Candidate Settings", icon: "⚙", description: "Candidate settings" },
  { label: "Candidate Permissions", icon: "◉", description: "Candidate exam camera permission" },
  { label: "Results", icon: "▤", description: "Candidate assessment results" },
];

const dashboardShortcutTones = [0, 1, 2, 3, 4, 5, 1, 2, 3, 0, 1, 4, 5, 2];

type AssessmentCardData = {
  id?: number;
  title: string;
  subtitle: string;
  examination?: string;
  start_date?: string | null;
  end_date?: string | null;
  total_time?: number | null;
  last_login?: number | null;
  question_category?: string | null;
  sub_category?: string | null;
  topic?: string | null;
  question_language?: string | null;
  sections?: AssessmentSection[];
  start: string;
  end: string;
  questions: string;
  marks: string;
  candidates: string;
};

type AssessmentSection = {
  name: string;
  question_type: string;
  question_count: string;
  correct_mark: string;
  wrong_mark: string;
  difficulty_percentages: Array<{ level: string; percentage: string }>;
};

type AssessmentResultRecord = {
  assessment_id: number;
  assessment_name: string;
  examination: string;
  assessment_start_date: string | null;
  assessment_end_date: string | null;
  candidate_id: number;
  candidate_code: string;
  candidate_name: string;
  candidate_category: string;
  candidate_sub_category: string;
  candidate_details: Record<string, unknown>;
  obtained_mark: number;
  negative_mark: number;
  total_mark: number;
  evaluated_at: string;
};

function ResultsPanel({ accountUserId }: { accountUserId: number | null }) {
  const [results, setResults] = useState<AssessmentResultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedExamination, setSelectedExamination] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSubCategory, setSelectedSubCategory] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!accountUserId) return;
    const controller = new AbortController();
    fetch(`/api/assessment-results?accountUserId=${accountUserId}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { results?: AssessmentResultRecord[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Unable to load assessment results.");
        if (!Array.isArray(payload.results)) throw new Error("The assessment results could not be read.");
        setResults(payload.results);
        setError("");
      })
      .catch((loadError) => {
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load assessment results.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [accountUserId, retryCount]);

  const examinations = [...new Set(results.map((result) => result.examination).filter(Boolean))].sort();
  const examinationResults = results.filter((result) =>
    !selectedExamination || result.examination === selectedExamination
  );
  const categories = [...new Set(examinationResults.map((result) => result.candidate_category).filter(Boolean))].sort();
  const categoryResults = examinationResults.filter((result) =>
    !selectedCategory || result.candidate_category === selectedCategory
  );
  const subCategories = [...new Set(categoryResults.map((result) => result.candidate_sub_category).filter(Boolean))].sort();
  const hasActiveFilters = Boolean(selectedExamination || selectedCategory || selectedSubCategory);
  const filteredResults = categoryResults.filter((result) => {
    if (selectedSubCategory && result.candidate_sub_category !== selectedSubCategory) return false;
    const candidateDetails = Object.values(result.candidate_details).join(" ");
    return [
      result.candidate_name,
      result.candidate_code,
      result.candidate_category,
      result.candidate_sub_category,
      result.assessment_name,
      result.examination,
      candidateDetails,
    ].join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  });
  const resultsError = accountUserId ? error : "Sign in as an administrator to view assessment results.";

  return (
    <section className="assessment-results-section">
      <div className="assessments-toolbar">
        <div>
          <p className="section-kicker">Assessment outcomes</p>
          <h1>Results</h1>
          <p className="assessment-count">Showing {filteredResults.length} of {results.length} evaluated results</p>
        </div>
        <div className="assessment-results-toolbar-actions">
          <button className="assessment-results-download-button" type="button">
            <span aria-hidden="true">↓</span> Download
          </button>
          <button className={`assessment-results-filter-button${showFilters ? " is-active" : ""}`} type="button" aria-expanded={showFilters} onClick={() => setShowFilters((open) => !open)}>
            <span aria-hidden="true">☷</span> Filters{hasActiveFilters ? ` (${Number(Boolean(selectedExamination)) + Number(Boolean(selectedCategory)) + Number(Boolean(selectedSubCategory))})` : ""}
          </button>
          <label className="assessment-results-search">
            <span>Search results</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Candidate or assessment" />
          </label>
        </div>
      </div>
      {showFilters && (
        <div className="assessment-results-filter-panel" aria-label="Filter results">
          <label>
            <span>Examination</span>
            <select value={selectedExamination} onChange={(event) => {
              setSelectedExamination(event.target.value);
              setSelectedCategory("");
              setSelectedSubCategory("");
            }}>
              <option value="">All examinations</option>
              {examinations.map((examination) => <option key={examination} value={examination}>{examination}</option>)}
            </select>
          </label>
          <label>
            <span>Candidate category</span>
            <select value={selectedCategory} onChange={(event) => {
              setSelectedCategory(event.target.value);
              setSelectedSubCategory("");
            }}>
              <option value="">All categories</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label>
            <span>Candidate subcategory</span>
            <select value={selectedSubCategory} onChange={(event) => setSelectedSubCategory(event.target.value)} disabled={!selectedCategory}>
              <option value="">All subcategories</option>
              {subCategories.map((subCategory) => <option key={subCategory} value={subCategory}>{subCategory}</option>)}
            </select>
          </label>
          {hasActiveFilters && (
            <button className="assessment-results-clear-filters" type="button" onClick={() => {
              setSelectedExamination("");
              setSelectedCategory("");
              setSelectedSubCategory("");
            }}>Clear filters</button>
          )}
        </div>
      )}
      {resultsError && (
        <p className="assessment-results-error" role="alert">
          {resultsError}
          {accountUserId && <button type="button" onClick={() => {
            setError("");
            setLoading(true);
            setRetryCount((count) => count + 1);
          }}>Try again</button>}
        </p>
      )}
      <div className="assessment-results-table-wrap">
        <table className="assessment-results-table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Candidate Details</th>
              <th>Examination</th>
              <th>Assessment</th>
              <th>Assessment Dates</th>
              <th>Mark Obtained</th>
              <th>Negative Mark</th>
              <th>Total Mark</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="assessment-results-empty">Loading results…</td></tr>
            ) : resultsError ? (
              <tr><td colSpan={8} className="assessment-results-empty">Results are unavailable.</td></tr>
            ) : filteredResults.length === 0 ? (
              <tr><td colSpan={8} className="assessment-results-empty">{search || hasActiveFilters ? "No results match your search or filters." : "No evaluated results are available yet."}</td></tr>
            ) : filteredResults.map((result) => (
              <tr key={`${result.assessment_id}-${result.candidate_id}`}>
                <td>
                  <strong>{result.candidate_name}</strong>
                  <small>{result.candidate_code || `Candidate ${result.candidate_id}`}</small>
                  <small>{[result.candidate_category, result.candidate_sub_category].filter(Boolean).join(" · ") || "—"}</small>
                </td>
                <td>
                  {Object.entries(result.candidate_details).length
                    ? Object.entries(result.candidate_details).map(([name, value]) => (
                      <small key={name}><strong>{name}:</strong> {String(value)}</small>
                    ))
                    : "—"}
                </td>
                <td>{result.examination || "—"}</td>
                <td>{result.assessment_name}</td>
                <td>
                  <small>Start: {result.assessment_start_date ? formatStudentExamDate(result.assessment_start_date) : "—"}</small>
                  <small>End: {result.assessment_end_date ? formatStudentExamDate(result.assessment_end_date) : "—"}</small>
                </td>
                <td>{result.obtained_mark}</td>
                <td>{result.negative_mark}</td>
                <td>{result.total_mark}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function getAssessmentMaxMark(sections: AssessmentSection[] | undefined) {
  return (sections ?? []).reduce((total, section) => {
    const questionCount = Number(section.question_count);
    const correctMark = Number(section.correct_mark);
    return total + (Number.isFinite(questionCount) && Number.isFinite(correctMark) ? questionCount * correctMark : 0);
  }, 0);
}

function AssessmentCard({ assessment, currentRole, canEvaluate, isInvigilator, isEvaluator, onDeleted, onEdit, onPreview, onAssignCandidates, onAssignEvaluator, onAssignInvigilator, onInvigilate, onEvaluate }: { assessment: AssessmentCardData; currentRole?: any; canEvaluate?: boolean; isInvigilator?: boolean; isEvaluator?: boolean; onDeleted?: (id: number) => void; onEdit?: (assessment: AssessmentCardData) => void; onPreview?: (assessment: AssessmentCardData) => void; onAssignCandidates?: (assessment: AssessmentCardData) => void; onAssignEvaluator?: (assessment: AssessmentCardData) => void; onAssignInvigilator?: (assessment: AssessmentCardData) => void; onInvigilate?: (assessment: AssessmentCardData) => void; onEvaluate?: (assessment: AssessmentCardData) => void }) {
  const [showOptions, setShowOptions] = useState(false);
  const [openAssignment, setOpenAssignment] = useState<string | null>(null);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!showOptions) {
      return;
    }

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) {
        setShowOptions(false);
        setOpenAssignment(null);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [showOptions]);

  const assignmentOptions = [
    { label: "Assign Candidates", key: "candidates" },
    { label: "Assign Evaluator", key: "evaluator" },
    { label: "Assign Invigilator", key: "invigilator" },
  ];
  const canEdit = hasRolePermission(currentRole, "Assessments", "edit");
  const canDelete = hasRolePermission(currentRole, "Assessments", "delete");

  const deleteAssessment = async () => {
    if (!assessment.id || !window.confirm("Delete this assessment?")) return;

    const response = await fetch("/api/assessments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: assessment.id }),
    });
    if (!response.ok) return;
    onDeleted?.(assessment.id);
  };

  return (
    <article ref={cardRef} className={`assessment-card${showOptions ? " options-open" : ""}`}>
      <div className="assessment-card-heading">
        <div>
          <h2>{assessment.title}</h2>
          <p>{assessment.subtitle}</p>
        </div>
        <button
          className="more-button"
          type="button"
          aria-expanded={showOptions}
          aria-haspopup="menu"
          aria-label={`More options for ${assessment.title}`}
          onClick={() => { setShowOptions(!showOptions); setOpenAssignment(null); }}
        >
          <span />
          <span />
          <span />
        </button>
        {showOptions && (
          <div className="assessment-options-menu" role="menu">
            {isInvigilator ? (
              <>
                <button type="button" role="menuitem" onClick={() => { onPreview?.(assessment); setShowOptions(false); }}>Preview</button>
                <button className="option-menu-item" type="button" role="menuitem" onClick={() => { onInvigilate?.(assessment); setShowOptions(false); }}>Invigilate</button>
                <button className="option-menu-item" type="button" role="menuitem">Reports</button>
              </>
            ) : isEvaluator ? (
              <>
                <button type="button" role="menuitem" onClick={() => { onPreview?.(assessment); setShowOptions(false); }}>Preview</button>
                <button className="option-menu-item" type="button" role="menuitem" onClick={() => { onInvigilate?.(assessment); setShowOptions(false); }}>Invigilate</button>
                <button className="option-menu-item" type="button" role="menuitem" onClick={() => { onEvaluate?.(assessment); setShowOptions(false); }}>Evaluate</button>
                <button className="option-menu-item" type="button" role="menuitem">Reports</button>
              </>
            ) : (
              <>
                <button type="button" role="menuitem" onClick={() => { onPreview?.(assessment); setShowOptions(false); }}>Preview</button>
                {canEdit && <button className="option-menu-item" type="button" role="menuitem" onClick={() => { onEdit?.(assessment); setShowOptions(false); }}>Edit</button>}
                {canDelete && assessment.id && <button className="option-menu-item" type="button" role="menuitem" onClick={deleteAssessment}>Delete</button>}
                {assignmentOptions.map((item) => (
                  <div className="assignment-option" key={item.key}>
                    <button
                      className="option-menu-item option-with-arrow"
                      type="button"
                      role="menuitem"
                      aria-expanded={openAssignment === item.key}
                      onClick={() => setOpenAssignment(openAssignment === item.key ? null : item.key)}
                    >
                      {item.label}<span aria-hidden="true">›</span>
                    </button>
                    {openAssignment === item.key && (
                      <div className="assignment-submenu" role="menu">
                        <button type="button" role="menuitem" onClick={() => {
                          if (item.key === "candidates") onAssignCandidates?.(assessment);
                          if (item.key === "evaluator") onAssignEvaluator?.(assessment);
                          if (item.key === "invigilator") onAssignInvigilator?.(assessment);
                          setShowOptions(false);
                          setOpenAssignment(null);
                        }}>Manual</button>
                        <button type="button" role="menuitem">Upload</button>
                      </div>
                    )}
                  </div>
                ))}
                <button className="option-menu-item" type="button" role="menuitem">Settings</button>
                <button className="option-menu-item" type="button" role="menuitem" onClick={() => { onInvigilate?.(assessment); setShowOptions(false); }}>Invigilate</button>
                {canEvaluate && <button className="option-menu-item" type="button" role="menuitem" onClick={() => { onEvaluate?.(assessment); setShowOptions(false); }}>Evaluate</button>}
                <button className="option-menu-item" type="button" role="menuitem">Reports</button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="assessment-card-body">
        <div className="assessment-card-icon" aria-hidden="true">
          <span className="icon-page" />
          <span className="icon-check">✓</span>
        </div>
        <div className="assessment-details">
          <p><span className="detail-icon">◷</span>Start Date: {assessment.start}</p>
          <p><span className="detail-icon">◷</span>End Date: {assessment.end}</p>
          <div className="assessment-stats">
            <p><strong>{assessment.questions}</strong> Total Questions</p>
            <p><strong>{assessment.questions}</strong> Assigned Questions</p>
            <p><strong>{assessment.marks}</strong> Total Marks</p>
            <p><strong>{assessment.candidates}</strong> Candidates</p>
          </div>
        </div>
      </div>
    </article>
  );
}

function AssessmentPreview({ assessment, onClose }: { assessment: AssessmentCardData; onClose: () => void }) {
  const [questions, setQuestions] = useState<QuestionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");

    fetch("/api/questions", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as QuestionRecord[] & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load questions");
        if (!Array.isArray(data)) throw new Error("The question list could not be read.");
        setQuestions(data);
      })
      .catch((loadError) => {
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load questions");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [assessment.id, retryCount]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const matchesSelection = (questionValue: string | null, selectedValue: string | null | undefined) =>
    !selectedValue?.trim() || questionValue?.trim().toLocaleLowerCase() === selectedValue.trim().toLocaleLowerCase();
  const matchingQuestions = questions.filter((question) =>
    matchesSelection(question.category, assessment.question_category)
    && matchesSelection(question.sub_category, assessment.sub_category)
    && matchesSelection(question.topic, assessment.topic)
    && (!assessment.question_language?.trim() || question.language?.trim().toLocaleLowerCase() === assessment.question_language.trim().toLocaleLowerCase())
  );

  const sections = assessment.sections?.length ? assessment.sections : [{ name: "Section A", question_type: "", question_count: "", correct_mark: "", wrong_mark: "", difficulty_percentages: [] }];
  const assignedQuestionIds = new Set<number>();
  const sectionQuestions = sections.map((section, index) => {
    const sectionQuestions = matchingQuestions.filter((question) =>
      !assignedQuestionIds.has(question.id)
      && matchesAssessmentQuestionType(question.question_type, section.question_type)
    );
    sectionQuestions.forEach((question) => assignedQuestionIds.add(question.id));
    return {
      name: section.name.trim() || `Section ${String.fromCharCode(65 + index)}`,
      questions: sectionQuestions,
    };
  });
  const unassignedQuestions = matchingQuestions.filter((question) => !assignedQuestionIds.has(question.id));
  if (unassignedQuestions.length > 0) {
    sectionQuestions.push({ name: sections.length ? "Other Questions" : "Section A", questions: unassignedQuestions });
  }

  return (
    <div className="assessment-preview-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="assessment-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="assessment-preview-title">
        <header className="assessment-preview-header">
          <div>
            <h1 id="assessment-preview-title">Preview</h1>
            <p>{assessment.title}{assessment.subtitle ? ` · ${assessment.subtitle}` : ""}</p>
            {(assessment.question_category || assessment.sub_category || assessment.topic) && (
              <p className="assessment-preview-path">
                {[assessment.question_category, assessment.sub_category, assessment.topic].filter(Boolean).join("  ›  ")}
              </p>
            )}
          </div>
          <button className="assessment-preview-close" type="button" onClick={onClose} aria-label="Close preview">×</button>
        </header>

        <div className="assessment-preview-content" aria-live="polite">
          {loading ? (
            <p className="assessment-preview-message">Loading assessment questions…</p>
          ) : error ? (
            <div className="assessment-preview-message assessment-preview-error" role="alert">
              <p>{error}</p>
              <button type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button>
            </div>
          ) : matchingQuestions.length === 0 ? (
            <p className="assessment-preview-message">No questions match this assessment’s selected category, subcategory, topic, and language.</p>
          ) : (
            sectionQuestions.filter((section) => section.questions.length > 0).map((section) => (
              <section className="assessment-preview-section" key={section.name}>
                <div className="assessment-preview-section-heading">
                  <h2>{section.name}</h2>
                  <span>{section.questions.length} {section.questions.length === 1 ? "question" : "questions"}</span>
                </div>
                <div className="assessment-preview-question-list">
                  {section.questions.map((question) => {
                    const options = Array.isArray(question.details.options)
                      ? question.details.options.filter((option): option is string => typeof option === "string")
                      : [];
                    return (
                      <article className="assessment-preview-question" key={question.id}>
                        <div className="assessment-preview-question-heading">
                          <h3>{question.question}</h3>
                          {!question.status && <span className="assessment-preview-inactive">Inactive</span>}
                        </div>
                        {options.length > 0 && (
                          <ul className={`assessment-preview-options${question.question_type === "Multiple Choice" ? " is-multiple-choice" : ""}`}>
                            {options.map((option, index) => (
                              <li key={`${question.id}-${index}`}>
                                <span className="assessment-preview-option-marker" aria-hidden="true" />
                                <span>{option}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

type EvaluationCandidate = {
  candidate_id: number;
  candidate_name: string;
  candidate_code: string;
  category: string;
  sub_category: string;
  status: "Pending" | "Submitted" | "Evaluated" | "Exam is not attend";
  has_submission: boolean;
  started_at: string | null;
  submitted_at: string | null;
  evaluated_at: string | null;
  obtained_mark: number | null;
};

type EvaluationQuestion = {
  id: number;
  question_type: string;
  question: string;
  section: string;
  options: string[];
  correct_answer: unknown;
  correct_mark: number;
  wrong_mark: number;
  passage: string | null;
  grade: { status: "correct" | "incorrect" | "manual" | "unanswered"; mark: number | null } | null;
  is_manual: boolean;
};

type EvaluationDetail = {
  assessment: { id: number; name: string; examination: string };
  candidate: {
    id: number;
    name: string;
    candidate_id: string;
    category: string;
    sub_category: string;
  };
  started_at: string;
  submitted_at: string;
  evaluated_at: string | null;
  obtained_mark: number | null;
  max_mark: number;
  answers: Record<string, string | string[]>;
  manual_marks: Record<string, number>;
  selfie_photo: string;
  id_photo: string;
  questions: EvaluationQuestion[];
};

function AssessmentEvaluation({ assessment, accountUserId, onClose }: {
  assessment: AssessmentCardData;
  accountUserId: number | null;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<EvaluationCandidate[]>([]);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
  const [detail, setDetail] = useState<EvaluationDetail | null>(null);
  const [manualMarks, setManualMarks] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(Boolean(accountUserId && assessment.id));
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    if (!accountUserId || !assessment.id) {
      return () => controller.abort();
    }
    fetch(`/api/assessment-evaluations?assessmentId=${assessment.id}&accountUserId=${accountUserId}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { candidates?: EvaluationCandidate[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Unable to load evaluation candidates.");
        if (!Array.isArray(payload.candidates)) throw new Error("The evaluation candidate list could not be read.");
        setCandidates(payload.candidates);
      })
      .catch((loadError) => {
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load evaluation candidates.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [accountUserId, assessment.id, retryCount]);

  useEffect(() => {
    if (!selectedCandidateId || !accountUserId || !assessment.id) {
      return;
    }
    const controller = new AbortController();
    fetch(`/api/assessment-evaluations?assessmentId=${assessment.id}&accountUserId=${accountUserId}&candidateId=${selectedCandidateId}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as EvaluationDetail & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Unable to load this candidate's submitted answers.");
        setDetail(payload);
        setManualMarks(payload.manual_marks ?? {});
      })
      .catch((loadError) => {
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setDetail(null);
        setError(loadError instanceof Error ? loadError.message : "Unable to load this candidate's submitted answers.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [accountUserId, assessment.id, retryCount, selectedCandidateId]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (selectedCandidateId !== null) {
          setSelectedCandidateId(null);
          setDetail(null);
          setDetailLoading(false);
          setError("");
        }
        else onClose();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, selectedCandidateId]);

  const filteredCandidates = candidates.filter((candidate) =>
    `${candidate.candidate_code} ${candidate.candidate_name} ${candidate.category} ${candidate.sub_category} ${candidate.status}`
      .toLocaleLowerCase()
      .includes(candidateSearch.trim().toLocaleLowerCase()),
  );
  const accessError = !accountUserId || !assessment.id
    ? "Sign in as an administrator or evaluator to view assessment evaluations."
    : "";
  const listError = error || accessError;
  const manualQuestions = detail?.questions.filter((question) => question.is_manual) ?? [];
  const missingManualMarks = manualQuestions.some((question) =>
    !Number.isFinite(Number(manualMarks[String(question.id)]))
    || manualMarks[String(question.id)] < 0
    || manualMarks[String(question.id)] > Math.max(question.correct_mark, 0),
  );
  const estimatedMark = detail?.questions.reduce((total, question) => {
    if (question.is_manual) return total + (Number(manualMarks[String(question.id)]) || 0);
    return total + (question.grade?.mark ?? 0);
  }, 0) ?? 0;

  const markAsEvaluated = async () => {
    if (!detail || !accountUserId || missingManualMarks) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/assessment-evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentId: assessment.id,
          accountUserId,
          candidateId: detail.candidate.id,
          manualMarks,
        }),
      });
      const payload = await response.json() as { error?: string; obtained_mark?: number; evaluated_at?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to mark this assessment as evaluated.");
      setDetail((current) => current ? {
        ...current,
        evaluated_at: payload.evaluated_at ?? new Date().toISOString(),
        obtained_mark: Number(payload.obtained_mark ?? 0),
        manual_marks: manualMarks,
        questions: current.questions.map((question) => {
          if (!question.is_manual) return question;
          const mark = Number(manualMarks[String(question.id)] ?? 0);
          return {
            ...question,
            grade: { status: mark > 0 ? "correct" : "incorrect", mark },
          };
        }),
      } : current);
      setCandidates((current) => current.map((candidate) => candidate.candidate_id === detail.candidate.id
        ? { ...candidate, status: "Evaluated", evaluated_at: payload.evaluated_at ?? new Date().toISOString(), obtained_mark: Number(payload.obtained_mark ?? 0) }
        : candidate));
      setSuccess("Evaluation saved successfully.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save this evaluation.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="assessment-evaluation-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="assessment-evaluation-dialog" role="dialog" aria-modal="true" aria-label={`Evaluate ${assessment.title}`}>
        <header className="assessment-evaluation-heading">
          <div>
            <p>{assessment.subtitle || "Assessment"}</p>
            <h1>{assessment.title}</h1>
          </div>
          <button type="button" onClick={onClose} aria-label="Close evaluation">×</button>
        </header>
        {selectedCandidateId === null ? (
          <div className="assessment-evaluation-list">
            <div className="assessment-evaluation-list-toolbar">
              <p>Select a submitted candidate to review their answers and photos.</p>
              <label>Search: <input value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} /></label>
            </div>
            {listError && <p className="assessment-evaluation-error" role="alert">{listError}{!accessError && <button type="button" onClick={() => { setLoading(true); setError(""); setRetryCount((count) => count + 1); }}>Try again</button>}</p>}
            <div className="assessment-evaluation-table-wrap">
              <table className="assessment-evaluation-table">
                <thead><tr><th>Candidate ID</th><th>Name</th><th>Category</th><th>Sub-Category</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                  {loading && !accessError ? (
                    <tr><td colSpan={6} className="assessment-evaluation-empty">Loading candidates…</td></tr>
                  ) : listError ? (
                    <tr><td colSpan={6} className="assessment-evaluation-empty">Evaluation access is unavailable.</td></tr>
                  ) : filteredCandidates.length === 0 ? (
                    <tr><td colSpan={6} className="assessment-evaluation-empty">No candidates are assigned to this assessment.</td></tr>
                  ) : filteredCandidates.map((candidate) => (
                    <tr key={candidate.candidate_id}>
                      <td>{candidate.candidate_code || candidate.candidate_id}</td>
                      <td>{candidate.candidate_name}</td>
                      <td>{candidate.category || "—"}</td>
                      <td>{candidate.sub_category || "—"}</td>
                      <td><span className={`assessment-evaluation-status is-${candidate.status.toLocaleLowerCase().replace(/\s+/g, "-")}`}>{candidate.status}</span></td>
                      <td>
                        <button
                          className="assessment-evaluation-open"
                          type="button"
                          disabled={!candidate.has_submission}
                          aria-label={`Evaluate ${candidate.candidate_name}`}
                          title={candidate.has_submission ? "Open candidate evaluation" : "Candidate has not submitted yet"}
                          onClick={() => {
                            setDetail(null);
                            setDetailLoading(true);
                            setError("");
                            setSuccess("");
                            setSelectedCandidateId(candidate.candidate_id);
                          }}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v5M14 3v5h5M7 12v8h12v-5M4 16l3 3 6-7" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="assessment-evaluation-count">Showing {filteredCandidates.length ? 1 : 0} to {filteredCandidates.length} of {filteredCandidates.length} entries</p>
          </div>
        ) : (
          <div className="assessment-evaluation-detail">
            <div className="assessment-evaluation-detail-toolbar">
              <button type="button" onClick={() => { setSelectedCandidateId(null); setDetail(null); setDetailLoading(false); setError(""); }}>← Candidate list</button>
              {detail && <span>Exam Start Time: <strong>{formatStudentExamDate(detail.started_at)}</strong></span>}
            </div>
            {error && <p className="assessment-evaluation-error" role="alert">{error}<button type="button" onClick={() => { setDetailLoading(true); setError(""); setRetryCount((count) => count + 1); }}>Retry</button></p>}
            {detailLoading && <p className="assessment-evaluation-empty">Loading candidate answers…</p>}
            {detail && (
              <>
                <section className="assessment-evaluation-summary">
                  <p className="assessment-evaluation-candidate-name">Candidate: <strong>{detail.candidate.name} ({detail.candidate.candidate_id || detail.candidate.id})</strong></p>
                  <div className="assessment-evaluation-summary-grid">
                    <table>
                      <tbody>
                        <tr><th>Session</th><td>{detail.assessment.examination || "—"}</td></tr>
                        <tr><th>Exam</th><td>{detail.assessment.name}</td></tr>
                        <tr><th>Total Mark</th><td>{detail.max_mark}</td></tr>
                        <tr><th>Mark Obtained</th><td>{detail.evaluated_at ? detail.obtained_mark : estimatedMark}</td></tr>
                      </tbody>
                    </table>
                    <div className="assessment-evaluation-photos">
                      <figure><figcaption>Photo</figcaption><NextImage src={detail.selfie_photo} alt={`Check-in selfie of ${detail.candidate.name}`} width={130} height={150} unoptimized /></figure>
                      <figure><figcaption>Photo with ID Card</figcaption><NextImage src={detail.id_photo} alt={`Check-in ID photo of ${detail.candidate.name}`} width={130} height={150} unoptimized /></figure>
                    </div>
                  </div>
                </section>
                {detail.questions.length === 0 ? (
                  <p className="assessment-evaluation-empty">No assessment questions are available to review.</p>
                ) : (
                  <div className="assessment-evaluation-sections">
                    {Array.from(new Set(detail.questions.map((question) => question.section))).map((section) => (
                      <section key={section}>
                        <h2>Section: {section}</h2>
                        {detail.questions.filter((question) => question.section === section).map((question, index) => {
                          const response = detail.answers[String(question.id)];
                          const options = question.options;
                          const grade = question.grade;
                          return (
                            <article className="assessment-evaluation-question" key={question.id}>
                              <div className="assessment-evaluation-question-heading">
                                <h3>{index + 1}. {question.question}</h3>
                                {question.is_manual ? (
                                  <span className={`assessment-evaluation-answer-badge${grade?.status === "correct" ? " is-correct" : grade?.status === "incorrect" ? " is-incorrect" : ""}`}>
                                    {grade?.status === "correct" ? "✓ Correct" : grade?.status === "incorrect" ? "× Incorrect" : "Manual marking"}
                                  </span>
                                ) : (
                                  <span className={`assessment-evaluation-answer-badge${grade?.status === "correct" ? " is-correct" : grade?.status === "incorrect" ? " is-incorrect" : ""}`}>
                                    {grade?.status === "correct" ? "✓ Correct" : grade?.status === "unanswered" ? "— No answer" : "× Incorrect"}
                                  </span>
                                )}
                              </div>
                              {question.passage && <p className="assessment-evaluation-passage">{question.passage}</p>}
                              {options.length > 0 ? (
                                <ul className="assessment-evaluation-options">
                                  {options.map((option, optionIndex) => {
                                    const correct = Array.isArray(question.correct_answer)
                                      ? question.correct_answer.some((item) => String(item).trim().toLocaleLowerCase() === option.trim().toLocaleLowerCase())
                                      : String(question.correct_answer ?? "").trim().toLocaleLowerCase() === option.trim().toLocaleLowerCase();
                                    const chosen = Array.isArray(response)
                                      ? response.some((item) => item.trim().toLocaleLowerCase() === option.trim().toLocaleLowerCase())
                                      : typeof response === "string" && response.trim().toLocaleLowerCase() === option.trim().toLocaleLowerCase();
                                    return (
                                      <li className={`${chosen ? "is-selected" : ""}${correct ? " is-correct-answer" : ""}`} key={`${question.id}-${optionIndex}`}>
                                        <span className="assessment-evaluation-option-marker">{String.fromCharCode(65 + optionIndex)}</span>
                                        <span>{option}</span>
                                        {chosen && <small>Your answer</small>}
                                        {correct && <small className="is-correct-label">Correct answer</small>}
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : (
                                <div className="assessment-evaluation-written-answer">
                                  <div><span>Candidate answer</span><p>{Array.isArray(response) ? response.join(", ") : response || "No answer provided"}</p></div>
                                  {!question.is_manual && <div><span>Correct answer</span><p>{Array.isArray(question.correct_answer) ? question.correct_answer.join(", ") : String(question.correct_answer ?? "Not configured")}</p></div>}
                                </div>
                              )}
                              <div className="assessment-evaluation-question-footer">
                                <span>{grade?.mark ?? 0} / {question.correct_mark} marks</span>
                                {question.is_manual && detail.evaluated_at === null && (
                                  <label>
                                    Manual mark
                                    <input
                                      type="number"
                                      min="0"
                                      max={Math.max(question.correct_mark, 0)}
                                      step="any"
                                      value={manualMarks[String(question.id)] ?? ""}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        setManualMarks((current) => {
                                          const next = { ...current };
                                          if (value === "") delete next[String(question.id)];
                                          else next[String(question.id)] = Number(value);
                                          return next;
                                        });
                                      }}
                                    />
                                  </label>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </section>
                    ))}
                  </div>
                )}
                {success && <p className="assessment-evaluation-success" role="status">{success}</p>}
                <div className="assessment-evaluation-submit">
                  {detail.evaluated_at && <span>Evaluated {formatStudentExamDate(detail.evaluated_at)}</span>}
                  <button type="button" disabled={saving || Boolean(detail.evaluated_at) || missingManualMarks} onClick={() => void markAsEvaluated()}>
                    {saving ? "Saving…" : detail.evaluated_at ? "Evaluated" : "Mark as evaluated"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function CandidateAssignment({ assessment, onClose }: { assessment: AssessmentCardData; onClose: () => void }) {
  const [categories, setCategories] = useState<CandidateCategory[]>([]);
  const [subCategories, setSubCategories] = useState<CandidateSubCategory[]>([]);
  const [candidates, setCandidates] = useState<Array<{
    id: number;
    name: string;
    candidate_data?: { category?: string; sub_category?: string; fields?: Record<string, unknown> };
    status?: boolean;
  }>>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [expandedSubCategoryId, setExpandedSubCategoryId] = useState<number | null>(null);
  const [assignedIds, setAssignedIds] = useState<number[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedRemovalIds, setSelectedRemovalIds] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<"available" | "assigned">("available");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      fetch("/api/candidate-categories", { signal: controller.signal }),
      fetch("/api/candidate-sub-categories", { signal: controller.signal }),
      fetch("/api/candidates", { signal: controller.signal }),
      fetch(`/api/assessment-candidate-assignments?assessmentId=${assessment.id}`, { signal: controller.signal }),
    ])
      .then(async ([categoryResponse, subCategoryResponse, candidateResponse, assignmentResponse]) => {
        const [categoryData, subCategoryData, candidateData, assignmentData] = await Promise.all([
          categoryResponse.json() as Promise<CandidateCategory[] & { error?: string }>,
          subCategoryResponse.json() as Promise<CandidateSubCategory[] & { error?: string }>,
          candidateResponse.json() as Promise<Array<{
            id: number;
            name: string;
            candidate_data?: { category?: string; sub_category?: string; fields?: Record<string, unknown> };
            status?: boolean;
          }> & { error?: string }>,
          assignmentResponse.json() as Promise<number[] & { error?: string }>,
        ]);
        if (!categoryResponse.ok) throw new Error(categoryData.error ?? "Unable to load candidate categories");
        if (!subCategoryResponse.ok) throw new Error(subCategoryData.error ?? "Unable to load candidate sub-categories");
        if (!candidateResponse.ok) throw new Error(candidateData.error ?? "Unable to load candidates");
        if (!assignmentResponse.ok) throw new Error(assignmentData.error ?? "Unable to load existing assignments");
        setCategories(categoryData);
        setSubCategories(subCategoryData);
        setCandidates(candidateData.filter((candidate) => candidate.status !== false));
        setAssignedIds(assignmentData);
        setSelectedIds([]);
        setSelectedRemovalIds([]);
        setSelectedCategory("");
        setExpandedSubCategoryId(null);
      })
      .catch((loadError) => {
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load candidate assignment data");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [assessment.id, retryCount]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const assignedSubCategories = subCategories.filter((item) => assignedIds.includes(item.id));
  const availableSubCategories = subCategories.filter((item) => item.status && !assignedIds.includes(item.id));
  const availableCategories = [...new Set([
    ...categories
      .filter((item) => item.status || assignedSubCategories.some((subCategory) => subCategory.category === item.candidate_category))
      .map((item) => item.candidate_category),
    ...candidates.map((candidate) => candidate.candidate_data?.category?.trim() ?? ""),
  ].filter(Boolean))];
  const categorySubCategories = activeTab === "assigned"
    ? subCategories.filter((item) => assignedIds.includes(item.id))
    : subCategories.filter((item) =>
      item.category === selectedCategory && item.status && !assignedIds.includes(item.id)
    );
  const countCandidates = (subCategory: CandidateSubCategory) => candidates.filter((candidate) =>
    candidate.status !== false
    && candidate.candidate_data?.category?.trim() === subCategory.category.trim()
    && candidate.candidate_data?.sub_category?.trim() === subCategory.candidate_sub_category.trim()
  );

  const saveAssignments = async () => {
    if (!assessment.id) {
      setError("Save this assessment before assigning candidates.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const nextAssignedIds = activeTab === "assigned"
        ? assignedIds.filter((id) => !selectedRemovalIds.includes(id))
        : [...new Set([...assignedIds, ...selectedIds])];
      const response = await fetch("/api/assessment-candidate-assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessment_id: assessment.id, candidate_sub_category_ids: nextAssignedIds }),
      });
      const data = await response.json() as { candidate_sub_category_ids?: number[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to save candidate assignments");
      const savedIds = data.candidate_sub_category_ids ?? [];
      setAssignedIds(savedIds);
      setSelectedIds([]);
      setSelectedRemovalIds([]);
      setActiveTab(activeTab === "assigned" ? "available" : "assigned");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save candidate assignments");
    } finally {
      setSaving(false);
    }
  };

  const toggleSubCategory = (id: number) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const toggleSubCategoryRemoval = (id: number) => {
    setSelectedRemovalIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const visibleSelectionIds = activeTab === "assigned" ? selectedRemovalIds : selectedIds;
  const allVisibleSelected = categorySubCategories.length > 0 && categorySubCategories.every((item) => visibleSelectionIds.includes(item.id));

  return (
    <div className="candidate-assignment-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="candidate-assignment-dialog" role="dialog" aria-modal="true" aria-labelledby="candidate-assignment-title">
        <header className="candidate-assignment-header">
          <h1 id="candidate-assignment-title">Assign Candidate</h1>
          <button className="candidate-assignment-close" type="button" onClick={onClose} aria-label="Close candidate assignment">×</button>
        </header>
        <div className="candidate-assignment-exam">
          <span>{assessment.subtitle}</span>
          <strong>{assessment.title}</strong>
        </div>
        <div className="candidate-assignment-tabs" role="tablist" aria-label="Candidate sub-categories">
          <button className={activeTab === "available" ? "is-active" : ""} type="button" role="tab" aria-selected={activeTab === "available"} onClick={() => setActiveTab("available")}>
            <span aria-hidden="true">♟</span> Candidate&apos;s Sub-Categories <b>{availableSubCategories.filter((item) => item.category === selectedCategory).length}</b>
          </button>
          <button className={activeTab === "assigned" ? "is-active" : ""} type="button" role="tab" aria-selected={activeTab === "assigned"} onClick={() => setActiveTab("assigned")}>
            <span aria-hidden="true">♟</span> Assigned Candidate&apos;s Sub-Categories <b>{assignedIds.length}</b>
          </button>
        </div>
        <div className="candidate-assignment-panel">
          {loading ? (
            <p className="candidate-assignment-message">Loading candidate categories and sub-categories…</p>
          ) : error && categories.length === 0 ? (
            <div className="candidate-assignment-message candidate-assignment-error" role="alert">
              <p>{error}</p>
              <button type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button>
            </div>
          ) : (
            <>
              {activeTab === "available" && (
                <label className="candidate-assignment-category" htmlFor="assignment-candidate-category">
                  <span>Category</span>
                  <select id="assignment-candidate-category" value={selectedCategory} onChange={(event) => { setSelectedCategory(event.target.value); setExpandedSubCategoryId(null); }}>
                    <option value="">Select a category</option>
                    {availableCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </label>
              )}
              {error && <p className="candidate-assignment-inline-error" role="alert">{error}</p>}
              <div className="candidate-assignment-table-wrap">
                <table className="candidate-assignment-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select all visible sub-categories"
                          checked={allVisibleSelected}
                          onChange={() => (activeTab === "assigned" ? setSelectedRemovalIds : setSelectedIds)((current) => {
                            const visibleIds = categorySubCategories.map((item) => item.id);
                            return allVisibleSelected
                              ? current.filter((id) => !visibleIds.includes(id))
                              : [...new Set([...current, ...visibleIds])];
                          })}
                        />
                      </th>
                      <th>Sub-Categories</th>
                      <th>Candidate(s)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categorySubCategories.map((subCategory) => {
                      const subCategoryCandidates = countCandidates(subCategory);
                      const isExpanded = expandedSubCategoryId === subCategory.id;
                      return (
                        <React.Fragment key={subCategory.id}>
                          <tr>
                            <td><input type="checkbox" aria-label={`${activeTab === "assigned" ? "Remove" : "Assign"} ${subCategory.candidate_sub_category}`} checked={visibleSelectionIds.includes(subCategory.id)} onChange={() => activeTab === "assigned" ? toggleSubCategoryRemoval(subCategory.id) : toggleSubCategory(subCategory.id)} /></td>
                            <td>{subCategory.candidate_sub_category}{!subCategory.status && <small className="candidate-assignment-inactive">Inactive</small>}</td>
                            <td>
                              <button
                                className="candidate-assignment-count-button"
                                type="button"
                                aria-expanded={isExpanded}
                                onClick={() => setExpandedSubCategoryId(isExpanded ? null : subCategory.id)}
                              >
                                {subCategoryCandidates.length} {subCategoryCandidates.length === 1 ? "student" : "students"}
                                <span aria-hidden="true">{isExpanded ? "⌃" : "⌄"}</span>
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="candidate-assignment-student-row">
                              <td />
                              <td colSpan={2}>
                                {subCategoryCandidates.length > 0 ? (
                                  <ul className="candidate-assignment-student-list">
                                    {subCategoryCandidates.map((candidate) => (
                                      <li key={candidate.id}>
                                        <span>{getCandidateFieldValue(candidate.candidate_data, "Candidate Name") || candidate.name}</span>
                                        <strong>{getCandidateFieldValue(candidate.candidate_data, "Candidate ID") || `ID ${candidate.id}`}</strong>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="candidate-assignment-no-students">No active students in this sub-category.</span>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {categorySubCategories.length === 0 && (
                      <tr><td colSpan={3}>{activeTab === "assigned" ? "No sub-categories are assigned to this assessment." : selectedCategory ? "No sub-categories in this view." : "Select a candidate category to view its sub-categories."}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {activeTab === "assigned" && assignedIds.length > 0 && (
                <button className="candidate-assignment-update-button" type="button" onClick={saveAssignments} disabled={saving || selectedRemovalIds.length === 0}>
                  {saving ? "Saving…" : "REMOVE CANDIDATE"}
                </button>
              )}
              {activeTab === "available" && (
                <button className="candidate-assignment-update-button" type="button" onClick={saveAssignments} disabled={saving || selectedIds.length === 0}>
                  {saving ? "Saving…" : "ASSIGN CANDIDATES"}
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

type EvaluatorCandidate = {
  id: number;
  name: string;
  candidate_data?: { category?: string; sub_category?: string; fields?: Record<string, unknown> };
  status?: boolean;
};

function getCandidateFieldValue(candidateData: EvaluatorCandidate["candidate_data"], fieldLabel: string) {
  const fields = candidateData?.fields;
  if (!fields) return "";
  if (isCandidateIdFieldName(fieldLabel)) {
    const candidateId = Object.entries(fields).find(([label, value]) =>
      isCandidateIdFieldName(label) && value != null && /^\d{6}$/.test(String(value).trim())
    );
    return candidateId ? String(candidateId[1]).trim() : "";
  }
  const targetLabel = fieldLabel.toLocaleLowerCase();
  const matchingEntry = Object.entries(fields).find(([label, value]) =>
    label.trim().toLocaleLowerCase() === targetLabel && value != null && String(value).trim()
  ) ?? Object.entries(fields).find(([label, value]) =>
    label.trim().toLocaleLowerCase().startsWith(targetLabel) && value != null && String(value).trim()
  );
  return matchingEntry ? String(matchingEntry[1]).trim() : "";
}

type AssessmentStaffAssignmentRecord = {
  candidate_id: number;
  staff_user_id: number;
  candidate_name: string;
  candidate_data?: EvaluatorCandidate["candidate_data"];
  staff_name: string;
  staff_email: string;
};

function AssessmentStaffAssignment({ assessment, role, onClose }: { assessment: AssessmentCardData; role: "evaluator" | "invigilator"; onClose: () => void }) {
  const [categories, setCategories] = useState<CandidateCategory[]>([]);
  const [subCategories, setSubCategories] = useState<CandidateSubCategory[]>([]);
  const [candidates, setCandidates] = useState<EvaluatorCandidate[]>([]);
  const [staffUsers, setStaffUsers] = useState<Array<{ id: number; name: string; email: string; role: string; status: boolean }>>([]);
  const [assignments, setAssignments] = useState<AssessmentStaffAssignmentRecord[]>([]);
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [visibleCandidateIds, setVisibleCandidateIds] = useState<number[] | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const [selectedAssignedCandidateIds, setSelectedAssignedCandidateIds] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<"candidates" | "assigned">("candidates");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      fetch("/api/candidate-categories", { signal: controller.signal }),
      fetch("/api/candidate-sub-categories", { signal: controller.signal }),
      fetch("/api/candidates", { signal: controller.signal }),
      fetch("/api/users", { signal: controller.signal }),
      fetch(`/api/assessment-${role}-assignments?assessmentId=${assessment.id}`, { signal: controller.signal }),
    ])
      .then(async ([categoryResponse, subCategoryResponse, candidateResponse, usersResponse, assignmentResponse]) => {
        const [categoryData, subCategoryData, candidateData, usersData, assignmentData] = await Promise.all([
          categoryResponse.json() as Promise<CandidateCategory[] & { error?: string }>,
          subCategoryResponse.json() as Promise<CandidateSubCategory[] & { error?: string }>,
          candidateResponse.json() as Promise<EvaluatorCandidate[] & { error?: string }>,
          usersResponse.json() as Promise<Array<{ id: number; name: string; email: string; role: string; status: boolean }> & { error?: string }>,
          assignmentResponse.json() as Promise<Array<Record<string, unknown>> & { error?: string }>,
        ]);
        if (!categoryResponse.ok) throw new Error(categoryData.error ?? "Unable to load candidate categories");
        if (!subCategoryResponse.ok) throw new Error(subCategoryData.error ?? "Unable to load candidate sub-categories");
        if (!candidateResponse.ok) throw new Error(candidateData.error ?? "Unable to load candidates");
        if (!usersResponse.ok) throw new Error(usersData.error ?? `Unable to load ${role} accounts`);
        if (!assignmentResponse.ok) throw new Error(assignmentData.error ?? `Unable to load ${role} assignments`);
        setCategories(categoryData.filter((item) => item.status));
        setSubCategories(subCategoryData.filter((item) => item.status));
        setCandidates(candidateData.filter((item) => item.status !== false));
        setStaffUsers(usersData.filter((user) => user.role.trim().toLocaleLowerCase() === role));
        setAssignments(assignmentData.map((assignment) => ({
          candidate_id: Number(assignment.candidate_id),
          staff_user_id: Number(assignment[`${role}_user_id`]),
          candidate_name: String(assignment.candidate_name ?? ""),
          candidate_data: assignment.candidate_data as EvaluatorCandidate["candidate_data"],
          staff_name: String(assignment[`${role}_name`] ?? ""),
          staff_email: String(assignment[`${role}_email`] ?? ""),
        })));
        setSelectedCandidateIds([]);
        setSelectedAssignedCandidateIds([]);
      })
      .catch((loadError) => {
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : `Unable to load ${role} assignment data`);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [assessment.id, retryCount, role]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const availableCategories = [...new Set([
    ...categories.map((item) => item.candidate_category),
    ...candidates.map((candidate) => candidate.candidate_data?.category?.trim() ?? ""),
  ].filter(Boolean))];
  const availableSubCategories = [...new Set([
    ...subCategories.filter((item) => item.category === category).map((item) => item.candidate_sub_category),
    ...candidates
      .filter((candidate) => candidate.candidate_data?.category === category)
      .map((candidate) => candidate.candidate_data?.sub_category?.trim() ?? ""),
  ].filter(Boolean))];
  const candidatesForSearch = candidates.filter((candidate) => {
    return candidate.candidate_data?.category === category
      && candidate.candidate_data?.sub_category === subCategory;
  });
  const visibleCandidates = visibleCandidateIds === null
    ? []
    : candidatesForSearch.filter((candidate) =>
      visibleCandidateIds.includes(candidate.id)
      && !assignments.some((assignment) => assignment.candidate_id === candidate.id)
    );
  const toggleCandidate = (id: number) => {
    setSelectedCandidateIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const saveAssignments = async (nextAssignments: AssessmentStaffAssignmentRecord[]) => {
    if (!assessment.id) {
      setError(`Save this assessment before assigning ${role}s.`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/assessment-${role}-assignments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessment_id: assessment.id,
          assignments: nextAssignments.map((assignment) => ({
            candidate_id: assignment.candidate_id,
            [`${role}_user_id`]: assignment.staff_user_id,
          })),
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? `Unable to save ${role} assignments`);
      setAssignments(nextAssignments);
      setSelectedCandidateIds([]);
      setSelectedAssignedCandidateIds([]);
      setActiveTab(activeTab === "candidates" ? "assigned" : "candidates");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : `Unable to save ${role} assignments`);
    } finally {
      setSaving(false);
    }
  };
  const assignCandidates = () => {
    const selectedStaff = staffUsers.find((staff) => String(staff.id) === selectedStaffId);
    if (!selectedStaff) {
      setError(`Choose an ${role} before assigning candidates.`);
      return;
    }
    if (selectedCandidateIds.length === 0) {
      setError("Select at least one candidate to assign.");
      return;
    }
    const newAssignments = selectedCandidateIds.flatMap((candidateId) => {
      const candidate = candidates.find((item) => item.id === candidateId);
      return candidate ? [{
        candidate_id: candidate.id,
        staff_user_id: selectedStaff.id,
        candidate_name: getCandidateFieldValue(candidate.candidate_data, "Candidate Name") || candidate.name,
        candidate_data: candidate.candidate_data,
        staff_name: selectedStaff.name,
        staff_email: selectedStaff.email,
      }] : [];
    });
    void saveAssignments([...assignments, ...newAssignments]);
  };
  const removeAssignedCandidates = () => {
    if (selectedAssignedCandidateIds.length === 0) return;
    void saveAssignments(assignments.filter((assignment) => !selectedAssignedCandidateIds.includes(assignment.candidate_id)));
  };

  return (
    <div className="candidate-assignment-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="candidate-assignment-dialog evaluator-assignment-dialog" role="dialog" aria-modal="true" aria-labelledby="staff-assignment-title">
        <header className="candidate-assignment-header">
          <h1 id="staff-assignment-title">Assign {role === "evaluator" ? "Evaluator" : "Invigilator"}</h1>
          <button className="candidate-assignment-close" type="button" onClick={onClose} aria-label={`Close ${role} assignment`}>×</button>
        </header>
        <div className="candidate-assignment-exam">
          <span>{assessment.subtitle}</span>
          <strong>{assessment.title}</strong>
        </div>
        <div className="evaluator-assignment-tabs" role="tablist" aria-label="Candidates">
          <button className={activeTab === "candidates" ? "is-active" : ""} type="button" role="tab" aria-selected={activeTab === "candidates"} onClick={() => setActiveTab("candidates")}>
            <span aria-hidden="true">♟</span> Candidates <b>{candidates.length - assignments.length}</b>
          </button>
          <button className={activeTab === "assigned" ? "is-active" : ""} type="button" role="tab" aria-selected={activeTab === "assigned"} onClick={() => setActiveTab("assigned")}>
            <span aria-hidden="true">♟</span> Assigned Candidates <b>{assignments.length}</b>
          </button>
        </div>
        <div className="evaluator-assignment-panel">
          {loading ? (
            <p className="candidate-assignment-message">Loading candidates and {role}s…</p>
          ) : error && categories.length === 0 && staffUsers.length === 0 ? (
            <div className="candidate-assignment-message candidate-assignment-error" role="alert">
              <p>{error}</p>
              <button type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button>
            </div>
          ) : (
            <>
              {error && <p className="candidate-assignment-inline-error" role="alert">{error}</p>}
              <div className="evaluator-assignment-columns">
                <section className="evaluator-candidate-browser" aria-label="Candidate filters">
                  {activeTab === "candidates" ? (
                    <>
                      <div className="evaluator-candidate-filter-grid">
                        <label className="evaluator-filter-field">
                          <span>Category</span>
                          <select value={category} onChange={(event) => { setCategory(event.target.value); setSubCategory(""); setVisibleCandidateIds(null); setSelectedCandidateIds([]); }}>
                            <option value="">Choose</option>
                            {availableCategories.map((item) => <option key={item} value={item}>{item}</option>)}
                          </select>
                        </label>
                        <label className="evaluator-filter-field">
                          <span>Sub-Category</span>
                          <select value={subCategory} onChange={(event) => { setSubCategory(event.target.value); setVisibleCandidateIds(null); setSelectedCandidateIds([]); }} disabled={!category}>
                            <option value="">Choose</option>
                            {availableSubCategories.map((item) => <option key={item} value={item}>{item}</option>)}
                          </select>
                        </label>
                      </div>
                      <div className="evaluator-filter-actions">
                        <button type="button" onClick={() => {
                          setCategory("");
                          setSubCategory("");
                          setSelectedCandidateIds([]);
                          setVisibleCandidateIds(null);
                        }}>Reset</button>
                        <button type="button" onClick={() => {
                          setVisibleCandidateIds(candidatesForSearch.map((candidate) => candidate.id));
                          setSelectedCandidateIds([]);
                        }} disabled={!category || !subCategory}>Get Candidate(s)</button>
                      </div>
                    </>
                  ) : (
                    <p className="evaluator-filter-help">Assigned candidates are listed on the right with their {role}s.</p>
                  )}
                </section>
                <section className="evaluator-assignment-controls" aria-label={activeTab === "candidates" ? `Candidate results and ${role}` : "Assigned candidates"}>
                  {activeTab === "candidates" ? (
                    <>
                      <label className="evaluator-filter-field evaluator-picker">
                        <span>{role === "evaluator" ? "Evaluator" : "Invigilator"}</span>
                        <select value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.target.value)}>
                          <option value="">Choose</option>
                          {staffUsers.map((staff) => (
                            <option key={staff.id} value={staff.id} disabled={!staff.status}>
                              {staff.name} ({staff.email}){staff.status ? "" : " — Inactive"}
                            </option>
                          ))}
                        </select>
                      </label>
                      {staffUsers.length === 0 && <p className="evaluator-empty-state">No user accounts currently have the {role} role. Add a user with the {role} role to assign candidates.</p>}
                      {visibleCandidateIds !== null ? (
                        <div className="evaluator-candidate-results evaluator-candidate-table-wrap">
                          <div className="evaluator-results-heading">
                            <strong>{visibleCandidates.length} candidate(s)</strong>
                            <button type="button" onClick={() => setSelectedCandidateIds((current) => {
                              const visibleIds = visibleCandidates.map((candidate) => candidate.id);
                              return visibleIds.length > 0 && visibleIds.every((id) => current.includes(id))
                                ? current.filter((id) => !visibleIds.includes(id))
                                : [...new Set([...current, ...visibleIds])];
                            })} disabled={visibleCandidates.length === 0}>
                              {visibleCandidates.length > 0 && visibleCandidates.every((candidate) => selectedCandidateIds.includes(candidate.id)) ? "Deselect All" : "Select All"}
                            </button>
                          </div>
                          <table className="evaluator-candidate-table">
                            <thead><tr><th aria-label="Select candidate" /><th>Candidate ID</th><th>Candidate Name</th><th>Category</th><th>Sub-Category</th></tr></thead>
                            <tbody>
                              {visibleCandidates.map((candidate) => (
                                <tr key={candidate.id}>
                                  <td><input type="checkbox" aria-label={`Select ${candidate.name}`} checked={selectedCandidateIds.includes(candidate.id)} onChange={() => toggleCandidate(candidate.id)} /></td>
                                  <td>{getCandidateFieldValue(candidate.candidate_data, "Candidate ID") || `ID ${candidate.id}`}</td>
                                  <td>{getCandidateFieldValue(candidate.candidate_data, "Candidate Name") || candidate.name}</td>
                                  <td>{candidate.candidate_data?.category ?? "—"}</td>
                                  <td>{candidate.candidate_data?.sub_category ?? "—"}</td>
                                </tr>
                              ))}
                              {visibleCandidates.length === 0 && <tr><td colSpan={5}>No unassigned candidates match these filters.</td></tr>}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="evaluator-empty-state">Set category and sub-category filters, then select Get Candidate(s).</p>
                      )}
                    </>
                  ) : (
                    <div className="evaluator-assigned-candidates evaluator-candidate-table-wrap">
                      <div className="evaluator-results-heading"><strong>Assigned Candidates ({assignments.length})</strong></div>
                      <table className="evaluator-candidate-table">
                        <thead><tr><th aria-label="Select assigned candidate" /><th>Candidate ID</th><th>Candidate Name</th><th>Category</th><th>Sub-Category</th><th>{role === "evaluator" ? "Evaluator" : "Invigilator"}</th></tr></thead>
                        <tbody>
                          {assignments.map((assignment) => (
                            <tr key={assignment.candidate_id}>
                              <td><input type="checkbox" aria-label={`Select ${assignment.candidate_name} to remove`} checked={selectedAssignedCandidateIds.includes(assignment.candidate_id)} onChange={() => setSelectedAssignedCandidateIds((current) => current.includes(assignment.candidate_id) ? current.filter((id) => id !== assignment.candidate_id) : [...current, assignment.candidate_id])} /></td>
                              <td>{getCandidateFieldValue(assignment.candidate_data, "Candidate ID") || `ID ${assignment.candidate_id}`}</td>
                              <td>{getCandidateFieldValue(assignment.candidate_data, "Candidate Name") || assignment.candidate_name}</td>
                              <td>{assignment.candidate_data?.category ?? "—"}</td>
                              <td>{assignment.candidate_data?.sub_category ?? "—"}</td>
                              <td><span className="evaluator-table-name">{assignment.staff_name}</span><small className="evaluator-table-email">{assignment.staff_email}</small></td>
                            </tr>
                          ))}
                          {assignments.length === 0 && <tr><td colSpan={6}>No candidates are assigned to an {role} for this assessment.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
              <div className="evaluator-assignment-footer">
                {activeTab === "candidates" ? (
                  <button type="button" onClick={assignCandidates} disabled={saving || selectedCandidateIds.length === 0}>
                    {saving ? "Assigning…" : "Assign Candidate"}
                  </button>
                ) : (
                  <button type="button" onClick={removeAssignedCandidates} disabled={saving || selectedAssignedCandidateIds.length === 0}>
                    {saving ? "Removing…" : "Remove Candidate"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

type InvigilationCandidate = {
  candidate_id: number;
  candidate_name: string;
  candidate_data?: EvaluatorCandidate["candidate_data"];
  category: string;
  sub_category: string;
  candidate_status: boolean;
  invigilator_name: string | null;
};

const liveActivityItems = [
  { label: "No Face Detected", icon: "◉", tone: "alert", countKey: "noFace" },
  { label: "OK", icon: "☻", tone: "success", countKey: "okay" },
  { label: "Multiple Face Detected", icon: "♟", tone: "alert", countKey: "multipleFaces" },
  { label: "Person changed", icon: "♟", tone: "alert", countKey: "personChanges" },
  { label: "Motion detected", icon: "↔", tone: "alert", countKey: "motionEvents" },
  { label: "Camera blocked!", icon: "▧", tone: "alert", countKey: "cameraBlocked" },
  { label: "Tab change detected!", icon: "▣", tone: "alert", countKey: "tabChanges" },
  { label: "Full-Screen Mode disabled!", icon: "▣", tone: "alert", countKey: "fullscreenDisabled" },
] as const;

type InvigilationProctorCounts = {
  noFace: number;
  okay: number;
  multipleFaces: number;
  personChanges: number;
  motionEvents: number;
  cameraBlocked: number;
  tabChanges: number;
  fullscreenDisabled: number;
};

type InvigilationActivity = {
  assessment_id: number;
  account_user_id: number;
  viewer_role: "admin" | "invigilator";
  live_candidates: number;
  assigned_candidates: number;
  totals: InvigilationProctorCounts;
  candidates: Array<{
    candidate_id: number;
    candidate_name: string;
    candidate_data?: EvaluatorCandidate["candidate_data"];
    counts: InvigilationProctorCounts;
    last_seen: string | null;
    is_live: boolean;
  }>;
};

function AssessmentInvigilation({ assessment, accountUserId, onClose }: { assessment: AssessmentCardData; accountUserId: number | null; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<"activity" | "candidates">("activity");
  const [candidates, setCandidates] = useState<InvigilationCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<InvigilationActivity | null>(null);
  const [activityError, setActivityError] = useState("");
  const [search, setSearch] = useState("");
  const [candidateAction, setCandidateAction] = useState<{ candidate: InvigilationCandidate; action: "timeline" | "feed" | "restart" } | null>(null);
  const [liveFeedStatus, setLiveFeedStatus] = useState("");
  const [liveFeedStream, setLiveFeedStream] = useState<MediaStream | null>(null);
  const liveFeedVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    if (!accountUserId) {
      setCandidates([]);
      setError("Sign in with an administrator or invigilator account to view assessment candidates.");
      setLoading(false);
      return () => controller.abort();
    }
    fetch(`/api/assessment-invigilate-candidates?assessmentId=${assessment.id}&accountUserId=${accountUserId}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as InvigilationCandidate[] & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load assessment candidates");
        if (!Array.isArray(data)) throw new Error("The assessment candidate list could not be read.");
        setCandidates(data);
      })
      .catch((loadError) => {
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load assessment candidates");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [accountUserId, assessment.id]);

  useEffect(() => {
    if (!accountUserId) {
      setActivity(null);
      setActivityError("Sign in with an administrator or invigilator account to view live monitoring counts.");
      return;
    }
    const controller = new AbortController();
    const loadActivity = async () => {
      try {
        const response = await fetch(
          `/api/assessment-invigilate-activity?assessmentId=${assessment.id}&accountUserId=${accountUserId}`,
          { signal: controller.signal },
        );
        const payload = await response.json() as InvigilationActivity & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Unable to load live monitoring counts.");
        setActivity(payload);
        setActivityError("");
      } catch (loadError) {
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setActivityError(loadError instanceof Error ? loadError.message : "Unable to load live monitoring counts.");
      }
    };
    void loadActivity();
    const interval = window.setInterval(() => void loadActivity(), 5000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [accountUserId, assessment.id]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (candidateAction) {
          setCandidateAction(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [candidateAction, onClose]);

  useEffect(() => {
    if (candidateAction?.action !== "feed" || !accountUserId) {
      return;
    }
    let cancelled = false;
    let polling = false;
    let pollTimer = 0;
    let signalCursor = 0;
    const sessionId = crypto.randomUUID();
    const candidateRecordId = candidateAction.candidate.candidate_id;
    const pendingIceCandidates: RTCIceCandidateInit[] = [];
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    peer.addTransceiver("video", { direction: "recvonly" });
    const baseBody = {
      side: "staff",
      assessmentId: assessment.id,
      candidateRecordId,
      viewerUserId: accountUserId,
      sessionId,
    };
    let remoteDescriptionReady = false;
    let endSignalSent = false;
    const postSignal = async (action: "start" | "send", messageType: "offer" | "ice" | "end", payload: object) => {
      const response = await fetch("/api/candidates/student-exam/live-feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...baseBody, action, messageType, payload }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to connect to the candidate live feed.");
    };

    const closePeer = () => {
      peer.close();
      setLiveFeedStream(null);
    };

    const stopFeed = (notifyCandidate: boolean) => {
      if (notifyCandidate && !endSignalSent) {
        endSignalSent = true;
        void postSignal("send", "end", {}).catch((error) => console.error("Unable to end candidate live-feed session", error));
      }
      closePeer();
    };

    peer.ontrack = (event) => {
      if (event.streams[0]) {
        setLiveFeedStream(event.streams[0]);
        setLiveFeedStatus("Live camera connected.");
      }
    };
    peer.onicecandidate = (event) => {
      if (event.candidate && !cancelled) {
        void postSignal("send", "ice", event.candidate.toJSON())
          .catch((error) => console.error("Unable to send staff ICE information", error));
      }
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") setLiveFeedStatus("Live camera connected.");
      if (peer.connectionState === "failed") setLiveFeedStatus("Could not establish the live camera connection. A network relay may be required.");
      if (peer.connectionState === "disconnected") setLiveFeedStatus("Live camera connection interrupted.");
    };

    const pollSignals = async () => {
      if (cancelled || polling) return;
      polling = true;
      try {
        const response = await fetch("/api/candidates/student-exam/live-feed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...baseBody, action: "poll", afterId: signalCursor }),
        });
        const result = await response.json() as {
          signals: Array<{ id: string | number; message_type: string; payload: RTCSessionDescriptionInit | RTCIceCandidateInit }>;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Unable to receive the candidate live feed.");
        if (cancelled) return;
        for (const signal of result.signals ?? []) {
          const id = Number(signal.id);
          if (Number.isSafeInteger(id)) signalCursor = Math.max(signalCursor, id);
          if (signal.message_type === "answer" && !remoteDescriptionReady) {
            await peer.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
            remoteDescriptionReady = true;
            for (const candidate of pendingIceCandidates.splice(0)) await peer.addIceCandidate(candidate);
          } else if (signal.message_type === "ice") {
            const candidate = signal.payload as RTCIceCandidateInit;
            if (remoteDescriptionReady) await peer.addIceCandidate(candidate);
            else pendingIceCandidates.push(candidate);
          } else if (signal.message_type === "end") {
            endSignalSent = true;
            setLiveFeedStatus("The candidate or examination has ended the live feed.");
            closePeer();
            return;
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Unable to receive candidate live-feed signals", error);
          setLiveFeedStatus(error instanceof Error ? error.message : "Unable to connect to the candidate live feed.");
        }
      } finally {
        polling = false;
      }
    };

    void (async () => {
      try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await postSignal("start", "offer", { type: offer.type, sdp: offer.sdp });
        if (cancelled) return;
        setLiveFeedStatus("Waiting for the candidate to accept the live camera request…");
        await pollSignals();
        pollTimer = window.setInterval(() => void pollSignals(), 1000);
      } catch (error) {
        if (!cancelled) {
          console.error("Unable to start candidate live-feed session", error);
          setLiveFeedStatus(error instanceof Error ? error.message : "Unable to start the live camera request.");
        }
      }
    })();
    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      stopFeed(true);
    };
  }, [accountUserId, assessment.id, candidateAction]);

  useEffect(() => {
    if (liveFeedVideoRef.current) liveFeedVideoRef.current.srcObject = liveFeedStream;
  }, [liveFeedStream]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const openCandidateAction = (candidate: InvigilationCandidate, action: "timeline" | "feed" | "restart") => {
    if (action === "feed") {
      setLiveFeedStream(null);
      setLiveFeedStatus("Requesting consented live camera connection…");
    }
    setCandidateAction({ candidate, action });
  };
  const closeCandidateAction = () => {
    setCandidateAction(null);
    setLiveFeedStream(null);
    setLiveFeedStatus("");
  };
  const visibleCandidates = candidates.filter((candidate) => [
    getCandidateFieldValue(candidate.candidate_data, "Candidate ID"),
    getCandidateFieldValue(candidate.candidate_data, "Candidate Name") || candidate.candidate_name,
    candidate.category,
    candidate.sub_category,
  ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch)));
  const attendingCount = activity?.live_candidates ?? 0;
  const assignedCandidateCount = activity?.assigned_candidates ?? 0;
  const assessmentDetails = [
    { label: "Examination", value: assessment.subtitle },
    { label: "Start Date", value: assessment.start_date ? new Date(assessment.start_date).toLocaleString() : "" },
    { label: "End Date", value: assessment.end_date ? new Date(assessment.end_date).toLocaleString() : "" },
    { label: "Duration", value: assessment.total_time ? `${assessment.total_time} minutes` : "" },
    { label: "Question Category", value: assessment.question_category ?? "" },
    { label: "Question Sub-Category", value: assessment.sub_category ?? "" },
    { label: "Topic", value: assessment.topic ?? "" },
    { label: "Question Language", value: assessment.question_language ?? "" },
  ].filter((detail) => detail.value);
  const actionDetails = candidateAction ? {
    timeline: {
      title: `Timeline — ${getCandidateFieldValue(candidateAction.candidate.candidate_data, "Candidate Name") || candidateAction.candidate.candidate_name}`,
      message: "No exam timeline is available because candidate exam attempts are not implemented yet.",
    },
    feed: {
      title: `Live Feed — ${getCandidateFieldValue(candidateAction.candidate.candidate_data, "Candidate Name") || candidateAction.candidate.candidate_name}`,
      message: "",
    },
    restart: {
      title: "Restart Exam",
      message: "Exam restart is not available because candidate exam attempts are not implemented yet. No changes have been made.",
    },
  }[candidateAction.action] : null;

  return (
    <div className="invigilation-overlay">
      <main className="invigilation-page" aria-label={`Invigilation for ${assessment.title}`}>
        <header className="invigilation-heading">
          <button className="invigilation-close" type="button" onClick={onClose} aria-label="Close invigilation view">×</button>
          <small>{assessment.subtitle}</small>
          <h1>{assessment.title}</h1>
        </header>
        <nav className="invigilation-tabs" aria-label="Invigilation views">
          <button
            className={activeTab === "activity" ? "is-active" : ""}
            type="button"
            aria-current={activeTab === "activity" ? "page" : undefined}
            onClick={() => setActiveTab("activity")}
          >
            <span aria-hidden="true">⌁</span> Live Activity
          </button>
          <button
            className={activeTab === "candidates" ? "is-active" : ""}
            type="button"
            aria-current={activeTab === "candidates" ? "page" : undefined}
            onClick={() => setActiveTab("candidates")}
          >
            <span aria-hidden="true">♟</span> Candidates <b>{attendingCount} / {candidates.length}</b>
          </button>
        </nav>

        {assessmentDetails.length > 0 && (
          <section className="invigilation-assessment-details" aria-label="Assessment details">
            {assessmentDetails.map((detail) => (
              <div className="invigilation-assessment-detail" key={detail.label}>
                <span>{detail.label}</span>
                <strong>{detail.value}</strong>
              </div>
            ))}
          </section>
        )}

        {activeTab === "activity" ? (
          <section className="invigilation-panel" aria-label="Live activity">
            <p className="invigilation-placeholder">
              Live counts from {attendingCount} of {assignedCandidateCount} candidates {activity?.viewer_role === "admin" ? "assigned to this assessment" : "assigned to you"} · refreshes every 5 seconds.
            </p>
            {activityError && <p className="invigilation-error" role="alert">{activityError}</p>}
            <div className="invigilation-activity-list">
              {liveActivityItems.map((item) => (
                <details className="invigilation-activity-item" key={item.label}>
                  <summary>
                    <span className="invigilation-activity-label">
                      <span className="invigilation-activity-icon" aria-hidden="true">{item.icon}</span>
                      {item.label}
                      <b className={`invigilation-count ${item.tone}`}>{activity?.totals[item.countKey] ?? 0}</b>
                    </span>
                    <span className="invigilation-chevron" aria-hidden="true" />
                  </summary>
                  <div className="invigilation-activity-details" aria-live="polite">
                    {!activity || activity.candidates.filter((candidate) => candidate.is_live && candidate.counts[item.countKey] > 0).length === 0 ? (
                      <p>No active candidate events for this check.</p>
                    ) : (
                      <ul className="invigilation-activity-candidate-list">
                        {activity.candidates.filter((candidate) => candidate.is_live && candidate.counts[item.countKey] > 0).map((candidate) => (
                          <li key={candidate.candidate_id}>
                            <span>{getCandidateFieldValue(candidate.candidate_data, "Candidate Name") || candidate.candidate_name} · {getCandidateFieldValue(candidate.candidate_data, "Candidate ID") || `ID ${candidate.candidate_id}`}</span>
                            <b>{candidate.counts[item.countKey]}</b>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ) : (
          <section className="invigilation-panel invigilation-candidates-panel" aria-label="Assessment candidates">
            <div className="invigilation-candidates-toolbar">
              <p><strong>{attendingCount} / {assignedCandidateCount}</strong> candidates with live monitoring data.</p>
              <label>
                Search:
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
              </label>
            </div>
            {error && <p className="invigilation-error" role="alert">{error}</p>}
            <div className="invigilation-table-wrap">
              <table className="invigilation-table">
                <thead>
                  <tr>
                    <th>Candidate ID</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Sub-Category</th>
                    <th>Invigilator</th>
                    <th>Start Time</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8}>Loading assessment candidates...</td></tr>
                  ) : visibleCandidates.length === 0 ? (
                    <tr><td colSpan={8}>{error ? "Unable to show candidates." : "No candidates are assigned to an invigilator for this assessment."}</td></tr>
                  ) : visibleCandidates.map((candidate) => (
                    <tr key={candidate.candidate_id}>
                      <td>{getCandidateFieldValue(candidate.candidate_data, "Candidate ID") || `ID ${candidate.candidate_id}`}</td>
                      <td>{getCandidateFieldValue(candidate.candidate_data, "Candidate Name") || candidate.candidate_name}</td>
                      <td>{candidate.category}</td>
                      <td>{candidate.sub_category}</td>
                      <td>{candidate.invigilator_name || "—"}</td>
                      <td>{assessment.start_date ? new Date(assessment.start_date).toLocaleString() : "—"}</td>
                      <td><span className={`invigilation-candidate-status${candidate.candidate_status ? "" : " is-inactive"}`}>{candidate.candidate_status ? "Not Started Yet" : "Inactive"}</span></td>
                      <td>
                        <div className="invigilation-candidate-actions">
                          <button type="button" aria-label={`View timeline for ${candidate.candidate_name}`} title="View timeline" onClick={() => openCandidateAction(candidate, "timeline")}>◷</button>
                          <button type="button" aria-label={`View live feed for ${candidate.candidate_name}`} title="View live feed" onClick={() => openCandidateAction(candidate, "feed")}>▣</button>
                          <button type="button" aria-label={`Restart exam for ${candidate.candidate_name}`} title="Restart exam" onClick={() => openCandidateAction(candidate, "restart")}>↻</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="invigilation-table-footer">
              Showing {visibleCandidates.length ? 1 : 0} to {visibleCandidates.length} of {visibleCandidates.length} entries
            </footer>
          </section>
        )}
      </main>
      {actionDetails && (
        <div className="invigilation-action-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCandidateAction(); }}>
          {candidateAction?.action === "feed" ? (
            <section className="invigilation-action-dialog invigilation-live-feed-dialog" role="dialog" aria-modal="true" aria-labelledby="invigilation-action-title">
              <header>
                <div><h2 id="invigilation-action-title">{actionDetails.title}</h2><p>Live camera · Not recorded or stored</p></div>
              <button type="button" onClick={closeCandidateAction} aria-label="Close live feed">×</button>
              </header>
              <div className="invigilation-live-feed-video">
                <video ref={liveFeedVideoRef} autoPlay playsInline />
                {!liveFeedStream && <p role="status">{liveFeedStatus || "Waiting for candidate consent and camera connection…"}</p>}
                {liveFeedStream && <span><i /> LIVE</span>}
              </div>
              <p className="invigilation-live-feed-status" role="status">{liveFeedStatus}</p>
              <button type="button" onClick={closeCandidateAction}>End live view</button>
            </section>
          ) : (
            <section className="invigilation-action-dialog" role="dialog" aria-modal="true" aria-labelledby="invigilation-action-title">
              <h2 id="invigilation-action-title">{actionDetails.title}</h2>
              <p>{actionDetails.message}</p>
              <button type="button" onClick={closeCandidateAction}>Close</button>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function ManualAssessmentForm({ onClose, onSaved, initialAssessment }: { onClose: () => void; onSaved: (assessment: AssessmentCardData) => void; initialAssessment?: AssessmentCardData }) {
  const [sectionIds, setSectionIds] = useState(() => initialAssessment?.sections?.length ? initialAssessment.sections.map((_, index) => index) : [0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [examinations, setExaminations] = useState<AssessmentType[]>([]);
  const [loadingExaminations, setLoadingExaminations] = useState(true);
  const [questionCategories, setQuestionCategories] = useState<QuestionCategory[]>([]);
  const [loadingQuestionCategories, setLoadingQuestionCategories] = useState(true);
  const [questionSubCategories, setQuestionSubCategories] = useState<QuestionSubCategory[]>([]);
  const [loadingQuestionSubCategories, setLoadingQuestionSubCategories] = useState(true);
  const [questionTopics, setQuestionTopics] = useState<QuestionTopic[]>([]);
  const [questionLanguages, setQuestionLanguages] = useState<LanguageItem[]>([]);
  const [difficultyLevels, setDifficultyLevels] = useState<DifficultyLevel[]>([]);
  const [selectedExamination, setSelectedExamination] = useState(initialAssessment?.examination ?? "");
  const [selectedQuestionCategory, setSelectedQuestionCategory] = useState(initialAssessment?.question_category ?? "");
  const [selectedSubCategory, setSelectedSubCategory] = useState(initialAssessment?.sub_category ?? "");
  const [selectedTopic, setSelectedTopic] = useState(initialAssessment?.topic ?? "");
  const [selectedQuestionLanguage, setSelectedQuestionLanguage] = useState(initialAssessment?.question_language ?? "");

  const dateTimeLocalValue = (value?: string | null) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  };

  useEffect(() => {
    fetch("/api/assessment-types")
      .then(async (response) => {
        const data = await response.json() as AssessmentType[] & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load examinations");
        setExaminations(data.filter((item) => item.status));
      })
      .catch(() => setExaminations([]))
      .finally(() => setLoadingExaminations(false));
  }, []);

  const saveAssessment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    const form = event.currentTarget;
    const formData = new FormData(form);
    const sectionBlocks = Array.from(form.querySelectorAll<HTMLElement>(".section-block"));
    const sections = sectionBlocks.map((block) => ({
      name: block.querySelector<HTMLInputElement>("[data-section-field='name']")?.value ?? "",
      question_type: block.querySelector<HTMLSelectElement>("[data-section-field='question-type']")?.value ?? "",
      question_count: block.querySelector<HTMLInputElement>("[data-section-field='question-count']")?.value ?? "",
      correct_mark: block.querySelector<HTMLInputElement>("[data-section-field='correct-mark']")?.value ?? "",
      wrong_mark: block.querySelector<HTMLInputElement>("[data-section-field='wrong-mark']")?.value ?? "",
      difficulty_percentages: Array.from(block.querySelectorAll<HTMLInputElement>("[data-difficulty-field]"))
        .map((input) => ({ level: input.dataset.difficultyField ?? "", percentage: input.value })),
    }));

    try {
      const response = await fetch("/api/assessments", {
        method: initialAssessment?.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(initialAssessment?.id ? { id: initialAssessment.id } : {}),
          examination: formData.get("examination"),
          name: formData.get("name"),
          start_date: formData.get("start_date"),
          end_date: formData.get("end_date"),
          total_time: formData.get("total_time"),
          last_login: formData.get("last_login"),
          question_category: formData.get("question_category"),
          sub_category: formData.get("sub_category"),
          topic: formData.get("topic"),
          question_language: formData.get("question_language"),
          sections,
        }),
      });
      const data = await response.json() as {
        id?: number;
        error?: string;
        examination?: string;
        name?: string;
        start_date?: string | null;
        end_date?: string | null;
        total_time?: number | null;
        last_login?: number | null;
        question_category?: string | null;
        sub_category?: string | null;
        topic?: string | null;
        question_language?: string | null;
        sections?: AssessmentSection[];
      };
      if (!response.ok) throw new Error(data.error ?? "Unable to save assessment");

      onSaved({
        id: data.id,
        title: data.name ?? "New assessment",
        subtitle: data.examination ?? "",
        examination: data.examination ?? "",
        start_date: data.start_date ?? null,
        end_date: data.end_date ?? null,
        total_time: data.total_time ?? null,
        last_login: data.last_login ?? null,
        question_category: data.question_category ?? null,
        sub_category: data.sub_category ?? null,
        topic: data.topic ?? null,
        question_language: data.question_language ?? null,
        sections: data.sections ?? sections,
        start: data.start_date ? new Date(data.start_date).toLocaleString() : "Not scheduled",
        end: data.end_date ? new Date(data.end_date).toLocaleString() : "Not scheduled",
        questions: String((data.sections ?? sections).reduce((total, section) => total + (Number(section.question_count) || 0), 0)),
        marks: String(getAssessmentMaxMark(data.sections ?? sections)),
        candidates: initialAssessment?.candidates ?? "0",
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save assessment");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    Promise.all([
      fetch("/api/question-topics"),
      fetch("/api/languages"),
      fetch("/api/difficulty-levels"),
    ])
      .then(async ([topicsResponse, languagesResponse, difficultyResponse]) => {
        const topics = await topicsResponse.json() as QuestionTopic[] & { error?: string };
        const languages = await languagesResponse.json() as LanguageItem[] & { error?: string };
        const difficulties = await difficultyResponse.json() as DifficultyLevel[] & { error?: string };
        if (!topicsResponse.ok) throw new Error(topics.error ?? "Unable to load topics");
        if (!languagesResponse.ok) throw new Error(languages.error ?? "Unable to load languages");
        if (!difficultyResponse.ok) throw new Error(difficulties.error ?? "Unable to load difficulty levels");
        setQuestionTopics(topics.filter((item) => item.status));
        setQuestionLanguages(languages.filter((item) => item.status));
        setDifficultyLevels(difficulties.filter((item) => item.status));
      })
      .catch(() => {
        setQuestionTopics([]);
        setQuestionLanguages([]);
        setDifficultyLevels([]);
      });
  }, []);

  useEffect(() => {
    fetch("/api/question-sub-categories")
      .then(async (response) => {
        const data = await response.json() as QuestionSubCategory[] & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load question sub-categories");
        setQuestionSubCategories(data.filter((item) => item.status));
      })
      .catch(() => setQuestionSubCategories([]))
      .finally(() => setLoadingQuestionSubCategories(false));
  }, []);

  useEffect(() => {
    fetch("/api/question-categories")
      .then(async (response) => {
        const data = await response.json() as QuestionCategory[] & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load question categories");
        setQuestionCategories(data.filter((item) => item.status));
      })
      .catch(() => setQuestionCategories([]))
      .finally(() => setLoadingQuestionCategories(false));
  }, []);

  return (
    <div className="form-overlay" role="presentation">
      <section className="manual-form" role="dialog" aria-modal="true" aria-labelledby="manual-form-title">
        <div className="manual-form-header">
          <div>
            <p className="section-kicker">Create assessment</p>
            <h1 id="manual-form-title">{initialAssessment ? "Edit assessment" : "Add manually"}</h1>
          </div>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close form">×</button>
        </div>

        <form onSubmit={saveAssessment}>
          <div className="form-field full-width">
            <label htmlFor="examination">Examination</label>
            <select id="examination" name="examination" value={selectedExamination} onChange={(event) => setSelectedExamination(event.target.value)} disabled={loadingExaminations} required>
              <option value="" disabled>{loadingExaminations ? "Loading examinations..." : "Choose"}</option>
              {examinations.map((examination) => (
                <option key={examination.id} value={examination.assessment_name}>{examination.assessment_name}</option>
              ))}
            </select>
          </div>

          <div className="form-field full-width">
            <label htmlFor="assessment-name">Name</label>
            <input id="assessment-name" name="name" placeholder="Name" defaultValue={initialAssessment?.title ?? ""} required />
          </div>

          <div className="form-row date-row">
            <div className="form-field date-field">
              <label htmlFor="start-date">Assessment Date</label>
              <div className="date-range-inputs">
                <input id="start-date" name="start_date" type="datetime-local" aria-label="Assessment start date" defaultValue={dateTimeLocalValue(initialAssessment?.start_date)} />
                <span aria-hidden="true">to</span>
                <input id="end-date" name="end_date" type="datetime-local" aria-label="Assessment end date" defaultValue={dateTimeLocalValue(initialAssessment?.end_date)} />
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="total-time">Total Time (in Mins)</label>
              <input id="total-time" name="total_time" type="number" min="1" placeholder="Total Time (in Mins)" defaultValue={initialAssessment?.total_time ?? ""} />
            </div>
            <div className="form-field">
              <label htmlFor="last-login">Last Login Time (in Mins)</label>
              <input id="last-login" name="last_login" type="number" min="1" placeholder="Last Login Time (in Mins)" defaultValue={initialAssessment?.last_login ?? ""} />
              <small>Leave blank to allow anytime login.</small>
            </div>
          </div>

          <div className="form-row filter-row">
            {[
              ["Question Category", "question-category"],
              ["Sub-Category", "sub-category"],
              ["Topic", "topic"],
              ["Question Language", "question-language"],
            ].map(([label, id]) => (
              <div className="form-field" key={id}>
                <label htmlFor={id}>{label}</label>
                <select
                  id={id}
                  name={id === "question-category" ? "question_category" : id === "sub-category" ? "sub_category" : id === "question-language" ? "question_language" : id}
                  value={id === "question-category" ? selectedQuestionCategory : id === "sub-category" ? selectedSubCategory : id === "topic" ? selectedTopic : selectedQuestionLanguage}
                  onChange={(event) => {
                    if (id === "question-category") setSelectedQuestionCategory(event.target.value);
                    if (id === "sub-category") setSelectedSubCategory(event.target.value);
                    if (id === "topic") setSelectedTopic(event.target.value);
                    if (id === "question-language") setSelectedQuestionLanguage(event.target.value);
                  }}
                  disabled={(id === "question-category" && loadingQuestionCategories) || (id === "sub-category" && loadingQuestionSubCategories)}
                  required={id === "question-category" || id === "sub-category"}
                >
                  <option value="" disabled>{id === "question-category" && loadingQuestionCategories ? "Loading categories..." : id === "sub-category" && loadingQuestionSubCategories ? "Loading sub-categories..." : "Choose"}</option>
                  {id === "question-category" ? questionCategories.map((category) => (
                    <option key={category.id} value={category.q_category}>{category.q_category}</option>
                  )) : id === "sub-category" ? questionSubCategories.map((subCategory) => (
                    <option key={subCategory.id} value={subCategory.q_s_category}>{subCategory.q_s_category}</option>
                  )) : id === "topic" ? questionTopics.map((topic) => (
                    <option key={topic.id} value={topic.topic}>{topic.topic}</option>
                  )) : id === "question-language" ? questionLanguages.map((language) => (
                    <option key={language.id} value={language.q_language}>{language.q_language}</option>
                  )) : (
                    <>
                      <option>Multiple Choice</option>
                      <option>True / False</option>
                    </>
                  )}
                </select>
              </div>
            ))}
          </div>

          <div className="sections-heading">
            <h2>Sections</h2>
            <button className="add-section-button" type="button" onClick={() => setSectionIds([...sectionIds, Math.max(...sectionIds) + 1])} aria-label="Add section">+</button>
          </div>

          <div className="section-list">
            {sectionIds.map((sectionId, index) => (
              <div className="section-block" key={sectionId}>
                <div className="section-block-heading">
                  <span>Section {index + 1}</span>
                  {index > 0 && (
                    <button
                      className="remove-section-button"
                      type="button"
                      onClick={() => setSectionIds(sectionIds.filter((id) => id !== sectionId))}
                      aria-label={`Remove section ${index + 1}`}
                    >
                      × Remove
                    </button>
                  )}
                </div>
                <div className="section-fields">
                  <input data-section-field="name" aria-label={`Section ${index + 1} name`} placeholder="Name" defaultValue={initialAssessment?.sections?.[index]?.name ?? ""} />
                  <select data-section-field="question-type" aria-label={`Section ${index + 1} question type`} defaultValue={initialAssessment?.sections?.[index]?.question_type ?? ""}>
                    <option value="" disabled>Question Type</option>
                    <option>Objective</option>
                    <option>Subjective</option>
                  </select>
                  <input data-section-field="question-count" type="number" min="1" aria-label={`Section ${index + 1} question count`} placeholder="Question Count" defaultValue={initialAssessment?.sections?.[index]?.question_count ?? ""} />
                  <input data-section-field="correct-mark" type="number" min="0" aria-label={`Section ${index + 1} correct mark`} placeholder="Correct Mark" defaultValue={initialAssessment?.sections?.[index]?.correct_mark ?? ""} />
                  <input data-section-field="wrong-mark" type="number" max="0" step="any" aria-label={`Section ${index + 1} wrong mark`} placeholder="Wrong Mark (0 or negative)" defaultValue={initialAssessment?.sections?.[index]?.wrong_mark ?? ""} />
                </div>
                <p className="difficulty-label">% of Questions from Difficulty Levels <span>(total should be 100)</span></p>
                <div className="difficulty-fields">
                  {difficultyLevels.map((level) => (
                    <input
                      key={level.id}
                      type="number"
                      min="0"
                      max="100"
                      data-difficulty-field={level.Difficulty_level}
                      placeholder={`Level: ${level.Difficulty_level}`}
                      aria-label={`Section ${index + 1}, level ${level.Difficulty_level} percentage`}
                      defaultValue={initialAssessment?.sections?.[index]?.difficulty_percentages.find((item) => item.level === level.Difficulty_level)?.percentage ?? ""}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="form-actions">
            <button className="form-cancel-button" type="button" onClick={onClose}>Close</button>
            <button className="form-save-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
      </section>
    </div>
  );
}

type AssessmentUploadRecord = {
  id: number;
  candidate_count?: number;
  examination: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  sections: AssessmentSection[];
};

function BulkUploadForm({ onClose, onUploaded }: { onClose: () => void; onUploaded: (assessments: AssessmentUploadRecord[]) => void }) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const downloadTemplate = () => {
    const headers = ["Examination", "Name", "Start Date", "End Date", "Total Time", "Last Login Time", "Question Category", "Sub-Category", "Topic", "Question Language", "Sections JSON"];
    const exampleSections = JSON.stringify([{ name: "Section 1", question_type: "Objective", question_count: "10", correct_mark: "1", wrong_mark: "0", difficulty_percentages: [] }]);
    const csv = Papa.unparse([headers, ["", "", "", "", "", "", "", "", "", "", exampleSections]]);
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "assessment-upload-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const readFile = async (file: File) => {
    setFileName(file.name);
    setRows([]);
    setError("");
    setSuccess("");
    setParsing(true);
    try {
      let headers: string[];
      let parsedRows: Record<string, unknown>[];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const parsed = Papa.parse<Record<string, string>>(await file.text(), {
          header: true,
          skipEmptyLines: "greedy",
          transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
        });
        if (parsed.errors.length > 0) throw new Error(parsed.errors[0].message);
        headers = parsed.meta.fields ?? [];
        parsedRows = parsed.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
      } else if (file.name.toLowerCase().endsWith(".xlsx")) {
        const workbookSheets = await readXlsxFile(file);
        const sheetRows = workbookSheets[0]?.data;
        if (!sheetRows) throw new Error("The selected file has no worksheet.");
        const [headerRow = [], ...dataRows] = sheetRows;
        const toCellString = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").trim();
        headers = headerRow.map(toCellString).filter(Boolean);
        parsedRows = dataRows
          .filter((row) => row.some((value) => String(value ?? "").trim()))
          .map((row) => Object.fromEntries(headers.map((header, index) => [header, toCellString(row[index])])));
      } else {
        throw new Error("Choose a CSV or XLSX file. Legacy XLS files are not supported.");
      }

      const expectedHeaders = ["Examination", "Name", "Start Date", "End Date", "Total Time", "Last Login Time", "Question Category", "Sub-Category", "Topic", "Question Language", "Sections JSON"];
      const missingHeaders = expectedHeaders.filter((header) => !headers.includes(header));
      if (missingHeaders.length > 0) throw new Error(`Missing columns: ${missingHeaders.join(", ")}. Download the template and keep its column names.`);
      if (parsedRows.length === 0) throw new Error("The selected file contains no assessment rows.");
      if (parsedRows.length > 500) throw new Error("Upload a maximum of 500 assessments at a time.");
      setRows(parsedRows);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Unable to read this file.");
    } finally {
      setParsing(false);
    }
  };

  const uploadAssessments = async () => {
    if (rows.length === 0) return;
    setUploading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: rows.map((row) => ({
            examination: String(row.Examination ?? "").trim(),
            name: String(row.Name ?? "").trim(),
            start_date: String(row["Start Date"] ?? "").trim(),
            end_date: String(row["End Date"] ?? "").trim(),
            total_time: String(row["Total Time"] ?? "").trim(),
            last_login: String(row["Last Login Time"] ?? "").trim(),
            question_category: String(row["Question Category"] ?? "").trim(),
            sub_category: String(row["Sub-Category"] ?? "").trim(),
            topic: String(row.Topic ?? "").trim(),
            question_language: String(row["Question Language"] ?? "").trim(),
            sections: String(row["Sections JSON"] ?? "").trim(),
          })),
        }),
      });
      const result = await response.json() as { imported?: number; assessments?: AssessmentUploadRecord[]; error?: string; row_errors?: string[] };
      if (!response.ok) {
        const rowErrors = result.row_errors?.slice(0, 5).join(" ");
        const remainingErrors = result.row_errors && result.row_errors.length > 5 ? `${result.row_errors.length - 5} more row errors.` : "";
        throw new Error([result.error ?? "Unable to import assessments", rowErrors, remainingErrors].filter(Boolean).join(" "));
      }
      setSuccess(`${result.imported ?? rows.length} assessments uploaded successfully.`);
      onUploaded(result.assessments ?? []);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload assessments.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation">
      <section className="bulk-upload-form" role="dialog" aria-modal="true" aria-labelledby="bulk-upload-title">
        <div className="bulk-upload-header">
          <h1 id="bulk-upload-title">Upload Assessments</h1>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close upload form">×</button>
        </div>

        <div className="bulk-upload-content">
          <button className="download-sample-link" type="button" onClick={downloadTemplate}>Download Template</button>
          <div className="bulk-file-field">
            <label htmlFor="assessment-file">File</label>
            <div className="file-picker">
              <label className="choose-file-button" htmlFor="assessment-file">Choose File</label>
              <span>{fileName || "No file chosen"}</span>
              <input
                id="assessment-file"
                type="file"
                accept=".csv,.xlsx"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readFile(file);
                }}
              />
            </div>
          </div>
          {parsing && <p role="status">Reading spreadsheet...</p>}
          {rows.length > 0 && !parsing && <p role="status">{rows.length} assessment rows ready to upload.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {success && <p className="login-settings-success" role="status">{success}</p>}
        </div>

        <div className="bulk-upload-actions">
          <button className="form-cancel-button" type="button" onClick={onClose}>Close</button>
          <button className="form-save-button" type="button" onClick={uploadAssessments} disabled={!fileName || rows.length === 0 || parsing || uploading}>{uploading ? "Uploading..." : "Upload"}</button>
        </div>
      </section>
    </div>
  );
}

function CandidateUploadForm({ onClose, onUploaded, candidateInfo }: { onClose: () => void; onUploaded: () => void; candidateInfo: CandidateInfoItem[] }) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const downloadTemplate = () => {
    const candidateFields = candidateInfo.filter((item) => !isCandidateIdFieldName(item.name));
    const headers = ["Category", "Sub-Category", ...candidateFields.map((item) => item.name)];
    const csv = Papa.unparse([headers, headers.map(() => "")]);
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "candidate-information-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const readFile = async (file: File) => {
    setFileName(file.name);
    setRows([]);
    setError("");
    setSuccess("");
    setParsing(true);
    try {
      let headers: string[];
      let parsedRows: Record<string, unknown>[];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const parsed = Papa.parse<Record<string, string>>(await file.text(), {
          header: true,
          skipEmptyLines: "greedy",
            transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
        });
        if (parsed.errors.length > 0) throw new Error(parsed.errors[0].message);
        headers = parsed.meta.fields ?? [];
        parsedRows = parsed.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
      } else if (file.name.toLowerCase().endsWith(".xlsx")) {
        const workbookSheets = await readXlsxFile(file);
        const sheetRows = workbookSheets[0]?.data;
        if (!sheetRows) throw new Error("The selected file has no worksheet.");
        const [headerRow = [], ...dataRows] = sheetRows;
        const toCellString = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").trim();
        headers = headerRow.map(toCellString).filter(Boolean);
        parsedRows = dataRows
          .filter((row) => row.some((value) => String(value ?? "").trim()))
          .map((row) => Object.fromEntries(headers.map((header, index) => [header, toCellString(row[index])])));
      } else {
        throw new Error("Choose a CSV or XLSX file. Legacy XLS files are not supported.");
      }

      const expectedHeaders = ["Category", "Sub-Category", ...candidateInfo.filter((item) => !isCandidateIdFieldName(item.name)).map((item) => item.name)];
      const missingHeaders = expectedHeaders.filter((header) => !headers.includes(header));
      if (missingHeaders.length > 0) {
        throw new Error(`Missing columns: ${missingHeaders.join(", ")}. Download the template and keep its column names.`);
      }
      if (parsedRows.length === 0) throw new Error("The selected file contains no candidate rows.");
      if (parsedRows.length > 1000) throw new Error("Upload a maximum of 1000 candidates at a time.");
      setRows(parsedRows);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Unable to read this file.");
    } finally {
      setParsing(false);
    }
  };

  const uploadCandidates = async () => {
    if (rows.length === 0) return;
    setUploading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: rows.map((row) => ({
            category: String(row.Category ?? "").trim(),
            sub_category: String(row["Sub-Category"] ?? "").trim(),
            fields: Object.fromEntries(candidateInfo
              .filter((item) => !isCandidateIdFieldName(item.name))
              .map((item) => [item.name, String(row[item.name] ?? "").trim()])),
          })),
        }),
      });
      const result = await response.json() as { imported?: number; error?: string; row_errors?: string[] };
      if (!response.ok) {
        const rowErrors = result.row_errors?.slice(0, 5).join(" ");
        throw new Error([result.error ?? "Unable to import candidates", rowErrors, result.row_errors && result.row_errors.length > 5 ? `${result.row_errors.length - 5} more row errors.` : ""].filter(Boolean).join(" "));
      }
      setSuccess(`${result.imported ?? rows.length} candidates uploaded successfully.`);
      onUploaded();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload candidates.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation">
      <section className="bulk-upload-form" role="dialog" aria-modal="true" aria-labelledby="candidate-upload-title">
        <div className="bulk-upload-header">
          <h1 id="candidate-upload-title">Upload Candidates</h1>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close candidate upload form">×</button>
        </div>
        <div className="bulk-upload-content">
          <button className="download-sample-link" type="button" onClick={downloadTemplate}>Download Template</button>
          <div className="bulk-file-field">
            <label htmlFor="candidate-file">File</label>
            <div className="file-picker">
              <label className="choose-file-button" htmlFor="candidate-file">Choose File</label>
              <span>{fileName || "No file chosen"}</span>
              <input
                id="candidate-file"
                type="file"
                accept=".csv,.xlsx"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readFile(file);
                }}
              />
            </div>
          </div>
          {parsing && <p role="status">Reading spreadsheet...</p>}
          {rows.length > 0 && !parsing && <p role="status">{rows.length} candidate rows ready to upload.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {success && <p className="login-settings-success" role="status">{success}</p>}
        </div>
        <div className="bulk-upload-actions">
          <button className="form-cancel-button" type="button" onClick={onClose}>Close</button>
          <button className="form-save-button" type="button" onClick={uploadCandidates} disabled={!fileName || rows.length === 0 || parsing || uploading}>{uploading ? "Uploading..." : "Upload"}</button>
        </div>
      </section>
    </div>
  );
}

function AddCandidateForm({ onClose, currentRole }: { onClose: () => void; currentRole?: any }) {
  const [candidateInfo, setCandidateInfo] = useState<CandidateInfoItem[]>([]);
  const [categories, setCategories] = useState<CandidateCategory[]>([]);
  const [subCategories, setSubCategories] = useState<CandidateSubCategory[]>([]);
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [values, setValues] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showAddExtraInfo, setShowAddExtraInfo] = useState(false);
  const canCreateCandidateInfo = hasRolePermission(currentRole, "Settings:Candidates:Settings", "create");

  useEffect(() => {
    fetch("/api/candidate-info")
      .then(async (response) => {
        const data = await response.json() as CandidateInfoItem[] & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load candidate information");
        setCandidateInfo(data.filter((item) => item.status));
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load candidate information"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    Promise.all([fetch("/api/candidate-categories"), fetch("/api/candidate-sub-categories")])
      .then(async ([categoryResponse, subCategoryResponse]) => {
        const categoryData = await categoryResponse.json() as CandidateCategory[] & { error?: string };
        const subCategoryData = await subCategoryResponse.json() as CandidateSubCategory[] & { error?: string };
        if (!categoryResponse.ok) throw new Error(categoryData.error ?? "Unable to load candidate categories");
        if (!subCategoryResponse.ok) throw new Error(subCategoryData.error ?? "Unable to load candidate sub-categories");
        setCategories(categoryData.filter((item) => item.status));
        setSubCategories(subCategoryData.filter((item) => item.status));
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load candidate categories"));
  }, []);

  const getDropdownOptions = (options: unknown) => {
    if (Array.isArray(options)) {
      return options.filter((option): option is string => typeof option === "string");
    }
    if (typeof options === "string") {
      return options.split(",").map((option) => option.trim()).filter(Boolean);
    }
    return [];
  };

  const updateValue = (id: number, value: string) => {
    setValues((current) => ({ ...current, [id]: value }));
  };

  const saveCandidate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          sub_category: subCategory,
          fields: Object.fromEntries(candidateInfo
            .filter((item) => !isCandidateIdFieldName(item.name))
            .map((item) => [item.name, values[item.id] ?? ""])),
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to save candidate");
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save candidate");
    } finally {
      setSaving(false);
    }
  };

  const availableSubCategories = subCategories.filter((item) => item.category === category);

  return (
    <div className="form-overlay" role="presentation">
      <section className="candidate-form" role="dialog" aria-modal="true" aria-labelledby="add-candidate-title">
        <div className="bulk-upload-header">
          <h1 id="add-candidate-title">Add Candidate</h1>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close add candidate form">×</button>
        </div>
        <form className="candidate-form-fields" onSubmit={saveCandidate}>
          <div className="form-field">
            <label htmlFor="candidate-category">Category</label>
            <select
              id="candidate-category"
              value={category}
              onChange={(event) => { setCategory(event.target.value); setSubCategory(""); }}
              disabled={loading}
              required
            >
              <option value="" disabled>{loading ? "Loading categories..." : "Choose"}</option>
              {categories.map((item) => <option key={item.id} value={item.candidate_category}>{item.candidate_category}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="candidate-subcategory">Sub-Category</label>
            <select
              id="candidate-subcategory"
              value={subCategory}
              onChange={(event) => setSubCategory(event.target.value)}
              disabled={loading || !category}
              required
            >
              <option value="" disabled>{loading ? "Loading sub-categories..." : "Choose"}</option>
              {availableSubCategories.map((item) => <option key={item.id} value={item.candidate_sub_category}>{item.candidate_sub_category}</option>)}
            </select>
          </div>
          <p className="candidate-id-generated-note">Candidate ID will be generated automatically as a unique 6-digit number.</p>
          {loading && <p>Loading candidate fields...</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {!loading && candidateInfo.filter((item) => !isCandidateIdFieldName(item.name)).map((item) => {
            const fieldId = `candidate-field-${item.id}`;
            const value = values[item.id] ?? "";
            const inputType = item.column_type === "Email" ? "email" : item.column_type === "Date" ? "date" : item.column_type === "Number" ? "number" : "text";

            return (
              <div className="form-field" key={item.id}>
                <label htmlFor={fieldId}>{item.name}{item.is_required ? " *" : ""}</label>
                {item.column_type === "Dropdown" ? (
                  <select
                    id={fieldId}
                    value={value}
                    onChange={(event) => updateValue(item.id, event.target.value)}
                    required={item.is_required}
                  >
                    <option value="" disabled>Choose</option>
                    {getDropdownOptions(item.options).map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <input
                    id={fieldId}
                    type={inputType}
                    value={value}
                    min={item.column_type === "Number" && item.min_value != null ? String(item.min_value) : undefined}
                    max={item.column_type === "Number" && item.max_value != null ? String(item.max_value) : undefined}
                    onChange={(event) => updateValue(item.id, event.target.value)}
                    required={item.is_required}
                  />
                )}
              </div>
            );
          })}
          <div className="candidate-form-actions">
            <button className="form-cancel-button" type="button" onClick={onClose}>Close</button>
            {canCreateCandidateInfo && <button className="form-save-button" type="button" onClick={() => setShowAddExtraInfo(true)}>Add Extra Info</button>}
            <button className="form-save-button" type="submit" disabled={loading || saving || Boolean(error)}>{saving ? "Saving..." : "Save"}</button>
          </div>
        </form>
      </section>
      {showAddExtraInfo && (
        <CandidateInfoForm
          onClose={() => setShowAddExtraInfo(false)}
          onSaved={(item) => {
            setCandidateInfo((current) => [...current, item]);
            setShowAddExtraInfo(false);
          }}
        />
      )}
    </div>
  );
}

function CandidatesPanel({ currentRole }: { currentRole?: any }) {
  const [pageSize, setPageSize] = useState("25");
  const [search, setSearch] = useState("");
  const [showCandidateUpload, setShowCandidateUpload] = useState(false);
  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [candidateInfo, setCandidateInfo] = useState<CandidateInfoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const canCreate = hasRolePermission(currentRole, "Candidates", "create");
  const additionalCandidateInfo = candidateInfo.filter((info) =>
    !isCandidateIdFieldName(info.name) && !isDateOfBirthFieldName(info.name)
  );

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/candidates").then((res) => res.json()),
      fetch("/api/candidate-info").then((res) => res.json()),
    ])
      .then(([candidatesData, infoData]) => {
        if (!candidatesData.error) setCandidates(candidatesData);
        if (!infoData.error) setCandidateInfo(infoData.filter((i: CandidateInfoItem) => i.status));
      })
      .catch((error) => console.error("Error fetching data:", error))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <section className="candidates-section" id="candidates">
      <div className="candidate-section-header">
        <h1>Candidate Information</h1>
      </div>
      <div className="candidates-panel">
        <div className="candidates-actions">
          {canCreate && <button className="candidate-action-button" type="button" onClick={() => setShowCandidateUpload(true)} disabled={loading}>
            <span aria-hidden="true">↥</span> Upload
          </button>}
          {canCreate && <button className="candidate-action-button" type="button" onClick={() => setShowAddCandidate(true)}>
            <span aria-hidden="true">+</span> Add new
          </button>}
        </div>

        <div className="candidate-table-toolbar">
          <label className="entries-control" htmlFor="page-size">
            Show
            <select id="page-size" value={pageSize} onChange={(event) => setPageSize(event.target.value)}>
              <option>10</option>
              <option>25</option>
              <option>50</option>
            </select>
            entries
          </label>
          <label className="search-control" htmlFor="candidate-search">
            Search:
            <input id="candidate-search" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
        </div>

        <div className="candidate-table-wrapper">
          <table className="candidate-table">
            <thead>
              <tr>
                <th>Candidate ID</th>
                <th>Date of Birth</th>
                {additionalCandidateInfo.map((info) => (
                  <th key={info.id}>{info.name}</th>
                ))}
                <th>Category</th>
                <th>Sub-Category</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={additionalCandidateInfo.length + 5}>Loading candidates...</td>
                </tr>
              ) : candidates.length === 0 ? (
                <tr>
                  <td colSpan={additionalCandidateInfo.length + 5}>No data available in table</td>
                </tr>
              ) : (
                candidates.map((c) => (
                  <tr key={c.id}>
                    <td>{getCandidateFieldValue(c.candidate_data, "Candidate ID") || "-"}</td>
                    <td>{getCandidateFieldValue(c.candidate_data, "Date of Birth") || "Not provided"}</td>
                    {additionalCandidateInfo.map((info) => (
                      <td key={info.id}>{c.candidate_data?.fields?.[info.name] || "-"}</td>
                    ))}
                    <td>{c.candidate_data?.category || "-"}</td>
                    <td>{c.candidate_data?.sub_category || "-"}</td>
                    <td>{c.status ? "Active" : "Inactive"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="candidate-table-footer">
          <span>Showing {candidates.length > 0 ? 1 : 0} to {candidates.length} of {candidates.length} entries</span>
          <div>
            <button type="button" disabled>Previous</button>
            <button type="button" disabled>Next</button>
          </div>
        </div>
      </div>
      {showCandidateUpload && <CandidateUploadForm
        candidateInfo={candidateInfo.filter((item) => item.status)}
        onClose={() => setShowCandidateUpload(false)}
        onUploaded={fetchData}
      />}
      {showAddCandidate && (
        <AddCandidateForm
          currentRole={currentRole}
          onClose={() => {
            setShowAddCandidate(false);
            fetchData();
          }}
        />
      )}
    </section>
  );
}

type QuestionCategory = {
  id: number;
  q_category: string;
  status: boolean;
  created_at: string;
};

type QuestionSubCategory = {
  id: number;
  q_s_category: string;
  category: string;
  status: boolean;
  created_at: string;
};

type QuestionTopic = {
  id: number;
  topic: string;
  q_s_category: string;
  status: boolean;
  created_at: string;
};

type QuestionRecord = {
  id: number;
  question_type: string;
  question: string;
  category: string | null;
  sub_category: string | null;
  topic: string | null;
  difficulty_level: string | null;
  language: string | null;
  details: Record<string, unknown>;
  status: boolean;
  created_at: string;
};

type DifficultyLevel = {
  id: number;
  Difficulty_level: string;
  status: boolean;
  created_at: string;
};

type LanguageItem = {
  id: number;
  q_language: string;
  status: boolean;
  created_at: string;
};

type AssessmentType = {
  id: number;
  assessment_name: string;
  status: boolean;
  created_at: string;
};

type CandidateCategory = {
  id: number;
  candidate_category: string;
  status: boolean;
  created_at: string;
};

type CandidateSubCategory = {
  id: number;
  candidate_sub_category: string;
  category: string;
  status: boolean;
  created_at: string;
};

function AddQuestionCategoryForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (category: QuestionCategory) => void;
}) {
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const saveCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/question-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q_category: category }),
      });
      const data = await response.json() as QuestionCategory & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to save category");
      }

      onSaved(data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save category");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation">
      <section className="category-form" role="dialog" aria-modal="true" aria-labelledby="add-category-title">
        <div className="bulk-upload-header">
          <h1 id="add-category-title">Add Question Category</h1>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close category form">×</button>
        </div>
        <form onSubmit={saveCategory}>
          <div className="form-field">
            <label htmlFor="question-category-name">Category</label>
            <input
              id="question-category-name"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="Category"
              autoFocus
              required
            />
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="form-cancel-button" type="button" onClick={onClose}>Close</button>
            <button className="form-save-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function EditQuestionCategoryForm({
  category: initialCategory,
  onClose,
  onSaved,
}: {
  category: QuestionCategory;
  onClose: () => void;
  onSaved: (category: QuestionCategory) => void;
}) {
  const [category, setCategory] = useState(initialCategory.q_category);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const updateCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/question-categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: initialCategory.id, q_category: category }),
      });
      const data = await response.json() as QuestionCategory & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to update category");
      }

      onSaved(data);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update category");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation">
      <section className="category-form" role="dialog" aria-modal="true" aria-labelledby="edit-category-title">
        <div className="bulk-upload-header">
          <h1 id="edit-category-title">Edit Question Category</h1>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close category form">×</button>
        </div>
        <form onSubmit={updateCategory}>
          <div className="form-field">
            <label htmlFor="edit-question-category-name">Category</label>
            <input id="edit-question-category-name" value={category} onChange={(event) => setCategory(event.target.value)} autoFocus required />
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="form-cancel-button" type="button" onClick={onClose}>Close</button>
            <button className="form-save-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function QuestionCategoriesPanel({ currentRole }: { currentRole?: any }) {
  const [categories, setCategories] = useState<QuestionCategory[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<QuestionCategory | null>(null);
  const canCreate = hasRolePermission(currentRole, "Settings:Questions:Categories", "create");
  const canEdit = hasRolePermission(currentRole, "Settings:Questions:Categories", "edit");
  const canDelete = hasRolePermission(currentRole, "Settings:Questions:Categories", "delete");
  const canStatus = hasRolePermission(currentRole, "Settings:Questions:Categories", "status");

  const updateCategoryStatus = async (category: QuestionCategory) => {
    const response = await fetch("/api/question-categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: category.id, status: canStatus ? !category.status : category.status }),
    });

    if (!response.ok) {
      throw new Error("Unable to update category status");
    }

    const updated = await response.json() as QuestionCategory;
    setCategories((current) => current.map((item) => item.id === updated.id ? updated : item));
  };

  const deleteCategory = async (category: QuestionCategory) => {
    const response = await fetch("/api/question-categories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: category.id }),
    });

    if (!response.ok) {
      throw new Error("Unable to delete category");
    }

    setCategories((current) => current.filter((item) => item.id !== category.id));
  };

  useEffect(() => {
    fetch("/api/question-categories")
      .then(async (response) => {
        const data = await response.json() as QuestionCategory[] & { error?: string };
        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load categories");
        }
        setCategories(data);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load categories"))
      .finally(() => setLoading(false));
  }, []);

  const filteredCategories = categories.filter((category) =>
    category.q_category.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <section className="categories-section" id="question-categories">
      <div className="categories-header">
        <div>
          <p className="section-kicker">Question settings</p>
          <h1>Categories</h1>
        </div>
        {canCreate && (
          <button className="candidate-action-button" type="button" onClick={() => setShowAddForm(true)}>
            <span aria-hidden="true">+</span> Add new
          </button>
        )}
      </div>

      <div className="categories-panel">
        <div className="categories-toolbar">
          <span>{loading ? "Loading categories..." : `Showing ${filteredCategories.length} of ${categories.length} categories`}</span>
          <label className="search-control" htmlFor="category-search">
            Search:
            <input id="category-search" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="candidate-table-wrapper">
          <table className="candidate-table categories-table">
            <thead><tr><th>Category</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {!loading && filteredCategories.length === 0 ? (
                <tr><td colSpan={3}>No categories available</td></tr>
              ) : filteredCategories.map((category) => (
                <tr key={category.id}>
                  <td>{category.q_category}</td>
                  <td>
                    {canStatus ? <button
                      className={`category-toggle${category.status ? " is-on" : ""}`}
                      type="button"
                      aria-pressed={category.status}
                      onClick={() => updateCategoryStatus(category).catch((toggleError) => setError(toggleError instanceof Error ? toggleError.message : "Unable to update status"))}
                    >
                      <span />
                      {category.status ? "Active" : "Inactive"}
                    </button> : (category.status ? "Active" : "Inactive")}
                  </td>
                  <td className="category-action-cell">
                    <div className="category-actions">
                      {canEdit && <button className="category-edit-button" type="button" onClick={() => setEditingCategory(category)}>Edit</button>}
                      {canDelete && <button className="category-delete-button" type="button" onClick={() => deleteCategory(category).catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : "Unable to delete category"))}>Delete</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showAddForm && (
        <AddQuestionCategoryForm
          onClose={() => setShowAddForm(false)}
          onSaved={(category) => {
            setCategories((current) => [category, ...current]);
            setShowAddForm(false);
          }}
        />
      )}
      {editingCategory && (
        <EditQuestionCategoryForm
          category={editingCategory}
          onClose={() => setEditingCategory(null)}
          onSaved={(updatedCategory) => {
            setCategories((current) => current.map((item) => item.id === updatedCategory.id ? updatedCategory : item));
            setEditingCategory(null);
          }}
        />
      )}
    </section>
  );
}

function AddQuestionSubCategoryForm({ onClose, onSaved }: { onClose: () => void; onSaved: (item: QuestionSubCategory) => void }) {
  const [subCategory, setSubCategory] = useState("");
  const [category, setCategory] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<QuestionCategory[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/question-categories")
      .then(async (response) => {
        const data = await response.json() as QuestionCategory[] & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load categories");
        setCategoryOptions(data.filter((item) => item.status));
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load categories"))
      .finally(() => setLoadingCategories(false));
  }, []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/question-sub-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q_s_category: subCategory, category }),
      });
      const data = await response.json() as QuestionSubCategory & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to save sub-category");
      onSaved(data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save sub-category");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation">
      <section className="category-form" role="dialog" aria-modal="true" aria-labelledby="add-sub-category-title">
        <div className="bulk-upload-header">
          <h1 id="add-sub-category-title">Add Questions Sub Category</h1>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close sub-category form">×</button>
        </div>
        <form onSubmit={save}>
          <div className="form-field">
            <label htmlFor="question-sub-category-name">Sub Category</label>
            <input id="question-sub-category-name" value={subCategory} onChange={(event) => setSubCategory(event.target.value)} placeholder="Sub Category" autoFocus required />
          </div>
          <div className="form-field">
            <label htmlFor="question-sub-category-parent">Category</label>
            <select id="question-sub-category-parent" value={category} onChange={(event) => setCategory(event.target.value)} required disabled={loadingCategories}>
              <option value="" disabled>{loadingCategories ? "Loading categories..." : "Choose category"}</option>
              {categoryOptions.map((item) => <option key={item.id} value={item.q_category}>{item.q_category}</option>)}
            </select>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="form-cancel-button" type="button" onClick={onClose}>Close</button>
            <button className="form-save-button" type="submit" disabled={saving || loadingCategories || !category}>{saving ? "Saving..." : "Save"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function EditQuestionSubCategoryForm({
  item: initialItem,
  onClose,
  onSaved,
}: {
  item: QuestionSubCategory;
  onClose: () => void;
  onSaved: (item: QuestionSubCategory) => void;
}) {
  const [subCategory, setSubCategory] = useState(initialItem.q_s_category);
  const [category, setCategory] = useState(initialItem.category);
  const [categoryOptions, setCategoryOptions] = useState<QuestionCategory[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/question-categories")
      .then(async (response) => {
        const data = await response.json() as QuestionCategory[] & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load categories");
        setCategoryOptions(data.filter((item) => item.status));
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load categories"))
      .finally(() => setLoadingCategories(false));
  }, []);

  const update = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/question-sub-categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: initialItem.id, q_s_category: subCategory, category }),
      });
      const data = await response.json() as QuestionSubCategory & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to update sub-category");
      onSaved(data);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update sub-category");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation">
      <section className="category-form" role="dialog" aria-modal="true" aria-labelledby="edit-sub-category-title">
        <div className="bulk-upload-header">
          <h1 id="edit-sub-category-title">Edit Questions Sub Category</h1>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close sub-category form">×</button>
        </div>
        <form onSubmit={update}>
          <div className="form-field">
            <label htmlFor="edit-question-sub-category-name">Sub Category</label>
            <input id="edit-question-sub-category-name" value={subCategory} onChange={(event) => setSubCategory(event.target.value)} autoFocus required />
          </div>
          <div className="form-field">
            <label htmlFor="edit-question-sub-category-parent">Category</label>
            <select id="edit-question-sub-category-parent" value={category} onChange={(event) => setCategory(event.target.value)} required disabled={loadingCategories}>
              <option value="" disabled>{loadingCategories ? "Loading categories..." : "Choose category"}</option>
              {categoryOptions.map((option) => <option key={option.id} value={option.q_category}>{option.q_category}</option>)}
            </select>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="form-cancel-button" type="button" onClick={onClose}>Close</button>
            <button className="form-save-button" type="submit" disabled={saving || loadingCategories || !category}>{saving ? "Saving..." : "Save"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function QuestionSubCategoriesPanel({ currentRole }: { currentRole?: any }) {
  const [items, setItems] = useState<QuestionSubCategory[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState<QuestionSubCategory | null>(null);
  const canCreate = hasRolePermission(currentRole, "Settings:Questions:Sub-Categories", "create");
  const canEdit = hasRolePermission(currentRole, "Settings:Questions:Sub-Categories", "edit");
  const canDelete = hasRolePermission(currentRole, "Settings:Questions:Sub-Categories", "delete");
  const canStatus = hasRolePermission(currentRole, "Settings:Questions:Sub-Categories", "status");

  const deleteSubCategory = async (item: QuestionSubCategory) => {
    const response = await fetch("/api/question-sub-categories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id }),
    });

    if (!response.ok) {
      const data = await response.json() as { error?: string };
      throw new Error(data.error ?? "Unable to delete sub-category");
    }

    setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
  };

  useEffect(() => {
    fetch("/api/question-sub-categories")
      .then(async (response) => {
        const data = await response.json() as QuestionSubCategory[] & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load sub-categories");
        setItems(data);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load sub-categories"))
      .finally(() => setLoading(false));
  }, []);

  const filteredItems = items.filter((item) => `${item.q_s_category} ${item.category}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <section className="categories-section" id="question-sub-categories">
      <div className="categories-header">
        <div>
          <p className="section-kicker">Question settings</p>
          <h1>Sub Categories</h1>
        </div>
        {canCreate && <button className="candidate-action-button" type="button" onClick={() => setShowAddForm(true)}><span aria-hidden="true">+</span> Add new</button>}
      </div>
      <div className="categories-panel">
        <div className="categories-toolbar">
          <span>{loading ? "Loading sub-categories..." : `Showing ${filteredItems.length} of ${items.length} sub-categories`}</span>
          <label className="search-control" htmlFor="sub-category-search">Search: <input id="sub-category-search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="candidate-table-wrapper">
          <table className="candidate-table categories-table sub-categories-table">
            <thead><tr><th>Sub Category</th><th>Category</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {!loading && filteredItems.length === 0 ? <tr><td colSpan={4}>No sub-categories available</td></tr> : filteredItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.q_s_category}</td>
                  <td>{item.category}</td>
                  <td>{canStatus ? <span className={`category-status${item.status ? " is-active" : ""}`}>{item.status ? "Active" : "Inactive"}</span> : (item.status ? "Active" : "Inactive")}</td>
                  <td><div className="category-actions">{canEdit && <button className="category-edit-button" type="button" onClick={() => setEditingItem(item)}>Edit</button>}{canDelete && <button className="category-delete-button" type="button" onClick={() => deleteSubCategory(item).catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : "Unable to delete sub-category"))}>Delete</button>}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showAddForm && <AddQuestionSubCategoryForm onClose={() => setShowAddForm(false)} onSaved={(item) => { setItems((current) => [item, ...current]); setShowAddForm(false); }} />}
      {editingItem && <EditQuestionSubCategoryForm item={editingItem} onClose={() => setEditingItem(null)} onSaved={(updatedItem) => { setItems((current) => current.map((item) => item.id === updatedItem.id ? updatedItem : item)); setEditingItem(null); }} />}
    </section>
  );
}

function AddQuestionTopicForm({ onClose, onSaved }: { onClose: () => void; onSaved: (item: QuestionTopic) => void }) {
  const [topic, setTopic] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [subCategories, setSubCategories] = useState<QuestionSubCategory[]>([]);
  const [loadingSubCategories, setLoadingSubCategories] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/question-sub-categories")
      .then(async (response) => {
        const data = await response.json() as QuestionSubCategory[] & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load sub-categories");
        setSubCategories(data.filter((item) => item.status));
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load sub-categories"))
      .finally(() => setLoadingSubCategories(false));
  }, []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/question-topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, q_s_category: subCategory }),
      });
      const data = await response.json() as QuestionTopic & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to save topic");
      onSaved(data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save topic");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation">
      <section className="category-form" role="dialog" aria-modal="true" aria-labelledby="add-topic-title">
        <div className="bulk-upload-header">
          <h1 id="add-topic-title">Add Question&apos;s Topic</h1>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close topic form">×</button>
        </div>
        <form onSubmit={save}>
          <div className="form-field">
            <label htmlFor="question-topic-name">Topic</label>
            <input id="question-topic-name" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Topic" autoFocus required />
          </div>
          <div className="form-field">
            <label htmlFor="question-topic-sub-category">Sub Category</label>
            <select id="question-topic-sub-category" value={subCategory} onChange={(event) => setSubCategory(event.target.value)} required disabled={loadingSubCategories}>
              <option value="" disabled>{loadingSubCategories ? "Loading sub-categories..." : "Choose sub-category"}</option>
              {subCategories.map((item) => <option key={item.id} value={item.q_s_category}>{item.q_s_category}</option>)}
            </select>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="form-cancel-button" type="button" onClick={onClose}>Close</button>
            <button className="form-save-button" type="submit" disabled={saving || loadingSubCategories || !subCategory}>{saving ? "Saving..." : "Save"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function EditQuestionTopicForm({ item: initialItem, onClose, onSaved }: { item: QuestionTopic; onClose: () => void; onSaved: (item: QuestionTopic) => void }) {
  const [topic, setTopic] = useState(initialItem.topic);
  const [subCategory, setSubCategory] = useState(initialItem.q_s_category);
  const [subCategories, setSubCategories] = useState<QuestionSubCategory[]>([]);
  const [loadingSubCategories, setLoadingSubCategories] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/question-sub-categories").then(async (response) => {
      const data = await response.json() as QuestionSubCategory[] & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to load sub-categories");
      setSubCategories(data.filter((entry) => entry.status));
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load sub-categories")).finally(() => setLoadingSubCategories(false));
  }, []);

  const update = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/question-topics", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: initialItem.id, topic, q_s_category: subCategory }) });
      const data = await response.json() as QuestionTopic & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to update topic");
      onSaved(data);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update topic");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation">
      <section className="category-form" role="dialog" aria-modal="true" aria-labelledby="edit-topic-title">
        <div className="bulk-upload-header"><h1 id="edit-topic-title">Edit Question&apos;s Topic</h1><button className="form-close-icon" type="button" onClick={onClose} aria-label="Close topic form">×</button></div>
        <form onSubmit={update}>
          <div className="form-field"><label htmlFor="edit-topic-name">Topic</label><input id="edit-topic-name" value={topic} onChange={(event) => setTopic(event.target.value)} autoFocus required /></div>
          <div className="form-field"><label htmlFor="edit-topic-sub-category">Sub Category</label><select id="edit-topic-sub-category" value={subCategory} onChange={(event) => setSubCategory(event.target.value)} disabled={loadingSubCategories} required><option value="" disabled>{loadingSubCategories ? "Loading sub-categories..." : "Choose sub-category"}</option>{subCategories.map((entry) => <option key={entry.id} value={entry.q_s_category}>{entry.q_s_category}</option>)}</select></div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions"><button className="form-cancel-button" type="button" onClick={onClose}>Close</button><button className="form-save-button" type="submit" disabled={saving || loadingSubCategories || !subCategory}>{saving ? "Saving..." : "Save"}</button></div>
        </form>
      </section>
    </div>
  );
}

function QuestionTopicsPanel({ currentRole }: { currentRole?: any }) {
  const [topics, setTopics] = useState<QuestionTopic[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingTopic, setEditingTopic] = useState<QuestionTopic | null>(null);
  const canCreate = hasRolePermission(currentRole, "Settings:Questions:Topics", "create");
  const canEdit = hasRolePermission(currentRole, "Settings:Questions:Topics", "edit");
  const canDelete = hasRolePermission(currentRole, "Settings:Questions:Topics", "delete");
  const canStatus = hasRolePermission(currentRole, "Settings:Questions:Topics", "status");

  const updateTopicStatus = async (item: QuestionTopic) => {
    const response = await fetch("/api/question-topics", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, status: !item.status }) });
    if (!response.ok) throw new Error("Unable to update topic status");
    const updated = await response.json() as QuestionTopic;
    setTopics((current) => current.map((topic) => topic.id === updated.id ? updated : topic));
  };

  const deleteTopic = async (item: QuestionTopic) => {
    const response = await fetch("/api/question-topics", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id }) });
    if (!response.ok) throw new Error("Unable to delete topic");
    setTopics((current) => current.filter((topic) => topic.id !== item.id));
  };

  useEffect(() => {
    fetch("/api/question-topics")
      .then(async (response) => {
        const data = await response.json() as QuestionTopic[] & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load topics");
        setTopics(data);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load topics"))
      .finally(() => setLoading(false));
  }, []);

  const filteredTopics = topics.filter((item) => `${item.topic} ${item.q_s_category}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <section className="categories-section" id="question-topics">
      <div className="categories-header">
        <div><p className="section-kicker">Question settings</p><h1>Topics</h1></div>
        {canCreate && <button className="candidate-action-button" type="button" onClick={() => setShowAddForm(true)}><span aria-hidden="true">+</span> Add new</button>}
      </div>
      <div className="categories-panel">
        <div className="categories-toolbar">
          <span>{loading ? "Loading topics..." : `Showing ${filteredTopics.length} of ${topics.length} topics`}</span>
          <label className="search-control" htmlFor="topic-search">Search: <input id="topic-search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="candidate-table-wrapper">
          <table className="candidate-table categories-table sub-categories-table">
            <thead><tr><th>Topic</th><th>Sub Category</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {!loading && filteredTopics.length === 0 ? <tr><td colSpan={4}>No topics available</td></tr> : filteredTopics.map((item) => (
                <tr key={item.id}>
                  <td>{item.topic}</td><td>{item.q_s_category}</td>
                  <td>
                    {canStatus ? <button className={`category-toggle${item.status ? " is-on" : ""}`} type="button" aria-pressed={item.status} onClick={() => updateTopicStatus(item).catch((statusError) => setError(statusError instanceof Error ? statusError.message : "Unable to update status"))}>
                      <span /> {item.status ? "Active" : "Inactive"}
                    </button> : (item.status ? "Active" : "Inactive")}
                  </td>
                  <td><div className="category-actions">{canEdit && <button className="category-edit-button" type="button" onClick={() => setEditingTopic(item)}>Edit</button>}{canDelete && <button className="category-delete-button" type="button" onClick={() => deleteTopic(item).catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : "Unable to delete topic"))}>Delete</button>}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showAddForm && <AddQuestionTopicForm onClose={() => setShowAddForm(false)} onSaved={(item) => { setTopics((current) => [item, ...current]); setShowAddForm(false); }} />}
      {editingTopic && <EditQuestionTopicForm item={editingTopic} onClose={() => setEditingTopic(null)} onSaved={(updated) => { setTopics((current) => current.map((item) => item.id === updated.id ? updated : item)); setEditingTopic(null); }} />}
    </section>
  );
}

function AddDifficultyLevelForm({ onClose, onSaved }: { onClose: () => void; onSaved: (item: DifficultyLevel) => void }) {
  const [level, setLevel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/difficulty-levels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Difficulty_level: level }) });
      const data = await response.json() as DifficultyLevel & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to save difficulty level");
      onSaved(data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save difficulty level");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation">
      <section className="category-form" role="dialog" aria-modal="true" aria-labelledby="add-difficulty-title">
        <div className="bulk-upload-header"><h1 id="add-difficulty-title">Custom Difficulty Level</h1><button className="form-close-icon" type="button" onClick={onClose} aria-label="Close difficulty level form">×</button></div>
        <form onSubmit={save}>
          <div className="form-field"><label htmlFor="difficulty-level-name">Difficulty Level</label><input id="difficulty-level-name" inputMode="numeric" pattern="[0-9]*" value={level} onChange={(event) => setLevel(event.target.value.replace(/\D/g, ""))} placeholder="Difficulty Level" autoFocus required /></div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions"><button className="form-cancel-button" type="button" onClick={onClose}>Close</button><button className="form-save-button" type="submit" disabled={saving || !level.trim()}>{saving ? "Saving..." : "Save"}</button></div>
        </form>
      </section>
    </div>
  );
}

function EditDifficultyLevelForm({ item: initialItem, onClose, onSaved }: { item: DifficultyLevel; onClose: () => void; onSaved: (item: DifficultyLevel) => void }) {
  const [level, setLevel] = useState(initialItem.Difficulty_level);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/difficulty-levels", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: initialItem.id, Difficulty_level: level }) });
      const data = await response.json() as DifficultyLevel & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to update difficulty level");
      onSaved(data);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update difficulty level");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation"><section className="category-form" role="dialog" aria-modal="true" aria-labelledby="edit-difficulty-title">
      <div className="bulk-upload-header"><h1 id="edit-difficulty-title">Edit Difficulty Level</h1><button className="form-close-icon" type="button" onClick={onClose} aria-label="Close difficulty level form">×</button></div>
      <form onSubmit={update}><div className="form-field"><label htmlFor="edit-difficulty-level-name">Difficulty Level</label><input id="edit-difficulty-level-name" inputMode="numeric" pattern="[0-9]*" value={level} onChange={(event) => setLevel(event.target.value.replace(/\D/g, ""))} autoFocus required /></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="form-cancel-button" type="button" onClick={onClose}>Close</button><button className="form-save-button" type="submit" disabled={saving || !level.trim()}>{saving ? "Saving..." : "Save"}</button></div></form>
    </section></div>
  );
}

function DifficultyLevelsPanel({ currentRole }: { currentRole?: any }) {
  const [levels, setLevels] = useState<DifficultyLevel[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingLevel, setEditingLevel] = useState<DifficultyLevel | null>(null);
  const canCreate = hasRolePermission(currentRole, "Settings:Questions:Difficulty Levels", "create");
  const canEdit = hasRolePermission(currentRole, "Settings:Questions:Difficulty Levels", "edit");
  const canDelete = hasRolePermission(currentRole, "Settings:Questions:Difficulty Levels", "delete");
  const canStatus = hasRolePermission(currentRole, "Settings:Questions:Difficulty Levels", "status");

  useEffect(() => {
    fetch("/api/difficulty-levels").then(async (response) => {
      const data = await response.json() as DifficultyLevel[] & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to load difficulty levels");
      setLevels(data);
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load difficulty levels")).finally(() => setLoading(false));
  }, []);

  const filteredLevels = levels.filter((item) => item.Difficulty_level.toLowerCase().includes(search.toLowerCase()));
  const updateStatus = async (item: DifficultyLevel) => {
    const response = await fetch("/api/difficulty-levels", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, status: !item.status }) });
    if (!response.ok) throw new Error("Unable to update difficulty status");
    const updated = await response.json() as DifficultyLevel;
    setLevels((current) => current.map((level) => level.id === updated.id ? updated : level));
  };
  const deleteLevel = async (item: DifficultyLevel) => {
    const response = await fetch("/api/difficulty-levels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id }) });
    if (!response.ok) throw new Error("Unable to delete difficulty level");
    setLevels((current) => current.filter((level) => level.id !== item.id));
  };

  return (
    <section className="categories-section" id="difficulty-levels">
      <div className="categories-header"><div><p className="section-kicker">Question settings</p><h1>Difficulty Levels</h1></div>{canCreate && <button className="candidate-action-button" type="button" onClick={() => setShowAddForm(true)}><span aria-hidden="true">+</span> Add new</button>}</div>
      <div className="categories-panel">
        <div className="categories-toolbar"><span>{loading ? "Loading difficulty levels..." : `Showing ${filteredLevels.length} of ${levels.length} difficulty levels`}</span><label className="search-control" htmlFor="difficulty-search">Search: <input id="difficulty-search" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="candidate-table-wrapper"><table className="candidate-table categories-table"><thead><tr><th>Difficulty Level</th><th>Status</th><th>Action</th></tr></thead><tbody>
          {!loading && filteredLevels.length === 0 ? <tr><td colSpan={3}>No difficulty levels available</td></tr> : filteredLevels.map((item) => <tr key={item.id}><td>{item.Difficulty_level}</td><td>{canStatus ? <button className={`category-toggle${item.status ? " is-on" : ""}`} type="button" aria-pressed={item.status} onClick={() => updateStatus(item).catch((statusError) => setError(statusError instanceof Error ? statusError.message : "Unable to update status"))}><span />{item.status ? "Active" : "Inactive"}</button> : (item.status ? "Active" : "Inactive")}</td><td><div className="category-actions">{canEdit && <button className="category-edit-button" type="button" onClick={() => setEditingLevel(item)}>Edit</button>}{canDelete && <button className="category-delete-button" type="button" onClick={() => deleteLevel(item).catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : "Unable to delete difficulty level"))}>Delete</button>}</div></td></tr>)}
        </tbody></table></div>
      </div>
      {showAddForm && <AddDifficultyLevelForm onClose={() => setShowAddForm(false)} onSaved={(item) => { setLevels((current) => [item, ...current]); setShowAddForm(false); }} />}
      {editingLevel && <EditDifficultyLevelForm item={editingLevel} onClose={() => setEditingLevel(null)} onSaved={(item) => { setLevels((current) => current.map((level) => level.id === item.id ? item : level)); setEditingLevel(null); }} />}
    </section>
  );
}

function LanguageForm({ item, onClose, onSaved }: { item?: LanguageItem; onClose: () => void; onSaved: (item: LanguageItem) => void }) {
  const [language, setLanguage] = useState(item?.q_language ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEditing = Boolean(item);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/languages", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEditing ? { id: item?.id, q_language: language } : { q_language: language }),
      });
      const data = await response.json() as LanguageItem & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to save language");
      onSaved(data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save language");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation"><section className="category-form" role="dialog" aria-modal="true" aria-labelledby="language-form-title">
      <div className="bulk-upload-header"><h1 id="language-form-title">{isEditing ? "Edit Language" : "Custom Language"}</h1><button className="form-close-icon" type="button" onClick={onClose} aria-label="Close language form">×</button></div>
      <form onSubmit={save}><div className="form-field"><label htmlFor="language-name">Language</label><input id="language-name" value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="Language" autoFocus required /></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="form-cancel-button" type="button" onClick={onClose}>Close</button><button className="form-save-button" type="submit" disabled={saving || !language.trim()}>{saving ? "Saving..." : "Save"}</button></div></form>
    </section></div>
  );
}

function LanguagesPanel({ currentRole }: { currentRole?: any }) {
  const [languages, setLanguages] = useState<LanguageItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formItem, setFormItem] = useState<LanguageItem | null | undefined>(undefined);
  const canCreate = hasRolePermission(currentRole, "Settings:Questions:Languages", "create");
  const canEdit = hasRolePermission(currentRole, "Settings:Questions:Languages", "edit");
  const canDelete = hasRolePermission(currentRole, "Settings:Questions:Languages", "delete");
  const canStatus = hasRolePermission(currentRole, "Settings:Questions:Languages", "status");

  useEffect(() => {
    fetch("/api/languages").then(async (response) => {
      const data = await response.json() as LanguageItem[] & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to load languages");
      setLanguages(data);
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load languages")).finally(() => setLoading(false));
  }, []);

  const filteredLanguages = languages.filter((item) => item.q_language.toLowerCase().includes(search.toLowerCase()));
  const updateStatus = async (item: LanguageItem) => {
    const response = await fetch("/api/languages", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, status: !item.status }) });
    if (!response.ok) throw new Error("Unable to update language status");
    const updated = await response.json() as LanguageItem;
    setLanguages((current) => current.map((language) => language.id === updated.id ? updated : language));
  };
  const deleteLanguage = async (item: LanguageItem) => {
    const response = await fetch("/api/languages", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id }) });
    if (!response.ok) throw new Error("Unable to delete language");
    setLanguages((current) => current.filter((language) => language.id !== item.id));
  };

  return (
    <section className="categories-section" id="languages">
      <div className="categories-header"><div><p className="section-kicker">Question settings</p><h1>Languages</h1></div>{canCreate && <button className="candidate-action-button" type="button" onClick={() => setFormItem(null)}><span aria-hidden="true">+</span> Add new</button>}</div>
      <div className="categories-panel"><div className="categories-toolbar"><span>{loading ? "Loading languages..." : `Showing ${filteredLanguages.length} of ${languages.length} languages`}</span><label className="search-control" htmlFor="language-search">Search: <input id="language-search" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="candidate-table-wrapper"><table className="candidate-table categories-table"><thead><tr><th>Language</th><th>Status</th><th>Action</th></tr></thead><tbody>{!loading && filteredLanguages.length === 0 ? <tr><td colSpan={3}>No languages available</td></tr> : filteredLanguages.map((item) => <tr key={item.id}><td>{item.q_language}</td><td>{canStatus ? <button className={`category-toggle${item.status ? " is-on" : ""}`} type="button" aria-pressed={item.status} onClick={() => updateStatus(item).catch((statusError) => setError(statusError instanceof Error ? statusError.message : "Unable to update status"))}><span />{item.status ? "Active" : "Inactive"}</button> : (item.status ? "Active" : "Inactive")}</td><td><div className="category-actions">{canEdit && <button className="category-edit-button" type="button" onClick={() => setFormItem(item)}>Edit</button>}{canDelete && <button className="category-delete-button" type="button" onClick={() => deleteLanguage(item).catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : "Unable to delete language"))}>Delete</button>}</div></td></tr>)}</tbody></table></div></div>
      {formItem !== undefined && <LanguageForm item={formItem ?? undefined} onClose={() => setFormItem(undefined)} onSaved={(item) => { setLanguages((current) => formItem ? current.map((language) => language.id === item.id ? item : language) : [item, ...current]); setFormItem(undefined); }} />}
    </section>
  );
}

function AssessmentTypeForm({ item, onClose, onSaved }: { item?: AssessmentType; onClose: () => void; onSaved: (item: AssessmentType) => void }) {
  const [name, setName] = useState(item?.assessment_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEditing = Boolean(item);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/assessment-types", { method: isEditing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isEditing ? { id: item?.id, assessment_name: name } : { assessment_name: name }) });
      const data = await response.json() as AssessmentType & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to save assessment type");
      onSaved(data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save assessment type");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation"><section className="category-form" role="dialog" aria-modal="true" aria-labelledby="assessment-type-form-title">
      <div className="bulk-upload-header"><h1 id="assessment-type-form-title">Add Assessment Type</h1><button className="form-close-icon" type="button" onClick={onClose} aria-label="Close assessment type form">×</button></div>
      <form onSubmit={save}><div className="form-field"><label htmlFor="assessment-type-name">Assessment Type</label><input id="assessment-type-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Assessment Type" autoFocus required /></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="form-cancel-button" type="button" onClick={onClose}>Close</button><button className="form-save-button" type="submit" disabled={saving || !name.trim()}>{saving ? "Saving..." : "Save"}</button></div></form>
    </section></div>
  );
}

function AssessmentTypesPanel({ currentRole }: { currentRole?: any }) {
  const [types, setTypes] = useState<AssessmentType[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formItem, setFormItem] = useState<AssessmentType | null | undefined>(undefined);
  const canCreate = hasRolePermission(currentRole, "Settings:Assessments:Examinations", "create");
  const canEdit = hasRolePermission(currentRole, "Settings:Assessments:Examinations", "edit");
  const canDelete = hasRolePermission(currentRole, "Settings:Assessments:Examinations", "delete");
  const canStatus = hasRolePermission(currentRole, "Settings:Assessments:Examinations", "status");

  useEffect(() => {
    fetch("/api/assessment-types").then(async (response) => {
      const data = await response.json() as AssessmentType[] & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to load assessment types");
      setTypes(data);
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load assessment types")).finally(() => setLoading(false));
  }, []);

  const filteredTypes = types.filter((item) => item.assessment_name.toLowerCase().includes(search.toLowerCase()));
  const updateStatus = async (item: AssessmentType) => {
    const response = await fetch("/api/assessment-types", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, status: !item.status }) });
    if (!response.ok) throw new Error("Unable to update assessment status");
    const updated = await response.json() as AssessmentType;
    setTypes((current) => current.map((type) => type.id === updated.id ? updated : type));
  };
  const deleteType = async (item: AssessmentType) => {
    const response = await fetch("/api/assessment-types", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id }) });
    if (!response.ok) throw new Error("Unable to delete assessment type");
    setTypes((current) => current.filter((type) => type.id !== item.id));
  };

  return (
    <section className="categories-section" id="assessment-types">
      <div className="categories-header"><div><p className="section-kicker">Assessment settings</p><h1>Examinations</h1></div>{canCreate && <button className="candidate-action-button" type="button" onClick={() => setFormItem(null)}><span aria-hidden="true">+</span> Add new</button>}</div>
      <div className="categories-panel"><div className="categories-toolbar"><span>{loading ? "Loading assessment types..." : `Showing ${filteredTypes.length} of ${types.length} assessment types`}</span><label className="search-control" htmlFor="assessment-type-search">Search: <input id="assessment-type-search" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="candidate-table-wrapper"><table className="candidate-table categories-table"><thead><tr><th>Assessment Type</th><th>Status</th><th>Action</th></tr></thead><tbody>{!loading && filteredTypes.length === 0 ? <tr><td colSpan={3}>No assessment types available</td></tr> : filteredTypes.map((item) => <tr key={item.id}><td>{item.assessment_name}</td><td>{canStatus ? <button className={`category-toggle${item.status ? " is-on" : ""}`} type="button" aria-pressed={item.status} onClick={() => updateStatus(item).catch((statusError) => setError(statusError instanceof Error ? statusError.message : "Unable to update status"))}><span />{item.status ? "Active" : "Inactive"}</button> : (item.status ? "Active" : "Inactive")}</td><td><div className="category-actions">{canEdit && <button className="category-edit-button" type="button" onClick={() => setFormItem(item)}>Edit</button>}{canDelete && <button className="category-delete-button" type="button" onClick={() => deleteType(item).catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : "Unable to delete assessment type"))}>Delete</button>}</div></td></tr>)}</tbody></table></div></div>
      {formItem !== undefined && <AssessmentTypeForm item={formItem ?? undefined} onClose={() => setFormItem(undefined)} onSaved={(item) => { setTypes((current) => formItem ? current.map((type) => type.id === item.id ? item : type) : [item, ...current]); setFormItem(undefined); }} />}
    </section>
  );
}

function CandidateCategoryForm({ item, onClose, onSaved }: { item?: CandidateCategory; onClose: () => void; onSaved: (item: CandidateCategory) => void }) {
  const [category, setCategory] = useState(item?.candidate_category ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEditing = Boolean(item);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/candidate-categories", { method: isEditing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isEditing ? { id: item?.id, candidate_category: category } : { candidate_category: category }) });
      const data = await response.json() as CandidateCategory & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to save candidate category");
      onSaved(data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save candidate category");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation"><section className="category-form" role="dialog" aria-modal="true" aria-labelledby="candidate-category-form-title">
      <div className="bulk-upload-header"><h1 id="candidate-category-form-title">{isEditing ? "Edit Candidate's Category" : "Add Candidate's Category"}</h1><button className="form-close-icon" type="button" onClick={onClose} aria-label="Close candidate category form">×</button></div>
      <form onSubmit={save}><div className="form-field"><label htmlFor="candidate-category-name">Candidate Category</label><input id="candidate-category-name" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Candidate Category" autoFocus required /></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="form-cancel-button" type="button" onClick={onClose}>Close</button><button className="form-save-button" type="submit" disabled={saving || !category.trim()}>{saving ? "Saving..." : "Save"}</button></div></form>
    </section></div>
  );
}

function CandidateCategoriesPanel({ currentRole }: { currentRole?: any }) {
  const [categories, setCategories] = useState<CandidateCategory[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formItem, setFormItem] = useState<CandidateCategory | null | undefined>(undefined);
  const canCreate = hasRolePermission(currentRole, "Settings:Candidates:Categories", "create");
  const canEdit = hasRolePermission(currentRole, "Settings:Candidates:Categories", "edit");
  const canDelete = hasRolePermission(currentRole, "Settings:Candidates:Categories", "delete");
  const canStatus = hasRolePermission(currentRole, "Settings:Candidates:Categories", "status");

  useEffect(() => {
    fetch("/api/candidate-categories").then(async (response) => {
      const data = await response.json() as CandidateCategory[] & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to load candidate categories");
      setCategories(data);
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load candidate categories")).finally(() => setLoading(false));
  }, []);

  const filteredCategories = categories.filter((item) => item.candidate_category.toLowerCase().includes(search.toLowerCase()));
  const updateStatus = async (item: CandidateCategory) => {
    const response = await fetch("/api/candidate-categories", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, status: !item.status }) });
    if (!response.ok) throw new Error("Unable to update candidate category status");
    const updated = await response.json() as CandidateCategory;
    setCategories((current) => current.map((category) => category.id === updated.id ? updated : category));
  };
  const deleteCategory = async (item: CandidateCategory) => {
    const response = await fetch("/api/candidate-categories", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id }) });
    if (!response.ok) throw new Error("Unable to delete candidate category");
    setCategories((current) => current.filter((category) => category.id !== item.id));
  };

  return (
    <section className="categories-section" id="candidate-categories">
      <div className="categories-header"><div><p className="section-kicker">Candidate settings</p><h1>Categories</h1></div>{canCreate && <button className="candidate-action-button" type="button" onClick={() => setFormItem(null)}><span aria-hidden="true">+</span> Add new</button>}</div>
      <div className="categories-panel"><div className="categories-toolbar"><span>{loading ? "Loading candidate categories..." : `Showing ${filteredCategories.length} of ${categories.length} candidate categories`}</span><label className="search-control" htmlFor="candidate-category-search">Search: <input id="candidate-category-search" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="candidate-table-wrapper"><table className="candidate-table categories-table"><thead><tr><th>Candidate Category</th><th>Status</th><th>Action</th></tr></thead><tbody>{!loading && filteredCategories.length === 0 ? <tr><td colSpan={3}>No candidate categories available</td></tr> : filteredCategories.map((item) => <tr key={item.id}><td>{item.candidate_category}</td><td>{canStatus ? <button className={`category-toggle${item.status ? " is-on" : ""}`} type="button" aria-pressed={item.status} onClick={() => updateStatus(item).catch((statusError) => setError(statusError instanceof Error ? statusError.message : "Unable to update status"))}><span />{item.status ? "Active" : "Inactive"}</button> : (item.status ? "Active" : "Inactive")}</td><td><div className="category-actions">{canEdit && <button className="category-edit-button" type="button" onClick={() => setFormItem(item)}>Edit</button>}{canDelete && <button className="category-delete-button" type="button" onClick={() => deleteCategory(item).catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : "Unable to delete candidate category"))}>Delete</button>}</div></td></tr>)}</tbody></table></div></div>
      {formItem !== undefined && <CandidateCategoryForm item={formItem ?? undefined} onClose={() => setFormItem(undefined)} onSaved={(item) => { setCategories((current) => formItem ? current.map((category) => category.id === item.id ? item : category) : [item, ...current]); setFormItem(undefined); }} />}
    </section>
  );
}

function CandidateSubCategoryForm({ item, onClose, onSaved }: { item?: CandidateSubCategory; onClose: () => void; onSaved: (item: CandidateSubCategory) => void }) {
  const [subCategory, setSubCategory] = useState(item?.candidate_sub_category ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [categoryOptions, setCategoryOptions] = useState<CandidateCategory[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEditing = Boolean(item);

  useEffect(() => {
    fetch("/api/candidate-categories").then(async (response) => {
      const data = await response.json() as CandidateCategory[] & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to load candidate categories");
      setCategoryOptions(data.filter((entry) => entry.status));
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load candidate categories")).finally(() => setLoadingCategories(false));
  }, []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/candidate-sub-categories", { method: isEditing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isEditing ? { id: item?.id, candidate_sub_category: subCategory, category } : { candidate_sub_category: subCategory, category }) });
      const data = await response.json() as CandidateSubCategory & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to save candidate sub-category");
      onSaved(data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save candidate sub-category");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation"><section className="category-form" role="dialog" aria-modal="true" aria-labelledby="candidate-sub-category-form-title">
      <div className="bulk-upload-header"><h1 id="candidate-sub-category-form-title">{isEditing ? "Edit Candidate's Sub-Category" : "Add Candidate's Sub-Category"}</h1><button className="form-close-icon" type="button" onClick={onClose} aria-label="Close candidate sub-category form">×</button></div>
      <form onSubmit={save}><div className="form-field"><label htmlFor="candidate-sub-category-name">Candidate Sub Category</label><input id="candidate-sub-category-name" value={subCategory} onChange={(event) => setSubCategory(event.target.value)} placeholder="Candidate Sub Category" autoFocus required /></div><div className="form-field"><label htmlFor="candidate-sub-category-parent">Category</label><select id="candidate-sub-category-parent" value={category} onChange={(event) => setCategory(event.target.value)} required disabled={loadingCategories}><option value="" disabled>{loadingCategories ? "Loading categories..." : "Choose category"}</option>{categoryOptions.map((entry) => <option key={entry.id} value={entry.candidate_category}>{entry.candidate_category}</option>)}</select></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="form-cancel-button" type="button" onClick={onClose}>Close</button><button className="form-save-button" type="submit" disabled={saving || loadingCategories || !category}>{saving ? "Saving..." : "Save"}</button></div></form>
    </section></div>
  );
}

function CandidateSubCategoriesPanel({ currentRole }: { currentRole?: any }) {
  const [items, setItems] = useState<CandidateSubCategory[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formItem, setFormItem] = useState<CandidateSubCategory | null | undefined>(undefined);
  const canCreate = hasRolePermission(currentRole, "Settings:Candidates:Sub-Categories", "create");
  const canEdit = hasRolePermission(currentRole, "Settings:Candidates:Sub-Categories", "edit");
  const canDelete = hasRolePermission(currentRole, "Settings:Candidates:Sub-Categories", "delete");
  const canStatus = hasRolePermission(currentRole, "Settings:Candidates:Sub-Categories", "status");

  useEffect(() => {
    fetch("/api/candidate-sub-categories").then(async (response) => {
      const data = await response.json() as CandidateSubCategory[] & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to load candidate sub-categories");
      setItems(data);
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load candidate sub-categories")).finally(() => setLoading(false));
  }, []);

  const filteredItems = items.filter((item) => `${item.candidate_sub_category} ${item.category}`.toLowerCase().includes(search.toLowerCase()));
  const updateStatus = async (item: CandidateSubCategory) => {
    const response = await fetch("/api/candidate-sub-categories", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, status: !item.status }) });
    if (!response.ok) throw new Error("Unable to update candidate sub-category status");
    const updated = await response.json() as CandidateSubCategory;
    setItems((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
  };
  const deleteItem = async (item: CandidateSubCategory) => {
    const response = await fetch("/api/candidate-sub-categories", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id }) });
    if (!response.ok) throw new Error("Unable to delete candidate sub-category");
    setItems((current) => current.filter((entry) => entry.id !== item.id));
  };

  return (
    <section className="categories-section" id="candidate-sub-categories">
      <div className="categories-header"><div><p className="section-kicker">Candidate settings</p><h1>Sub Categories</h1></div>{canCreate && <button className="candidate-action-button" type="button" onClick={() => setFormItem(null)}><span aria-hidden="true">+</span> Add new</button>}</div>
      <div className="categories-panel"><div className="categories-toolbar"><span>{loading ? "Loading candidate sub-categories..." : `Showing ${filteredItems.length} of ${items.length} candidate sub-categories`}</span><label className="search-control" htmlFor="candidate-sub-category-search">Search: <input id="candidate-sub-category-search" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="candidate-table-wrapper"><table className="candidate-table categories-table sub-categories-table"><thead><tr><th>Candidate Sub Category</th><th>Category</th><th>Status</th><th>Action</th></tr></thead><tbody>{!loading && filteredItems.length === 0 ? <tr><td colSpan={4}>No candidate sub-categories available</td></tr> : filteredItems.map((item) => <tr key={item.id}><td>{item.candidate_sub_category}</td><td>{item.category}</td><td>{canStatus ? <button className={`category-toggle${item.status ? " is-on" : ""}`} type="button" aria-pressed={item.status} onClick={() => updateStatus(item).catch((statusError) => setError(statusError instanceof Error ? statusError.message : "Unable to update status"))}><span />{item.status ? "Active" : "Inactive"}</button> : (item.status ? "Active" : "Inactive")}</td><td><div className="category-actions">{canEdit && <button className="category-edit-button" type="button" onClick={() => setFormItem(item)}>Edit</button>}{canDelete && <button className="category-delete-button" type="button" onClick={() => deleteItem(item).catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : "Unable to delete candidate sub-category"))}>Delete</button>}</div></td></tr>)}</tbody></table></div></div>
      {formItem !== undefined && <CandidateSubCategoryForm item={formItem ?? undefined} onClose={() => setFormItem(undefined)} onSaved={(item) => { setItems((current) => formItem ? current.map((entry) => entry.id === item.id ? item : entry) : [item, ...current]); setFormItem(undefined); }} />}
    </section>
  );
}

type CandidateInfoType = {
  id: number;
  type: string;
  created_at: string;
};

type CandidateInfoItem = {
  id: number;
  name: string;
  column_type: string;
  is_dependent: boolean;
  is_required: boolean;
  min_value: number | string | null;
  max_value: number | string | null;
  options?: unknown;
  status: boolean;
  created_at: string;
};

function isCandidateIdFieldName(name: string) {
  return /^candidate id(?:\s*\([^)]*\))?$/i.test(name.trim());
}

function isDateOfBirthFieldName(name: string) {
  const normalizedName = name.trim().toLowerCase();
  return normalizedName === "dob"
    || /^(date of birth|birth date)(?:\s*\([^)]*\))?$/.test(normalizedName);
}

function CandidateInfoForm({ item, onClose, onSaved }: { item?: CandidateInfoItem; onClose: () => void; onSaved: (item: CandidateInfoItem) => void }) {
  const [infoName, setInfoName] = useState(item?.name ?? "");
  const [type, setType] = useState(item?.column_type ?? "");
  const [isDependent, setIsDependent] = useState(item?.is_dependent ? "yes" : "");
  const [isRequired, setIsRequired] = useState(item?.is_required ? "yes" : "");
  const [minValue, setMinValue] = useState(item?.min_value?.toString() ?? "");
  const [maxValue, setMaxValue] = useState(item?.max_value?.toString() ?? "");
  const [types, setTypes] = useState<CandidateInfoType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEditing = Boolean(item);
  const needsRequiredChoice = type === "Text" || type === "Number" || type === "Dropdown";
  const isFormComplete = Boolean(
    infoName.trim()
    && type
    && (!needsRequiredChoice || isRequired)
    && (type !== "Number" || (minValue.trim() && maxValue.trim()))
    && (type !== "Dropdown" || isDependent),
  );

  useEffect(() => {
    fetch("/api/candidate-info-types")
      .then(async (response) => {
        const data = await response.json() as CandidateInfoType[] & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load candidate info types");
        setTypes(data);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load candidate info types"))
      .finally(() => setLoadingTypes(false));
  }, []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/candidate-info", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEditing
          ? { id: item?.id, name: infoName, column_type: type, is_dependent: type === "Dropdown" && isDependent === "yes", is_required: needsRequiredChoice && isRequired === "yes", min_value: type === "Number" ? minValue : null, max_value: type === "Number" ? maxValue : null }
          : { name: infoName, column_type: type, is_dependent: type === "Dropdown" && isDependent === "yes", is_required: needsRequiredChoice && isRequired === "yes", min_value: type === "Number" ? minValue : null, max_value: type === "Number" ? maxValue : null }),
      });
      const data = await response.json() as CandidateInfoItem & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to save candidate information");
      onSaved(data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save candidate information");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation">
      <section className="category-form" role="dialog" aria-modal="true" aria-labelledby="add-candidate-info-title">
        <div className="bulk-upload-header">
          <h1 id="add-candidate-info-title">{isEditing ? "Update Extra Info" : "Add Extra Info"}</h1>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close candidate info form">×</button>
        </div>
        <form onSubmit={save}>
          <div className="form-field">
            <label htmlFor="candidate-info-name">info_name</label>
            <input
              id="candidate-info-name"
              name="info_name"
              value={infoName}
              onChange={(event) => setInfoName(event.target.value)}
              placeholder="info_name"
              autoFocus
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="candidate-info-type">Type</label>
            <select
              id="candidate-info-type"
              name="Type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              disabled={loadingTypes}
              required
            >
              <option value="" disabled>{loadingTypes ? "Loading types..." : "Choose"}</option>
              {types.filter((item) => item.type !== "Choose").map((item) => (
                <option key={item.id} value={item.type}>{item.type}</option>
              ))}
            </select>
          </div>
          {type === "Text" && (
            <div className="form-field">
              <label htmlFor="candidate-info-required">Is Required</label>
              <select
                id="candidate-info-required"
                name="is_required"
                value={isRequired}
                onChange={(event) => setIsRequired(event.target.value)}
                required
              >
                <option value="" disabled>Choose</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          )}
          {(type === "Email" || type === "Date") && (
            <div className="form-field">
              <label htmlFor="candidate-info-format-required">Is Required</label>
              <select
                id="candidate-info-format-required"
                name="is_required"
                value={isRequired}
                onChange={(event) => setIsRequired(event.target.value)}
                required
              >
                <option value="" disabled>Choose</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          )}
          {type === "Number" && (
            <>
              <div className="form-field">
                <label htmlFor="candidate-info-min-value">Min value</label>
                <input
                  id="candidate-info-min-value"
                  name="min_value"
                  type="number"
                  value={minValue}
                  onChange={(event) => setMinValue(event.target.value)}
                  placeholder="Min value"
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="candidate-info-max-value">Max value</label>
                <input
                  id="candidate-info-max-value"
                  name="max_value"
                  type="number"
                  value={maxValue}
                  onChange={(event) => setMaxValue(event.target.value)}
                  placeholder="Max value"
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="candidate-number-required">Is Required</label>
                <select
                  id="candidate-number-required"
                  name="is_required"
                  value={isRequired}
                  onChange={(event) => setIsRequired(event.target.value)}
                  required
                >
                  <option value="" disabled>Choose</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </>
          )}
          {type === "Dropdown" && (
            <>
              <div className="form-field">
                <label htmlFor="candidate-dropdown-dependent">Is Dependent</label>
                <select
                  id="candidate-dropdown-dependent"
                  name="is_dependent"
                  value={isDependent}
                  onChange={(event) => setIsDependent(event.target.value)}
                  required
                >
                  <option value="" disabled>Choose</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="candidate-dropdown-required">Is Required</label>
                <select
                  id="candidate-dropdown-required"
                  name="is_required"
                  value={isRequired}
                  onChange={(event) => setIsRequired(event.target.value)}
                  required
                >
                  <option value="" disabled>Choose</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="form-cancel-button" type="button" onClick={onClose}>Close</button>
            <button className="form-save-button" type="submit" disabled={saving || loadingTypes || !isFormComplete}>{saving ? "Saving..." : "Save"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function CandidateSettingsPanel({ currentRole }: { currentRole?: any }) {
  const [items, setItems] = useState<CandidateInfoItem[]>([]);
  const [search, setSearch] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [assessmentPasskey, setAssessmentPasskey] = useState("");
  const [loginSettingsSaved, setLoginSettingsSaved] = useState(false);
  const [showAddCandidateInfo, setShowAddCandidateInfo] = useState(false);
  const [editingItem, setEditingItem] = useState<CandidateInfoItem | null>(null);
  const [loadingItems, setLoadingItems] = useState(true);
  const [error, setError] = useState("");
  const canCreate = hasRolePermission(currentRole, "Settings:Candidates:Settings", "create");
  const canEdit = hasRolePermission(currentRole, "Settings:Candidates:Settings", "edit");
  const canDelete = hasRolePermission(currentRole, "Settings:Candidates:Settings", "delete");
  const canStatus = hasRolePermission(currentRole, "Settings:Candidates:Settings", "status");

  useEffect(() => {
    fetch("/api/candidate-info")
      .then(async (response) => {
        const data = await response.json() as CandidateInfoItem[] & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load candidate information");
        setItems(data);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load candidate information"))
      .finally(() => setLoadingItems(false));
  }, []);

  const filteredItems = items.filter((item) =>
    `${item.name} ${item.column_type} ${item.is_dependent ? "Dependent" : "Not dependent"} ${item.status ? "Active" : "Inactive"}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  const updateItemStatus = async (item: CandidateInfoItem) => {
    const response = await fetch("/api/candidate-info", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, status: !item.status }),
    });
    const data = await response.json() as CandidateInfoItem & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Unable to update candidate information status");
    setItems((current) => current.map((entry) => entry.id === data.id ? data : entry));
  };

  const deleteItem = async (item: CandidateInfoItem) => {
    const response = await fetch("/api/candidate-info", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id }),
    });
    if (!response.ok) {
      const data = await response.json() as { error?: string };
      throw new Error(data.error ?? "Unable to delete candidate information");
    }
    setItems((current) => current.filter((entry) => entry.id !== item.id));
  };

  return (
    <section className="categories-section candidate-settings-section" id="candidate-settings">
      <div className="categories-header candidate-settings-header">
        <div>
          <p className="section-kicker">Candidate settings</p>
          <h2>Candidate Information</h2>
        </div>
        {canCreate && <button className="candidate-action-button" type="button" onClick={() => setShowAddCandidateInfo(true)}>
          <span aria-hidden="true">+</span> Add new
        </button>}
      </div>
      <div className="categories-panel">
        <div className="categories-toolbar categories-settings-toolbar">
          <span>{loadingItems ? "Loading settings..." : `Showing ${filteredItems.length} of ${items.length} settings`}</span>
          <label className="search-control" htmlFor="candidate-settings-search">
            Search:
            <input id="candidate-settings-search" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="candidate-table-wrapper">
          <table className="candidate-table categories-table candidate-settings-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Column Type</th>
                <th>Is Dependent</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {!loadingItems && filteredItems.length === 0 ? (
                <tr><td colSpan={5}>{search ? "No settings found" : "No settings available"}</td></tr>
              ) : filteredItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.name} <em>({item.name === "Candidate ID" ? "Unique & Mandatory" : item.is_required ? "Mandatory" : "Optional"})</em>
                  </td>
                  <td>{item.column_type}</td>
                  <td>{item.is_dependent ? "Yes" : "No"}</td>
                  <td>
                    {canStatus ? <button
                      className={`category-toggle${item.status ? " is-on" : ""}`}
                      type="button"
                      aria-pressed={item.status}
                      onClick={() => updateItemStatus(item).catch((statusError) => setError(statusError instanceof Error ? statusError.message : "Unable to update status"))}
                    >
                      <span />
                      {item.status ? "Active" : "Inactive"}
                    </button> : (item.status ? "Active" : "Inactive")}
                  </td>
                  <td>
                    <div className="category-actions">
                      {canEdit && <button className="category-edit-button" type="button" onClick={() => setEditingItem(item)}>Update</button>}
                      {canDelete && <button className="category-delete-button" type="button" onClick={() => deleteItem(item).catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : "Unable to delete candidate information"))}>Delete</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <section className="login-settings-section" aria-labelledby="login-settings-title">
        <div className="login-settings-header">
          <h2 id="login-settings-title">Login Settings</h2>
        </div>
        <form
          className="login-settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            setLoginSettingsSaved(true);
          }}
        >
          <div className="form-field">
            <label htmlFor="login-candidate-id">Candidate ID</label>
            <input
              id="login-candidate-id"
              value={candidateId}
              onChange={(event) => { setCandidateId(event.target.value); setLoginSettingsSaved(false); }}
              placeholder="Candidate ID"
            />
          </div>
          <div className="form-field">
            <label htmlFor="assessment-passkey">Assessment Passkey</label>
            <input
              id="assessment-passkey"
              value={assessmentPasskey}
              onChange={(event) => { setAssessmentPasskey(event.target.value); setLoginSettingsSaved(false); }}
              placeholder="Assessment Passkey"
            />
          </div>
          <div className="login-settings-actions">
            {canEdit && <button className="form-save-button" type="submit">Save</button>}
            {loginSettingsSaved && <span className="login-settings-success" role="status">Saved</span>}
          </div>
        </form>
      </section>
      {showAddCandidateInfo && (
        <CandidateInfoForm
          onClose={() => setShowAddCandidateInfo(false)}
          onSaved={(item) => {
            setItems((current) => [item, ...current]);
            setShowAddCandidateInfo(false);
          }}
        />
      )}
      {editingItem && (
        <CandidateInfoForm
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={(updatedItem) => {
            setItems((current) => current.map((item) => item.id === updatedItem.id ? updatedItem : item));
            setEditingItem(null);
          }}
        />
      )}
    </section>
  );
}

const userRows = [
  { name: "Evaluator", email: "evaluator@eduexpoits.in", role: "Evaluator", mobile: "9435249366", created: "14-04-2025 03:33:05 PM" },
  { name: "Invigilator", email: "invigilator@eduexpoits.in", role: "Invigilator", mobile: "9786878675", created: "13-04-2025 02:54:11 PM" },
  { name: "Administrator", email: "admin@eduexpoits.in", role: "Administrator", mobile: "9999999999", created: "13-04-2025 02:54:11 PM" },
];

const PERMISSION_SECTIONS = [
  { id: "Questions", label: "Questions", indent: 0, prefix: "" },
  { id: "Assessments", label: "Assessments", indent: 0, prefix: "" },
  { id: "Candidates", label: "Candidates", indent: 0, prefix: "" },
  { id: "Users:Roles & Permissions", label: "Roles & Permissions", group: "Users", indent: 1, prefix: "›" },
  { id: "Users:List", label: "List", indent: 1, prefix: "›" },
  { id: "Settings:Questions:Categories", label: "Categories", group: "Settings", subGroup: "Questions", indent: 2, prefix: "»" },
  { id: "Settings:Questions:Sub-Categories", label: "Sub-Categories", indent: 2, prefix: "»" },
  { id: "Settings:Questions:Topics", label: "Topics", indent: 2, prefix: "»" },
  { id: "Settings:Questions:Difficulty Levels", label: "Difficulty Levels", indent: 2, prefix: "»" },
  { id: "Settings:Questions:Languages", label: "Languages", indent: 2, prefix: "»" },
  { id: "Settings:Assessments:Examinations", label: "Examinations", subGroup: "Assessments", indent: 2, prefix: "»" },
  { id: "Settings:Assessments:Default Settings", label: "Default Settings", indent: 2, prefix: "»" },
  { id: "Settings:Candidates:Categories", label: "Categories", subGroup: "Candidates", indent: 2, prefix: "»" },
  { id: "Settings:Candidates:Sub-Categories", label: "Sub-Categories", indent: 2, prefix: "»" },
  { id: "Settings:Candidates:Settings", label: "Settings", indent: 2, prefix: "»" },
  { id: "Settings:Organization", label: "Organization", indent: 1, prefix: "›" },
];

function AddRoleForm({ role, onClose, onSaved }: { role?: any; onClose: () => void; onSaved: () => void }) {
  const normalizePermissions = (rawPermissions: Record<string, any> = {}) => {
    const nextPermissions: Record<string, { view: number; create: number; edit: number; delete: number; status: number }> = {};

    PERMISSION_SECTIONS.forEach((section) => {
      const source = rawPermissions[section.id] || {};
      nextPermissions[section.id] = {
        view: Number(source.view || 0),
        create: Number(source.create || 0),
        edit: Number(source.edit || 0),
        delete: Number(source.delete || 0),
        status: Number(source.status || 0),
      };
    });

    return nextPermissions;
  };

  const [roleName, setRoleName] = useState(role?.role_name ?? "");
  const [adminAccess, setAdminAccess] = useState(Boolean(role?.administrator_access));
  const [dashboard, setDashboard] = useState(Boolean(role?.dashboard));
  const [permissions, setPermissions] = useState<Record<string, { view: number; create: number; edit: number; delete: number; status: number }>>(normalizePermissions(role?.permissions || {}));
  const [saving, setSaving] = useState(false);

  const handleAdminChange = (checked: boolean) => {
    setAdminAccess(checked);
    setDashboard(checked);
    const newPerms: Record<string, any> = {};
    PERMISSION_SECTIONS.forEach((section) => {
      newPerms[section.id] = { view: checked ? 1 : 0, create: checked ? 1 : 0, edit: checked ? 1 : 0, delete: checked ? 1 : 0, status: checked ? 1 : 0 };
    });
    setPermissions(newPerms);
  };

  const handlePermissionChange = (id: string, field: "view" | "create" | "edit" | "delete" | "status", checked: boolean) => {
    const val = checked ? 1 : 0;
    setPermissions((prev) => {
      const current = prev[id] || { view: 0, create: 0, edit: 0, delete: 0, status: 0 };
      const updated = { ...current, [field]: val };
      if (adminAccess && val === 0) setAdminAccess(false);
      return { ...prev, [id]: updated };
    });
  };

  const saveRole = async () => {
    setSaving(true);
    try {
      const payload = {
        ...(role ? { id: role.id } : {}),
        role_name: roleName,
        administrator_access: adminAccess,
        dashboard,
        permissions,
      };

      const res = await fetch("/api/roles", {
        method: role ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) onSaved();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation" style={{ zIndex: 1000 }}>
      <section className="candidate-form" role="dialog" aria-modal="true" style={{ width: "900px", maxWidth: "90%" }}>
        <div className="bulk-upload-header" style={{ padding: '20px', borderBottom: '1px solid #eee' }}>
          <h1 style={{ fontSize: '20px', margin: 0, color: '#444' }}>{role ? "Edit Role" : "Add New Role"}</h1>
          <button className="form-close-icon" type="button" onClick={onClose}>×</button>
        </div>
        <div className="candidate-form-fields" style={{ display: 'block', maxHeight: '65vh', overflowY: 'auto', padding: '20px' }}>
          <div className="form-field full-width" style={{ marginBottom: '30px' }}>
            <input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="Role Name" required style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} />
          </div>

          <h3 style={{ marginBottom: '20px', color: '#666', fontSize: '18px' }}>Role Permissions</h3>
          
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <tbody>
              <tr>
                <td style={{ padding: '15px 0', borderBottom: '1px solid #eee', width: '30%' }}>Administrator Access <span style={{ color: '#aaa' }}>ⓘ</span></td>
                <td colSpan={4} style={{ padding: '15px 0', borderBottom: '1px solid #eee' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}><input type="checkbox" checked={adminAccess} onChange={(e) => handleAdminChange(e.target.checked)} /> Select All</label>
                </td>
              </tr>
              <tr>
                <td style={{ padding: '15px 0', borderBottom: '1px solid #eee' }}>Dashboard</td>
                <td colSpan={4} style={{ padding: '15px 0', borderBottom: '1px solid #eee' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}><input type="checkbox" checked={dashboard} onChange={(e) => setDashboard(e.target.checked)} /> View</label>
                </td>
              </tr>
              {PERMISSION_SECTIONS.map((section) => {
                const p = permissions[section.id] || { view: 0, create: 0, edit: 0, delete: 0, status: 0 };
                const canDelete = p.edit === 1;
                return (
                  <React.Fragment key={section.id}>
                    {section.group && (
                      <tr><td colSpan={6} style={{ padding: '25px 0 10px', fontWeight: 'bold', color: '#888' }}>{section.group}</td></tr>
                    )}
                    {section.subGroup && (
                      <tr><td colSpan={6} style={{ padding: '20px 0 10px', paddingLeft: '20px', fontWeight: 'bold', color: '#888' }}>› {section.subGroup}</td></tr>
                    )}
                    <tr>
                      <td style={{ padding: '12px 0', paddingLeft: `${section.indent * 20}px`, borderBottom: '1px solid #eee' }}>
                        {section.prefix} {section.label}
                      </td>
                      <td style={{ padding: '12px 0', borderBottom: '1px solid #eee' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}><input type="checkbox" checked={p.view === 1} onChange={(e) => handlePermissionChange(section.id, "view", e.target.checked)} /> View</label>
                      </td>
                      <td style={{ padding: '12px 0', borderBottom: '1px solid #eee' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}><input type="checkbox" checked={p.create === 1} onChange={(e) => handlePermissionChange(section.id, "create", e.target.checked)} /> Create</label>
                      </td>
                      <td style={{ padding: '12px 0', borderBottom: '1px solid #eee' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}><input type="checkbox" checked={p.edit === 1} onChange={(e) => handlePermissionChange(section.id, "edit", e.target.checked)} /> Edit</label>
                      </td>
                      <td style={{ padding: '12px 0', borderBottom: '1px solid #eee' }}>
                        {canDelete ? (
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}><input type="checkbox" checked={p.delete === 1} onChange={(e) => handlePermissionChange(section.id, "delete", e.target.checked)} /> Delete</label>
                        ) : (
                          <span style={{ color: '#aaa' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 0', borderBottom: '1px solid #eee' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}><input type="checkbox" checked={p.status === 1} onChange={(e) => handlePermissionChange(section.id, "status", e.target.checked)} /> Status</label>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="form-actions" style={{ padding: '20px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button className="form-cancel-button" type="button" onClick={onClose} style={{ padding: '8px 20px', border: '1px solid #ccc', borderRadius: '4px', background: 'transparent' }}>CLOSE</button>
          <button className="form-save-button" type="button" onClick={saveRole} disabled={saving || !roleName} style={{ padding: '8px 20px', border: 'none', borderRadius: '4px', background: '#6366f1', color: 'white', cursor: 'pointer' }}>{saving ? "SAVING..." : "SAVE"}</button>
        </div>
      </section>
    </div>
  );
}

function AddUserForm({ roles, user, onClose, onSaved }: { roles: any[]; user?: any; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [mobile, setMobile] = useState(user?.mobile ?? "");
  const [role, setRole] = useState(user?.role ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const saveUser = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/users", {
        method: user ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(user ? { id: user.id } : {}), name, email, mobile, role }),
      });
      const result = await res.json() as { error?: string };
      if (!res.ok) throw new Error(result.error ?? `Unable to ${user ? "update" : "create"} user`);
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : `Unable to ${user ? "update" : "create"} user`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation" style={{ zIndex: 1000 }}>
      <section className="candidate-form" role="dialog" aria-modal="true" style={{ width: "500px", maxWidth: "90%" }}>
        <div className="bulk-upload-header" style={{ padding: '20px', borderBottom: '1px solid #eee' }}>
          <h1 style={{ fontSize: '20px', margin: 0, color: '#444' }}>{user ? "Edit User" : "Add New User"}</h1>
          <button className="form-close-icon" type="button" onClick={onClose}>×</button>
        </div>
        <form className="candidate-form-fields" onSubmit={saveUser} style={{ display: 'block', padding: '20px' }}>
          <div className="form-field full-width" style={{ marginBottom: '15px' }}>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required style={{ width: '100%', padding: '8px' }} />
          </div>
          <div className="form-field full-width" style={{ marginBottom: '15px' }}>
            <label>Email (Username)</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%', padding: '8px' }} />
          </div>
          <div className="form-field full-width" style={{ marginBottom: '15px' }}>
            <label>Mobile</label>
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} required style={{ width: '100%', padding: '8px' }} />
          </div>
          <div className="form-field full-width" style={{ marginBottom: '15px' }}>
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} required style={{ width: '100%', padding: '8px' }}>
              <option value="" disabled>Choose</option>
              {roles.map((r) => <option key={r.id} value={r.role_name}>{r.role_name}</option>)}
            </select>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button className="form-cancel-button" type="button" onClick={onClose} style={{ padding: '8px 20px', border: '1px solid #ccc', borderRadius: '4px', background: 'transparent' }}>CLOSE</button>
            <button className="form-save-button" type="submit" disabled={saving || !role} style={{ padding: '8px 20px', border: 'none', borderRadius: '4px', background: '#6366f1', color: 'white', cursor: 'pointer' }}>{saving ? "SAVING..." : user ? "UPDATE" : "SAVE"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ResetUserPasswordForm({ user, onClose, onSaved }: { user: { id: number; email: string }; onClose: () => void; onSaved: () => void }) {
  const [password, setPassword] = useState("");
  const [reenteredPassword, setReenteredPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (password !== reenteredPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (!password) {
      setError("Enter a new password.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to reset user password");
      onSaved();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Unable to reset user password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation" style={{ zIndex: 1000 }}>
      <section className="candidate-form" role="dialog" aria-modal="true" aria-labelledby="reset-user-password-title" style={{ width: "500px", maxWidth: "90%" }}>
        <div className="bulk-upload-header" style={{ padding: "20px", borderBottom: "1px solid #eee" }}>
          <h1 id="reset-user-password-title" style={{ fontSize: "20px", margin: 0, color: "#444" }}>Reset Password</h1>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close reset password form">×</button>
        </div>
        <form className="candidate-form-fields" onSubmit={resetPassword} style={{ display: "block", padding: "20px" }}>
          <p className="reset-password-username">Login ID: <strong>{user.email}</strong></p>
          <div className="form-field full-width" style={{ marginBottom: "15px" }}>
            <label htmlFor="reset-user-password">Enter Password</label>
            <input id="reset-user-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required style={{ width: "100%", padding: "8px" }} />
          </div>
          <div className="form-field full-width" style={{ marginBottom: "15px" }}>
            <label htmlFor="reenter-user-password">Re-enter Password</label>
            <input id="reenter-user-password" type="password" autoComplete="new-password" value={reenteredPassword} onChange={(event) => setReenteredPassword(event.target.value)} required style={{ width: "100%", padding: "8px" }} />
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
            <button className="form-cancel-button" type="button" onClick={onClose} disabled={saving} style={{ padding: "8px 20px", border: "1px solid #ccc", borderRadius: "4px", background: "transparent" }}>CLOSE</button>
            <button className="form-save-button" type="submit" disabled={saving} style={{ padding: "8px 20px", border: "none", borderRadius: "4px", background: "#6366f1", color: "white", cursor: "pointer" }}>{saving ? "RESETTING..." : "RESET PASSWORD"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function UsersPanel({ currentRole }: { currentRole?: any }) {
  const [userView, setUserView] = useState<"roles" | "list">("roles");
  const [showAddRole, setShowAddRole] = useState(false);
  const [editingRole, setEditingRole] = useState<any | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [resettingPasswordUser, setResettingPasswordUser] = useState<any | null>(null);
  const [roles, setRoles] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const canCreateRoles = hasRolePermission(currentRole, "Users:Roles & Permissions", "create");
  const canEditRoles = hasRolePermission(currentRole, "Users:Roles & Permissions", "edit");
  const canDeleteRoles = hasRolePermission(currentRole, "Users:Roles & Permissions", "delete");
  const canCreateUsers = hasRolePermission(currentRole, "Users:List", "create");
  const canEditUsers = hasRolePermission(currentRole, "Users:List", "edit");
  const canDeleteUsers = hasRolePermission(currentRole, "Users:List", "delete");

  const fetchRoles = () => {
    fetch("/api/roles")
      .then(res => res.json())
      .then(data => {
        if (!data.error) setRoles(data);
      })
      .catch(console.error);
  };

  const fetchUsers = () => {
    fetch("/api/users")
      .then(res => res.json())
      .then(data => {
        if (!data.error) setUsers(data);
      })
      .catch(console.error);
  };

  const deleteUser = async (userId: number) => {
    if (!window.confirm("Delete this user?")) {
      return;
    }

    try {
      const res = await fetch("/api/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId }),
      });

      if (res.ok) {
        fetchUsers();
      }
    } catch (error) {
      console.error("Failed to delete user", error);
    }
  };

  useEffect(() => {
    fetchRoles();
    fetchUsers();
  }, []);

  const [activeUserMenu, setActiveUserMenu] = useState<number | null>(null);

  return (
    <section className="users-section" id="users">
      <div className="users-header">
        <div>
          <p className="section-kicker">Access workspace</p>
          <h1>Users</h1>
        </div>
        <div className="users-tabs" role="tablist" aria-label="User views">
          {[
            ["roles", "Roles and Permissions"],
            ["list", "List"],
          ].map(([value, label]) => (
            <button
              aria-selected={userView === value}
              className={userView === value ? "is-active" : ""}
              key={value}
              role="tab"
              type="button"
              onClick={() => setUserView(value as "roles" | "list")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {userView === "roles" && (
        <div className="role-grid" role="tabpanel">
          {roles.map((roleObj) => (
            <article className="role-card" key={roleObj.id}>
              <div className="role-card-top">
                <span>Total users</span>
                <div className="role-avatars" aria-label={`${roleObj.role_name} users`}>
                  <i />
                  <i />
                </div>
              </div>
              <h2>{roleObj.role_name}</h2>
              {canEditRoles && <button type="button" onClick={() => setEditingRole(roleObj)}>Edit Role</button>}
            </article>
          ))}
          {canCreateRoles && (
            <button className="add-role-card" type="button" onClick={() => setShowAddRole(true)}>
              <span className="role-person-icon" aria-hidden="true" />
              <span>
                <strong>Add role</strong>
                <small>Add role, if it does not exist</small>
              </span>
            </button>
          )}
        </div>
      )}

      {showAddRole && (
        <AddRoleForm onClose={() => setShowAddRole(false)} onSaved={() => { setShowAddRole(false); fetchRoles(); }} />
      )}

      {editingRole && canEditRoles && (
        <AddRoleForm
          role={editingRole}
          onClose={() => setEditingRole(null)}
          onSaved={() => { setEditingRole(null); fetchRoles(); }}
        />
      )}

      {userView === "list" && (
        <div className="users-list-panel" role="tabpanel">
          <div className="users-list-actions">
            {canCreateUsers && <button className="candidate-action-button" type="button" onClick={() => setShowAddUser(true)}><span aria-hidden="true">+</span> Add new</button>}
            <label className="search-control" htmlFor="user-search">Search: <input id="user-search" /></label>
          </div>
          <div className="users-table-wrapper">
            <table className="users-table">
              <thead><tr><th>Name</th><th>Role</th><th>Mobile</th><th>Status</th><th>Verified</th><th>Created On</th><th /></tr></thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.email}>
                    <td><span className="user-avatar" /> <span><strong>{user.name}</strong><small>{user.email}</small></span></td>
                    <td>{user.role}</td>
                    <td>{user.mobile}</td>
                    <td><label className="status-toggle"><input type="checkbox" checked={user.status} readOnly /><span /></label> {user.status ? "Active" : "Inactive"}</td>
                    <td>{user.verified ? <b className="verified-badge">Verified</b> : <b className="verified-badge" style={{background: '#fef2f2', color: '#991b1b'}}>Unverified</b>}</td>
                    <td>{new Date(user.created_on).toLocaleString()}</td>
                    <td style={{ position: "relative" }}>
                      <button
                        className="row-more-button"
                        type="button"
                        aria-label={`Options for ${user.name}`}
                        aria-haspopup="menu"
                        aria-expanded={activeUserMenu === user.id}
                        onClick={() => setActiveUserMenu(activeUserMenu === user.id ? null : user.id)}
                      >
                        ⋮
                      </button>
                      {activeUserMenu === user.id && (
                        <div className="row-action-menu" role="menu">
                          {canEditUsers && <button type="button" role="menuitem" onClick={() => { setResettingPasswordUser(user); setActiveUserMenu(null); }}>Reset Password</button>}
                          {canEditUsers && <button type="button" role="menuitem" onClick={() => { setEditingUser(user); setActiveUserMenu(null); }}>Edit</button>}
                          {canDeleteUsers && <button type="button" role="menuitem" onClick={() => { deleteUser(user.id); setActiveUserMenu(null); }}>Delete</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={7}>No users found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddUser && (
        <AddUserForm roles={roles} onClose={() => setShowAddUser(false)} onSaved={() => { setShowAddUser(false); fetchUsers(); }} />
      )}
      {editingUser && canEditUsers && (
        <AddUserForm
          roles={roles}
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={() => { setEditingUser(null); fetchUsers(); }}
        />
      )}
      {resettingPasswordUser && canEditUsers && (
        <ResetUserPasswordForm
          user={resettingPasswordUser}
          onClose={() => setResettingPasswordUser(null)}
          onSaved={() => setResettingPasswordUser(null)}
        />
      )}
    </section>
  );
}

function DashboardPanel({ name, shortcuts, onNavigate }: { name: string; shortcuts: typeof dashboardPages; onNavigate: (section: string) => void }) {
  return (
    <section className="dashboard-content">
      <div className="dashboard-heading">
        <div className="dashboard-heading-copy">
          <p className="section-kicker">Examination workspace</p>
          <h1>Dashboard</h1>
          <p>Welcome back, {name}.</p>
          <p className="dashboard-intro">Manage your examination system efficiently.</p>
        </div>
        <div className="dashboard-hero-art" aria-hidden="true">
          <svg viewBox="0 0 300 150" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M36 129c8-29 28-39 48-26 9-33 50-37 66-10 18-30 54-21 57 8 28-13 52 4 56 28H36Z" fill="#DDD6FE" />
            <rect x="82" y="28" width="134" height="91" rx="12" fill="#312E81" />
            <rect x="91" y="37" width="116" height="72" rx="6" fill="white" />
            <path d="M106 55h71M106 69h88M106 83h61" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round" />
            <circle cx="103" cy="55" r="3" fill="#818CF8" />
            <circle cx="103" cy="69" r="3" fill="#818CF8" />
            <circle cx="103" cy="83" r="3" fill="#818CF8" />
            <path d="M70 119h160l-14 9H84l-14-9Z" fill="#A5B4FC" />
            <path d="m145 17 48 17-48 17-48-17 48-17Z" fill="#4338CA" />
            <path d="M183 39v20" stroke="#6366F1" strokeWidth="3" strokeLinecap="round" />
            <path d="M178 60h10l-5 9-5-9Z" fill="#FBBF24" />
            <circle cx="69" cy="104" r="22" fill="white" stroke="#818CF8" strokeWidth="5" />
            <path d="M69 91v14l9 5" stroke="#4338CA" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m49 42-4-8m207 54 8-4M62 64l-8 2" stroke="#A78BFA" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </div>
        <div className="dashboard-hero-note">
          <span aria-hidden="true">✦</span>
          <strong>Better exams,<br />better future.</strong>
        </div>
      </div>
      <div className="dashboard-shortcuts">
        {shortcuts.map((shortcut) => (
          <button className={`dashboard-shortcut dashboard-shortcut-tone-${dashboardShortcutTones[dashboardPages.findIndex((page) => page.label === shortcut.label)] ?? 0}`} type="button" key={shortcut.label} onClick={() => onNavigate(shortcut.label)}>
            <span className="dashboard-shortcut-icon" aria-hidden="true">{shortcut.icon}</span>
            <span className="dashboard-shortcut-copy">
              <strong>{shortcut.label}</strong>
              <small>{shortcut.description}</small>
            </span>
            <span className="dashboard-shortcut-arrow" aria-hidden="true">›</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function CandidatePermissionsPanel({ accountUserId }: { accountUserId: number | null }) {
  const [examCamPermissionActive, setExamCamPermissionActive] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/candidate-permissions")
      .then(async (response) => {
        const data = await response.json() as { exam_cam_permission_active?: boolean; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load candidate permissions.");
        setExamCamPermissionActive(data.exam_cam_permission_active ?? true);
      })
      .catch((loadError) => {
        console.error("Failed to load candidate camera permission", loadError);
        setError(loadError instanceof Error ? loadError.message : "Unable to load candidate permissions.");
      });
  }, []);

  const updatePermission = async (active: boolean) => {
    if (!accountUserId || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/candidate-permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountUserId, examCamPermissionActive: active }),
      });
      const data = await response.json() as { exam_cam_permission_active?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to save candidate permissions.");
      setExamCamPermissionActive(data.exam_cam_permission_active ?? active);
    } catch (saveError) {
      console.error("Failed to update candidate camera permission", saveError);
      setError(saveError instanceof Error ? saveError.message : "Unable to save candidate permissions.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="candidate-permissions-section" aria-labelledby="candidate-permissions-title">
      <header className="candidate-permissions-header">
        <p className="section-kicker">Settings</p>
        <h1 id="candidate-permissions-title">Candidate Permissions</h1>
        <p>Manage permissions available to candidates during examinations.</p>
      </header>
      <div className="candidate-permissions-card">
        <div className="candidate-permissions-copy">
          <h2>Exam Cam Permission</h2>
          <p>Allow candidates to use their camera while attending an exam.</p>
        </div>
        <div className="candidate-permissions-actions" role="group" aria-label="Exam Cam Permission">
          <button
            type="button"
            className={`candidate-permission-button${examCamPermissionActive ? " is-selected is-active" : ""}`}
            aria-pressed={examCamPermissionActive === true}
            disabled={examCamPermissionActive === null || saving}
            onClick={() => void updatePermission(true)}
          >
            Active
          </button>
          <button
            type="button"
            className={`candidate-permission-button${examCamPermissionActive === false ? " is-selected is-inactive" : ""}`}
            aria-pressed={examCamPermissionActive === false}
            disabled={examCamPermissionActive === null || saving}
            onClick={() => void updatePermission(false)}
          >
            Inactive
          </button>
        </div>
      </div>
      <p className="candidate-permissions-note" role="status">
        {examCamPermissionActive === null ? "Loading current status…" : `Current status: ${examCamPermissionActive ? "Active" : "Inactive"}${saving ? " · Saving…" : ""}`}
      </p>
      {error && <p className="candidate-permissions-error" role="alert">{error}</p>}
    </section>
  );
}

function SectionPlaceholder({ title }: { title: string }) {
  return (
    <section className="section-placeholder" aria-labelledby={`${title.toLowerCase()}-title`}>
      <p className="section-kicker">Examination workspace</p>
      <h1 id={`${title.toLowerCase()}-title`}>{title}</h1>
      <p>This workspace is ready for {title.toLowerCase()} management.</p>
    </section>
  );
}

function AddQuestionForm({ onClose, onSaved, initialQuestion }: { onClose: () => void; onSaved: (question: QuestionRecord) => void; initialQuestion?: QuestionRecord }) {
  const initialDetails = initialQuestion?.details ?? {};
  const initialOptions = Array.isArray(initialDetails.options)
    ? initialDetails.options.filter((option): option is string => typeof option === "string")
    : [];
  const [categories, setCategories] = useState<QuestionCategory[]>([]);
  const [subCategories, setSubCategories] = useState<QuestionSubCategory[]>([]);
  const [topics, setTopics] = useState<QuestionTopic[]>([]);
  const [languages, setLanguages] = useState<LanguageItem[]>([]);
  const [difficultyLevels, setDifficultyLevels] = useState<DifficultyLevel[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState(initialQuestion?.category ?? "");
  const [selectedSubCategory, setSelectedSubCategory] = useState(initialQuestion?.sub_category ?? "");
  const [selectedTopic, setSelectedTopic] = useState(initialQuestion?.topic ?? "");
  const [selectedQuestionType, setSelectedQuestionType] = useState(initialQuestion?.question_type ?? "");
  const [singleAnswer, setSingleAnswer] = useState(typeof initialDetails.answer === "string" ? initialDetails.answer : "");
  const [multipleAnswers, setMultipleAnswers] = useState<string[]>(Array.isArray(initialDetails.answer)
    ? initialDetails.answer.filter((answer): answer is string => typeof answer === "string")
    : []);
  const [selectedOptionAnswer, setSelectedOptionAnswer] = useState(typeof initialDetails.answer === "string" ? initialDetails.answer : "");
  const [longAnswer, setLongAnswer] = useState(typeof initialDetails.answer === "string" && ["Manual Evaluation", "Passage Type"].includes(initialQuestion?.question_type ?? "") ? initialDetails.answer : "");
  const [minWords, setMinWords] = useState(typeof initialDetails.min_words === "number" ? String(initialDetails.min_words) : "0");
  const [maxWords, setMaxWords] = useState(typeof initialDetails.max_words === "number"
    ? String(initialDetails.max_words)
    : initialQuestion?.question_type === "Passage Type" ? "200" : "2000");
  const [answerLimitError, setAnswerLimitError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const filteredSubCategories = subCategories.filter((item) => item.category === selectedCategory);
  const filteredTopics = topics.filter((item) => item.q_s_category === selectedSubCategory);
  const choiceOptions = ["A", "B", "C", "D", "E"];
  const isChoiceQuestion = selectedQuestionType === "Single Choice" || selectedQuestionType === "Multiple Choice";
  const isSingleLineQuestion = selectedQuestionType === "Fill in the Blank" || selectedQuestionType === "True/False" || selectedQuestionType === "Yes/No" || selectedQuestionType === "Agree/Disagree" || selectedQuestionType === "Good/Bad";
  const fixedAnswerOptions: Record<string, string[]> = {
    "Yes/No": ["Yes", "No"],
    "Agree/Disagree": ["Agree", "Disagree"],
    "Good/Bad": ["Good", "Bad"],
    "True/False": ["True", "False"],
  };
  const usesAnswerButtons = ["True/False", "Agree/Disagree", "Good/Bad"].includes(selectedQuestionType);
  const hasWordLimits = selectedQuestionType === "Manual Evaluation" || selectedQuestionType === "Passage Type";
  const answerWordCount = longAnswer.trim() ? longAnswer.trim().split(/\s+/).length : 0;

  useEffect(() => {
    Promise.all([
      fetch("/api/question-categories"),
      fetch("/api/question-sub-categories"),
      fetch("/api/question-topics"),
      fetch("/api/languages"),
      fetch("/api/difficulty-levels"),
    ])
      .then(async ([categoryResponse, subCategoryResponse, topicResponse, languageResponse, difficultyResponse]) => {
        const categoryData = await categoryResponse.json() as QuestionCategory[];
        const subCategoryData = await subCategoryResponse.json() as QuestionSubCategory[];
        const topicData = await topicResponse.json() as QuestionTopic[];
        const languageData = await languageResponse.json() as LanguageItem[];
        const difficultyData = await difficultyResponse.json() as DifficultyLevel[];
        setCategories(categoryData.filter((item) => item.status));
        setSubCategories(subCategoryData.filter((item) => item.status));
        setTopics(topicData.filter((item) => item.status));
        setLanguages(languageData.filter((item) => item.status));
        setDifficultyLevels(difficultyData.filter((item) => item.status));
      })
      .catch(() => {
        setCategories([]);
        setSubCategories([]);
        setTopics([]);
        setLanguages([]);
        setDifficultyLevels([]);
      })
      .finally(() => setLoadingOptions(false));
  }, []);

  return (
    <div className="form-overlay" role="presentation">
      <section className="manual-form question-form" role="dialog" aria-modal="true" aria-labelledby="add-question-title">
        <div className="manual-form-header">
          <h1 id="add-question-title">{initialQuestion ? "Update Question" : "Add Question"}</h1>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close question form">×</button>
        </div>
        <form onSubmit={async (event) => {
          event.preventDefault();
          if (hasWordLimits) {
            const minLimit = Number(minWords);
            const maxLimit = Number(maxWords);
            if (!minWords || !maxWords || !Number.isInteger(minLimit) || !Number.isInteger(maxLimit) || minLimit < 0 || maxLimit < minLimit) {
              setAnswerLimitError("Enter valid word limits, with Max Words greater than or equal to Min Words.");
              return;
            }
            if (answerWordCount < minLimit) {
              setAnswerLimitError(`Answer must contain at least ${minLimit} words.`);
              return;
            }
            if (answerWordCount > maxLimit) {
              setAnswerLimitError(`Answer cannot exceed ${maxLimit} words.`);
              return;
            }
          }
          const formData = new FormData(event.currentTarget);
          const questionText = String(formData.get("question") ?? "").trim();
          if (!selectedQuestionType || !questionText) {
            setSaveError("Select a question type and enter the question text.");
            return;
          }

          const options = isChoiceQuestion
            ? choiceOptions.map((option) => String(formData.get(`option_${option}`) ?? "").trim())
            : fixedAnswerOptions[selectedQuestionType] ?? [];
          const answer = selectedQuestionType === "Multiple Choice"
            ? multipleAnswers
            : selectedQuestionType === "Single Choice"
              ? singleAnswer
              : usesAnswerButtons
                ? selectedOptionAnswer
                : hasWordLimits
                  ? longAnswer
                  : String(formData.get("answer") ?? "");

          setSaving(true);
          setSaveError("");
          try {
            const response = await fetch("/api/questions", {
              method: initialQuestion ? "PATCH" : "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...(initialQuestion ? { id: initialQuestion.id } : {}),
                question_type: selectedQuestionType,
                question: questionText,
                category: selectedCategory,
                sub_category: selectedSubCategory,
                topic: selectedTopic,
                difficulty_level: formData.get("difficulty_level"),
                language: formData.get("language"),
                details: {
                  passage: formData.get("passage"),
                  answer,
                  options,
                  randomize_options: formData.get("randomize_options"),
                  min_words: hasWordLimits ? Number(minWords) : null,
                  max_words: hasWordLimits ? Number(maxWords) : null,
                  enable_file_upload: formData.get("enable_file_upload"),
                  ignore_case: formData.get("ignore_case"),
                  is_numeric: formData.get("is_numeric"),
                  reference: formData.get("reference"),
                },
              }),
            });
            const data = await response.json() as QuestionRecord & { error?: string };
            if (!response.ok) throw new Error(data.error ?? "Unable to save question");
            onSaved(data);
          } catch (submitError) {
            setSaveError(submitError instanceof Error ? submitError.message : "Unable to save question");
          } finally {
            setSaving(false);
          }
        }}>
          <div className="form-field full-width">
            <label htmlFor="question-type">Question Type</label>
            <select id="question-type" name="question_type" value={selectedQuestionType} required onChange={(event) => {
              const nextType = event.target.value;
              setSelectedQuestionType(nextType);
              setSingleAnswer("");
              setMultipleAnswers([]);
              setSelectedOptionAnswer("");
              setLongAnswer("");
              setMinWords("0");
              setMaxWords(nextType === "Passage Type" ? "200" : "2000");
              setAnswerLimitError("");
            }}>
              <option value="" disabled>Choose</option>
              <optgroup label="Objective">
                <option>Single Choice</option>
                <option>Multiple Choice</option>
                <option>Fill in the Blank</option>
                <option>True/False</option>
                <option>Yes/No</option>
                <option>Agree/Disagree</option>
                <option>Good/Bad</option>
              </optgroup>
              <optgroup label="Subjective">
                <option>Manual Evaluation</option>
                <option>Passage Type</option>
              </optgroup>
            </select>
          </div>

          {selectedQuestionType === "Passage Type" ? (
            <>
              <div className="form-field full-width">
                <label htmlFor="question-passage">Passage</label>
                <textarea id="question-passage" name="passage" className="question-textarea" placeholder="Passage" defaultValue={String(initialDetails.passage ?? "")} />
              </div>
              <div className="form-field full-width">
                <label htmlFor="question-text">Question</label>
                <textarea id="question-text" name="question" className="question-textarea" placeholder="Question" defaultValue={initialQuestion?.question ?? ""} required />
              </div>
            </>
          ) : isSingleLineQuestion ? (
            <div className="form-field full-width">
              <label htmlFor="question-text">Question</label>
              <input id="question-text" name="question" placeholder="Question" defaultValue={initialQuestion?.question ?? ""} required />
            </div>
          ) : (
            <div className="form-field full-width">
              <label htmlFor="question-text">Question</label>
              <textarea id="question-text" name="question" className="question-textarea" placeholder="Question" defaultValue={initialQuestion?.question ?? ""} required />
            </div>
          )}

          {(selectedQuestionType === "Manual Evaluation" || selectedQuestionType === "Passage Type") && (
            <>
              <div className="form-field full-width">
                <label htmlFor="question-long-answer">Answer <em>(optional)</em></label>
                <textarea
                  id="question-long-answer"
                  name="answer"
                  className="question-textarea"
                  placeholder="Answer (optional)"
                  value={longAnswer}
                  aria-describedby="question-long-answer-count"
                  onChange={(event) => {
                    const nextAnswer = event.target.value;
                    const nextWordCount = nextAnswer.trim() ? nextAnswer.trim().split(/\s+/).length : 0;
                    if (maxWords && nextWordCount > Number(maxWords)) {
                      setAnswerLimitError(`Answer cannot exceed ${maxWords} words.`);
                      return;
                    }
                    setLongAnswer(nextAnswer);
                    setAnswerLimitError("");
                  }}
                />
                <p id="question-long-answer-count" className="word-limit-feedback" aria-live="polite">
                  {answerWordCount} words (minimum {minWords || 0}, maximum {maxWords || 0})
                </p>
              </div>
              <div className="manual-evaluation-settings">
                <div className="form-field">
                  <label htmlFor="question-min-words">Min Words</label>
                  <input id="question-min-words" name="min_words" type="number" min="0" step="1" value={minWords} onChange={(event) => { setMinWords(event.target.value); setAnswerLimitError(""); }} />
                </div>
                <div className="form-field">
                  <label htmlFor="question-max-words">Max Words</label>
                  <input
                    id="question-max-words"
                    name="max_words"
                    type="number"
                    min="0"
                    step="1"
                    value={maxWords}
                    onChange={(event) => {
                      const nextMaxWords = event.target.value;
                      if (nextMaxWords && Number(nextMaxWords) < answerWordCount) {
                        setAnswerLimitError(`Maximum words cannot be less than the current answer length of ${answerWordCount}.`);
                        return;
                      }
                      setMaxWords(nextMaxWords);
                      setAnswerLimitError("");
                    }}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="question-enable-file-upload">Enable File Upload</label>
                  <select id="question-enable-file-upload" name="enable_file_upload" defaultValue={String(initialDetails.enable_file_upload ?? "Yes")}>
                    <option>Yes</option>
                    <option>No</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {answerLimitError && hasWordLimits && <p className="word-limit-error" role="alert">{answerLimitError}</p>}

          {isChoiceQuestion && (
            <>
              <div className="question-options-heading"><h2>Options</h2></div>
              <div className="form-field full-width">
                <label htmlFor="randomize-options">Randomize Options</label>
                <select id="randomize-options" name="randomize_options" defaultValue={String(initialDetails.randomize_options ?? "Yes")}>
                  <option>Yes</option>
                  <option>No</option>
                </select>
              </div>
              <div className="question-option-grid">
                {choiceOptions.map((option, index) => (
                  <input key={option} name={`option_${option}`} placeholder={`${option}${index > 2 ? " (optional)" : ""}`} aria-label={`Option ${option}`} defaultValue={initialOptions[index] ?? ""} />
                ))}
              </div>
            </>
          )}

          {selectedQuestionType === "Single Choice" && (
            <div className="form-field answer-field">
              <label htmlFor="question-answer">Answer</label>
              <select id="question-answer" name="answer" value={singleAnswer} onChange={(event) => setSingleAnswer(event.target.value)}>
                <option value="" disabled>Choose</option>
                {choiceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          )}

          {selectedQuestionType === "Multiple Choice" && (
            <div className="form-field full-width multiple-answer-field">
              <label htmlFor="question-multiple-answers">Answers</label>
              <select
                id="question-multiple-answers"
                value=""
                onChange={(event) => {
                  const answer = event.target.value;
                  if (answer) setMultipleAnswers((current) => [...current, answer]);
                }}
              >
                <option value="">Select an answer</option>
                {choiceOptions.filter((option) => !multipleAnswers.includes(option)).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              {multipleAnswers.length > 0 && (
                <div className="selected-answer-list" aria-label="Selected answers">
                  {multipleAnswers.map((answer) => (
                    <span className="selected-answer" key={answer}>
                      {answer}
                      <button type="button" onClick={() => setMultipleAnswers((current) => current.filter((item) => item !== answer))} aria-label={`Remove answer ${answer}`}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {usesAnswerButtons && (
            <>
              <div className="question-options-heading true-false-heading"><h2>Options</h2></div>
              <div className="question-option-grid true-false-option-grid">
                {fixedAnswerOptions[selectedQuestionType].map((option) => (
                  <button
                    className="true-false-option-button"
                    type="button"
                    key={option}
                    aria-pressed={selectedOptionAnswer === option}
                    onClick={() => setSelectedOptionAnswer(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="question-options-heading true-false-heading"><h2>Answer</h2></div>
              <div className="form-field answer-field true-false-answer">
                <label htmlFor="question-paired-choice-answer">Answer</label>
                <select id="question-paired-choice-answer" name="answer" value={selectedOptionAnswer} onChange={(event) => setSelectedOptionAnswer(event.target.value)}>
                  <option value="" disabled>Choose</option>
                  {fixedAnswerOptions[selectedQuestionType].map((answer) => <option key={answer}>{answer}</option>)}
                </select>
              </div>
            </>
          )}

          {selectedQuestionType === "Fill in the Blank" && (
            <>
              <div className="form-field full-width">
                <label htmlFor="question-text-answer">Answer</label>
                <input id="question-text-answer" name="answer" defaultValue={typeof initialDetails.answer === "string" ? initialDetails.answer : ""} />
              </div>
              <div className="fill-blank-flags">
                <div className="form-field">
                  <label htmlFor="question-ignore-case">Ignore Case</label>
                  <select id="question-ignore-case" name="ignore_case" defaultValue={String(initialDetails.ignore_case ?? "Yes")}>
                    <option>Yes</option>
                    <option>No</option>
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="question-is-numeric">Is Numeric</label>
                  <select id="question-is-numeric" name="is_numeric" defaultValue={String(initialDetails.is_numeric ?? "No")}>
                    <option>Yes</option>
                    <option>No</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {fixedAnswerOptions[selectedQuestionType] && !usesAnswerButtons && (
            <div className="form-field answer-field">
                <label htmlFor="question-fixed-answer">Answer</label>
                <select id="question-fixed-answer" name="answer" defaultValue={typeof initialDetails.answer === "string" ? initialDetails.answer : ""}>
                  <option value="" disabled>Choose</option>
                  {fixedAnswerOptions[selectedQuestionType].map((answer) => <option key={answer}>{answer}</option>)}
                </select>
            </div>
          )}

          <div className="question-metadata-grid">
            <div className="form-field"><label htmlFor="question-category">Category</label><select id="question-category" value={selectedCategory} onChange={(event) => { setSelectedCategory(event.target.value); setSelectedSubCategory(""); setSelectedTopic(""); }} disabled={loadingOptions}><option value="" disabled>Choose</option>{categories.map((item) => <option key={item.id} value={item.q_category}>{item.q_category}</option>)}</select></div>
            <div className="form-field"><label htmlFor="question-sub-category">Sub-Category</label><select id="question-sub-category" value={selectedSubCategory} onChange={(event) => { setSelectedSubCategory(event.target.value); setSelectedTopic(""); }} disabled={loadingOptions || !selectedCategory}><option value="" disabled>Choose</option>{filteredSubCategories.map((item) => <option key={item.id} value={item.q_s_category}>{item.q_s_category}</option>)}</select></div>
            <div className="form-field"><label htmlFor="question-topic">Topic</label><select id="question-topic" value={selectedTopic} onChange={(event) => setSelectedTopic(event.target.value)} disabled={loadingOptions || !selectedSubCategory}><option value="" disabled>Choose</option>{filteredTopics.map((item) => <option key={item.id} value={item.topic}>{item.topic}</option>)}</select></div>
            <div className="form-field"><label htmlFor="question-difficulty">Difficulty Level</label><select id="question-difficulty" name="difficulty_level" defaultValue={initialQuestion?.difficulty_level ?? ""} disabled={loadingOptions}><option value="" disabled>Choose</option>{difficultyLevels.map((item) => <option key={item.id}>{item.Difficulty_level}</option>)}</select></div>
            <div className="form-field"><label htmlFor="question-language">Language</label><select id="question-language" name="language" defaultValue={initialQuestion?.language ?? ""} disabled={loadingOptions}><option value="" disabled>Choose</option>{languages.map((item) => <option key={item.id}>{item.q_language}</option>)}</select></div>
            <div className="form-field"><label htmlFor="question-reference">Reference (optional)</label><input id="question-reference" name="reference" defaultValue={String(initialDetails.reference ?? "")} /></div>
          </div>

          {saveError && <p className="word-limit-error" role="alert">{saveError}</p>}
          <div className="form-actions">
            <button className="form-cancel-button" type="button" onClick={onClose}>Close</button>
            <button className="form-save-button" type="submit" disabled={saving}>{saving ? "Saving..." : initialQuestion ? "Update" : "Save"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function QuestionUploadForm({ onClose, onUploaded }: { onClose: () => void; onUploaded: (questions: QuestionRecord[]) => void }) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const headers = ["Question Type", "Question", "Category", "Sub-Category", "Topic", "Difficulty Level", "Language", "Details JSON"];

  const downloadTemplate = () => {
    const exampleDetails = JSON.stringify({ answer: "A", options: ["Option A", "Option B", "", "", ""], randomize_options: "Yes" });
    const csv = Papa.unparse([headers, ["Single Choice", "Example question?", "", "", "", "", "", exampleDetails]]);
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "question-upload-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const readFile = async (file: File) => {
    setFileName(file.name);
    setRows([]);
    setError("");
    setSuccess("");
    setParsing(true);
    try {
      let fileHeaders: string[];
      let parsedRows: Record<string, unknown>[];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const parsed = Papa.parse<Record<string, string>>(await file.text(), {
          header: true,
          skipEmptyLines: "greedy",
          transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
        });
        if (parsed.errors.length > 0) throw new Error(parsed.errors[0].message);
        fileHeaders = parsed.meta.fields ?? [];
        parsedRows = parsed.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
      } else if (file.name.toLowerCase().endsWith(".xlsx")) {
        const workbookSheets = await readXlsxFile(file);
        const sheetRows = workbookSheets[0]?.data;
        if (!sheetRows) throw new Error("The selected file has no worksheet.");
        const [headerRow = [], ...dataRows] = sheetRows;
        const toCellString = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").trim();
        fileHeaders = headerRow.map(toCellString).filter(Boolean);
        parsedRows = dataRows
          .filter((row) => row.some((value) => String(value ?? "").trim()))
          .map((row) => Object.fromEntries(fileHeaders.map((header, index) => [header, toCellString(row[index])])));
      } else {
        throw new Error("Choose a CSV or XLSX file. Legacy XLS files are not supported.");
      }

      const missingHeaders = headers.filter((header) => !fileHeaders.includes(header));
      if (missingHeaders.length > 0) throw new Error(`Missing columns: ${missingHeaders.join(", ")}. Download the template and keep its column names.`);
      if (parsedRows.length === 0) throw new Error("The selected file contains no question rows.");
      if (parsedRows.length > 1000) throw new Error("Upload a maximum of 1000 questions at a time.");
      for (const [index, row] of parsedRows.entries()) {
        const detailsText = String(row["Details JSON"] ?? "").trim();
        if (detailsText) {
          try {
            const details: unknown = JSON.parse(detailsText);
            if (!details || typeof details !== "object" || Array.isArray(details)) throw new Error();
          } catch {
            throw new Error(`Row ${index + 2}: Details JSON must be a valid JSON object.`);
          }
        }
      }
      setRows(parsedRows);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Unable to read this file.");
    } finally {
      setParsing(false);
    }
  };

  const uploadQuestions = async () => {
    if (rows.length === 0) return;
    setUploading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: rows.map((row) => ({
            question_type: String(row["Question Type"] ?? "").trim(),
            question: String(row.Question ?? "").trim(),
            category: String(row.Category ?? "").trim(),
            sub_category: String(row["Sub-Category"] ?? "").trim(),
            topic: String(row.Topic ?? "").trim(),
            difficulty_level: String(row["Difficulty Level"] ?? "").trim(),
            language: String(row.Language ?? "").trim(),
            details: String(row["Details JSON"] ?? "").trim() || "{}",
          })),
        }),
      });
      const result = await response.json() as { imported?: number; questions?: QuestionRecord[]; error?: string; row_errors?: string[] };
      if (!response.ok) {
        const rowErrors = result.row_errors?.slice(0, 5).join(" ");
        const remainingErrors = result.row_errors && result.row_errors.length > 5 ? `${result.row_errors.length - 5} more row errors.` : "";
        throw new Error([result.error ?? "Unable to import questions", rowErrors, remainingErrors].filter(Boolean).join(" "));
      }
      setSuccess(`${result.imported ?? rows.length} questions uploaded successfully.`);
      onUploaded(result.questions ?? []);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload questions.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation">
      <section className="bulk-upload-form" role="dialog" aria-modal="true" aria-labelledby="question-upload-title">
        <div className="bulk-upload-header">
          <h1 id="question-upload-title">Upload Questions</h1>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close question upload form">×</button>
        </div>
        <div className="bulk-upload-content">
          <button className="download-sample-link" type="button" onClick={downloadTemplate}>Download Template</button>
          <div className="bulk-file-field">
            <label htmlFor="question-upload-file">File</label>
            <div className="file-picker">
              <label className="choose-file-button" htmlFor="question-upload-file">Choose File</label>
              <span>{fileName || "No file chosen"}</span>
              <input id="question-upload-file" type="file" accept=".csv,.xlsx" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
              }} />
            </div>
          </div>
          {parsing && <p role="status">Reading spreadsheet...</p>}
          {rows.length > 0 && !parsing && <p role="status">{rows.length} question rows ready to upload.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {success && <p className="login-settings-success" role="status">{success}</p>}
        </div>
        <div className="bulk-upload-actions">
          <button className="form-cancel-button" type="button" onClick={onClose}>Close</button>
          <button className="form-save-button" type="button" onClick={uploadQuestions} disabled={!fileName || rows.length === 0 || parsing || uploading}>{uploading ? "Uploading..." : "Upload"}</button>
        </div>
      </section>
    </div>
  );
}

function QuestionsPanel({ currentRole }: { currentRole?: any }) {
  const canCreate = hasRolePermission(currentRole, "Questions", "create");
  const canEdit = hasRolePermission(currentRole, "Questions", "edit");
  const canDelete = hasRolePermission(currentRole, "Questions", "delete");
  const canStatus = hasRolePermission(currentRole, "Questions", "status");
  const [showQuestionUpload, setShowQuestionUpload] = useState(false);
  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuestionRecord | null>(null);
  const [questions, setQuestions] = useState<QuestionRecord[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  const [questionLoadError, setQuestionLoadError] = useState("");
  const [questionStatusError, setQuestionStatusError] = useState("");
  const [updatingQuestionStatuses, setUpdatingQuestionStatuses] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/questions")
      .then(async (response) => {
        const data = await response.json() as QuestionRecord[] & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load questions");
        if (!cancelled) setQuestions(data);
      })
      .catch((error) => {
        if (!cancelled) setQuestionLoadError(error instanceof Error ? error.message : "Unable to load questions");
      })
      .finally(() => {
        if (!cancelled) setLoadingQuestions(false);
      });
    return () => { cancelled = true; };
  }, []);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredQuestions = questions.filter((question) => [
    question.question_type,
    question.category,
    question.sub_category,
    question.topic,
    question.difficulty_level,
    question.language,
    question.question,
    question.status ? "active" : "inactive",
    new Date(question.created_at).toLocaleString(),
  ].some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch)));
  const totalPages = Math.max(1, Math.ceil(filteredQuestions.length / pageSize));
  const visibleQuestions = filteredQuestions.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstVisibleEntry = filteredQuestions.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastVisibleEntry = Math.min(currentPage * pageSize, filteredQuestions.length);

  const toggleQuestionStatus = async (question: QuestionRecord) => {
    setUpdatingQuestionStatuses((current) => [...current, question.id]);
    setQuestionStatusError("");
    try {
      const response = await fetch("/api/questions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: question.id, status: !question.status }),
      });
      const result = await response.json() as QuestionRecord & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to update question status");
      setQuestions((current) => current.map((item) => item.id === result.id ? result : item));
    } catch (statusError) {
      setQuestionStatusError(statusError instanceof Error ? statusError.message : "Unable to update question status");
    } finally {
      setUpdatingQuestionStatuses((current) => current.filter((id) => id !== question.id));
    }
  };

  const deleteQuestion = async (question: QuestionRecord) => {
    if (!window.confirm("Delete this question?")) return;
    try {
      const response = await fetch("/api/questions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: question.id }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to delete question");
      setQuestions((current) => current.filter((item) => item.id !== question.id));
      setQuestionLoadError("");
      setCurrentPage((page) => Math.min(page, Math.max(1, Math.ceil((questions.length - 1) / pageSize))));
    } catch (deleteError) {
      setQuestionLoadError(deleteError instanceof Error ? deleteError.message : "Unable to delete question");
    }
  };

  return (
    <section className="candidates-section questions-section" id="questions">
      <h1>Questions</h1>
      <div className="candidates-panel">
        <div className="candidates-actions">
          {canCreate && <button className="candidate-action-button" type="button" onClick={() => setShowQuestionUpload(true)}>
            <span aria-hidden="true">↥</span> Upload
          </button>}
          {canCreate && (
            <button className="candidate-action-button" type="button" onClick={() => { setEditingQuestion(null); setShowAddQuestion(true); }}>
              <span aria-hidden="true">+</span> Add new
            </button>
          )}
        </div>
        <div className="candidate-table-toolbar">
          <label className="entries-control" htmlFor="questions-page-size">
            Show
            <select id="questions-page-size" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setCurrentPage(1); }}>
              {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
            entries
          </label>
          <label className="search-control" htmlFor="questions-search">
            Search:
            <input id="questions-search" value={search} onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }} />
          </label>
        </div>
        {questionStatusError && <p className="form-error" role="alert">{questionStatusError}</p>}
        <div className="candidate-table-wrapper">
          <table className="candidate-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Category</th>
                <th>Sub-Category</th>
                <th>Topic</th>
                <th>Difficulty Level</th>
                <th>Language</th>
                <th>Question</th>
                <th>Status</th>
                <th>Created On</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loadingQuestions ? (
                <tr><td colSpan={10}>Loading questions...</td></tr>
              ) : questionLoadError ? (
                <tr><td colSpan={10}>{questionLoadError}</td></tr>
              ) : visibleQuestions.length > 0 ? visibleQuestions.map((question) => (
                <tr key={question.id}>
                  <td>{question.question_type}</td>
                  <td>{question.category ?? "-"}</td>
                  <td>{question.sub_category ?? "-"}</td>
                  <td>{question.topic ?? "-"}</td>
                  <td>{question.difficulty_level ?? "-"}</td>
                  <td>{question.language ?? "-"}</td>
                  <td>{question.question}</td>
                  <td>
                    {canStatus ? (
                      <button
                        className={`question-status-toggle${question.status ? " is-active" : ""}`}
                        type="button"
                        role="switch"
                        aria-checked={question.status}
                        aria-label={`${question.status ? "Deactivate" : "Activate"} question`}
                        title={`Click to ${question.status ? "deactivate" : "activate"} this question`}
                        disabled={updatingQuestionStatuses.includes(question.id)}
                        onClick={() => toggleQuestionStatus(question)}
                      >
                        <span className="question-status-track" aria-hidden="true"><span /></span>
                        <span>{question.status ? "Active" : "Inactive"}</span>
                      </button>
                    ) : (
                      question.status ? "Active" : "Inactive"
                    )}
                  </td>
                  <td>{new Date(question.created_at).toLocaleString()}</td>
                  <td>
                    <div className="category-actions">
                      {canEdit && <button className="category-edit-button" type="button" onClick={() => { setEditingQuestion(question); setShowAddQuestion(true); }}>Update</button>}
                      {canDelete && <button className="category-delete-button" type="button" onClick={() => deleteQuestion(question).catch(() => undefined)}>Delete</button>}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={10}>{normalizedSearch ? "No questions match your search." : "No questions available."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="candidate-table-footer">
          <span>Showing {firstVisibleEntry} to {lastVisibleEntry} of {filteredQuestions.length} entries</span>
          <div>
            <button type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>Previous</button>
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>Next</button>
          </div>
        </div>
      </div>
      {showQuestionUpload && <QuestionUploadForm
        onClose={() => setShowQuestionUpload(false)}
        onUploaded={(uploadedQuestions) => {
          setQuestions((current) => [...uploadedQuestions, ...current]);
          setSearch("");
          setCurrentPage(1);
          setShowQuestionUpload(false);
        }}
      />}
      {showAddQuestion && <AddQuestionForm
        initialQuestion={editingQuestion ?? undefined}
        onClose={() => { setShowAddQuestion(false); setEditingQuestion(null); }}
        onSaved={(question) => {
          setQuestions((current) => current.some((item) => item.id === question.id)
            ? current.map((item) => item.id === question.id ? question : item)
            : [question, ...current]);
          setSearch("");
          setCurrentPage(1);
          setShowAddQuestion(false);
          setEditingQuestion(null);
        }}
      />}
    </section>
  );
}

const AUTH_STORAGE_KEY = "ums_exam_user";

const hasRolePermission = (role: any, sectionId: string, action: "view" | "create" | "edit" | "delete" | "status") => {
  if (!role) return false;
  if (role.administrator_access) return true;

  const permission = role.permissions?.[sectionId];
  if (!permission) return false;

  return Number(permission[action] || 0) === 1;
};

function LoginPage({ onLogin, onStudentLogin }: { onLogin: (user: any) => void; onStudentLogin: (student: any) => void }) {
  const [portal, setPortal] = useState<"choose" | "organization" | "student">("choose");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/users/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.user) {
        throw new Error(payload.error || "Login failed.");
      }

      onLogin(payload.user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Unable to login.");
    } finally {
      setLoading(false);
    }
  };

  const handleStudentSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/candidates/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, dateOfBirth }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.student) {
        throw new Error(payload.error || "Student login failed.");
      }
      onStudentLogin(payload.student);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Unable to login.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell portal-login-shell">
      <div className={`login-card portal-login-card${portal === "choose" ? " portal-choice-card" : ""}`}>
        <div className="login-brand">
          <span className="portal-crest" aria-hidden="true">
            <svg viewBox="0 0 48 56" fill="none">
              <path d="M24 2 44 9v17c0 12-8.5 21-20 28C12.5 47 4 38 4 26V9L24 2Z" fill="#fff" stroke="currentColor" strokeWidth="2.5" />
              <path d="M15 16v12c0 5.2 3.4 8.5 9 8.5s9-3.3 9-8.5V16" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              <path d="M11 42c3.6 3.3 8 5.8 13 8 5-2.2 9.4-4.7 13-8" stroke="#c68b3c" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </span>
          <span className="brand-name">ums<span>.</span>exam</span>
        </div>

        {portal === "choose" ? (
          <>
            <h1>Login As</h1>
            <div className="portal-choice-grid">
              <button className="portal-choice-button" type="button" onClick={() => { setPortal("organization"); setError(""); }}>
                <svg aria-hidden="true" viewBox="0 0 40 40" fill="none">
                  <circle cx="14" cy="11" r="4" stroke="currentColor" strokeWidth="2.5" />
                  <circle cx="27" cy="13" r="3" stroke="currentColor" strokeWidth="2.5" />
                  <path d="M4 31v-2c0-4.4 4-7 10-7s10 2.6 10 7v2H4Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
                  <path d="M25 23c5.5-.7 10 1.5 10 5.5V31H27" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Organization</span>
              </button>
              <button className="portal-choice-button" type="button" onClick={() => { setPortal("student"); setError(""); }}>
                <svg aria-hidden="true" viewBox="0 0 40 40" fill="none">
                  <circle cx="20" cy="10" r="5" stroke="currentColor" strokeWidth="2.5" />
                  <path d="M8 34v-6c0-5.2 4.5-9 12-9s12 3.8 12 9v6H8Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
                  <path d="m17 21 3 4 3-4m-3 4v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Student</span>
              </button>
            </div>
          </>
        ) : portal === "organization" ? (
          <>
            <button className="portal-back-button" type="button" onClick={() => { setPortal("choose"); setError(""); }}>‹ <span>Back</span></button>
            <h1>Organization Login</h1>
            <p>Please sign in with your user email and password.</p>

            <form onSubmit={handleSubmit} className="login-form">
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="admin@eduexpoits.in"
                  autoComplete="email"
                  required
                />
              </label>

              <label>
                <span>Password</span>
                <div className="password-input-wrap">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter password"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>

              {error && <div className="login-error" role="alert">{error}</div>}

              <button type="submit" disabled={loading}>
                {loading ? "Signing in..." : "Login"}
              </button>
            </form>
          </>
        ) : (
          <>
            <button className="portal-back-button" type="button" onClick={() => { setPortal("choose"); setError(""); }}>‹ <span>Back</span></button>
            <h1>Student Login</h1>
            <p>Enter your candidate ID and date of birth.</p>

            <form onSubmit={handleStudentSubmit} className="login-form">
              <label>
                <span>Candidate ID</span>
                <input
                  type="text"
                  value={candidateId}
                  onChange={(event) => { setCandidateId(event.target.value); setError(""); }}
                  placeholder="Enter candidate ID"
                  autoComplete="username"
                  required
                />
              </label>

              <label>
                <span>Date of Birth</span>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(event) => { setDateOfBirth(event.target.value); setError(""); }}
                  autoComplete="bday"
                  required
                />
              </label>

              {error && <div className="login-error student-login-notice" role="status">{error}</div>}

              <button type="submit" disabled={loading}>{loading ? "Signing in..." : "Login"}</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

type StudentAssessment = {
  id: number;
  examination: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  total_time: number | null;
  last_login: number | null;
  total_questions: number;
  total_marks: number;
  has_submitted: boolean;
  exam_cam_permission_active: boolean;
};

function formatStudentExamDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

type StudentExamQuestion = {
  id: number;
  question_type: string;
  question: string;
  details: Record<string, unknown>;
  section: string;
  correct_mark: number;
};

type StudentExamSection = {
  name: string;
  questions: StudentExamQuestion[];
};

type StudentExamPayload = {
  assessment?: { id: number; name: string };
  started_at?: string;
  duration_seconds?: number | null;
  end_at?: string | null;
  sections?: StudentExamSection[];
  error?: string;
};

function StudentExamFlow({ student, assessment, onClose, onSubmitted }: {
  student: { id: number; name: string; candidateId: string; dateOfBirth: string };
  assessment: StudentAssessment;
  onClose: () => void;
  onSubmitted: (assessmentId: number) => void;
}) {
  const initialProctorCounts = {
    noFace: 0,
    okay: 0,
    multipleFaces: 0,
    personChanges: 0,
    motionEvents: 0,
    cameraBlocked: 0,
    tabChanges: 0,
    fullscreenDisabled: 0,
  };
  const [step, setStep] = useState<"camera" | "selfie" | "id-proof" | "loading" | "exam" | "finished">("camera");
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [liveFeedConsent, setLiveFeedConsent] = useState(false);
  const [remoteFeedStatus, setRemoteFeedStatus] = useState("Live view is available to authorized examination staff.");
  const [photo, setPhoto] = useState<string | null>(null);
  const [idPhoto, setIdPhoto] = useState<string | null>(null);
  const [examSections, setExamSections] = useState<StudentExamSection[]>([]);
  const [answers, setAnswers] = useState<Record<number, string | string[]>>({});
  const [activeQuestion, setActiveQuestion] = useState(0);
  const [examDeadline, setExamDeadline] = useState<number | null>(null);
  const [examStartedAt, setExamStartedAt] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [motionWarning, setMotionWarning] = useState("");
  const [switchAlertOpen, setSwitchAlertOpen] = useState(false);
  const [switchAlertMessage, setSwitchAlertMessage] = useState("A change in the browser tab has been identified.");
  const [faceDetectionStatus, setFaceDetectionStatus] = useState("Loading multiple-person detection…");
  const [telemetryStatus, setTelemetryStatus] = useState("Connecting live activity to the invigilator…");
  const [proctorCounts, setProctorCounts] = useState(initialProctorCounts);
  const proctorCountsRef = useRef(initialProctorCounts);
  const [submittedLocally, setSubmittedLocally] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const submissionPending = useRef(false);
  const deadlineSubmissionAttempted = useRef(false);
  const submitExamRef = useRef<() => void>(() => {});
  const videoRef = useRef<HTMLVideoElement>(null);
  const focusViolationAt = useRef(0);
  const multipleFaceFrames = useRef(0);
  const noFaceFrames = useRef(0);
  const faceState = useRef<"unknown" | "none" | "one" | "multiple">("unknown");
  const cameraBlocked = useRef(false);
  const proctorAlertAt = useRef(0);
  const candidateLivePeer = useRef<RTCPeerConnection | null>(null);
  const candidateLiveSessionId = useRef<string | null>(null);
  const candidateLiveSignalCursor = useRef(0);
  const candidateLivePollPending = useRef(false);

  const questions = examSections.flatMap((section) => section.questions);
  const question = questions[activeQuestion];
  const incrementProctorCount = useCallback((key: keyof typeof initialProctorCounts) => {
    const next = { ...proctorCountsRef.current, [key]: proctorCountsRef.current[key] + 1 };
    proctorCountsRef.current = next;
    setProctorCounts(next);
    return next[key];
  }, []);
  const openProctorAlert = useCallback((message: string, immediate = false) => {
    if (!immediate && Date.now() - proctorAlertAt.current < 8000) return;
    proctorAlertAt.current = Date.now();
    setSwitchAlertMessage(message);
    setSwitchAlertOpen(true);
  }, []);

  const publishProctorCounts = useCallback(async (counts: typeof initialProctorCounts, signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/candidates/student-exam/proctor", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: student.candidateId,
          dateOfBirth: student.dateOfBirth,
          assessmentId: assessment.id,
          counts,
        }),
        signal,
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to publish live monitoring counts.");
      setTelemetryStatus("Live counts are available in the authorized invigilation view.");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      console.error("Failed to publish student proctor counts", error);
      setTelemetryStatus(error instanceof Error ? error.message : "Unable to share live counts with your invigilator.");
    }
  }, [assessment.id, student.candidateId, student.dateOfBirth]);

  const submitExam = useCallback(async () => {
    if (submissionPending.current || submittedLocally) return;
    if (!photo || !idPhoto || !examStartedAt) {
      setSubmissionError("The check-in photos or exam start time are missing. Contact your administrator before leaving this page.");
      return;
    }
    submissionPending.current = true;
    setIsSubmitting(true);
    setSubmissionError("");
    try {
      const response = await fetch("/api/candidates/student-exam/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: student.candidateId,
          dateOfBirth: student.dateOfBirth,
          assessmentId: assessment.id,
          answers,
          selfiePhoto: photo,
          idPhoto,
          startedAt: examStartedAt,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to submit this assessment.");
      onSubmitted(assessment.id);
      setSubmittedLocally(true);
      setStep("finished");
    } catch (submitError) {
      console.error("Failed to submit student assessment", submitError);
      setSubmissionError(submitError instanceof Error ? submitError.message : "Unable to submit this assessment. Please try again.");
    } finally {
      submissionPending.current = false;
      setIsSubmitting(false);
    }
  }, [answers, assessment.id, examStartedAt, idPhoto, onSubmitted, photo, student.candidateId, student.dateOfBirth, submittedLocally]);
  useEffect(() => {
    submitExamRef.current = () => { void submitExam(); };
  }, [submitExam]);

  useEffect(() => {
    if (!assessment.exam_cam_permission_active || step !== "exam" || !cameraStream || !liveFeedConsent) return;
    let cancelled = false;
    let polling = false;
    let pollTimer = 0;
    const pendingIceCandidates: RTCIceCandidateInit[] = [];
    const baseBody = {
      side: "candidate",
      assessmentId: assessment.id,
      candidateRecordId: student.id,
      candidateId: student.candidateId,
      dateOfBirth: student.dateOfBirth,
    };

    const sendSignal = async (sessionId: string, messageType: "answer" | "ice" | "end", payload: object) => {
      const response = await fetch("/api/candidates/student-exam/live-feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...baseBody, action: "send", sessionId, messageType, payload }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to signal the live camera feed.");
    };

    const closePeer = (notify: boolean) => {
      const peer = candidateLivePeer.current;
      const sessionId = candidateLiveSessionId.current;
      if (notify && sessionId) void sendSignal(sessionId, "end", {}).catch((error) => console.error("Unable to close candidate live-feed session", error));
      peer?.close();
      candidateLivePeer.current = null;
      candidateLiveSessionId.current = null;
      candidateLiveSignalCursor.current = 0;
      candidateLivePollPending.current = false;
    };

    const pollSignals = async () => {
      if (cancelled || polling || candidateLivePollPending.current) return;
      polling = true;
      candidateLivePollPending.current = true;
      try {
        const currentSessionId = candidateLiveSessionId.current;
        const response = await fetch("/api/candidates/student-exam/live-feed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...baseBody,
            action: "poll",
            sessionId: currentSessionId,
            afterId: currentSessionId ? candidateLiveSignalCursor.current : 0,
          }),
        });
        const result = await response.json() as {
          sessionId: string | null;
          signals: Array<{ id: string | number; message_type: string; payload: RTCSessionDescriptionInit | RTCIceCandidateInit }>;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Unable to check for a live camera request.");
        if (cancelled) return;
        if (result.sessionId !== candidateLiveSessionId.current) {
          const hadActiveSession = Boolean(candidateLiveSessionId.current);
          closePeer(false);
          if (result.sessionId) {
            candidateLiveSessionId.current = result.sessionId;
            setRemoteFeedStatus("An authorized staff member requested a live camera view.");
          } else if (hadActiveSession) {
            setRemoteFeedStatus("The live camera view has ended or expired.");
          }
        }
        for (const signal of result.signals ?? []) {
          const id = Number(signal.id);
          if (Number.isSafeInteger(id)) candidateLiveSignalCursor.current = Math.max(candidateLiveSignalCursor.current, id);
          if (signal.message_type === "offer") {
            const offer = signal.payload as RTCSessionDescriptionInit;
            const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
            candidateLivePeer.current = peer;
            cameraStream.getTracks().forEach((track) => peer.addTrack(track, cameraStream));
            peer.onicecandidate = (event) => {
              if (event.candidate && candidateLiveSessionId.current) {
                void sendSignal(candidateLiveSessionId.current, "ice", event.candidate.toJSON())
                  .catch((error) => console.error("Unable to send candidate ICE information", error));
              }
            };
            peer.onconnectionstatechange = () => {
              if (peer.connectionState === "connected") setRemoteFeedStatus("Live camera view connected to authorized examination staff.");
              if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
                setRemoteFeedStatus("Live camera view disconnected. The camera is not being recorded.");
              }
            };
            await peer.setRemoteDescription(offer);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            const activeSessionId = candidateLiveSessionId.current;
            if (!activeSessionId) throw new Error("The live-feed session ended before the candidate could answer.");
            await sendSignal(activeSessionId, "answer", { type: answer.type, sdp: answer.sdp });
            for (const candidate of pendingIceCandidates.splice(0)) await peer.addIceCandidate(candidate);
          } else if (signal.message_type === "ice") {
            const candidate = signal.payload as RTCIceCandidateInit;
            if (candidateLivePeer.current?.remoteDescription) {
              await candidateLivePeer.current.addIceCandidate(candidate);
            } else {
              pendingIceCandidates.push(candidate);
            }
          } else if (signal.message_type === "end") {
            closePeer(false);
            pendingIceCandidates.length = 0;
            setRemoteFeedStatus("The live camera view has ended.");
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Unable to process candidate live-feed request", error);
          setRemoteFeedStatus(error instanceof Error ? error.message : "Unable to check live camera requests.");
        }
      } finally {
        polling = false;
        candidateLivePollPending.current = false;
      }
    };

    void pollSignals();
    pollTimer = window.setInterval(() => void pollSignals(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      closePeer(true);
    };
  }, [assessment.exam_cam_permission_active, assessment.id, cameraStream, liveFeedConsent, step, student.candidateId, student.dateOfBirth, student.id]);

  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
      void videoRef.current.play().catch(() => {
        setCameraError("The camera preview could not start. Check browser camera permissions and try again.");
      });
    }
  }, [cameraStream, step]);

  useEffect(() => () => {
    cameraStream?.getTracks().forEach((track) => track.stop());
  }, [cameraStream]);

  useEffect(() => {
    if (!assessment.exam_cam_permission_active || step !== "exam" || !cameraStream) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let previousFrame: Uint8ClampedArray | null = null;
    let warningTimeout = 0;
    let motionActive = false;
    let motionQuietFrames = 0;
    const monitor = window.setInterval(() => {
      if (video && context && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        canvas.width = 160;
        canvas.height = Math.max(1, Math.round(160 * video.videoHeight / video.videoWidth));
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let changed = 0;
        let sampled = 0;
        for (let index = 0; index < frame.length; index += 4 * 8) {
          const gray = (frame[index] + frame[index + 1] + frame[index + 2]) / 3;
          if (previousFrame && Math.abs(gray - previousFrame[index / 4]) > 34) changed += 1;
          previousFrame ??= new Uint8ClampedArray(canvas.width * canvas.height);
          previousFrame[index / 4] = gray;
          sampled += 1;
        }
        if (sampled > 0 && changed / sampled > 0.24) {
          motionQuietFrames = 0;
          if (!motionActive) {
            motionActive = true;
            const count = incrementProctorCount("motionEvents");
            const message = `Significant camera-frame movement detected (${count}). Please remain in view and keep still.`;
            setMotionWarning(message);
            openProctorAlert(message, true);
            window.clearTimeout(warningTimeout);
            warningTimeout = window.setTimeout(() => {
              setMotionWarning((current) => current === message ? "" : current);
            }, 6000);
          }
        } else if (motionActive) {
          motionQuietFrames += 1;
          if (motionQuietFrames >= 2) motionActive = false;
        }
      }
    }, 900);
    const tracks = cameraStream.getVideoTracks();
    const onCameraBlocked = () => {
      if (cameraBlocked.current) return;
      cameraBlocked.current = true;
      incrementProctorCount("cameraBlocked");
      openProctorAlert("Camera blocked or disconnected. Reconnect your camera to continue the examination.");
      setMotionWarning("Camera connection was interrupted. Reconnect the camera before continuing.");
    };
    const onCameraRestored = () => { cameraBlocked.current = false; };
    tracks.forEach((track) => {
      track.addEventListener("ended", onCameraBlocked);
      track.addEventListener("mute", onCameraBlocked);
      track.addEventListener("unmute", onCameraRestored);
    });
    return () => {
      window.clearInterval(monitor);
      window.clearTimeout(warningTimeout);
      tracks.forEach((track) => {
        track.removeEventListener("ended", onCameraBlocked);
        track.removeEventListener("mute", onCameraBlocked);
        track.removeEventListener("unmute", onCameraRestored);
      });
    };
  }, [assessment.exam_cam_permission_active, cameraStream, incrementProctorCount, openProctorAlert, step]);

  useEffect(() => {
    if (!assessment.exam_cam_permission_active || step !== "exam") return;
    const controller = new AbortController();
    const publish = () => void publishProctorCounts(proctorCountsRef.current, controller.signal);
    const interval = window.setInterval(publish, 5000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [assessment.exam_cam_permission_active, publishProctorCounts, step]);

  useEffect(() => {
    if (!assessment.exam_cam_permission_active || step !== "exam") return;
    const timeout = window.setTimeout(() => {
      void publishProctorCounts(proctorCounts);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [assessment.exam_cam_permission_active, proctorCounts, publishProctorCounts, step]);

  useEffect(() => {
    if (!assessment.exam_cam_permission_active || step !== "exam" || !cameraStream) return;
    let cancelled = false;
    let detector: import("@mediapipe/tasks-vision").FaceDetector | null = null;
    let timeout = 0;
    const referenceDescriptors: Float32Array[] = [];
    let identityMismatchFrames = 0;
    let personChangeActive = false;
    const identityCanvas = document.createElement("canvas");
    identityCanvas.width = 16;
    identityCanvas.height = 16;
    const identityContext = identityCanvas.getContext("2d", { willReadFrequently: true });

    const createFaceDescriptor = (
      source: CanvasImageSource,
      sourceWidth: number,
      sourceHeight: number,
      bounds: { originX: number; originY: number; width: number; height: number } | undefined,
    ) => {
      if (!identityContext || !bounds || sourceWidth <= 0 || sourceHeight <= 0) return null;
      const side = Math.max(bounds.width, bounds.height) * 1.18;
      const centerX = bounds.originX + bounds.width / 2;
      const centerY = bounds.originY + bounds.height / 2;
      const left = Math.max(0, centerX - side / 2);
      const top = Math.max(0, centerY - side / 2);
      const right = Math.min(sourceWidth, centerX + side / 2);
      const bottom = Math.min(sourceHeight, centerY + side / 2);
      if (right <= left || bottom <= top) return null;

      identityContext.clearRect(0, 0, identityCanvas.width, identityCanvas.height);
      identityContext.drawImage(source, left, top, right - left, bottom - top, 0, 0, identityCanvas.width, identityCanvas.height);
      const pixels = identityContext.getImageData(0, 0, identityCanvas.width, identityCanvas.height).data;
      const grayscale = new Float32Array(identityCanvas.width * identityCanvas.height);
      let mean = 0;
      for (let index = 0; index < grayscale.length; index += 1) {
        const pixelIndex = index * 4;
        const value = pixels[pixelIndex] * 0.299 + pixels[pixelIndex + 1] * 0.587 + pixels[pixelIndex + 2] * 0.114;
        grayscale[index] = value;
        mean += value;
      }
      mean /= grayscale.length;
      let variance = 0;
      for (const value of grayscale) variance += (value - mean) ** 2;
      const standardDeviation = Math.sqrt(variance / grayscale.length);
      if (standardDeviation < 12) return null;
      return grayscale.map((value) => (value - mean) / standardDeviation);
    };

    async function startFaceDetection() {
      try {
        const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm",
        );
        const faceDetector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.6,
        });
        if (cancelled) {
          faceDetector.close();
          return;
        }
        detector = faceDetector;
        for (const checkInPhoto of [photo, idPhoto]) {
          if (!checkInPhoto) continue;
          try {
            const image = new Image();
            image.src = checkInPhoto;
            await image.decode();
            const referenceFace = faceDetector.detect(image).detections
              .filter((detection) => detection.boundingBox)
              .sort((first, second) => {
                const firstBox = first.boundingBox!;
                const secondBox = second.boundingBox!;
                return secondBox.width * secondBox.height - firstBox.width * firstBox.height;
              })[0];
            if (referenceFace?.boundingBox) {
              const descriptor = createFaceDescriptor(
                image,
                image.naturalWidth,
                image.naturalHeight,
                referenceFace.boundingBox,
              );
              if (descriptor) referenceDescriptors.push(descriptor);
            }
          } catch (error) {
            console.error("Unable to analyze a candidate check-in photo", error);
          }
        }
        if (cancelled) {
          faceDetector.close();
          detector = null;
          return;
        }
        setFaceDetectionStatus(referenceDescriptors.length
          ? "Face and check-in photo comparison active · analyzed on this device"
          : "Face-count checks active; check-in photo comparison is unavailable");

        const inspectFrame = () => {
          if (cancelled) return;
          const video = videoRef.current;
          if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && detector) {
            try {
              const result = detector.detectForVideo(video, performance.now());
              const faceCount = result.detections.length;
              if (faceCount === 1 && referenceDescriptors.length > 0) {
                const detection = result.detections[0];
                const currentDescriptor = detection.boundingBox
                  ? createFaceDescriptor(video, video.videoWidth, video.videoHeight, detection.boundingBox)
                  : null;
                if (currentDescriptor) {
                  let closestDifference = Number.POSITIVE_INFINITY;
                  for (const referenceDescriptor of referenceDescriptors) {
                    let difference = 0;
                    for (let index = 0; index < referenceDescriptor.length; index += 1) {
                      difference += Math.abs(referenceDescriptor[index] - currentDescriptor[index]);
                    }
                    closestDifference = Math.min(closestDifference, difference / referenceDescriptor.length);
                  }
                  if (closestDifference > 0.82) {
                    identityMismatchFrames += 1;
                    if (identityMismatchFrames >= 2 && !personChangeActive) {
                      personChangeActive = true;
                      const count = incrementProctorCount("personChanges");
                      const message = `The person on camera does not appear to match the check-in photos (${count}). Please show your face clearly.`;
                      setMotionWarning(message);
                      openProctorAlert(message, true);
                    }
                  } else {
                    identityMismatchFrames = 0;
                    personChangeActive = false;
                  }
                }
              } else if (faceCount !== 1) {
                identityMismatchFrames = 0;
                personChangeActive = false;
              }
              if (faceCount > 1) {
                multipleFaceFrames.current += 1;
                noFaceFrames.current = 0;
                if (multipleFaceFrames.current >= 3 && faceState.current !== "multiple") {
                  faceState.current = "multiple";
                  incrementProctorCount("multipleFaces");
                  openProctorAlert("Multiple Face Detected. Only the student taking the examination should be visible.");
                }
              } else if (faceCount === 1) {
                multipleFaceFrames.current = 0;
                noFaceFrames.current = 0;
                if (faceState.current !== "one") {
                  faceState.current = "one";
                  incrementProctorCount("okay");
                }
              } else {
                multipleFaceFrames.current = 0;
                noFaceFrames.current += 1;
                if (noFaceFrames.current >= 3 && faceState.current !== "none") {
                  faceState.current = "none";
                  incrementProctorCount("noFace");
                  openProctorAlert("No Face Detected. Please make sure your face is clearly visible in the camera.");
                }
              }
            } catch (error) {
              console.error("Unable to analyze the live camera frame for multiple faces", error);
              setFaceDetectionStatus("Multiple-person detection stopped because camera analysis failed.");
              cancelled = true;
              detector.close();
              detector = null;
              return;
            }
          }
          timeout = window.setTimeout(inspectFrame, 900);
        };
        inspectFrame();
      } catch (error) {
        if (!cancelled) {
          console.error("Unable to initialize in-browser face detection", error);
          setFaceDetectionStatus("Face detection is unavailable. Check your internet connection and camera view.");
        }
      }
    }

    void startFaceDetection();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      detector?.close();
    };
  }, [assessment.exam_cam_permission_active, cameraStream, idPhoto, incrementProctorCount, openProctorAlert, photo, step]);

  useEffect(() => {
    if (step !== "exam") return;
    const recordFocusViolation = (type: "tabChanges" | "fullscreenDisabled", message: (count: number) => string) => {
      if (Date.now() - focusViolationAt.current < 1200) return;
      focusViolationAt.current = Date.now();
      const nextCount = incrementProctorCount(type);
      setMotionWarning(message(nextCount));
      openProctorAlert(type === "tabChanges"
        ? "A change in the browser tab has been identified."
        : "Full-Screen Mode disabled. Please return to full-screen mode to continue the examination.");
    };
    const warnAboutLeavingExam = () => {
      if (document.visibilityState !== "hidden") return;
      recordFocusViolation("tabChanges", (count) => `Exam page switch detected (${count}). Please stay on the examination page until time is complete.`);
    };
    const warnIfFullscreenEnds = () => {
      if (!document.fullscreenElement) {
        recordFocusViolation("fullscreenDisabled", (count) => `Full-screen exit detected (${count}). Return to the examination and stay until time is complete.`);
      }
    };
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("visibilitychange", warnAboutLeavingExam);
    document.addEventListener("fullscreenchange", warnIfFullscreenEnds);
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => {
      document.removeEventListener("visibilitychange", warnAboutLeavingExam);
      document.removeEventListener("fullscreenchange", warnIfFullscreenEnds);
      window.removeEventListener("beforeunload", warnBeforeLeaving);
    };
  }, [incrementProctorCount, openProctorAlert, step]);

  useEffect(() => {
    if (step !== "exam" || examDeadline === null) return;
    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((examDeadline - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0 && !deadlineSubmissionAttempted.current) {
        deadlineSubmissionAttempted.current = true;
        submitExamRef.current();
      }
    };
    updateRemaining();
    const interval = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(interval);
  }, [examDeadline, step]);

  useEffect(() => {
    if (step !== "finished") return;
    cameraStream?.getTracks().forEach((track) => track.stop());
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {
        setMotionWarning("Full-screen mode could not be closed automatically.");
      });
    }
  }, [cameraStream, step]);

  async function enableCamera() {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not available in this browser. Use a current browser over HTTPS or localhost.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      setCameraStream(stream);
      setStep("selfie");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setCameraError("Camera permission was denied. Allow camera access in your browser settings, then try again.");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setCameraError("No camera was found. Connect a camera and try again.");
      } else {
        setCameraError("Unable to start the camera. Check that it is connected and not being used by another application.");
      }
    }
  }

  function captureCameraPhoto() {
    const video = videoRef.current;
    if (!cameraStream || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) {
      setCameraError("Wait until the live camera preview is ready before taking the photo.");
      return null;
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("The photo could not be captured. Please try again.");
      return null;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.74);
  }

  async function continueFromIdProof() {
    const captured = captureCameraPhoto();
    if (!captured) return;
    setIdPhoto(captured);
    if (document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen().catch(() => {
        setMotionWarning("Full-screen mode could not be enabled. Keep the exam page active until the examination is complete.");
      });
    }
    setStep("loading");
    setCameraError("");
    try {
      const response = await fetch("/api/candidates/student-exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: student.candidateId,
          dateOfBirth: student.dateOfBirth,
          assessmentId: assessment.id,
        }),
      });
      const payload = await response.json() as StudentExamPayload;
      if (!response.ok) throw new Error(payload.error ?? "Unable to load this exam.");
      const sections = payload.sections ?? [];
      setExamSections(sections);
      setExamStartedAt(payload.started_at ?? new Date().toISOString());
      const deadlineCandidates = [
        typeof payload.duration_seconds === "number" && payload.duration_seconds > 0
          ? Date.now() + payload.duration_seconds * 1000
          : Number.POSITIVE_INFINITY,
        payload.end_at ? new Date(payload.end_at).getTime() : Number.POSITIVE_INFINITY,
      ].filter(Number.isFinite);
      setExamDeadline(deadlineCandidates.length ? Math.min(...deadlineCandidates) : null);
      if (!assessment.exam_cam_permission_active) {
        cameraStream?.getTracks().forEach((track) => track.stop());
        setCameraStream(null);
        setLiveFeedConsent(false);
      }
      setStep("exam");
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "Unable to load this exam.");
      setStep("id-proof");
    }
  }

  function setAnswer(questionId: number, value: string | string[]) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  const formattedTime = remainingSeconds === null
    ? "--:--"
    : `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`;
  const options = question && Array.isArray(question.details.options)
    ? question.details.options.filter((option): option is string => typeof option === "string")
    : [];
  const fallbackOptions: Record<string, string[]> = {
    "True/False": ["True", "False"],
    "Yes/No": ["Yes", "No"],
    "Agree/Disagree": ["Agree", "Disagree"],
    "Good/Bad": ["Good", "Bad"],
  };
  const questionOptions = options.length ? options : fallbackOptions[question?.question_type ?? ""] ?? [];
  const selectedAnswer = question ? answers[question.id] : undefined;

  return (
    <main className={`student-exam-flow${step === "exam" ? " is-taking-exam" : ""}`}>
      {step === "camera" || step === "selfie" || step === "id-proof" || step === "loading" ? (
        <section className="student-exam-gate" role="dialog" aria-modal="true" aria-labelledby="student-exam-gate-title">
          <div className="student-exam-gate-brand"><span aria-hidden="true">U</span><strong>ums.exam</strong></div>
          <div className="student-exam-gate-card">
            <div className="student-exam-gate-progress" aria-label="Exam verification progress">
              <span className={step !== "camera" ? "is-done" : "is-current"}>1</span><i />
              <span className={step === "id-proof" || step === "loading" ? "is-current" : ""}>2</span><i />
              <span>3</span>
            </div>
            {step === "camera" ? (
              <>
                <div className="student-exam-gate-icon" aria-hidden="true">◉</div>
                <p className="student-exam-eyebrow">BEFORE YOU BEGIN</p>
                <h1 id="student-exam-gate-title">Camera check</h1>
                <p className="student-exam-gate-copy">Allow camera access to take a selfie and a photo with your valid ID. Both check-in photos and your submitted answers will be stored so authorized administrators and evaluators can review your exam.</p>
                <ul className="student-exam-check-list">
                  <li>Use a well-lit, quiet space</li>
                  <li>Keep your face clearly visible</li>
                  <li>Have your valid photo ID ready</li>
                </ul>
                {assessment.exam_cam_permission_active ? (
                  <label className="student-exam-live-feed-consent">
                    <input type="checkbox" checked={liveFeedConsent} onChange={(event) => setLiveFeedConsent(event.target.checked)} />
                    <span>I consent to storing my check-in selfie, ID photo, and submitted answers for review by authorized administrators and assigned evaluators. An authorized administrator or assigned invigilator may also view my live camera; the live stream is not recorded and ends when the exam or feed ends.</span>
                  </label>
                ) : (
                  <p className="student-exam-camera-off-note">Exam camera monitoring is disabled. Camera access is used only to capture the two required check-in photos and is stopped before the exam begins.</p>
                )}
                <button className="student-exam-primary-button" type="button" onClick={enableCamera} disabled={assessment.exam_cam_permission_active && !liveFeedConsent}>
                  {assessment.exam_cam_permission_active ? "Enable camera and continue" : "Take check-in photos"}
                </button>
              </>
            ) : step === "loading" ? (
              <div className="student-exam-gate-loading" role="status"><span className="student-exam-spinner" /><h1 id="student-exam-gate-title">Preparing your exam</h1><p>Verifying your exam access and loading assigned questions…</p></div>
            ) : (
              <>
                <p className="student-exam-eyebrow">{step === "selfie" ? "STEP 1 OF 2 · SELFIE" : "STEP 2 OF 2 · ID CHECK"}</p>
                <h1 id="student-exam-gate-title">{step === "selfie" ? "Take a selfie" : "Show your valid ID"}</h1>
                <p className="student-exam-gate-copy">{step === "selfie" ? "Center your face in the frame and take a clear photo." : "Hold your valid photo ID beside your face. Make sure your photo and details are readable."}</p>
                <div className="student-exam-camera-preview">
                  <video ref={videoRef} autoPlay playsInline muted aria-label="Live camera preview" />
                  {assessment.exam_cam_permission_active && <span className="student-exam-camera-live"><i /> LIVE</span>}
                  {step === "id-proof" && photo && <img className="student-exam-selfie-thumb" src={photo} alt="Selfie captured for this local session" />}
                </div>
                {cameraError && <p className="student-exam-camera-error" role="alert">{cameraError}</p>}
                <div className="student-exam-gate-actions">
                  <button className="student-exam-secondary-button" type="button" onClick={onClose}>Cancel</button>
                  {step === "selfie" ? (
                    <button className="student-exam-primary-button" type="button" onClick={() => {
                      const captured = captureCameraPhoto();
                      if (captured) { setPhoto(captured); setCameraError(""); setStep("id-proof"); }
                    }}>Capture selfie</button>
                  ) : (
                    <button className="student-exam-primary-button" type="button" onClick={() => void continueFromIdProof()}>Capture ID photo and start exam</button>
                  )}
                </div>
              </>
            )}
            {step === "camera" && cameraError && <p className="student-exam-camera-error" role="alert">{cameraError}</p>}
            <p className="student-exam-privacy-note">
              No microphone is requested. Check-in photos are uploaded with your submitted exam and can be viewed by authorized examination staff. The ID image is not automatically verified.
              {!assessment.exam_cam_permission_active && " Camera access is stopped after the two photos are captured."}
            </p>
          </div>
          <button className="student-exam-gate-cancel" type="button" onClick={onClose}>Return to schedule</button>
        </section>
      ) : step === "finished" ? (
        <section className="student-exam-finished" role="dialog" aria-modal="true">
          <div className="student-exam-finished-icon" aria-hidden="true">✓</div>
          <p className="student-exam-eyebrow">{submittedLocally ? "EXAM COMPLETE" : "ASSESSMENT ENDED"}</p>
          <h1>{submittedLocally ? "Exam complete" : remainingSeconds === 0 ? "Time is up" : "Exam session ended"}</h1>
          <p>{submittedLocally ? "Your answers and check-in photos were submitted for evaluation." : remainingSeconds === 0 ? "Time expired. Your submission could not be saved; contact your administrator." : "The exam session ended without a successful submission. Contact your administrator."}</p>
          <button className="student-exam-primary-button" type="button" onClick={onClose}>Return to exam schedule</button>
        </section>
      ) : (
        <div className="student-exam-taking">
          <header className="student-exam-topbar">
            <div className="student-exam-wordmark"><span>U</span><strong>ums.exam</strong><i />{assessment.name}</div>
            <div className="student-exam-topbar-actions">
              <span className={`student-exam-timer${remainingSeconds !== null && remainingSeconds < 300 ? " is-low" : ""}`} aria-label="Time remaining">◷ {formattedTime}</span>
              <span className="student-exam-candidate-name">{student.name}</span>
            </div>
          </header>
          <div className="student-exam-workspace">
            <aside className="student-exam-question-nav">
              <div className="student-exam-nav-heading"><span>EXAM OVERVIEW</span><strong>{assessment.examination || "Examination"}</strong></div>
              <div className="student-exam-info-card">
                <h2>{assessment.name}</h2>
                <dl>
                  <div><dt>Candidate ID</dt><dd>{student.candidateId}</dd></div>
                  <div><dt>Duration</dt><dd>{assessment.total_time ? `${assessment.total_time} minutes` : "Until exam closes"}</dd></div>
                  <div><dt>Total questions</dt><dd>{questions.length}</dd></div>
                  <div><dt>Total marks</dt><dd>{assessment.total_marks}</dd></div>
                </dl>
              </div>
              <div className="student-exam-progress-summary">
                <span>Progress</span>
                <strong>{Object.keys(answers).length} / {questions.length} answered</strong>
                <div><i style={{ width: `${questions.length ? Object.keys(answers).length / questions.length * 100 : 0}%` }} /></div>
              </div>
              {examSections.map((section) => (
                <div className="student-exam-overview-section" key={section.name}>
                  <h2>{section.name}</h2>
                  <div className="student-exam-question-grid">
                    {section.questions.map((item) => {
                      const index = questions.findIndex((entry) => entry.id === item.id);
                      return <button key={item.id} type="button" disabled={index <= activeQuestion} className={`${index === activeQuestion ? "is-current" : ""}${answers[item.id] !== undefined ? " is-answered" : ""}`} onClick={() => setActiveQuestion(index)} aria-label={`Question ${index + 1}${answers[item.id] !== undefined ? ", answered" : ""}${index < activeQuestion ? ", already passed" : ""}`}>{index + 1}</button>;
                    })}
                  </div>
                </div>
              ))}
              {assessment.exam_cam_permission_active ? (
                <>
                  <div className="student-exam-camera-status">
                    <video ref={videoRef} autoPlay playsInline muted aria-label="Live camera preview; video is not being recorded" />
                    <span><i /> LIVE</span>
                  </div>
                  <div className="student-exam-proctor-checks" aria-label="Examination monitoring checks">
                    <div className={proctorCounts.noFace ? "has-violations" : ""}><span>No Face Detected</span><strong>{proctorCounts.noFace}</strong></div>
                    <div><span>OK · One Face</span><strong>{proctorCounts.okay}</strong></div>
                    <div className={proctorCounts.multipleFaces ? "has-violations" : ""}><span>Multiple Face Detected</span><strong>{proctorCounts.multipleFaces}</strong></div>
                    <div className={proctorCounts.personChanges ? "has-violations" : ""}><span>Person changed</span><strong>{proctorCounts.personChanges}</strong></div>
                    <div className={proctorCounts.motionEvents ? "has-violations" : ""}><span>Motion detected</span><strong>{proctorCounts.motionEvents}</strong></div>
                    <div className={proctorCounts.cameraBlocked ? "has-violations" : ""}><span>Camera blocked!</span><strong>{proctorCounts.cameraBlocked}</strong></div>
                    <div className={proctorCounts.tabChanges ? "has-violations" : ""}><span>Tab change detected!</span><strong>{proctorCounts.tabChanges}</strong></div>
                    <div className={proctorCounts.fullscreenDisabled ? "has-violations" : ""}><span>Full-Screen Mode disabled!</span><strong>{proctorCounts.fullscreenDisabled}</strong></div>
                  </div>
                  <p className="student-exam-focus-note">Stay on this page and keep one face visible until the exam ends.</p>
                  <p className={`student-exam-telemetry-status${telemetryStatus.startsWith("Unable") || telemetryStatus.includes("no invigilator") ? " has-error" : ""}`} role="status">{telemetryStatus}</p>
                  <p className="student-exam-live-feed-status" role="status">{remoteFeedStatus}</p>
                  <p className="student-exam-motion-disclaimer">{faceDetectionStatus}. Camera frames are analyzed in this browser; no video is recorded or uploaded. Microphone access is not requested.</p>
                </>
              ) : (
                <p className="student-exam-focus-note">Camera access is off. Only the two check-in photos were captured before the exam.</p>
              )}
            </aside>
            <section className="student-exam-question-area" aria-live="polite">
              <div className="student-exam-session-banner"><span>●</span> Your answers and check-in photos are saved when you submit the exam.</div>
              {motionWarning && <p className="student-exam-motion-warning" role="alert">⚠ {motionWarning}</p>}
              {submissionError && <p className="student-exam-motion-warning" role="alert">{submissionError}</p>}
              {questions.length === 0 ? (
                <div className="student-exam-no-questions"><h1>No questions are available</h1><p>No active questions match this assessment’s configured sections and classifications.</p><button className="student-exam-secondary-button" type="button" onClick={onClose}>Return to schedule</button></div>
              ) : question ? (
                <>
                  <div className="student-exam-question-meta"><span>{question.section}</span><span>Question {activeQuestion + 1} of {questions.length}</span><span>{question.question_type}</span></div>
                  {typeof question.details.passage === "string" && question.details.passage && <div className="student-exam-passage">{question.details.passage}</div>}
                  <article className="student-exam-question-card">
                    <div className="student-exam-question-title"><span>{String(activeQuestion + 1).padStart(2, "0")}</span><h1>{question.question}</h1></div>
                    {questionOptions.length > 0 ? (
                      <div className="student-exam-answer-options">
                        {questionOptions.map((option, index) => {
                          const multiple = question.question_type === "Multiple Choice";
                          const checked = multiple
                            ? Array.isArray(selectedAnswer) && selectedAnswer.includes(option)
                            : selectedAnswer === option;
                          return (
                            <label key={`${question.id}-${index}`} className={`student-exam-answer-option${checked ? " is-selected" : ""}`}>
                              <input
                                type={multiple ? "checkbox" : "radio"}
                                name={`answer-${question.id}`}
                                checked={checked}
                                onChange={() => {
                                  if (!multiple) setAnswer(question.id, option);
                                  else {
                                    const current = Array.isArray(selectedAnswer) ? selectedAnswer : [];
                                    setAnswer(question.id, checked ? current.filter((value) => value !== option) : [...current, option]);
                                  }
                                }}
                              />
                              <span className="student-exam-option-letter">{String.fromCharCode(65 + index)}</span><span>{option}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="student-exam-written-answer">
                        <label htmlFor={`answer-${question.id}`}>{question.question_type === "Fill in the Blank" ? "Your answer" : "Write your response"}</label>
                        {question.question_type === "Fill in the Blank" ? (
                          <input id={`answer-${question.id}`} value={typeof selectedAnswer === "string" ? selectedAnswer : ""} onChange={(event) => setAnswer(question.id, event.target.value)} />
                        ) : (
                          <textarea id={`answer-${question.id}`} value={typeof selectedAnswer === "string" ? selectedAnswer : ""} onChange={(event) => setAnswer(question.id, event.target.value)} rows={7} />
                        )}
                      </div>
                    )}
                  </article>
                  <div className="student-exam-question-controls">
                    <span>{Object.keys(answers).length} of {questions.length} answered</span>
                    {activeQuestion === questions.length - 1 || remainingSeconds === 0 || Boolean(submissionError)
                      ? <button className="student-exam-primary-button" type="button" onClick={() => void submitExam()} disabled={isSubmitting}>{isSubmitting ? "Submitting…" : submissionError ? "Retry submission" : "Submit Exam"}</button>
                      : <button className="student-exam-primary-button" type="button" onClick={() => setActiveQuestion((index) => Math.min(questions.length - 1, index + 1))}>Next question →</button>}
                  </div>
                </>
              ) : null}
            </section>
          </div>
          {switchAlertOpen && (
            <div className="student-exam-tab-alert-backdrop" role="presentation">
              <section className="student-exam-tab-alert" role="alertdialog" aria-modal="true" aria-labelledby="student-exam-tab-alert-title" aria-describedby="student-exam-tab-alert-message">
                <span className="student-exam-tab-alert-icon" aria-hidden="true">!</span>
                <h2 id="student-exam-tab-alert-title">Alert</h2>
                <p id="student-exam-tab-alert-message">{switchAlertMessage}</p>
                <button className="student-exam-primary-button" type="button" autoFocus onClick={() => setSwitchAlertOpen(false)}>OK</button>
              </section>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function StudentPortalDashboard({ student, onLogout }: { student: { id: number; name: string; candidateId: string; dateOfBirth: string }; onLogout: () => void }) {
  const [assessments, setAssessments] = useState<StudentAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [attendNotice, setAttendNotice] = useState("");
  const [activeAssessment, setActiveAssessment] = useState<StudentAssessment | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/candidates/student-dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: student.candidateId, dateOfBirth: student.dateOfBirth }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as {
          assessments?: StudentAssessment[];
          exam_cam_permission_active?: boolean;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "Unable to load exam schedule.");
        setAssessments((payload.assessments ?? []).map((assessment) => ({
          ...assessment,
          exam_cam_permission_active: payload.exam_cam_permission_active ?? true,
        })));
      })
      .catch((loadError) => {
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load exam schedule.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [student.candidateId, student.dateOfBirth]);

  if (activeAssessment) {
    return <StudentExamFlow
      student={student}
      assessment={activeAssessment}
      onClose={() => setActiveAssessment(null)}
      onSubmitted={(assessmentId) => {
        setAssessments((current) => current.map((assessment) =>
          assessment.id === assessmentId ? { ...assessment, has_submitted: true } : assessment,
        ));
      }}
    />;
  }

  return (
    <main className="student-dashboard-shell">
      <aside className="student-dashboard-sidebar" aria-label="Student navigation">
        <button className="student-sidebar-icon is-active" type="button" aria-label="Dashboard" title="Dashboard">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z" /></svg>
        </button>
        <button className="student-sidebar-icon" type="button" aria-label="Student portal" title="Student portal">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>
        </button>
        <span className="student-sidebar-divider" />
        <span className="student-sidebar-spacer" />
        <span className="student-sidebar-status" aria-hidden="true" />
        <button className="student-sidebar-icon" type="button" aria-label="Settings" title="Settings">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /><path d="m19.4 15 .1.1 1.2.9-1.2 2.1-1.4-.6a8 8 0 0 1-1.7 1l-.2 1.5h-2.4l-.3-1.5a8 8 0 0 1-1.7-1l-1.4.6-1.2-2.1 1.2-.9a7 7 0 0 1 0-2l-1.2-.9 1.2-2.1 1.4.6a8 8 0 0 1 1.7-1l.3-1.5h2.4l.2 1.5a8 8 0 0 1 1.7 1l1.4-.6 1.2 2.1-1.2.9a7 7 0 0 1 0 2Z" /></svg>
        </button>
      </aside>

      <div className="student-dashboard-main">
        <header className="student-dashboard-header">
          <a className="student-dashboard-brand" href="#" aria-label="ums.exam student dashboard">
            <span className="portal-crest" aria-hidden="true">
              <svg viewBox="0 0 48 56" fill="none">
                <path d="M24 2 44 9v17c0 12-8.5 21-20 28C12.5 47 4 38 4 26V9L24 2Z" fill="#fff" stroke="currentColor" strokeWidth="2.5" />
                <path d="M15 16v12c0 5.2 3.4 8.5 9 8.5s9-3.3 9-8.5V16" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                <path d="M11 42c3.6 3.3 8 5.8 13 8 5-2.2 9.4-4.7 13-8" stroke="#c68b3c" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </span>
            <span className="student-dashboard-brand-copy">
              <strong>INSTITUTE OF INTEGRATED</strong>
              <strong>TRAINING &amp; STUDIES</strong>
            </span>
          </a>
          <div className="student-dashboard-header-actions">
            <span className="student-dashboard-avatar" aria-hidden="true">{student.name.slice(0, 1).toUpperCase()}</span>
            <div className="student-dashboard-user">
              <strong>{student.name}</strong>
              <small>Student</small>
            </div>
            <button className="student-dashboard-logout" type="button" onClick={onLogout}>Log out</button>
          </div>
        </header>

        <nav className="student-dashboard-tabbar" aria-label="Current page">
          <span className="student-dashboard-current-tab">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z" /></svg>
            Dashboard
          </span>
        </nav>

        <section className="student-dashboard-content">
          <p className="student-dashboard-breadcrumb">Dashboard</p>
          <section className="student-exam-schedule" aria-labelledby="student-exam-schedule-title">
            <h1 id="student-exam-schedule-title">Exam Schedule</h1>
            {error && <p className="student-dashboard-error" role="alert">{error}</p>}
            <div className="student-exam-table-wrap">
              <table className="student-exam-table">
                <thead>
                  <tr>
                    <th>Examination</th>
                    <th>Name</th>
                    <th>Start Date</th>
                    <th>End Date</th>
                    <th>Total Questions</th>
                    <th>Total Marks</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td className="student-exam-empty" colSpan={7}>Loading your exam schedule...</td></tr>
                  ) : assessments.length === 0 ? (
                    <tr><td className="student-exam-empty" colSpan={7}>No exams are currently assigned to you.</td></tr>
                  ) : assessments.map((assessment) => (
                    <StudentExamScheduleRow
                      key={assessment.id}
                      assessment={assessment}
                      currentTime={currentTime}
                      onAttend={async () => {
                        setAttendNotice("");
                        try {
                          const response = await fetch("/api/candidate-permissions");
                          const payload = await response.json() as { exam_cam_permission_active?: boolean; error?: string };
                          if (!response.ok) throw new Error(payload.error ?? "Unable to check exam camera permission.");
                          setActiveAssessment({
                            ...assessment,
                            exam_cam_permission_active: payload.exam_cam_permission_active ?? true,
                          });
                        } catch (loadError) {
                          console.error("Unable to refresh exam camera permission before exam", loadError);
                          setAttendNotice(loadError instanceof Error ? loadError.message : "Unable to check exam camera permission.");
                        }
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {attendNotice && <p className="student-exam-notice" role="status">{attendNotice}</p>}
            <p className="student-exam-delivery-note">“Attend Exam” is shown only during the permitted login window. Your exam answers and two check-in photos are submitted for authorized evaluation when you finish.</p>
          </section>
        </section>
      </div>
    </main>
  );
}

function StudentExamScheduleRow({ assessment, currentTime, onAttend }: {
  assessment: StudentAssessment;
  currentTime: number;
  onAttend: () => void;
}) {
  const startTime = assessment.start_date ? new Date(assessment.start_date).getTime() : Number.NaN;
  const endTime = assessment.end_date ? new Date(assessment.end_date).getTime() : Number.NaN;
  let action: React.ReactNode = "Schedule unavailable";

  if (assessment.has_submitted) {
    action = <span className="student-exam-status is-attended">Exam Attended</span>;
  } else if (Number.isFinite(startTime)) {
    if (currentTime < startTime) {
      action = <span className="student-exam-status is-upcoming">Upcoming Examination</span>;
    } else {
      const lastLoginDeadline = assessment.last_login !== null && assessment.last_login > 0
        ? startTime + assessment.last_login * 60_000
        : Number.POSITIVE_INFINITY;
      const examEnd = Number.isFinite(endTime) ? endTime : Number.POSITIVE_INFINITY;
      const accessDeadline = Math.min(lastLoginDeadline, examEnd);
      action = currentTime < accessDeadline
        ? <a className="student-exam-attend-link" href={`#attend-exam-${assessment.id}`} onClick={(event) => { event.preventDefault(); onAttend(); }}>Attend Exam</a>
        : <span className="student-exam-status is-missed">Exam is not attend</span>;
    }
  }

  return (
    <tr>
      <td>{assessment.examination || "-"}</td>
      <td className="student-exam-name">{assessment.name || "-"}</td>
      <td>{formatStudentExamDate(assessment.start_date)}</td>
      <td>{formatStudentExamDate(assessment.end_date)}</td>
      <td>{assessment.total_questions}</td>
      <td>{assessment.total_marks}</td>
      <td>{action}</td>
    </tr>
  );
}

export default function Home() {
  const [sessionUser, setSessionUser] = useState<any>(null);
  const [isReady, setIsReady] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [activeSection, setActiveSection] = useState("Dashboard");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [openNavigation, setOpenNavigation] = useState<string | null>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const [showCreateOptions, setShowCreateOptions] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [editingAssessment, setEditingAssessment] = useState<AssessmentCardData | null>(null);
  const [previewAssessment, setPreviewAssessment] = useState<AssessmentCardData | null>(null);
  const [candidateAssignmentAssessment, setCandidateAssignmentAssessment] = useState<AssessmentCardData | null>(null);
  const [evaluatorAssignmentAssessment, setEvaluatorAssignmentAssessment] = useState<AssessmentCardData | null>(null);
  const [invigilatorAssignmentAssessment, setInvigilatorAssignmentAssessment] = useState<AssessmentCardData | null>(null);
  const [invigilatingAssessment, setInvigilatingAssessment] = useState<AssessmentCardData | null>(null);
  const [evaluatingAssessment, setEvaluatingAssessment] = useState<AssessmentCardData | null>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentRole, setCurrentRole] = useState<any>(null);
  const [savedAssessments, setSavedAssessments] = useState<AssessmentCardData[]>([]);
  const [moduleSearch, setModuleSearch] = useState("");
  const [showModuleSearchResults, setShowModuleSearchResults] = useState(false);
  const [profileMenuAnchor, setProfileMenuAnchor] = useState<"header" | "sidebar" | null>(null);
  const headerProfileRef = useRef<HTMLDivElement>(null);
  const sidebarProfileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedUser = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setSessionUser(parsedUser);
        setCurrentUser(parsedUser);
      } catch {
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    if (sessionUser) {
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionUser));
      return;
    }

    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  }, [sessionUser, isReady]);

  useEffect(() => {
    if (!sessionUser || sessionUser.portalType === "student") {
      setCurrentUser(null);
      setCurrentRole(null);
      return;
    }

    setCurrentUser(sessionUser);
    fetch("/api/roles")
      .then((res) => res.json())
      .then((roles) => {
        if (!roles.error) {
          const role = roles.find((entry: any) => entry.role_name === sessionUser.role);
          setCurrentRole(role || null);
        }
      })
      .catch(() => setCurrentRole(null));
  }, [sessionUser]);

  useEffect(() => {
    if (!sessionUser || sessionUser.portalType === "student") {
      setSavedAssessments([]);
      return;
    }

    fetch("/api/assessments")
      .then(async (response) => {
        const data = await response.json() as Array<{
          id: number;
          examination: string;
          name: string;
          start_date: string | null;
          end_date: string | null;
          total_time: number | null;
          last_login: number | null;
          question_category: string | null;
          sub_category: string | null;
          topic: string | null;
          question_language: string | null;
          sections: AssessmentSection[];
          candidate_count: number;
          total_marks: number;
        }> & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load assessments");
        setSavedAssessments(data.map((assessment) => ({
          id: assessment.id,
          title: assessment.name,
          subtitle: assessment.examination,
          examination: assessment.examination,
          start_date: assessment.start_date,
          end_date: assessment.end_date,
          total_time: assessment.total_time,
          last_login: assessment.last_login,
          question_category: assessment.question_category,
          sub_category: assessment.sub_category,
          topic: assessment.topic,
          question_language: assessment.question_language,
          sections: assessment.sections ?? [],
          start: assessment.start_date ? new Date(assessment.start_date).toLocaleString() : "Not scheduled",
          end: assessment.end_date ? new Date(assessment.end_date).toLocaleString() : "Not scheduled",
          questions: String((assessment.sections ?? []).reduce((total, section) => total + (Number(section.question_count) || 0), 0)),
          marks: String(assessment.total_marks ?? getAssessmentMaxMark(assessment.sections)),
          candidates: String(assessment.candidate_count ?? 0),
        })));
      })
      .catch(() => setSavedAssessments([]));
  }, [sessionUser]);

  const activeSectionPermissionKey: Record<string, string> = {
    "Question Categories": "Settings:Questions:Categories",
    "Question Sub Categories": "Settings:Questions:Sub-Categories",
    "Question Topics": "Settings:Questions:Topics",
    "Difficulty Levels": "Settings:Questions:Difficulty Levels",
    Languages: "Settings:Questions:Languages",
    Examinations: "Settings:Assessments:Examinations",
    "Candidate Categories": "Settings:Candidates:Categories",
    "Candidate Sub Categories": "Settings:Candidates:Sub-Categories",
    "Candidate Settings": "Settings:Candidates:Settings",
    "Candidate Permissions": "Settings:Candidates:Candidate Permissions",
    Results: "Settings:Results",
  };

  const hasAccess = (sectionId: string) => {
    if (sectionId === "Dashboard") return true;
    if (!currentRole) return false;
    if (sectionId === "Settings:Results" || sectionId === "Results") {
      return Boolean(currentRole.administrator_access || String(currentUser?.role ?? "").toLocaleLowerCase().includes("admin"));
    }
    if (currentRole.administrator_access) return true;
    if (sectionId === "Users") {
      return ["Users:Roles & Permissions", "Users:List"].some((key) => currentRole.permissions?.[key]?.view === 1);
    }
    const permissionKey = activeSectionPermissionKey[sectionId] ?? sectionId;
    const perm = currentRole.permissions?.[permissionKey];
    return perm ? Number(perm.view) === 1 : false;
  };

  const filteredNavigation = navigationItems
    .map((item) => {
      if (item.options) {
        const newOptions = item.options
          .map((opt) => {
            if (typeof opt === "string") {
              const id = `${item.label}:${opt}`;
              return hasAccess(id) ? opt : null;
            }

            const newSubOptions = opt.options.filter((sub) => hasAccess(`${item.label}:${opt.label}:${sub}`));
            return newSubOptions.length > 0 ? { ...opt, options: newSubOptions } : null;
          })
          .filter(Boolean) as (string | { label: string; options: string[] })[];

        return newOptions.length > 0 ? { ...item, options: newOptions } : null;
      }

      return hasAccess(item.label) ? item : null;
    })
    .filter(Boolean) as typeof navigationItems;
  const visibleDashboardPages = dashboardPages.filter((page) => hasAccess(page.label));
  const searchableDashboardPages = [
    { label: "Dashboard", description: "Examination workspace" },
    ...visibleDashboardPages,
  ];
  const matchingDashboardPages = moduleSearch.trim()
    ? searchableDashboardPages.filter((page) =>
      `${page.label} ${page.description}`.toLowerCase().includes(moduleSearch.trim().toLowerCase())
    ).slice(0, 6)
    : [];
  const assessmentCards = savedAssessments;

  useEffect(() => {
    if (!sidebarExpanded && !openNavigation) {
      return;
    }

    const closeNavigationOutside = (event: PointerEvent) => {
      if (navigationRef.current && !navigationRef.current.contains(event.target as Node)) {
        setOpenNavigation(null);
        setSidebarExpanded(false);
      }
    };

    document.addEventListener("pointerdown", closeNavigationOutside);
    return () => document.removeEventListener("pointerdown", closeNavigationOutside);
  }, [openNavigation, sidebarExpanded]);

  useEffect(() => {
    if (!profileMenuAnchor) return;

    const closeProfileMenuOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !headerProfileRef.current?.contains(target) &&
        !sidebarProfileRef.current?.contains(target)
      ) {
        setProfileMenuAnchor(null);
      }
    };

    document.addEventListener("pointerdown", closeProfileMenuOutside);
    return () => document.removeEventListener("pointerdown", closeProfileMenuOutside);
  }, [profileMenuAnchor]);

  useEffect(() => {
    if (!sidebarExpanded || sidebarHovered) return;
    const timeout = window.setTimeout(() => {
      setSidebarExpanded(false);
      setOpenNavigation(null);
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, [sidebarExpanded, sidebarHovered]);

  if (!isReady) {
    return <main className="login-shell"><div className="login-card"><p>Loading...</p></div></main>;
  }

  if (!sessionUser) {
    return <LoginPage onLogin={setSessionUser} onStudentLogin={setSessionUser} />;
  }

  if (sessionUser.portalType === "student") {
    return <StudentPortalDashboard student={sessionUser} onLogout={() => setSessionUser(null)} />;
  }

  return (
    <main className={`dashboard-shell${sidebarExpanded ? " sidebar-expanded" : ""}`}>
      <header className="site-header">
        <div className="header-top-row">
          <a className="brand" href="#assessments" aria-label="Examination dashboard home">
            <span className="brand-mark">U</span>
            <span className="brand-name">ums<span>.</span>exam</span>
          </a>
          <button
            className="header-sidebar-toggle"
            type="button"
            aria-label={sidebarExpanded ? "Collapse navigation" : "Expand navigation"}
            aria-expanded={sidebarExpanded}
            onClick={() => {
              setSidebarExpanded((expanded) => !expanded);
              setOpenNavigation(null);
            }}
          >
            <span aria-hidden="true">☰</span>
          </button>
          <div className="header-module-search">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.8" />
              <path d="m16 16 4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              id="header-module-search"
              role="combobox"
              aria-label="Search modules and pages"
              aria-expanded={showModuleSearchResults && matchingDashboardPages.length > 0}
              aria-controls="header-search-results"
              aria-autocomplete="list"
              placeholder="Search modules, pages..."
              value={moduleSearch}
              onChange={(event) => {
                setModuleSearch(event.target.value);
                setShowModuleSearchResults(true);
              }}
              onFocus={() => setShowModuleSearchResults(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setShowModuleSearchResults(false);
                if (event.key === "Enter" && matchingDashboardPages[0]) {
                  setActiveSection(matchingDashboardPages[0].label);
                  setModuleSearch("");
                  setShowModuleSearchResults(false);
                }
              }}
            />
            {showModuleSearchResults && matchingDashboardPages.length > 0 && (
              <div id="header-search-results" className="header-search-results" role="listbox" aria-label="Matching modules">
                {matchingDashboardPages.map((page) => (
                  <button
                    key={page.label}
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => {
                      setActiveSection(page.label);
                      setModuleSearch("");
                      setShowModuleSearchResults(false);
                    }}
                  >
                    <span>{page.label}</span>
                    <small>{page.description}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="header-notification" aria-label="Notifications">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="18" cy="5" r="2.5" fill="#F472B6" stroke="white" strokeWidth="1.5" />
            </svg>
          </span>
          <div className="header-profile-menu" ref={headerProfileRef}>
            <button
              className="header-user"
              type="button"
              aria-label={`Profile menu for ${currentUser?.name || "Administrator"}`}
              aria-haspopup="menu"
              aria-expanded={profileMenuAnchor === "header"}
              onClick={() => setProfileMenuAnchor(profileMenuAnchor === "header" ? null : "header")}
            >
              <span className="header-user-avatar">{String(currentUser?.name || "A").slice(0, 1).toUpperCase()}</span>
              <span className="header-user-copy">
                <small>Welcome back,</small>
                <strong>{currentUser?.name || "Administrator"}</strong>
              </span>
              <span className="header-user-chevron" aria-hidden="true">⌄</span>
            </button>
            {profileMenuAnchor === "header" && (
              <div className="profile-dropdown header-profile-dropdown" role="menu">
                <div className="profile-dropdown-heading">
                  <strong>{currentUser?.name || "Administrator"}</strong>
                  <small>{currentUser?.role || "Admin account"}</small>
                </div>
                <button
                  className="profile-menu-logout"
                  type="button"
                  role="menuitem"
                  onClick={() => { setProfileMenuAnchor(null); setSessionUser(null); }}
                >
                  <span aria-hidden="true">↪</span> Logout
                </button>
              </div>
            )}
          </div>
        </div>

      </header>

      <aside
        ref={navigationRef}
        className={`app-sidebar${sidebarExpanded ? " is-expanded" : ""}`}
        aria-label="Application sidebar"
        onMouseEnter={() => { setSidebarHovered(true); setSidebarExpanded(true); }}
        onMouseLeave={() => {
          setSidebarHovered(false);
          setSidebarExpanded(false);
          setOpenNavigation(null);
        }}
        onWheelCapture={() => {
          setSidebarHovered(true);
          setSidebarExpanded(true);
        }}
        onTouchMove={() => {
          setSidebarHovered(true);
          setSidebarExpanded(true);
        }}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (!target.closest("button") && !sidebarExpanded) setSidebarExpanded(true);
        }}
      >
        <button
          className="sidebar-toggle"
          type="button"
          aria-label={sidebarExpanded ? "Collapse navigation" : "Expand navigation"}
          title={sidebarExpanded ? "Collapse navigation" : "Expand navigation"}
          aria-expanded={sidebarExpanded}
          onClick={() => {
            setSidebarExpanded((expanded) => !expanded);
            setOpenNavigation(null);
          }}
        >
          <span aria-hidden="true">☰</span>
          <span className="sidebar-toggle-label">Navigation</span>
        </button>
        <nav className="header-navigation" aria-label="Main navigation">
          {filteredNavigation.map((item) => (
            <div className="navigation-group" key={item.label}>
              <button
                aria-current={activeSection === item.label ? "page" : undefined}
                aria-expanded={openNavigation === item.label || Boolean(item.options && openNavigation?.startsWith(`${item.label}:`))}
                aria-haspopup={item.options ? "menu" : undefined}
                className={`navigation-item${activeSection === item.label ? " is-active" : ""}`}
                type="button"
                title={!sidebarExpanded ? item.label : undefined}
                onClick={() => {
                  if (item.options) {
                    setSidebarExpanded(true);
                    setOpenNavigation(openNavigation === item.label ? null : item.label);
                  } else {
                    setActiveSection(item.label);
                    setOpenNavigation(null);
                    setSidebarExpanded(false);
                  }
                }}
              >
                <span className="navigation-icon" aria-hidden="true">{item.icon}</span>
                <span className="navigation-label">{item.label}</span>
                {item.options && <span className="navigation-chevron" aria-hidden="true">⌄</span>}
              </button>
              {item.options && (
                <div className="navigation-dropdown" role="menu">
                  {item.options.map((option) => {
                    const optionLabel = typeof option === "string" ? option : option.label;
                    const nestedKey = `${item.label}:${optionLabel}`;

                    return typeof option === "string" ? (
                      <button key={option} type="button" role="menuitem" onClick={() => { setActiveSection(option); setOpenNavigation(null); setSidebarExpanded(false); }}>
                        <span className="dropdown-option-icon" aria-hidden="true">{navigationOptionIcons[option]}</span>
                        {option}
                      </button>
                    ) : (
                      <div className="navigation-nested-group" key={option.label}>
                        <button
                          className="navigation-nested-trigger"
                          type="button"
                          role="menuitem"
                          aria-expanded={openNavigation === nestedKey}
                          onClick={() => setOpenNavigation(openNavigation === nestedKey ? item.label : nestedKey)}
                        >
                          <span className="dropdown-option-icon" aria-hidden="true">{navigationOptionIcons[option.label]}</span>
                          <span className="nested-option-label">{option.label}</span><span className="nested-option-arrow" aria-hidden="true">›</span>
                        </button>
                        <div className="navigation-subdropdown" role="menu">
                          {option.options.map((nestedOption) => (
                            <button
                              key={nestedOption}
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                if (item.label === "Settings" && option.label === "Questions" && nestedOption === "Categories") {
                                  setActiveSection("Question Categories");
                                }
                                if (item.label === "Settings" && option.label === "Questions" && nestedOption === "Sub Categories") {
                                  setActiveSection("Question Sub Categories");
                                }
                                if (item.label === "Settings" && option.label === "Questions" && nestedOption === "Topics") {
                                  setActiveSection("Question Topics");
                                }
                                if (item.label === "Settings" && option.label === "Questions" && nestedOption === "Difficulty Levels") {
                                  setActiveSection("Difficulty Levels");
                                }
                                if (item.label === "Settings" && option.label === "Questions" && nestedOption === "Languages") {
                                  setActiveSection("Languages");
                                }
                                if (item.label === "Settings" && option.label === "Assessments" && nestedOption === "Examinations") {
                                  setActiveSection("Examinations");
                                }
                                if (item.label === "Settings" && option.label === "Candidates" && nestedOption === "Categories") {
                                  setActiveSection("Candidate Categories");
                                }
                                if (item.label === "Settings" && option.label === "Candidates" && nestedOption === "Sub Categories") {
                                  setActiveSection("Candidate Sub Categories");
                                }
                                if (item.label === "Settings" && option.label === "Candidates" && nestedOption === "Settings") {
                                  setActiveSection("Candidate Settings");
                                }
                                if (item.label === "Settings" && option.label === "Candidates" && nestedOption === "Candidate Permissions") {
                                  setActiveSection("Candidate Permissions");
                                }
                                setOpenNavigation(null);
                                setSidebarExpanded(false);
                              }}
                            >
                                <span className="dropdown-option-icon" aria-hidden="true">{navigationOptionIcons[nestedOption]}</span>
                                {nestedOption}
                              </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-profile-menu" ref={sidebarProfileRef}>
            <button
              className="sidebar-profile"
              type="button"
              title={!sidebarExpanded ? `${currentUser?.name || "Administrator"} · ${currentUser?.role || "Admin account"}` : undefined}
              aria-label={`Profile menu for ${currentUser?.name || "Administrator"}`}
              aria-haspopup="menu"
              aria-expanded={profileMenuAnchor === "sidebar"}
              onClick={() => setProfileMenuAnchor(profileMenuAnchor === "sidebar" ? null : "sidebar")}
            >
              <span className="profile-icon" aria-hidden="true">♙</span>
              <span className="sidebar-profile-copy">
                <strong>{currentUser?.name || "Administrator"}</strong>
                <small>{currentUser?.role || "Admin account"}</small>
              </span>
            </button>
            {profileMenuAnchor === "sidebar" && (
              <div className="profile-dropdown sidebar-profile-dropdown" role="menu">
                <div className="profile-dropdown-heading">
                  <strong>{currentUser?.name || "Administrator"}</strong>
                  <small>{currentUser?.role || "Admin account"}</small>
                </div>
                <button
                  className="profile-menu-logout"
                  type="button"
                  role="menuitem"
                  onClick={() => { setProfileMenuAnchor(null); setSessionUser(null); }}
                >
                  <span aria-hidden="true">↪</span> Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="page-body">
        {!hasAccess(activeSection) ? <SectionPlaceholder title="Access restricted" /> : activeSection === "Dashboard" ? <DashboardPanel name={currentUser?.name || "Administrator"} shortcuts={visibleDashboardPages} onNavigate={setActiveSection} /> :
        activeSection === "Questions" ? <QuestionsPanel currentRole={currentRole} /> : activeSection === "Question Categories" ? <QuestionCategoriesPanel currentRole={currentRole} /> : activeSection === "Question Sub Categories" ? <QuestionSubCategoriesPanel currentRole={currentRole} /> : activeSection === "Question Topics" ? <QuestionTopicsPanel currentRole={currentRole} /> : activeSection === "Difficulty Levels" ? <DifficultyLevelsPanel currentRole={currentRole} /> : activeSection === "Languages" ? <LanguagesPanel currentRole={currentRole} /> : activeSection === "Examinations" ? <AssessmentTypesPanel currentRole={currentRole} /> : activeSection === "Candidate Categories" ? <CandidateCategoriesPanel currentRole={currentRole} /> : activeSection === "Candidate Sub Categories" ? <CandidateSubCategoriesPanel currentRole={currentRole} /> : activeSection === "Candidate Settings" ? <CandidateSettingsPanel currentRole={currentRole} /> : activeSection === "Candidate Permissions" ? <CandidatePermissionsPanel accountUserId={Number(currentUser?.id) || null} /> : activeSection === "Results" ? <ResultsPanel accountUserId={Number(currentUser?.id) || null} /> : activeSection === "Candidates" ? <CandidatesPanel currentRole={currentRole} /> : activeSection === "Assessments" ? <section className="assessments-section" id="assessments">
        <div className="assessments-toolbar">
          <div>
            <p className="section-kicker">Examination workspace</p>
            <h1>Assessments</h1>
            <p className="assessment-count">Showing {assessmentCards.length} of {assessmentCards.length} assessments</p>
          </div>
          <div className="toolbar-actions">
            <button
              className="view-toggle"
              type="button"
              aria-label={`Switch to ${view === "grid" ? "list" : "grid"} view`}
              onClick={() => setView(view === "grid" ? "list" : "grid")}
            >
              <span className="view-toggle-icon" aria-hidden="true">{view === "grid" ? "☷" : "▦"}</span>
              {view === "grid" ? "List view" : "Grid view"}
            </button>
          </div>
        </div>

        <div className={`assessment-grid${view === "list" ? " list-view" : ""}`}>
          {hasRolePermission(currentRole, "Assessments", "create") && <div className="create-assessment-card">
            <span className="assessment-card-icon create-card-icon" aria-hidden="true">
              <span className="icon-page" />
              <span className="icon-plus">+</span>
            </span>
            <span className="create-card-copy">
              <button
                aria-expanded={showCreateOptions}
                aria-haspopup="menu"
                className="create-assessment-button"
                type="button"
                onClick={() => setShowCreateOptions(!showCreateOptions)}
              >
                <span aria-hidden="true">+</span> Add assessment
              </button>
              {showCreateOptions && (
                <div className="create-options-menu" role="menu" aria-label="Create assessment options">
                  <button type="button" role="menuitem" onClick={() => { setEditingAssessment(null); setShowManualForm(true); setShowCreateOptions(false); }}>
                    <span aria-hidden="true">✎</span>
                    Add manually
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setShowBulkUpload(true); setShowCreateOptions(false); }}>
                    <span aria-hidden="true">↑</span> Upload bulk
                  </button>
                </div>
              )}
              <span>Add Assessment, if it does not exist</span>
            </span>
          </div>}
          {assessmentCards.map((assessment) => (
            <AssessmentCard
              assessment={assessment}
              currentRole={currentRole}
              canEvaluate={/admin|evaluator/i.test(String(currentUser?.role ?? ""))}
              isInvigilator={String(currentUser?.role ?? "").trim().toLocaleLowerCase() === "invigilator"}
              isEvaluator={/evaluator/i.test(String(currentUser?.role ?? ""))}
              key={assessment.id ?? assessment.title}
              onDeleted={(id) => setSavedAssessments((current) => current.filter((item) => item.id !== id))}
              onEdit={(selectedAssessment) => { setEditingAssessment(selectedAssessment); setShowManualForm(true); }}
              onPreview={setPreviewAssessment}
              onAssignCandidates={setCandidateAssignmentAssessment}
              onAssignEvaluator={setEvaluatorAssignmentAssessment}
              onAssignInvigilator={setInvigilatorAssignmentAssessment}
              onInvigilate={setInvigilatingAssessment}
              onEvaluate={setEvaluatingAssessment}
            />
          ))}
        </div>
        </section> : activeSection === "Users" ? <UsersPanel currentRole={currentRole} /> : <SectionPlaceholder title={activeSection} />}
      </div>
      {previewAssessment && <AssessmentPreview assessment={previewAssessment} onClose={() => setPreviewAssessment(null)} />}
      {candidateAssignmentAssessment && <CandidateAssignment assessment={candidateAssignmentAssessment} onClose={() => {
        setCandidateAssignmentAssessment(null);
        fetch("/api/assessments")
          .then(async (response) => {
            const data = await response.json() as Array<{
              id: number;
              examination: string;
              name: string;
              start_date: string | null;
              end_date: string | null;
              total_time: number | null;
              last_login: number | null;
              question_category: string | null;
              sub_category: string | null;
              topic: string | null;
              question_language: string | null;
              sections: AssessmentSection[];
              candidate_count: number;
              total_marks: number;
            }> & { error?: string };
            if (!response.ok) throw new Error(data.error ?? "Unable to refresh assessment candidates");
            setSavedAssessments(data.map((assessment) => ({
              id: assessment.id,
              title: assessment.name,
              subtitle: assessment.examination,
              examination: assessment.examination,
              start_date: assessment.start_date,
              end_date: assessment.end_date,
              total_time: assessment.total_time,
              last_login: assessment.last_login,
              question_category: assessment.question_category,
              sub_category: assessment.sub_category,
              topic: assessment.topic,
              question_language: assessment.question_language,
              sections: assessment.sections ?? [],
              start: assessment.start_date ? new Date(assessment.start_date).toLocaleString() : "Not scheduled",
              end: assessment.end_date ? new Date(assessment.end_date).toLocaleString() : "Not scheduled",
              questions: String((assessment.sections ?? []).reduce((total, section) => total + (Number(section.question_count) || 0), 0)),
              marks: String(assessment.total_marks ?? getAssessmentMaxMark(assessment.sections)),
              candidates: String(assessment.candidate_count ?? 0),
            })));
          })
          .catch((error) => console.error("Failed to refresh assessment candidate counts", error));
      }} />}
      {evaluatorAssignmentAssessment && <AssessmentStaffAssignment assessment={evaluatorAssignmentAssessment} role="evaluator" onClose={() => setEvaluatorAssignmentAssessment(null)} />}
      {invigilatorAssignmentAssessment && <AssessmentStaffAssignment assessment={invigilatorAssignmentAssessment} role="invigilator" onClose={() => setInvigilatorAssignmentAssessment(null)} />}
      {invigilatingAssessment &&       <AssessmentInvigilation
        assessment={invigilatingAssessment}
        accountUserId={Number(currentUser?.id) || null}
        onClose={() => setInvigilatingAssessment(null)}
      />}
      {evaluatingAssessment && <AssessmentEvaluation
        assessment={evaluatingAssessment}
        accountUserId={Number(currentUser?.id) || null}
        onClose={() => setEvaluatingAssessment(null)}
      />}
      {showManualForm && <ManualAssessmentForm
        initialAssessment={editingAssessment ?? undefined}
        onClose={() => { setShowManualForm(false); setEditingAssessment(null); }}
        onSaved={(assessment) => {
          setSavedAssessments((current) => current.some((item) => item.id === assessment.id)
            ? current.map((item) => item.id === assessment.id ? assessment : item)
            : [assessment, ...current]);
          setShowManualForm(false);
          setEditingAssessment(null);
        }}
      />}
      {showBulkUpload && <BulkUploadForm
        onClose={() => setShowBulkUpload(false)}
        onUploaded={(assessments) => {
          setSavedAssessments((current) => [
            ...assessments.map((assessment) => ({
              id: assessment.id,
              title: assessment.name,
              subtitle: assessment.examination,
              examination: assessment.examination,
              sections: assessment.sections ?? [],
              start: assessment.start_date ? new Date(assessment.start_date).toLocaleString() : "Not scheduled",
              end: assessment.end_date ? new Date(assessment.end_date).toLocaleString() : "Not scheduled",
              questions: String((assessment.sections ?? []).reduce((total, section) => total + (Number(section.question_count) || 0), 0)),
              marks: String(getAssessmentMaxMark(assessment.sections)),
              candidates: String(assessment.candidate_count ?? 0),
            })),
            ...current,
          ]);
          setShowBulkUpload(false);
        }}
      />}
    </main>
  );
}
