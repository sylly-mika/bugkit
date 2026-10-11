import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toPng } from "html-to-image";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BugReportButton } from "./BugReportButton.js";
import { defaultLabels } from "./labels.js";

vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

const toPngMock = vi.mocked(toPng);

const getContext = () => ({ area: "/projects/7/board", version: "3862535" });

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

    expect(await screen.findByRole("button", { name: defaultLabels.send })).toBeInTheDocument();
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
    await user.type(await screen.findByLabelText(defaultLabels.descriptionLabel), "Broken save");
    await user.click(screen.getByRole("button", { name: defaultLabels.send }));

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
    await user.type(await screen.findByLabelText(defaultLabels.descriptionLabel), "No diagnostics");
    await user.click(screen.getByRole("button", { name: defaultLabels.send }));

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

    await userEvent.setup().click(screen.getByRole("button", { name: defaultLabels.cancel }));
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

  it("closes on cancel and captures afresh on the next open", async () => {
    const user = userEvent.setup();
    toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");

    renderButton();
    await user.click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));
    await user.click(await screen.findByRole("button", { name: defaultLabels.cancel }));

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
    await user.click(await screen.findByRole("button", { name: defaultLabels.cancel }));

    await waitFor(() => expect(launcher).toHaveFocus());
  });
});
