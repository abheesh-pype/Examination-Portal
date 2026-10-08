import { notFound } from "next/navigation";
import Home from "../page";

const availablePaths = new Set([
  "/assessment",
  "/assigned-invigilator",
  "/assigned-evaluator",
  "/examination-candidates",
  "/home",
  "/dashboard",
  "/result",
  "/questions",
  "/candidates",
  "/users",
  "/settings/organization",
  "/settings/question-categories",
  "/settings/question-sub-categories",
  "/settings/question-topics",
  "/settings/difficulty-levels",
  "/settings/languages",
  "/settings/examinations",
  "/settings/default-settings",
  "/settings/candidate-categories",
  "/settings/candidate-sub-categories",
  "/settings/candidate-settings",
  "/settings/candidate-permissions",
]);

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string[] }>;
}) {
  const { section } = await params;
  const path = `/${section.join("/")}`;

  if (!availablePaths.has(path)) notFound();

  return <Home />;
}
