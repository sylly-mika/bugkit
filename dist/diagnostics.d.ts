export type ApiFailure = {
    method: string;
    path: string;
    status: number;
    request_id: string;
    at: string;
};
export type JsError = {
    message: string;
    source: string;
    at: string;
};
export type DiagnosticEntry = ApiFailure | JsError;
export type DiagnosticsBuffer = {
    recordApiFailure(failure: Omit<ApiFailure, "at">): void;
    recordError(error: Omit<JsError, "at">): void;
    entries(): readonly DiagnosticEntry[];
    clear(): void;
};
export declare const DIAGNOSTICS_CAPACITY = 20;
export declare function createDiagnosticsBuffer(capacity?: number): DiagnosticsBuffer;
/**
 * Neither listener exists in the panel today, so both are net-new. Returns its
 * own uninstaller so the caller's effect can clean up rather than leaking a
 * listener per remount.
 */
export declare function installErrorListeners(buffer: DiagnosticsBuffer): () => void;
