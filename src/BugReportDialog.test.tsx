import { cleanup, act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BugReportDialog } from "./BugReportDialog.js";
import type { BugReportLabels } from "./labels.js";
import type { BugReportContext, BugReportEnvironment } from "./payload.js";

// Every label is its own key, so an assertion names the string it means. The
// one template that interpolates has to stay a template, and the counter has to
// stay a function.
const TEMPLATES: Record<string, string> = { filed: "issue {number}" };

const labels = new Proxy({} as BugReportLabels, {
  get: (_t, key) => {
    if (key === "characterCount") return (used: number, limit: number) => `${used} / ${limit}`;
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
  });

  // The spec's rule is that everything the submission carries is visible before
  // Send, so this asserts every value in the context — not a sample of it.
  it("shows the read-only context so nobody sends what they have not seen", () => {
    renderDialog();

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
    expect(screen.queryByText("contextRequestId")).toBeNull();
  });

  it("refuses to send an empty description", async () => {
    const user = userEvent.setup();
    const { submit } = renderDialog();

    await user.click(screen.getByRole("button", { name: "send" }));

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText("descriptionRequired")).toBeInTheDocument();
  });

  it("submits the form, then shows the filed number", async () => {
    const user = userEvent.setup();
    const { submit } = renderDialog();

    await user.type(screen.getByLabelText("descriptionLabel"), "  Klienti label is wrong  ");
    await user.click(screen.getByLabelText("impactBlocks"));
    await user.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const form = submit.mock.calls[0][0];
    expect(form).toBeInstanceOf(FormData);
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

  it("offers all four tools and undo when there is an image", () => {
    renderDialog();

    for (const name of ["toolArrow", "toolRect", "toolFreehand", "toolBlackout", "undo"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
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
  it("draws on the primary button only, and stops when the drag is cancelled", () => {
    renderDialog();
    const canvas = screen.getByLabelText("screenshotTitle");
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

    await user.type(screen.getByLabelText("descriptionLabel"), "No image, still a bug");
    await user.click(screen.getByRole("button", { name: "send" }));

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

    await user.type(screen.getByLabelText("descriptionLabel"), "Send failed");
    await user.click(screen.getByRole("button", { name: "send" }));

    await user.click(await screen.findByRole("button", { name: "copyToClipboard" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Send failed"));
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

    await user.type(screen.getByLabelText("descriptionLabel"), "Nothing happens on Save");
    await user.click(screen.getByRole("button", { name: "send" }));

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

    await user.type(screen.getByLabelText("descriptionLabel"), "No clipboard here");
    await user.click(screen.getByRole("button", { name: "send" }));
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

    expect((screen.getByLabelText("descriptionLabel") as HTMLTextAreaElement).maxLength).toBe(
      5000,
    );
  });

  // aria-disabled, not `disabled`: a disabled button is blurred by the browser,
  // and a keyboard reporter would lose focus to <body> for the whole request. So
  // Cancel stays clickable and the handler is what refuses.
  it("closes on Escape, but never while the report is in flight", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog({ submit: vi.fn(() => new Promise<never>(() => {})) });

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText("descriptionLabel"), "Still in flight");
    await user.click(screen.getByRole("button", { name: "send" }));

    const cancel = screen.getByRole("button", { name: "cancel" });
    await waitFor(() => expect(cancel).toHaveAttribute("aria-disabled", "true"));

    await user.keyboard("{Escape}");
    await user.click(cancel);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a second Send while the first is still in flight", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() => new Promise<never>(() => {}));
    renderDialog({ submit });

    await user.type(screen.getByLabelText("descriptionLabel"), "Double click me");
    const send = screen.getByRole("button", { name: "send" });
    await user.click(send);

    await waitFor(() => expect(send).toHaveAttribute("aria-disabled", "true"));
    await user.click(send);

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("announces the outcome in a live region and moves focus to it", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("descriptionLabel"), "Wrong total on the bill");
    await user.click(screen.getByRole("button", { name: "send" }));

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
      const description = screen.getByLabelText("descriptionLabel");
      expect(document.activeElement).toBe(description);

      await user.keyboard("{Control>}k{/Control}");
      await user.keyboard("{Meta>}k{/Meta}");
      expect(search).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(description);
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
    // Only Escape: the description below is typed through this same listener,
    // and Modal's handler is the thing being kept away from that one key.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") underneath(event);
    };
    window.addEventListener("keydown", onKey);

    try {
      const { onClose } = renderDialog({ submit: vi.fn(() => new Promise<never>(() => {})) });

      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(underneath).not.toHaveBeenCalled();

      await user.type(screen.getByLabelText("descriptionLabel"), "Still in flight");
      await user.click(screen.getByRole("button", { name: "send" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "cancel" })).toHaveAttribute(
          "aria-disabled",
          "true",
        ),
      );

      // Ignored here, but still ours: letting it through would close the modal
      // behind a report that is on its way.
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
