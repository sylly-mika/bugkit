export type Point = {
    x: number;
    y: number;
};
export type Tool = "arrow" | "rect" | "freehand" | "blackout";
export declare const TOOLS: Tool[];
export type Shape = {
    tool: "arrow";
    from: Point;
    to: Point;
} | {
    tool: "rect";
    from: Point;
    to: Point;
} | {
    tool: "blackout";
    from: Point;
    to: Point;
} | {
    tool: "freehand";
    points: Point[];
};
export declare function beginShape(tool: Tool, at: Point): Shape;
/**
 * A skipped freehand point hands back the SAME shape, identity included. That is
 * what lets the caller drop the update entirely rather than re-render with a
 * list that has not changed.
 */
export declare function extendShape(shape: Shape, at: Point): Shape;
export declare function undoLast(shapes: Shape[]): Shape[];
