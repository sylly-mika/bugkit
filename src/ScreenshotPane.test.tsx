import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultLabels } from "./labels.js";
import { ScreenshotPane, canvasToBlob, type ScreenshotPaneHandle } from "./ScreenshotPane.js";

type Call = { name: string; args: unknown[]; fillStyle: string };

let calls: Call[] = [];

class FakeImage {
  naturalWidth = 800;
  naturalHeight = 600;
  onload: (() => void) | null = null;
  private current = "";

  set src(value: string) {
    this.current = value;
    queueMicrotask(() => this.onload?.());
  }

  get src() {
    return this.current;
  }
}

function recorder(): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { fillStyle: "#000000", strokeStyle: "#000000" };
  return new Proxy(state, {
    get(target, name: string) {
      if (name in target) return target[name];
      return (...args: unknown[]) => {
        calls.push({ name, args, fillStyle: String(target.fillStyle) });
        return name === "measureText" ? { width: 8 * String(args[0]).length } : undefined;
      };
    },
    set(target, name: string, value) {
      target[name] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function lastPaint(): Call[] {
  const start = calls.map((call) => call.name).lastIndexOf("clearRect");
  return calls.slice(start);
}

function drag(canvas: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(canvas, { pointerId: 1, clientX: to[0], clientY: to[1] });
}

async function renderPane() {
  const ref = createRef<ScreenshotPaneHandle>();
  const onToggleExpanded = vi.fn();
  render(
    <ScreenshotPane
      ref={ref}
      dataUrl="data:image/png;base64,AAAA"
      labels={defaultLabels}
      onImageChosen={vi.fn()}
      expanded={false}
      onToggleExpanded={onToggleExpanded}
    />,
  );
  const canvas = screen.getByRole("img", { name: defaultLabels.screenshotTitle }) as HTMLCanvasElement;
  canvas.setPointerCapture = () => {};
  await waitFor(() => expect(canvas.width).toBe(800));
  return { ref, canvas, onToggleExpanded, user: userEvent.setup() };
}

function tool(name: string) {
  return screen.getByRole("button", { name });
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal("Image", FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => recorder()) as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback) {
    callback(new Blob(["png"], { type: "image/png" }));
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect());
  Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLCanvasElement) {
      return this.width;
    },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLCanvasElement) {
      return this.height;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fakeCanvas(toBlob: HTMLCanvasElement["toBlob"]): HTMLCanvasElement {
  return { toBlob } as HTMLCanvasElement;
}

// jsdom implements no canvas at all, so the export is exercised through its own
// seam rather than through a rendered pane. What the editor really produces is
// verified in a real browser by the walk.
describe("canvasToBlob", () => {
  it("resolves the blob the canvas hands back", async () => {
    const blob = new Blob(["png"], { type: "image/png" });

    await expect(canvasToBlob(fakeCanvas((callback) => callback(blob)))).resolves.toBe(blob);
  });

  it("resolves null when the canvas cannot produce one", async () => {
    await expect(canvasToBlob(fakeCanvas((callback) => callback(null)))).resolves.toBeNull();
  });

  // A tainted canvas throws SecurityError from inside the promise executor,
  // which becomes a rejection rather than something a try/catch around the
  // constructor would ever see. The dialog reads null as "no screenshot" and
  // still sends the report; a rejection would strand it on "sending".
  it("resolves null when the export throws", async () => {
    await expect(
      canvasToBlob(
        fakeCanvas(() => {
          throw new Error("tainted canvas");
        }),
      ),
    ).resolves.toBeNull();
  });
});

describe("the screenshot pane", () => {
  it("offers the toolbar in the mockup's order", async () => {
    const { user } = await renderPane();
    const buttons = within(screen.getByRole("toolbar")).getAllByRole("button");

    expect(buttons.map((button) => button.textContent)).toEqual([
      defaultLabels.toolArrow,
      defaultLabels.toolRect,
      defaultLabels.toolFreehand,
      defaultLabels.toolText,
      defaultLabels.toolRedact,
      defaultLabels.undo,
      defaultLabels.redo,
      defaultLabels.zoomOut,
      defaultLabels.zoomIn,
      defaultLabels.fit,
      defaultLabels.crop,
      defaultLabels.replace,
      defaultLabels.enterFullscreen,
    ]);
    expect(tool(defaultLabels.undo)).toBeDisabled();
    expect(tool(defaultLabels.redo)).toBeDisabled();

    const upload = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    await user.click(tool(defaultLabels.replace));
    expect(upload).toHaveBeenCalled();
  });

  it("undoes and redoes steps, and a new step clears redo", async () => {
    const { user, canvas } = await renderPane();
    await user.click(tool(defaultLabels.toolRect));

    drag(canvas, [10, 10], [60, 40]);
    expect(tool(defaultLabels.undo)).toBeEnabled();

    await user.click(tool(defaultLabels.undo));
    expect(tool(defaultLabels.redo)).toBeEnabled();
    expect(tool(defaultLabels.undo)).toBeDisabled();

    await user.click(tool(defaultLabels.redo));
    expect(tool(defaultLabels.undo)).toBeEnabled();
    expect(tool(defaultLabels.redo)).toBeDisabled();

    await user.click(tool(defaultLabels.undo));
    drag(canvas, [5, 5], [20, 20]);
    expect(tool(defaultLabels.redo)).toBeDisabled();
  });

  it("burns a redaction into the exported image", async () => {
    const { ref, canvas, user } = await renderPane();
    await user.click(tool(defaultLabels.toolRedact));
    drag(canvas, [10, 10], [60, 40]);

    await ref.current!.toBlob();
    const paint = lastPaint();
    const drawn = paint.findIndex((call) => call.name === "drawImage");
    const fill = paint.findIndex(
      (call) => call.name === "fillRect" && call.args.join() === "10,10,50,30",
    );

    expect(fill).toBeGreaterThan(drawn);
    expect(paint[fill].fillStyle).toBe("#000000");
  });

  it("crops the bitmap that is sent, and undo restores it", async () => {
    const { ref, canvas, user } = await renderPane();
    await user.click(tool(defaultLabels.crop));
    drag(canvas, [100, 50], [300, 150]);

    await waitFor(() => expect(canvas.width).toBe(200));
    expect(canvas.height).toBe(100);

    await user.click(tool(defaultLabels.toolRect));
    drag(canvas, [0, 0], [40, 30]);
    await waitFor(() =>
      expect(calls.some((call) => call.name === "strokeRect" && call.args.slice(0, 2).join() === "100,50")).toBe(true),
    );

    await ref.current!.toBlob();
    expect(lastPaint().some((call) => call.name === "translate" && call.args.join() === "-100,-50")).toBe(true);

    await user.click(tool(defaultLabels.undo));
    await user.click(tool(defaultLabels.undo));
    await waitFor(() => expect(canvas.width).toBe(800));
    expect(canvas.height).toBe(600);

    await user.click(tool(defaultLabels.crop));
    drag(canvas, [10, 10], [15, 15]);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(canvas.width).toBe(800);
  });

  it("shows the selection while a crop drag is in progress", async () => {
    const { canvas, user } = await renderPane();
    await user.click(tool(defaultLabels.crop));
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 300, clientY: 150 });

    await waitFor(() =>
      expect(lastPaint().some((call) => call.name === "strokeRect" && call.args.join() === "100,50,200,100")).toBe(true),
    );
    const paint = lastPaint();
    const dimmed = paint.filter((call) => call.name === "fillRect");
    expect(dimmed.map((call) => call.args.join())).toEqual(["0,0,800,50", "0,150,800,450", "0,50,100,100", "300,50,500,100"]);
    expect(dimmed.every((call) => call.fillStyle.startsWith("rgba"))).toBe(true);
    expect(paint.some((call) => call.name === "setLineDash")).toBe(true);
    expect(paint.some((call) => call.name === "fillText" && call.args[0] === "200 × 100")).toBe(true);
  });

  it("shows a selection under the minimum size while dragging, and does not commit it", async () => {
    const { canvas, user } = await renderPane();
    await user.click(tool(defaultLabels.crop));
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 15, clientY: 15 });

    await waitFor(() =>
      expect(lastPaint().some((call) => call.name === "fillText" && call.args[0] === "5 × 5")).toBe(true),
    );
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 15, clientY: 15 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(canvas.width).toBe(800);
  });

  it("keeps the selection out of the export after a crop", async () => {
    const { ref, canvas, user } = await renderPane();
    await user.click(tool(defaultLabels.crop));
    drag(canvas, [100, 50], [300, 150]);
    await waitFor(() => expect(canvas.width).toBe(200));

    await ref.current!.toBlob();
    const names = lastPaint().map((call) => call.name);
    expect(names).toContain("drawImage");
    expect(names).not.toContain("fillRect");
    expect(names).not.toContain("strokeRect");
    expect(names).not.toContain("setLineDash");
    expect(names).not.toContain("fillText");
  });

  it("writes text onto the image, and Escape drops only the text", async () => {
    const { ref, canvas, user } = await renderPane();
    await user.click(tool(defaultLabels.toolText));
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 20, clientY: 30 });

    const input = screen.getByRole("textbox", { name: defaultLabels.textInputLabel });
    expect(input).toHaveFocus();
    expect(input).toHaveStyle({ position: "absolute" });
    expect(document.querySelector('[data-bugkit="canvas-stage"]')).toHaveStyle({ position: "relative" });
    await user.type(input, "Here{Enter}");

    await ref.current!.toBlob();
    expect(lastPaint().some((call) => call.name === "fillText" && call.args.join() === "Here,20,30")).toBe(true);

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 40, clientY: 40 });
    await user.type(screen.getByRole("textbox", { name: defaultLabels.textInputLabel }), "x");
    let dropped = false;
    act(() => {
      dropped = ref.current!.cancelText();
    });

    expect(dropped).toBe(true);
    expect(screen.queryByRole("textbox", { name: defaultLabels.textInputLabel })).toBeNull();
  });

  it("zooms in steps and back to fit without touching the bitmap", async () => {
    const { canvas, user } = await renderPane();
    expect(screen.getByText("100 %")).toBeInTheDocument();

    await user.click(tool(defaultLabels.zoomOut));
    expect(screen.getByText("75 %")).toBeInTheDocument();
    expect(canvas.style.width).toBe("600px");

    await user.click(tool(defaultLabels.zoomIn));
    await user.click(tool(defaultLabels.zoomIn));
    expect(screen.getByText("125 %")).toBeInTheDocument();
    expect(canvas.style.width).toBe("1000px");

    for (let step = 0; step < 6; step += 1) {
      await user.click(tool(defaultLabels.zoomOut));
    }
    expect(screen.getByText("25 %")).toBeInTheDocument();
    expect(tool(defaultLabels.zoomOut)).toBeDisabled();

    await user.click(tool(defaultLabels.fit));
    expect(screen.getByText("100 %")).toBeInTheDocument();
    expect(canvas.style.width).toBe("");
    expect(canvas.width).toBe(800);
  });
});
