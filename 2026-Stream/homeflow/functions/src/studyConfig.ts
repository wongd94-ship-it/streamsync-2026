/**
 * Study configuration — single source of truth for the IRB/Throne-approved
 * research study identifier.
 *
 * The project previously used two studyIds to segregate urodynamics vs
 * BPH-surgery participants on the dashboard. Only ONE studyId is approved
 * by Throne for research-export access: dr-wong-biodesign-urinary-flow-rate-1.
 * The legacy "streamsync-uds" id was being misused as a pathway flag; that
 * role now belongs to the per-participant `pathway` field ("uds" | "bph").
 *
 * Every Cloud Function that talks to Throne, every Firestore write that
 * stamps a studyId, and every dashboard filter that checks studyId must
 * route through this constant.
 */

export const STUDY_ID = "dr-wong-biodesign-urinary-flow-rate-1";

/**
 * Helper to assert at call-sites that a given studyId matches the
 * approved one. Used by Cloud Function dispatch that may receive a
 * studyId from an HTTP body or env var.
 *
 * @param {string | null | undefined} candidate studyId to validate.
 * @return {boolean} True when the candidate equals STUDY_ID after trim.
 */
export function isApprovedStudyId(candidate: string | null | undefined): boolean {
  return typeof candidate === "string" && candidate.trim() === STUDY_ID;
}
