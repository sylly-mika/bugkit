import { toPng } from "html-to-image";

export const CAPTURE_TIMEOUT_MS = 5_000;
export const CAPTURE_NODE_CAP = 3_000;

export type CaptureResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: "too-many-nodes" | "timed-out" | "failed" };

export type CaptureOptions = {
  root?: HTMLElement;
  nodeCap?: number;
  timeoutMs?: number;
  allowedImageOrigins?: string[];
};

/** The launcher marks itself with this, and is dropped from its own screenshot. */
const LAUNCHER_ATTRIBUTE = "data-bugreport-launcher";

/**
 * What survives into the clone. Two exclusions, both about the picture being of
 * the page rather than of us.
 *
 * The launcher goes first: it is our control and not the page's, and it is the
 * one element mid-interaction at the instant of the shot. A report should show
 * the screen being described, without the button pressed to describe it.
 *
 * Then the images. One uncontrolled <img> can cost the whole screenshot, so
 * anything outside the allow-list is dropped from the clone rather than fetched.
 *
 * The caller's list is additive, never a replacement: the page's own origin is
 * always allowed, because an image the panel serves itself can never be the
 * uncontrolled one this guard exists for, and a caller that named a bucket
 * origin did not mean to blank its own logo.
 *
 * It is a parameter at all because the two images that matter here pull in
 * opposite directions: the OSM tiles on a site's map are third-party and must go,
 * while the plan pin map is served from our own uploads bucket on an origin
 * that differs between dev (MinIO on its own port) and prod (a Spaces host).
 * The caller knows which origins those are; this module does not.
 */
function captureFilter(allowedOrigins: string[]) {
  return (node: HTMLElement): boolean => {
    if (node instanceof Element && node.hasAttribute(LAUNCHER_ATTRIBUTE)) {
      return false;
    }

    if (!(node instanceof HTMLImageElement)) {
      return true;
    }

    const src = node.currentSrc || node.src;
    if (!src || src.startsWith("data:") || src.startsWith("blob:")) {
      return true;
    }

    try {
      return allowedOrigins.includes(new URL(src, window.location.href).origin);
    } catch {
      return false;
    }
  };
}

/**
 * What the reporter sees, not the whole document. html-to-image sizes the
 * picture from the node and lays the clone out inside an SVG of that size,
 * where `position: fixed` resolves against the picture — so a full-document
 * shot spread a modal's backdrop over every screen of a long page and left the
 * modal at the top of it, and never showed what the reporter had scrolled to.
 * A viewport-sized picture, with the document-sized clone pulled up by the
 * scroll offset, shows the screen as it was and the fixed overlays where they
 * were. Sticky chrome is the exception: with no scrollport in the picture it
 * sits at its flow position, so a scrolled page loses its header — the route
 * in the report's context table is what names the page. A margin, not a
 * transform: a transformed root becomes the containing block of every fixed
 * descendant and would drag the overlays up with the page. The viewport is
 * measured on the document element, which excludes the scrollbars that
 * window.innerWidth counts; the fallback is for a runtime that reports 0.
 */
function viewportFraming(root: HTMLElement) {
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  return {
    width: viewportWidth,
    height: viewportHeight,
    style: {
      width: `${Math.max(root.scrollWidth, viewportWidth)}px`,
      height: `${Math.max(root.scrollHeight, viewportHeight)}px`,
      marginTop: `${-window.scrollY}px`,
      marginLeft: `${-window.scrollX}px`,
    },
  };
}

const SCROLL_ATTRIBUTE = "data-bugkit-scroll";

/**
 * WHY: html-to-image puts fontEmbedCSS into the clone only, and the clone copies
 * attributes, so the marks and their rules reach the picture while the live
 * page never sees them. The marks are removed by the caller once the capture
 * settles.
 */
function markScrolled(root: HTMLElement): { css: string; unmark: () => void } {
  const rules: string[] = [];
  const marked: Element[] = [];
  for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
    if (el.scrollTop === 0 && el.scrollLeft === 0) {
      continue;
    }
    const n = String(marked.length);
    el.setAttribute(SCROLL_ATTRIBUTE, n);
    marked.push(el);
    rules.push(
      `[${SCROLL_ATTRIBUTE}="${n}"] > * { translate: ${-el.scrollLeft}px ${-el.scrollTop}px !important; }`,
    );
  }
  return {
    css: rules.join("\n"),
    unmark: () => {
      for (const el of marked) {
        el.removeAttribute(SCROLL_ATTRIBUTE);
      }
    },
  };
}

export async function capturePage(options: CaptureOptions = {}): Promise<CaptureResult> {
  const root = options.root ?? document.body;
  const nodeCap = options.nodeCap ?? CAPTURE_NODE_CAP;
  const timeoutMs = options.timeoutMs ?? CAPTURE_TIMEOUT_MS;
  const allowedOrigins = [window.location.origin, ...(options.allowedImageOrigins ?? [])];

  // Counted first, never raced. toPng walks and clones the tree synchronously,
  // so a 5,000-row table freezes the tab for as long as that takes and the
  // timeout below would never get a turn to fire.
  if (root.getElementsByTagName("*").length > nodeCap) {
    return { ok: false, reason: "too-many-nodes" };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<CaptureResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "timed-out" }), timeoutMs);
  });

  const scrolled = markScrolled(root);
  const capture: Promise<CaptureResult> = toPng(root, {
    // Deliberately off. html-to-image appends `?<timestamp>` to EVERY resource
    // URL when it is on, blob: included — and a blob URL with a query string
    // does not resolve, so every image the panel serves through
    // URL.createObjectURL comes back ERR_FILE_NOT_FOUND and lands on the
    // placeholder below. That is the floor plan and every station pin icon on
    // the plan editor: the one page whose whole content is an image.
    cacheBust: false,
    // Left to itself html-to-image renders at devicePixelRatio, so a long page
    // on a 2x display rasterises to four times the pixels and sails past the
    // backend's 5 MB PNG cap. A bug report needs legible, not retina.
    pixelRatio: 1,
    // The panel declares no @font-face, so the font pass has nothing to inline
    // and only costs a walk over live stylesheets it is willing to mutate.
    skipFonts: true,
    filter: captureFilter(allowedOrigins),
    // A single image that cannot be inlined leaves a transparent hole rather
    // than rejecting the export, so a page with one broken asset still yields
    // a usable screenshot.
    imagePlaceholder:
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    // A caller's own root is photographed whole; the page is framed.
    ...(root === document.body ? viewportFraming(root) : {}),
    ...(scrolled.css ? { fontEmbedCSS: scrolled.css } : {}),
  })
    .then((dataUrl): CaptureResult => ({ ok: true, dataUrl }))
    .catch((): CaptureResult => ({ ok: false, reason: "failed" }));

  try {
    return await Promise.race([capture, timeout]);
  } finally {
    clearTimeout(timer);
    scrolled.unmark();
  }
}
