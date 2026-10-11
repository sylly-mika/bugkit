export const TOOLS = ["arrow", "rect", "freehand", "blackout"];
export function beginShape(tool, at) {
    return tool === "freehand" ? { tool, points: [at] } : { tool, from: at, to: at };
}
/**
 * Bitmap pixels. Under this a freehand move is jitter rather than a line, and a
 * pointer that reports every hundredth of a millimetre would otherwise buy
 * thousands of points that each cost a lineTo on every repaint for the rest of
 * the session.
 */
const FREEHAND_MIN_STEP = 2;
/**
 * A skipped freehand point hands back the SAME shape, identity included. That is
 * what lets the caller drop the update entirely rather than re-render with a
 * list that has not changed.
 */
export function extendShape(shape, at) {
    if (shape.tool !== "freehand") {
        return { ...shape, to: at };
    }
    const last = shape.points[shape.points.length - 1];
    return Math.hypot(at.x - last.x, at.y - last.y) < FREEHAND_MIN_STEP
        ? shape
        : { tool: "freehand", points: [...shape.points, at] };
}
export function undoLast(shapes) {
    return shapes.slice(0, -1);
}
