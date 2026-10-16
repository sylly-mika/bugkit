import { cutStack, scrubPath, scrubText } from "./scrub.js";

/** How many failed API calls and errors a timeline keeps. */
export const PROBLEMS_CAPACITY = 20;
/** How many console errors and warnings a timeline keeps. */
export const CONSOLE_CAPACITY = 20;
/** How many routes, clicks and successful API calls a timeline keeps. */
export const TRAIL_CAPACITY = 50;
/** Cut, in code points, for a recorded click label and selector. */
export const LABEL_LIMIT = 60;

/** One API call; status 0 is a network failure, request_id is "" when the response had none. */
export type ApiCallEntry = { type: "api"; method: string; path: string; status: number; duration_ms: number; request_id: string; at: string };
/** An error or rejection, with its cut, scrubbed stack ("" when it had none). */
export type ErrorEntry = { type: "error"; message: string; source: string; stack: string; at: string };
/** One console.error or console.warn call. */
export type ConsoleEntry = { type: "console"; level: "error" | "warn"; message: string; at: string };
/** A route the page went to. */
export type RouteEntry = { type: "route"; path: string; at: string };
/** A click, named by a short selector and the visible label of what was clicked. */
export type ClickEntry = { type: "click"; selector: string; label: string; at: string };
/** One entry of a diagnostics timeline. */
export type TimelineEntry = ApiCallEntry | ErrorEntry | ConsoleEntry | RouteEntry | ClickEntry;

/** What a fetch wrapper reports about one call. */
export type ApiCallInput = { method: string; url: string; status: number; durationMs: number; requestId?: string | null };

/** A scrubbed, bounded timeline of what the page did before a bug report. */
export interface Diagnostics {
  recordApiCall(call: ApiCallInput): void;
  recordError(error: unknown, source?: string): void;
  recordConsole(level: "error" | "warn", args: readonly unknown[]): void;
  recordRoute(url: string): void;
  recordClick(target: Element): void;
  snapshot(): TimelineEntry[];
  clear(): void;
}

const CLICKABLE = "a,button,summary,label,input,select,textarea,[role=button],[role=link],[role=menuitem],[role=tab]";
const LAUNCHER = "[data-bugreport-launcher]";
const FIELD = "input,select,textarea";
const PRIVATE = '[contenteditable]:not([contenteditable="false"]),[data-diagnostics-private]';

type Stored = { entry: TimelineEntry; seq: number };

function messageOf(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return String(value);
  return "[object]";
}

function fieldValues(): string[] {
  if (typeof document === "undefined") return [];
  const values: string[] = [];
  for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")) {
    values.push(field.value);
  }
  return values;
}

// WHY: React mirrors a controlled textarea's value into its text, so a field's text is skipped, not only its value.
function visibleText(node: Node): string {
  let text = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) text += child.nodeValue ?? "";
    else if (child.nodeType === 1 && !(child as Element).matches(`${FIELD},${PRIVATE}`)) text += visibleText(child);
  }
  return text;
}

function collapse(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function selectorOf(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (element.id) return `${tag}#${element.id}`;
  return tag + Array.from(element.classList).slice(0, 2).map((name) => `.${name}`).join("");
}

function labelOf(element: Element): string {
  if (element.matches(FIELD) || element.closest(PRIVATE) !== null) return "";
  const text = collapse(element.getAttribute("aria-label")) || collapse(element.getAttribute("title")) || collapse(visibleText(element));
  return scrubText(text, { limit: LABEL_LIMIT });
}

/** Creates an empty timeline; `now` defaults to the wall clock. */
export function createDiagnostics(options: { now?: () => Date } = {}): Diagnostics {
  const now = options.now ?? (() => new Date());
  const problems: Stored[] = [];
  const consoleRing: Stored[] = [];
  const trail: Stored[] = [];
  let seq = 0;

  function push(ring: Stored[], capacity: number, entry: TimelineEntry): void {
    ring.push({ entry, seq: seq++ });
    if (ring.length > capacity) ring.splice(0, ring.length - capacity);
  }

  function at(): string {
    return now().toISOString();
  }

  return {
    recordApiCall(call) {
      const entry: ApiCallEntry = {
        type: "api",
        method: call.method.toUpperCase(),
        path: scrubPath(call.url),
        status: call.status,
        duration_ms: Math.round(call.durationMs),
        request_id: call.requestId ?? "",
        at: at(),
      };
      if (call.status === 0 || call.status >= 400) push(problems, PROBLEMS_CAPACITY, entry);
      else push(trail, TRAIL_CAPACITY, entry);
    },
    recordError(error, source = "") {
      const secrets = fieldValues();
      push(problems, PROBLEMS_CAPACITY, {
        type: "error",
        message: scrubText(messageOf(error), { secrets }),
        source: scrubText(source, { secrets }),
        // WHY: secrets go first; cutStack's own scrub could rewrite part of a typed value and hide it from the secrets pass.
        stack:
          error instanceof Error && typeof error.stack === "string"
            ? cutStack(scrubText(error.stack, { secrets, limit: Number.POSITIVE_INFINITY }))
            : "",
        at: at(),
      });
    },
    recordConsole(level, args) {
      push(consoleRing, CONSOLE_CAPACITY, {
        type: "console",
        level,
        message: scrubText(args.map(messageOf).join(" "), { secrets: fieldValues() }),
        at: at(),
      });
    },
    recordRoute(url) {
      push(trail, TRAIL_CAPACITY, { type: "route", path: scrubPath(url), at: at() });
    },
    recordClick(target) {
      if (target.closest(LAUNCHER) !== null) return;
      const element = target.closest(CLICKABLE) ?? target;
      push(trail, TRAIL_CAPACITY, {
        type: "click",
        selector: scrubText(selectorOf(element), { limit: LABEL_LIMIT }),
        label: labelOf(element),
        at: at(),
      });
    },
    snapshot() {
      return [...problems, ...consoleRing, ...trail]
        .sort((a, b) => Date.parse(a.entry.at) - Date.parse(b.entry.at) || a.seq - b.seq)
        .map((item) => ({ ...item.entry }));
    },
    clear() {
      problems.length = 0;
      consoleRing.length = 0;
      trail.length = 0;
    },
  };
}
