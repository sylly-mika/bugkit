export const defaultLabels = {
    buttonLabel: "Report a bug",
    dialogTitle: "Report a bug",
    descriptionLabel: "What happened?",
    descriptionPlaceholder: "Describe what you were doing and what went wrong.",
    descriptionRequired: "Please describe the bug.",
    characterCount: (used, limit) => `${used} / ${limit} characters`,
    impactLabel: "How much does it get in the way?",
    impactBlocks: "Blocks my work",
    impactWorkaround: "Workaround exists",
    impactCosmetic: "Cosmetic",
    contextTitle: "What will be sent",
    contextRoute: "Page",
    contextVersion: "Version",
    contextRequestId: "Request id",
    contextBrowser: "Browser",
    contextViewport: "Viewport",
    contextTimestamp: "Time",
    screenshotTitle: "Screenshot",
    capturePending: "Taking a screenshot…",
    captureFailed: "The screenshot could not be taken.",
    captureFallbackHint: "Paste (Ctrl+V) or upload a screenshot instead.",
    uploadLabel: "Upload an image",
    uploadRejected: "Choose a PNG image no larger than 5 MB.",
    screenshotTooLarge: "The screenshot was over 5 MB, so the report was sent without it.",
    toolArrow: "Arrow",
    toolRect: "Box",
    toolFreehand: "Draw",
    toolBlackout: "Black out",
    undo: "Undo",
    send: "Send",
    sending: "Sending…",
    cancel: "Cancel",
    close: "Close",
    successTitle: "Thank you. Your report was sent.",
    filed: "The report number is #{number}.",
    failureTitle: "The report could not be sent.",
    copyToClipboard: "Copy the report",
    copied: "Copied",
    copyManually: "Copying is blocked in this browser. Select the text below and copy it with Ctrl+C.",
};
/** The app's strings over the English defaults. An explicit `undefined` keeps the default. */
export function mergeLabels(overrides) {
    const merged = { ...defaultLabels };
    for (const key of Object.keys(overrides ?? {})) {
        const value = overrides?.[key];
        if (value !== undefined)
            Object.assign(merged, { [key]: value });
    }
    return merged;
}
/** Replaces every `{number}` in a label template with the request number. */
export function formatFiled(template, number) {
    return template.split("{number}").join(String(number));
}
