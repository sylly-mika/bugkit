import { beginShape, extendShape } from "./shapes.js";

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
});
