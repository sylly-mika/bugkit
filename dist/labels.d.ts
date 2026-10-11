/**
 * Every string the button and dialog can render. The app passes its own
 * translated strings in (or nothing, for English), which is how bugkit stays
 * ignorant of i18n libraries. `filed` holds `{number}`, replaced with the
 * request number the server answers.
 */
export type BugReportLabels = {
    buttonLabel: string;
    dialogTitle: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    descriptionRequired: string;
    /** Live character count against the backend's cap, e.g. "120 / 5000". */
    characterCount: (used: number, limit: number) => string;
    impactLabel: string;
    impactBlocks: string;
    impactWorkaround: string;
    impactCosmetic: string;
    contextTitle: string;
    contextRoute: string;
    contextVersion: string;
    contextRequestId: string;
    contextBrowser: string;
    contextViewport: string;
    contextTimestamp: string;
    screenshotTitle: string;
    capturePending: string;
    captureFailed: string;
    captureFallbackHint: string;
    uploadLabel: string;
    uploadRejected: string;
    /** Shown after Send when the annotated PNG was over the backend's cap and was dropped. */
    screenshotTooLarge: string;
    toolArrow: string;
    toolRect: string;
    toolFreehand: string;
    toolBlackout: string;
    undo: string;
    send: string;
    sending: string;
    cancel: string;
    close: string;
    successTitle: string;
    filed: string;
    failureTitle: string;
    copyToClipboard: string;
    copied: string;
    /** Shown when the clipboard is unavailable and the text has to be copied by hand. */
    copyManually: string;
};
export declare const defaultLabels: BugReportLabels;
/** The app's strings over the English defaults. An explicit `undefined` keeps the default. */
export declare function mergeLabels(overrides?: Partial<BugReportLabels>): BugReportLabels;
/** Replaces every `{number}` in a label template with the request number. */
export declare function formatFiled(template: string, number: number): string;
