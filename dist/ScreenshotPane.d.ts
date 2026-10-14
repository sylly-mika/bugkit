import { type Rect, type Shape } from "./shapes.js";
import type { BugReportLabels } from "./labels.js";
export type ScreenshotPaneHandle = {
    toBlob(): Promise<Blob | null>;
    cancelText(): boolean;
};
/** What the backend accepts, so a doomed upload is refused before Send. */
export declare const UPLOAD_MIME = "image/png";
export declare const UPLOAD_LIMIT_BYTES: number;
export type ScreenshotPaneProps = {
    dataUrl: string | null;
    labels: BugReportLabels;
    onImageChosen: (dataUrl: string) => void;
    expanded: boolean;
    onToggleExpanded: () => void;
    onMarkupChange?: (marked: boolean) => void;
};
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
export declare function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null>;
/**
 * Paints the picture cropped to `crop`, then the shapes in image coordinates.
 * The translate is what makes a crop show only its own region.
 */
export declare function paintScene(ctx: CanvasRenderingContext2D, image: CanvasImageSource, crop: Rect, shapes: Shape[]): void;
export declare const ScreenshotPane: import("react").ForwardRefExoticComponent<ScreenshotPaneProps & import("react").RefAttributes<ScreenshotPaneHandle>>;
