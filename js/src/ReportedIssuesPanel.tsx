import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatPage, reportedStatusText, type ReportedStatusLabels, type ResolvedBugReportLabels } from "./labels.js";
import type { ReportedIssue, ReportedIssuesList } from "./payload.js";
import { partProps, type BugReportClassNames } from "./theme.js";

const TITLE_ID = "bug-report-title";

type View = {
  state: "loading" | "failed" | "ready";
  page: number;
  pages: number;
  data: ReportedIssue[];
};

export function ReportedIssuesPanel(props: {
  listReports: ReportedIssuesList;
  labels: ResolvedBugReportLabels;
  statusLabels?: ReportedStatusLabels;
  classNames?: BugReportClassNames;
  onClose: () => void;
}) {
  const { listReports, labels, statusLabels, classNames, onClose } = props;
  const [view, setView] = useState<View>({ state: "loading", page: 1, pages: 1, data: [] });
  const requests = useRef(0);
  const alive = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  function load(page: number) {
    const ticket = ++requests.current;
    setView((previous) => ({ ...previous, state: "loading", page }));
    listReports(page).then(
      (answer) => {
        // WHY: an answer for a page no longer wanted would show the wrong page under the pager.
        if (!alive.current || ticket !== requests.current) return;
        setView({ state: "ready", page, pages: answer.meta.total_pages, data: answer.data });
      },
      () => {
        if (!alive.current || ticket !== requests.current) return;
        setView((previous) => ({ ...previous, state: "failed", page }));
      },
    );
  }

  useEffect(() => {
    alive.current = true;
    load(1);
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // WHY: the host's own Escape handler listens on the document and must not close with the panel.
      event.stopImmediatePropagation();
      onClose();
    };
    // WHY: capture phase, so it runs before the page's window listeners; bubble-phase stopping comes too late.
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  const dialog = (
    <div {...partProps(classNames, "overlay")} role="dialog" aria-modal="true" aria-labelledby={TITLE_ID}>
      <div {...partProps(classNames, "panel")}>
        <header {...partProps(classNames, "header")}>
          <h2 id={TITLE_ID} {...partProps(classNames, "title")}>
            {labels.reportedIssues}
          </h2>
          <button
            ref={closeButton}
            type="button"
            {...partProps(classNames, "secondary-button")}
            onClick={onClose}
          >
            {labels.close}
          </button>
        </header>
        {view.state === "loading" ? (
          <p role="status" {...partProps(classNames, "muted")}>
            {labels.reportsLoading}
          </p>
        ) : view.state === "failed" ? (
          <p role="alert" {...partProps(classNames, "error")}>
            {labels.reportsFailed}
          </p>
        ) : view.data.length === 0 ? (
          <p {...partProps(classNames, "muted")}>{labels.reportsEmpty}</p>
        ) : (
          <table {...partProps(classNames, "reports-table")}>
            <thead>
              <tr>
                <th scope="col">{labels.reportsColumnTitle}</th>
                <th scope="col">{labels.reportsColumnStatus}</th>
                <th scope="col">{labels.reportsColumnReporter}</th>
                <th scope="col">{labels.reportsColumnReported}</th>
                <th scope="col">{labels.reportsColumnChanged}</th>
              </tr>
            </thead>
            <tbody>
              {view.data.map((issue) => (
                <tr key={issue.number}>
                  <td>{`#${issue.number} ${issue.title}`}</td>
                  <td>
                    <span
                      {...partProps(classNames, "reports-status")}
                      data-category={issue.status_category}
                    >
                      {reportedStatusText(issue, statusLabels)}
                    </span>
                  </td>
                  <td>{issue.reporter_name ?? labels.reportsUnknownReporter}</td>
                  <td>
                    <time dateTime={issue.reported_at}>{formatDate(issue.reported_at)}</time>
                  </td>
                  <td>
                    <time dateTime={issue.updated_at}>{formatDate(issue.updated_at)}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view.pages > 1 ? (
          <div {...partProps(classNames, "reports-pager")}>
            <button
              type="button"
              {...partProps(classNames, "secondary-button")}
              disabled={view.page <= 1}
              onClick={() => load(view.page - 1)}
            >
              {labels.reportsPrevious}
            </button>
            <span>{formatPage(labels.reportsPage, view.page, view.pages)}</span>
            <button
              type="button"
              {...partProps(classNames, "secondary-button")}
              disabled={view.page >= view.pages}
              onClick={() => load(view.page + 1)}
            >
              {labels.reportsNext}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
  return createPortal(dialog, document.body);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  // WHY: Intl throws a RangeError on an invalid date, so the raw string is shown instead.
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
