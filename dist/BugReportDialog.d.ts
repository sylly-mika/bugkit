import { type BugReportContext, type BugReportEnvironment, type BugReportSubmit } from "./payload.js";
import type { CaptureResult } from "./capture.js";
import { type BugReportLabels } from "./labels.js";
export type BugReportDialogProps = {
    capture: CaptureResult;
    labels: BugReportLabels;
    context: BugReportContext;
    environment: BugReportEnvironment;
    diagnostics: unknown;
    submit: BugReportSubmit;
    onClose: () => void;
};
export declare function BugReportDialog(props: BugReportDialogProps): import("react").ReactPortal;
