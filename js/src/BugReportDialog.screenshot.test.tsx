import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BugReportDialog, type BugReportDialogProps } from "./BugReportDialog.js";
import type { BugReportKindLabels, ResolvedBugReportLabels } from "./labels.js";
import type { BugReportContext, BugReportEnvironment } from "./payload.js";

// The dialog's own file drives the real pane, which in jsdom can only ever
// answer null — it loads no image, so there is nothing to flatten. What the
// dialog does with the answers a browser gives has to be driven from a stand-in.
const pane = vi.hoisted(() => ({ toBlob: vi.fn(), cancelText: () => false }));

// The stand-in shows the placeholder line the real pane shows without a picture,
// so the text the dialog hands it can be read back.
vi.mock("./ScreenshotPane.js", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");

  return {
    ScreenshotPane: forwardRef(function FakePane(
      props: { dataUrl: string | null; labels: ResolvedBugReportLabels; emptyMessage?: string },
      ref,
    ) {
      useImperativeHandle(ref, () => pane, []);
      if (props.dataUrl !== null) return null;
      return <p>{props.emptyMessage ?? props.labels.captureFailed}</p>;
    }),
  };
});

// Every label is its own key, so an assertion names the string it means. The
// one template that interpolates has to stay a template, and the counter has to
// stay a function.
const TEMPLATES: Record<string, string> = { filed: "issue {number}" };

const kindLabels = (kind: "bug" | "feature") =>
  new Proxy({} as BugReportKindLabels, { get: (_t, key) => `${kind}.${String(key)}` });

const labels = new Proxy({} as ResolvedBugReportLabels, {
  get: (_t, key) => {
    if (key === "bug" || key === "feature") return kindLabels(key);
    if (key === "characterCount") return (used: number, limit: number) => `${used} / ${limit}`;
    if (key === "zoomLevel") return (percent: number) => `${percent} %`;
    return TEMPLATES[String(key)] ?? String(key);
  },
});

const context: BugReportContext = {
  area: "/projects/7/board",
  version: "3862535",
  requestId: "req-42",
};

const environment: BugReportEnvironment = {
  user_agent: "TestAgent/1.0",
  viewport: "1440x900",
  at: "2026-09-06T09:12:33.000Z",
};

function renderDialog(
  submit = vi.fn().mockResolvedValue({ id: "0190d1c2-0000-7000-8000-000000000141", number: 141 }),
  extra: Partial<BugReportDialogProps> = {},
) {
  render(
    <BugReportDialog
      capture={{ ok: true, dataUrl: "data:image/png;base64,AAECAw==" }}
      labels={labels}
      context={context}
      environment={environment}
      diagnostics={[]}
      submit={submit}
      onClose={vi.fn()}
      {...extra}
    />,
  );

  return { submit };
}

async function fillAndSend(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText("summaryLabel"), "Summary");
  await user.type(screen.getByLabelText("bug.descriptionLabel"), text);
  await user.click(screen.getByRole("button", { name: "bug.send" }));
}

describe("BugReportDialog and the screenshot it is handed", () => {
  beforeEach(() => {
    pane.toBlob.mockReset();
    // WHY: a draft left by an earlier test would be restored into this dialog and typed over.
    sessionStorage.clear();
  });

  // The export goes into the form as a PNG part the server can read back.
  it("attaches an export that is within the cap", async () => {
    const user = userEvent.setup();
    const png = new Blob(["small"], { type: "image/png" });
    pane.toBlob.mockResolvedValue(png);
    const { submit } = renderDialog();

    await fillAndSend(user, "Wrong total on the bill");

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const form = submit.mock.calls[0][0];
    const attached = form.get("screenshot");
    expect(attached).toBeInstanceOf(File);
    expect((attached as File).name).toBe("screenshot.png");
    expect((attached as File).size).toBe(5);
    expect((attached as File).type).toBe("image/png");
    expect(screen.queryByText("screenshotTooLarge")).not.toBeInTheDocument();
  });

  // The cap is I1's: the server takes a PNG of exactly 5242880 bytes and answers
  // 413 only above it, so the dialog must not drop a file of that size.
  it("attaches an export of exactly 5 MiB", async () => {
    const user = userEvent.setup();
    pane.toBlob.mockResolvedValue(
      new Blob([new Uint8Array(5 * 1024 * 1024)], { type: "image/png" }),
    );
    const { submit } = renderDialog();

    await fillAndSend(user, "Exactly at the cap");

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect((submit.mock.calls[0][0].get("screenshot") as File).size).toBe(5242880);
    expect(screen.queryByText("screenshotTooLarge")).not.toBeInTheDocument();
  });

  // The backend answers a bigger PNG with a 413, which would cost the words and
  // the diagnostics as well as the image. Dropping it keeps the report — but a
  // reporter who blacked out a customer name has to be told the image they
  // censored is not the one that went.
  it("drops an export over the cap, sends the rest, and says so", async () => {
    const user = userEvent.setup();
    pane.toBlob.mockResolvedValue(
      new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/png" }),
    );
    const { submit } = renderDialog();

    await fillAndSend(user, "Klienti label is wrong");

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const form = submit.mock.calls[0][0];
    expect(form.has("screenshot")).toBe(false);
    expect(form.get("description")).toBe("Klienti label is wrong");
    expect(await screen.findByText("screenshotTooLarge")).toBeInTheDocument();
  });

  // WHY: awaited inside the dialog's own try, so a handle that rejects lands in the
  // failure state with the reporter's words intact — rather than leaving the
  // dialog on "sending" for ever, where Escape and Back both refuse to close.
  it("does not strand the dialog when the export rejects", async () => {
    const user = userEvent.setup();
    pane.toBlob.mockRejectedValue(new Error("tainted canvas"));
    const { submit } = renderDialog();

    await fillAndSend(user, "Export blew up");

    expect(await screen.findByText("failureTitle")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "back" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    expect(await screen.findByRole("button", { name: "copyToClipboard" })).toBeInTheDocument();
  });

  it.each([
    {
      host: "retakes and can be kept",
      extra: { onRetake: vi.fn() },
      buttons: ["retakeDelayed", "retakeOnKey", "removeScreenshot"],
    },
    { host: "does not retake", extra: {}, buttons: ["removeScreenshot"] },
    {
      host: "turns the options off",
      extra: { onRetake: vi.fn(), screenshotModes: false },
      buttons: null,
    },
  ])("shows the screenshot options a host allows: $host", ({ extra, buttons }) => {
    renderDialog(undefined, extra);

    const group = screen.queryByRole("group", { name: "screenshotModes" });
    if (buttons === null) {
      expect(group).not.toBeInTheDocument();
      return;
    }
    expect(
      within(group!)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(buttons);
  });

  it("starts a retake with the words the reporter has typed", async () => {
    const user = userEvent.setup();
    const onRetake = vi.fn();
    renderDialog(undefined, { onRetake });

    await user.type(screen.getByLabelText("summaryLabel"), "Summary");
    await user.click(screen.getByRole("button", { name: "retakeOnKey" }));

    expect(onRetake).toHaveBeenCalledWith("key", {
      kind: "bug",
      summary: "Summary",
      description: "",
      impact: "workaround",
    });
  });

  it("sends without a screenshot once the reporter removes it", async () => {
    const user = userEvent.setup();
    const { submit } = renderDialog();

    await user.click(screen.getByRole("button", { name: "removeScreenshot" }));

    expect(screen.getByText("screenshotRemoved")).toBeInTheDocument();
    expect(screen.queryByText("captureFailed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "removeScreenshot" })).not.toBeInTheDocument();

    await fillAndSend(user, "Sent without the picture");

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0].get("screenshot")).toBeNull();
  });
});
