import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultLabels } from "./labels.js";
import { ScreenshotEditor, type ScreenshotEditorHandle } from "./ScreenshotEditor.js";

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

const IMAGE = "data:image/png;base64,AAAA";

async function renderEditor(props: { classNames?: Record<string, string>; nonce?: string } = {}) {
  const ref = createRef<ScreenshotEditorHandle>();
  const spy = vi.fn();
  const view = render(
    <ScreenshotEditor ref={ref} image={IMAGE} onMarkupChange={spy} {...props} />,
  );
  const canvas = screen.getByRole("img", { name: defaultLabels.screenshotTitle }) as HTMLCanvasElement;
  canvas.setPointerCapture = () => {};
  await waitFor(() => expect(canvas.width).toBe(800));
  return { ref, canvas, spy, view, user: userEvent.setup() };
}

function tool(name: string) {
  return screen.getByRole("button", { name });
}

function root(): HTMLElement {
  return document.querySelector('[data-bugkit="editor"]') as HTMLElement;
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

describe("the screenshot editor", () => {
  it("offers the dialog's tools without Replace", async () => {
    await renderEditor();

    expect(within(screen.getByRole("toolbar")).getAllByRole("button").map((button) => button.textContent)).toEqual([
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
      defaultLabels.enterFullscreen,
    ]);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("hands back the marked-up PNG", async () => {
    const { ref, canvas, user } = await renderEditor();
    await user.click(tool(defaultLabels.toolRect));
    drag(canvas, [10, 10], [60, 60]);

    const blob = await ref.current!.toBlob();

    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.type).toBe("image/png");
    expect(lastPaint().some((call) => call.name === "strokeRect")).toBe(true);
  });

  it("reports markup, undo and redo", async () => {
    const { canvas, spy, user } = await renderEditor();
    await user.click(tool(defaultLabels.toolRect));
    drag(canvas, [10, 10], [60, 60]);

    expect(spy).toHaveBeenLastCalledWith(true);
    expect(tool(defaultLabels.undo)).toBeEnabled();

    await user.click(tool(defaultLabels.undo));

    expect(spy).toHaveBeenLastCalledWith(false);
    expect(tool(defaultLabels.redo)).toBeEnabled();
  });

  it("toggles full screen on its own", async () => {
    const { user } = await renderEditor();

    await user.click(tool(defaultLabels.enterFullscreen));

    expect(root()).toHaveAttribute("data-expanded", "true");
    expect(tool(defaultLabels.exitFullscreen)).toHaveAttribute("aria-pressed", "true");

    await user.click(tool(defaultLabels.exitFullscreen));

    expect(root()).toHaveAttribute("data-expanded", "false");
    expect(tool(defaultLabels.enterFullscreen)).toHaveAttribute("aria-pressed", "false");
  });

  it("closes the text box on Escape before it leaves full screen", async () => {
    const { canvas, user } = await renderEditor();
    await user.click(tool(defaultLabels.enterFullscreen));
    await user.click(tool(defaultLabels.toolText));
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
    const input = screen.getByRole("textbox", { name: defaultLabels.textInputLabel });

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: defaultLabels.textInputLabel })).toBeNull();
    expect(root()).toHaveAttribute("data-expanded", "true");

    fireEvent.keyDown(root(), { key: "Escape" });

    expect(root()).toHaveAttribute("data-expanded", "false");
  });

  it("takes no paste", async () => {
    await renderEditor();
    const file = new File(["png"], "shot.png", { type: "image/png" });

    const notPrevented = fireEvent.paste(document, { clipboardData: { files: [file] } });

    expect(notPrevented).toBe(true);
  });

  it("clears the history when a new image arrives", async () => {
    const { ref, canvas, spy, view, user } = await renderEditor();
    await user.click(tool(defaultLabels.toolRect));
    drag(canvas, [10, 10], [60, 60]);
    expect(tool(defaultLabels.undo)).toBeEnabled();

    view.rerender(
      <ScreenshotEditor ref={ref} image="data:image/png;base64,BBBB" onMarkupChange={spy} />,
    );

    await waitFor(() => expect(tool(defaultLabels.undo)).toBeDisabled());
    expect(spy).toHaveBeenLastCalledWith(false);
  });

  it("wears the app's classes and nonce", async () => {
    document.head.querySelectorAll("style[data-bugkit-styles]").forEach((style) => style.remove());
    await renderEditor({ classNames: { editor: "app-editor", tool: "app-tool" }, nonce: "n1" });

    expect(root()).toHaveClass("app-editor");
    for (const button of within(screen.getByRole("toolbar")).getAllByRole("button")) {
      expect(button).toHaveClass("app-tool");
    }
    expect(document.querySelector("style[data-bugkit-styles]")?.getAttribute("nonce")).toBe("n1");
  });
});
