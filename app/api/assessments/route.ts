import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/auth";
import { matchesAssessmentQuestionType } from "@/lib/question-types";

export const runtime = "nodejs";

type AssessmentPayload = {
  id?: unknown;
  examination?: unknown;
  name?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  total_time?: unknown;
  last_login?: unknown;
  pass_mark?: unknown;
  question_category?: unknown;
  sub_category?: unknown;
  topic?: unknown;
  question_language?: unknown;
  sections?: unknown;
};

async function ensureAssessmentTable() {
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
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ");
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ");
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS total_time INTEGER");
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS last_login INTEGER");
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS question_category TEXT");
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS sub_category TEXT");
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS topic TEXT");
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS question_language TEXT");
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '[]'::jsonb");
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS status BOOLEAN NOT NULL DEFAULT TRUE");
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS pass_mark NUMERIC");
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
    CREATE TABLE IF NOT EXISTS assessment_candidate_invigilator (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      invigilator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_id)
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
}

type ActiveQuestion = {
  id: number | string;
  question_type: string;
  difficulty_level: string | null;
  category: string | null;
  sub_category: string | null;
  topic: string | null;
  language: string | null;
};

type AssessmentWithSections = {
  sections?: unknown;
  question_category?: string | null;
  sub_category?: string | null;
  topic?: string | null;
  question_language?: string | null;
};

async function loadActiveQuestions(): Promise<ActiveQuestion[]> {
  const result = await databasePool.query(`
    SELECT id, question_type, difficulty_level, category, sub_category, topic, language
    FROM questions
    WHERE status = TRUE
    ORDER BY created_at DESC, id DESC
  `);
  return result.rows;
}

function hasMatchingActiveQuestion(assessment: AssessmentWithSections, activeQuestions: ActiveQuestion[]) {
  const matchesText = (questionValue: string | null, assessmentValue: string | null | undefined) =>
    !assessmentValue?.trim()
    || questionValue?.trim().toLocaleLowerCase() === assessmentValue.trim().toLocaleLowerCase();
  const matchingQuestions = activeQuestions.filter((question) =>
    matchesText(question.category, assessment.question_category)
    && matchesText(question.sub_category, assessment.sub_category)
    && matchesText(question.topic, assessment.topic)
    && matchesText(question.language, assessment.question_language),
  );
  if (!Array.isArray(assessment.sections) || assessment.sections.length === 0) {
    return matchingQuestions.length > 0;
  }
  return assessment.sections.some((section) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) return false;
    const config = section as Record<string, unknown>;
    const requestedCount = Number(config.question_count);
    if (!Number.isInteger(requestedCount) || requestedCount <= 0) return false;
    const difficulty = typeof config.difficulty_level === "string" ? config.difficulty_level.trim() : "";
    return matchingQuestions.some((question) =>
      matchesAssessmentQuestionType(question.question_type, config.question_type)
      && (!difficulty || question.difficulty_level?.trim().toLocaleLowerCase() === difficulty.toLocaleLowerCase()),
    );
  });
}

const optionalText = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const optionalInteger = (value: unknown) => {
  if ((typeof value !== "string" && typeof value !== "number") || !String(value).trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};
const optionalMark = (value: unknown) => {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return null;
  if (typeof value !== "string" && typeof value !== "number") return Number.NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};
const optionalDate = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
function getTotalMark(sections: unknown) {
  if (!Array.isArray(sections)) return 0;
  return sections.reduce((total, section) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) return total;
    const value = section as Record<string, unknown>;
    const questionCount = Number(value.question_count);
    const correctMark = Number(value.correct_mark);
    return Number.isFinite(questionCount) && questionCount > 0
      && Number.isFinite(correctMark) && correctMark >= 0
      ? total + questionCount * correctMark
      : total;
  }, 0);
}
const hasInvalidWrongMark = (sections: unknown) => Array.isArray(sections) && sections.some((section) => {
  if (!section || typeof section !== "object" || Array.isArray(section)) return false;
  const wrongMark = (section as { wrong_mark?: unknown }).wrong_mark;
  if (wrongMark === undefined || wrongMark === null || wrongMark === "") return false;
  const parsed = typeof wrongMark === "number" || typeof wrongMark === "string" ? Number(wrongMark) : Number.NaN;
  return !Number.isFinite(parsed) || parsed > 0;
});

function validateAssessmentConfiguration(body: AssessmentPayload) {
  const errors: string[] = [];
  const startDateText = optionalText(body.start_date);
  const endDateText = optionalText(body.end_date);
  const startDate = optionalDate(startDateText);
  const endDate = optionalDate(endDateText);
  const totalTimeText = optionalText(body.total_time);
  const lastLoginText = optionalText(body.last_login);
  const passMark = optionalMark(body.pass_mark);
  const totalTime = optionalInteger(body.total_time);
  const lastLogin = optionalInteger(body.last_login);

  if (startDateText && !startDate) errors.push("Start Date is invalid.");
  if (endDateText && !endDate) errors.push("End Date is invalid.");
  if (startDate && endDate && new Date(endDate) <= new Date(startDate)) {
    errors.push("End Date must be later than Start Date.");
  }
  if (totalTimeText && (totalTime === null || totalTime < 1)) {
    errors.push("Total Time must be a positive whole number.");
  }
  if (lastLoginText && (lastLogin === null || lastLogin < 1)) {
    errors.push("Last Login Time must be a positive whole number.");
  }
  if (Number.isNaN(passMark) || (passMark !== null && passMark < 0)) {
    errors.push("Pass Mark must be zero or a positive number.");
  } else if (passMark !== null && passMark > getTotalMark(body.sections)) {
    errors.push("Pass Mark cannot be greater than Total Mark.");
  }

  if (body.sections !== undefined && !Array.isArray(body.sections)) {
    errors.push("Sections must be an array.");
  }
  const sections = Array.isArray(body.sections) ? body.sections : [];
  const names = new Set<string>();
  for (const [index, section] of sections.entries()) {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      errors.push(`Section ${index + 1} is invalid.`);
      continue;
    }
    const value = section as Record<string, unknown>;
    const name = optionalText(value.name);
    const questionType = optionalText(value.question_type);
    const count = optionalInteger(value.question_count);
    const correctMark = Number(value.correct_mark);
    const wrongMark = value.wrong_mark === undefined || value.wrong_mark === "" ? 0 : Number(value.wrong_mark);
    if (!questionType) errors.push(`Section ${index + 1} must specify a question type.`);
    if (count === null || count < 1) errors.push(`Section ${index + 1} question count must be a positive whole number.`);
    if (value.correct_mark === undefined || value.correct_mark === "" || !Number.isFinite(correctMark) || correctMark < 0) {
      errors.push(`Section ${index + 1} correct mark must be zero or a positive number.`);
    }
    if (!Number.isFinite(wrongMark) || wrongMark > 0) {
      errors.push(`Section ${index + 1} wrong mark must be zero or a negative number.`);
    }
    if (name) {
      const normalizedName = name.toLocaleLowerCase();
      if (names.has(normalizedName)) errors.push(`Section name "${name}" is duplicated.`);
      names.add(normalizedName);
    }
    if (value.difficulty_level !== undefined && value.difficulty_level !== null
      && (typeof value.difficulty_level !== "string" || value.difficulty_level.trim().length > 100)) {
      errors.push(`Section ${index + 1} difficulty level is invalid.`);
    }
  }

  return errors;
}

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    await ensureAssessmentTable();
    const userRole = authorization.user?.role.trim().toLocaleLowerCase();
    const assignedInvigilatorId = userRole === "invigilator" ? authorization.user?.id ?? null : null;
    const assignedEvaluatorId = userRole === "evaluator" ? authorization.user?.id ?? null : null;
    const activeQuestions = await loadActiveQuestions();
    const result = await databasePool.query(`
      SELECT id, examination, name, start_date, end_date, total_time, last_login,
             pass_mark,
             question_category, sub_category, topic, question_language, sections,
             status, created_at,
             COALESCE((
               SELECT SUM(
                 CASE
                   WHEN jsonb_typeof(section.value) = 'object'
                     AND NULLIF(BTRIM(section.value->>'question_count'), '') ~ '^[0-9]+([.][0-9]+)?$'
                     AND NULLIF(BTRIM(section.value->>'correct_mark'), '') ~ '^[0-9]+([.][0-9]+)?$'
                   THEN (section.value->>'question_count')::numeric * (section.value->>'correct_mark')::numeric
                   ELSE 0
                 END
               )
               FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(assessment.sections) = 'array' THEN assessment.sections ELSE '[]'::jsonb END
               ) AS section(value)
             ), 0) AS total_marks,
             (
               SELECT COUNT(DISTINCT candidate.id)::int
               FROM assessment_candidate_sub_category AS assignment
               JOIN candidate_sub_category AS candidate_group
                 ON candidate_group.id = assignment.candidate_sub_category_id
                AND candidate_group.status = TRUE
               JOIN "Candidate Information" AS candidate
                 ON candidate.record_type = 'candidate'
                AND candidate.status = TRUE
                AND BTRIM(COALESCE(candidate.candidate_data->>'category', '')) = candidate_group.category
                AND BTRIM(COALESCE(candidate.candidate_data->>'sub_category', '')) = candidate_group.candidate_sub_category
               WHERE assignment.assessment_id = assessment.id
             ) AS candidate_count
      FROM assessment
      WHERE ($1::integer IS NULL AND $2::integer IS NULL)
         OR EXISTS (
           SELECT 1
           FROM assessment_candidate_invigilator AS invigilator_assignment
           WHERE invigilator_assignment.assessment_id = assessment.id
             AND invigilator_assignment.invigilator_user_id = $1
         )
         OR EXISTS (
           SELECT 1
           FROM assessment_candidate_evaluator AS evaluator_assignment
           WHERE evaluator_assignment.assessment_id = assessment.id
             AND evaluator_assignment.evaluator_user_id = $2
         )
      ORDER BY created_at DESC, id DESC
    `, [assignedInvigilatorId, assignedEvaluatorId]);
    return NextResponse.json(result.rows.map((assessment) => ({
      ...assessment,
      has_active_questions: hasMatchingActiveQuestion(assessment, activeQuestions),
    })));
  } catch (error) {
    console.error("Failed to load assessments", error);
    return NextResponse.json({ error: "Unable to load assessments" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as AssessmentPayload;

    if (Array.isArray((body as AssessmentPayload & { rows?: unknown }).rows)) {
      const rows = (body as AssessmentPayload & { rows: unknown[] }).rows;
      if (rows.length === 0 || rows.length > 500) {
        return NextResponse.json({ error: "Upload between 1 and 500 assessments at a time" }, { status: 400 });
      }

      const rowErrors: string[] = [];
      const preparedRows: Array<{
        examination: string;
        name: string;
        startDate: string | null;
        endDate: string | null;
        totalTime: number | null;
        lastLogin: number | null;
        passMark: number | null;
        questionCategory: string | null;
        subCategory: string | null;
        topic: string | null;
        questionLanguage: string | null;
        sections: unknown[];
      }> = [];

      for (const [index, rawRow] of rows.entries()) {
        const rowNumber = index + 2;
        if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
          rowErrors.push(`Row ${rowNumber}: invalid row data.`);
          continue;
        }
        const row = rawRow as AssessmentPayload;
        const examination = optionalText(row.examination);
        const name = optionalText(row.name);
        const startDateText = optionalText(row.start_date);
        const endDateText = optionalText(row.end_date);
        const totalTimeText = optionalText(row.total_time);
        const lastLoginText = optionalText(row.last_login);
        const startDate = optionalDate(startDateText);
        const endDate = optionalDate(endDateText);
        const totalTime = optionalInteger(totalTimeText);
        const lastLogin = optionalInteger(lastLoginText);
        let sections: unknown[] = [];

        if (!examination) rowErrors.push(`Row ${rowNumber}: Examination is required.`);
        if (!name) rowErrors.push(`Row ${rowNumber}: Name is required.`);
        if (Array.isArray(row.sections)) {
          sections = row.sections;
        } else if (typeof row.sections === "string" && row.sections.trim()) {
          try {
            const parsedSections: unknown = JSON.parse(row.sections);
            if (!Array.isArray(parsedSections)) throw new Error("Sections JSON must be an array.");
            sections = parsedSections;
          } catch {
            rowErrors.push(`Row ${rowNumber}: Sections JSON must be a valid JSON array.`);
          }
        }
        if (hasInvalidWrongMark(sections)) {
          rowErrors.push(`Row ${rowNumber}: Wrong Mark must be zero or a negative number.`);
        }
        for (const error of validateAssessmentConfiguration({
          ...row,
          start_date: startDateText,
          end_date: endDateText,
          total_time: totalTimeText,
          last_login: lastLoginText,
          pass_mark: row.pass_mark,
          sections,
        })) {
          rowErrors.push(`Row ${rowNumber}: ${error}`);
        }

        preparedRows.push({
          examination: examination ?? "",
          name: name ?? "",
          startDate,
          endDate,
          totalTime,
          lastLogin,
          passMark: optionalMark(row.pass_mark),
          questionCategory: optionalText(row.question_category),
          subCategory: optionalText(row.sub_category),
          topic: optionalText(row.topic),
          questionLanguage: optionalText(row.question_language),
          sections,
        });
      }

      if (rowErrors.length > 0) {
        return NextResponse.json({ error: "Some rows need correction. No assessments were imported.", row_errors: rowErrors }, { status: 400 });
      }

      await ensureAssessmentTable();
      const activeQuestions = await loadActiveQuestions();
      const client = await databasePool.connect();
      let transactionStarted = false;
      try {
        await client.query("BEGIN");
        transactionStarted = true;
        const insertedRows = [];
        for (const row of preparedRows) {
          const result = await client.query(`
            INSERT INTO assessment (
              examination, name, start_date, end_date, total_time, last_login,
              question_category, sub_category, topic, question_language, sections, pass_mark
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
            RETURNING id, examination, name, start_date, end_date, total_time, last_login,
                      pass_mark,
                      question_category, sub_category, topic, question_language, sections,
                      status, created_at
          `, [
            row.examination,
            row.name,
            row.startDate,
            row.endDate,
            row.totalTime,
            row.lastLogin,
            row.questionCategory,
            row.subCategory,
            row.topic,
            row.questionLanguage,
            JSON.stringify(row.sections),
            row.passMark,
          ]);
          insertedRows.push(result.rows[0]);
        }
        await client.query("COMMIT");
        transactionStarted = false;
        return NextResponse.json({
          imported: insertedRows.length,
          assessments: insertedRows.map((assessment) => ({
            ...assessment,
            has_active_questions: hasMatchingActiveQuestion(assessment, activeQuestions),
          })),
        }, { status: 201 });
      } catch (error) {
        if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }

    const examination = optionalText(body.examination);
    const name = optionalText(body.name);
    if (!examination || !name) {
      return NextResponse.json({ error: "Examination and assessment name are required" }, { status: 400 });
    }

    const sections = Array.isArray(body.sections) ? body.sections : [];
    const configurationErrors = validateAssessmentConfiguration({ ...body, sections });
    if (configurationErrors.length) {
      return NextResponse.json({ error: configurationErrors.join(" ") }, { status: 400 });
    }
    if (hasInvalidWrongMark(sections)) {
      return NextResponse.json({ error: "Wrong Mark must be zero or a negative number." }, { status: 400 });
    }
    await ensureAssessmentTable();
    const activeQuestions = await loadActiveQuestions();
    const result = await databasePool.query(`
      INSERT INTO assessment (
        examination, name, start_date, end_date, total_time, last_login,
        question_category, sub_category, topic, question_language, sections, pass_mark
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
      RETURNING id, examination, name, start_date, end_date, total_time, last_login,
                pass_mark,
                question_category, sub_category, topic, question_language, sections,
                status, created_at
    `, [
      examination,
      name,
      optionalDate(body.start_date),
      optionalDate(body.end_date),
      optionalInteger(body.total_time),
      optionalInteger(body.last_login),
      optionalText(body.question_category),
      optionalText(body.sub_category),
      optionalText(body.topic),
      optionalText(body.question_language),
      JSON.stringify(sections),
      optionalMark(body.pass_mark),
    ]);

    return NextResponse.json({
      ...result.rows[0],
      has_active_questions: hasMatchingActiveQuestion(result.rows[0], activeQuestions),
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to create assessment", error);
    return NextResponse.json({ error: "Unable to create assessment" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as AssessmentPayload;
    const id = Number(body.id);
    const examination = optionalText(body.examination);
    const name = optionalText(body.name);
    if (!Number.isInteger(id) || id <= 0 || !examination || !name) {
      return NextResponse.json({ error: "A valid assessment id, examination, and name are required" }, { status: 400 });
    }

    const sections = Array.isArray(body.sections) ? body.sections : [];
    const configurationErrors = validateAssessmentConfiguration({ ...body, sections });
    if (configurationErrors.length) {
      return NextResponse.json({ error: configurationErrors.join(" ") }, { status: 400 });
    }
    if (hasInvalidWrongMark(sections)) {
      return NextResponse.json({ error: "Wrong Mark must be zero or a negative number." }, { status: 400 });
    }
    await ensureAssessmentTable();
    const activeQuestions = await loadActiveQuestions();
    const result = await databasePool.query(`
      UPDATE assessment
      SET examination = $1, name = $2, start_date = $3, end_date = $4,
          total_time = $5, last_login = $6, question_category = $7,
          sub_category = $8, topic = $9, question_language = $10, sections = $11::jsonb,
          pass_mark = $12
      WHERE id = $13
      RETURNING id, examination, name, start_date, end_date, total_time, last_login,
                pass_mark,
                question_category, sub_category, topic, question_language, sections,
                status, created_at
    `, [
      examination,
      name,
      optionalDate(body.start_date),
      optionalDate(body.end_date),
      optionalInteger(body.total_time),
      optionalInteger(body.last_login),
      optionalText(body.question_category),
      optionalText(body.sub_category),
      optionalText(body.topic),
      optionalText(body.question_language),
      JSON.stringify(sections),
      optionalMark(body.pass_mark),
      id,
    ]);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }
    return NextResponse.json({
      ...result.rows[0],
      has_active_questions: hasMatchingActiveQuestion(result.rows[0], activeQuestions),
    });
  } catch (error) {
    console.error("Failed to update assessment", error);
    return NextResponse.json({ error: "Unable to update assessment" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "A valid assessment id is required" }, { status: 400 });
    }

    await ensureAssessmentTable();
    const result = await databasePool.query("DELETE FROM assessment WHERE id = $1", [id]);
    if (!result.rowCount) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete assessment", error);
    return NextResponse.json({ error: "Unable to delete assessment" }, { status: 500 });
  }
}
