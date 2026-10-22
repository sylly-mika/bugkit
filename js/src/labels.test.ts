import type { BugReportDialogProps } from "./BugReportDialog.js";
import { defaultLabels, formatFiled, mergeLabels, type BugReportKindLabels, type BugReportLabels } from "./labels.js";

const v080Kind: BugReportKindLabels = {
  title: "t",
  subtitle: "t",
  descriptionLabel: "t",
  descriptionPlaceholder: "t",
  descriptionRequired: "t",
  impactLabel: "t",
  impactBlocks: "t",
  impactBlocksHint: "t",
  impactWorkaround: "t",
  impactWorkaroundHint: "t",
  impactCosmetic: "t",
  impactCosmeticHint: "t",
  send: "t",
};

// WHY: a full label literal from before the optional keys must still compile.
const v080Labels: BugReportLabels = {
  bug: v080Kind,
  feature: v080Kind,
  buttonLabel: "t",
  back: "t",
  kindLabel: "t",
  kindBug: "t",
  kindFeature: "t",
  summaryLabel: "t",
  summaryPlaceholder: "t",
  summaryRequired: "t",
  characterCount: (used, limit) => `${used} / ${limit}`,
  saved: "t",
  technicalTitle: "t",
  technicalHint: "t",
  contextRoute: "t",
  contextVersion: "t",
  contextRequestId: "t",
  contextBrowser: "t",
  contextViewport: "t",
  contextTimestamp: "t",
  sharedTitle: "t",
  sharedHint: "t",
  sharedBody: "t",
  sensitiveTitle: "t",
  sensitiveBody: "t",
  screenshotTitle: "t",
  capturePending: "t",
  captureFailed: "t",
  captureFallbackHint: "t",
  uploadLabel: "t",
  uploadRejected: "t",
  screenshotTooLarge: "t",
  toolbarLabel: "t",
  toolArrow: "t",
  toolRect: "t",
  toolFreehand: "t",
  toolText: "t",
  toolRedact: "t",
  textInputLabel: "t",
  undo: "t",
  redo: "t",
  zoomOut: "t",
  zoomIn: "t",
  zoomLevel: (percent) => `${percent} %`,
  fit: "t",
  crop: "t",
  replace: "t",
  enterFullscreen: "t",
  exitFullscreen: "t",
  discardTitle: "t",
  discardBody: "t",
  discard: "t",
  keepEditing: "t",
  sending: "t",
  close: "t",
  successTitle: "t",
  filed: "t",
  failureTitle: "t",
  copyToClipboard: "t",
  copied: "t",
  copyManually: "t",
};

test("merges the app's labels over the English defaults", () => {
  const merged = mergeLabels({ bug: { send: "Sūtīt" }, back: undefined });
  expect(merged.bug.send).toBe("Sūtīt");
  expect(merged.feature.send).toBe("Send request");
  expect(merged.back).toBe("Back");
  expect(merged.buttonLabel).toBe("Report a bug");
  expect(defaultLabels.bug.send).toBe("Send report");
  expect(mergeLabels()).toEqual(defaultLabels);
});

test("merges an app's kind labels over the defaults key by key", () => {
  const merged = mergeLabels({ feature: { title: "Ideja" }, back: undefined });
  expect(merged.feature.title).toBe("Ideja");
  expect(merged.feature.send).toBe("Send request");
  expect(merged.bug.title).toBe("Report a bug");
  expect(merged.back).toBe("Back");
});

test("puts the request number into the filed line", () => {
  expect(formatFiled(defaultLabels.filed, 42)).toBe("The report number is #42.");
  expect(formatFiled("{number} and {number}", 7)).toBe("7 and 7");
});

test("a v0.8.0 label literal still merges, with the v0.9.0 strings from the defaults", () => {
  const merged = mergeLabels(v080Labels);
  expect(merged.buttonLabel).toBe("t");
  expect(merged.retakeDelayed).toBe(defaultLabels.retakeDelayed);
  expect(merged.captureCancel).toBe(defaultLabels.captureCancel);
  expect(merged.captureCountdown(3)).toBe("Screenshot in 3… Press Esc to cancel.");
});

test("a v0.8.0 label literal is accepted by the dialog's labels prop", () => {
  const dialogLabels: BugReportDialogProps["labels"] = v080Labels;
  expect(dialogLabels).toBe(v080Labels);
});
