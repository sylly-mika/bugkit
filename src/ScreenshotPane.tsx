import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  beginShape,
  cropOf,
  extendShape,
  push,
  redo as redoHistory,
  undo as undoHistory,
  type History,
  type Point,
  type Rect,
  type Shape,
  type StrokeShape,
  type Step,
  type Tool,
} from "./shapes.js";
import { styles } from "./styles.js";
import type { BugReportLabels } from "./labels.js";

export type ScreenshotPaneHandle = {
  toBlob(): Promise<Blob | null>;
  cancelText(): boolean;
};

/** What the backend accepts, so a doomed upload is refused before Send. */
export const UPLOAD_MIME = "image/png";
export const UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;

export type ScreenshotPaneProps = {
  dataUrl: string | null;
  labels: BugReportLabels;
  onImageChosen: (dataUrl: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  onMarkupChange?: (marked: boolean) => void;
};

const STROKE = "#e11d48";
const STROKE_WIDTH = 3;
const ARROW_HEAD = 12;
const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200, 300, 400];
const MIN_CROP = 8;
const DRAW_TOOLS: Exclude<Tool, "crop">[] = ["arrow", "rect", "freehand", "text", "redact"];

type Natural = { width: number; height: number };
type TextDraft = { id: number; at: Point; value: string };
type Active = { kind: "shape"; shape: StrokeShape } | { kind: "crop"; from: Point; to: Point };

/**
 * Null on every failure, and it has to be a `.catch` rather than a try/catch
 * around the constructor: a throw inside the executor — which is what a tainted
 * canvas does — is turned into a rejection, so the try would never see it and
 * the caller would await a rejected promise instead of getting an answer.
 *
 * Null rather than a fallback to the untouched capture, too. A redaction is the
 * reason this editor exists, and shipping the original because the export failed
 * would send the customer name the reporter just covered.
 */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, UPLOAD_MIME)).catch(
    () => null,
  );
}

function paintText(ctx: CanvasRenderingContext2D, shape: Extract<Shape, { tool: "text" }>) {
  const { at, text, size } = shape;
  const pad = size / 4;
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  const width = ctx.measureText(text).width + pad * 2;
  const height = size + pad * 2;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(at.x - pad, at.y - pad, width, height);
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = STROKE_WIDTH;
  ctx.strokeRect(at.x - pad, at.y - pad, width, height);
  ctx.fillStyle = STROKE;
  ctx.fillText(text, at.x, at.y);
}

function paint(ctx: CanvasRenderingContext2D, shape: Shape) {
  if (shape.tool === "text") {
    paintText(ctx, shape);
    return;
  }

  ctx.strokeStyle = STROKE;
  ctx.fillStyle = STROKE;
  ctx.lineWidth = STROKE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (shape.tool === "freehand") {
    ctx.beginPath();
    shape.points.forEach((point, index) =>
      index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y),
    );
    ctx.stroke();
    return;
  }

  const { from, to } = shape;

  if (shape.tool === "rect") {
    ctx.strokeRect(from.x, from.y, to.x - from.x, to.y - from.y);
    return;
  }

  if (shape.tool === "redact") {
    // WHY: opaque, not translucent; this is what hides a customer name before the image leaves the browser.
    ctx.fillStyle = "#000000";
    ctx.fillRect(
      Math.min(from.x, to.x),
      Math.min(from.y, to.y),
      Math.abs(to.x - from.x),
      Math.abs(to.y - from.y),
    );
    return;
  }

  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - ARROW_HEAD * Math.cos(angle - Math.PI / 6),
    to.y - ARROW_HEAD * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    to.x - ARROW_HEAD * Math.cos(angle + Math.PI / 6),
    to.y - ARROW_HEAD * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

/**
 * Paints the picture cropped to `crop`, then the shapes in image coordinates.
 * The translate is what makes a crop show only its own region.
 */
export function paintScene(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  crop: Rect,
  shapes: Shape[],
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, crop.width, crop.height);
  ctx.translate(-crop.x, -crop.y);
  ctx.drawImage(image, 0, 0);
  shapes.forEach((shape) => paint(ctx, shape));
}

function paintCanvas(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  crop: Rect,
  shapes: Shape[],
) {
  if (canvas.width !== crop.width) canvas.width = crop.width;
  if (canvas.height !== crop.height) canvas.height = crop.height;
  const ctx = canvas.getContext("2d");
  if (ctx) paintScene(ctx, image, crop, shapes);
}

function shapesOf(done: Step[]): Shape[] {
  return done.flatMap((step) => (step.kind === "shape" ? [step.shape] : []));
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function cropRect(from: Point, to: Point, within: Rect): Rect {
  const left = Math.round(clamp(Math.min(from.x, to.x), within.x, within.x + within.width));
  const right = Math.round(clamp(Math.max(from.x, to.x), within.x, within.x + within.width));
  const top = Math.round(clamp(Math.min(from.y, to.y), within.y, within.y + within.height));
  const bottom = Math.round(clamp(Math.max(from.y, to.y), within.y, within.y + within.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// WHY: pointer coordinates are scaled and offset by the crop, so a drag lands on the pixel the export shows.
function pointFrom(event: ReactPointerEvent<HTMLCanvasElement>, crop: Rect): Point {
  const canvas = event.currentTarget;
  const box = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - box.left - canvas.clientLeft) / canvas.clientWidth) * crop.width + crop.x,
    y: ((event.clientY - box.top - canvas.clientTop) / canvas.clientHeight) * crop.height + crop.y,
  };
}

function toolStyle(active: boolean): CSSProperties {
  return active ? { ...styles.tool, ...styles.toolActive } : styles.tool;
}

export const ScreenshotPane = forwardRef<ScreenshotPaneHandle, ScreenshotPaneProps>(
  function ScreenshotPane(
    { dataUrl, labels, onImageChosen, expanded, onToggleExpanded, onMarkupChange },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const [natural, setNatural] = useState<Natural | null>(null);
    const [history, setHistoryState] = useState<History>({ done: [], undone: [] });
    const historyRef = useRef(history);
    useEffect(() => {
      onMarkupChange?.(history.done.length > 0);
    }, [history.done.length, onMarkupChange]);
    const [tool, setTool] = useState<Tool>("arrow");
    const [active, setActiveState] = useState<Active | null>(null);
    const activeRef = useRef<Active | null>(null);
    const [text, setTextState] = useState<TextDraft | null>(null);
    const textRef = useRef<TextDraft | null>(null);
    const textIdRef = useRef(0);
    const [zoom, setZoom] = useState<number | null>(null);
    const [fit, setFit] = useState(100);
    const [rejected, setRejected] = useState(false);

    const setHistory = useCallback((next: History) => {
      historyRef.current = next;
      setHistoryState(next);
    }, []);

    const setActive = useCallback((next: Active | null) => {
      activeRef.current = next;
      setActiveState(next);
    }, []);

    const setText = useCallback((next: TextDraft | null) => {
      textRef.current = next;
      setTextState(next);
    }, []);

    const commitText = useCallback(
      (id?: number) => {
        const draft = textRef.current;
        if (!draft || (id !== undefined && draft.id !== id)) return;
        setText(null);
        const value = draft.value.trim();
        if (!value) return;
        const size = Math.max(16, Math.round((imageRef.current?.naturalWidth ?? 0) / 50));
        setHistory(
          push(historyRef.current, {
            kind: "shape",
            shape: { tool: "text", at: draft.at, text: value, size },
          }),
        );
      },
      [setHistory, setText],
    );

    const finish = useCallback(() => {
      const current = activeRef.current;
      if (!current) return;
      setActive(null);

      if (current.kind === "shape") {
        setHistory(push(historyRef.current, { kind: "shape", shape: current.shape }));
        return;
      }

      const image = imageRef.current;
      if (!image) return;
      const bounds = cropOf(historyRef.current.done, {
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      const rect = cropRect(current.from, current.to, bounds);
      if (rect.width < MIN_CROP || rect.height < MIN_CROP) return;
      setHistory(push(historyRef.current, { kind: "crop", rect }));
      setTool("arrow");
    }, [setActive, setHistory]);

    const currentCrop = useCallback((): Rect | null => {
      const image = imageRef.current;
      if (!image) return null;
      return cropOf(historyRef.current.done, {
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    }, []);

    const redraw = useCallback(() => {
      const canvas = canvasRef.current;
      const image = imageRef.current;
      if (!canvas || !image || !natural) return;

      const crop = cropOf(history.done, natural);
      const pending = active?.kind === "shape" ? [active.shape] : [];
      paintCanvas(canvas, image, crop, [...shapesOf(history.done), ...pending]);
    }, [natural, history, active]);

    // WHY: keyed on dataUrl alone; depending on redraw would reload the Image mid-stroke and wipe the drawing.
    useEffect(() => {
      if (!dataUrl) return;

      const image = new Image();
      image.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        imageRef.current = image;
        setNatural({ width: image.naturalWidth, height: image.naturalHeight });
      };
      image.src = dataUrl;

      return () => {
        image.onload = null;
        imageRef.current = null;
        setNatural(null);
        setHistory({ done: [], undone: [] });
        setActive(null);
        setText(null);
      };
    }, [dataUrl, setActive, setHistory, setText]);

    useEffect(() => {
      if (!natural) return;

      const frame = requestAnimationFrame(redraw);
      return () => cancelAnimationFrame(frame);
    }, [natural, redraw]);

    // WHY: no dependency array; a window resize changes the canvas size without a render of ours.
    useEffect(() => {
      const measure = () => {
        const canvas = canvasRef.current;
        setFit(
          canvas && canvas.width > 0 && canvas.clientWidth > 0
            ? Math.round((canvas.clientWidth / canvas.width) * 100)
            : 100,
        );
      };
      measure();
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    });

    useImperativeHandle(
      ref,
      () => ({
        // WHY: flattened only here; while editing, steps stay a list so undo is a pop, not a re-render.
        toBlob() {
          commitText();
          const canvas = canvasRef.current;
          const image = imageRef.current;
          if (!canvas || !image) return Promise.resolve(null);

          const crop = cropOf(historyRef.current.done, {
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
          paintCanvas(canvas, image, crop, shapesOf(historyRef.current.done));
          return canvasToBlob(canvas);
        },
        cancelText() {
          if (!textRef.current) return false;
          setText(null);
          return true;
        },
      }),
      [commitText, setText],
    );

    const readFile = useCallback(
      (file: File | null | undefined) => {
        if (!file) return;

        // WHY: `accept` is advisory; drag-and-drop still reaches this handler, so type and size are checked here.
        if (file.type !== UPLOAD_MIME || file.size > UPLOAD_LIMIT_BYTES) {
          setRejected(true);
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          setRejected(false);
          onImageChosen(String(reader.result));
        };
        reader.onerror = () => setRejected(true);
        reader.readAsDataURL(file);
      },
      [onImageChosen],
    );

    // WHY: on document, not onPaste: the pane is a plain div with no tabindex, so a paste goes to whatever has focus.
    useEffect(() => {
      const onPaste = (event: ClipboardEvent) => {
        const file = event.clipboardData?.files[0];
        if (file?.type.startsWith("image/")) {
          event.preventDefault();
          readFile(file);
        }
      };

      document.addEventListener("paste", onPaste);
      return () => document.removeEventListener("paste", onPaste);
    }, [readFile]);

    const crop = natural ? cropOf(history.done, natural) : null;
    const percent = zoom ?? fit;
    const scale = percent / 100;

    function zoomBy(direction: 1 | -1) {
      const next =
        direction > 0
          ? ZOOM_STEPS.find((step) => step > percent)
          : [...ZOOM_STEPS].reverse().find((step) => step < percent);
      if (next !== undefined) setZoom(next);
    }

    const upload = (
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_MIME}
        aria-label={labels.uploadLabel}
        hidden={dataUrl !== null}
        onChange={(event) => readFile(event.target.files?.[0])}
      />
    );

    // WHY: render the error in both states; a pasted file over a capture is otherwise dropped silently.
    const rejection = rejected ? (
      <p role="alert" style={styles.error}>
        {labels.uploadRejected}
      </p>
    ) : null;

    const toolbar = (
      <div role="toolbar" aria-label={labels.toolbarLabel} style={styles.toolbar}>
        {dataUrl ? (
          <>
            {DRAW_TOOLS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={tool === value}
                style={toolStyle(tool === value)}
                onClick={() => {
                  commitText();
                  setTool(value);
                }}
              >
                {value === "arrow"
                  ? labels.toolArrow
                  : value === "rect"
                    ? labels.toolRect
                    : value === "freehand"
                      ? labels.toolFreehand
                      : value === "text"
                        ? labels.toolText
                        : labels.toolRedact}
              </button>
            ))}
            <button
              type="button"
              style={styles.tool}
              disabled={history.done.length === 0}
              onClick={() => setHistory(undoHistory(historyRef.current))}
            >
              {labels.undo}
            </button>
            <button
              type="button"
              style={styles.tool}
              disabled={history.undone.length === 0}
              onClick={() => setHistory(redoHistory(historyRef.current))}
            >
              {labels.redo}
            </button>
            <button
              type="button"
              style={styles.tool}
              disabled={percent <= ZOOM_STEPS[0]}
              onClick={() => zoomBy(-1)}
            >
              {labels.zoomOut}
            </button>
            <output style={styles.zoomLevel}>{labels.zoomLevel(percent)}</output>
            <button
              type="button"
              style={styles.tool}
              disabled={percent >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
              onClick={() => zoomBy(1)}
            >
              {labels.zoomIn}
            </button>
            <button type="button" style={styles.tool} onClick={() => setZoom(null)}>
              {labels.fit}
            </button>
            <button
              type="button"
              aria-pressed={tool === "crop"}
              style={toolStyle(tool === "crop")}
              onClick={() => {
                commitText();
                setTool("crop");
              }}
            >
              {labels.crop}
            </button>
          </>
        ) : null}
        <button type="button" style={styles.tool} onClick={() => inputRef.current?.click()}>
          {labels.replace}
        </button>
        <button
          type="button"
          aria-pressed={expanded}
          style={toolStyle(expanded)}
          onClick={onToggleExpanded}
        >
          {expanded ? labels.exitFullscreen : labels.enterFullscreen}
        </button>
      </div>
    );

    if (!dataUrl) {
      return (
        <div>
          {toolbar}
          <div style={styles.placeholder}>
            <span>{labels.captureFailed}</span>
            <span>{labels.captureFallbackHint}</span>
            {upload}
            {rejection}
          </div>
        </div>
      );
    }

    return (
      <div>
        {toolbar}
        <div style={styles.canvasScroll}>
          <div style={styles.canvasStage}>
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={labels.screenshotTitle}
              style={{
                ...styles.image,
                touchAction: "none",
                cursor: tool === "text" ? "text" : "crosshair",
                ...(crop && zoom !== null ? { width: `${Math.round((crop.width * zoom) / 100)}px` } : {}),
              }}
              onPointerDown={(event) => {
                // WHY: primary button only; a right-click sends no pointerup, so the shape would never end.
                if (event.button !== 0) return;
                const bounds = currentCrop();
                if (!bounds) return;
                const at = pointFrom(event, bounds);

                if (tool === "text") {
                  commitText();
                  textIdRef.current += 1;
                  setText({ id: textIdRef.current, at, value: "" });
                  return;
                }

                event.currentTarget.setPointerCapture(event.pointerId);
                if (tool === "crop") {
                  setActive({ kind: "crop", from: at, to: at });
                } else {
                  setActive({ kind: "shape", shape: beginShape(tool, at) });
                }
              }}
              onPointerMove={(event) => {
                const current = activeRef.current;
                const bounds = currentCrop();
                if (!current || !bounds) return;
                const at = pointFrom(event, bounds);

                if (current.kind === "crop") {
                  setActive({ kind: "crop", from: current.from, to: at });
                  return;
                }

                const next = extendShape(current.shape, at);
                if (next !== current.shape) setActive({ kind: "shape", shape: next });
              }}
              onPointerUp={finish}
              // WHY: a system-interrupted drag gets no pointerup; ending it here stops the next mousemove drawing.
              onPointerCancel={finish}
              onLostPointerCapture={finish}
            />
            {text && crop ? (
              <input
                key={text.id}
                aria-label={labels.textInputLabel}
                maxLength={200}
                autoFocus
                value={text.value}
                onChange={(event) => {
                  const draft = textRef.current;
                  if (draft) setText({ ...draft, value: event.target.value });
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  commitText();
                }}
                onBlur={() => commitText(text.id)}
                style={{
                  ...styles.textInput,
                  left: (text.at.x - crop.x) * scale,
                  top: (text.at.y - crop.y) * scale,
                }}
              />
            ) : null}
          </div>
        </div>
        {rejection}
        {upload}
      </div>
    );
  },
);
