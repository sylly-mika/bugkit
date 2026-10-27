import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { toPng } from "html-to-image";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BugReportButton } from "./BugReportButton.js";
import { defaultLabels } from "./labels.js";

vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

const toPngMock = vi.mocked(toPng);

const getContext = () => ({ area: "/projects/7/board", version: "3862535" });
// WHY: the capture hint and the sent-notice live region both have role="status"; the hint is the one inside its part.
const captureHintText = () =>
  document.querySelector('[data-bugkit="capture-hint"] [role="status"]')?.textContent;

function renderButton(children?: ReactNode) {
  const submit = vi.fn().mockResolvedValue({ id: "0190d1c2-0000-7000-8000-000000000141", number: 141 });

  render(
    <BugReportButton submit={submit} getContext={getContext} diagnostics={() => []}>
      {children}
    </BugReportButton>,
  );

  return { submit };
}

describe("BugReportButton", () => {
  // A braced body, deliberately: mockReset() returns the mock, and vitest takes
  // a function returned from beforeEach as the teardown hook — so the concise
  // form calls toPng() after every test, and the rejecting one then rejects
  // with nobody listening.
  beforeEach(() => {
    toPngMock.mockReset();
  });

  // The host passes only the words it changes; the rest come from the English
  // defaults, so a partial set never leaves a control unnamed.
  it("uses the default labels and lets a host override some", async () => {
    const user = userEvent.setup();
    render(
      <BugReportButton submit={vi.fn()} getContext={getContext} diagnostics={() => []} />,
    );
    expect(screen.getByRole("button", { name: defaultLabels.buttonLabel })).toBeInTheDocument();

    cleanup();
    toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");
    render(
      <BugReportButton
        submit={vi.fn()}
        getContext={getContext}
        labels={{ buttonLabel: "Report a bug" }}
        diagnostics={() => []}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Report a bug" }));

    expect(await screen.findByRole("button", { name: defaultLabels.bug.send })).toBeInTheDocument();
  });

  // The session is read when the launcher is pressed, not when the host renders:
  // what the report says is what the page said at the moment of the press.
  it("reads the host's context and diagnostics when pressed and sends them", async () => {
    const user = userEvent.setup();
    toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");
    const submit = vi.fn().mockResolvedValue({ id: "t-1", number: 141 });
    let area = "/before";

    render(
      <BugReportButton
        submit={submit}
        getContext={() => ({ area, version: "abc123", requestId: "req-9" })}
        diagnostics={() => [{ marker: "d-7" }]}
      />,
    );
    area = "/after";

    await user.click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));
    await user.type(await screen.findByLabelText(defaultLabels.summaryLabel), "Summary");
    await user.type(await screen.findByLabelText(defaultLabels.bug.descriptionLabel), "Broken save");
    await user.click(screen.getByRole("button", { name: defaultLabels.bug.send }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const form = submit.mock.calls[0][0];
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("area")).toBe("/after");
    expect(form.get("version")).toBe("abc123");
    expect(form.get("request_id")).toBe("req-9");
    expect(form.get("description")).toBe("Broken save");
    expect(String(form.get("diagnostics"))).toContain("d-7");
  });

  // The diagnostics callback is optional: a host without one still gets a valid
  // JSON part, because the server refuses a report without it.
  it("opens and sends without a diagnostics callback", async () => {
    const user = userEvent.setup();
    toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");
    const submit = vi.fn().mockResolvedValue({ id: "t-2", number: 142 });

    render(<BugReportButton submit={submit} getContext={getContext} />);

    await user.click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));
    await user.type(await screen.findByLabelText(defaultLabels.summaryLabel), "Summary");
    await user.type(await screen.findByLabelText(defaultLabels.bug.descriptionLabel), "No diagnostics");
    await user.click(screen.getByRole("button", { name: defaultLabels.bug.send }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const form = submit.mock.calls[0][0];
    expect(form).toBeInstanceOf(FormData);
    expect(() => JSON.parse(String(form.get("diagnostics")))).not.toThrow();
  });

  // Images from the host's own origins are worth inlining; anything else is
  // left out of the capture by the filter the capture hands to toPng.
  it("lets the capture keep images from the host's own origins", async () => {
    const user = userEvent.setup();
    toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");

    render(
      <BugReportButton
        submit={vi.fn()}
        getContext={getContext}
        diagnostics={() => []}
        allowedImageOrigins={["https://api.example.test"]}
      />,
    );
    await user.click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));
    await screen.findByRole("dialog");

    const { filter } = toPngMock.mock.calls[0][1]!;
    const own = document.createElement("img");
    own.src = "https://api.example.test/a.png";
    const other = document.createElement("img");
    other.src = "https://cdn.other.test/a.png";
    expect(filter!(own)).toBe(true);
    expect(filter!(other)).toBe(false);
  });

  // Two presses in one tick both read the render's `busy` as false; only a
  // ref stops the second from starting another full-page clone.
  it("captures once for two presses that land before it re-renders", async () => {
    let release!: (value: string) => void;
    toPngMock.mockReturnValue(new Promise<string>((resolve) => (release = resolve)));
    const onOpenChange = vi.fn();
    render(
      <BugReportButton
        submit={vi.fn()}
        getContext={() => ({ area: "/", version: "v" })}
        diagnostics={() => []}
        onOpenChange={onOpenChange}
      />,
    );
    const launcher = screen.getByRole("button", { name: defaultLabels.buttonLabel });

    await act(async () => {
      launcher.click();
      launcher.click();
    });
    expect(toPngMock).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      release("data:image/png;base64,AAECAw==");
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    await userEvent.setup().click(screen.getByRole("button", { name: defaultLabels.back }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  // The ordering is the feature: what gets annotated is the page as it was,
  // open modal and all, not the page with our dialog sitting on top of it.
  it("captures before the dialog opens", async () => {
    const user = userEvent.setup();
    let dialogVisibleAtCapture: boolean | null = null;
    toPngMock.mockImplementation(async () => {
      dialogVisibleAtCapture = screen.queryByRole("dialog") !== null;
      return "data:image/png;base64,AAECAw==";
    });
    renderButton();
    await user.click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));

    await screen.findByRole("dialog");
    expect(dialogVisibleAtCapture).toBe(false);
    expect(screen.getByLabelText(defaultLabels.screenshotTitle)).toBeInTheDocument();
  });

  it("still opens the dialog in placeholder mode when capture fails", async () => {
    const user = userEvent.setup();
    toPngMock.mockRejectedValue(new Error("tainted"));

    renderButton();
    await user.click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));

    await screen.findByRole("dialog");
    expect(screen.getByText(defaultLabels.captureFallbackHint)).toBeInTheDocument();
  });

  it("passes the host's choice to leave out the technical details", async () => {
    const user = userEvent.setup();
    toPngMock.mockRejectedValue(new Error("tainted"));

    render(<BugReportButton submit={vi.fn()} getContext={getContext} technicalDetails={false} />);
    await user.click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));

    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: defaultLabels.technicalTitle })).toBeNull();
  });

  it("closes on cancel and captures afresh on the next open", async () => {
    const user = userEvent.setup();
    toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");

    renderButton();
    await user.click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));
    await user.click(await screen.findByRole("button", { name: defaultLabels.back }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));
    await screen.findByRole("dialog");
    expect(toPngMock).toHaveBeenCalledTimes(2);
  });

  // The panel renders this as one icon in the header (admin #492), so the only
  // name it has is the one it declares — and a reader who cannot see the icon,
  // and a pointer user hovering it, have to be told the same thing.
  it("names itself for a host that renders no words in it", async () => {
    const user = userEvent.setup();
    let finishCapture: ((dataUrl: string) => void) | undefined;
    toPngMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishCapture = resolve;
        }),
    );

    renderButton(<svg data-testid="icon" />);
    const launcher = screen.getByRole("button", { name: defaultLabels.buttonLabel });

    expect(launcher.textContent).toBe("");
    expect(launcher).toHaveAttribute("title", defaultLabels.buttonLabel);
    expect(screen.getByTestId("icon")).toBeInTheDocument();

    // Nothing visible changes while the page is being photographed, so the name
    // is the only thing left to carry the wait — and it has to come back, or the
    // next report is filed by a control still called "Taking a screenshot…".
    await user.click(launcher);
    await waitFor(() =>
      expect(launcher).toHaveAttribute("aria-label", defaultLabels.capturePending),
    );
    expect(launcher).toHaveAttribute("title", defaultLabels.capturePending);

    await act(async () => finishCapture!("data:image/png;base64,AAECAw=="));
    await screen.findByRole("dialog");
    expect(launcher).toHaveAttribute("aria-label", defaultLabels.buttonLabel);
    expect(launcher).toHaveAttribute("title", defaultLabels.buttonLabel);
  });

  // A keyboard reporter who cancels must land back where they were, not at the
  // top of the document.
  it("returns focus to the launcher when the dialog closes", async () => {
    const user = userEvent.setup();
    toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");

    renderButton();
    const launcher = screen.getByRole("button", { name: defaultLabels.buttonLabel });

    await user.click(launcher);
    await user.click(await screen.findByRole("button", { name: defaultLabels.back }));

    await waitFor(() => expect(launcher).toHaveFocus());
  });

  describe("a sent report", () => {
    const noticeText = "Report sent. Its number is #141.";
    const noticeSelector = '[data-bugkit="notice-text"]';

    beforeEach(() => {
      toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function sendReport(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));
      await user.type(await screen.findByLabelText(defaultLabels.summaryLabel), "Summary");
      await user.click(screen.getByRole("button", { name: defaultLabels.bug.send }));
    }

    it("closes the dialog, returns focus to the launcher, and shows the notice with the number", async () => {
      const user = userEvent.setup();
      renderButton();
      const launcher = screen.getByRole("button", { name: defaultLabels.buttonLabel });

      await sendReport(user);

      expect(await screen.findByText(noticeText, { selector: noticeSelector })).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByRole("status")).toHaveTextContent(noticeText);
      await waitFor(() => expect(launcher).toHaveFocus());
    });

    it("fills a polite live region that was already there, so the sentence is announced once", async () => {
      const user = userEvent.setup();
      renderButton();

      expect(screen.getByRole("status")).toBeEmptyDOMElement();
      expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
      expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");

      await sendReport(user);

      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(noticeText));
      const live = Array.from(document.querySelectorAll('[aria-live], [role="status"]')).filter((element) =>
        element.textContent?.includes(noticeText),
      );
      expect(live).toHaveLength(1);
    });

    it("leaves after about five seconds, not before", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderButton();

      await sendReport(user);
      expect(await screen.findByText(noticeText, { selector: noticeSelector })).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(4_000));
      expect(screen.getByText(noticeText, { selector: noticeSelector })).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(2_000));
      expect(screen.queryByText(noticeText, { selector: noticeSelector })).toBeNull();
    });

    it("stays while the pointer is over it", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderButton();

      await sendReport(user);
      const notice = await screen.findByText(noticeText, { selector: noticeSelector });

      await user.hover(notice);
      act(() => vi.advanceTimersByTime(10_000));
      expect(screen.getByText(noticeText, { selector: noticeSelector })).toBeInTheDocument();

      await user.unhover(notice);
      act(() => vi.advanceTimersByTime(6_000));
      expect(screen.queryByText(noticeText, { selector: noticeSelector })).toBeNull();
    });

    it("stays while it has focus, even after the pointer has left", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderButton();

      await sendReport(user);
      const notice = await screen.findByText(noticeText, { selector: noticeSelector });
      const close = screen.getByRole("button", { name: defaultLabels.close });

      act(() => close.focus());
      await user.hover(notice);
      await user.unhover(notice);
      act(() => vi.advanceTimersByTime(10_000));
      expect(screen.getByText(noticeText, { selector: noticeSelector })).toBeInTheDocument();

      act(() => close.blur());
      act(() => vi.advanceTimersByTime(6_000));
      expect(screen.queryByText(noticeText, { selector: noticeSelector })).toBeNull();
    });

    it("drops the notice at once with reduced motion", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const original = window.matchMedia;
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("reduce"),
      })) as unknown as typeof window.matchMedia;

      try {
        renderButton();
        await sendReport(user);
        expect(await screen.findByText(noticeText, { selector: noticeSelector })).toBeInTheDocument();

        act(() => vi.advanceTimersByTime(5_100));
        expect(screen.queryByText(noticeText, { selector: noticeSelector })).toBeNull();
      } finally {
        window.matchMedia = original;
      }
    });

    it("goes at once when its close button is pressed", async () => {
      const user = userEvent.setup();
      renderButton();

      await sendReport(user);
      await user.click(await screen.findByRole("button", { name: defaultLabels.close }));

      expect(screen.queryByText(noticeText, { selector: noticeSelector })).toBeNull();
      expect(screen.queryByRole("button", { name: defaultLabels.close })).toBeNull();
    });

    it("never marks the notice as leaving with reduced motion", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const original = window.matchMedia;
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("reduce"),
      })) as unknown as typeof window.matchMedia;

      try {
        renderButton();
        await sendReport(user);
        const notice = (await screen.findByText(noticeText, { selector: noticeSelector })).parentElement;
        expect(notice).not.toBeNull();

        act(() => vi.advanceTimersByTime(4_900));
        expect(notice).not.toHaveAttribute("data-leaving");

        act(() => vi.advanceTimersByTime(200));
        expect(notice).not.toHaveAttribute("data-leaving");
        expect(screen.queryByText(noticeText, { selector: noticeSelector })).toBeNull();
      } finally {
        window.matchMedia = original;
      }
    });

    it("hands the number to onSent and shows no notice of its own", async () => {
      const user = userEvent.setup();
      const onSent = vi.fn();
      const submit = vi
        .fn()
        .mockResolvedValue({ id: "0190d1c2-0000-7000-8000-000000000141", number: 141 });
      render(
        <BugReportButton
          submit={submit}
          getContext={getContext}
          diagnostics={() => []}
          onSent={onSent}
        />,
      );

      await sendReport(user);

      await waitFor(() => expect(onSent).toHaveBeenCalledWith({ number: 141 }));
      expect(screen.queryByText(noticeText, { selector: noticeSelector })).toBeNull();
    });

    it("keeps the sent view behind confirmation=\"dialog\"", async () => {
      const user = userEvent.setup();
      const submit = vi
        .fn()
        .mockResolvedValue({ id: "0190d1c2-0000-7000-8000-000000000141", number: 141 });
      render(
        <BugReportButton
          submit={submit}
          getContext={getContext}
          diagnostics={() => []}
          confirmation="dialog"
        />,
      );

      await sendReport(user);

      expect(await screen.findByText(defaultLabels.successTitle)).toBeInTheDocument();
      expect(screen.getByText("The report number is #141.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: defaultLabels.close })).toBeInTheDocument();
      expect(screen.queryByText(noticeText, { selector: noticeSelector })).toBeNull();
    });
  });

  describe("screenshot retakes", () => {
    beforeEach(() => {
      window.sessionStorage.clear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retakes after a countdown and keeps the words", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");
      const onOpenChange = vi.fn();
      const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });

      try {
        render(
          <BugReportButton
            submit={vi.fn()}
            getContext={getContext}
            diagnostics={() => []}
            onOpenChange={onOpenChange}
          />,
        );
        await user.click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));
        await user.type(await screen.findByLabelText(defaultLabels.summaryLabel), "Login fails");
        await user.click(screen.getByRole("button", { name: defaultLabels.retakeDelayed }));

        expect(screen.queryByRole("dialog")).toBeNull();
        expect(captureHintText()).toBe(defaultLabels.captureCountdown(3));
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(captureHintText()).toBe(defaultLabels.captureCountdown(2));
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(toPngMock).toHaveBeenCalledTimes(1);
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(toPngMock).toHaveBeenCalledTimes(2);

        expect(await screen.findByLabelText(defaultLabels.summaryLabel)).toHaveValue("Login fails");
        expect(onOpenChange.mock.calls).toEqual([[true]]);
      } finally {
        setItem.mockRestore();
      }
    });

    it("retakes on S, not while typing in a field", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");

      render(
        <>
          <input aria-label="Page search" />
          <BugReportButton
            submit={vi.fn()}
            getContext={getContext}
            diagnostics={() => []}
            classNames={{ "capture-hint": "app-hint" }}
          />
        </>,
      );
      await user.click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));
      await user.click(await screen.findByRole("button", { name: defaultLabels.retakeOnKey }));

      expect(captureHintText()).toBe(defaultLabels.captureKeyHint);
      const bar = document.querySelector<HTMLElement>('[data-bugkit="capture-hint"]');
      expect(bar).toHaveClass("app-hint");

      await user.type(screen.getByLabelText("Page search"), "s");
      expect(toPngMock).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Page search")).toHaveValue("s");

      (document.activeElement as HTMLElement).blur();
      await user.keyboard("s");
      await waitFor(() => expect(toPngMock).toHaveBeenCalledTimes(2));
      const { filter } = toPngMock.mock.calls[1][1]!;
      expect(filter!(bar!)).toBe(false);
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    it("does not retake on S with Ctrl, Meta or Alt", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");

      renderButton();
      await user.click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));
      await user.click(await screen.findByRole("button", { name: defaultLabels.retakeOnKey }));
      (document.activeElement as HTMLElement).blur();

      await user.keyboard("{Control>}s{/Control}");
      await user.keyboard("{Meta>}s{/Meta}");
      await user.keyboard("{Alt>}s{/Alt}");
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(toPngMock).toHaveBeenCalledTimes(1);

      await user.keyboard("s");
      await waitFor(() => expect(toPngMock).toHaveBeenCalledTimes(2));
    });

    it.each([
      ["delay", "Escape"],
      ["delay", "Cancel screenshot"],
      ["key", "Escape"],
      ["key", "Cancel screenshot"],
    ])("cancels a pending %s retake with %s", async (mode, how) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");
      const pageKeys = vi.fn();
      window.addEventListener("keydown", pageKeys);

      try {
        renderButton();
        await user.click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));
        await user.click(
          await screen.findByRole("button", {
            name: mode === "delay" ? defaultLabels.retakeDelayed : defaultLabels.retakeOnKey,
          }),
        );
        if (how === "Escape") {
          await user.keyboard("{Escape}");
        } else {
          await user.click(screen.getByRole("button", { name: defaultLabels.captureCancel }));
        }

        expect(await screen.findByRole("dialog")).toBeInTheDocument();
        expect(toPngMock).toHaveBeenCalledTimes(1);
        await act(() => vi.advanceTimersByTimeAsync(5000));
        expect(toPngMock).toHaveBeenCalledTimes(1);
        expect(pageKeys.mock.calls.some(([event]) => event.key === "Escape")).toBe(false);
      } finally {
        window.removeEventListener("keydown", pageKeys);
      }
    });

    it("ignores the launcher while a retake waits", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");

      renderButton();
      const launcher = screen.getByRole("button", { name: defaultLabels.buttonLabel });
      await user.click(launcher);
      await user.click(await screen.findByRole("button", { name: defaultLabels.retakeOnKey }));

      await user.click(launcher);
      expect(toPngMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
