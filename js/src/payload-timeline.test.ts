import { reportAsText, type BugReportPayload } from "./payload.js";
import { createDiagnostics, type TimelineEntry } from "./timeline.js";

const AT = "2026-10-16T09:00:00.000Z";
const base: BugReportPayload = {
  kind: "bug", summary: "Grozs", description: "Cena nav redzama", impact: "workaround",
  context: { area: "/cart", version: "dev" },
  environment: { user_agent: "TestAgent/1.0", viewport: "1440x900", at: AT },
  diagnostics: [], screenshot: null,
};
function linesOf(diagnostics: unknown): string[] {
  const all = reportAsText({ ...base, diagnostics }).split("\n");
  return all.slice(all.indexOf("Diagnostics:") + 1);
}

describe("reportAsText timeline entries", () => {
  it("an API call shows method, path, status, duration and request id", () => {
    const entries: TimelineEntry[] = [
      { type: "api", method: "GET", path: "/x", status: 500, duration_ms: 120, request_id: "req-1", at: AT },
    ];
    expect(linesOf(entries)).toEqual([
      "  2026-10-16T09:00:00.000Z GET /x 500 120 ms req-1",
    ]);
  });

  it("an API call with no request id ends at ms and a network failure shows status 0", () => {
    const entries: TimelineEntry[] = [
      { type: "api", method: "POST", path: "/api/v1/store/review/session", status: 0, duration_ms: 30000, request_id: "", at: AT },
    ];
    expect(linesOf(entries)).toEqual([
      "  2026-10-16T09:00:00.000Z POST /api/v1/store/review/session 0 30000 ms",
    ]);
  });

  it("an error shows message and source, then its stack lines indented", () => {
    const entries: TimelineEntry[] = [
      {
        type: "error",
        message: "TypeError: x is undefined",
        source: "/_next/static/chunks/app.js:1:2",
        stack: "TypeError: x is undefined\n    at f (/_next/static/chunks/app.js:1:2)\n    at g (/_next/static/chunks/app.js:1:9)",
        at: AT,
      },
    ];
    expect(linesOf(entries)).toEqual([
      "  2026-10-16T09:00:00.000Z TypeError: x is undefined (/_next/static/chunks/app.js:1:2)",
      "    TypeError: x is undefined",
      "    at f (/_next/static/chunks/app.js:1:2)",
      "    at g (/_next/static/chunks/app.js:1:9)",
    ]);
  });

  it("an error with no stack is one line", () => {
    const entries: TimelineEntry[] = [
      { type: "error", message: "boom", source: "unhandledrejection", stack: "", at: AT },
      { type: "error", message: "boom", source: "unhandledrejection", stack: " \n\n", at: AT },
    ];
    expect(linesOf(entries)).toEqual([
      "  2026-10-16T09:00:00.000Z boom (unhandledrejection)",
      "  2026-10-16T09:00:00.000Z boom (unhandledrejection)",
    ]);
  });

  it("a console entry shows its level", () => {
    const entries: TimelineEntry[] = [
      { type: "console", level: "error", message: "Failed to load", at: AT },
      { type: "console", level: "warn", message: "Slow", at: AT },
    ];
    expect(linesOf(entries)).toEqual([
      "  2026-10-16T09:00:00.000Z console.error Failed to load",
      "  2026-10-16T09:00:00.000Z console.warn Slow",
    ]);
  });

  it("a route entry shows its path", () => {
    const entries: TimelineEntry[] = [{ type: "route", path: "/cart", at: AT }];
    expect(linesOf(entries)).toEqual([
      "  2026-10-16T09:00:00.000Z route /cart",
    ]);
  });

  it("a click entry shows its selector and quoted label", () => {
    const entries: TimelineEntry[] = [
      { type: "click", selector: "button#save", label: "Saglabāt", at: AT },
      { type: "click", selector: "input.q", label: "", at: AT },
    ];
    expect(linesOf(entries)).toEqual([
      "  2026-10-16T09:00:00.000Z click button#save \"Saglabāt\"",
      "  2026-10-16T09:00:00.000Z click input.q \"\"",
    ]);
  });

  it("entries without a timeline type render as in v0.5.0, in their place", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const entries: unknown[] = [
      { method: "GET", path: "/api/v1/sites", status: 500, request_id: "r1", at: AT },
      { type: "route", path: "/a", at: AT },
      { message: "x is undefined", source: "error", at: AT },
      { type: "other", note: "x" },
      cyclic,
    ];
    expect(() => reportAsText({ ...base, diagnostics: entries })).not.toThrow();
    expect(linesOf(entries)).toEqual([
      "  2026-10-16T09:00:00.000Z GET /api/v1/sites 500 r1",
      "  2026-10-16T09:00:00.000Z route /a",
      "  2026-10-16T09:00:00.000Z x is undefined (error)",
      "  {\"type\":\"other\",\"note\":\"x\"}",
      "  [entry could not be written as JSON]",
    ]);
  });

  it("the copy text of a real snapshot shows GET /x 500 120 ms", () => {
    const d = createDiagnostics({ now: () => new Date(AT) });
    d.recordApiCall({ method: "get", url: "https://shop.example.lv/x?q=1", status: 500, durationMs: 120, requestId: "req-1" });
    d.recordRoute("https://shop.example.lv/cart");
    const text = reportAsText({ ...base, diagnostics: d.snapshot() });
    expect(linesOf(d.snapshot())).toEqual([
      "  2026-10-16T09:00:00.000Z GET /x 500 120 ms req-1",
      "  2026-10-16T09:00:00.000Z route /cart",
    ]);
    expect(text).not.toContain("?q=1");
  });
});
