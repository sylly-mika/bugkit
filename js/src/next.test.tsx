import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { toPng } from "html-to-image";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BugReport } from "./next.js";
import { defaultLabels } from "./labels.js";

vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

const toPngMock = vi.mocked(toPng);

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fileAReport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: `${defaultLabels.buttonLabel}, ${defaultLabels.buttonMenuHint}` }));
  await user.click(await screen.findByRole("menuitem", { name: defaultLabels.screenshotNow }));
  await user.type(await screen.findByLabelText(defaultLabels.summaryLabel), "Summary");
  await user.type(await screen.findByLabelText(defaultLabels.bug.descriptionLabel), "Broken save");
  await user.click(screen.getByRole("button", { name: defaultLabels.bug.send }));
}

beforeEach(() => {
  toPngMock.mockResolvedValue("data:image/png;base64,AAECAw==");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BugReport", () => {
  it("C1: posts to its endpoint with init and shows the filed number", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => answer(201, { id: "a", number: 7 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BugReport
        endpoint="/x"
        init={{ credentials: "include", headers: { Authorization: "Bearer t" } }}
        version="v9"
      />,
    );
    await fileAReport(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/x");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: { Authorization: "Bearer t" },
    });
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("area")).toBe(window.location.pathname);
    expect(form.get("version")).toBe("v9");
    expect(
      await screen.findByText("Report sent. Its number is #7.", { selector: '[data-bugkit="notice-text"]' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("C2: shows the server's sentence when the answer is refused", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      answer(422, { detail: "An area is required." }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const init = vi.fn(async () => ({ headers: { Authorization: "Bearer t2" } }));

    render(<BugReport init={init} />);
    await fileAReport(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, requestInit] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/bug-report");
    expect(requestInit).toMatchObject({ headers: { Authorization: "Bearer t2" } });
    expect(init).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("An area is required.")).toBeInTheDocument();
  });

  it("lists the reports through reportsEndpoint with init, and shows a failed list", async () => {
    const user = userEvent.setup();
    const report = {
      number: 5,
      title: "Old bug",
      status: "Done",
      status_category: "done",
      reporter_name: null,
      reported_at: "2026-01-02T10:00:00Z",
      updated_at: "2026-01-03T10:00:00Z",
    };
    const meta = { page: 1, per_page: 20, total: 1, total_pages: 1 };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => answer(200, { data: [report], meta }));
    vi.stubGlobal("fetch", fetchMock);

    render(<BugReport reportsEndpoint="/api/v1/bug-reports" init={{ headers: { "X-CSRF": "t" } }} />);
    await user.click(screen.getByRole("button", { name: `${defaultLabels.buttonLabel}, ${defaultLabels.buttonMenuHint}` }));
    await user.click(await screen.findByRole("menuitem", { name: defaultLabels.reportedIssues }));

    expect(await screen.findByText("#5 Old bug")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/bug-reports?page=1");
    expect(requestInit).toMatchObject({ method: "GET", headers: { "X-CSRF": "t" } });

    cleanup();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, _init?: RequestInit) => answer(500, { detail: "boom" })));
    render(<BugReport reportsEndpoint="/api/v1/bug-reports" />);
    await user.click(screen.getByRole("button", { name: `${defaultLabels.buttonLabel}, ${defaultLabels.buttonMenuHint}` }));
    await user.click(await screen.findByRole("menuitem", { name: defaultLabels.reportedIssues }));
    expect(await screen.findByRole("alert")).toHaveTextContent(defaultLabels.reportsFailed);
  });

  it("gives up on a list request that never answers after 30 seconds", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      vi.stubGlobal("fetch", fetchMock);

      render(<BugReport reportsEndpoint="/api/v1/bug-reports" />);
      fireEvent.click(screen.getByRole("button", { name: `${defaultLabels.buttonLabel}, ${defaultLabels.buttonMenuHint}` }));
      fireEvent.click(screen.getByRole("menuitem", { name: defaultLabels.reportedIssues }));
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await act(() => vi.advanceTimersByTimeAsync(29_000));
      expect(screen.getByText(defaultLabels.reportsLoading)).toBeInTheDocument();

      await act(() => vi.advanceTimersByTimeAsync(1_000));
      expect(screen.getByRole("alert")).toHaveTextContent(defaultLabels.reportsFailed);
    } finally {
      vi.useRealTimers();
    }
  });
});
