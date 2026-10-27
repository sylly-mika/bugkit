import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { getFontEmbedCSS, toPng } from "html-to-image";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BugReportButton } from "./BugReportButton.js";
import { clearPageFonts } from "./capture.js";
import { defaultLabels } from "./labels.js";

vi.mock("html-to-image", () => ({ toPng: vi.fn(), getFontEmbedCSS: vi.fn() }));

const toPngMock = vi.mocked(toPng);
const getFontEmbedCSSMock = vi.mocked(getFontEmbedCSS);

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

const launcherName = `${defaultLabels.buttonLabel}, ${defaultLabels.buttonMenuHint}`;

// The launcher opens the menu; "Screenshot now" is the item that takes the shot at once.
async function shootNow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: launcherName }));
  await user.click(await screen.findByRole("menuitem", { name: defaultLabels.screenshotNow }));
}

describe("BugReportButton", () => {
  // A braced body, deliberately: mockReset() returns the mock, and vitest takes
  // a function returned from beforeEach as the teardown hook — so the concise
  // form calls toPng() after every test, and the rejecting one then rejects
  // with nobody listening.
  beforeEach(() => {
    toPngMock.mockReset();
    getFontEmbedCSSMock.mockReset();
    getFontEmbedCSSMock.mockResolvedValue("");
    clearPageFonts();
  });

  // The host passes only the words it changes; the rest come from the English
  // defaults, so a partial set never leaves a control unnamed.
  it("uses the default labels and lets a host override some", async () => {
    const user = userEvent.setup();
    render(
      <BugReportButton submit={vi.fn()} getContext={getContext} diagnostics={() => []} />,
    );
    expect(screen.getByRole("button", { name: launcherName })).toBeInTheDocument();

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
    await user.click(screen.getByRole("button", { name: `Report a bug, ${defaultLabels.buttonMenuHint}` }));
    await user.click(await screen.findByRole("menuitem", { name: defaultLabels.screenshotNow }));

    expect(await screen.findByRole("button", { name: defaultLabels.bug.send })).toBeInTheDocument();
  });

  it("shows the default text of the menu items when the host's label set predates them", async () => {
    const user = userEvent.setup();
    const {
      buttonMenuHint: _buttonMenuHint,
      screenshotNow: _screenshotNow,
      screenshotInThreeSeconds: _screenshotInThreeSeconds,
      screenshotOnKeyPress: _screenshotOnKeyPress,
      sendWithoutScreenshot: _sendWithoutScreenshot,
      ...v010Labels
    } = defaultLabels;
    render(
      <BugReportButton
        submit={vi.fn()}
        getContext={getContext}
        labels={v010Labels}
        diagnostics={() => []}
      />,
    );

    await user.click(screen.getByRole("button", { name: launcherName }));

    const items = within(await screen.findByRole("menu")).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      defaultLabels.screenshotNow,
      defaultLabels.screenshotInThreeSeconds,
      defaultLabels.screenshotOnKeyPress,
      defaultLabels.sendWithoutScreenshot,
    ]);
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

    await shootNow(user);
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

    await shootNow(user);
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
    await shootNow(user);
    await screen.findByRole("dialog");

    const { filter } = toPngMock.mock.calls[0][1]!;
    const own = document.createElement("img");
    own.src = "https://api.example.test/a.png";
    const other = document.createElement("img");
    other.src = "https://cdn.other.test/a.png";
    expect(filter!(own)).toBe(true);
    expect(filter!(other)).toBe(false);
  });

  it("embeds the page's web fonts in the screenshot unless captureFonts is off", async () => {
    const user = userEvent.setup();
    const fonts = "@font-face{font-family:Mincho;src:url(data:font/woff2;base64,AAAA)}";
    getFontEmbedCSSMock.mockResolvedValue(fonts);
    toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");

    const { unmount } = render(
      <BugReportButton submit={vi.fn()} getContext={getContext} diagnostics={() => []} />,
    );
    await shootNow(user);
    await screen.findByRole("dialog");
    expect(toPngMock.mock.calls[0][1]).toMatchObject({ fontEmbedCSS: fonts });
    unmount();

    clearPageFonts();
    toPngMock.mockClear();
    render(
      <BugReportButton submit={vi.fn()} getContext={getContext} diagnostics={() => []} captureFonts={false} />,
    );
    await shootNow(user);
    await screen.findByRole("dialog");
    expect(toPngMock.mock.calls[0][1]).toMatchObject({ skipFonts: true });
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
        screenshotModes={false}
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
    await shootNow(user);

    await screen.findByRole("dialog");
    expect(dialogVisibleAtCapture).toBe(false);
    expect(screen.getByLabelText(defaultLabels.screenshotTitle)).toBeInTheDocument();
  });

  it("still opens the dialog in placeholder mode when capture fails", async () => {
    const user = userEvent.setup();
    toPngMock.mockRejectedValue(new Error("tainted"));

    renderButton();
    await shootNow(user);

    await screen.findByRole("dialog");
    expect(screen.getByText(defaultLabels.captureFallbackHint)).toBeInTheDocument();
  });

  it("passes the host's choice to leave out the technical details", async () => {
    const user = userEvent.setup();
    toPngMock.mockRejectedValue(new Error("tainted"));

    render(<BugReportButton submit={vi.fn()} getContext={getContext} technicalDetails={false} />);
    await shootNow(user);

    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: defaultLabels.technicalTitle })).toBeNull();
  });

  it("closes on cancel and captures afresh on the next open", async () => {
    const user = userEvent.setup();
    toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");

    renderButton();
    await shootNow(user);
    await user.click(await screen.findByRole("button", { name: defaultLabels.back }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await shootNow(user);
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
    const launcher = screen.getByRole("button", { name: launcherName });

    expect(launcher.textContent).toBe("");
    expect(launcher).toHaveAttribute("title", launcherName);
    expect(screen.getByTestId("icon")).toBeInTheDocument();

    // Nothing visible changes while the page is being photographed, so the name
    // is the only thing left to carry the wait — and it has to come back, or the
    // next report is filed by a control still called "Taking a screenshot…".
    await user.click(launcher);
    await user.click(await screen.findByRole("menuitem", { name: defaultLabels.screenshotNow }));
    await waitFor(() =>
      expect(launcher).toHaveAttribute("aria-label", defaultLabels.capturePending),
    );
    expect(launcher).toHaveAttribute("title", defaultLabels.capturePending);

    await act(async () => finishCapture!("data:image/png;base64,AAECAw=="));
    await screen.findByRole("dialog");
    expect(launcher).toHaveAttribute("aria-label", launcherName);
    expect(launcher).toHaveAttribute("title", launcherName);
  });

  // A keyboard reporter who cancels must land back where they were, not at the
  // top of the document.
  it("returns focus to the launcher when the dialog closes", async () => {
    const user = userEvent.setup();
    toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");

    renderButton();
    const launcher = screen.getByRole("button", { name: launcherName });

    await user.click(launcher);
    await user.click(await screen.findByRole("menuitem", { name: defaultLabels.screenshotNow }));
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
      await shootNow(user);
      await user.type(await screen.findByLabelText(defaultLabels.summaryLabel), "Summary");
      await user.click(screen.getByRole("button", { name: defaultLabels.bug.send }));
    }

    it("closes the dialog, returns focus to the launcher, and shows the notice with the number", async () => {
      const user = userEvent.setup();
      renderButton();
      const launcher = screen.getByRole("button", { name: launcherName });

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

    it("gives a second notice of the same number its full time", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderButton();

      await sendReport(user);
      expect(await screen.findByText(noticeText, { selector: noticeSelector })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(3_000));

      await sendReport(user);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      act(() => vi.advanceTimersByTime(3_000));
      expect(screen.getByText(noticeText, { selector: noticeSelector })).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(2_500));
      expect(screen.queryByText(noticeText, { selector: noticeSelector })).toBeNull();
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
      // WHY: fake timers without shouldAdvanceTime, and fireEvent instead of user-event: the clock
      // must not move on its own, or the notice's 5 s timer drifts past the exact 4 999 ms check.
      vi.useFakeTimers();
      const settle = async (found: () => unknown) => {
        for (let i = 0; i < 50 && !found(); i++) await act(async () => {});
      };
      const original = window.matchMedia;
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("reduce"),
      })) as unknown as typeof window.matchMedia;

      const leaving: Element[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) leaving.push(record.target as Element);
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ["data-leaving"], subtree: true });

      try {
        renderButton();
        fireEvent.click(screen.getByRole("button", { name: launcherName }));
        fireEvent.click(screen.getByRole("menuitem", { name: defaultLabels.screenshotNow }));
        await act(() => vi.advanceTimersByTimeAsync(20));
        await settle(() => screen.queryByLabelText(defaultLabels.summaryLabel));
        fireEvent.change(screen.getByLabelText(defaultLabels.summaryLabel), { target: { value: "Summary" } });
        fireEvent.click(screen.getByRole("button", { name: defaultLabels.bug.send }));
        await settle(() => screen.queryByText(noticeText, { selector: noticeSelector }));
        expect(screen.getByText(noticeText, { selector: noticeSelector })).toBeInTheDocument();

        act(() => vi.advanceTimersByTime(4_999));
        expect(screen.getByText(noticeText, { selector: noticeSelector })).toBeInTheDocument();

        act(() => vi.advanceTimersByTime(1));
        expect(screen.queryByText(noticeText, { selector: noticeSelector })).toBeNull();

        await act(async () => {});
        expect(leaving).toEqual([]);
      } finally {
        observer.disconnect();
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

  describe("the screenshot menu", () => {
    beforeEach(() => {
      window.sessionStorage.clear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("opens a menu on press, takes no screenshot, and focuses the first item", async () => {
      const user = userEvent.setup();
      toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");
      renderButton();
      const launcher = screen.getByRole("button", { name: launcherName });

      await user.click(launcher);

      const items = within(await screen.findByRole("menu")).getAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual([
        defaultLabels.screenshotNow,
        defaultLabels.screenshotInThreeSeconds,
        defaultLabels.screenshotOnKeyPress,
        defaultLabels.sendWithoutScreenshot,
      ]);
      expect(launcher).toHaveAttribute("aria-haspopup", "menu");
      expect(launcher).toHaveAttribute("aria-expanded", "true");
      expect(items[0]).toHaveFocus();
      expect(toPngMock).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("moves between the items with the arrow keys, Home and End, and wraps", async () => {
      const user = userEvent.setup();
      renderButton();
      await user.click(screen.getByRole("button", { name: launcherName }));
      const items = within(await screen.findByRole("menu")).getAllByRole("menuitem");

      await user.keyboard("{ArrowDown}");
      expect(items[1]).toHaveFocus();
      await user.keyboard("{ArrowUp}{ArrowUp}");
      expect(items[3]).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(items[0]).toHaveFocus();
      await user.keyboard("{End}");
      expect(items[3]).toHaveFocus();
      await user.keyboard("{Home}");
      expect(items[0]).toHaveFocus();
      expect(toPngMock).not.toHaveBeenCalled();
    });

    it("closes on Escape and returns focus to the launcher, taking no screenshot", async () => {
      const user = userEvent.setup();
      renderButton();
      const launcher = screen.getByRole("button", { name: launcherName });
      await user.click(launcher);
      await screen.findByRole("menu");

      await user.keyboard("{Escape}");

      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      expect(launcher).toHaveFocus();
      expect(launcher).toHaveAttribute("aria-expanded", "false");
      expect(toPngMock).not.toHaveBeenCalled();
    });

    it("closes when the reporter clicks elsewhere", async () => {
      const user = userEvent.setup();
      renderButton();
      await user.click(screen.getByRole("button", { name: launcherName }));
      await screen.findByRole("menu");

      await user.click(document.body);

      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      expect(toPngMock).not.toHaveBeenCalled();
    });

    it("closes on Tab and returns focus to the launcher, taking no screenshot", async () => {
      const user = userEvent.setup();
      renderButton();
      const launcher = screen.getByRole("button", { name: launcherName });
      await user.click(launcher);
      await screen.findByRole("menu");

      await user.keyboard("{Tab}");

      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      expect(launcher).toHaveFocus();
      expect(launcher).toHaveAttribute("aria-expanded", "false");
      expect(toPngMock).not.toHaveBeenCalled();
    });

    it("closes the open menu when the launcher is pressed again", async () => {
      const user = userEvent.setup();
      renderButton();
      const launcher = screen.getByRole("button", { name: launcherName });
      await user.click(launcher);
      await screen.findByRole("menu");

      await user.click(launcher);

      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      expect(launcher).toHaveAttribute("aria-expanded", "false");
      expect(toPngMock).not.toHaveBeenCalled();
    });

    it.each([
      ["Enter", "{Enter}"],
      ["Space", " "],
    ])("%s on a focused item chooses it", async (_key, key) => {
      const user = userEvent.setup();
      renderButton();
      await user.click(screen.getByRole("button", { name: launcherName }));
      const items = within(await screen.findByRole("menu")).getAllByRole("menuitem");
      await user.keyboard("{End}");
      expect(items[3]).toHaveFocus();

      await user.keyboard(key);

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(toPngMock).not.toHaveBeenCalled();
      expect(screen.getByText(defaultLabels.screenshotRemoved)).toBeInTheDocument();
    });

    it("Screenshot now closes the menu before the page is photographed", async () => {
      const user = userEvent.setup();
      const menuDuringCapture: boolean[] = [];
      toPngMock.mockImplementation(async () => {
        menuDuringCapture.push(document.querySelector('[data-bugkit="screenshot-modes"]') !== null);
        return "data:image/png;base64,AAECAw==";
      });
      renderButton();
      await user.click(screen.getByRole("button", { name: launcherName }));
      await user.click(await screen.findByRole("menuitem", { name: defaultLabels.screenshotNow }));

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(menuDuringCapture).toEqual([false]);
    });

    it("Screenshot in 3 seconds counts down, then takes the screenshot and opens the dialog", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const hintDuringCapture: boolean[] = [];
      toPngMock.mockImplementation(async () => {
        hintDuringCapture.push(document.querySelector('[data-bugkit="capture-hint"]') !== null);
        return "data:image/png;base64,AAECAw==";
      });

      renderButton();
      await user.click(screen.getByRole("button", { name: launcherName }));
      await user.click(
        await screen.findByRole("menuitem", { name: defaultLabels.screenshotInThreeSeconds }),
      );

      expect(screen.queryByRole("menu")).toBeNull();
      expect(captureHintText()).toBe(defaultLabels.captureCountdown(3));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(captureHintText()).toBe(defaultLabels.captureCountdown(2));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(captureHintText()).toBe(defaultLabels.captureCountdown(1));
      expect(toPngMock).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(1000));
      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(toPngMock).toHaveBeenCalledTimes(1);
      expect(hintDuringCapture).toEqual([false]);
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    it("Screenshot on key press takes the screenshot on S, not while typing in a field", async () => {
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
      await user.click(screen.getByRole("button", { name: launcherName }));
      await user.click(await screen.findByRole("menuitem", { name: defaultLabels.screenshotOnKeyPress }));

      expect(captureHintText()).toBe(defaultLabels.captureKeyHint);
      const bar = document.querySelector<HTMLElement>('[data-bugkit="capture-hint"]');
      expect(bar).toHaveClass("app-hint");

      await user.type(screen.getByLabelText("Page search"), "s");
      expect(toPngMock).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Page search")).toHaveValue("s");

      (document.activeElement as HTMLElement).blur();
      await user.keyboard("s");
      await waitFor(() => expect(toPngMock).toHaveBeenCalledTimes(1));
      expect(document.querySelector('[data-bugkit="capture-hint"]')).toBeNull();
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    it("Screenshot on key press ignores S with Ctrl, Meta or Alt", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");

      renderButton();
      await user.click(screen.getByRole("button", { name: launcherName }));
      await user.click(await screen.findByRole("menuitem", { name: defaultLabels.screenshotOnKeyPress }));
      (document.activeElement as HTMLElement).blur();

      await user.keyboard("{Control>}s{/Control}");
      await user.keyboard("{Meta>}s{/Meta}");
      await user.keyboard("{Alt>}s{/Alt}");
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(toPngMock).not.toHaveBeenCalled();

      await user.keyboard("s");
      await waitFor(() => expect(toPngMock).toHaveBeenCalledTimes(1));
    });

    it("Send without screenshot opens the dialog with no screenshot", async () => {
      const user = userEvent.setup();
      renderButton();

      await user.click(screen.getByRole("button", { name: launcherName }));
      await user.click(await screen.findByRole("menuitem", { name: defaultLabels.sendWithoutScreenshot }));

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(toPngMock).not.toHaveBeenCalled();
      expect(screen.getByText(defaultLabels.screenshotRemoved)).toBeInTheDocument();
    });

    it.each([
      [defaultLabels.screenshotInThreeSeconds, "Escape"],
      [defaultLabels.screenshotInThreeSeconds, defaultLabels.captureCancel],
      [defaultLabels.screenshotOnKeyPress, "Escape"],
      [defaultLabels.screenshotOnKeyPress, defaultLabels.captureCancel],
    ])("cancels a wait from %s with %s, takes no screenshot, and returns focus to the launcher", async (item, how) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");
      const pageKeys = vi.fn();
      window.addEventListener("keydown", pageKeys);

      try {
        renderButton();
        const launcher = screen.getByRole("button", { name: launcherName });
        await user.click(launcher);
        await user.click(await screen.findByRole("menuitem", { name: item }));
        if (how === "Escape") {
          await user.keyboard("{Escape}");
        } else {
          await user.click(screen.getByRole("button", { name: defaultLabels.captureCancel }));
        }

        expect(captureHintText()).toBeUndefined();
        expect(launcher).toHaveFocus();
        await act(() => vi.advanceTimersByTimeAsync(5000));
        expect(toPngMock).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(pageKeys.mock.calls.some(([event]) => event.key === "Escape")).toBe(false);
      } finally {
        window.removeEventListener("keydown", pageKeys);
      }
    });

    it("ignores the launcher while the screenshot waits", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");

      renderButton();
      const launcher = screen.getByRole("button", { name: launcherName });
      await user.click(launcher);
      await user.click(await screen.findByRole("menuitem", { name: defaultLabels.screenshotOnKeyPress }));

      await user.click(launcher);
      expect(screen.queryByRole("menu")).toBeNull();
      expect(toPngMock).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("takes the screenshot at once when screenshotModes is off", async () => {
      toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");
      render(
        <BugReportButton
          submit={vi.fn()}
          getContext={getContext}
          diagnostics={() => []}
          screenshotModes={false}
        />,
      );

      await userEvent.setup().click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(toPngMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });
});
