import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { toPng } from "html-to-image";
import { vi } from "vitest";
import * as kit from "./index.js";
import type {
  BugReportButtonProps,
  BugReportContext,
  BugReportLabels,
  BugReportResult,
  BugReportSubmit,
} from "./index.js";

vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

describe("package entry", () => {
  it("exports exactly the public names", () => {
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
  });

  it("lets a host wire the button from the entry alone", async () => {
    vi.mocked(toPng).mockResolvedValue("data:image/png;base64,AAECAw==");
    const user = userEvent.setup();
    const result: BugReportResult = { id: "t-1", number: 7 };
    const submit = vi.fn<BugReportSubmit>().mockResolvedValue(result);
    const getContext = (): BugReportContext => ({ area: "/tasks/7", version: "dev" });
    const labels: Partial<BugReportLabels> = { buttonLabel: "Report" };
    const props: BugReportButtonProps = { submit, getContext, labels };

    render(<kit.BugReportButton {...props} />);

    expect(screen.getByRole("button", { name: "Report" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Report" }));
    await user.type(await screen.findByLabelText(kit.defaultLabels.summaryLabel), "Save");
    await user.type(await screen.findByLabelText(kit.defaultLabels.bug.descriptionLabel), "Save fails");
    await user.click(screen.getByLabelText(kit.defaultLabels.bug.impactBlocks));
    await user.click(screen.getByRole("button", { name: kit.defaultLabels.bug.send }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const form = submit.mock.calls[0][0];
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("description")).toBe("Save fails");
    expect(form.get("area")).toBe("/tasks/7");
  });
});
