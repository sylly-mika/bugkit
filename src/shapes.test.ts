import { beginShape, extendShape, undoLast, type Shape } from "./shapes.js";

describe("the annotation shape model", () => {
  it("starts a drag tool as a zero-length segment", () => {
    expect(beginShape("arrow", { x: 10, y: 20 })).toEqual({
      tool: "arrow",
      from: { x: 10, y: 20 },
      to: { x: 10, y: 20 },
    });
  });

  it("moves only the end point of a drag tool", () => {
    const started = beginShape("rect", { x: 1, y: 2 });

    expect(extendShape(started, { x: 30, y: 40 })).toEqual({
      tool: "rect",
      from: { x: 1, y: 2 },
      to: { x: 30, y: 40 },
    });
  });

  it("accumulates points for freehand", () => {
    const started = beginShape("freehand", { x: 1, y: 1 });
    const moved = extendShape(extendShape(started, { x: 5, y: 5 }), { x: 9, y: 9 });

    expect(moved).toEqual({
      tool: "freehand",
      points: [
        { x: 1, y: 1 },
        { x: 5, y: 5 },
        { x: 9, y: 9 },
      ],
    });
  });

  // Identity, not just equality: handing back the same object is what lets the
  // pane skip the re-render a sub-pixel move would otherwise cost it.
  it("drops a freehand point that is jitter rather than a line", () => {
    const started = extendShape(beginShape("freehand", { x: 0, y: 0 }), { x: 10, y: 10 });

    expect(extendShape(started, { x: 11, y: 11 })).toBe(started);
    expect(extendShape(started, { x: 12, y: 12 })).not.toBe(started);
  });

  it("undoes the last shape and is a no-op on an empty list", () => {
    const shapes: Shape[] = [beginShape("arrow", { x: 0, y: 0 }), beginShape("rect", { x: 1, y: 1 })];

    expect(undoLast(shapes)).toHaveLength(1);
    expect(undoLast(shapes)[0].tool).toBe("arrow");
    expect(undoLast([])).toEqual([]);
  });

  it("does not mutate the list it is given", () => {
    const shapes: Shape[] = [beginShape("blackout", { x: 0, y: 0 })];
    undoLast(shapes);

    expect(shapes).toHaveLength(1);
  });
});
