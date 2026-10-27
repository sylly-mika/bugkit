import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
});
