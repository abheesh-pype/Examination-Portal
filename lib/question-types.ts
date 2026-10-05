const objectiveQuestionTypes = new Set([
  "single choice",
  "multiple choice",
  "fill in the blank",
  "true/false",
  "yes/no",
  "agree/disagree",
  "good/bad",
]);

const subjectiveQuestionTypes = new Set([
  "manual evaluation",
  "passage type",
]);

export function matchesAssessmentQuestionType(questionType: unknown, sectionType: unknown) {
  if (typeof sectionType !== "string" || !sectionType.trim()) return true;
  if (typeof questionType !== "string") return false;

  const normalizedQuestionType = questionType.trim().toLocaleLowerCase();
  const normalizedSectionType = sectionType.trim().toLocaleLowerCase();
  if (normalizedSectionType === "objective") return objectiveQuestionTypes.has(normalizedQuestionType);
  if (normalizedSectionType === "subjective") return subjectiveQuestionTypes.has(normalizedQuestionType);
  return normalizedQuestionType === normalizedSectionType;
}
