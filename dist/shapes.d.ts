export type Point = {
    x: number;
    y: number;
};
export type Rect = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type Tool = "arrow" | "rect" | "freehand" | "text" | "redact" | "crop";
export type Shape = {
    tool: "arrow" | "rect" | "redact";
    from: Point;
    to: Point;
} | {
    tool: "freehand";
    points: Point[];
} | {
    tool: "text";
    at: Point;
    text: string;
    size: number;
};
export type StrokeShape = Extract<Shape, {
    tool: "arrow" | "rect" | "redact" | "freehand";
}>;
export type Step = {
    kind: "shape";
    shape: Shape;
} | {
    kind: "crop";
    rect: Rect;
};
export type History = {
    done: Step[];
    undone: Step[];
};
export declare function beginShape(tool: "arrow" | "rect" | "redact" | "freehand", at: Point): StrokeShape;
/**
 * WHY: a skipped freehand point hands back the same shape, identity included.
 * The caller uses that to drop the update instead of re-rendering an unchanged list.
 */
export declare function extendShape(shape: StrokeShape, at: Point): StrokeShape;
export declare function push(history: History, step: Step): History;
export declare function undo(history: History): History;
export declare function redo(history: History): History;
/** The crop in effect: the last crop step, or the whole picture when there is none. */
export declare function cropOf(done: Step[], natural: {
    width: number;
    height: number;
}): Rect;
