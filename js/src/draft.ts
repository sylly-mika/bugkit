import {
  BUG_IMPACTS,
  BUG_KINDS,
  SUMMARY_LIMIT,
  type BugImpact,
  type BugKind,
} from "./payload.js";

export type Draft = { kind: BugKind; summary: string; description: string; impact: BugImpact };

export const DESCRIPTION_LIMIT = 5_000;

const KEY = "bugkit:draft:v1";

/**
 * The typed fields of the report in this tab, or null when there is none or it
 * cannot be trusted. A draft from another version or with a value outside its
 * cap is treated as absent rather than restored half-valid.
 */
export function readDraft(): Draft | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;

  const stored = value as Record<string, unknown>;
  if (stored.v !== 1) return null;
  if (!BUG_KINDS.includes(stored.kind as BugKind)) return null;
  if (!BUG_IMPACTS.includes(stored.impact as BugImpact)) return null;
  if (typeof stored.summary !== "string" || stored.summary.length > SUMMARY_LIMIT) return null;
  if (typeof stored.description !== "string" || stored.description.length > DESCRIPTION_LIMIT) {
    return null;
  }

  return {
    kind: stored.kind as BugKind,
    summary: stored.summary,
    description: stored.description,
    impact: stored.impact as BugImpact,
  };
}

/** Whether the browser kept the draft; false when storage refuses the write. */
export function writeDraft(draft: Draft): boolean {
  try {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        kind: draft.kind,
        summary: draft.summary,
        description: draft.description,
        impact: draft.impact,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Forgets the draft; a storage that refuses the removal has nothing to forget. */
export function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    return;
  }
}
