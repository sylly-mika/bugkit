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

  it("offers no Reported issues item without listReports", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: launcherName }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Reported issues" })).toBeNull();
  });
});
