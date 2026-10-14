/**
 * Every string the button and dialog can render. The app passes its own
 * translated strings in (or nothing, for English), which is how bugkit stays
 * ignorant of i18n libraries. `filed` holds `{number}`, replaced with the
 * request number the server answers.
 */
export type BugReportKindLabels = {
    title: string;
    subtitle: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    descriptionRequired: string;
    impactLabel: string;
    impactBlocks: string;
    impactBlocksHint: string;
    impactWorkaround: string;
    impactWorkaroundHint: string;
    impactCosmetic: string;
    impactCosmeticHint: string;
    send: string;
};
export type BugReportLabels = {
    bug: BugReportKindLabels;
    feature: BugReportKindLabels;
    buttonLabel: string;
    back: string;
    kindLabel: string;
    kindBug: string;
    kindFeature: string;
    summaryLabel: string;
    summaryPlaceholder: string;
    summaryRequired: string;
    /** Live character count against the backend's cap, e.g. "120 / 5000". */
    characterCount: (used: number, limit: number) => string;
    saved: string;
    technicalTitle: string;
    technicalHint: string;
    contextRoute: string;
    contextVersion: string;
    contextRequestId: string;
    contextBrowser: string;
    contextViewport: string;
    contextTimestamp: string;
    sharedTitle: string;
    sharedHint: string;
    sharedBody: string;
    sensitiveTitle: string;
    sensitiveBody: string;
    screenshotTitle: string;
    capturePending: string;
    captureFailed: string;
    captureFallbackHint: string;
    uploadLabel: string;
    uploadRejected: string;
    /** Shown after Send when the annotated PNG was over the backend's cap and was dropped. */
    screenshotTooLarge: string;
    toolbarLabel: string;
    toolArrow: string;
    toolRect: string;
    toolFreehand: string;
    toolText: string;
    toolRedact: string;
    textInputLabel: string;
    undo: string;
    redo: string;
    zoomOut: string;
    zoomIn: string;
    zoomLevel: (percent: number) => string;
    fit: string;
    crop: string;
    replace: string;
    enterFullscreen: string;
    exitFullscreen: string;
    discardTitle: string;
    discardBody: string;
    discard: string;
    keepEditing: string;
    sending: string;
    close: string;
    successTitle: string;
    filed: string;
    failureTitle: string;
    copyToClipboard: string;
    copied: string;
    /** Shown when the clipboard is unavailable and the text has to be copied by hand. */
    copyManually: string;
};
/** The app's strings for the editor; `bug` and `feature` merge key by key. */
export type BugReportLabelOverrides = Partial<Omit<BugReportLabels, "bug" | "feature">> & {
    bug?: Partial<BugReportKindLabels>;
    feature?: Partial<BugReportKindLabels>;
};
export declare const defaultLabels: BugReportLabels;
/** The app's strings over the English defaults. An explicit `undefined` keeps the default. */
export declare function mergeLabels(overrides?: BugReportLabelOverrides): BugReportLabels;
/** Replaces every `{number}` in a label template with the request number. */
export declare function formatFiled(template: string, number: number): string;
