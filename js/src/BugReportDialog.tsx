import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ScreenshotPane, type ScreenshotPaneHandle } from "./ScreenshotPane.js";
import { partProps, useBugkitStyles, type BugReportClassNames } from "./theme.js";
import {
  BUG_KINDS,
  SUMMARY_LIMIT,
  buildBugReportForm,
  reportAsText,
  type BugImpact,
  type BugKind,
  type BugReportContext,
  type BugReportEnvironment,
  type BugReportPayload,
  type BugReportResult,
  type BugReportSubmit,
} from "./payload.js";
import type { CaptureResult } from "./capture.js";
import { formatFiled, type BugReportKindLabels, type BugReportLabels } from "./labels.js";
import { DESCRIPTION_LIMIT, clearDraft, readDraft, writeDraft, type Draft } from "./draft.js";

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
  /** Shows the Technical details disclosure (default true); the details are sent either way. */
  technicalDetails?: boolean;
};

type Phase =
  | { name: "editing" }
  | { name: "sending" }
  | { name: "sent"; number: number }
  | { name: "failed"; payload: BugReportPayload; detail: string | null };

type CopyState = "idle" | "copied" | "manual";

// WHY: the backend refuses a larger screenshot with a 413; past the cap the image is dropped, never the report.
const SCREENSHOT_LIMIT_BYTES = 5 * 1024 * 1024;

const COPIED_RESET_MS = 4_000;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const TITLE_ID = "bug-report-title";
const KIND_ID = "bug-report-kind-label";
const SUMMARY_ID = "bug-report-summary";
const SUMMARY_ERROR_ID = "bug-report-summary-error";
const DESCRIPTION_ID = "bug-report-description";
const ERROR_ID = "bug-report-description-error";
const COUNTER_ID = "bug-report-description-count";
const IMPACT_ID = "bug-report-impact-label";
const TECHNICAL_ID = "bug-report-technical";
const TECHNICAL_HINT_ID = "bug-report-technical-hint";
const SHARED_ID = "bug-report-shared";
const SHARED_HINT_ID = "bug-report-shared-hint";
const DISCARD_TITLE_ID = "bug-report-discard-title";
const DISCARD_BODY_ID = "bug-report-discard-body";

// WHY: the Modal restores the same body overflow; a second counter would write back a stale "hidden".
function lockBodyScroll(): () => void {
  if (document.body.style.overflow === "hidden") return () => {};

  const original = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  return () => {
    document.body.style.overflow = original;
  };
}

export function BugReportDialog(props: BugReportDialogProps) {
  const {
    capture,
    labels,
    context,
    environment,
    diagnostics,
    submit,
    onClose,
    classNames,
    nonce,
    technicalDetails = true,
  } = props;
  useBugkitStyles(nonce);

  const [restored] = useState<Draft | null>(readDraft);
  const [kind, setKind] = useState<BugKind>(restored?.kind ?? "bug");
  const [summary, setSummary] = useState(restored?.summary ?? "");
  const [description, setDescription] = useState(restored?.description ?? "");
  const [impact, setImpact] = useState<BugImpact>(restored?.impact ?? "workaround");
  const [draftSaved, setDraftSaved] = useState(restored !== null);
  const [dataUrl, setDataUrl] = useState(capture.ok ? capture.dataUrl : null);
  const [summaryInvalid, setSummaryInvalid] = useState(false);
  const [descriptionInvalid, setDescriptionInvalid] = useState(false);
  const [oversize, setOversize] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [phase, setPhase] = useState<Phase>({ name: "editing" });
  const [expanded, setExpanded] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [sharedOpen, setSharedOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [markedUp, setMarkedUp] = useState(false);
  const paneRef = useRef<ScreenshotPaneHandle>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  const k: BugReportKindLabels = labels[kind];
  const sending = phase.name === "sending";
  const sent = phase.name === "sent";
  const hasWork = !sent && (summary !== "" || description !== "" || markedUp);

  const impactOptions: { value: BugImpact; label: string; hint: string }[] = [
    { value: "blocks", label: k.impactBlocks, hint: k.impactBlocksHint },
    { value: "workaround", label: k.impactWorkaround, hint: k.impactWorkaroundHint },
    { value: "cosmetic", label: k.impactCosmetic, hint: k.impactCosmeticHint },
  ];

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
        // WHY: the app's Modal also listens for Escape on window; without stopping it here one press closes both.
        event.stopImmediatePropagation();
        // WHY: while sending, Escape must not close: the reporter could not tell whether their words landed.
        if (sending) return;
        // WHY: a text box open on the screenshot takes Escape first, so it ends the edit, not the report.
        if (paneRef.current?.cancelText()) return;
        if (confirming) {
          setConfirming(false);
          return;
        }
        if (hasWork) setConfirming(true);
        else onClose();
        return;
      }
      if (event.key === "Tab") trapTab(event);
      // WHY: the page's search shortcut is also on window; letting it through focuses a box hidden under this overlay.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    };
    // WHY: capture phase, so it runs before the page's window listeners; bubble-phase stopping comes too late.
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose, sending, confirming, hasWork]);

  useEffect(() => {
    const restoreTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const unlockBodyScroll = lockBodyScroll();
    // WHY: the dialog is a portal at the end of body; without this the caret stays on the photographed page.
    summaryRef.current?.focus();

    return () => {
      unlockBodyScroll();
      restoreTo?.focus();
    };
  }, []);

  useEffect(() => {
    if (sent) successRef.current?.focus();
  }, [sent]);

  useEffect(() => {
    if (confirming) keepEditingRef.current?.focus();
  }, [confirming]);

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

  // WHY: storage that refuses the write must not claim a save; the indicator reports
  // only what the browser confirmed.
  function persist(next: Draft) {
    if (next.summary.trim() === "" && next.description.trim() === "") {
      clearDraft();
      setDraftSaved(false);
    } else {
      setDraftSaved(writeDraft(next));
    }
  }

  function changeKind(value: BugKind) {
    setKind(value);
    persist({ kind: value, summary, description, impact });
  }

  function changeSummary(value: string) {
    setSummary(value);
    if (summaryInvalid) setSummaryInvalid(false);
    persist({ kind, summary: value, description, impact });
  }

  function changeDescription(value: string) {
    setDescription(value);
    if (descriptionInvalid) setDescriptionInvalid(false);
    persist({ kind, summary, description: value, impact });
  }

  function changeImpact(value: BugImpact) {
    setImpact(value);
    persist({ kind, summary, description, impact: value });
  }

  function requestClose() {
    if (sending) return;
    if (hasWork) setConfirming(true);
    else onClose();
  }

  function discard() {
    clearDraft();
    onClose();
  }

  async function send() {
    // WHY: aria-disabled leaves the button clickable, so the guard has to live in the handler.
    if (sending) return;

    const missingSummary = summary.trim() === "";
    const missingDescription = description.trim() === "";
    setSummaryInvalid(missingSummary);
    setDescriptionInvalid(!missingSummary && missingDescription);
    if (missingSummary) {
      summaryRef.current?.focus();
      return;
    }
    if (missingDescription) {
      descriptionRef.current?.focus();
      return;
    }

    setPhase({ name: "sending" });

    // WHY: declared outside the try so failure can return the words; an export that rejects must not strand "sending".
    let payload: BugReportPayload = {
      kind,
      summary: summary.trim(),
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
      clearDraft();
      setDraftSaved(false);
      setPhase({ name: "sent", number: result.number });
    } catch (error) {
      // WHY: keep the server's sentence too; "not configured" and "try again" need different actions.
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
      if (!window.navigator.clipboard) {
        throw new Error("clipboard unavailable");
      }
      await window.navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("manual");
    }
  }

  // WHY: the reporter's identity is left out; the server adds it from its own session.
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

  const descriptionDescribedBy = descriptionInvalid ? `${ERROR_ID} ${COUNTER_ID}` : COUNTER_ID;

  return createPortal(
    <div {...partProps(classNames, "overlay")} role="dialog" aria-modal="true" aria-labelledby={TITLE_ID}>
      <div ref={panelRef} {...partProps(classNames, "panel")}>
        <header {...partProps(classNames, "header")}>
          <button
            type="button"
            aria-label={labels.back}
            {...partProps(classNames, "back-button")}
            onClick={requestClose}
            aria-disabled={sending}
          >
            ←
          </button>
          <div {...partProps(classNames, "header-text")}>
            <h2 id={TITLE_ID} {...partProps(classNames, "title")}>
              {k.title}
            </h2>
            <p {...partProps(classNames, "muted")}>{k.subtitle}</p>
          </div>
          <div {...partProps(classNames, "header-end")}>
            {draftSaved && !sent ? (
              <p {...partProps(classNames, "muted")}>
                <span aria-hidden="true">✓ </span>
                <span>{labels.saved}</span>
              </p>
            ) : null}
            {sent ? null : (
              <button
                type="button"
                {...partProps(classNames, "primary-button")}
                onClick={send}
                aria-disabled={sending}
              >
                {sending ? labels.sending : k.send}
              </button>
            )}
          </div>
        </header>

        {sent ? (
          <div {...partProps(classNames, "phase")}>
            {/* WHY: the live region is the outcome only; a Close button inside it would be announced too. */}
            <div role="status">
              <p ref={successRef} tabIndex={-1}>
                {labels.successTitle}
              </p>
              <p>{formatFiled(labels.filed, phase.number)}</p>
              {oversize ? <p {...partProps(classNames, "muted")}>{labels.screenshotTooLarge}</p> : null}
            </div>
            <div {...partProps(classNames, "actions")}>
              <button type="button" {...partProps(classNames, "primary-button")} onClick={onClose}>
                {labels.close}
              </button>
            </div>
          </div>
        ) : (
          <div {...partProps(classNames, "body")}>
            <div {...partProps(classNames, "image-column")}>
              <ScreenshotPane
                ref={paneRef}
                dataUrl={dataUrl}
                labels={labels}
                onImageChosen={setDataUrl}
                expanded={expanded}
                onToggleExpanded={() => setExpanded(!expanded)}
                onMarkupChange={setMarkedUp}
                classNames={classNames}
              />
            </div>

            {expanded ? null : (
              <div {...partProps(classNames, "form")}>
                <div role="radiogroup" aria-labelledby={KIND_ID} {...partProps(classNames, "kind-choices")}>
                  <p id={KIND_ID} {...partProps(classNames, "label")}>
                    {labels.kindLabel}
                  </p>
                  {BUG_KINDS.map((value) => {
                    const id = `bug-report-kind-${value}`;
                    return (
                      <label key={value} {...partProps(classNames, "choice")} htmlFor={id}>
                        <input
                          id={id}
                          type="radio"
                          name="bug-report-kind"
                          value={value}
                          checked={kind === value}
                          onChange={() => changeKind(value)}
                        />
                        {value === "bug" ? labels.kindBug : labels.kindFeature}
                      </label>
                    );
                  })}
                </div>

                <div {...partProps(classNames, "field")}>
                  <label htmlFor={SUMMARY_ID} {...partProps(classNames, "label")}>
                    {labels.summaryLabel}
                  </label>
                  <input
                    id={SUMMARY_ID}
                    ref={summaryRef}
                    type="text"
                    {...partProps(classNames, "input")}
                    placeholder={labels.summaryPlaceholder}
                    maxLength={SUMMARY_LIMIT}
                    aria-required="true"
                    aria-invalid={summaryInvalid}
                    aria-describedby={summaryInvalid ? SUMMARY_ERROR_ID : undefined}
                    value={summary}
                    onChange={(event) => changeSummary(event.target.value)}
                  />
                  {summaryInvalid ? (
                    <p id={SUMMARY_ERROR_ID} role="alert" {...partProps(classNames, "error")}>
                      {labels.summaryRequired}
                    </p>
                  ) : null}
                </div>

                <div {...partProps(classNames, "field")}>
                  <label htmlFor={DESCRIPTION_ID} {...partProps(classNames, "label")}>
                    {k.descriptionLabel}
                  </label>
                  <textarea
                    id={DESCRIPTION_ID}
                    ref={descriptionRef}
                    {...partProps(classNames, "textarea")}
                    placeholder={k.descriptionPlaceholder}
                    maxLength={DESCRIPTION_LIMIT}
                    required
                    aria-invalid={descriptionInvalid}
                    aria-describedby={descriptionDescribedBy}
                    value={description}
                    onChange={(event) => changeDescription(event.target.value)}
                  />
                  <p id={COUNTER_ID} {...partProps(classNames, "counter")}>
                    {labels.characterCount(description.length, DESCRIPTION_LIMIT)}
                  </p>
                  {descriptionInvalid ? (
                    <p id={ERROR_ID} role="alert" {...partProps(classNames, "error")}>
                      {k.descriptionRequired}
                    </p>
                  ) : null}
                </div>

                <div role="radiogroup" aria-labelledby={IMPACT_ID} {...partProps(classNames, "impact-choices")}>
                  <p id={IMPACT_ID} {...partProps(classNames, "label")}>
                    {k.impactLabel}
                  </p>
                  {impactOptions.map(({ value, label, hint }) => {
                    const id = `bug-report-impact-${value}`;
                    const hintId = `${id}-hint`;
                    return (
                      <div key={value}>
                        <label {...partProps(classNames, "choice")} htmlFor={id}>
                          <input
                            id={id}
                            type="radio"
                            name="bug-report-impact"
                            checked={impact === value}
                            aria-describedby={hintId}
                            onChange={() => changeImpact(value)}
                          />
                          {label}
                        </label>
                        <p id={hintId} {...partProps(classNames, "muted")}>
                          {hint}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {technicalDetails ? (
                  <div {...partProps(classNames, "field")}>
                    <button
                      type="button"
                      {...partProps(classNames, "disclosure")}
                      aria-expanded={technicalOpen}
                      aria-controls={TECHNICAL_ID}
                      aria-describedby={TECHNICAL_HINT_ID}
                      onClick={() => setTechnicalOpen(!technicalOpen)}
                    >
                      {labels.technicalTitle}
                    </button>
                    <p id={TECHNICAL_HINT_ID} {...partProps(classNames, "muted")}>
                      {labels.technicalHint}
                    </p>
                    <div id={TECHNICAL_ID}>
                      {technicalOpen ? (
                        <table {...partProps(classNames, "context-table")}>
                          <tbody>
                            {contextRows.map(([key, value]) => (
                              <tr key={key}>
                                <th scope="row" {...partProps(classNames, "context-key")}>
                                  {key}
                                </th>
                                <td {...partProps(classNames, "context-value")}>{value}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div {...partProps(classNames, "field")}>
                  <button
                    type="button"
                    {...partProps(classNames, "disclosure")}
                    aria-expanded={sharedOpen}
                    aria-controls={SHARED_ID}
                    aria-describedby={SHARED_HINT_ID}
                    onClick={() => setSharedOpen(!sharedOpen)}
                  >
                    {labels.sharedTitle}
                  </button>
                  <p id={SHARED_HINT_ID} {...partProps(classNames, "muted")}>
                    {labels.sharedHint}
                  </p>
                  <div id={SHARED_ID}>
                    {sharedOpen ? <p {...partProps(classNames, "muted")}>{labels.sharedBody}</p> : null}
                  </div>
                </div>

                <div role="note" {...partProps(classNames, "note")}>
                  <p {...partProps(classNames, "label")}>{labels.sensitiveTitle}</p>
                  <p {...partProps(classNames, "muted")}>{labels.sensitiveBody}</p>
                </div>

                <div {...partProps(classNames, "phase")}>
                  {/* WHY: the live region holds only the sentence; a copy button in it would read the report aloud. */}
                  <div role="status">
                    {phase.name === "sending" ? (
                      <p {...partProps(classNames, "muted")}>{labels.sending}</p>
                    ) : null}

                    {phase.name === "failed" ? (
                      <>
                        <p {...partProps(classNames, "error")}>{labels.failureTitle}</p>
                        {phase.detail ? <p {...partProps(classNames, "muted")}>{phase.detail}</p> : null}
                        {oversize ? <p {...partProps(classNames, "muted")}>{labels.screenshotTooLarge}</p> : null}
                      </>
                    ) : null}
                  </div>

                  {phase.name === "failed" ? (
                    <>
                      <button
                        type="button"
                        {...partProps(classNames, "secondary-button")}
                        onClick={() => copyReport(phase.payload)}
                      >
                        {copyState === "copied" ? labels.copied : labels.copyToClipboard}
                      </button>
                      {copyState === "manual" ? (
                        <>
                          <p {...partProps(classNames, "muted")}>{labels.copyManually}</p>
                          <textarea
                            ref={manualRef}
                            readOnly
                            {...partProps(classNames, "textarea")}
                            aria-label={labels.copyToClipboard}
                            value={reportAsText(phase.payload)}
                          />
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}

        {confirming ? (
          <div
            role="alertdialog"
            aria-labelledby={DISCARD_TITLE_ID}
            aria-describedby={DISCARD_BODY_ID}
            {...partProps(classNames, "confirm")}
          >
            <h3 id={DISCARD_TITLE_ID} {...partProps(classNames, "confirm-title")}>
              {labels.discardTitle}
            </h3>
            <p id={DISCARD_BODY_ID} {...partProps(classNames, "muted")}>
              {labels.discardBody}
            </p>
            <div {...partProps(classNames, "actions")}>
              <button
                type="button"
                ref={keepEditingRef}
                {...partProps(classNames, "primary-button")}
                onClick={() => setConfirming(false)}
              >
                {labels.keepEditing}
              </button>
              <button type="button" {...partProps(classNames, "secondary-button")} onClick={discard}>
                {labels.discard}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
