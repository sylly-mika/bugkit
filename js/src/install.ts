import { scrubPath } from "./scrub.js";
import type { Diagnostics } from "./timeline.js";

function quietly(record: () => void): void {
  try {
    record();
  } catch {
    // WHY: diagnostics must never break the page they observe.
  }
}

/** Records window errors and unhandled promise rejections; returns the uninstaller. */
export function installErrorCapture(d: Diagnostics): () => void {
  const onError = (event: ErrorEvent) => {
    const file = event.filename ? scrubPath(event.filename) : "";
    quietly(() => d.recordError(event.error ?? event.message, `${file}:${event.lineno ?? 0}:${event.colno ?? 0}`));
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    quietly(() => d.recordError(event.reason, "unhandledrejection"));
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

/** Records console.error and console.warn calls, then passes them on; returns the uninstaller. */
export function installConsoleCapture(d: Diagnostics): () => void {
  const undo = (["error", "warn"] as const).map((level) => wrapConsole(d, level));
  return () => undo.forEach((u) => u());
}

function wrapConsole(d: Diagnostics, level: "error" | "warn"): () => void {
  const original = console[level];
  const wrapper = (...args: unknown[]): void => {
    quietly(() => d.recordConsole(level, args));
    original.apply(console, args);
  };
  console[level] = wrapper;
  return () => {
    if (console[level] === wrapper) console[level] = original;
  };
}

/** Records the current route, history navigations and clicks; returns the uninstaller. */
export function installBreadcrumbs(d: Diagnostics): () => void {
  let last: string | null = null;
  const visit = () =>
    quietly(() => {
      const path = scrubPath(location.href);
      if (path === last) return;
      last = path;
      d.recordRoute(location.href);
    });
  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (target instanceof Element) quietly(() => d.recordClick(target));
  };
  const undoPush = wrapHistory("pushState", visit);
  const undoReplace = wrapHistory("replaceState", visit);
  visit();
  window.addEventListener("popstate", visit);
  document.addEventListener("click", onClick, true);
  return () => {
    undoPush();
    undoReplace();
    window.removeEventListener("popstate", visit);
    document.removeEventListener("click", onClick, true);
  };
}

function wrapHistory(name: "pushState" | "replaceState", after: () => void): () => void {
  const original = history[name];
  const wrapper = function (this: History, ...args: Parameters<History["pushState"]>): void {
    original.apply(this, args);
    after();
  };
  history[name] = wrapper;
  return () => {
    if (history[name] === wrapper) history[name] = original;
  };
}

/** Installs the error, console and breadcrumb capture (each on unless set to false); returns one uninstaller. */
export function installDiagnostics(
  d: Diagnostics,
  options?: { errors?: boolean; console?: boolean; breadcrumbs?: boolean },
): () => void {
  const undo: Array<() => void> = [];
  if (options?.errors !== false) undo.push(installErrorCapture(d));
  if (options?.console !== false) undo.push(installConsoleCapture(d));
  if (options?.breadcrumbs !== false) undo.push(installBreadcrumbs(d));
  return () => [...undo].reverse().forEach((u) => u());
}
