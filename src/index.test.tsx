import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import * as kit from "./index.js";
import type {
  BugReportButtonProps,
  BugReportContext,
  BugReportLabels,
  BugReportResult,
  BugReportSubmit,
} from "./index.js";

describe("package entry", () => {
  it("exports exactly the public names", () => {
    expect(Object.keys(kit).sort()).toEqual([
      "BugReportButton",
      "BugReportDialog",
      "buildBugReportForm",
      "defaultLabels",
    ]);
  });

  it("lets a host wire the button from the entry alone", () => {
    const result: BugReportResult = { id: "t-1", number: 7 };
    const submit: BugReportSubmit = async () => result;
    const getContext = (): BugReportContext => ({ area: "/", version: "dev" });
    const labels: Partial<BugReportLabels> = { buttonLabel: "Report" };
    const props: BugReportButtonProps = { submit, getContext, labels };

    render(<kit.BugReportButton {...props} />);

    expect(screen.getByRole("button", { name: "Report" })).toBeInTheDocument();
  });
});
