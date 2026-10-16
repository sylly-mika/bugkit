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

/** Wraps a fetch so that each call records its method, path, status, duration and request id. */
export function withDiagnostics(fetcher: typeof fetch, d: Diagnostics): typeof fetch {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { method, url } = requestLine(input, init);
    const started = performance.now();
    const record = (status: number, requestId: string | null) =>
      quietly(() =>
        d.recordApiCall({ method, url, status, durationMs: Math.round(performance.now() - started), requestId }),
      );
    let response: Response;
    try {
      response = await fetcher(input, init);
    } catch (error) {
      record(0, null);
      throw error;
    }
    record(response.status, response.headers.get("x-request-id"));
    return response;
  };
  return wrapped;
}

function requestLine(input: RequestInfo | URL, init?: RequestInit): { method: string; url: string } {
  if (typeof input === "string") return { method: init?.method ?? "GET", url: input };
  if (input instanceof URL) return { method: init?.method ?? "GET", url: input.href };
  return { method: init?.method ?? input.method, url: input.url };
}
