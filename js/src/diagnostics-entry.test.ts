import * as entry from "./diagnostics-entry.js";
import * as kit from "./index.js";
import * as next from "./next.js";
import * as server from "./server.js";

describe("diagnostics entry", () => {
  it("the diagnostics entry exports exactly its public names", () => {
    expect(Object.keys(entry).sort()).toEqual([
      "CONSOLE_CAPACITY",
      "LABEL_LIMIT",
      "PROBLEMS_CAPACITY",
      "STACK_LIMIT_CHARS",
      "STACK_LIMIT_LINES",
      "TEXT_LIMIT",
      "TRAIL_CAPACITY",
      "createDiagnostics",
      "cutStack",
      "installBreadcrumbs",
      "installConsoleCapture",
      "installDiagnostics",
      "installErrorCapture",
      "scrubPath",
      "scrubText",
      "withDiagnostics",
    ]);
  });

  it("the v0.5.0 entries keep their names", () => {
    expect(Object.keys(kit).sort()).toEqual([
      "BUG_KINDS",
      "BUG_REPORT_PARTS",
      "BugReportButton",
      "BugReportDialog",
      "SUMMARY_LIMIT",
      "ScreenshotEditor",
      "buildBugReportForm",
      "defaultLabels",
    ]);
    expect(Object.keys(next)).toEqual(["BugReport"]);
    expect(Object.keys(server)).toEqual(["createBugReportRoute"]);
  });
});
