import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";

type CandidateRecord = {
  id: number;
  candidate_data: { fields?: Record<string, unknown> } | null;
};

const candidateIdLockKey = 741923601;
const candidateIdMinimum = 100000;
const candidateIdRange = 900000;

export function isCandidateIdFieldName(name: string) {
  return /^candidate id(?:\s*\([^)]*\))?$/i.test(name.trim());
}

export async function acquireCandidateIdLock(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock($1)", [candidateIdLockKey]);
}

export async function getCandidateIdFieldName(client: PoolClient) {
  const result = await client.query(`
    SELECT name
    FROM "Candidate Information"
    WHERE record_type = 'field'
    ORDER BY date ASC, id ASC
  `);
  const fieldNames = (result.rows as Array<{ name: string }>).map((row) => row.name);
  return fieldNames.find((name) => name.trim().toLowerCase() === "candidate id")
    ?? fieldNames.find(isCandidateIdFieldName)
    ?? "Candidate ID";
}

function addCandidateIdsFromFields(existingIds: Set<string>, fields: Record<string, unknown>) {
  for (const [name, value] of Object.entries(fields)) {
    if (isCandidateIdFieldName(name) && typeof value === "string" && /^\d{6}$/.test(value)) {
      existingIds.add(value);
    }
  }
}

export async function loadExistingCandidateIds(client: PoolClient) {
  const result = await client.query(`
    SELECT candidate_data
    FROM "Candidate Information"
    WHERE record_type = 'candidate'
  `);
  const existingIds = new Set<string>();
  for (const row of result.rows as Array<{ candidate_data: CandidateRecord["candidate_data"] }>) {
    addCandidateIdsFromFields(existingIds, row.candidate_data?.fields ?? {});
  }
  return existingIds;
}

export function generateUniqueCandidateId(existingIds: Set<string>) {
  if (existingIds.size >= candidateIdRange) {
    throw new Error("Unable to generate a unique candidate ID: all six-digit IDs are in use.");
  }

  const start = randomInt(candidateIdMinimum, candidateIdMinimum + candidateIdRange);
  for (let offset = 0; offset < candidateIdRange; offset += 1) {
    const candidateId = String(candidateIdMinimum + ((start - candidateIdMinimum + offset) % candidateIdRange));
    if (!existingIds.has(candidateId)) {
      existingIds.add(candidateId);
      return candidateId;
    }
  }

  throw new Error("Unable to generate a unique candidate ID.");
}
