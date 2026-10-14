import { type BugReportLabelOverrides } from "./labels.js";
import { type BugReportClassNames } from "./theme.js";
export type ScreenshotEditorHandle = {
    toBlob(): Promise<Blob | null>;
};
export type ScreenshotEditorProps = {
    image: string;
    labels?: BugReportLabelOverrides;
    classNames?: BugReportClassNames;
    nonce?: string;
    onMarkupChange?: (marked: boolean) => void;
};
/** Edits one screenshot and hands back the marked-up PNG from its ref's `toBlob()`. */
export declare const ScreenshotEditor: import("react").ForwardRefExoticComponent<ScreenshotEditorProps & import("react").RefAttributes<ScreenshotEditorHandle>>;
