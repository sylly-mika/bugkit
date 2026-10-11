export const BUG_IMPACTS = ["blocks", "workaround", "cosmetic"] as const;

export type BugImpact = (typeof BUG_IMPACTS)[number];

/** What the app's getContext returns: the page, the build and, when it has one, the request id. */
export type BugReportContext = { area: string; version: string; requestId?: string };

/** The 201 body of the intake route (I1). */
export type BugReportResult = { id: string; number: number };

export type BugReportSubmit = (form: FormData) => Promise<BugReportResult>;

/** What the browser knows, read here so the caller never has to. */
export type BugReportEnvironment = {
  user_agent: string;
  viewport: string;
  at: string;
};

export type BugReportPayload = {
  description: string;
  impact: BugImpact;
  context: BugReportContext;
  environment: BugReportEnvironment;
  diagnostics: unknown;
  screenshot: Blob | null;
};

/** The intake route's cap on the diagnostics part (I1): 32 KiB of UTF-8. */
export const DIAGNOSTICS_LIMIT_BYTES = 32_768;

export function readEnvironment(): BugReportEnvironment {
  return {
    user_agent: window.navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    at: new Date().toISOString(),
  };
}

/** The request id the app has, or undefined when it is missing or blank. The value is returned as given. */
function requestIdOf(context: BugReportContext): string | undefined {
  const id = context.requestId;
  return typeof id === "string" && id.trim() !== "" ? id : undefined;
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The diagnostics part: the environment and the entries, always valid JSON and
 * at most DIAGNOSTICS_LIMIT_BYTES of UTF-8. Over the limit, the oldest entries
 * go first, so an over-large buffer never costs the reporter the whole report.
 */
function diagnosticsPart(environment: BugReportEnvironment, diagnostics: unknown): string {
  const wrap = (entries: unknown) => JSON.stringify({ environment, entries });
  const entries = diagnostics === undefined ? null : diagnostics;

  let json: string;
  try {
    json = wrap(entries);
  } catch {
    return nullEntriesPart(environment);
  }
  if (utf8Bytes(json) <= DIAGNOSTICS_LIMIT_BYTES) return json;

  if (Array.isArray(entries)) {
    for (let dropped = 1; dropped <= entries.length; dropped++) {
      const candidate = wrap(entries.slice(dropped));
      if (utf8Bytes(candidate) <= DIAGNOSTICS_LIMIT_BYTES) return candidate;
    }
  }
  return nullEntriesPart(environment);
}

/**
 * The environment with null entries. When even that is over the limit, the user
 * agent is cut, by whole code points, to the longest prefix that fits.
 */
function nullEntriesPart(environment: BugReportEnvironment): string {
  const wrap = (userAgent: string) =>
    JSON.stringify({ environment: { ...environment, user_agent: userAgent }, entries: null });
  const chars = Array.from(environment.user_agent);
  const fits = (count: number) =>
    utf8Bytes(wrap(chars.slice(0, count).join(""))) <= DIAGNOSTICS_LIMIT_BYTES;

  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return wrap(chars.slice(0, lo).join(""));
}

export function buildBugReportForm(payload: BugReportPayload): FormData {
  const form = new FormData();

  form.append("description", payload.description);
  form.append("impact", payload.impact);
  form.append("area", payload.context.area);
  // Always sent, even "dev": the intake route reads it as its own part.
  form.append("version", payload.context.version);
  form.append("viewport", payload.environment.viewport);
  const requestId = requestIdOf(payload.context);
  if (requestId !== undefined) form.append("request_id", requestId);
  form.append("diagnostics", diagnosticsPart(payload.environment, payload.diagnostics));

  if (payload.screenshot !== null) {
    form.append("screenshot", payload.screenshot, "screenshot.png");
  }

  return form;
}

/** One line of the copied text for a diagnostics entry, or null when it cannot be written as JSON. */
function diagnosticLine(entry: unknown): string | null {
  if (typeof entry === "object" && entry !== null && "status" in entry) {
    const e = entry as Record<string, unknown>;
    return `  ${e.at} ${e.method} ${e.path} ${e.status} ${e.request_id}`;
  }
  if (typeof entry === "object" && entry !== null && "message" in entry) {
    const e = entry as Record<string, unknown>;
    return `  ${e.at} ${e.message} (${e.source})`;
  }
  return jsonLine(entry);
}

function jsonLine(value: unknown): string | null {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? null : `  ${json}`;
  } catch {
    return null;
  }
}

/**
 * The failure path's payload. A network blip must never silently eat somebody's
 * report, so everything they typed and everything the buffer holds has to be
 * copyable as one block of text they can paste into chat.
 */
export function reportAsText(payload: BugReportPayload): string {
  const { context, environment } = payload;
  const requestId = requestIdOf(context);
  const lines = [
    payload.description,
    "",
    `Impact: ${payload.impact}`,
    `Page: ${context.area}`,
    `Version: ${context.version}`,
  ];
  if (requestId !== undefined) lines.push(`Request id: ${requestId}`);
  lines.push(
    `Browser: ${environment.user_agent}`,
    `Viewport: ${environment.viewport}`,
    `At: ${environment.at}`,
  );

  const diagnostics = payload.diagnostics;
  if (Array.isArray(diagnostics)) {
    if (diagnostics.length > 0) {
      lines.push("", "Diagnostics:");
      for (const entry of diagnostics) {
        const line = diagnosticLine(entry);
        lines.push(line ?? "  [entry could not be written as JSON]");
      }
    }
  } else if (diagnostics !== null && diagnostics !== undefined) {
    const line = jsonLine(diagnostics);
    if (line !== null) lines.push("", "Diagnostics:", line);
  }

  return lines.join("\n");
}
