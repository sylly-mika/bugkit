import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { beginShape, extendShape, undoLast, TOOLS, type Point, type Shape, type Tool } from "./shapes.js";
import { styles } from "./styles.js";
import type { BugReportLabels } from "./labels.js";

export type ScreenshotPaneHandle = {
  toBlob(): Promise<Blob | null>;
};

/** What the backend accepts, so a doomed upload is refused before Send. */
export const UPLOAD_MIME = "image/png";
export const UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;

type ScreenshotPaneProps = {
  dataUrl: string | null;
  labels: BugReportLabels;
  onImageChosen: (dataUrl: string) => void;
};

const STROKE = "#e11d48";
const STROKE_WIDTH = 3;
const ARROW_HEAD = 12;

/**
 * Null on every failure, and it has to be a `.catch` rather than a try/catch
 * around the constructor: a throw inside the executor — which is what a tainted
 * canvas does — is turned into a rejection, so the try would never see it and
 * the caller would await a rejected promise instead of getting an answer.
 *
 * Null rather than a fallback to the untouched capture, too. A blackout is the
 * reason this editor exists, and shipping the original because the export failed
 * would send the customer name the reporter just covered.
 */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, UPLOAD_MIME)).catch(
    () => null,
  );
}

function paint(ctx: CanvasRenderingContext2D, shape: Shape) {
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

  if (shape.tool === "blackout") {
    // Opaque, not translucent: this is what covers a customer name before the
    // image leaves the building, and the object it lands on is public-read.
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

export const ScreenshotPane = forwardRef<ScreenshotPaneHandle, ScreenshotPaneProps>(
  function ScreenshotPane({ dataUrl, labels, onImageChosen }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const drawingRef = useRef(false);
    const [shapes, setShapes] = useState<Shape[]>([]);
    const [tool, setTool] = useState<Tool>("arrow");
    const [loaded, setLoaded] = useState(false);
    const [rejected, setRejected] = useState(false);

    const redraw = useCallback(() => {
      const canvas = canvasRef.current;
      const image = imageRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !image || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      shapes.forEach((shape) => paint(ctx, shape));
    }, [shapes]);

    // Keyed on dataUrl ALONE, deliberately. redraw's identity changes with every
    // shape, and a pointer drag appends a point per move — so depending on it
    // here would reload the Image and reset canvas.width mid-stroke, dozens of
    // times a second, wiping the drawing as it is being drawn. `loaded` is what
    // re-runs the repaint effect below once the bitmap is actually there.
    useEffect(() => {
      if (!dataUrl) return;

      const image = new Image();
      image.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        imageRef.current = image;
        setLoaded(true);
      };
      image.src = dataUrl;

      return () => {
        image.onload = null;
        imageRef.current = null;
        setLoaded(false);
        // A pasted replacement is a different picture; annotations drawn on the
        // old one would land in the wrong place on the new one.
        setShapes([]);
      };
    }, [dataUrl]);

    // One repaint per frame, not one per pointermove. A drag delivers moves far
    // faster than the display refreshes — coalescing here is what keeps a
    // full-page bitmap plus the whole shape list from being redrawn several
    // times between two frames the reporter can actually see.
    useEffect(() => {
      if (!loaded) return;

      const frame = requestAnimationFrame(redraw);
      return () => cancelAnimationFrame(frame);
    }, [loaded, redraw]);

    useImperativeHandle(ref, () => ({
      // Flattened only here: while editing, the shapes stay a list so undo is a
      // pop rather than a re-render of a burned-in bitmap.
      toBlob() {
        const canvas = canvasRef.current;
        if (!canvas || !imageRef.current) return Promise.resolve(null);

        return canvasToBlob(canvas);
      },
    }), []);

    // clientWidth/clientLeft, not the rect's border box: the pane draws a 1px
    // border and the app sets box-sizing: border-box, so the bitmap is inset
    // from the rect by the border on every side. Scaling by the outer box put
    // every shape a few bitmap pixels off from the pointer.
    function pointFrom(event: ReactPointerEvent<HTMLCanvasElement>): Point {
      const canvas = event.currentTarget;
      const box = canvas.getBoundingClientRect();
      return {
        x:
          ((event.clientX - box.left - canvas.clientLeft) / canvas.clientWidth) *
          canvas.width,
        y:
          ((event.clientY - box.top - canvas.clientTop) / canvas.clientHeight) *
          canvas.height,
      };
    }

    const readFile = useCallback(
      (file: File | null | undefined) => {
        if (!file) return;

        // `accept` is advisory — a drag-and-drop, or a file manager that ignores
        // it, still reaches this handler — so the type and the size are checked
        // here rather than trusted from the picker.
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

    // On `document`, not as an onPaste prop: a paste goes to whatever has focus,
    // and this pane is a plain <div> with no tabindex. With the caret in the
    // description textarea — where a reporter's focus actually is — an onPaste
    // here would never fire. Removed on unmount, so it cannot swallow pastes
    // once the dialog is closed.
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

    // Both states can reject a file: the placeholder through its picker, the
    // editor through the document-level paste above. Rendering this only in the
    // placeholder meant a pasted JPEG over a successful capture was dropped in
    // silence.
    const rejection = rejected ? (
      <p role="alert" style={styles.error}>
        {labels.uploadRejected}
      </p>
    ) : null;

    if (!dataUrl) {
      return (
        <div style={styles.placeholder}>
          <span>{labels.captureFailed}</span>
          <span>{labels.captureFallbackHint}</span>
          <input
            type="file"
            accept={UPLOAD_MIME}
            aria-label={labels.uploadLabel}
            onChange={(event) => readFile(event.target.files?.[0])}
          />
          {rejection}
        </div>
      );
    }

    const toolLabel: Record<Tool, string> = {
      arrow: labels.toolArrow,
      rect: labels.toolRect,
      freehand: labels.toolFreehand,
      blackout: labels.toolBlackout,
    };

    return (
      <div>
        <div style={styles.toolbar}>
          {TOOLS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={tool === value}
              style={tool === value ? { ...styles.tool, ...styles.toolActive } : styles.tool}
              onClick={() => setTool(value)}
            >
              {toolLabel[value]}
            </button>
          ))}
          <button
            type="button"
            style={styles.tool}
            onClick={() => setShapes((current) => undoLast(current))}
          >
            {labels.undo}
          </button>
        </div>

        <canvas
          ref={canvasRef}
          role="img"
          aria-label={labels.screenshotTitle}
          style={{ ...styles.image, touchAction: "none", cursor: "crosshair" }}
          onPointerDown={(event) => {
            // Primary button only. A right-click opens the context menu and
            // never delivers a pointerup here, so drawing on one starts a shape
            // that then follows the pointer around with nothing to end it.
            if (event.button !== 0) return;

            event.currentTarget.setPointerCapture(event.pointerId);
            drawingRef.current = true;
            // Read out here, never inside the updater below: React nulls
            // currentTarget once the handler returns, and a state updater runs
            // during the next render — so pointFrom(event) in there reads
            // getBoundingClientRect off null and takes the whole panel down
            // with it.
            const at = pointFrom(event);
            setShapes((current) => [...current, beginShape(tool, at)]);
          }}
          onPointerMove={(event) => {
            if (!drawingRef.current) return;
            const at = pointFrom(event);
            setShapes((current) => {
              if (current.length === 0) return current;

              const last = current[current.length - 1];
              const next = extendShape(last, at);
              // extendShape hands back the same shape for a freehand step too
              // small to be a line. Returning `current` unchanged means React
              // bails out of the render entirely, rather than re-rendering with
              // a list that says the same thing.
              return next === last ? current : [...current.slice(0, -1), next];
            });
          }}
          onPointerUp={() => {
            drawingRef.current = false;
          }}
          // A drag interrupted by the system — a touch becoming a scroll, the
          // tab losing the pointer — delivers one of these and no pointerup. Left
          // out, the next mousemove with no button held goes on drawing.
          onPointerCancel={() => {
            drawingRef.current = false;
          }}
          onLostPointerCapture={() => {
            drawingRef.current = false;
          }}
        />

        {rejection}
      </div>
    );
  },
);
