import { cleanup, act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BugReportDialog } from "./BugReportDialog.js";
import { defaultLabels, type BugReportKindLabels, type ResolvedBugReportLabels } from "./labels.js";
import { reportAsText } from "./payload.js";
import type { BugReportContext, BugReportEnvironment } from "./payload.js";

const DRAFT_KEY = "bugkit:draft:v1";

// Every label is its own key, so an assertion names the string it means. The
// one template that interpolates has to stay a template, and the counter has to
// stay a function.
const TEMPLATES: Record<string, string> = { filed: "issue {number}" };

// WHY: mergeLabels reads the keys of the labels it is given, so the fixtures list their keys.
const kindLabels = (kind: "bug" | "feature") =>
  new Proxy({} as BugReportKindLabels, {
    get: (_t, key) => `${kind}.${String(key)}`,
    ownKeys: () => Object.keys(defaultLabels.bug),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });

const labels = new Proxy({} as ResolvedBugReportLabels, {
  get: (_t, key) => {
    if (key === "bug" || key === "feature") return kindLabels(key);
    if (key === "characterCount") return (used: number, limit: number) => `${used} / ${limit}`;
    if (key === "zoomLevel") return (percent: number) => `${percent} %`;
    return TEMPLATES[String(key)] ?? String(key);
  },
  ownKeys: () => Object.keys(defaultLabels),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
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

function renderDialog(overrides: Partial<Parameters<typeof BugReportDialog>[0]> = {}) {
  const submit = vi
    .fn()
    .mockResolvedValue({ id: "0190d1c2-0000-7000-8000-000000000141", number: 141 });
  const onClose = vi.fn();

  const view = render(
    <BugReportDialog
      capture={{ ok: true, dataUrl: "data:image/png;base64,AAECAw==" }}
      labels={labels}
      context={context}
      environment={environment}
      diagnostics={[]}
      submit={submit}
      onClose={onClose}
      {...overrides}
    />,
  );

  return { submit, onClose, ...view };
}

describe("BugReportDialog", () => {
  // The scroll-lock tests below write to it, and the property outlives a render.
  afterEach(() => {
    document.body.style.overflow = "";
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the default text for a v0.9.0 control when the host passes a v0.8.0 label set", () => {
    const {
      screenshotModes: _screenshotModes,
      retakeDelayed: _retakeDelayed,
      retakeOnKey: _retakeOnKey,
      removeScreenshot: _removeScreenshot,
      screenshotRemoved: _screenshotRemoved,
      captureCountdown: _captureCountdown,
      captureKeyHint: _captureKeyHint,
      captureCancel: _captureCancel,
      ...v080Labels
    } = labels;
    renderDialog({ labels: v080Labels, onRetake: vi.fn() });

    expect(screen.getByRole("button", { name: "Retake in 3 seconds" })).toBeInTheDocument();
  });

  // The spec's rule is that everything the submission carries is visible before
  // Send, so this asserts every value in the context — not a sample of it.
  it("shows every value the report carries before Send", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "technicalTitle" }));

    for (const value of [
      context.area,
      context.version,
      context.requestId,
      environment.user_agent,
      environment.viewport,
      environment.at,
    ]) {
      expect(screen.getByText(value as string)).toBeInTheDocument();
    }
    expect(screen.getByText("contextRequestId")).toBeInTheDocument();

    cleanup();
    renderDialog({ context: { area: "/x", version: "v" } });
    fireEvent.click(screen.getByRole("button", { name: "technicalTitle" }));
    expect(screen.queryByText("contextRequestId")).toBeNull();
  });

  it("rewords the editor for a feature request", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("radio", { name: "kindFeature" }));
    expect(screen.getByRole("heading", { name: "feature.title" })).toBeInTheDocument();
    expect(screen.getByLabelText("feature.descriptionLabel")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "feature.impactWorkaround" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "feature.send" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "kindBug" }));
    expect(screen.getByRole("heading", { name: "bug.title" })).toBeInTheDocument();
    expect(screen.getByLabelText("bug.descriptionLabel")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "bug.impactWorkaround" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "bug.send" })).toBeInTheDocument();
  });

  it("sends the kind and the trimmed summary", async () => {
    const user = userEvent.setup();
    const { submit } = renderDialog();

    await user.click(screen.getByRole("radio", { name: "kindFeature" }));
    await user.type(screen.getByLabelText("summaryLabel"), "  Export CSV ");
    await user.type(screen.getByLabelText("feature.descriptionLabel"), "Needed for audits");
    await user.click(screen.getByRole("button", { name: "feature.send" }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const form = submit.mock.calls[0][0];
    expect(form.get("kind")).toBe("feature");
    expect(form.get("summary")).toBe("Export CSV");
  });

  it("refuses to send with neither a summary nor a description, under one message", async () => {
    const user = userEvent.setup();
    const { submit } = renderDialog();
    const description = screen.getByLabelText("bug.descriptionLabel");

    expect(description).toBeRequired();
    await user.click(screen.getByRole("button", { name: "bug.send" }));

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText("summaryOrDescriptionRequired")).toBeInTheDocument();
    expect(screen.queryByText("summaryRequired")).toBeNull();
    expect(description).toHaveAttribute("aria-invalid", "true");
    expect(description).toHaveFocus();

    await user.type(screen.getByLabelText("summaryLabel"), "Export");
    expect(description).not.toBeRequired();
    expect(description).toHaveAttribute("aria-invalid", "false");
  });

  it("refuses a summary and a description that are only spaces, under one message", async () => {
    const user = userEvent.setup();
    const { submit } = renderDialog();

    await user.type(screen.getByLabelText("summaryLabel"), "   ");
    await user.type(screen.getByLabelText("bug.descriptionLabel"), "   ");
    await user.click(screen.getByRole("button", { name: "bug.send" }));

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText("summaryOrDescriptionRequired")).toBeInTheDocument();
  });

  it("refuses a feature request with neither a summary nor a description", async () => {
    const user = userEvent.setup();
    const { submit } = renderDialog();

    await user.click(screen.getByRole("radio", { name: "kindFeature" }));
    await user.click(screen.getByRole("button", { name: "feature.send" }));

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText("summaryOrDescriptionRequired")).toBeInTheDocument();
  });

  it("keeps a host's own descriptionRequired text for the both-empty message", async () => {
    const user = userEvent.setup();
    const { submit } = renderDialog({ labels: { bug: { descriptionRequired: "Tell us what broke." } } });

    await user.click(screen.getByRole("button", { name: defaultLabels.bug.send }));

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText("Tell us what broke.")).toBeInTheDocument();
    expect(screen.queryByText(defaultLabels.summaryOrDescriptionRequired)).toBeNull();
  });

  it("keeps the summary within the server's cap and counts the description", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect((screen.getByLabelText("summaryLabel") as HTMLInputElement).maxLength).toBe(200);

    await user.type(screen.getByLabelText("bug.descriptionLabel"), "abc");
    expect(screen.getByText("3 / 5000")).toBeInTheDocument();
  });

  it("asks before the back button discards typed text", async () => {
    const user = userEvent.setup();
    const first = renderDialog();

    await user.click(screen.getByRole("button", { name: "back" }));
    expect(first.onClose).toHaveBeenCalledTimes(1);
    first.unmount();

    const { onClose } = renderDialog();
    await user.type(screen.getByLabelText("summaryLabel"), "Export");
    await user.click(screen.getByRole("button", { name: "back" }));

    const confirm = screen.getByRole("alertdialog", { name: "discardTitle" });
    expect(within(confirm).getByRole("button", { name: "keepEditing" })).toHaveFocus();

    await user.click(within(confirm).getByRole("button", { name: "keepEditing" }));
    expect(screen.getByLabelText("summaryLabel")).toHaveValue("Export");
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "back" }));
    await user.click(screen.getByRole("button", { name: "discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("asks before Escape discards, and never closes while sending", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog({ submit: vi.fn(() => new Promise<never>(() => {})) });

    await user.type(screen.getByLabelText("bug.descriptionLabel"), "Typed");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog", { name: "discardTitle" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByLabelText("bug.descriptionLabel")).toHaveValue("Typed");
    expect(onClose).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("summaryLabel"), "Summary");
    await user.click(screen.getByRole("button", { name: "bug.send" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "back" })).toHaveAttribute("aria-disabled", "true"),
    );

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps a draft in this tab and restores it", async () => {
    const user = userEvent.setup();
    const first = renderDialog();

    await user.type(screen.getByLabelText("summaryLabel"), "Export");
    await user.click(screen.getByRole("radio", { name: "kindFeature" }));
    await user.click(screen.getByRole("radio", { name: "feature.impactBlocks" }));

    expect(sessionStorage.getItem(DRAFT_KEY)).toBe(
      '{"v":1,"kind":"feature","summary":"Export","description":"","impact":"blocks"}',
    );
    expect(screen.getByText("saved")).toBeInTheDocument();
    first.unmount();

    renderDialog();
    expect(screen.getByLabelText("summaryLabel")).toHaveValue("Export");
    expect(screen.getByRole("radio", { name: "kindFeature" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "feature.impactBlocks" })).toBeChecked();

    await user.type(screen.getByLabelText("feature.descriptionLabel"), "Needed");
    await user.click(screen.getByRole("button", { name: "feature.send" }));

    expect(await screen.findByText("issue 141")).toBeInTheDocument();
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("claims nothing when the tab cannot store a draft", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    renderDialog();

    await user.type(screen.getByLabelText("summaryLabel"), "Export");
    expect(screen.getByLabelText("summaryLabel")).toHaveValue("Export");
    expect(screen.queryByText("saved")).toBeNull();
    cleanup();
    vi.restoreAllMocks();

    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ v: 2, kind: "bug", summary: "Old", description: "", impact: "workaround" }),
    );
    renderDialog();
    expect(screen.getByLabelText("summaryLabel")).toHaveValue("");
    cleanup();

    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ v: 1, kind: "x", summary: "Old", description: "", impact: "workaround" }),
    );
    renderDialog();
    expect(screen.getByLabelText("summaryLabel")).toHaveValue("");
  });

  it("shows the technical details and what is shared only when opened", async () => {
    const user = userEvent.setup();
    renderDialog({ context: { area: "/sites/1", version: "3862535" } });

    const technical = screen.getByRole("button", { name: "technicalTitle" });
    expect(technical).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("/sites/1")).toBeNull();
    await user.click(technical);
    expect(technical).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("/sites/1")).toBeInTheDocument();
    expect(screen.getByText(environment.viewport)).toBeInTheDocument();

    const shared = screen.getByRole("button", { name: "sharedTitle" });
    expect(shared).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("sharedBody")).toBeNull();
    await user.click(shared);
    expect(shared).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("sharedBody")).toBeInTheDocument();

    const note = screen.getByRole("note");
    expect(note).toContainElement(screen.getByText("sensitiveTitle"));
    expect(note).toContainElement(screen.getByText("sensitiveBody"));
  });

  it("leaves the technical details out when the host turns them off", () => {
    renderDialog({ technicalDetails: false });

    expect(screen.queryByRole("button", { name: "technicalTitle" })).toBeNull();
    expect(screen.queryByText("technicalHint")).toBeNull();
    expect(screen.getByRole("button", { name: "sharedTitle" })).toBeInTheDocument();
  });

  it("sends with a summary and no description", async () => {
    const user = userEvent.setup();
    const { submit } = renderDialog();

    await user.type(screen.getByLabelText("summaryLabel"), "Export");
    await user.click(screen.getByRole("button", { name: "bug.send" }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const form = submit.mock.calls[0][0];
    expect(form.get("summary")).toBe("Export");
    expect(form.get("description")).toBe("");
  });

  it("submits the form, then shows the filed number", async () => {
    const user = userEvent.setup();
    const { submit } = renderDialog();

    await user.type(screen.getByLabelText("summaryLabel"), "Klienti label");
    await user.type(screen.getByLabelText("bug.descriptionLabel"), "  Klienti label is wrong  ");
    await user.click(screen.getByRole("radio", { name: "bug.impactBlocks" }));
    await user.click(screen.getByRole("button", { name: "bug.send" }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const form = submit.mock.calls[0][0];
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("kind")).toBe("bug");
    expect(form.get("description")).toBe("Klienti label is wrong");
    expect(form.get("impact")).toBe("blocks");
    expect(form.get("area")).toBe("/projects/7/board");
    expect(form.get("version")).toBe("3862535");
    // Absent here, and only here: jsdom loads no image, so the pane never gets a
    // bitmap to flatten and refuses to export a blank canvas. The PNG the
    // editor really produces is verified in a real browser by Task 10's walk.
    expect(form.has("screenshot")).toBe(false);

    expect(await screen.findByText("issue 141")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  // jsdom paints nothing, but it does run the handlers — and the handlers are
  // where a drag used to take the whole panel down: React nulls currentTarget
  // once a handler returns, so reading the pointer position inside a state
  // updater read it off null. The two events share one act() deliberately. With
  // the queue empty React computes an updater eagerly, inside the dispatch,
  // where currentTarget is still live and the bug hides; a second press before
  // the first has flushed is what defers it to render, which is where a real
  // browser runs it.
  it("survives a pointer drag on the canvas", () => {
    renderDialog();
    const canvas = screen.getByLabelText("screenshotTitle");
    canvas.setPointerCapture = () => {};

    act(() => {
      fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 12, clientY: 14 });
    });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 60 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    expect(screen.getByRole("button", { name: "undo" })).toBeInTheDocument();
  });

  // Reading the pointer position is the only observable side effect of "this
  // event started or extended a shape" — jsdom paints nothing, so the geometry
  // itself goes nowhere a test can see it.
  it("draws on the primary button only, and stops when the drag is cancelled", async () => {
    // HACK: jsdom never fires an image's load, and the pane draws nothing until
    // one has loaded, so the stand-in image is what lets a pointer event reach
    // the geometry at all.
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 800;
        naturalHeight = 600;
        onload: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    renderDialog();
    const canvas = screen.getByLabelText("screenshotTitle");
    await waitFor(() => expect(canvas).toHaveAttribute("width", "800"));
    canvas.setPointerCapture = () => {};
    const measured = vi.spyOn(canvas, "getBoundingClientRect");

    fireEvent.pointerDown(canvas, { button: 2, pointerId: 1, clientX: 5, clientY: 5 });
    expect(measured).not.toHaveBeenCalled();

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    expect(measured).toHaveBeenCalled();

    measured.mockClear();
    fireEvent.pointerCancel(canvas, { pointerId: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 60 });
    expect(measured).not.toHaveBeenCalled();
  });

  it("stops drawing when the pointer capture is taken away", () => {
    renderDialog();
    const canvas = screen.getByLabelText("screenshotTitle");
    canvas.setPointerCapture = () => {};
    const measured = vi.spyOn(canvas, "getBoundingClientRect");

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.lostPointerCapture(canvas, { pointerId: 1 });

    measured.mockClear();
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 60 });
    expect(measured).not.toHaveBeenCalled();
  });

  it("offers a placeholder and the paste hint when capture was skipped", () => {
    renderDialog({ capture: { ok: false, reason: "too-many-nodes" } });

    expect(screen.getByText("captureFallbackHint")).toBeInTheDocument();
    expect(screen.getByLabelText("uploadLabel")).toBeInTheDocument();
  });

  it("sends a text-only report when there is no screenshot", async () => {
    const user = userEvent.setup();
    const { submit } = renderDialog({ capture: { ok: false, reason: "failed" } });

    await user.type(screen.getByLabelText("summaryLabel"), "No image");
    await user.type(screen.getByLabelText("bug.descriptionLabel"), "No image, still a bug");
    await user.click(screen.getByRole("button", { name: "bug.send" }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0].has("screenshot")).toBe(false);
  });

  it("offers copy-to-clipboard when the submit fails", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    // Assignment is refused: userEvent.setup() has already installed its own
    // clipboard stub as a getter-only property on this Navigator.
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderDialog({ submit: vi.fn().mockRejectedValue(new Error("offline")) });

    await user.type(screen.getByLabelText("summaryLabel"), "Copy me");
    await user.type(screen.getByLabelText("bug.descriptionLabel"), "Send failed");
    await user.click(screen.getByRole("button", { name: "bug.send" }));

    await user.click(await screen.findByRole("button", { name: "copyToClipboard" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(
      reportAsText({
        kind: "bug",
        summary: "Copy me",
        description: "Send failed",
        impact: "workaround",
        context,
        environment,
        diagnostics: [],
        screenshot: null,
      }),
    );
    expect(await screen.findByText("copied")).toBeInTheDocument();
  });

  // "Not configured" and "try again in 40 seconds" are different problems, and
  // only one of them is worth a second Send. The server's own sentence is shown
  // verbatim, so the reporter reads why the report was refused.
  it("shows the server's own reason for refusing the report", async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn()
      .mockRejectedValue(new Error("Bug reporting is not configured on this server."));
    renderDialog({ submit });

    await user.type(screen.getByLabelText("summaryLabel"), "Save");
    await user.type(screen.getByLabelText("bug.descriptionLabel"), "Nothing happens on Save");
    await user.click(screen.getByRole("button", { name: "bug.send" }));

    expect(
      await screen.findByText("Bug reporting is not configured on this server."),
    ).toBeInTheDocument();
    expect(screen.getByText("failureTitle")).toBeInTheDocument();
  });

  it("falls back to a selectable textarea when the clipboard is unavailable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    renderDialog({ submit: vi.fn().mockRejectedValue(new Error("offline")) });

    await user.type(screen.getByLabelText("summaryLabel"), "No clipboard");
    await user.type(screen.getByLabelText("bug.descriptionLabel"), "No clipboard here");
    await user.click(screen.getByRole("button", { name: "bug.send" }));
    await user.click(await screen.findByRole("button", { name: "copyToClipboard" }));

    const fallback = await screen.findByRole("textbox", { name: "copyToClipboard" });
    expect(fallback).toHaveDisplayValue(/No clipboard here/);
    expect(fallback).toHaveFocus();
    expect(screen.getByText("copyManually")).toBeInTheDocument();
  });

  // The textarea's cap is I1's `description` cap: the browser refuses the
  // 5001st character, so the server never has to.
  it("keeps the description within the server's cap", () => {
    renderDialog();

    expect((screen.getByLabelText("bug.descriptionLabel") as HTMLTextAreaElement).maxLength).toBe(
      5000,
    );
  });

  it("ignores a second Send while the first is still in flight", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() => new Promise<never>(() => {}));
    renderDialog({ submit });

    await user.type(screen.getByLabelText("summaryLabel"), "Double click");
    await user.type(screen.getByLabelText("bug.descriptionLabel"), "Double click me");
    const send = screen.getByRole("button", { name: "bug.send" });
    await user.click(send);

    await waitFor(() => expect(send).toHaveAttribute("aria-disabled", "true"));
    await user.click(send);

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("announces the outcome in a live region and moves focus to it", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("summaryLabel"), "Bill total");
    await user.type(screen.getByLabelText("bug.descriptionLabel"), "Wrong total on the bill");
    await user.click(screen.getByRole("button", { name: "bug.send" }));

    const status = await screen.findByRole("status");
    expect(within(status).getByText("issue 141")).toBeInTheDocument();
    expect(screen.getByText("successTitle")).toHaveFocus();
  });

  it("refuses an upload the backend would reject", async () => {
    const user = userEvent.setup();
    renderDialog({ capture: { ok: false, reason: "failed" } });

    const input = screen.getByLabelText("uploadLabel");
    const oversize = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", {
      type: "image/png",
    });

    await user.upload(input, oversize);
    expect(await screen.findByText("uploadRejected")).toBeInTheDocument();

    // `accept` is advisory — a drag-and-drop reaches the same handler — so the
    // type is refused in the handler rather than trusted from the picker.
    fireEvent.change(input, {
      target: { files: [new File(["x"], "shot.jpg", { type: "image/jpeg" })] },
    });
    expect(await screen.findByText("uploadRejected")).toBeInTheDocument();
  });

  // The editor has no picker of its own, but the pane's document-level paste
  // handler reaches the same refusal. Rendering the message only alongside the
  // placeholder meant a pasted JPEG over a good capture was dropped in silence.
  it("says an upload was refused even when a capture is already on screen", async () => {
    renderDialog();

    fireEvent.paste(document, {
      clipboardData: { files: [new File(["x"], "shot.jpg", { type: "image/jpeg" })] },
    });

    expect(await screen.findByText("uploadRejected")).toBeInTheDocument();
  });

  // GlobalSearch takes Ctrl/Cmd+K on `window` and focuses a box that sits
  // under this overlay; from here the key must go nowhere.
  it("keeps Ctrl/Cmd+K to itself, so the page's search box under it is not focused", async () => {
    const user = userEvent.setup();
    const search = vi.fn();
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") search(event);
    };
    window.addEventListener("keydown", onKey);
    try {
      const { onClose } = renderDialog();
      const summary = screen.getByLabelText("summaryLabel");
      expect(document.activeElement).toBe(summary);
      await user.keyboard("{Control>}k{/Control}");
      await user.keyboard("{Meta>}k{/Meta}");
      expect(search).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(summary);
    } finally {
      window.removeEventListener("keydown", onKey);
    }
  });

  /**
   * The app's Modal listens for Escape on `window` as well, and this dialog is
   * the one that opens on top. One press must not also close the form the
   * reporter was filling in when they hit the bug.
   */
  it("keeps Escape to itself, so a form modal underneath stays open", async () => {
    const user = userEvent.setup();
    const underneath = vi.fn();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") underneath(event);
    };
    window.addEventListener("keydown", onKey);

    try {
      const { onClose } = renderDialog();

      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(underneath).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onKey);
    }
  });

  it("locks body scroll while it is open and restores exactly what it found", () => {
    document.body.style.overflow = "scroll";

    const { unmount } = renderDialog();
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("scroll");
  });

  /**
   * Modal.tsx counts its own locks and this folder cannot see that counter, so
   * both would restore the same property. Whichever unlocks last wins, and when
   * that is this dialog it writes back the "hidden" it found — leaving the panel
   * unscrollable until a reload. Deferring leaves exactly one owner.
   */
  it("leaves the lock alone when a form modal underneath already holds it", () => {
    document.body.style.overflow = "hidden";

    const { unmount } = renderDialog();
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("hidden");
  });
});
