import type { ReactElement } from "react";
import { type BugReportButtonProps } from "./BugReportButton.js";
import type { BugReportContext } from "./payload.js";
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
export declare function BugReport({ endpoint, init, version, getContext, ...rest }: BugReportProps): ReactElement;
