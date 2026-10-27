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
  // WHY: optional so a v0.9.0 label literal still compiles; mergeLabels fills it from defaultLabels.
  summaryOrDescriptionRequired?: string;
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
  // WHY: optional so a host's v0.8.0 label literal still compiles; mergeLabels fills them from defaultLabels.
  screenshotModes?: string;
  retakeDelayed?: string;
  retakeOnKey?: string;
  removeScreenshot?: string;
  screenshotRemoved?: string;
  captureCountdown?: (seconds: number) => string;
  captureKeyHint?: string;
  captureCancel?: string;
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

/** `BugReportLabels` with every key present, as the components read them. */
export type ResolvedBugReportLabels = Required<BugReportLabels>;

/** The app's strings for the editor; `bug` and `feature` merge key by key. */
export type BugReportLabelOverrides = Partial<Omit<BugReportLabels, "bug" | "feature">> & {
  bug?: Partial<BugReportKindLabels>;
  feature?: Partial<BugReportKindLabels>;
};

export const defaultLabels: ResolvedBugReportLabels = {
  bug: {
    title: "Report a bug",
    subtitle: "Mark up the screenshot and add details to help us fix the issue faster.",
    descriptionLabel: "What happened?",
    descriptionPlaceholder: "Describe what you were doing and what went wrong.",
    descriptionRequired: "Please describe what happened.",
    impactLabel: "How much does it get in the way?",
    impactBlocks: "Blocks my work",
    impactBlocksHint: "I can't complete my work.",
    impactWorkaround: "Workaround exists",
    impactWorkaroundHint: "I can keep working using a workaround.",
    impactCosmetic: "Cosmetic",
    impactCosmeticHint: "Minor issue, doesn't affect my work.",
    send: "Send report",
  },
  feature: {
    title: "Request a feature",
    subtitle: "Mark up the screenshot and tell us what would help you work better.",
    descriptionLabel: "What would you like?",
    descriptionPlaceholder: "Describe what you need and why it would help.",
    descriptionRequired: "Please describe what you would like.",
    impactLabel: "How much would it help?",
    impactBlocks: "I need it for my work",
    impactBlocksHint: "Part of my work can't be done without it.",
    impactWorkaround: "It would save me time",
    impactWorkaroundHint: "I can manage without it, but it takes longer.",
    impactCosmetic: "Nice to have",
    impactCosmeticHint: "A small improvement.",
    send: "Send request",
  },
  buttonLabel: "Report a bug",
  back: "Back",
  kindLabel: "What are you sending?",
  kindBug: "Bug",
  kindFeature: "Feature request",
  summaryLabel: "Summary",
  summaryPlaceholder: "One line that sums it up",
  summaryRequired: "Please add a summary.",
  summaryOrDescriptionRequired: "Add a summary or describe what happened.",
  characterCount: (used, limit) => `${used} / ${limit}`,
  saved: "All changes saved",
  technicalTitle: "Technical details",
  technicalHint: "Browser, page, viewport, and more",
  contextRoute: "Page",
  contextVersion: "Version",
  contextRequestId: "Request id",
  contextBrowser: "Browser",
  contextViewport: "Viewport",
  contextTimestamp: "Time",
  sharedTitle: "What will be shared",
  sharedHint: "This screenshot and details will be sent to the product team",
  sharedBody:
    "The marked-up screenshot, your summary, description and answers, the technical details, and the page's recent errors and failed requests.",
  sensitiveTitle: "Please don't include sensitive information",
  sensitiveBody:
    "Review your screenshot and remove any personal, confidential, or customer data before sending.",
  screenshotTitle: "Screenshot",
  capturePending: "Taking a screenshot…",
  captureFailed: "The screenshot could not be taken.",
  captureFallbackHint: "Paste (Ctrl+V) or upload a screenshot instead.",
  screenshotModes: "Screenshot options",
  retakeDelayed: "Retake in 3 seconds",
  retakeOnKey: "Retake on key press",
  removeScreenshot: "Send without screenshot",
  screenshotRemoved: "No screenshot will be sent.",
  captureCountdown: (seconds) => `Screenshot in ${seconds}… Press Esc to cancel.`,
  captureKeyHint: "Arrange the page, then press S to take the screenshot. Press Esc to cancel.",
  captureCancel: "Cancel screenshot",
  uploadLabel: "Upload an image",
  uploadRejected: "Choose a PNG image no larger than 5 MB.",
  screenshotTooLarge: "The screenshot was over 5 MB, so the report was sent without it.",
  toolbarLabel: "Screenshot tools",
  toolArrow: "Arrow",
  toolRect: "Box",
  toolFreehand: "Draw",
  toolText: "Text",
  toolRedact: "Redact",
  textInputLabel: "Text on the screenshot",
  undo: "Undo",
  redo: "Redo",
  zoomOut: "Zoom out",
  zoomIn: "Zoom in",
  zoomLevel: (percent) => `${percent} %`,
  fit: "Fit",
  crop: "Crop",
  replace: "Replace",
  enterFullscreen: "Full screen",
  exitFullscreen: "Exit full screen",
  discardTitle: "Discard this report?",
  discardBody: "What you wrote and drew will be lost.",
  discard: "Discard",
  keepEditing: "Keep editing",
  sending: "Sending…",
  close: "Close",
  successTitle: "Thank you. Your report was sent.",
  filed: "The report number is #{number}.",
  failureTitle: "The report could not be sent.",
  copyToClipboard: "Copy the report",
  copied: "Copied",
  copyManually:
    "Copying is blocked in this browser. Select the text below and copy it with Ctrl+C.",
};

/** The app's strings over the English defaults. An explicit `undefined` keeps the default. */
export function mergeLabels(overrides?: BugReportLabelOverrides): ResolvedBugReportLabels {
  const { bug, feature, ...rest } = overrides ?? {};
  return {
    ...defaultLabels,
    ...definedOnly(rest),
    bug: { ...defaultLabels.bug, ...definedOnly(bug) },
    feature: { ...defaultLabels.feature, ...definedOnly(feature) },
  };
}

function definedOnly<T extends object>(part: Partial<T> | undefined): Partial<T> {
  return Object.fromEntries(
    Object.entries(part ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** Replaces every `{number}` in a label template with the request number. */
export function formatFiled(template: string, number: number): string {
  return template.split("{number}").join(String(number));
}
