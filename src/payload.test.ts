import { buildBugReportForm, reportAsText, DIAGNOSTICS_LIMIT_BYTES } from "./payload.js";
import type { BugReportPayload } from "./payload.js";

const environment = { user_agent: "TestAgent/1.0", viewport: "1440x900", at: "2026-09-06T09:12:33.000Z" };
const apiEntry = { method: "GET", path: "/api/v1/sites", status: 500, request_id: "r1", at: "2026-09-06T09:12:33.000Z" };
const jsEntry = { message: "x is undefined", source: "error", at: "2026-09-06T09:12:34.000Z" };

function payload(overrides: Partial<BugReportPayload> = {}): BugReportPayload {
  return {
    description: "The filter label reads Klienti on the Sites list",
    impact: "workaround",
    context: { area: "/sites/123/plans", version: "3862535" },
    environment,
    diagnostics: [apiEntry],
    screenshot: null,
    ...overrides,
  };
}
const diagnosticsOf = (form: FormData) => JSON.parse(form.get("diagnostics") as string);

describe("buildBugReportForm", () => {
  it("carries description, impact, area, version and viewport as their own parts", () => {
    const form = buildBugReportForm(payload());

    expect(form.get("description")).toBe("The filter label reads Klienti on the Sites list");
    expect(form.get("impact")).toBe("workaround");
    expect(form.get("area")).toBe("/sites/123/plans");
    expect(form.get("version")).toBe("3862535");
    expect(form.get("viewport")).toBe("1440x900");
  });

  it("still sends a version part when there is no build SHA", () => {
    const form = buildBugReportForm(payload({ context: { area: "/x", version: "dev" } }));

    expect(form.get("version")).toBe("dev");
  });

  it("sends request_id only when the app has one", () => {
    const withId = buildBugReportForm(
      payload({ context: { area: "/x", version: "v1", requestId: "req-7f3a" } }),
    );
    const absent = buildBugReportForm(payload());
    const blank = buildBugReportForm(payload({ context: { area: "/x", version: "v1", requestId: "   " } }));

    expect(withId.get("request_id")).toBe("req-7f3a");
    expect(absent.has("request_id")).toBe(false);
    expect(blank.has("request_id")).toBe(false);
  });

  it("sends exactly the browser's parts of the intake form", () => {
    const form = buildBugReportForm(
      payload({
        context: { area: "/a", version: "v1", requestId: "req-1" },
        screenshot: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      }),
    );

    expect([...form.keys()]).toEqual([
      "description",
      "impact",
      "area",
      "version",
      "viewport",
      "request_id",
      "diagnostics",
      "screenshot",
    ]);
  });

  it("posts the environment and the entries as the diagnostics JSON", () => {
    const form = buildBugReportForm(payload({ diagnostics: [apiEntry, jsEntry] }));

    expect(diagnosticsOf(form)).toEqual({ environment, entries: [apiEntry, jsEntry] });
  });

  it("posts null entries when the app has no diagnostics", () => {
    const form = buildBugReportForm(payload({ diagnostics: undefined }));

    expect(diagnosticsOf(form)).toEqual({ environment, entries: null });
  });

  it("drops the oldest entries until the diagnostics fit in 32 KiB of UTF-8", () => {
    const big = (tag: string) => tag + "é".repeat(6000);
    const form = buildBugReportForm(payload({ diagnostics: [big("a"), big("b"), big("c")] }));

    expect(diagnosticsOf(form).entries).toEqual([big("b"), big("c")]);
    expect(new TextEncoder().encode(form.get("diagnostics") as string).length).toBeLessThanOrEqual(
      DIAGNOSTICS_LIMIT_BYTES,
    );
  });

  it("posts null entries when a non-array diagnostics value is too large", () => {
    const form = buildBugReportForm(payload({ diagnostics: { blob: "x".repeat(40_000) } }));

    expect(diagnosticsOf(form)).toEqual({ environment, entries: null });
  });

  it("cuts a user agent too long to fit, so the part still fits the limit", () => {
    const form = buildBugReportForm(
      payload({ environment: { ...environment, user_agent: "a".repeat(40_000) } }),
    );
    const part = form.get("diagnostics") as string;

    expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(DIAGNOSTICS_LIMIT_BYTES);
    expect(JSON.parse(part).entries).toBeNull();
  });

  it("cuts a user agent of astral characters by whole characters, never mid-pair", () => {
    const form = buildBugReportForm(
      payload({ environment: { ...environment, user_agent: "😀".repeat(20_000) } }),
    );
    const part = form.get("diagnostics") as string;

    expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(DIAGNOSTICS_LIMIT_BYTES);
    expect(JSON.parse(part).entries).toBeNull();
    expect(JSON.parse(part).environment.user_agent).toMatch(/^(😀)+$/u);
  });

  it("posts null entries instead of throwing on diagnostics JSON cannot hold", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    let form: FormData | undefined;
    expect(() => {
      form = buildBugReportForm(payload({ diagnostics: cyclic }));
    }).not.toThrow();
    expect(diagnosticsOf(form!)).toEqual({ environment, entries: null });
  });

  it("omits the screenshot part cleanly when capture failed", () => {
    expect(buildBugReportForm(payload()).has("screenshot")).toBe(false);
  });

  it("names the screenshot part when there is one", () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const file = buildBugReportForm(payload({ screenshot: blob })).get("screenshot") as File;

    expect(file.name).toBe("screenshot.png");
    expect(file.type).toBe("image/png");
  });
});

describe("reportAsText", () => {
  it("renders everything a copied report needs to be re-filed by hand", () => {
    const text = reportAsText(
      payload({
        context: { area: "/sites/123/plans", version: "3862535", requestId: "req-7f3a" },
        diagnostics: [apiEntry, jsEntry],
      }),
    );

    expect(text).toBe(
      [
        "The filter label reads Klienti on the Sites list",
        "",
        "Impact: workaround",
        "Page: /sites/123/plans",
        "Version: 3862535",
        "Request id: req-7f3a",
        "Browser: TestAgent/1.0",
        "Viewport: 1440x900",
        "At: 2026-09-06T09:12:33.000Z",
        "",
        "Diagnostics:",
        "  2026-09-06T09:12:33.000Z GET /api/v1/sites 500 r1",
        "  2026-09-06T09:12:34.000Z x is undefined (error)",
      ].join("\n"),
    );
    expect(reportAsText(payload())).not.toContain("Request id:");
  });

  it("copies odd diagnostics as JSON and never throws", () => {
    expect(reportAsText(payload({ diagnostics: { note: "x" } }))).toMatch(
      /\n\nDiagnostics:\n {2}\{"note":"x"\}$/,
    );

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let text = "";
    expect(() => {
      text = reportAsText(payload({ diagnostics: cyclic }));
    }).not.toThrow();
    expect(text).not.toContain("Diagnostics:");
  });

  it("keeps a placeholder line for an array entry JSON cannot write, in its place", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const text = reportAsText(payload({ diagnostics: [apiEntry, cyclic, jsEntry] }));

    expect(text.split("\n").slice(-4)).toEqual([
      "Diagnostics:",
      "  2026-09-06T09:12:33.000Z GET /api/v1/sites 500 r1",
      "  [entry could not be written as JSON]",
      "  2026-09-06T09:12:34.000Z x is undefined (error)",
    ]);
  });
});
