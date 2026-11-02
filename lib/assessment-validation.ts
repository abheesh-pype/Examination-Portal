export type AssessmentPayload = {
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

export const optionalText = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
export const optionalInteger = (value: unknown) => {
  if ((typeof value !== "string" && typeof value !== "number") || !String(value).trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};
export const optionalMark = (value: unknown) => {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return null;
  if (typeof value !== "string" && typeof value !== "number") return Number.NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};
export const optionalDate = (value: unknown) => {
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
export const hasInvalidWrongMark = (sections: unknown) => Array.isArray(sections) && sections.some((section) => {
  if (!section || typeof section !== "object" || Array.isArray(section)) return false;
  const wrongMark = (section as { wrong_mark?: unknown }).wrong_mark;
  if (wrongMark === undefined || wrongMark === null || wrongMark === "") return false;
  const parsed = typeof wrongMark === "number" || typeof wrongMark === "string" ? Number(wrongMark) : Number.NaN;
  return !Number.isFinite(parsed) || parsed > 0;
});

export function validateAssessmentConfiguration(body: AssessmentPayload) {
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
