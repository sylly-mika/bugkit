import { toPng } from "html-to-image";
import { capturePage } from "./capture.js";

vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

const toPngMock = vi.mocked(toPng);

describe("capturePage", () => {
  beforeEach(() => {
    toPngMock.mockReset();
    document.body.innerHTML = "";
  });

  it("returns the data URL when html-to-image resolves", async () => {
    toPngMock.mockResolvedValue("data:image/png;base64,AAAA");

    await expect(capturePage()).resolves.toEqual({ ok: true, dataUrl: "data:image/png;base64,AAAA" });
  });

  // The cap is checked before starting, never raced: toPng clones the tree
  // synchronously, so on a huge table the timeout below never gets a turn.
  it("skips capture entirely when the node count is over the cap", async () => {
    document.body.innerHTML = "<div><span></span><span></span><span></span></div>";

    await expect(capturePage({ nodeCap: 2 })).resolves.toEqual({
      ok: false,
      reason: "too-many-nodes",
    });
    expect(toPngMock).not.toHaveBeenCalled();
  });

  it("abandons a capture that never resolves", async () => {
    vi.useFakeTimers();
    toPngMock.mockReturnValue(new Promise(() => {}));

    const pending = capturePage({ timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({ ok: false, reason: "timed-out" });
    vi.useRealTimers();
  });

  it("reports a rejected capture as a failure rather than throwing", async () => {
    toPngMock.mockRejectedValue(new Error("tainted canvas"));

    await expect(capturePage()).resolves.toEqual({ ok: false, reason: "failed" });
  });

  // WHY: jsdom keeps scrollTop at 0, so the offsets are set on the elements.
  it("shows a scrolled inner panel scrolled", async () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    const c = document.createElement("div");
    document.body.append(a, b, c);
    Object.defineProperty(a, "scrollTop", { value: 120, configurable: true });
    Object.defineProperty(c, "scrollLeft", { value: 40, configurable: true });

    let markedDuringCapture: (string | null)[] = [];
    toPngMock.mockImplementation(() => {
      markedDuringCapture = [a, b, c].map((el) => el.getAttribute("data-bugkit-scroll"));
      return Promise.resolve("data:image/png;base64,AAAA");
    });

    await capturePage();

    expect(markedDuringCapture).toEqual(["0", null, "1"]);
    expect(toPngMock.mock.calls[0][1]?.fontEmbedCSS).toBe(
      '[data-bugkit-scroll="0"] > * { translate: 0px -120px !important; }\n' +
        '[data-bugkit-scroll="1"] > * { translate: -40px 0px !important; }',
    );
    expect(document.querySelector("[data-bugkit-scroll]")).toBeNull();
  });

  it("unmarks the page when the capture fails", async () => {
    const a = document.createElement("div");
    document.body.append(a);
    Object.defineProperty(a, "scrollTop", { value: 120, configurable: true });

    let markedDuringCapture: string | null = null;
    toPngMock.mockImplementation(() => {
      markedDuringCapture = a.getAttribute("data-bugkit-scroll");
      return Promise.reject(new Error("tainted canvas"));
    });

    await expect(capturePage()).resolves.toEqual({ ok: false, reason: "failed" });
    expect(markedDuringCapture).toBe("0");
    expect(document.querySelector("[data-bugkit-scroll]")).toBeNull();
  });

  it("leaves an unscrolled page's capture as it was", async () => {
    document.body.append(document.createElement("div"));
    toPngMock.mockResolvedValue("data:image/png;base64,AAAA");

    await capturePage();

    expect("fontEmbedCSS" in toPngMock.mock.calls[0][1]!).toBe(false);
  });

  it("renders at 1x, skips the font pass and leaves cache-busting off", async () => {
    toPngMock.mockResolvedValue("data:image/png;base64,AAAA");
    await capturePage();

    // cacheBust would append `?<timestamp>` to blob: URLs too, and a blob URL
    // with a query string does not resolve — see capture.ts.
    expect(toPngMock.mock.calls[0][1]).toMatchObject({
      pixelRatio: 1,
      skipFonts: true,
      cacheBust: false,
    });
  });

  // See viewportFraming in capture.ts: a viewport-sized picture of a
  // document-sized clone pulled up by the scroll offset, through margins.
  it("frames the page as the viewport the reporter was looking at", async () => {
    toPngMock.mockResolvedValue("data:image/png;base64,AAAA");
    const scroll = { x: 40, y: 1200 };
    const viewport = { width: 1280, height: 720 };
    const originals = {
      scrollX: Object.getOwnPropertyDescriptor(window, "scrollX"),
      scrollY: Object.getOwnPropertyDescriptor(window, "scrollY"),
    };
    Object.defineProperty(window, "scrollX", { value: scroll.x, configurable: true });
    Object.defineProperty(window, "scrollY", { value: scroll.y, configurable: true });
    Object.defineProperty(document.body, "scrollHeight", { value: 5000, configurable: true });
    Object.defineProperty(document.body, "scrollWidth", { value: 300, configurable: true });
    // The document element's client box, not window.innerWidth: the latter
    // counts the scrollbars, which the page the reporter saw did not have.
    Object.defineProperty(document.documentElement, "clientWidth", { value: viewport.width, configurable: true });
    Object.defineProperty(document.documentElement, "clientHeight", { value: viewport.height, configurable: true });
    try {
      await capturePage();
      expect(toPngMock.mock.calls[0][1]).toMatchObject({
        width: viewport.width,
        height: viewport.height,
        style: {
          width: `${viewport.width}px`,
          height: "5000px",
          marginTop: "-1200px",
          marginLeft: "-40px",
        },
      });
      expect(toPngMock.mock.calls[0][1]?.style?.transform).toBeUndefined();
    } finally {
      for (const [key, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(window, key, descriptor);
        else delete (window as unknown as Record<string, unknown>)[key];
      }
      for (const key of ["scrollHeight", "scrollWidth"]) {
        delete (document.body as unknown as Record<string, unknown>)[key];
      }
      for (const key of ["clientWidth", "clientHeight"]) {
        delete (document.documentElement as unknown as Record<string, unknown>)[key];
      }
    }
  });

  it("photographs a caller's own root whole, unframed", async () => {
    toPngMock.mockResolvedValue("data:image/png;base64,AAAA");
    const root = document.createElement("section");
    document.body.appendChild(root);
    try {
      await capturePage({ root });
      const options = toPngMock.mock.calls[0][1]!;
      expect(options.width).toBeUndefined();
      expect(options.height).toBeUndefined();
      expect(options.style).toBeUndefined();
    } finally {
      root.remove();
    }
  });

  it("filters out images from an origin that is not allowed", async () => {
    toPngMock.mockResolvedValue("data:image/png;base64,AAAA");
    await capturePage({ allowedImageOrigins: ["https://uploads.example"] });

    const filter = toPngMock.mock.calls[0][1]?.filter;
    expect(filter).toBeDefined();

    const sameOrigin = document.createElement("img");
    sameOrigin.src = `${window.location.origin}/logo.png`;
    const allowed = document.createElement("img");
    allowed.src = "https://uploads.example/plan.png";
    const tile = document.createElement("img");
    tile.src = "https://tile.openstreetmap.org/1/2/3.png";
    const notAnImage = document.createElement("div");

    expect(filter!(sameOrigin)).toBe(true);
    expect(filter!(allowed)).toBe(true);
    expect(filter!(tile)).toBe(false);
    expect(filter!(notAnImage)).toBe(true);
  });

  // It is fixed over the page and says "Taking a screenshot…" while the capture
  // runs, so left in it lands in the middle of every report.
  it("drops the launcher from its own screenshot", async () => {
    toPngMock.mockResolvedValue("data:image/png;base64,AAAA");
    await capturePage();

    const filter = toPngMock.mock.calls[0][1]?.filter;
    const launcher = document.createElement("button");
    launcher.setAttribute("data-bugreport-launcher", "");

    expect(filter!(launcher)).toBe(false);
  });
});
