import type { PoolClient } from "pg";
import { databasePool } from "@/lib/db";
import { matchesAssessmentQuestionType } from "@/lib/question-types";
import { ensureExamTimelineTable, recordExamTimelineEvent } from "@/lib/exam-timeline";

export type AttemptQuestion = {
  id: number;
  question_type: string;
  question: string;
  section: string;
  options: string[];
  correct_answer: unknown;
  correct_mark: number;
  wrong_mark: number;
  passage: string | null;
  details: Record<string, unknown>;
};

type QuestionRow = {
  id: number | string;
  question_type: string;
  question: string;
  details: unknown;
  difficulty_level?: string | null;
};

type AssessmentSection = Record<string, unknown> & {
  name?: unknown;
  question_type?: unknown;
  question_count?: unknown;
  correct_mark?: unknown;
  wrong_mark?: unknown;
  difficulty_level?: unknown;
};

export type AttemptRow = {
  id: number;
  assessment_id: number;
  candidate_id: number;
  status: "in_progress" | "submitted" | "expired";
  answers: Record<string, unknown>;
  questions_snapshot: AttemptQuestion[];
  selfie_photo: string;
  id_photo: string;
  started_at: Date | string;
  deadline_at: Date | string;
  submitted_at: Date | string | null;
};

export type PublicAttemptQuestion = Pick<
  AttemptQuestion,
  "id" | "question_type" | "question" | "section" | "correct_mark"
> & { details: Record<string, unknown> };

export async function ensureExamAttemptTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_attempts (
      id BIGSERIAL PRIMARY KEY,
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'submitted', 'expired')),
      answers JSONB NOT NULL DEFAULT '{}'::jsonb,
      questions_snapshot JSONB NOT NULL,
      selfie_photo TEXT NOT NULL,
      id_photo TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      deadline_at TIMESTAMPTZ NOT NULL,
      submitted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (assessment_id, candidate_id)
    )
  `);
}

let examAttemptTableReady: Promise<void> | undefined;

export function ensureExamAttemptTableOnce() {
  if (!examAttemptTableReady) {
    examAttemptTableReady = ensureExamAttemptTable().catch((error: unknown) => {
      examAttemptTableReady = undefined;
      throw error;
    });
  }
  return examAttemptTableReady;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getOptions(details: Record<string, unknown>, questionType: string) {
  const options = Array.isArray(details.options)
    ? details.options.filter((option): option is string => typeof option === "string")
    : [];
  if (options.length) return options;
  const fallback: Record<string, string[]> = {
    "true/false": ["True", "False"],
    "yes/no": ["Yes", "No"],
    "agree/disagree": ["Agree", "Disagree"],
    "good/bad": ["Good", "Bad"],
  };
  return fallback[questionType.trim().toLocaleLowerCase()] ?? [];
}

function sanitizeStudentDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeStudentDetails);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/^(?:answer|answers|answer_key|correct_answer|expected_answer|model_answer|solution|evaluator(?:_|$)|evaluation(?:_|$)|grading(?:_|$))/i.test(key))
      .map(([key, entry]) => [key, sanitizeStudentDetails(entry)]),
  );
}

function getQuestionDetails(value: unknown) {
  return isRecord(value) ? sanitizeStudentDetails(value) as Record<string, unknown> : {};
}

function makeAttemptQuestion(
  row: QuestionRow,
  sectionName: string,
  correctMark: number,
  wrongMark: number,
): AttemptQuestion {
  const rawDetails = isRecord(row.details) ? row.details : {};
  const options = getOptions(rawDetails, row.question_type);
  const details = getQuestionDetails(rawDetails);
  return {
    id: Number(row.id),
    question_type: String(row.question_type),
    question: String(row.question),
    section: sectionName,
    options,
    correct_answer: rawDetails.answer ?? null,
    correct_mark: correctMark,
    wrong_mark: wrongMark,
    passage: typeof rawDetails.passage === "string" && rawDetails.passage ? rawDetails.passage : null,
    details,
  };
}

export function buildAttemptQuestionSet(
  configuredSections: unknown,
  questionRows: QuestionRow[],
) {
  const sections = Array.isArray(configuredSections)
    ? configuredSections.filter(isRecord) as AssessmentSection[]
    : [];
  const result: Array<{ name: string; questions: AttemptQuestion[] }> = [];
  const snapshot: AttemptQuestion[] = [];
  const selectedIds = new Set<number>();

  if (!sections.length) {
    const questions = questionRows.map((row) => makeAttemptQuestion(row, "Other Questions", 0, 0));
    return {
      sections: questions.length ? [{ name: "Other Questions", questions }] : [],
      snapshot: questions,
    };
  }

  for (const [index, section] of sections.entries()) {
    const name = typeof section.name === "string" && section.name.trim()
      ? section.name.trim()
      : `Section ${String.fromCharCode(65 + index)}`;
    const requestedCount = Number(section.question_count);
    if (!Number.isInteger(requestedCount) || requestedCount <= 0) {
      throw new Error(`Section "${name}" must have a positive whole-number question count.`);
    }
    const correctMark = Number(section.correct_mark);
    const wrongMark = Number(section.wrong_mark ?? 0);
    if (!Number.isFinite(correctMark) || correctMark < 0 || !Number.isFinite(wrongMark) || wrongMark > 0) {
      throw new Error(`Section "${name}" has invalid marks.`);
    }

    const configuredDifficulty = typeof section.difficulty_level === "string"
      ? section.difficulty_level.trim()
      : "";
    const sectionTypeQuestions = questionRows.filter((row) =>
      matchesAssessmentQuestionType(row.question_type, section.question_type),
    );
    const available = sectionTypeQuestions.filter((row) => !selectedIds.has(Number(row.id)));
    const difficultyQuestions = configuredDifficulty
      ? available.filter((row) =>
        String(row.difficulty_level ?? "").trim().toLocaleLowerCase() === configuredDifficulty.toLocaleLowerCase(),
      )
      : available;
    const selected = difficultyQuestions.slice(0, requestedCount);

    const sectionQuestions = selected.map((row) => {
      const id = Number(row.id);
      selectedIds.add(id);
      const question = makeAttemptQuestion(row, name, correctMark, wrongMark);
      snapshot.push(question);
      return question;
    });
    result.push({ name, questions: sectionQuestions });
  }

  return { sections: result, snapshot };
}

export function validateAttemptAnswer(question: AttemptQuestion, answer: unknown, requireMinimumWords = false) {
  const multipleChoice = question.question_type.trim().toLocaleLowerCase() === "multiple choice";
  if (multipleChoice ? !Array.isArray(answer) : typeof answer !== "string") {
    return multipleChoice
      ? "Multiple-choice answers must be a list of selected options."
      : "This question requires a text or single-option answer.";
  }
  const values = Array.isArray(answer) ? answer : [answer];
  if (values.some((value) => typeof value !== "string"
    || value.length > (Array.isArray(answer) ? 2_000 : 20_000))) {
    return "One or more answer values are invalid or too long.";
  }
  if (Array.isArray(answer) && new Set(answer).size !== answer.length) {
    return "Multiple-choice answers cannot contain duplicate options.";
  }
  if (question.options.length && values.some((value) => !question.options.includes(value))) {
    return "One or more selected options do not belong to this question.";
  }

  const text = values.join(" ");
  const minimumWords = Number(question.details.min_words);
  const maximumWords = Number(question.details.max_words);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (requireMinimumWords && text.trim() && Number.isFinite(minimumWords) && minimumWords > 0 && wordCount < minimumWords) {
    return `The answer must contain at least ${minimumWords} words.`;
  }
  if (text.trim() && Number.isFinite(maximumWords) && maximumWords > 0 && wordCount > maximumWords) {
    return `The answer cannot exceed ${maximumWords} words.`;
  }
  if (question.details.is_numeric === true && text.trim() && !Number.isFinite(Number(text.trim()))) {
    return "This question requires a numeric answer.";
  }
  return null;
}

export async function finalizeAttempt(
  client: PoolClient,
  attempt: AttemptRow,
  status: "submitted" | "expired",
  answers: Record<string, unknown> = attempt.answers,
  source: "candidate" | "invigilator" | "system" = status === "expired" ? "system" : "candidate",
) {
  await ensureExamTimelineTable();
  const saved = await client.query(
    `UPDATE assessment_candidate_attempts
     SET status = $2, answers = $3::jsonb, submitted_at = NOW()
     WHERE id = $1 AND status = 'in_progress'
     RETURNING submitted_at`,
    [attempt.id, status, JSON.stringify(answers)],
  );
  if (!saved.rowCount) return null;
  await recordExamTimelineEvent(
    client,
    attempt.assessment_id,
    attempt.candidate_id,
    status === "expired" ? "exam_time_expired" : "exam_submitted",
    source,
  );
  const submission = await client.query(`
    INSERT INTO assessment_candidate_submissions (
      assessment_id, candidate_id, answers, questions_snapshot,
      selfie_photo, id_photo, started_at, submitted_at
    )
    VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8)
    ON CONFLICT (assessment_id, candidate_id) DO NOTHING
    RETURNING submitted_at
  `, [
    attempt.assessment_id,
    attempt.candidate_id,
    JSON.stringify(answers),
    JSON.stringify(attempt.questions_snapshot),
    attempt.selfie_photo,
    attempt.id_photo,
    attempt.started_at,
    saved.rows[0].submitted_at,
  ]);
  if (!submission.rowCount) {
    throw new Error("A submission already exists for this examination and student.");
  }
  return submission.rows[0].submitted_at as Date;
}

async function finalizeExpiredAttempts(whereClause: string, values: number[]) {
  const client = await databasePool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await client.query(`
      SELECT id, assessment_id, candidate_id, status, answers, questions_snapshot,
             selfie_photo, id_photo, started_at, deadline_at, submitted_at
      FROM assessment_candidate_attempts
      WHERE ${whereClause} AND status = 'in_progress' AND deadline_at <= NOW()
      FOR UPDATE
    `, values);
    for (const attempt of result.rows as AttemptRow[]) {
      await finalizeAttempt(client, attempt, "expired");
    }
    await client.query("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function finalizeExpiredAttemptsForCandidate(candidateId: number) {
  return finalizeExpiredAttempts("candidate_id = $1", [candidateId]);
}

export async function finalizeExpiredAttemptsForAssessment(assessmentId: number) {
  return finalizeExpiredAttempts("assessment_id = $1", [assessmentId]);
}

export function attemptQuestionResponse(attempt: AttemptRow) {
  const grouped = new Map<string, PublicAttemptQuestion[]>();
  for (const question of attempt.questions_snapshot) {
    const safeDetails = sanitizeStudentDetails({ ...question.details, options: question.options }) as Record<string, unknown>;
    if (question.passage) safeDetails.passage = question.passage;
    else delete safeDetails.passage;
    delete safeDetails.answer;
    delete safeDetails.correct_answer;
    const safeQuestion = {
      id: question.id,
      question_type: question.question_type,
      question: question.question,
      details: safeDetails,
      section: question.section,
      correct_mark: question.correct_mark,
    };
    grouped.set(question.section, [...(grouped.get(question.section) ?? []), safeQuestion]);
  }
  return [...grouped].map(([name, questions]) => ({ name, questions }));
}
