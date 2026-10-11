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

export const DIAGNOSTICS_CAPACITY = 20;

// A minified bundle can throw a message thousands of characters long; the
// intake caps the diagnostics part at 32 KiB, and a truncated tail is worth
// less than the head of every entry.
const MESSAGE_LIMIT = 500;

export function createDiagnosticsBuffer(capacity = DIAGNOSTICS_CAPACITY): DiagnosticsBuffer {
  const ring: DiagnosticEntry[] = [];

  function push(entry: DiagnosticEntry) {
    ring.push(entry);
    if (ring.length > capacity) {
      ring.splice(0, ring.length - capacity);
    }
  }

  return {
    recordApiFailure(failure) {
      // Rebuilt field by field rather than spread: this buffer is posted into a
      // bug report, and a request body can carry customer data. Never bodies,
      // never headers.
      push({
        method: failure.method,
        path: failure.path,
        status: failure.status,
        request_id: failure.request_id,
        at: new Date().toISOString(),
      });
    },
    recordError(error) {
      push({
        message: error.message.slice(0, MESSAGE_LIMIT),
        source: error.source,
        at: new Date().toISOString(),
      });
    },
    entries() {
      return ring.slice();
    },
    clear() {
      ring.length = 0;
    },
  };
}

function rejectionMessage(reason: unknown): string {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  return "Unhandled rejection";
}

/**
 * Neither listener exists in the panel today, so both are net-new. Returns its
 * own uninstaller so the caller's effect can clean up rather than leaking a
 * listener per remount.
 */
export function installErrorListeners(buffer: DiagnosticsBuffer): () => void {
  const onError = (event: ErrorEvent) => {
    buffer.recordError({
      message: event.message || event.error?.message || "Unknown error",
      source: `${event.filename ?? ""}:${event.lineno ?? 0}`,
    });
  };

  const onRejection = (event: Event) => {
    buffer.recordError({
      message: rejectionMessage((event as PromiseRejectionEvent).reason),
      source: "unhandledrejection",
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
