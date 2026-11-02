type ResultQuestion = {
  id: unknown;
  question_type?: unknown;
  section?: unknown;
  correct_answer?: unknown;
  correct_mark?: unknown;
  wrong_mark?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeAnswer(value: unknown): string | string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim().toLocaleLowerCase()).sort();
  }
  return value === null || value === undefined ? "" : String(value).trim().toLocaleLowerCase();
}

function answersEqual(first: unknown, second: unknown) {
  const normalizedFirst = normalizeAnswer(first);
  const normalizedSecond = normalizeAnswer(second);
  if (Array.isArray(normalizedFirst) && Array.isArray(normalizedSecond)) {
    return normalizedFirst.length === normalizedSecond.length
      && normalizedFirst.every((value, index) => value === normalizedSecond[index]);
  }
  return !Array.isArray(normalizedFirst)
    && !Array.isArray(normalizedSecond)
    && normalizedFirst === normalizedSecond;
}

function hasAnswer(value: unknown) {
  return Array.isArray(value)
    ? value.some((item) => typeof item === "string" && item.trim())
    : typeof value === "string" && value.trim().length > 0;
}

function getQuestionMarks(sections: unknown, question: ResultQuestion) {
  const snapshotCorrectMark = Number(question.correct_mark);
  const snapshotWrongMark = Number(question.wrong_mark);
  const sectionName = typeof question.section === "string" ? question.section.trim().toLocaleLowerCase() : "";
  const section = Array.isArray(sections)
    ? sections.find((candidate) => isRecord(candidate)
      && typeof candidate.name === "string"
      && candidate.name.trim().toLocaleLowerCase() === sectionName)
    : undefined;

  if (!isRecord(section)) {
    return {
      correctMark: Number.isFinite(snapshotCorrectMark) && snapshotCorrectMark > 0 ? snapshotCorrectMark : 0,
      wrongMark: Number.isFinite(snapshotWrongMark) && snapshotWrongMark <= 0 ? snapshotWrongMark : 0,
    };
  }

  const configuredCorrectMark = Number(section.correct_mark);
  const configuredWrongMark = Number(section.wrong_mark);
  return {
    correctMark: Number.isFinite(configuredCorrectMark) && configuredCorrectMark >= 0
      ? configuredCorrectMark
      : Number.isFinite(snapshotCorrectMark) && snapshotCorrectMark > 0 ? snapshotCorrectMark : 0,
    wrongMark: Number.isFinite(configuredWrongMark) && configuredWrongMark <= 0
      ? configuredWrongMark
      : Number.isFinite(snapshotWrongMark) && snapshotWrongMark <= 0 ? snapshotWrongMark : 0,
  };
}

export function calculateResult(
  sections: unknown,
  questionsSnapshot: unknown,
  answers: unknown,
  manualMarks: unknown,
) {
  const safeAnswers = isRecord(answers) ? answers : {};
  const safeManualMarks = isRecord(manualMarks) ? manualMarks : {};
  const questions = Array.isArray(questionsSnapshot) ? questionsSnapshot.filter(isRecord) : [];
  let obtainedMark = 0;
  let negativeMark = 0;
  let snapshotMaximumMark = 0;

  for (const question of questions as ResultQuestion[]) {
    const marks = getQuestionMarks(sections, question);
    snapshotMaximumMark += marks.correctMark;
    const questionId = String(question.id);
    const answer = safeAnswers[questionId];
    const manualQuestion = /manual|passage/i.test(String(question.question_type ?? ""));

    if (manualQuestion) {
      const manualMark = Number(safeManualMarks[questionId]);
      if (Number.isFinite(manualMark)) {
        obtainedMark += Math.min(Math.max(manualMark, 0), marks.correctMark);
      }
      continue;
    }

    if (!hasAnswer(answer)) continue;
    if (question.correct_answer !== null && question.correct_answer !== undefined
      && answersEqual(answer, question.correct_answer)) {
      obtainedMark += marks.correctMark;
    } else {
      obtainedMark += marks.wrongMark;
      negativeMark += marks.wrongMark;
    }
  }

  if (Array.isArray(sections)) {
    const configuredMaximumMark = sections.reduce((total, section) => {
      if (!isRecord(section)) return total;
      const questionCount = Number(section.question_count);
      const correctMark = Number(section.correct_mark);
      return Number.isFinite(questionCount) && questionCount > 0
        && Number.isFinite(correctMark) && correctMark >= 0
        ? total + questionCount * correctMark
        : total;
    }, 0);
    if (configuredMaximumMark > 0) snapshotMaximumMark = configuredMaximumMark;
  }

  return { obtainedMark, negativeMark, totalMark: snapshotMaximumMark };
}
