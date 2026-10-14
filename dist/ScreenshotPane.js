import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, } from "react";
import { beginShape, cropOf, extendShape, push, redo as redoHistory, undo as undoHistory, } from "./shapes.js";
import { styles } from "./styles.js";
/** What the backend accepts, so a doomed upload is refused before Send. */
export const UPLOAD_MIME = "image/png";
export const UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;
const STROKE = "#e11d48";
const STROKE_WIDTH = 3;
const ARROW_HEAD = 12;
const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200, 300, 400];
const MIN_CROP = 8;
const DRAW_TOOLS = ["arrow", "rect", "freehand", "text", "redact"];
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
export function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, UPLOAD_MIME)).catch(() => null);
}
function paintText(ctx, shape) {
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
function paint(ctx, shape) {
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
        shape.points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
        ctx.stroke();
        return;
    }
    const { from, to } = shape;
    if (shape.tool === "rect") {
        ctx.strokeRect(from.x, from.y, to.x - from.x, to.y - from.y);
        return;
    }
    if (shape.tool === "redact") {
        // WHY: opaque, not translucent. This is what covers a customer name before
        // the image leaves the browser, and the object it lands on is public-read.
        ctx.fillStyle = "#000000";
        ctx.fillRect(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y));
        return;
    }
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - ARROW_HEAD * Math.cos(angle - Math.PI / 6), to.y - ARROW_HEAD * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(to.x - ARROW_HEAD * Math.cos(angle + Math.PI / 6), to.y - ARROW_HEAD * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
}
/**
 * Paints the picture cropped to `crop`, then the shapes in image coordinates.
 * The translate is what makes a crop show only its own region.
 */
export function paintScene(ctx, image, crop, shapes) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, crop.width, crop.height);
    ctx.translate(-crop.x, -crop.y);
    ctx.drawImage(image, 0, 0);
    shapes.forEach((shape) => paint(ctx, shape));
}
function paintCanvas(canvas, image, crop, shapes) {
    if (canvas.width !== crop.width)
        canvas.width = crop.width;
    if (canvas.height !== crop.height)
        canvas.height = crop.height;
    const ctx = canvas.getContext("2d");
    if (ctx)
        paintScene(ctx, image, crop, shapes);
}
function shapesOf(done) {
    return done.flatMap((step) => (step.kind === "shape" ? [step.shape] : []));
}
function clamp(value, low, high) {
    return Math.min(Math.max(value, low), high);
}
function cropRect(from, to, within) {
    const left = Math.round(clamp(Math.min(from.x, to.x), within.x, within.x + within.width));
    const right = Math.round(clamp(Math.max(from.x, to.x), within.x, within.x + within.width));
    const top = Math.round(clamp(Math.min(from.y, to.y), within.y, within.y + within.height));
    const bottom = Math.round(clamp(Math.max(from.y, to.y), within.y, within.y + within.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
}
// WHY: client points are scaled by the crop, not the bitmap, and offset by its
// origin. A drag inside a crop has to land on the same image pixel that the
// exported bitmap shows at that spot.
function pointFrom(event, crop) {
    const canvas = event.currentTarget;
    const box = canvas.getBoundingClientRect();
    return {
        x: ((event.clientX - box.left - canvas.clientLeft) / canvas.clientWidth) * crop.width + crop.x,
        y: ((event.clientY - box.top - canvas.clientTop) / canvas.clientHeight) * crop.height + crop.y,
    };
}
function toolStyle(active) {
    return active ? { ...styles.tool, ...styles.toolActive } : styles.tool;
}
export const ScreenshotPane = forwardRef(function ScreenshotPane({ dataUrl, labels, onImageChosen, expanded, onToggleExpanded, onMarkupChange }, ref) {
    const canvasRef = useRef(null);
    const inputRef = useRef(null);
    const imageRef = useRef(null);
    const [natural, setNatural] = useState(null);
    const [history, setHistoryState] = useState({ done: [], undone: [] });
    const historyRef = useRef(history);
    useEffect(() => {
        onMarkupChange?.(history.done.length > 0);
    }, [history.done.length, onMarkupChange]);
    const [tool, setTool] = useState("arrow");
    const [active, setActiveState] = useState(null);
    const activeRef = useRef(null);
    const [text, setTextState] = useState(null);
    const textRef = useRef(null);
    const textIdRef = useRef(0);
    const [zoom, setZoom] = useState(null);
    const [fit, setFit] = useState(100);
    const [rejected, setRejected] = useState(false);
    const setHistory = useCallback((next) => {
        historyRef.current = next;
        setHistoryState(next);
    }, []);
    const setActive = useCallback((next) => {
        activeRef.current = next;
        setActiveState(next);
    }, []);
    const setText = useCallback((next) => {
        textRef.current = next;
        setTextState(next);
    }, []);
    const commitText = useCallback((id) => {
        const draft = textRef.current;
        if (!draft || (id !== undefined && draft.id !== id))
            return;
        setText(null);
        const value = draft.value.trim();
        if (!value)
            return;
        const size = Math.max(16, Math.round((imageRef.current?.naturalWidth ?? 0) / 50));
        setHistory(push(historyRef.current, {
            kind: "shape",
            shape: { tool: "text", at: draft.at, text: value, size },
        }));
    }, [setHistory, setText]);
    const finish = useCallback(() => {
        const current = activeRef.current;
        if (!current)
            return;
        setActive(null);
        if (current.kind === "shape") {
            setHistory(push(historyRef.current, { kind: "shape", shape: current.shape }));
            return;
        }
        const image = imageRef.current;
        if (!image)
            return;
        const bounds = cropOf(historyRef.current.done, {
            width: image.naturalWidth,
            height: image.naturalHeight,
        });
        const rect = cropRect(current.from, current.to, bounds);
        if (rect.width < MIN_CROP || rect.height < MIN_CROP)
            return;
        setHistory(push(historyRef.current, { kind: "crop", rect }));
        setTool("arrow");
    }, [setActive, setHistory]);
    const currentCrop = useCallback(() => {
        const image = imageRef.current;
        if (!image)
            return null;
        return cropOf(historyRef.current.done, {
            width: image.naturalWidth,
            height: image.naturalHeight,
        });
    }, []);
    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        const image = imageRef.current;
        if (!canvas || !image || !natural)
            return;
        const crop = cropOf(history.done, natural);
        const pending = active?.kind === "shape" ? [active.shape] : [];
        paintCanvas(canvas, image, crop, [...shapesOf(history.done), ...pending]);
    }, [natural, history, active]);
    // Keyed on dataUrl ALONE, deliberately. redraw's identity changes with every
    // shape, and a pointer drag appends a point per move — so depending on it
    // here would reload the Image mid-stroke, dozens of times a second, wiping
    // the drawing as it is being drawn. Clearing the stacks on a new image is in
    // the cleanup: annotations drawn on the old picture would land in the wrong
    // place on the new one.
    useEffect(() => {
        if (!dataUrl)
            return;
        const image = new Image();
        image.onload = () => {
            const canvas = canvasRef.current;
            if (!canvas)
                return;
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
    // One repaint per frame, not one per pointermove. A drag delivers moves far
    // faster than the display refreshes, so coalescing here keeps a full-page
    // bitmap plus the whole shape list from being redrawn several times between
    // two frames.
    useEffect(() => {
        if (!natural)
            return;
        const frame = requestAnimationFrame(redraw);
        return () => cancelAnimationFrame(frame);
    }, [natural, redraw]);
    // Runs after every render: the readout follows the canvas's real size, and
    // a window resize changes that size without any render of ours.
    useEffect(() => {
        const measure = () => {
            const canvas = canvasRef.current;
            setFit(canvas && canvas.width > 0 && canvas.clientWidth > 0
                ? Math.round((canvas.clientWidth / canvas.width) * 100)
                : 100);
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    });
    useImperativeHandle(ref, () => ({
        // Flattened only here: while editing, the steps stay a list so undo is a
        // pop rather than a re-render of a burned-in bitmap.
        toBlob() {
            commitText();
            const canvas = canvasRef.current;
            const image = imageRef.current;
            if (!canvas || !image)
                return Promise.resolve(null);
            const crop = cropOf(historyRef.current.done, {
                width: image.naturalWidth,
                height: image.naturalHeight,
            });
            paintCanvas(canvas, image, crop, shapesOf(historyRef.current.done));
            return canvasToBlob(canvas);
        },
        cancelText() {
            if (!textRef.current)
                return false;
            setText(null);
            return true;
        },
    }), [commitText, setText]);
    const readFile = useCallback((file) => {
        if (!file)
            return;
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
    }, [onImageChosen]);
    // On `document`, not as an onPaste prop: a paste goes to whatever has focus,
    // and this pane is a plain <div> with no tabindex. Removed on unmount, so it
    // cannot swallow pastes once the dialog is closed.
    useEffect(() => {
        const onPaste = (event) => {
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
    function zoomBy(direction) {
        const next = direction > 0
            ? ZOOM_STEPS.find((step) => step > percent)
            : [...ZOOM_STEPS].reverse().find((step) => step < percent);
        if (next !== undefined)
            setZoom(next);
    }
    const upload = (_jsx("input", { ref: inputRef, type: "file", accept: UPLOAD_MIME, "aria-label": labels.uploadLabel, hidden: dataUrl !== null, onChange: (event) => readFile(event.target.files?.[0]) }));
    // Both states can reject a file: the placeholder through its picker, the
    // editor through the document-level paste above. Rendering this only in the
    // placeholder meant a pasted JPEG over a successful capture was dropped in
    // silence.
    const rejection = rejected ? (_jsx("p", { role: "alert", style: styles.error, children: labels.uploadRejected })) : null;
    const toolbar = (_jsxs("div", { role: "toolbar", "aria-label": labels.toolbarLabel, style: styles.toolbar, children: [dataUrl ? (_jsxs(_Fragment, { children: [DRAW_TOOLS.map((value) => (_jsx("button", { type: "button", "aria-pressed": tool === value, style: toolStyle(tool === value), onClick: () => {
                            commitText();
                            setTool(value);
                        }, children: value === "arrow"
                            ? labels.toolArrow
                            : value === "rect"
                                ? labels.toolRect
                                : value === "freehand"
                                    ? labels.toolFreehand
                                    : value === "text"
                                        ? labels.toolText
                                        : labels.toolRedact }, value))), _jsx("button", { type: "button", style: styles.tool, disabled: history.done.length === 0, onClick: () => setHistory(undoHistory(historyRef.current)), children: labels.undo }), _jsx("button", { type: "button", style: styles.tool, disabled: history.undone.length === 0, onClick: () => setHistory(redoHistory(historyRef.current)), children: labels.redo }), _jsx("button", { type: "button", style: styles.tool, disabled: percent <= ZOOM_STEPS[0], onClick: () => zoomBy(-1), children: labels.zoomOut }), _jsx("output", { style: styles.zoomLevel, children: labels.zoomLevel(percent) }), _jsx("button", { type: "button", style: styles.tool, disabled: percent >= ZOOM_STEPS[ZOOM_STEPS.length - 1], onClick: () => zoomBy(1), children: labels.zoomIn }), _jsx("button", { type: "button", style: styles.tool, onClick: () => setZoom(null), children: labels.fit }), _jsx("button", { type: "button", "aria-pressed": tool === "crop", style: toolStyle(tool === "crop"), onClick: () => {
                            commitText();
                            setTool("crop");
                        }, children: labels.crop })] })) : null, _jsx("button", { type: "button", style: styles.tool, onClick: () => inputRef.current?.click(), children: labels.replace }), _jsx("button", { type: "button", "aria-pressed": expanded, style: toolStyle(expanded), onClick: onToggleExpanded, children: expanded ? labels.exitFullscreen : labels.enterFullscreen })] }));
    if (!dataUrl) {
        return (_jsxs("div", { children: [toolbar, _jsxs("div", { style: styles.placeholder, children: [_jsx("span", { children: labels.captureFailed }), _jsx("span", { children: labels.captureFallbackHint }), upload, rejection] })] }));
    }
    return (_jsxs("div", { children: [toolbar, _jsx("div", { style: styles.canvasScroll, children: _jsxs("div", { style: styles.canvasStage, children: [_jsx("canvas", { ref: canvasRef, role: "img", "aria-label": labels.screenshotTitle, style: {
                                ...styles.image,
                                touchAction: "none",
                                cursor: tool === "text" ? "text" : "crosshair",
                                ...(crop && zoom !== null ? { width: `${Math.round((crop.width * zoom) / 100)}px` } : {}),
                            }, onPointerDown: (event) => {
                                // Primary button only. A right-click opens the context menu and
                                // never delivers a pointerup here, so drawing on one starts a shape
                                // that then follows the pointer around with nothing to end it.
                                if (event.button !== 0)
                                    return;
                                const bounds = currentCrop();
                                if (!bounds)
                                    return;
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
                                }
                                else {
                                    setActive({ kind: "shape", shape: beginShape(tool, at) });
                                }
                            }, onPointerMove: (event) => {
                                const current = activeRef.current;
                                const bounds = currentCrop();
                                if (!current || !bounds)
                                    return;
                                const at = pointFrom(event, bounds);
                                if (current.kind === "crop") {
                                    setActive({ kind: "crop", from: current.from, to: at });
                                    return;
                                }
                                const next = extendShape(current.shape, at);
                                // extendShape hands back the same shape for a freehand step too
                                // small to be a line. Skipping the update means React bails out of
                                // the render rather than re-rendering with an unchanged list.
                                if (next !== current.shape)
                                    setActive({ kind: "shape", shape: next });
                            }, onPointerUp: finish, 
                            // A drag interrupted by the system — a touch becoming a scroll, the
                            // tab losing the pointer — delivers one of these and no pointerup.
                            // Ending the drag here keeps the next mousemove from drawing on.
                            onPointerCancel: finish, onLostPointerCapture: finish }), text && crop ? (_jsx("input", { "aria-label": labels.textInputLabel, maxLength: 200, autoFocus: true, value: text.value, onChange: (event) => {
                                const draft = textRef.current;
                                if (draft)
                                    setText({ ...draft, value: event.target.value });
                            }, onKeyDown: (event) => {
                                if (event.key !== "Enter")
                                    return;
                                event.preventDefault();
                                commitText();
                            }, onBlur: () => commitText(text.id), style: {
                                ...styles.textInput,
                                left: (text.at.x - crop.x) * scale,
                                top: (text.at.y - crop.y) * scale,
                            } }, text.id)) : null] }) }), rejection, upload] }));
});
