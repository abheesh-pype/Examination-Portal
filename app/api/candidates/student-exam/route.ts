import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

type ExamSection = {
  name?: unknown;
  question_type?: unknown;
  question_count?: unknown;
  correct_mark?: unknown;
};

type SafeExamQuestion = {
  id: number;
  question_type: string;
  question: string;
  details: Record<string, unknown>;
  section: string;
  correct_mark: number;
};

async function ensureStudentExamTables() {
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
}

function getCandidateId(fields: Record<string, unknown>) {
  const entry = Object.entries(fields).find(([name, value]) =>
    /^candidate id(?:\s*\([^)]*\))?$/i.test(name.trim())
    && typeof value === "string"
    && /^\d{6}$/.test(value.trim()),
  );
  return entry ? String(entry[1]).trim() : "";
}

function matches(value: unknown, selected: unknown) {
  if (typeof selected !== "string" || !selected.trim()) return true;
  return typeof value === "string" && value.trim().toLocaleLowerCase() === selected.trim().toLocaleLowerCase();
}

function safeQuestionDetails(value: unknown) {
  const details = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const safeDetails = { ...details };
  delete safeDetails.answer;
  return safeDetails;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      candidateId?: unknown;
      dateOfBirth?: unknown;
      assessmentId?: unknown;
    };
    const candidateId = typeof body.candidateId === "string" ? body.candidateId.trim() : "";
    const dateOfBirth = typeof body.dateOfBirth === "string" ? body.dateOfBirth.trim() : "";
    const assessmentId = Number(body.assessmentId);
    if (!/^\d{6}$/.test(candidateId) || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || !Number.isInteger(assessmentId) || assessmentId <= 0) {
      return NextResponse.json({ error: "Valid student credentials and an assessment are required." }, { status: 400 });
    }

    await ensureStudentExamTables();
    const candidateResult = await databasePool.query(`
      SELECT candidate_data
      FROM "Candidate Information"
      WHERE record_type = 'candidate' AND status = TRUE
    `);
    const candidate = candidateResult.rows.find((row) => {
      const data = row.candidate_data as { fields?: Record<string, unknown> } | null;
      if (!data?.fields || getCandidateId(data.fields) !== candidateId) return false;
      const dobField = Object.entries(data.fields).find(([name, value]) =>
        /^(dob|date of birth|birth date)(\s*\([^)]*\))?$/i.test(name.trim())
        && typeof value === "string"
        && value.trim(),
      );
      return dobField ? String(dobField[1]).slice(0, 10) === dateOfBirth : false;
    });
    if (!candidate) {
      return NextResponse.json({ error: "Student credentials could not be verified." }, { status: 401 });
    }

    const candidateData = candidate.candidate_data as {
      category?: string | null;
      sub_category?: string | null;
    } | null;
    if (!candidateData?.category || !candidateData.sub_category) {
      return NextResponse.json({ error: "This student is not assigned to the assessment." }, { status: 403 });
    }

    const assessmentResult = await databasePool.query(`
      SELECT id, name, start_date, end_date, total_time, last_login,
             question_category, sub_category, topic, question_language, sections
      FROM assessment
      WHERE id = $1 AND status = TRUE
    `, [assessmentId]);
    const assessment = assessmentResult.rows[0];
    if (!assessment) {
      return NextResponse.json({ error: "Assessment not found or inactive." }, { status: 404 });
    }

    const assignmentResult = await databasePool.query(`
      SELECT 1
      FROM assessment_candidate_sub_category AS assignment
      JOIN candidate_sub_category AS candidate_group
        ON candidate_group.id = assignment.candidate_sub_category_id
      WHERE assignment.assessment_id = $1
        AND candidate_group.status = TRUE
        AND candidate_group.category = $2
        AND candidate_group.candidate_sub_category = $3
      LIMIT 1
    `, [assessmentId, candidateData.category, candidateData.sub_category]);
    if (assignmentResult.rowCount === 0) {
      return NextResponse.json({ error: "This student is not assigned to the assessment." }, { status: 403 });
    }

    const now = Date.now();
    const startTime = assessment.start_date ? new Date(assessment.start_date).getTime() : Number.NaN;
    const endTime = assessment.end_date ? new Date(assessment.end_date).getTime() : Number.POSITIVE_INFINITY;
    const loginDeadline = assessment.last_login !== null && Number(assessment.last_login) > 0
      ? startTime + Number(assessment.last_login) * 60_000
      : Number.POSITIVE_INFINITY;
    const accessDeadline = Math.min(endTime, loginDeadline);
    if (!Number.isFinite(startTime) || now < startTime || now >= accessDeadline) {
      return NextResponse.json({ error: "This assessment is outside its permitted attendance window." }, { status: 403 });
    }

    const questionResult = await databasePool.query(`
      SELECT id, question_type, question, category, sub_category, topic, language, details
      FROM questions
      WHERE status = TRUE
      ORDER BY created_at DESC, id DESC
    `);
    const matchedQuestions = questionResult.rows.filter((question) =>
      matches(question.category, assessment.question_category)
      && matches(question.sub_category, assessment.sub_category)
      && matches(question.topic, assessment.topic)
      && matches(question.language, assessment.question_language),
    );
    const sections = Array.isArray(assessment.sections) ? assessment.sections as ExamSection[] : [];
    const configuredSections: ExamSection[] = sections.length
      ? sections
      : [{ name: "Section A", question_type: "", question_count: "" }];
    const assignedQuestionIds = new Set<number>();
    const examSections: Array<{ name: string; questions: SafeExamQuestion[] }> = configuredSections.map((section, index) => {
      const sectionName = typeof section.name === "string" && section.name.trim()
        ? section.name.trim()
        : `Section ${String.fromCharCode(65 + index)}`;
      const questionType = typeof section.question_type === "string" ? section.question_type : "";
      const questionCount = Number(section.question_count);
      const limit = Number.isInteger(questionCount) && questionCount > 0 ? questionCount : Number.POSITIVE_INFINITY;
      const selectedQuestions = matchedQuestions
        .filter((question) => !assignedQuestionIds.has(Number(question.id))
          && (!questionType || String(question.question_type).toLocaleLowerCase() === questionType.toLocaleLowerCase()))
        .slice(0, limit);
      const correctMark = Number(section.correct_mark);
      const questions: SafeExamQuestion[] = selectedQuestions.map((question) => {
        const id = Number(question.id);
        assignedQuestionIds.add(id);
        return {
          id,
          question_type: String(question.question_type),
          question: String(question.question),
          details: safeQuestionDetails(question.details),
          section: sectionName,
          correct_mark: Number.isFinite(correctMark) ? correctMark : 0,
        };
      });
      return { name: sectionName, questions };
    });
    const extras = matchedQuestions.filter((question) => !assignedQuestionIds.has(Number(question.id)));
    if (extras.length) {
      examSections.push({
        name: "Other Questions",
        questions: extras.map((question) => ({
          id: Number(question.id),
          question_type: String(question.question_type),
          question: String(question.question),
          details: safeQuestionDetails(question.details),
          section: "Other Questions",
          correct_mark: 0,
        })),
      });
    }

    const durationMinutes = Number(assessment.total_time);
    return NextResponse.json({
      assessment: { id: assessment.id, name: assessment.name },
      duration_seconds: Number.isFinite(durationMinutes) && durationMinutes > 0 ? Math.floor(durationMinutes * 60) : null,
      end_at: Number.isFinite(endTime) ? new Date(endTime).toISOString() : null,
      sections: examSections.filter((section) => section.questions.length > 0),
    });
  } catch (error) {
    console.error("Failed to start student assessment", error);
    return NextResponse.json({ error: "Unable to start assessment." }, { status: 500 });
  }
}
