// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BugReportButton } from "./BugReportButton.js";

describe("BugReportButton on the server", () => {
  it("renders without a document, with the menu closed", () => {
    expect(typeof document).toBe("undefined");

    expect(() =>
      renderToString(<BugReportButton submit={vi.fn()} getContext={() => ({ area: "/", version: "1" })} />),
    ).not.toThrow();
  });
});
