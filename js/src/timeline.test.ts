import { createDiagnostics, LABEL_LIMIT, type Diagnostics, type RouteEntry, type TimelineEntry } from "./timeline.js";

const T0 = Date.parse("2026-10-16T08:00:00.000Z");
const iso = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
const FAKE_RVS = "rvs_" + "x".repeat(43);
const FAKE_RVL = "rvl_" + "y".repeat(43);
const FAKE_JWT = "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.c2ln";

function ticking(): () => Date {
  let n = 0;
  return () => new Date(T0 + 1000 * n++);
}

function scripted(...seconds: number[]): () => Date {
  let i = 0;
  return () => new Date(T0 + 1000 * seconds[i++]);
}

function byId(id: string): Element {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`missing #${id}`);
  return found;
}

function of<T extends TimelineEntry["type"]>(d: Diagnostics, type: T): Extract<TimelineEntry, { type: T }>[] {
  return d.snapshot().filter((e): e is Extract<TimelineEntry, { type: T }> => e.type === type);
}

let d: Diagnostics;

function api(s: number, p: string): void {
  d.recordApiCall({ method: "GET", url: p, status: s, durationMs: 5 });
}

beforeEach(() => {
  d = createDiagnostics({ now: ticking() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("createDiagnostics", () => {
  it("21 failures keep the newest 20", () => {
    for (let i = 1; i <= 21; i += 1) api(500, "/x/" + i);
    const snapshot = d.snapshot();
    expect(snapshot).toHaveLength(20);
    expect(snapshot.map((e) => e.type)).toEqual(Array(20).fill("api"));
    expect((snapshot[0] as { path: string }).path).toBe("/x/2");
    expect((snapshot[19] as { path: string }).path).toBe("/x/21");
  });

  it("each ring keeps its own newest, so a flood of routes keeps the error", () => {
    d.recordError(new Error("kept"));
    for (let i = 1; i <= 25; i += 1) d.recordConsole("warn", ["w" + i]);
    for (let i = 1; i <= 55; i += 1) d.recordRoute("/r/" + i);
    expect(of(d, "error").map((e) => e.message)).toEqual(["Error: kept"]);
    const consoles = of(d, "console");
    expect(consoles).toHaveLength(20);
    expect(consoles[0].message).toBe("w6");
    const routes = of(d, "route");
    expect(routes).toHaveLength(50);
    expect(routes[0].path).toBe("/r/6");
  });

  it("a network failure or a 400 and up is a problem; a 399 is trail", () => {
    api(0, "/s/0");
    api(400, "/s/400");
    api(503, "/s/503");
    api(399, "/s/399");
    api(200, "/s/200");
    for (let i = 1; i <= 50; i += 1) d.recordRoute("/r/" + i);
    expect(of(d, "api").map((e) => e.path)).toEqual(["/s/0", "/s/400", "/s/503"]);
  });

  it("snapshot sorts by at, ties in record order across rings", () => {
    d = createDiagnostics({ now: scripted(1, 2, 0, 1) });
    d.recordRoute("/a");
    d.recordError("late");
    d.recordConsole("warn", ["first"]);
    api(500, "/b");
    const snapshot = d.snapshot();
    expect(snapshot.map((e) => e.type)).toEqual(["console", "route", "api", "error"]);
    expect(snapshot.map((e) => e.at)).toEqual([iso(0), iso(1), iso(1), iso(2)]);
  });

  it("an API entry holds its seven fields and nothing of the body or headers", () => {
    d.recordApiCall({
      method: "post",
      url: `https://api.example.lv/api/v1/store/review/${FAKE_RVS}?token=abc#frag`,
      status: 201,
      durationMs: 119.6,
      requestId: "req-7",
      body: "{\"email\":\"jane@example.lv\"}",
      headers: { authorization: "Bearer abc" },
    } as never);
    d.recordApiCall({ method: "GET", url: "/x", status: 0, durationMs: 30000.4, requestId: null });
    expect(d.snapshot()).toEqual([
      { type: "api", method: "POST", path: "/api/v1/store/review/:token", status: 201, duration_ms: 120, request_id: "req-7", at: iso(0) },
      { type: "api", method: "GET", path: "/x", status: 0, duration_ms: 30000, request_id: "", at: iso(1) },
    ]);
    const json = JSON.stringify(d.snapshot());
    expect(json).not.toContain("jane@example.lv");
    expect(json).not.toContain("Bearer");
    expect(json).not.toContain("token=abc");
    expect(json).not.toContain(FAKE_RVS);
  });

  it("an error keeps name: message and the first 15 lines of its stack", () => {
    const e = new Error("boom");
    const lines = [
      "Error: boom",
      ...Array.from({ length: 20 }, (_, i) => `    at f${i} (https://shop.example.lv/_next/static/chunks/app.js:1:${i})`),
    ];
    e.stack = lines.join("\n");
    d.recordError(e, "/_next/static/chunks/app.js:1:2");
    expect(d.snapshot()).toEqual([
      {
        type: "error",
        message: "Error: boom",
        source: "/_next/static/chunks/app.js:1:2",
        stack: lines.slice(0, 15).join("\n"),
        at: iso(0),
      },
    ]);
  });

  it("strings and primitives become text; objects are never serialised", () => {
    const values: unknown[] = ["plain", 42, false, null, undefined, { password: "hunter2" }, [1, 2]];
    for (const x of values) d.recordError(x);
    const errors = of(d, "error");
    expect(errors.map((e) => e.message)).toEqual(["plain", "42", "false", "null", "undefined", "[object]", "[object]"]);
    expect(errors.every((e) => e.stack === "" && e.source === "")).toBe(true);
    expect(JSON.stringify(d.snapshot())).not.toContain("hunter2");
  });

  it("console args are joined by a space and the level kept", () => {
    d.recordConsole("warn", ["Saving", 3, "items", new TypeError("bad"), { a: 1 }]);
    expect(d.snapshot()).toEqual([
      { type: "console", level: "warn", message: "Saving 3 items TypeError: bad [object]", at: iso(0) },
    ]);
  });

  it("console.error with a field's typed value records [input], tokens redacted", () => {
    document.body.innerHTML = '<input id="p" type="password"><textarea id="t"></textarea>';
    (byId("p") as HTMLInputElement).value = "hunter2-Riga";
    (byId("t") as HTMLTextAreaElement).value = "Brīvības iela 7";
    d.recordConsole("error", [
      "login failed for hunter2-Riga at Brīvības iela 7",
      "Bearer abc.def",
      FAKE_RVS,
      FAKE_JWT,
      "jane@example.lv",
    ]);
    const snapshot = d.snapshot();
    expect((snapshot[0] as { message: string }).message).toBe(
      "login failed for [input] at [input] Bearer [redacted] [token] [token] [email]",
    );
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain("hunter2-Riga");
    expect(json).not.toContain("Brīvības");
  });

  it("an error's message and stack lose a field's typed value", () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    (byId("t") as HTMLTextAreaElement).value = "Brīvības iela 7";
    const e = new Error("save failed: Brīvības iela 7");
    e.stack = "Error: save failed: Brīvības iela 7\n    at save (https://shop.example.lv/app.js:1:2)";
    d.recordError(e);
    expect(d.snapshot()).toEqual([
      {
        type: "error",
        message: "Error: save failed: [input]",
        source: "",
        stack: "Error: save failed: [input]\n    at save (https://shop.example.lv/app.js:1:2)",
        at: iso(0),
      },
    ]);
  });

  it("with no document the store still records", () => {
    vi.stubGlobal("document", undefined);
    expect(() => {
      d.recordConsole("error", ["still recorded"]);
      d.recordError(new Error("x"));
    }).not.toThrow();
    expect(d.snapshot().map((e) => (e as { message: string }).message)).toEqual(["still recorded", "Error: x"]);
  });

  it("a click records the clickable ancestor and its collapsed text", () => {
    document.body.innerHTML =
      '<nav><a id="cart" href="/grozs"><span id="s">Grozs\n   (3)</span></a><button class="btn primary big" type="button"><svg id="i"></svg> Pievienot grozam</button></nav>';
    d.recordClick(byId("s"));
    d.recordClick(byId("i"));
    expect(d.snapshot()).toEqual([
      { type: "click", selector: "a#cart", label: "Grozs (3)", at: iso(0) },
      { type: "click", selector: "button.btn.primary", label: "Pievienot grozam", at: iso(1) },
    ]);
  });

  it("the label prefers aria-label, then title, and is cut to 60", () => {
    document.body.innerHTML =
      '<button id="a" aria-label="Aizvērt dialogu" title="t">×</button><div id="b" role="button" title="Filtrēt">ikona</div><button id="c">' +
      "Ļoti garš teksts ".repeat(10) +
      "</button>";
    d.recordClick(byId("a"));
    d.recordClick(byId("b"));
    d.recordClick(byId("c"));
    const clicks = of(d, "click");
    expect(clicks[0].label).toBe("Aizvērt dialogu");
    expect(clicks[1].label).toBe("Filtrēt");
    const long = clicks[2].label;
    expect(Array.from(long).length).toBe(LABEL_LIMIT);
    expect(long.startsWith("Ļoti garš teksts Ļoti")).toBe(true);
    expect(long.endsWith("…")).toBe(true);
  });

  it("a click on a field records no label and reads no value", () => {
    document.body.innerHTML =
      '<input id="q" class="search"><textarea id="note"></textarea><select id="city"><option>Rīga</option></select>';
    (byId("note") as HTMLTextAreaElement).defaultValue = "typed note";
    let reads = 0;
    for (const id of ["q", "note"]) {
      Object.defineProperty(byId(id), "value", {
        configurable: true,
        get() {
          reads += 1;
          return "typed";
        },
      });
    }
    d.recordClick(byId("q"));
    d.recordClick(byId("note"));
    d.recordClick(byId("city"));
    const clicks = of(d, "click");
    expect(clicks.map((e) => e.selector)).toEqual(["input#q", "textarea#note", "select#city"]);
    expect(clicks.map((e) => e.label)).toEqual(["", "", ""]);
    expect(reads).toBe(0);
  });

  it("nothing inside an editable or private area is labelled", () => {
    document.body.innerHTML =
      '<div contenteditable="true"><p id="draft">Mans melnraksts</p></div><div data-diagnostics-private><button id="who">Jānis Bērziņš</button></div><div contenteditable="false"><button id="ok">Labi</button></div>';
    d.recordClick(byId("draft"));
    d.recordClick(byId("who"));
    d.recordClick(byId("ok"));
    const clicks = of(d, "click");
    expect(clicks.map((e) => e.selector)).toEqual(["p#draft", "button#who", "button#ok"]);
    expect(clicks.map((e) => e.label)).toEqual(["", "", "Labi"]);
  });

  it("a label skips the text of a field or private part inside it", () => {
    document.body.innerHTML =
      '<label id="l">Piezīmes <textarea id="n"></textarea></label><button id="b">Meklēt <span data-diagnostics-private>jane</span></button>';
    (byId("n") as HTMLTextAreaElement).defaultValue = "typed note";
    d.recordClick(byId("l"));
    d.recordClick(byId("b"));
    expect(of(d, "click").map((e) => e.label)).toEqual(["Piezīmes", "Meklēt"]);
  });

  it("a click on the report launcher is not recorded", () => {
    document.body.innerHTML = '<button data-bugreport-launcher><span id="s">Ziņot par kļūdu</span></button>';
    d.recordClick(byId("s"));
    expect(d.snapshot()).toEqual([]);
  });

  it("a route is its scrubbed path only", () => {
    d.recordRoute(`https://shop.example.lv/review?next=/x#${FAKE_RVL}`);
    d.recordRoute("/klients/profils/?token=abc");
    d.recordRoute(`/r/${FAKE_RVS}/x`);
    expect(of(d, "route").map((e) => e.path)).toEqual(["/review", "/klients/profils/", "/r/:token/x"]);
    const json = JSON.stringify(d.snapshot());
    expect(json).not.toContain(FAKE_RVL);
    expect(json).not.toContain(FAKE_RVS);
    expect(json).not.toContain("token=abc");
  });

  it("snapshot hands out copies", () => {
    d.recordRoute("/a");
    (d.snapshot()[0] as RouteEntry).path = "/changed";
    expect((d.snapshot()[0] as RouteEntry).path).toBe("/a");
  });

  it("clear empties every ring", () => {
    api(500, "/p");
    d.recordConsole("warn", ["c"]);
    d.recordRoute("/t");
    d.clear();
    expect(d.snapshot()).toEqual([]);
    d.recordRoute("/after");
    const snapshot = d.snapshot();
    expect(snapshot).toHaveLength(1);
    expect((snapshot[0] as RouteEntry).path).toBe("/after");
  });
});

describe("persist", () => {
  const KEY = "bugkit:diagnostics:v1";
  let seconds = 0;
  const clock = () => new Date(T0 + seconds * 1000);
  const paths = (timeline: Diagnostics) => timeline.snapshot().map((e) => (e as { path: string }).path);

  beforeEach(() => {
    seconds = 0;
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("a persisted timeline comes back in the next instance, in order", () => {
    const first = createDiagnostics({ now: clock, persist: {} });
    first.recordRoute("/orders");
    seconds = 1;
    first.recordApiCall({ method: "POST", url: "/api/orders", status: 500, durationMs: 12 });
    seconds = 2;
    first.recordConsole("error", ["save failed"]);
    seconds = 3;
    first.recordApiCall({ method: "GET", url: "/api/orders", status: 200, durationMs: 4 });
    seconds = 10;

    const next = createDiagnostics({ now: clock, persist: {} });

    expect(next.snapshot()).toHaveLength(4);
    expect(next.snapshot()).toEqual(first.snapshot());
  });

  it("entries older than maxAgeMs stay behind", () => {
    const first = createDiagnostics({ now: clock, persist: { maxAgeMs: 60_000 } });
    first.recordRoute("/old");
    seconds = 100;
    first.recordRoute("/new");
    seconds = 130;

    expect(paths(createDiagnostics({ now: clock, persist: { maxAgeMs: 60_000 } }))).toEqual(["/new"]);
  });

  it("by default an entry comes back for 30 minutes", () => {
    createDiagnostics({ now: clock, persist: {} }).recordRoute("/a");

    seconds = 30 * 60;
    expect(paths(createDiagnostics({ now: clock, persist: {} }))).toEqual(["/a"]);
    seconds = 30 * 60 + 1;
    expect(paths(createDiagnostics({ now: clock, persist: {} }))).toEqual([]);
  });

  it("restored entries keep their ring's limit", () => {
    const first = createDiagnostics({ now: clock, persist: {} });
    for (let i = 1; i <= 20; i += 1) first.recordApiCall({ method: "GET", url: "/x/" + i, status: 500, durationMs: 1 });
    seconds = 1;

    const next = createDiagnostics({ now: clock, persist: {} });
    next.recordApiCall({ method: "GET", url: "/x/21", status: 500, durationMs: 1 });

    const kept = paths(next);
    expect(kept).toHaveLength(20);
    expect(kept[0]).toBe("/x/2");
    expect(kept[19]).toBe("/x/21");
  });

  it("each key keeps its own timeline", () => {
    createDiagnostics({ now: clock, persist: { key: "one" } }).recordRoute("/one");

    expect(paths(createDiagnostics({ now: clock, persist: { key: "two" } }))).toEqual([]);
    expect(paths(createDiagnostics({ now: clock, persist: { key: "one" } }))).toEqual(["/one"]);
  });

  it("a stored value that is not a timeline is skipped entry by entry", () => {
    sessionStorage.setItem(KEY, "not json");
    expect(createDiagnostics({ now: clock, persist: {} }).snapshot()).toEqual([]);

    sessionStorage.setItem(
      KEY,
      JSON.stringify([5, null, { type: "nope", at: iso(0) }, { type: "route", path: "/no-time" }, { type: "route", path: "/kept", at: iso(0) }]),
    );
    expect(createDiagnostics({ now: clock, persist: {} }).snapshot()).toEqual([{ type: "route", path: "/kept", at: iso(0) }]);

    sessionStorage.setItem(KEY, JSON.stringify({ type: "route", path: "/object", at: iso(0) }));
    expect(createDiagnostics({ now: clock, persist: {} }).snapshot()).toEqual([]);
  });

  it("clear also forgets the stored timeline", () => {
    const first = createDiagnostics({ now: clock, persist: {} });
    first.recordRoute("/a");
    first.clear();

    expect(createDiagnostics({ now: clock, persist: {} }).snapshot()).toEqual([]);
  });

  it("without persist nothing is stored or restored", () => {
    createDiagnostics({ now: clock }).recordRoute("/a");
    expect(sessionStorage.length).toBe(0);

    createDiagnostics({ now: clock, persist: {} }).recordRoute("/b");
    expect(createDiagnostics({ now: clock }).snapshot()).toEqual([]);
  });

  it("a full, blocked or missing storage never stops the recording", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const blocked = createDiagnostics({ now: clock, persist: {} });
    blocked.recordRoute("/a");
    blocked.clear();
    blocked.recordRoute("/b");
    expect(paths(blocked)).toEqual(["/b"]);

    vi.restoreAllMocks();
    vi.stubGlobal("sessionStorage", undefined);
    const missing = createDiagnostics({ now: clock, persist: {} });
    missing.recordRoute("/c");
    expect(paths(missing)).toEqual(["/c"]);
  });
});
