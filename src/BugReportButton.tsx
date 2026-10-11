import { useRef, useState, type ReactNode } from "react";
import { BugReportDialog } from "./BugReportDialog.js";
import { capturePage, type CaptureResult } from "./capture.js";
import {
  readEnvironment,
  type BugReportContext,
  type BugReportEnvironment,
  type BugReportSubmit,
} from "./payload.js";
import { mergeLabels, type BugReportLabels } from "./labels.js";

export type BugReportButtonProps = {
  submit: BugReportSubmit;
  getContext: () => BugReportContext;
  labels?: Partial<BugReportLabels>;
  diagnostics?: () => unknown;
  /** See capture.ts — which image origins are worth trying to inline. */
  allowedImageOrigins?: string[];
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
};

type Session = {
  capture: CaptureResult;
  context: BugReportContext;
  environment: BugReportEnvironment;
  diagnostics: unknown;
};

export function BugReportButton(props: BugReportButtonProps) {
  const {
    submit,
    getContext,
    diagnostics,
    allowedImageOrigins,
    className,
    children,
    onOpenChange,
  } = props;
  const labels: BugReportLabels = mergeLabels(props.labels);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  // The guard the state cannot be: two presses in one tick both read the
  // render's `busy` as false, and each starts a full-page clone.
  const capturing = useRef(false);

  async function open() {
    if (capturing.current) return;
    capturing.current = true;
    setBusy(true);
    try {
      // Capture first, dialog second — the page has to be photographed before
      // our own UI is in the frame. Everything else is read at the same instant
      // so the context and the image describe the same moment.
      const capture = await capturePage({ allowedImageOrigins });
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

  const name = busy ? labels.capturePending : labels.buttonLabel;

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
        type="button"
        data-bugreport-launcher
        className={className}
        onClick={open}
        aria-busy={busy}
        aria-label={name}
        title={name}
      >
        {children ?? name}
      </button>

      {session ? (
        <BugReportDialog
          capture={session.capture}
          labels={labels}
          context={session.context}
          environment={session.environment}
          diagnostics={session.diagnostics}
          submit={submit}
          onClose={close}
        />
      ) : null}
    </>
  );
}
