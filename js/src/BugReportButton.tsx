import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { BugReportDialog, type BugReportConfirmation } from "./BugReportDialog.js";
import { capturePage, type CaptureResult } from "./capture.js";
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
const MENU_GAP = 4;
const MENU_MARGIN = 8;
const MENU_Z_INDEX = 60;
// WHY: a host's position: relative on the region's classNames part would otherwise take it out of the viewport's corner.
const NOTICE_REGION_STYLE: CSSProperties = { position: "fixed" };
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
  /** Pressing the button opens a menu of the ways to take the screenshot: now, after 3 seconds, on a key press, or none (default true). false takes the screenshot at once. */
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
};

type Pending = { mode: "delay"; secondsLeft: number } | { mode: "key" };

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

type ScreenshotChoice = "now" | "delay" | "key" | "send";

const MENU_CHOICES: ScreenshotChoice[] = ["now", "delay", "key", "send"];

function choiceLabel(labels: ResolvedBugReportLabels, choice: ScreenshotChoice): string {
  switch (choice) {
    case "now":
      return labels.screenshotNow;
    case "delay":
      return labels.screenshotInThreeSeconds;
    case "key":
      return labels.screenshotOnKeyPress;
    case "send":
      return labels.sendWithoutScreenshot;
  }
}

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
  // WHY: the region is portalled, so it waits for the mount; a server render has no body to portal into, and its live region is in place before any notice.
  const [noticeMounted, setNoticeMounted] = useState(false);
  useEffect(() => {
    setNoticeMounted(true);
  }, []);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  // The guard the state cannot be: two presses in one tick both read the
  // render's `busy` as false, and each starts a full-page clone.
  const capturing = useRef(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPlace, setMenuPlace] = useState<{ top: number; left: number } | null>(null);
  const menuMode = screenshotModes !== false;

  function sessionFor(capture: CaptureResult): Session {
    return {
      capture,
      context: getContext(),
      environment: readEnvironment(),
      diagnostics: diagnostics ? diagnostics() : [],
    };
  }

  function showDialog(next: Session) {
    setSession(next);
    onOpenChange?.(true);
  }

  async function open() {
    if (capturing.current) return;
    capturing.current = true;
    setBusy(true);
    try {
      // Capture first, dialog second — the page has to be photographed before
      // our own UI is in the frame. Everything else is read at the same instant
      // so the context and the image describe the same moment.
      const capture = await capturePage({ allowedImageOrigins, captureFonts });
      showDialog(sessionFor(capture));
    } finally {
      capturing.current = false;
      setBusy(false);
    }
  }

  function press() {
    if (capturing.current) return;
    if (!menuMode) void open();
    else if (menuOpen) closeMenu();
    else setMenuOpen(true);
  }

  function closeMenu() {
    setMenuOpen(false);
    setMenuPlace(null);
    // WHY: a close that scrolls the launcher into view would move the page under a reporter who scrolled it away.
    launcher.current?.focus({ preventScroll: true });
  }

  function choose(choice: ScreenshotChoice) {
    closeMenu();
    if (choice === "now") requestAnimationFrame(() => void open());
    else if (choice === "send") showDialog(sessionFor({ ok: false, reason: "skipped" }));
    else {
      // WHY: the ref stays set through the wait, so the launcher cannot start a second capture while the dialog is away.
      capturing.current = true;
      setPending(choice === "delay" ? { mode: "delay", secondsLeft: SCREENSHOT_DELAY_SECONDS } : { mode: "key" });
    }
  }

  function onMenuKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const at = items.indexOf(document.activeElement as HTMLElement);
    const last = items.length - 1;
    switch (event.key) {
      case "ArrowDown":
        items[at >= last ? 0 : at + 1].focus();
        break;
      case "ArrowUp":
        items[at <= 0 ? last : at - 1].focus();
        break;
      case "Home":
        items[0].focus();
        break;
      case "End":
        items[last].focus();
        break;
      case "Escape":
        // WHY: the host's own Escape handler (a drawer or dialog) listens on the document and must not close with the menu.
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        break;
      case "Tab":
        closeMenu();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function close() {
    setSession(null);
    onOpenChange?.(false);
  }

  function sent(result: { number: number }) {
    if (onSent) onSent(result);
    else if (confirmation === "notice") setNotice({ id: ++noticeIds.current, number: result.number });
  }

  function cancelWait() {
    capturing.current = false;
    setPending(null);
    launcher.current?.focus();
  }

  async function captureAfterWait() {
    setPending(null);
    await nextFrame();
    try {
      const next = sessionFor(await capturePage({ allowedImageOrigins, captureFonts }));
      launcher.current?.focus();
      showDialog(next);
    } finally {
      capturing.current = false;
    }
  }

  useEffect(() => {
    if (pending === null) return;
    let active = true;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && !(pending.mode === "key" && isScreenshotKey(event))) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      if (event.key === "Escape") cancelWait();
      else void captureAfterWait();
    };
    window.addEventListener("keydown", onKey, { capture: true });

    const timer =
      pending.mode === "delay"
        ? window.setTimeout(() => {
            if (!active) return;
            if (pending.secondsLeft > 1) {
              setPending({ mode: "delay", secondsLeft: pending.secondsLeft - 1 });
            } else {
              void captureAfterWait();
            }
          }, 1000)
        : undefined;

    return () => {
      active = false;
      window.removeEventListener("keydown", onKey, { capture: true });
      window.clearTimeout(timer);
    };
  }, [pending]);

  // The menu renders hidden until it has a place, so it is measured and placed before the first item takes focus.
  useLayoutEffect(() => {
    if (!menuOpen || !menu.current || !launcher.current) return;
    if (menuPlace === null) {
      setMenuPlace(
        placeMenu(launcher.current.getBoundingClientRect(), menu.current.getBoundingClientRect(), {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
      return;
    }
    menu.current.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [menuOpen, menuPlace]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || launcher.current?.contains(target)) return;
      closeMenu();
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [menuOpen]);

  // The place is in viewport coordinates, so a page that moves under an open menu closes it.
  useEffect(() => {
    if (!menuOpen) return;
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [menuOpen]);

  const buttonName = menuMode ? `${labels.buttonLabel}, ${labels.buttonMenuHint}` : labels.buttonLabel;
  const name = busy ? labels.capturePending : buttonName;
  const hint = pending?.mode === "delay" ? labels.captureCountdown(pending.secondsLeft) : labels.captureKeyHint;

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
        onClick={press}
        aria-busy={busy}
        aria-haspopup={menuMode ? "menu" : undefined}
        aria-expanded={menuMode ? menuOpen : undefined}
        aria-label={name}
        title={name}
      >
        {children ?? (busy ? labels.capturePending : labels.buttonLabel)}
      </button>

      {menuMode && menuOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label={labels.buttonLabel}
              data-bugreport-launcher
              {...partProps(classNames, "screenshot-modes")}
              style={{
                position: "fixed",
                top: menuPlace?.top ?? 0,
                left: menuPlace?.left ?? 0,
                zIndex: MENU_Z_INDEX,
                visibility: menuPlace ? undefined : "hidden",
              }}
              onKeyDown={onMenuKey}
            >
              {MENU_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="menuitem"
                  {...partProps(classNames, "screenshot-mode")}
                  onClick={() => choose(choice)}
                >
                  {choiceLabel(labels, choice)}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}

      {pending ? (
        <div data-bugreport-launcher {...partProps(classNames, "capture-hint")}>
          <p role="status">{hint}</p>
          <button type="button" {...partProps(classNames, "capture-cancel")} onClick={cancelWait}>
            {labels.captureCancel}
          </button>
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
          onSent={sent}
          confirmation={confirmation}
        />
      ) : null}

      {noticeMounted && typeof document !== "undefined"
        ? createPortal(
            <div {...partProps(classNames, "notice-region")} style={NOTICE_REGION_STYLE}>
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
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// WHY: the menu is fixed to the viewport, so its place is in viewport coordinates; inline position wins over a host class's position: relative.
function placeMenu(
  anchor: Pick<DOMRect, "top" | "bottom" | "left">,
  size: Pick<DOMRect, "width" | "height">,
  view: { width: number; height: number },
): { top: number; left: number } {
  const below = anchor.bottom + MENU_GAP;
  const fitsBelow = below + size.height + MENU_MARGIN <= view.height;
  const wanted = fitsBelow ? below : anchor.top - MENU_GAP - size.height;
  return {
    top: Math.max(MENU_MARGIN, Math.min(wanted, view.height - size.height - MENU_MARGIN)),
    left: Math.max(MENU_MARGIN, Math.min(anchor.left, view.width - size.width - MENU_MARGIN)),
  };
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
