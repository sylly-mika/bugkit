import { type ReactNode } from "react";
import { type BugReportContext, type BugReportSubmit } from "./payload.js";
import { type BugReportLabelOverrides } from "./labels.js";
export type BugReportButtonProps = {
    submit: BugReportSubmit;
    getContext: () => BugReportContext;
    labels?: BugReportLabelOverrides;
    diagnostics?: () => unknown;
    /** See capture.ts — which image origins are worth trying to inline. */
    allowedImageOrigins?: string[];
    /**
     * The host dresses the launcher. This folder owns what the button DOES —
     * capture before the dialog, keep focus, stay out of its own screenshot — and
     * nothing about where it sits or what it looks like: in this panel it is one
     * icon in the header cluster, in the next host it may be a corner badge.
     */
    className?: string;
    /**
     * What the launcher shows. Defaults to the label; an icon-only host passes
     * its icon, and the name below is then the only name the control has.
     */
    children?: ReactNode;
    /** The dialog opened (true) or closed (false); a host that must outlive the launcher listens. */
    onOpenChange?: (open: boolean) => void;
};
export declare function BugReportButton(props: BugReportButtonProps): import("react").JSX.Element;
