import type { PoolClient } from "pg";
import { databasePool } from "@/lib/db";

export const candidateTimelineEventLabels = {
  tab_hidden: "Candidate switched away from the examination tab",
  tab_returned: "Candidate returned to the examination tab",
  multiple_faces: "Multiple faces detected in the camera",
  no_face: "No face detected in the camera",
  face_detected: "Candidate face visible again",
  person_changed: "Person in camera changed from check-in reference",
  person_match_restored: "Person in camera matches the check-in reference again",
  camera_blocked: "Camera disconnected or became unavailable",
  camera_restored: "Camera connection restored",
  fullscreen_exited: "Candidate exited full-screen mode",
  fullscreen_restored: "Candidate returned to full-screen mode",
  motion_detected: "Significant camera movement detected",
  motion_settled: "Camera movement returned to normal",
} as const;

export type CandidateTimelineEventType = keyof typeof candidateTimelineEventLabels;

export type ExamTimelineEventType =
  | CandidateTimelineEventType
  | "exam_started"
  | "exam_resumed"
  | "exam_restarted"
  | "exam_quit"
  | "exam_submitted"
  | "exam_time_expired";

export type ExamTimelineEventSource = "candidate" | "invigilator" | "system";

export const examTimelineEventLabels: Record<ExamTimelineEventType, string> = {
  ...candidateTimelineEventLabels,
  exam_started: "Candidate started the examination",
  exam_resumed: "Candidate resumed the examination",
  exam_restarted: "Invigilator restarted the examination and cleared saved answers",
  exam_quit: "Administrator ended the examination and cleared the attempt",
  exam_submitted: "Candidate submitted the examination",
  exam_time_expired: "Examination time expired and the attempt was finalized",
};

let timelineTableReady: Promise<void> | undefined;

export function ensureExamTimelineTable() {
  if (!timelineTableReady) {
    timelineTableReady = databasePool.query(`
      CREATE TABLE IF NOT EXISTS assessment_candidate_timeline_events (
        id BIGSERIAL PRIMARY KEY,
        assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
        candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('candidate', 'invigilator', 'system')),
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(async () => {
      await databasePool.query(`
        CREATE INDEX IF NOT EXISTS assessment_candidate_timeline_events_lookup_idx
        ON assessment_candidate_timeline_events (assessment_id, candidate_id, occurred_at, id)
      `);
    }).then(() => undefined).catch((error: unknown) => {
      timelineTableReady = undefined;
      throw error;
    });
  }
  return timelineTableReady;
}

export async function recordExamTimelineEvent(
  client: PoolClient,
  assessmentId: number,
  candidateId: number,
  eventType: ExamTimelineEventType,
  source: ExamTimelineEventSource,
) {
  await client.query(`
    INSERT INTO assessment_candidate_timeline_events (assessment_id, candidate_id, event_type, source)
    VALUES ($1, $2, $3, $4)
  `, [assessmentId, candidateId, eventType, source]);
}
