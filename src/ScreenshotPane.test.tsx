import { canvasToBlob } from "./ScreenshotPane.js";

function fakeCanvas(toBlob: HTMLCanvasElement["toBlob"]): HTMLCanvasElement {
  return { toBlob } as HTMLCanvasElement;
}

// jsdom implements no canvas at all, so the export is exercised through its own
// seam rather than through a rendered pane. What the editor really produces is
// verified in a real browser by the walk.
describe("canvasToBlob", () => {
  it("resolves the blob the canvas hands back", async () => {
    const blob = new Blob(["png"], { type: "image/png" });

    await expect(canvasToBlob(fakeCanvas((callback) => callback(blob)))).resolves.toBe(blob);
  });

  it("resolves null when the canvas cannot produce one", async () => {
    await expect(canvasToBlob(fakeCanvas((callback) => callback(null)))).resolves.toBeNull();
  });

  // A tainted canvas throws SecurityError from inside the promise executor,
  // which becomes a rejection rather than something a try/catch around the
  // constructor would ever see. The dialog reads null as "no screenshot" and
  // still sends the report; a rejection would strand it on "sending".
  it("resolves null when the export throws", async () => {
    await expect(
      canvasToBlob(
        fakeCanvas(() => {
          throw new Error("tainted canvas");
        }),
      ),
    ).resolves.toBeNull();
  });
});
