import { getFontEmbedCSS, toPng } from "html-to-image";

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
  captureFonts?: boolean;
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

const LAYER_ATTRIBUTE = "data-bugkit-layer";
const LAYER_PSEUDOS = ["", "::before", "::after"];

function borderImageURL(el: Element, pseudo: string): string | null {
  const source = window.getComputedStyle(el, pseudo || null).getPropertyValue("border-image-source");
  const match = /url\(\s*["']?([^"')]+?)["']?\s*\)/.exec(source);
  try {
    return match ? new URL(match[1], document.baseURI).href : null;
  } catch {
    return null;
  }
}

function borderImageLonghands(el: Element, pseudo: string): string {
  const style = window.getComputedStyle(el, pseudo || null);
  return ["slice", "width", "outset", "repeat"]
    .map((name) => {
      const value = style.getPropertyValue(`border-image-${name}`);
      return value ? `border-image-${name}: ${value} !important;` : "";
    })
    .join(" ");
}

async function toDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`seal responded ${response.status}`);
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * WHY: html-to-image inlines only background images into the clone, so a
 * border-image seal such as `.ink-seal::before` reaches the picture as a
 * relative URL that the SVG cannot load, and the layer paints nothing. The
 * seal is read from the live page and set on the clone as a data URL. A seal
 * that cannot be read is left out rather than failing the capture.
 */
function markBorderImages(
  root: HTMLElement,
  allowedOrigins: string[],
): { css: Promise<string>; unmark: () => void } {
  const marked: Element[] = [];
  const pending: Promise<string>[] = [];
  for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
    const layers = LAYER_PSEUDOS.flatMap((pseudo) => {
      const url = borderImageURL(el, pseudo);
      return url && allowedOrigins.includes(new URL(url).origin)
        ? [{ pseudo, url, longhands: borderImageLonghands(el, pseudo) }]
        : [];
    });
    if (layers.length === 0) {
      continue;
    }
    const n = String(marked.length);
    el.setAttribute(LAYER_ATTRIBUTE, n);
    marked.push(el);
    for (const { pseudo, url, longhands } of layers) {
      pending.push(
        cachedRead(`seal:${url}`, () => toDataUrl(url)).then((dataUrl) =>
          dataUrl
            ? `[${LAYER_ATTRIBUTE}="${n}"]${pseudo} { border-image-source: url("${dataUrl}") !important; ${longhands} }`
            : "",
        ),
      );
    }
  }
  return {
    css: Promise.all(pending).then((rules) => rules.filter(Boolean).join("\n")),
    unmark: () => {
      for (const el of marked) {
        el.removeAttribute(LAYER_ATTRIBUTE);
      }
    },
  };
}

const READ_BOUND_MS = 1_500;

function within<T>(pending: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), READ_BOUND_MS);
  });
  return Promise.race([pending.catch(() => fallback), bound]).finally(() => clearTimeout(timer));
}

/**
 * WHY: the page's fonts and seals do not change between reports, and
 * html-to-image would otherwise walk every stylesheet and fetch every font again
 * on each capture. A read that fails is dropped, so the next capture reads it
 * again. A read that is still pending after READ_BOUND_MS is left out of this
 * capture, and the read itself is kept, so a slow font serves the captures
 * after it.
 */
const reads = new Map<string, Promise<string>>();

export function clearPageFonts(): void {
  reads.clear();
}

function cachedRead(key: string, read: () => Promise<string>): Promise<string | null> {
  let pending = reads.get(key);
  if (!pending) {
    const fresh = Promise.resolve().then(read);
    fresh.catch(() => reads.delete(key));
    reads.set(key, fresh);
    pending = fresh;
  }
  return within(pending, null);
}

function pageFontCSS(): Promise<string | null> {
  return cachedRead("fonts", () => getFontEmbedCSS(document.body, { preferredFontFormat: "woff2" }));
}

export async function capturePage(options: CaptureOptions = {}): Promise<CaptureResult> {
  const root = options.root ?? document.body;
  const nodeCap = options.nodeCap ?? CAPTURE_NODE_CAP;
  const timeoutMs = options.timeoutMs ?? CAPTURE_TIMEOUT_MS;
  const captureFonts = options.captureFonts ?? true;
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
  const borders = markBorderImages(root, allowedOrigins);
  const capture: Promise<CaptureResult> = Promise.all([
    captureFonts ? pageFontCSS() : Promise.resolve(null),
    borders.css,
  ])
    .then(([fonts, borderCSS]) => {
      const fontEmbedCSS = [fonts, scrolled.css, borderCSS].filter(Boolean).join("\n");
      return toPng(root, {
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
        // WHY: a label set in the page's web font wraps differently in the browser's
        // fallback face; the pass inlines the @font-face rules the page uses.
        skipFonts: !fonts,
        filter: captureFilter(allowedOrigins),
        // A single image that cannot be inlined leaves a transparent hole rather
        // than rejecting the export, so a page with one broken asset still yields
        // a usable screenshot.
        imagePlaceholder:
          "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        // A caller's own root is photographed whole; the page is framed.
        ...(root === document.body ? viewportFraming(root) : {}),
        ...(fontEmbedCSS ? { fontEmbedCSS } : {}),
      });
    })
    .then((dataUrl): CaptureResult => ({ ok: true, dataUrl }))
    .catch((): CaptureResult => ({ ok: false, reason: "failed" }));

  try {
    return await Promise.race([capture, timeout]);
  } finally {
    clearTimeout(timer);
    scrolled.unmark();
    borders.unmark();
  }
}
