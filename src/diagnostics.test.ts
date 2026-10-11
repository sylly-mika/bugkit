import { createDiagnosticsBuffer, installErrorListeners } from "./diagnostics.js";

function failure(n: number) {
  return { method: "GET", path: `/api/v1/thing/${n}`, status: 500, request_id: `r${n}` };
}

describe("createDiagnosticsBuffer", () => {
  it("keeps the last 20 entries and evicts the oldest first", () => {
    const buffer = createDiagnosticsBuffer();

    for (let i = 1; i <= 25; i += 1) {
      buffer.recordApiFailure(failure(i));
    }

    const entries = buffer.entries();
    expect(entries).toHaveLength(20);
    expect(entries[0]).toMatchObject({ path: "/api/v1/thing/6" });
    expect(entries[19]).toMatchObject({ path: "/api/v1/thing/25" });
  });

  it("interleaves both entry kinds in insertion order", () => {
    const buffer = createDiagnosticsBuffer();

    buffer.recordApiFailure(failure(1));
    buffer.recordError({ message: "boom", source: "app.js:12" });
    buffer.recordApiFailure(failure(2));

    expect(buffer.entries().map((e) => ("status" in e ? e.path : e.message))).toEqual([
      "/api/v1/thing/1",
      "boom",
      "/api/v1/thing/2",
    ]);
  });

  // The guard that matters: this buffer is posted to a GitHub issue, and a
  // request body in this app carries customer data. A future edit that starts
  // spreading its input has to fail here.
  it("stores exactly the five permitted fields on an API entry", () => {
    const buffer = createDiagnosticsBuffer();

    buffer.recordApiFailure({
      ...failure(1),
      body: { email: "customer@example.com" },
      headers: { authorization: "Bearer secret" },
    } as never);

    expect(Object.keys(buffer.entries()[0]).sort()).toEqual([
      "at",
      "method",
      "path",
      "request_id",
      "status",
    ]);
  });

  // 20 entries of a minified bundle's stack-in-the-message would outgrow the
  // 32 KiB the backend allows the diagnostics part of the issue body.
  it("truncates an error message to 500 characters", () => {
    const buffer = createDiagnosticsBuffer();

    buffer.recordError({ message: "x".repeat(900), source: "app.js:1" });

    const entry = buffer.entries()[0] as { message: string };
    expect(entry.message).toHaveLength(500);
  });

  it("empties on clear", () => {
    const buffer = createDiagnosticsBuffer();

    buffer.recordApiFailure(failure(1));
    buffer.clear();

    expect(buffer.entries()).toEqual([]);
  });

  it("honours a smaller capacity", () => {
    const buffer = createDiagnosticsBuffer(2);

    buffer.recordApiFailure(failure(1));
    buffer.recordApiFailure(failure(2));
    buffer.recordApiFailure(failure(3));

    expect(buffer.entries().map((e) => ("status" in e ? e.path : ""))).toEqual([
      "/api/v1/thing/2",
      "/api/v1/thing/3",
    ]);
  });
});

describe("installErrorListeners", () => {
  it("records window errors and unhandled rejections, and stops on cleanup", () => {
    const buffer = createDiagnosticsBuffer();
    const uninstall = installErrorListeners(buffer);

    window.dispatchEvent(
      new ErrorEvent("error", { message: "kaput", filename: "chunk.js", lineno: 7 }),
    );
    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason: new Error("nope") }),
    );

    expect(buffer.entries().map((e) => ("status" in e ? "" : e.message))).toEqual([
      "kaput",
      "nope",
    ]);
    expect(buffer.entries()[0]).toMatchObject({ source: "chunk.js:7" });
    expect(buffer.entries()[1]).toMatchObject({ source: "unhandledrejection" });

    uninstall();
    window.dispatchEvent(new ErrorEvent("error", { message: "after" }));
    expect(buffer.entries()).toHaveLength(2);
  });

  // A promise can reject with anything at all, and only an Error carries a
  // message — the other two branches are what a bare `throw "nope"` and a
  // rejected fetch of a non-Error value land in.
  it("reads a string rejection reason and names the rest", () => {
    const buffer = createDiagnosticsBuffer();
    const uninstall = installErrorListeners(buffer);

    for (const reason of ["plain string", null, { code: 42 }]) {
      window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason }));
    }

    uninstall();

    expect(buffer.entries().map((e) => ("status" in e ? "" : e.message))).toEqual([
      "plain string",
      "Unhandled rejection",
      "Unhandled rejection",
    ]);
  });
});
