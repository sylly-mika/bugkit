import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ScreenshotPane, type ScreenshotPaneHandle } from "./ScreenshotPane.js";
import { styles } from "./styles.js";
import {
  BUG_IMPACTS,
  buildBugReportForm,
  reportAsText,
  type BugImpact,
  type BugReportContext,
  type BugReportEnvironment,
  type BugReportPayload,
  type BugReportResult,
  type BugReportSubmit,
} from "./payload.js";
import type { CaptureResult } from "./capture.js";
import { formatFiled, type BugReportLabels } from "./labels.js";

export type BugReportDialogProps = {
  capture: CaptureResult;
  labels: BugReportLabels;
  context: BugReportContext;
  environment: BugReportEnvironment;
  diagnostics: unknown;
  submit: BugReportSubmit;
  onClose: () => void;
};

type Phase =
  | { name: "editing" }
  | { name: "sending" }
  | { name: "sent"; number: number }
  | { name: "failed"; payload: BugReportPayload; detail: string | null };

/** Whether the last copy attempt succeeded, failed, or has not happened. */
type CopyState = "idle" | "copied" | "manual";

const IMPACT_LABEL: Record<BugImpact, keyof BugReportLabels> = {
  blocks: "impactBlocks",
  workaround: "impactWorkaround",
  cosmetic: "impactCosmetic",
};

/** The backend refuses a longer description with a 422, so the field stops first. */
const DESCRIPTION_LIMIT = 5_000;

/**
 * The backend refuses a larger screenshot with a 413. Past the cap the image is
 * dropped rather than the report: the words and the diagnostics are what make a
 * report actionable, and a refusal would cost all three.
 */
const SCREENSHOT_LIMIT_BYTES = 5 * 1024 * 1024;

const COPIED_RESET_MS = 4_000;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const TITLE_ID = "bug-report-title";
const DESCRIPTION_ID = "bug-report-description";
const ERROR_ID = "bug-report-description-error";
const COUNTER_ID = "bug-report-description-count";

/**
 * Defer to whoever locked the body first, and hand back the undo.
 *
 * A counter of our own cannot work here: the folder must not import the app's
 * Modal, so the two counters would be independent, and both restore the same
 * `document.body.style.overflow`. Whichever unlocks last wins — and when that is
 * this dialog it writes back the "hidden" it captured while the modal held the
 * lock, leaving the panel unscrollable until a reload. Doing nothing when the
 * body is already hidden leaves exactly one owner of the property.
 */
function lockBodyScroll(): () => void {
  if (document.body.style.overflow === "hidden") return () => {};

  const original = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  return () => {
    document.body.style.overflow = original;
  };
}

export function BugReportDialog(props: BugReportDialogProps) {
  const { capture, labels, context, environment, diagnostics, submit, onClose } = props;

  const [dataUrl, setDataUrl] = useState(capture.ok ? capture.dataUrl : null);
  const [description, setDescription] = useState("");
  const [impact, setImpact] = useState<BugImpact>("workaround");
  const [invalid, setInvalid] = useState(false);
  const [oversize, setOversize] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [phase, setPhase] = useState<Phase>({ name: "editing" });
  const paneRef = useRef<ScreenshotPaneHandle>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const trapTab = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;

      const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (stops.length === 0) return;

      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !panel.contains(active);

      if (event.shiftKey && (outside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // While this dialog is open the key is ours, whatever we do with it. The
        // app's Modal listens for Escape on `window` too and this dialog opens on
        // top of one, so without stopping it here a single press closes both and
        // takes the form the reporter was filling in with it.
        event.stopImmediatePropagation();
        // Not while sending: the request is already on its way, and closing here
        // would lose the reporter's words with no way to tell them whether it
        // landed.
        if (phase.name !== "sending") onClose();
        return;
      }
      if (event.key === "Tab") trapTab(event);
      // The page's search shortcut, also on `window`. Letting it through moves
      // focus to a box hidden under this overlay: the reporter types into what
      // they cannot see, Enter navigates the page underneath, and the Escape
      // they reach for next closes the report.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    };
    // Capture phase, so this runs before any listener the page registered on
    // `window` in the usual way — stopping propagation from the bubble phase
    // would be too late to keep the modal underneath from seeing the key.
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose, phase.name]);

  useEffect(() => {
    const restoreTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const unlockBodyScroll = lockBodyScroll();
    // The dialog is a portal at the end of <body>, so without this the caret
    // stays behind on the page the reporter just photographed.
    descriptionRef.current?.focus();

    return () => {
      unlockBodyScroll();
      restoreTo?.focus();
    };
  }, []);

  useEffect(() => {
    if (phase.name === "sent") successRef.current?.focus();
  }, [phase.name]);

  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = setTimeout(() => setCopyState("idle"), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copyState]);

  useEffect(() => {
    if (copyState !== "manual") return;
    manualRef.current?.focus();
    manualRef.current?.select();
  }, [copyState]);

  const sending = phase.name === "sending";

  async function send() {
    // aria-disabled leaves the button clickable, so the guard the attribute only
    // advertises has to live here.
    if (sending) return;

    if (description.trim() === "") {
      setInvalid(true);
      descriptionRef.current?.focus();
      return;
    }

    setInvalid(false);
    setPhase({ name: "sending" });

    // Text-only until the export says otherwise, and declared out here so the
    // failure phase can hand the reporter their words back however far the
    // attempt got. The export itself is awaited INSIDE the try: a handle that
    // rejects rather than resolving null would otherwise leave the dialog stuck
    // on "sending", with Escape and Cancel both refusing to close it.
    let payload: BugReportPayload = {
      kind: "bug",
      summary: "",
      description: description.trim(),
      impact,
      context,
      environment,
      diagnostics,
      screenshot: null,
    };

    try {
      const screenshot = (await paneRef.current?.toBlob()) ?? null;
      const tooLarge = screenshot !== null && screenshot.size > SCREENSHOT_LIMIT_BYTES;

      setOversize(tooLarge);
      payload = { ...payload, screenshot: tooLarge ? null : screenshot };

      const result: BugReportResult = await submit(buildBugReportForm(payload));
      setPhase({ name: "sent", number: result.number });
    } catch (error) {
      // The reporter's words must survive a network blip; the failure state
      // hands them back rather than asking them to type it all again. The
      // server's own sentence goes with them — "not configured" and "try again
      // in 40 seconds" are different problems and only one is worth retrying.
      setPhase({
        name: "failed",
        payload,
        detail: error instanceof Error ? error.message : null,
      });
    }
  }

  async function copyReport(payload: BugReportPayload) {
    const text = reportAsText(payload);

    try {
      // Absent outside a secure context, and a present one still rejects when
      // the document is not focused or permission is refused. Both end in the
      // same place: the text on screen, selected, for a manual Ctrl+C.
      if (!window.navigator.clipboard) {
        throw new Error("clipboard unavailable");
      }
      await window.navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("manual");
    }
  }

  // Everything the submission carries, so nobody sends what they have not seen.
  // The request id is the host's own reference and is shown only when the host
  // gives one. The reporter's identity is not listed: the server adds it from
  // its own session, so nothing here can name the reporter wrongly.
  const contextRows: [string, string][] = [
    [labels.contextRoute, context.area],
    [labels.contextVersion, context.version],
    ...(typeof context.requestId === "string" && context.requestId !== ""
      ? [[labels.contextRequestId, context.requestId] as [string, string]]
      : []),
    [labels.contextBrowser, environment.user_agent],
    [labels.contextViewport, environment.viewport],
    [labels.contextTimestamp, environment.at],
  ];

  const describedBy = invalid ? `${ERROR_ID} ${COUNTER_ID}` : COUNTER_ID;

  return createPortal(
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-labelledby={TITLE_ID}>
      <div ref={panelRef} style={styles.panel}>
        <h2 id={TITLE_ID} style={styles.title}>
          {labels.dialogTitle}
        </h2>

        {phase.name === "sent" ? (
          <div style={styles.phaseRegion}>
            {/*
             * The live region is the outcome, not the Close button: a region
             * that contains a control announces the control too, and "Close"
             * read out after the issue number is noise.
             */}
            <div role="status">
              <p ref={successRef} tabIndex={-1}>
                {labels.successTitle}
              </p>
              <p>{formatFiled(labels.filed, phase.number)}</p>
              {oversize ? <p style={styles.muted}>{labels.screenshotTooLarge}</p> : null}
            </div>
            <div style={styles.actions}>
              <button type="button" style={styles.primaryButton} onClick={onClose}>
                {labels.close}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={styles.columns}>
              <div style={styles.imageColumn}>
                <ScreenshotPane
                  ref={paneRef}
                  dataUrl={dataUrl}
                  labels={labels}
                  onImageChosen={setDataUrl}
                />
              </div>

              <div style={styles.formColumn}>
                <div>
                  <label htmlFor={DESCRIPTION_ID} style={styles.label}>
                    {labels.descriptionLabel}
                  </label>
                  <textarea
                    id={DESCRIPTION_ID}
                    ref={descriptionRef}
                    style={styles.textarea}
                    placeholder={labels.descriptionPlaceholder}
                    maxLength={DESCRIPTION_LIMIT}
                    required
                    aria-invalid={invalid}
                    aria-describedby={describedBy}
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      if (invalid) setInvalid(false);
                    }}
                  />
                  <p id={COUNTER_ID} style={styles.counter}>
                    {labels.characterCount(description.length, DESCRIPTION_LIMIT)}
                  </p>
                  {invalid ? (
                    <p id={ERROR_ID} role="alert" style={styles.error}>
                      {labels.descriptionRequired}
                    </p>
                  ) : null}
                </div>

                <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
                  <legend style={styles.label}>{labels.impactLabel}</legend>
                  {BUG_IMPACTS.map((value) => (
                    <label
                      key={value}
                      style={styles.radioRow}
                      htmlFor={`bug-report-impact-${value}`}
                    >
                      <input
                        id={`bug-report-impact-${value}`}
                        type="radio"
                        name="bug-report-impact"
                        checked={impact === value}
                        onChange={() => setImpact(value)}
                      />
                      {labels[IMPACT_LABEL[value]] as string}
                    </label>
                  ))}
                </fieldset>

                <div>
                  <p style={styles.label}>{labels.contextTitle}</p>
                  <table style={styles.contextTable}>
                    <tbody>
                      {contextRows.map(([key, value]) => (
                        <tr key={key}>
                          <th scope="row" style={styles.contextKey}>
                            {key}
                          </th>
                          <td style={styles.contextValue}>{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div style={styles.phaseRegion}>
              {/*
               * The live region is the sentence and nothing else. With the copy
               * button and the fallback textarea inside it, a blocked clipboard
               * read the entire report — context table, diagnostics and all —
               * out loud. It stays mounted while editing so a screen reader has
               * a region to watch before there is anything to announce.
               */}
              <div role="status">
                {phase.name === "sending" ? <p style={styles.muted}>{labels.sending}</p> : null}

                {phase.name === "failed" ? (
                  <>
                    <p style={styles.error}>{labels.failureTitle}</p>
                    {phase.detail ? <p style={styles.muted}>{phase.detail}</p> : null}
                    {oversize ? <p style={styles.muted}>{labels.screenshotTooLarge}</p> : null}
                  </>
                ) : null}
              </div>

              {phase.name === "failed" ? (
                <>
                  <button
                    type="button"
                    style={styles.secondaryButton}
                    onClick={() => copyReport(phase.payload)}
                  >
                    {copyState === "copied" ? labels.copied : labels.copyToClipboard}
                  </button>
                  {copyState === "manual" ? (
                    <>
                      <p style={styles.muted}>{labels.copyManually}</p>
                      <textarea
                        ref={manualRef}
                        readOnly
                        style={styles.textarea}
                        aria-label={labels.copyToClipboard}
                        value={reportAsText(phase.payload)}
                      />
                    </>
                  ) : null}
                </>
              ) : null}
            </div>

            {/*
             * aria-disabled and a guard in the handler, never `disabled`: a
             * browser blurs an element the moment it is disabled, so pressing
             * Send would throw a keyboard reporter's focus to <body> for the
             * length of the request — and the focus trap has nothing to bring
             * it back from there. The launcher refuses `disabled` for the same
             * reason.
             */}
            <div style={styles.actions}>
              <button
                type="button"
                style={sending ? { ...styles.secondaryButton, ...styles.buttonBusy } : styles.secondaryButton}
                onClick={() => {
                  if (!sending) onClose();
                }}
                aria-disabled={sending}
              >
                {labels.cancel}
              </button>
              <button
                type="button"
                style={sending ? { ...styles.primaryButton, ...styles.buttonBusy } : styles.primaryButton}
                onClick={send}
                aria-disabled={sending}
              >
                {sending ? labels.sending : labels.send}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
