import { type BugImpact, type BugKind } from "./payload.js";
export type Draft = {
    kind: BugKind;
    summary: string;
    description: string;
    impact: BugImpact;
};
export declare const DESCRIPTION_LIMIT = 5000;
/**
 * The typed fields of the report in this tab, or null when there is none or it
 * cannot be trusted. A draft from another version or with a value outside its
 * cap is treated as absent rather than restored half-valid.
 */
export declare function readDraft(): Draft | null;
/** Whether the browser kept the draft; false when storage refuses the write. */
export declare function writeDraft(draft: Draft): boolean;
/** Forgets the draft; a storage that refuses the removal has nothing to forget. */
export declare function clearDraft(): void;
