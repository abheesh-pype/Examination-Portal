import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

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
};

type CandidateEvaluationData = {
  fields?: Record<string, unknown>;
  category?: string | null;
  sub_category?: string | null;
};

async function ensureEvaluationTables() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment (
      id SERIAL PRIMARY KEY,
      examination TEXT NOT NULL,
      name TEXT NOT NULL,
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      total_time INTEGER,
      last_login INTEGER,
      question_category TEXT,
      sub_category TEXT,
      topic TEXT,
      question_language TEXT,
      sections JSONB NOT NULL DEFAULT '[]'::jsonb,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      mobile TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS "Candidate Information" (
      id SERIAL PRIMARY KEY,
      record_type TEXT NOT NULL DEFAULT 'field',
      name TEXT NOT NULL,
      column_type TEXT NOT NULL,
      is_dependent BOOLEAN NOT NULL DEFAULT FALSE,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      is_required BOOLEAN NOT NULL DEFAULT FALSE,
      min_value NUMERIC,
      max_value NUMERIC,
      options JSONB,
      dependent_on TEXT,
      date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      candidate_data JSONB
    )
  `);
  await databasePool.query('ALTER TABLE "Candidate Information" ADD COLUMN IF NOT EXISTS record_type TEXT NOT NULL DEFAULT \'field\'');
  await databasePool.query('ALTER TABLE "Candidate Information" ADD COLUMN IF NOT EXISTS candidate_data JSONB');
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS candidate_sub_category (
      id SERIAL PRIMARY KEY,
      candidate_sub_category TEXT NOT NULL,
      category TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_sub_category (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_sub_category_id INTEGER NOT NULL REFERENCES candidate_sub_category(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_sub_category_id)
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_evaluator (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      evaluator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_id)
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS questions (
      id SERIAL PRIMARY KEY,
      question_type TEXT NOT NULL,
      question TEXT NOT NULL,
      category TEXT,
      sub_category TEXT,
      topic TEXT,
      difficulty_level TEXT,
      language TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_submissions (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      answers JSONB NOT NULL DEFAULT '{}'::jsonb,
      questions_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
      selfie_photo TEXT NOT NULL,
      id_photo TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      evaluated_at TIMESTAMPTZ,
      obtained_mark NUMERIC,
      manual_marks JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (assessment_id, candidate_id)
    )
  `);
  await databasePool.query(`
    ALTER TABLE assessment_candidate_submissions
    ADD COLUMN IF NOT EXISTS questions_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getCandidateId(fields: Record<string, unknown>) {
  const entry = Object.entries(fields).find(([name, value]) =>
    /^candidate id(?:\s*\([^)]*\))?$/i.test(name.trim())
    && typeof value === "string"
    && /^\d{6}$/.test(value.trim()),
  );
  return entry ? String(entry[1]).trim() : "";
}

function getCandidateField(fields: Record<string, unknown>, pattern: RegExp) {
  const entry = Object.entries(fields).find(([name, value]) =>
    pattern.test(name.trim()) && typeof value === "string" && value.trim(),
  );
  return entry ? String(entry[1]).trim() : "";
}

function matches(value: unknown, selected: unknown) {
  if (typeof selected !== "string" || !selected.trim()) return true;
  return typeof value === "string" && value.trim().toLocaleLowerCase() === selected.trim().toLocaleLowerCase();
}

async function getEvaluationAccess(assessmentId: number, accountUserId: number) {
  const userResult = await databasePool.query(
    "SELECT id, role FROM users WHERE id = $1 AND status = TRUE",
    [accountUserId],
  );
  if (!userResult.rowCount) return { error: "An active staff account is required.", status: 403 as const };
  const role = String(userResult.rows[0].role ?? "").trim().toLocaleLowerCase();
  const isAdmin = role.includes("admin");
  if (!isAdmin && role !== "evaluator") {
    return { error: "Only administrators and evaluators can evaluate assessments.", status: 403 as const };
  }
  const assessmentResult = await databasePool.query(`
    SELECT id, examination, name, start_date, sections, question_category,
           sub_category, topic, question_language
    FROM assessment WHERE id = $1
  `, [assessmentId]);
  if (!assessmentResult.rowCount) return { error: "Assessment not found or inactive.", status: 404 as const };
  return { isAdmin, assessment: assessmentResult.rows[0] };
}

async function canAccessCandidate(assessmentId: number, candidateId: number, accountUserId: number, isAdmin: boolean) {
  if (isAdmin) {
    const result = await databasePool.query(`
      SELECT 1
      FROM "Candidate Information" AS candidate
      JOIN candidate_sub_category AS candidate_group
        ON candidate_group.status = TRUE
        AND candidate_group.category = BTRIM(COALESCE(candidate.candidate_data->>'category', ''))
        AND candidate_group.candidate_sub_category = BTRIM(COALESCE(candidate.candidate_data->>'sub_category', ''))
      JOIN assessment_candidate_sub_category AS cohort_assignment
        ON cohort_assignment.candidate_sub_category_id = candidate_group.id
        AND cohort_assignment.assessment_id = $1
      WHERE candidate.id = $2 AND candidate.record_type = 'candidate'
      LIMIT 1
    `, [assessmentId, candidateId]);
    return Boolean(result.rowCount);
  }
  const result = await databasePool.query(`
    SELECT 1 FROM assessment_candidate_evaluator
    WHERE assessment_id = $1 AND candidate_id = $2 AND evaluator_user_id = $3
    LIMIT 1
  `, [assessmentId, candidateId, accountUserId]);
  return Boolean(result.rowCount);
}

function getConfiguredMaximumMark(assessment: Record<string, unknown>) {
  if (!Array.isArray(assessment.sections)) return null;
  let maximumMark = 0;
  let hasConfiguredSection = false;

  for (const section of assessment.sections) {
    if (!isRecord(section)) continue;
    const questionCount = Number(section.question_count);
    const correctMark = Number(section.correct_mark);
    if (!Number.isFinite(questionCount) || questionCount <= 0 || !Number.isFinite(correctMark) || correctMark < 0) continue;
    maximumMark += questionCount * correctMark;
    hasConfiguredSection = true;
  }

  return hasConfiguredSection ? maximumMark : null;
}

function getConfiguredQuestionMark(
  assessment: Record<string, unknown>,
  question: Record<string, unknown>,
) {
  if (!Array.isArray(assessment.sections)) return null;
  const sections = assessment.sections.filter(isRecord);
  const questionSection = String(question.section ?? "").trim().toLocaleLowerCase();
  const questionType = String(question.question_type ?? "").trim().toLocaleLowerCase();
  const section = sections.find((candidate) => {
    const name = String(candidate.name ?? "").trim().toLocaleLowerCase();
    return name && (name === questionSection || `section ${name}` === questionSection);
  }) ?? (() => {
    const matchingSections = sections.filter((candidate) =>
      String(candidate.question_type ?? "").trim().toLocaleLowerCase() === questionType
      && Number.isFinite(Number(candidate.correct_mark))
      && Number(candidate.correct_mark) > 0,
    );
    return matchingSections.length === 1 ? matchingSections[0] : undefined;
  })();

  if (!section) return null;
  const correctMark = Number(section.correct_mark);
  return Number.isFinite(correctMark) && correctMark > 0 ? correctMark : null;
}

async function loadEvaluationQuestions(assessment: Record<string, unknown>, snapshot?: unknown): Promise<EvaluationQuestion[]> {
  if (Array.isArray(snapshot) && snapshot.length > 0) {
    return snapshot.filter(isRecord).map((question) => ({
      id: Number(question.id),
      question_type: String(question.question_type ?? ""),
      question: String(question.question ?? ""),
      section: String(question.section ?? ""),
      options: Array.isArray(question.options)
        ? question.options.filter((option: unknown): option is string => typeof option === "string")
        : [],
      correct_answer: question.correct_answer ?? null,
      correct_mark: Number.isFinite(Number(question.correct_mark)) && Number(question.correct_mark) > 0
        ? Number(question.correct_mark)
        : getConfiguredQuestionMark(assessment, question) ?? 0,
      wrong_mark: Number.isFinite(Number(question.wrong_mark)) && Number(question.wrong_mark) <= 0
        ? Number(question.wrong_mark)
        : 0,
      passage: typeof question.passage === "string" ? question.passage : null,
    }));
  }
  const result = await databasePool.query(`
    SELECT id, question_type, question, category, sub_category, topic, language, details
    FROM questions WHERE status = TRUE ORDER BY created_at DESC, id DESC
  `);
  const questions = result.rows.filter((question) =>
    matches(question.category, assessment.question_category)
    && matches(question.sub_category, assessment.sub_category)
    && matches(question.topic, assessment.topic)
    && matches(question.language, assessment.question_language),
  );
  const configuredSections = Array.isArray(assessment.sections)
    ? assessment.sections as Array<Record<string, unknown>>
    : [];
  const sections = configuredSections.length ? configuredSections : [{}];
  const assignedQuestionIds = new Set<number>();
  const evaluationQuestions: EvaluationQuestion[] = [];

  for (const [index, section] of sections.entries()) {
    const sectionName = typeof section.name === "string" && section.name.trim()
      ? section.name.trim()
      : `Section ${String.fromCharCode(65 + index)}`;
    const questionType = typeof section.question_type === "string" ? section.question_type : "";
    const questionCount = Number(section.question_count);
    const limit = Number.isInteger(questionCount) && questionCount > 0 ? questionCount : Number.POSITIVE_INFINITY;
    const correctMark = Number(section.correct_mark);
    const wrongMark = Number(section.wrong_mark);
    const selected = questions
      .filter((question) => !assignedQuestionIds.has(Number(question.id))
        && (!questionType || String(question.question_type).toLocaleLowerCase() === questionType.toLocaleLowerCase()))
      .slice(0, limit);

    for (const question of selected) {
      const id = Number(question.id);
      assignedQuestionIds.add(id);
      const details = isRecord(question.details) ? question.details : {};
      evaluationQuestions.push({
        id,
        question_type: String(question.question_type),
        question: String(question.question),
        section: sectionName,
        options: Array.isArray(details.options) ? details.options.filter((option: unknown): option is string => typeof option === "string") : [],
        correct_answer: details.answer ?? null,
        correct_mark: Number.isFinite(correctMark) ? correctMark : 0,
        wrong_mark: Number.isFinite(wrongMark) && wrongMark <= 0 ? wrongMark : 0,
        passage: typeof details.passage === "string" && details.passage ? details.passage : null,
      });
    }
  }

  for (const question of questions) {
    const id = Number(question.id);
    if (assignedQuestionIds.has(id)) continue;
    const details = isRecord(question.details) ? question.details : {};
    evaluationQuestions.push({
      id,
      question_type: String(question.question_type),
      question: String(question.question),
      section: "Other Questions",
      options: Array.isArray(details.options) ? details.options.filter((option: unknown): option is string => typeof option === "string") : [],
      correct_answer: details.answer ?? null,
      correct_mark: 0,
      wrong_mark: 0,
      passage: typeof details.passage === "string" && details.passage ? details.passage : null,
    });
  }
  return evaluationQuestions;
}

function normalizeAnswer(answer: unknown): string | string[] {
  if (Array.isArray(answer)) {
    return answer.map((value) => String(value).trim().toLocaleLowerCase()).sort();
  }
  return answer === null || answer === undefined ? "" : String(answer).trim().toLocaleLowerCase();
}

function answersEqual(first: unknown, second: unknown) {
  const a = normalizeAnswer(first);
  const b = normalizeAnswer(second);
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return !Array.isArray(a) && !Array.isArray(b) && a === b;
}

function isManualQuestion(question: EvaluationQuestion) {
  return /manual|passage/i.test(question.question_type);
}

function scoreSubmission(
  questions: EvaluationQuestion[],
  answers: Record<string, unknown>,
  manualMarks: Record<string, unknown>,
) {
  let obtainedMark = 0;
  let totalMarks = 0;
  const grades = questions.map((question) => {
    totalMarks += Math.max(0, question.correct_mark);
    const answer = answers[String(question.id)];
    if (isManualQuestion(question)) {
      const manualMark = Number(manualMarks[String(question.id)]);
      const grade = Number.isFinite(manualMark) ? Math.min(Math.max(manualMark, 0), Math.max(question.correct_mark, 0)) : null;
      if (grade !== null) obtainedMark += grade;
      return { question_id: question.id, answer, status: grade === null ? "manual" : grade > 0 ? "correct" : "incorrect", mark: grade };
    }
    const hasAnswer = Array.isArray(answer)
      ? answer.some((value) => typeof value === "string" && value.trim())
      : typeof answer === "string" && answer.trim().length > 0;
    const isCorrect = hasAnswer && question.correct_answer !== null && answersEqual(answer, question.correct_answer);
    const mark = isCorrect ? Math.max(0, question.correct_mark) : 0;
    obtainedMark += mark;
    return { question_id: question.id, answer, status: !hasAnswer ? "unanswered" : isCorrect ? "correct" : "incorrect", mark };
  });
  return { obtainedMark, totalMarks, grades };
}

export async function GET(request: Request) {
  try {
    await ensureEvaluationTables();
    const params = new URL(request.url).searchParams;
    const assessmentId = Number(params.get("assessmentId"));
    const accountUserId = Number(params.get("accountUserId"));
    const candidateId = Number(params.get("candidateId"));
    if (!Number.isInteger(assessmentId) || assessmentId <= 0
      || !Number.isInteger(accountUserId) || accountUserId <= 0) {
      return NextResponse.json({ error: "Valid assessment and staff account ids are required." }, { status: 400 });
    }
    const access = await getEvaluationAccess(assessmentId, accountUserId);
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
    const assessment = access.assessment as Record<string, unknown>;

    if (params.has("candidateId")) {
      if (!Number.isInteger(candidateId) || candidateId <= 0) {
        return NextResponse.json({ error: "A valid candidate id is required." }, { status: 400 });
      }
      if (!await canAccessCandidate(assessmentId, candidateId, accountUserId, access.isAdmin)) {
        return NextResponse.json({ error: "This candidate is not assigned to your evaluation list." }, { status: 403 });
      }
      const submissionResult = await databasePool.query(`
        SELECT candidate.id AS candidate_id, candidate.name AS candidate_name,
               candidate.candidate_data, submission.answers, submission.questions_snapshot, submission.selfie_photo,
               submission.id_photo, submission.started_at, submission.submitted_at,
               submission.evaluated_at, submission.obtained_mark, submission.manual_marks
        FROM assessment_candidate_submissions AS submission
        JOIN "Candidate Information" AS candidate ON candidate.id = submission.candidate_id
        WHERE submission.assessment_id = $1 AND submission.candidate_id = $2
      `, [assessmentId, candidateId]);
      if (!submissionResult.rowCount) {
        return NextResponse.json({ error: "This candidate has not submitted the assessment yet." }, { status: 404 });
      }

      const submission = submissionResult.rows[0];
      const data = submission.candidate_data as CandidateEvaluationData | null;
      const fields = isRecord(data?.fields) ? data.fields : {};
      const questions = await loadEvaluationQuestions(assessment, submission.questions_snapshot);
      const answers = isRecord(submission.answers) ? submission.answers : {};
      const manualMarks = isRecord(submission.manual_marks) ? submission.manual_marks : {};
      const score = scoreSubmission(questions, answers, manualMarks);
      const gradesById = new Map(score.grades.map((grade) => [grade.question_id, grade]));
      return NextResponse.json({
        assessment: {
          id: assessmentId,
          name: String(assessment.name ?? ""),
          examination: String(assessment.examination ?? ""),
        },
        candidate: {
          id: Number(submission.candidate_id),
          name: getCandidateField(fields, /^candidate name(?:\s*\([^)]*\))?$/i) || String(submission.candidate_name),
          candidate_id: getCandidateId(fields),
          category: typeof data?.category === "string" ? data.category : "",
          sub_category: typeof data?.sub_category === "string" ? data.sub_category : "",
        },
        started_at: submission.started_at,
        submitted_at: submission.submitted_at,
        evaluated_at: submission.evaluated_at,
        obtained_mark: submission.obtained_mark === null ? null : Number(submission.obtained_mark),
        max_mark: getConfiguredMaximumMark(assessment) ?? score.totalMarks,
        answers,
        manual_marks: manualMarks,
        selfie_photo: submission.selfie_photo,
        id_photo: submission.id_photo,
        questions: questions.map((question) => ({
          ...question,
          grade: gradesById.get(question.id),
          is_manual: isManualQuestion(question),
        })),
      });
    }

    const candidatesResult = await databasePool.query(`
      SELECT DISTINCT ON (candidate.id)
        candidate.id AS candidate_id,
        candidate.name AS candidate_name,
        candidate.candidate_data,
        candidate.candidate_data->>'category' AS category,
        candidate.candidate_data->>'sub_category' AS sub_category,
        submission.submitted_at,
        submission.started_at,
        submission.evaluated_at,
        submission.obtained_mark
      FROM "Candidate Information" AS candidate
      LEFT JOIN candidate_sub_category AS candidate_group
        ON candidate_group.status = TRUE
        AND candidate_group.category = BTRIM(COALESCE(candidate.candidate_data->>'category', ''))
        AND candidate_group.candidate_sub_category = BTRIM(COALESCE(candidate.candidate_data->>'sub_category', ''))
      LEFT JOIN assessment_candidate_sub_category AS cohort_assignment
        ON cohort_assignment.assessment_id = $1
        AND cohort_assignment.candidate_sub_category_id = candidate_group.id
      LEFT JOIN assessment_candidate_evaluator AS evaluator_assignment
        ON evaluator_assignment.assessment_id = $1
        AND evaluator_assignment.candidate_id = candidate.id
        AND evaluator_assignment.evaluator_user_id = $2
      LEFT JOIN assessment_candidate_submissions AS submission
        ON submission.assessment_id = $1 AND submission.candidate_id = candidate.id
      WHERE candidate.record_type = 'candidate'
        AND (($3::boolean AND cohort_assignment.assessment_id IS NOT NULL)
          OR (NOT $3::boolean AND evaluator_assignment.evaluator_user_id = $2))
      ORDER BY candidate.id, submission.submitted_at DESC NULLS LAST
    `, [assessmentId, accountUserId, access.isAdmin]);

    return NextResponse.json({
      assessment: {
        id: assessmentId,
        name: String(assessment.name ?? ""),
        examination: String(assessment.examination ?? ""),
      },
      candidates: candidatesResult.rows.map((row) => {
        const data = row.candidate_data as CandidateEvaluationData | null;
        const fields = isRecord(data?.fields) ? data.fields : {};
        return {
          candidate_id: Number(row.candidate_id),
          candidate_name: getCandidateField(fields, /^candidate name(?:\s*\([^)]*\))?$/i) || String(row.candidate_name),
          candidate_code: getCandidateId(fields),
          category: typeof row.category === "string" ? row.category.trim() : "",
          sub_category: typeof row.sub_category === "string" ? row.sub_category.trim() : "",
          status: row.evaluated_at ? "Evaluated" : row.submitted_at ? "Submitted" : "Pending",
          has_submission: Boolean(row.submitted_at),
          started_at: row.started_at,
          submitted_at: row.submitted_at,
          evaluated_at: row.evaluated_at,
          obtained_mark: row.obtained_mark === null ? null : Number(row.obtained_mark),
        };
      }),
    });
  } catch (error) {
    console.error("Failed to load assessment evaluations", error);
    return NextResponse.json({ error: "Unable to load assessment evaluations." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureEvaluationTables();
    const body = await request.json() as {
      assessmentId?: unknown;
      accountUserId?: unknown;
      candidateId?: unknown;
      manualMarks?: unknown;
    };
    const assessmentId = Number(body.assessmentId);
    const accountUserId = Number(body.accountUserId);
    const candidateId = Number(body.candidateId);
    const manualMarks = body.manualMarks;
    if (!Number.isInteger(assessmentId) || assessmentId <= 0
      || !Number.isInteger(accountUserId) || accountUserId <= 0
      || !Number.isInteger(candidateId) || candidateId <= 0
      || !isRecord(manualMarks)) {
      return NextResponse.json({ error: "Valid assessment, staff, candidate, and manual marks are required." }, { status: 400 });
    }
    const access = await getEvaluationAccess(assessmentId, accountUserId);
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
    if (!await canAccessCandidate(assessmentId, candidateId, accountUserId, access.isAdmin)) {
      return NextResponse.json({ error: "This candidate is not assigned to your evaluation list." }, { status: 403 });
    }

    const submissionResult = await databasePool.query(`
      SELECT answers, questions_snapshot FROM assessment_candidate_submissions
      WHERE assessment_id = $1 AND candidate_id = $2
    `, [assessmentId, candidateId]);
    if (!submissionResult.rowCount) {
      return NextResponse.json({ error: "This candidate has not submitted the assessment yet." }, { status: 404 });
    }
    const questions = await loadEvaluationQuestions(access.assessment as Record<string, unknown>, submissionResult.rows[0].questions_snapshot);
    const answers = isRecord(submissionResult.rows[0].answers) ? submissionResult.rows[0].answers : {};
    const validManualQuestionIds = new Set(questions.filter(isManualQuestion).map((question) => String(question.id)));
    for (const [questionId, rawMark] of Object.entries(manualMarks)) {
      if (!validManualQuestionIds.has(questionId)
        || typeof rawMark !== "number"
        || !Number.isFinite(rawMark)
        || rawMark < 0
        || rawMark > (questions.find((question) => String(question.id) === questionId)?.correct_mark ?? 0)) {
        return NextResponse.json({ error: "One or more manual marks are invalid." }, { status: 400 });
      }
    }
    if (questions.some((question) => isManualQuestion(question)
      && !Number.isFinite(Number(manualMarks[String(question.id)])))) {
      return NextResponse.json({ error: "Enter a mark for every manual-evaluation question before completing the evaluation." }, { status: 400 });
    }
    const score = scoreSubmission(questions, answers, manualMarks);
    const updated = await databasePool.query(`
      UPDATE assessment_candidate_submissions
      SET manual_marks = $3::jsonb, obtained_mark = $4, evaluated_at = NOW()
      WHERE assessment_id = $1 AND candidate_id = $2 AND evaluated_at IS NULL
      RETURNING evaluated_at
    `, [assessmentId, candidateId, JSON.stringify(manualMarks), score.obtainedMark]);
    if (!updated.rowCount) {
      return NextResponse.json({ error: "This candidate has already been evaluated." }, { status: 409 });
    }
    return NextResponse.json({
      evaluated: true,
      evaluated_at: updated.rows[0].evaluated_at,
      obtained_mark: score.obtainedMark,
      max_mark: getConfiguredMaximumMark(access.assessment as Record<string, unknown>) ?? score.totalMarks,
    });
  } catch (error) {
    console.error("Failed to save assessment evaluation", error);
    return NextResponse.json({ error: "Unable to save this evaluation." }, { status: 500 });
  }
}
