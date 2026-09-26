"use client";

import React, { useEffect, useRef, useState, type FormEvent } from "react";

const navigationItems = [
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
      { label: "Candidates", options: ["Categories", "Sub Categories", "Settings"] },
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
};

type AssessmentCardData = {
  id?: number;
  title: string;
  subtitle: string;
  start: string;
  end: string;
  questions: string;
  marks: string;
  candidates: string;
};

function AssessmentCard({ assessment, currentRole, onDeleted }: { assessment: AssessmentCardData; currentRole?: any; onDeleted?: (id: number) => void }) {
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
            <button type="button" role="menuitem">Preview</button>
            {canEdit && <button className="option-menu-item" type="button" role="menuitem">Edit</button>}
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
                    <button type="button" role="menuitem">Manual</button>
                    <button type="button" role="menuitem">Upload</button>
                  </div>
                )}
              </div>
            ))}
            <button className="option-menu-item" type="button" role="menuitem">Settings</button>
            <button className="option-menu-item" type="button" role="menuitem">Invigilate</button>
            <button className="option-menu-item" type="button" role="menuitem">Evaluate</button>
            <button className="option-menu-item" type="button" role="menuitem">Reports</button>
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

function ManualAssessmentForm({ onClose, onSaved }: { onClose: () => void; onSaved: (assessment: AssessmentCardData) => void }) {
  const [sectionIds, setSectionIds] = useState([0]);
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      const data = await response.json() as { id?: number; error?: string; examination?: string; name?: string; start_date?: string; end_date?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to save assessment");

      onSaved({
        id: data.id,
        title: data.name ?? "New assessment",
        subtitle: data.examination ?? "",
        start: data.start_date ? new Date(data.start_date).toLocaleString() : "Not scheduled",
        end: data.end_date ? new Date(data.end_date).toLocaleString() : "Not scheduled",
        questions: String(sections.reduce((total, section) => total + (Number(section.question_count) || 0), 0)),
        marks: "0",
        candidates: "0",
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
            <h1 id="manual-form-title">Add manually</h1>
          </div>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close form">×</button>
        </div>

        <form onSubmit={saveAssessment}>
          <div className="form-field full-width">
            <label htmlFor="examination">Examination</label>
            <select id="examination" name="examination" defaultValue="" disabled={loadingExaminations} required>
              <option value="" disabled>{loadingExaminations ? "Loading examinations..." : "Choose"}</option>
              {examinations.map((examination) => (
                <option key={examination.id} value={examination.assessment_name}>{examination.assessment_name}</option>
              ))}
            </select>
          </div>

          <div className="form-field full-width">
            <label htmlFor="assessment-name">Name</label>
            <input id="assessment-name" name="name" placeholder="Name" required />
          </div>

          <div className="form-row date-row">
            <div className="form-field date-field">
              <label htmlFor="start-date">Assessment Date</label>
              <div className="date-range-inputs">
                <input id="start-date" name="start_date" type="datetime-local" aria-label="Assessment start date" />
                <span aria-hidden="true">to</span>
                <input id="end-date" name="end_date" type="datetime-local" aria-label="Assessment end date" />
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="total-time">Total Time (in Mins)</label>
              <input id="total-time" name="total_time" type="number" min="1" placeholder="Total Time (in Mins)" />
            </div>
            <div className="form-field">
              <label htmlFor="last-login">Last Login Time (in Mins)</label>
              <input id="last-login" name="last_login" type="number" min="1" placeholder="Last Login Time (in Mins)" />
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
                <select id={id} name={id === "question-category" ? "question_category" : id === "sub-category" ? "sub_category" : id === "question-language" ? "question_language" : id} defaultValue="" disabled={(id === "question-category" && loadingQuestionCategories) || (id === "sub-category" && loadingQuestionSubCategories)} required={id === "question-category" || id === "sub-category"}>
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
                  <input data-section-field="name" aria-label={`Section ${index + 1} name`} placeholder="Name" />
                  <select data-section-field="question-type" aria-label={`Section ${index + 1} question type`} defaultValue="">
                    <option value="" disabled>Question Type</option>
                    <option>Objective</option>
                    <option>Subjective</option>
                  </select>
                  <input data-section-field="question-count" type="number" min="1" aria-label={`Section ${index + 1} question count`} placeholder="Question Count" />
                  <input data-section-field="correct-mark" type="number" min="0" aria-label={`Section ${index + 1} correct mark`} placeholder="Correct Mark" />
                  <input data-section-field="wrong-mark" type="number" min="0" aria-label={`Section ${index + 1} wrong mark`} placeholder="Wrong Mark" />
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

function BulkUploadForm({ onClose }: { onClose: () => void }) {
  const [fileName, setFileName] = useState("");

  return (
    <div className="form-overlay" role="presentation">
      <section className="bulk-upload-form" role="dialog" aria-modal="true" aria-labelledby="bulk-upload-title">
        <div className="bulk-upload-header">
          <h1 id="bulk-upload-title">Upload Assessments</h1>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close upload form">×</button>
        </div>

        <div className="bulk-upload-content">
          <a className="download-sample-link" href="#download-sample">Download Sample</a>
          <div className="bulk-file-field">
            <label htmlFor="assessment-file">File</label>
            <div className="file-picker">
              <label className="choose-file-button" htmlFor="assessment-file">Choose File</label>
              <span>{fileName || "No file chosen"}</span>
              <input
                id="assessment-file"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
              />
            </div>
          </div>
        </div>

        <div className="bulk-upload-actions">
          <button className="form-cancel-button" type="button" onClick={onClose}>Close</button>
          <button className="form-save-button" type="button" onClick={onClose} disabled={!fileName}>Upload</button>
        </div>
      </section>
    </div>
  );
}

function CandidateUploadForm({ onClose }: { onClose: () => void }) {
  const [fileName, setFileName] = useState("");

  return (
    <div className="form-overlay" role="presentation">
      <section className="bulk-upload-form" role="dialog" aria-modal="true" aria-labelledby="candidate-upload-title">
        <div className="bulk-upload-header">
          <h1 id="candidate-upload-title">Upload Candidates</h1>
          <button className="form-close-icon" type="button" onClick={onClose} aria-label="Close candidate upload form">×</button>
        </div>
        <div className="bulk-upload-content">
          <a className="download-sample-link" href="#download-candidate-sample">Download Sample</a>
          <div className="bulk-file-field">
            <label htmlFor="candidate-file">File</label>
            <div className="file-picker">
              <label className="choose-file-button" htmlFor="candidate-file">Choose File</label>
              <span>{fileName || "No file chosen"}</span>
              <input
                id="candidate-file"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
              />
            </div>
          </div>
        </div>
        <div className="bulk-upload-actions">
          <button className="form-cancel-button" type="button" onClick={onClose}>Close</button>
          <button className="form-save-button" type="button" onClick={onClose} disabled={!fileName}>Upload</button>
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
        body: JSON.stringify({ category, sub_category: subCategory, fields: Object.fromEntries(candidateInfo.map((item) => [item.name, values[item.id] ?? ""])) }),
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
          {loading && <p>Loading candidate fields...</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {!loading && candidateInfo.map((item) => {
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
          {canCreate && <button className="candidate-action-button" type="button" onClick={() => setShowCandidateUpload(true)}>
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
                {candidateInfo.map((info) => (
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
                  <td colSpan={candidateInfo.length + 4}>Loading candidates...</td>
                </tr>
              ) : candidates.length === 0 ? (
                <tr>
                  <td colSpan={candidateInfo.length + 4}>No data available in table</td>
                </tr>
              ) : (
                candidates.map((c) => (
                  <tr key={c.id}>
                    <td>#{c.id}</td>
                    {candidateInfo.map((info) => (
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
      {showCandidateUpload && <CandidateUploadForm onClose={() => setShowCandidateUpload(false)} />}
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

function AddUserForm({ roles, onClose, onSaved }: { roles: any[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [role, setRole] = useState("");
  const [saving, setSaving] = useState(false);

  const saveUser = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, mobile, role }),
      });
      if (res.ok) onSaved();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-overlay" role="presentation" style={{ zIndex: 1000 }}>
      <section className="candidate-form" role="dialog" aria-modal="true" style={{ width: "500px", maxWidth: "90%" }}>
        <div className="bulk-upload-header" style={{ padding: '20px', borderBottom: '1px solid #eee' }}>
          <h1 style={{ fontSize: '20px', margin: 0, color: '#444' }}>Add New User</h1>
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
          <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button className="form-cancel-button" type="button" onClick={onClose} style={{ padding: '8px 20px', border: '1px solid #ccc', borderRadius: '4px', background: 'transparent' }}>CLOSE</button>
            <button className="form-save-button" type="submit" disabled={saving || !role} style={{ padding: '8px 20px', border: 'none', borderRadius: '4px', background: '#6366f1', color: 'white', cursor: 'pointer' }}>{saving ? "SAVING..." : "SAVE"}</button>
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
  const [roles, setRoles] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const canCreateRoles = hasRolePermission(currentRole, "Users:Roles & Permissions", "create");
  const canEditRoles = hasRolePermission(currentRole, "Users:Roles & Permissions", "edit");
  const canDeleteRoles = hasRolePermission(currentRole, "Users:Roles & Permissions", "delete");
  const canCreateUsers = hasRolePermission(currentRole, "Users:List", "create");
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
                        onClick={() => setActiveUserMenu(activeUserMenu === user.id ? null : user.id)}
                      >
                        ⋮
                      </button>
                      {activeUserMenu === user.id && (
                        <div className="row-action-menu" role="menu">
                          {canDeleteUsers && <button type="button" onClick={() => { deleteUser(user.id); setActiveUserMenu(null); }}>Delete</button>}
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

function QuestionsPanel({ currentRole }: { currentRole?: any }) {
  const canCreate = hasRolePermission(currentRole, "Questions", "create");

  return (
    <section className="candidates-section questions-section" id="questions">
      <h1>Questions</h1>
      <div className="candidates-panel">
        <div className="candidates-actions">
          {canCreate && <button className="candidate-action-button" type="button">
            <span aria-hidden="true">↥</span> Upload
          </button>}
          {canCreate && (
            <button className="candidate-action-button" type="button">
              <span aria-hidden="true">+</span> Add new
            </button>
          )}
        </div>
        <div className="candidate-table-toolbar">
          <span>Showing 0 to 0 of 0 entries</span>
          <label className="search-control" htmlFor="questions-search">
            Search:
            <input id="questions-search" />
          </label>
        </div>
        <div className="candidate-table-wrapper">
          <table className="candidate-table">
            <thead>
              <tr>
                <th>Candidate ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Category</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5}>No data available in table</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="candidate-table-footer">
          <span>Showing 0 to 0 of 0 entries</span>
          <div>
            <button type="button" disabled>Previous</button>
            <button type="button" disabled>Next</button>
          </div>
        </div>
      </div>
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

function LoginPage({ onLogin }: { onLogin: (user: any) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark">U</span>
          <span className="brand-name">ums<span>.</span>exam</span>
        </div>

        <h1>Administrator Login</h1>
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
      </div>
    </main>
  );
}

export default function Home() {
  const [sessionUser, setSessionUser] = useState<any>(null);
  const [isReady, setIsReady] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [activeSection, setActiveSection] = useState("Assessments");
  const [openNavigation, setOpenNavigation] = useState<string | null>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const [showCreateOptions, setShowCreateOptions] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentRole, setCurrentRole] = useState<any>(null);
  const [savedAssessments, setSavedAssessments] = useState<AssessmentCardData[]>([]);

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
    if (!sessionUser) {
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
    if (!sessionUser) {
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
          sections: Array<{ question_count?: string }>;
        }> & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to load assessments");
        setSavedAssessments(data.map((assessment) => ({
          id: assessment.id,
          title: assessment.name,
          subtitle: assessment.examination,
          start: assessment.start_date ? new Date(assessment.start_date).toLocaleString() : "Not scheduled",
          end: assessment.end_date ? new Date(assessment.end_date).toLocaleString() : "Not scheduled",
          questions: String((assessment.sections ?? []).reduce((total, section) => total + (Number(section.question_count) || 0), 0)),
          marks: "0",
          candidates: "0",
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
  };

  const hasAccess = (sectionId: string) => {
    if (!currentRole) return false;
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
  const assessmentCards = savedAssessments;

  useEffect(() => {
    if (!openNavigation) {
      return;
    }

    const closeNavigationOutside = (event: PointerEvent) => {
      if (navigationRef.current && !navigationRef.current.contains(event.target as Node)) {
        setOpenNavigation(null);
      }
    };

    document.addEventListener("pointerdown", closeNavigationOutside);
    return () => document.removeEventListener("pointerdown", closeNavigationOutside);
  }, [openNavigation]);

  if (!isReady) {
    return <main className="login-shell"><div className="login-card"><p>Loading...</p></div></main>;
  }

  if (!sessionUser) {
    return <LoginPage onLogin={setSessionUser} />;
  }

  return (
    <main className="dashboard-shell">
      <header className="site-header">
        <div className="header-top-row">
          <a className="brand" href="#assessments" aria-label="Examination dashboard home">
            <span className="brand-mark">U</span>
            <span className="brand-name">ums<span>.</span>exam</span>
          </a>

          <button
            className="profile-button"
            type="button"
            aria-label="Logout"
            onClick={() => setSessionUser(null)}
          >
            <span className="profile-icon">♙</span>
            <span className="profile-copy">
              <strong>{currentUser?.name || "Administrator"}</strong>
              <small>{currentUser?.role || "Admin account"}</small>
            </span>
            <span className="profile-chevron" aria-hidden="true">⌄</span>
          </button>
        </div>

        <nav ref={navigationRef} className="header-navigation" aria-label="Main navigation">
          {filteredNavigation.map((item) => (
            <div className="navigation-group" key={item.label}>
              <button
                aria-current={activeSection === item.label ? "page" : undefined}
                aria-expanded={openNavigation === item.label}
                aria-haspopup={item.options ? "menu" : undefined}
                className={`navigation-item${activeSection === item.label ? " is-active" : ""}`}
                type="button"
                onClick={() => {
                  if (item.label !== "Settings") {
                    setActiveSection(item.label);
                  }
                  setOpenNavigation(openNavigation === item.label ? null : item.options ? item.label : null);
                }}
              >
                <span className="navigation-icon" aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
                {item.options && <span className="navigation-chevron" aria-hidden="true">⌄</span>}
              </button>
              {item.options && (
                <div className="navigation-dropdown" role="menu">
                  {item.options.map((option) => {
                    const optionLabel = typeof option === "string" ? option : option.label;
                    const nestedKey = `${item.label}:${optionLabel}`;

                    return typeof option === "string" ? (
                      <button key={option} type="button" role="menuitem" onClick={() => setOpenNavigation(null)}>
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
                                setOpenNavigation(null);
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
      </header>

      <div className="page-body">
        {!hasAccess(activeSection) ? <SectionPlaceholder title="Access restricted" /> :
        activeSection === "Questions" ? <QuestionsPanel currentRole={currentRole} /> : activeSection === "Question Categories" ? <QuestionCategoriesPanel currentRole={currentRole} /> : activeSection === "Question Sub Categories" ? <QuestionSubCategoriesPanel currentRole={currentRole} /> : activeSection === "Question Topics" ? <QuestionTopicsPanel currentRole={currentRole} /> : activeSection === "Difficulty Levels" ? <DifficultyLevelsPanel currentRole={currentRole} /> : activeSection === "Languages" ? <LanguagesPanel currentRole={currentRole} /> : activeSection === "Examinations" ? <AssessmentTypesPanel currentRole={currentRole} /> : activeSection === "Candidate Categories" ? <CandidateCategoriesPanel currentRole={currentRole} /> : activeSection === "Candidate Sub Categories" ? <CandidateSubCategoriesPanel currentRole={currentRole} /> : activeSection === "Candidate Settings" ? <CandidateSettingsPanel currentRole={currentRole} /> : activeSection === "Candidates" ? <CandidatesPanel currentRole={currentRole} /> : activeSection === "Assessments" ? <section className="assessments-section" id="assessments">
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
                  <button type="button" role="menuitem" onClick={() => { setShowManualForm(true); setShowCreateOptions(false); }}>
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
              key={assessment.id ?? assessment.title}
              onDeleted={(id) => setSavedAssessments((current) => current.filter((item) => item.id !== id))}
            />
          ))}
        </div>
        </section> : activeSection === "Users" ? <UsersPanel currentRole={currentRole} /> : <SectionPlaceholder title={activeSection} />}
      </div>
      {showManualForm && <ManualAssessmentForm onClose={() => setShowManualForm(false)} onSaved={(assessment) => { setSavedAssessments((current) => [assessment, ...current]); setShowManualForm(false); }} />}
      {showBulkUpload && <BulkUploadForm onClose={() => setShowBulkUpload(false)} />}
    </main>
  );
}

