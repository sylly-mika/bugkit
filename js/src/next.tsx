"use client";

import type { ReactElement } from "react";
import { BugReportButton, type BugReportButtonProps } from "./BugReportButton.js";
import type {
  BugReportContext,
  BugReportResult,
  ReportedIssuesList,
  ReportedIssuesPage,
} from "./payload.js";

export type { BugReportClassNames } from "./theme.js";

const REPORTS_TIMEOUT_MS = 30_000;

export type BugReportProps = Omit<BugReportButtonProps, "submit" | "getContext"> & {
  endpoint?: string;
  init?: RequestInit | (() => RequestInit | Promise<RequestInit>);
  version?: string;
  getContext?: () => BugReportContext;
  reportsEndpoint?: string;
};

/**
 * BugReport is the launcher and dialog wired to a server route. It posts the
 * report to `endpoint` (default `/api/bug-report`) with `init` merged into the
 * request, and shows the number the server files it under or the server's
 * sentence when it refuses.
 */
export function BugReport({
  endpoint = "/api/bug-report",
  init,
  version,
  getContext,
  reportsEndpoint,
  ...rest
}: BugReportProps): ReactElement {
  const submit = async (form: FormData): Promise<BugReportResult> => {
    const resolvedInit = typeof init === "function" ? await init() : (init ?? {});
    const response = await fetch(endpoint, { ...resolvedInit, method: "POST", body: form });
    const body = (await response.json().catch(() => null)) as { id?: string; number?: number; detail?: unknown } | null;
    if (response.ok && body) {
      return { id: body.id as string, number: body.number as number };
    }
    const detail = body?.detail;
    throw new Error(typeof detail === "string" && detail !== "" ? detail : `HTTP ${response.status}`);
  };

  const listReports: ReportedIssuesList = async (page) => {
    const resolvedInit = typeof init === "function" ? await init() : (init ?? {});
    const controller = new AbortController();
    // WHY: a host that never answers would leave "Loading reports…" on screen forever.
    const timer = setTimeout(() => controller.abort(), REPORTS_TIMEOUT_MS);
    try {
      const response = await fetch(`${reportsEndpoint}?page=${page}`, {
        ...resolvedInit,
        method: "GET",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`bugkit: reports answered ${response.status}`);
      return (await response.json()) as ReportedIssuesPage;
    } finally {
      clearTimeout(timer);
    }
  };

  return (
    <BugReportButton
      {...rest}
      submit={submit}
      getContext={getContext ?? (() => ({ area: window.location.pathname, version: version ?? "" }))}
      {...(reportsEndpoint !== undefined ? { listReports } : {})}
    />
  );
}
