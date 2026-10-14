export type Point = { x: number; y: number };

export type Rect = { x: number; y: number; width: number; height: number };

export type Tool = "arrow" | "rect" | "freehand" | "text" | "redact" | "crop";

export type Shape =
  | { tool: "arrow" | "rect" | "redact"; from: Point; to: Point }
  | { tool: "freehand"; points: Point[] }
  | { tool: "text"; at: Point; text: string; size: number };

export type StrokeShape = Extract<Shape, { tool: "arrow" | "rect" | "redact" | "freehand" }>;

export type Step = { kind: "shape"; shape: Shape } | { kind: "crop"; rect: Rect };

export type History = { done: Step[]; undone: Step[] };

export function beginShape(
  tool: "arrow" | "rect" | "redact" | "freehand",
  at: Point,
): StrokeShape {
  return tool === "freehand" ? { tool, points: [at] } : { tool, from: at, to: at };
}

/**
 * WHY: bitmap pixels. Under this a freehand move is jitter rather than a line,
 * and a pointer that reports every hundredth of a millimetre would otherwise
 * buy thousands of points that each cost a lineTo on every repaint.
 */
const FREEHAND_MIN_STEP = 2;

/**
 * WHY: a skipped freehand point hands back the same shape, identity included.
 * The caller uses that to drop the update instead of re-rendering an unchanged list.
 */
export function extendShape(shape: StrokeShape, at: Point): StrokeShape {
  if (shape.tool !== "freehand") {
    return { ...shape, to: at };
  }

  const last = shape.points[shape.points.length - 1];

  return Math.hypot(at.x - last.x, at.y - last.y) < FREEHAND_MIN_STEP
    ? shape
    : { tool: "freehand", points: [...shape.points, at] };
}

export function push(history: History, step: Step): History {
  return { done: [...history.done, step], undone: [] };
}

export function undo(history: History): History {
  if (history.done.length === 0) return history;
  return {
    done: history.done.slice(0, -1),
    undone: [...history.undone, history.done[history.done.length - 1]],
  };
}

export function redo(history: History): History {
  if (history.undone.length === 0) return history;
  return {
    done: [...history.done, history.undone[history.undone.length - 1]],
    undone: history.undone.slice(0, -1),
  };
}

/** The crop in effect: the last crop step, or the whole picture when there is none. */
export function cropOf(done: Step[], natural: { width: number; height: number }): Rect {
  for (let index = done.length - 1; index >= 0; index -= 1) {
    const step = done[index];
    if (step.kind === "crop") return step.rect;
  }
  return { x: 0, y: 0, width: natural.width, height: natural.height };
}
