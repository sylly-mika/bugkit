"use client";

import type { ReactElement } from "react";
import { BugReportButton, type BugReportButtonProps } from "./BugReportButton.js";
import type { BugReportContext, BugReportResult } from "./payload.js";

export type { BugReportClassNames } from "./theme.js";

export type BugReportProps = Omit<BugReportButtonProps, "submit" | "getContext"> & {
  endpoint?: string;
  init?: RequestInit | (() => RequestInit | Promise<RequestInit>);
  version?: string;
  getContext?: () => BugReportContext;
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

  return (
    <BugReportButton
      {...rest}
      submit={submit}
      getContext={getContext ?? (() => ({ area: window.location.pathname, version: version ?? "" }))}
    />
  );
}
