import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BugReportButtonProps } from "./BugReportButton.js";
import { BugReportButton } from "./BugReportButton.js";
import { defaultLabels } from "./labels.js";
import type { ReportedIssue, ReportedIssuesPage } from "./payload.js";

const getContext = () => ({ area: "/projects/7/board", version: "3862535" });
const launcherName = `${defaultLabels.buttonLabel}, ${defaultLabels.buttonMenuHint}`;

const login: ReportedIssue = {
  number: 12,
  title: "Login fails",
  status: "Done",
  status_category: "done",
  reporter_name: "Ana",
  reported_at: "2026-10-01T09:00:00Z",
  updated_at: "2026-10-02T09:00:00Z",
};

const old: ReportedIssue = {
  number: 11,
  title: "Old",
  status: "Received",
  status_category: "triage",
  reporter_name: null,
  reported_at: "2026-09-01T09:00:00Z",
  updated_at: "2026-09-03T09:00:00Z",
};

const three: ReportedIssue = { ...login, number: 3, title: "Three", reporter_name: "Ben" };
const two: ReportedIssue = { ...login, number: 2, title: "Two", reporter_name: "Cy" };

const answer = (data: ReportedIssue[], meta: ReportedIssuesPage["meta"]): ReportedIssuesPage => ({ data, meta });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderButton(props: Partial<BugReportButtonProps> = {}) {
  render(<BugReportButton submit={vi.fn()} getContext={getContext} diagnostics={() => []} {...props} />);
}

async function openReports(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: launcherName }));
  await user.click(await screen.findByRole("menuitem", { name: "Reported issues" }));
  return screen.findByRole("dialog", { name: "Reported issues" });
}

afterEach(() => {
  cleanup();
});

describe("ReportedIssuesPanel", () => {
  it("shows the reports, newest first as given", async () => {
    const user = userEvent.setup();
    const pending = deferred<ReportedIssuesPage>();
    const listReports = vi.fn((_page: number) => pending.promise);
    renderButton({ listReports });

    const dialog = await openReports(user);
    expect(within(dialog).getByRole("status")).toHaveTextContent("Loading reports…");

    await act(async () => pending.resolve(answer([login, old], { page: 1, per_page: 20, total: 2, total_pages: 1 })));

    const rows = within(within(dialog).getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const [first, second] = rows.map((row) => within(row).getAllByRole("cell"));

    expect(first[0].textContent).toBe("#12 Login fails");
    const status = first[1].querySelector('[data-bugkit="reports-status"]');
    expect(status?.textContent).toBe("Done");
    expect(status).toHaveAttribute("data-category", "done");
    expect(first[2].textContent).toBe("Ana");
    expect(first[3].querySelector("time")).toHaveAttribute("datetime", login.reported_at);
    expect(first[4].querySelector("time")).toHaveAttribute("datetime", login.updated_at);

    expect(second[0].textContent).toBe("#11 Old");
    expect(second[2].textContent).toBe("Unknown");

    expect(within(dialog).queryByRole("button", { name: "Previous" })).toBeNull();
    expect(listReports.mock.calls).toEqual([[1]]);
  });

  it("pages through the reports", async () => {
    const user = userEvent.setup();
    const listReports = vi.fn(async (page: number): Promise<ReportedIssuesPage> =>
      page === 1
        ? answer([three], { page: 1, per_page: 1, total: 2, total_pages: 2 })
        : answer([two], { page: 2, per_page: 1, total: 2, total_pages: 2 }),
    );
    renderButton({ listReports });

    const dialog = await openReports(user);
    await within(dialog).findByText("#3 Three");
    expect(within(dialog).getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(within(dialog).getByText("Page 1 of 2")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await within(dialog).findByText("#2 Two");
    expect(within(dialog).getByText("Page 2 of 2")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Next" })).toBeDisabled();
    expect(listReports.mock.calls).toEqual([[1], [2]]);
  });

  it("drops an answer for a page no longer wanted", async () => {
    const user = userEvent.setup();
    const pageTwo = deferred<ReportedIssuesPage>();
    const listReports = vi.fn((page: number) =>
      page === 2 ? pageTwo.promise : Promise.resolve(answer([three], { page: 1, per_page: 1, total: 2, total_pages: 2 })),
    );
    renderButton({ listReports });

    const dialog = await openReports(user);
    await within(dialog).findByText("#3 Three");

    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(within(dialog).getByRole("button", { name: "Previous" }));
    await within(dialog).findByText("#3 Three");

    await act(async () => pageTwo.resolve(answer([two], { page: 2, per_page: 1, total: 2, total_pages: 2 })));

    expect(within(dialog).getByText("#3 Three")).toBeInTheDocument();
    expect(within(dialog).queryByText("#2 Two")).toBeNull();
    expect(within(dialog).getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("shows a failure without the error's own text", async () => {
    const user = userEvent.setup();
    const listReports = vi.fn(async (_page: number): Promise<ReportedIssuesPage> => {
      throw new Error("secret detail");
    });
    renderButton({ listReports });

    const dialog = await openReports(user);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The reports could not be loaded.");
    expect(dialog.textContent).not.toContain("secret detail");
  });

  it("retries a first load that failed, and loads the list on Try again", async () => {
    const user = userEvent.setup();
    let calls = 0;
    const listReports = vi.fn(async (_page: number): Promise<ReportedIssuesPage> => {
      calls += 1;
      if (calls === 1) throw new Error("secret detail");
      return answer([login], { page: 1, per_page: 20, total: 1, total_pages: 1 });
    });
    renderButton({ listReports });

    const dialog = await openReports(user);
    await user.click(await within(dialog).findByRole("button", { name: "Try again" }));

    expect(await within(dialog).findByText("#12 Login fails")).toBeInTheDocument();
    expect(listReports.mock.calls).toEqual([[1], [1]]);
  });

  it("retries the page that failed, not the first page", async () => {
    const user = userEvent.setup();
    let pageTwoCalls = 0;
    const listReports = vi.fn(async (page: number): Promise<ReportedIssuesPage> => {
      if (page === 1) return answer([three], { page: 1, per_page: 1, total: 2, total_pages: 2 });
      pageTwoCalls += 1;
      if (pageTwoCalls === 1) throw new Error("secret detail");
      return answer([two], { page: 2, per_page: 1, total: 2, total_pages: 2 });
    });
    renderButton({ listReports });

    const dialog = await openReports(user);
    await within(dialog).findByText("#3 Three");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(await within(dialog).findByRole("button", { name: "Try again" }));

    expect(await within(dialog).findByText("#2 Two")).toBeInTheDocument();
    expect(listReports.mock.calls).toEqual([[1], [2], [2]]);
  });

  it("shows an empty list", async () => {
    const user = userEvent.setup();
    const listReports = vi.fn(async (_page: number): Promise<ReportedIssuesPage> =>
      answer([], { page: 1, per_page: 20, total: 0, total_pages: 0 }),
    );
    renderButton({ listReports });

    const dialog = await openReports(user);
    expect(await within(dialog).findByText("No reports yet.")).toBeInTheDocument();
  });

  it("closes on Close and on Escape, returning focus to the launcher, and Escape does not reach the host", async () => {
    const user = userEvent.setup();
    const listReports = vi.fn(async (_page: number): Promise<ReportedIssuesPage> =>
      answer([], { page: 1, per_page: 20, total: 0, total_pages: 0 }),
    );
    renderButton({ listReports });
    const launcher = screen.getByRole("button", { name: launcherName });

    const dialog = await openReports(user);
    await within(dialog).findByText("No reports yet.");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(launcher).toHaveFocus();

    const hostKeys = vi.fn();
    document.addEventListener("keydown", hostKeys);
    try {
      await openReports(user);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(launcher).toHaveFocus();
      expect(hostKeys.mock.calls.some(([event]) => event.key === "Escape")).toBe(false);
    } finally {
      document.removeEventListener("keydown", hostKeys);
    }
  });

  it("shows the host's status label over the default, and the status name for an unknown category", async () => {
    const user = userEvent.setup();
    const waiting: ReportedIssue = { ...old, number: 10, title: "Other", status: "Waiting", status_category: "awaiting" };
    const listReports = vi.fn(async (_page: number): Promise<ReportedIssuesPage> =>
      answer([login, waiting], { page: 1, per_page: 20, total: 2, total_pages: 1 }),
    );
    renderButton({ listReports, statusLabels: { done: "Shipped" } });

    const dialog = await openReports(user);
    await within(dialog).findByText("#12 Login fails");
    const statuses = dialog.querySelectorAll<HTMLElement>('[data-bugkit="reports-status"]');
    expect(statuses[0].textContent).toBe("Shipped");
    expect(statuses[0]).toHaveAttribute("data-category", "done");
    expect(statuses[1].textContent).toBe("Waiting");
  });

  it("shows the default text of each status category", async () => {
    const user = userEvent.setup();
    const statuses: ReportedIssue[] = [
      { ...old, number: 1, title: "A", status: "Triage", status_category: "triage" },
      { ...old, number: 2, title: "B", status: "Todo", status_category: "todo" },
      { ...old, number: 3, title: "C", status: "Doing", status_category: "in_progress" },
      { ...old, number: 4, title: "D", status: "Done", status_category: "done" },
      { ...old, number: 5, title: "E", status: "Cancelled", status_category: "cancelled" },
    ];
    const listReports = vi.fn(async (_page: number): Promise<ReportedIssuesPage> =>
      answer(statuses, { page: 1, per_page: 20, total: 5, total_pages: 1 }),
    );
    renderButton({ listReports });

    const dialog = await openReports(user);
    await within(dialog).findByText("#1 A");
    const texts = Array.from(dialog.querySelectorAll<HTMLElement>('[data-bugkit="reports-status"]'), (el) => el.textContent);
    expect(texts).toEqual(["Received", "Planned", "In progress", "Done", "Closed"]);
  });

  it("moves focus to Close when it opens", async () => {
    const user = userEvent.setup();
    const listReports = vi.fn(async (_page: number): Promise<ReportedIssuesPage> =>
      answer([], { page: 1, per_page: 20, total: 0, total_pages: 0 }),
    );
    renderButton({ listReports });

    const dialog = await openReports(user);
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("shows each date formatted for the reader, with the ISO time as its datetime", async () => {
    const user = userEvent.setup();
    const listReports = vi.fn(async (_page: number): Promise<ReportedIssuesPage> =>
      answer([login], { page: 1, per_page: 20, total: 1, total_pages: 1 }),
    );
    renderButton({ listReports });

    const dialog = await openReports(user);
    await within(dialog).findByText("#12 Login fails");
    const formatted = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
    const times = dialog.querySelectorAll("time");
    expect(times[0].textContent).toBe(formatted(login.reported_at));
    expect(times[1].textContent).toBe(formatted(login.updated_at));
    expect(times[0]).toHaveAttribute("datetime", login.reported_at);
  });

  it("offers no Reported issues item without listReports", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: launcherName }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Reported issues" })).toBeNull();
  });
});
