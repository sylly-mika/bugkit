export declare const BUG_IMPACTS: readonly ["blocks", "workaround", "cosmetic"];
export type BugImpact = (typeof BUG_IMPACTS)[number];
export declare const BUG_KINDS: readonly ["bug", "feature"];
export type BugKind = (typeof BUG_KINDS)[number];
export declare const SUMMARY_LIMIT = 200;
/** What the app's getContext returns: the page, the build and, when it has one, the request id. */
export type BugReportContext = {
    area: string;
    version: string;
    requestId?: string;
};
/** The 201 body of the intake route (I1). */
export type BugReportResult = {
    id: string;
    number: number;
};
export type BugReportSubmit = (form: FormData) => Promise<BugReportResult>;
/** What the browser knows, read here so the caller never has to. */
export type BugReportEnvironment = {
    user_agent: string;
    viewport: string;
    at: string;
};
export type BugReportPayload = {
    kind: BugKind;
    summary: string;
    description: string;
    impact: BugImpact;
    context: BugReportContext;
    environment: BugReportEnvironment;
    diagnostics: unknown;
    screenshot: Blob | null;
};
/** The intake route's cap on the diagnostics part (I1): 32 KiB of UTF-8. */
export declare const DIAGNOSTICS_LIMIT_BYTES = 32768;
export declare function readEnvironment(): BugReportEnvironment;
export declare function buildBugReportForm(payload: BugReportPayload): FormData;
/**
 * The failure path's payload. A network blip must never silently eat somebody's
 * report, so everything they typed and everything the buffer holds has to be
 * copyable as one block of text they can paste into chat.
 */
export declare function reportAsText(payload: BugReportPayload): string;
