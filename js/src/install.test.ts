import { createDiagnostics, type Diagnostics } from "./timeline.js";
import { installBreadcrumbs, installConsoleCapture, installDiagnostics, installErrorCapture } from "./install.js";

const AT = "2026-10-16T10:00:00.000Z";
let d: Diagnostics;
const undoers: Array<() => void> = [];

beforeEach(() => {
  d = createDiagnostics({ now: () => new Date(AT) });
});

afterEach(() => {
  undoers.splice(0).reverse().forEach((u) => u());
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
});

describe("installErrorCapture", () => {
  it("a thrown error keeps its first 15 stack lines and a path-only source", () => {
    undoers.push(installErrorCapture(d));
    const err = new Error("boom");
    const lines = [
      "Error: boom",
      ...Array.from({ length: 29 }, (_, i) => `    at f${i} (https://shop.example/_next/static/chunks/app.js:1:${i})`),
    ];
    err.stack = lines.join("\n");

    window.dispatchEvent(
      new ErrorEvent("error", {
        error: err,
        message: "boom",
        filename: "https://shop.example/_next/static/chunks/app.js?v=1",
        lineno: 3,
        colno: 7,
      }),
    );

    expect(d.snapshot()).toEqual([
      {
        type: "error",
        message: "Error: boom",
        source: "/_next/static/chunks/app.js:3:7",
        stack: lines.slice(0, 15).join("\n"),
        at: AT,
      },
    ]);
  });

  it("an unhandled rejection is recorded with its reason", () => {
    undoers.push(installErrorCapture(d));

    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("nope") }));

    const snapshot = d.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ type: "error", message: "Error: nope", source: "unhandledrejection" });
  });
});

describe("installConsoleCapture", () => {
  it("console errors and warnings are recorded and still reach the console", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    undoers.push(installConsoleCapture(d));

    console.error("Zahlung", 42);
    console.warn("slow", true);

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("Zahlung", 42);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("slow", true);
    expect(d.snapshot()).toEqual([
      { type: "console", level: "error", message: "Zahlung 42", at: AT },
      { type: "console", level: "warn", message: "slow true", at: AT },
    ]);
  });

  it("a logged input value is recorded as [input]", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.innerHTML = `<input id="pw">`;
    (document.getElementById("pw") as HTMLInputElement).value = "Slepens-Vards-7";
    undoers.push(installConsoleCapture(d));

    console.error("login failed for", "Slepens-Vards-7");

    const snapshot = d.snapshot();
    expect(snapshot).toEqual([{ type: "console", level: "error", message: "login failed for [input]", at: AT }]);
    expect(JSON.stringify(snapshot)).not.toContain("Slepens-Vards-7");
  });

  it("a failing recorder never stops the console call", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(d, "recordConsole").mockImplementation(() => {
      throw new Error("broken");
    });
    undoers.push(installConsoleCapture(d));

    expect(() => console.error("x")).not.toThrow();
    expect(error).toHaveBeenCalledWith("x");
  });

  it("uninstalling leaves a later console wrapper in place", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const undo = installConsoleCapture(d);
    undoers.push(undo);
    const later = vi.fn();
    console.warn = later;

    undo();

    expect(console.warn).toBe(later);
    expect(console.error).toBe(error);
  });
});

describe("installBreadcrumbs", () => {
  it("routes are recorded after each navigation, path only, without repeats", () => {
    history.replaceState(null, "", "/start");
    undoers.push(installBreadcrumbs(d));

    history.pushState({}, "", "/products/42?token=abc#top");
    history.replaceState(null, "", "/products/42?page=2");
    history.pushState({}, "", "/cart");

    expect(location.pathname).toBe("/cart");
    expect(d.snapshot()).toEqual([
      { type: "route", path: "/start", at: AT },
      { type: "route", path: "/products/42", at: AT },
      { type: "route", path: "/cart", at: AT },
    ]);
  });

  it("a back or forward navigation is recorded", () => {
    const raw = history.replaceState.bind(history);
    undoers.push(installBreadcrumbs(d));

    raw(null, "", "/back");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

    expect(d.snapshot().at(-1)).toMatchObject({ type: "route", path: "/back" });
  });

  it("a click on an input records no label", () => {
    document.body.innerHTML = `<input id="email" aria-label="E-pasts" title="E-pasts">`;
    const input = document.getElementById("email") as HTMLInputElement;
    input.value = "Slepens-Vards-7";
    undoers.push(installBreadcrumbs(d));

    input.click();

    const clicks = d.snapshot().filter((entry) => entry.type === "click");
    expect(clicks).toEqual([{ type: "click", selector: "input#email", label: "", at: AT }]);
    expect(JSON.stringify(d.snapshot())).not.toContain("Slepens-Vards-7");
  });

  it("a click is recorded even when the page stops its propagation", () => {
    document.body.innerHTML = `<button class="btn primary"><span>Pirkt</span></button>`;
    const button = document.querySelector("button") as HTMLButtonElement;
    button.addEventListener("click", (event) => event.stopPropagation());
    const span = document.querySelector("span") as HTMLSpanElement;
    undoers.push(installBreadcrumbs(d));

    span.click();

    expect(d.snapshot()).toContainEqual({ type: "click", selector: "button.btn.primary", label: "Pirkt", at: AT });
  });
});

describe("installDiagnostics", () => {
  it("installs all three by default and removes all three", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.innerHTML = `<button>OK</button>`;
    const button = document.querySelector("button") as HTMLButtonElement;

    const undo = installDiagnostics(d);
    undoers.push(undo);
    expect(console.error).not.toBe(error);

    window.dispatchEvent(new ErrorEvent("error", { message: "kaput" }));
    button.click();
    history.pushState({}, "", "/a");
    expect(d.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "error" }),
        expect.objectContaining({ type: "click" }),
        { type: "route", path: "/a", at: AT },
      ]),
    );

    undo();
    const before = d.snapshot().length;
    expect(console.error).toBe(error);

    window.dispatchEvent(new ErrorEvent("error", { message: "kaput" }));
    button.click();
    history.pushState({}, "", "/b");
    expect(d.snapshot()).toHaveLength(before);
  });

  it("console: false leaves the console untouched", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    undoers.push(installDiagnostics(d, { console: false }));
    expect(console.error).toBe(error);

    console.error("x");
    window.dispatchEvent(new ErrorEvent("error", { message: "kaput" }));

    const snapshot = d.snapshot();
    expect(snapshot.filter((entry) => entry.type === "console")).toEqual([]);
    expect(snapshot.map((entry) => entry.type)).toContain("error");
  });
});
