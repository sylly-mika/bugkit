import { type BugReportClassNames } from "./theme.js";
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
    /** Classes per part, added to bugkit's default look; any class beats the default. */
    classNames?: BugReportClassNames;
    /** CSP nonce for the one `<style>` element bugkit adds to `<head>`. */
    nonce?: string;
};
export declare function BugReportDialog(props: BugReportDialogProps): import("react").ReactPortal;
