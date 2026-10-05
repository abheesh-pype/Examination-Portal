import { databasePool } from "@/lib/db";

const EXAM_CAM_PERMISSION_KEY = "candidate.exam_cam_permission_active";

export async function ensureCandidatePermissionSettings() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS application_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function getExamCamPermission() {
  await ensureCandidatePermissionSettings();
  const result = await databasePool.query(
    "SELECT setting_value FROM application_settings WHERE setting_key = $1",
    [EXAM_CAM_PERMISSION_KEY],
  );
  if (!result.rowCount) return true;

  const value: unknown = result.rows[0].setting_value;
  if (typeof value !== "boolean") {
    throw new Error("The saved exam camera permission setting is invalid.");
  }
  return value;
}

export async function setExamCamPermission(active: boolean) {
  await ensureCandidatePermissionSettings();
  await databasePool.query(`
    INSERT INTO application_settings (setting_key, setting_value, updated_at)
    VALUES ($1, $2::jsonb, NOW())
    ON CONFLICT (setting_key)
    DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()
  `, [EXAM_CAM_PERMISSION_KEY, JSON.stringify(active)]);
}
