import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BugReportDialog, type BugReportConfirmation, type RetakeMode } from "./BugReportDialog.js";
import { capturePage, type CaptureResult } from "./capture.js";
import { type Draft } from "./draft.js";
import {
  readEnvironment,
  type BugReportContext,
  type BugReportEnvironment,
  type BugReportSubmit,
} from "./payload.js";
import { formatFiled, mergeLabels, type BugReportLabelOverrides, type ResolvedBugReportLabels } from "./labels.js";
import { partProps, type BugReportClassNames } from "./theme.js";

const SCREENSHOT_DELAY_SECONDS = 3;
const SCREENSHOT_KEY = "s";
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const NOTICE_MS = 5_000;
const NOTICE_FADE_MS = 300;
// WHY: the live region must exist before any send and hold the sentence once, so the visible notice is not drawn twice.
const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
};

export type BugReportButtonProps = {
  submit: BugReportSubmit;
  getContext: () => BugReportContext;
  labels?: BugReportLabelOverrides;
  diagnostics?: () => unknown;
  /** See capture.ts — which image origins are worth trying to inline. */
  allowedImageOrigins?: string[];
  /** Embeds the page's web fonts in the screenshot so its labels wrap as they do on the page (default true); false skips that for a host where it is slow. */
  captureFonts?: boolean;
  /**
   * The host dresses the launcher. This folder owns what the button DOES —
   * capture before the dialog, keep focus, stay out of its own screenshot — and
   * nothing about where it sits or what it looks like: in this panel it is one
   * icon in the header cluster, in the next host it may be a corner badge.
   */
  className?: string;
  /**
   * What the launcher shows. Defaults to the label; an icon-only host passes
   * its icon, and the name below is then the only name the control has.
   */
  children?: ReactNode;
  /** The dialog opened (true) or closed (false); a host that must outlive the launcher listens. */
  onOpenChange?: (open: boolean) => void;
  /** Classes per part, added to bugkit's default look; any class beats the default. */
  classNames?: BugReportClassNames;
  /** CSP nonce for the one `<style>` element bugkit adds to `<head>`. */
  nonce?: string;
  /** Shows the Technical details disclosure in the dialog (default true); the details are sent either way. */
  technicalDetails?: boolean;
  /** Shows the dialog's screenshot options: retake after a countdown or on a key press, or send without a screenshot (default true). */
  screenshotModes?: boolean;
  /** Called with the number after a report is sent; with it set, bugkit shows no notice of its own. */
  onSent?: (result: { number: number }) => void;
  /** After a send: "notice" (default) closes the dialog and shows a notice for a few seconds; "dialog" keeps the sent view in the dialog. */
  confirmation?: BugReportConfirmation;
};

type Session = {
  capture: CaptureResult;
  context: BugReportContext;
  environment: BugReportEnvironment;
  diagnostics: unknown;
  draft?: Draft;
};

type Pending = { mode: "delay"; secondsLeft: number } | { mode: "key" } | { mode: "capturing" };

function isScreenshotKey(event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== SCREENSHOT_KEY || event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  return !(event.target instanceof Element && event.target.closest(EDITABLE_SELECTOR));
}

export function BugReportButton(props: BugReportButtonProps) {
  const {
    submit,
    getContext,
    diagnostics,
    allowedImageOrigins,
    captureFonts,
    className,
    children,
    onOpenChange,
    classNames,
    nonce,
    technicalDetails,
    screenshotModes,
    onSent,
    confirmation = "notice",
  } = props;
  const labels: ResolvedBugReportLabels = mergeLabels(props.labels);
  const [session, setSession] = useState<Session | null>(null);
  const [notice, setNotice] = useState<{ id: number; number: number } | null>(null);
  const noticeIds = useRef(0);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  // The guard the state cannot be: two presses in one tick both read the
  // render's `busy` as false, and each starts a full-page clone.
  const capturing = useRef(false);
  const launcher = useRef<HTMLButtonElement>(null);

  async function open() {
    if (capturing.current) return;
    capturing.current = true;
    setBusy(true);
    try {
      // Capture first, dialog second — the page has to be photographed before
      // our own UI is in the frame. Everything else is read at the same instant
      // so the context and the image describe the same moment.
      const capture = await capturePage({ allowedImageOrigins, captureFonts });
      setSession({
        capture,
        context: getContext(),
        environment: readEnvironment(),
        diagnostics: diagnostics ? diagnostics() : [],
      });
      onOpenChange?.(true);
    } finally {
      capturing.current = false;
      setBusy(false);
    }
  }

  function close() {
    setSession(null);
    onOpenChange?.(false);
  }

  function sent(result: { number: number }) {
    if (onSent) onSent(result);
    else if (confirmation === "notice") setNotice({ id: ++noticeIds.current, number: result.number });
  }

  // WHY: the ref stays set through the wait, so the launcher cannot start a second capture while the dialog is away.
  function retake(mode: RetakeMode, draft: Draft) {
    capturing.current = true;
    setSession((current) => (current ? { ...current, draft } : current));
    setPending(mode === "delay" ? { mode: "delay", secondsLeft: SCREENSHOT_DELAY_SECONDS } : { mode: "key" });
  }

  function cancelRetake() {
    capturing.current = false;
    setPending(null);
  }

  async function captureRetake() {
    setPending({ mode: "capturing" });
    try {
      const capture = await capturePage({ allowedImageOrigins, captureFonts });
      const next = {
        capture,
        context: getContext(),
        environment: readEnvironment(),
        diagnostics: diagnostics ? diagnostics() : [],
      };
      launcher.current?.focus();
      setSession((current) => ({ ...next, draft: current?.draft }));
    } finally {
      capturing.current = false;
      setPending(null);
    }
  }

  useEffect(() => {
    if (pending === null || pending.mode === "capturing") return;
    let active = true;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && !(pending.mode === "key" && isScreenshotKey(event))) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      if (event.key === "Escape") cancelRetake();
      else void captureRetake();
    };
    window.addEventListener("keydown", onKey, { capture: true });

    const timer =
      pending.mode === "delay"
        ? window.setTimeout(() => {
            if (!active) return;
            if (pending.secondsLeft > 1) {
              setPending({ mode: "delay", secondsLeft: pending.secondsLeft - 1 });
            } else {
              void captureRetake();
            }
          }, 1000)
        : undefined;

    return () => {
      active = false;
      window.removeEventListener("keydown", onKey, { capture: true });
      window.clearTimeout(timer);
    };
  }, [pending]);

  const name = busy ? labels.capturePending : labels.buttonLabel;
  const hint =
    pending?.mode === "delay"
      ? labels.captureCountdown(pending.secondsLeft)
      : pending?.mode === "key"
        ? labels.captureKeyHint
        : labels.capturePending;

  return (
    <>
      {/*
       * Three things about this one element.
       *
       * `aria-busy` and a re-entrancy guard rather than `disabled`: a browser
       * blurs an element the moment it is disabled, so disabling the launcher
       * for the length of the capture would throw focus to <body> — and the
       * dialog restores focus to whatever was focused when it opened, which has
       * to be this button for a keyboard reporter to get back where they were.
       *
       * The data attribute keeps the button out of the picture it takes:
       * capture.ts drops any node carrying it, so the shot is of the page and
       * not of the control the reporter pressed to photograph it.
       *
       * The name is an attribute, not the content: an icon-only host renders no
       * words here, and `title` gives a pointer user the same name the screen
       * reader is given. It carries the busy state as well, because with no
       * visible label there is nothing else left to say it.
       */}
      <button
        ref={launcher}
        type="button"
        data-bugreport-launcher
        {...partProps(classNames, "launcher", className)}
        onClick={open}
        aria-busy={busy}
        aria-label={name}
        title={name}
      >
        {children ?? name}
      </button>

      {pending ? (
        <div data-bugreport-launcher {...partProps(classNames, "capture-hint")}>
          <p role="status">{hint}</p>
          {pending.mode === "capturing" ? null : (
            <button type="button" {...partProps(classNames, "capture-cancel")} onClick={cancelRetake}>
              {labels.captureCancel}
            </button>
          )}
        </div>
      ) : null}

      {session && !pending ? (
        <BugReportDialog
          capture={session.capture}
          labels={labels}
          context={session.context}
          environment={session.environment}
          diagnostics={session.diagnostics}
          submit={submit}
          onClose={close}
          classNames={classNames}
          nonce={nonce}
          technicalDetails={technicalDetails}
          screenshotModes={screenshotModes}
          onRetake={retake}
          initialDraft={session.draft}
          onSent={sent}
          confirmation={confirmation}
        />
      ) : null}

      <div {...partProps(classNames, "notice-region")}>
        <div role="status" aria-live="polite" aria-atomic="true" style={VISUALLY_HIDDEN}>
          {notice ? formatFiled(labels.sentNotice, notice.number) : null}
        </div>
        {notice ? (
          <SentNotice
            key={notice.id}
            text={formatFiled(labels.sentNotice, notice.number)}
            closeLabel={labels.close}
            classNames={classNames}
            onDone={() => setNotice(null)}
          />
        ) : null}
      </div>
    </>
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

type SentNoticeProps = {
  text: string;
  closeLabel: string;
  classNames?: BugReportClassNames;
  onDone: () => void;
};

// WHY: the notice stays while the pointer is over it or it has focus, so a reporter can read or reach its close button.
function SentNotice({ text, closeLabel, classNames, onDone }: SentNoticeProps) {
  const [fading, setFading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;

  useEffect(() => {
    if (held) return;
    const reduced = prefersReducedMotion();
    // WHY: both timers are set together; a fade timer chained off the fade state would wait for a second render, which a fake clock does not run.
    const fade = reduced ? undefined : window.setTimeout(() => setFading(true), NOTICE_MS);
    const done = window.setTimeout(onDone, reduced ? NOTICE_MS : NOTICE_MS + NOTICE_FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [held]);

  return (
    <div
      {...partProps(classNames, "notice")}
      data-leaving={fading ? "" : undefined}
      onPointerEnter={() => {
        setFading(false);
        setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => {
        setFading(false);
        setFocused(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <p {...partProps(classNames, "notice-text")}>{text}</p>
      <button type="button" {...partProps(classNames, "notice-close")} onClick={onDone}>
        {closeLabel}
      </button>
    </div>
  );
}
