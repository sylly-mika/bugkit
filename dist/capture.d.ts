export declare const CAPTURE_TIMEOUT_MS = 5000;
export declare const CAPTURE_NODE_CAP = 3000;
export type CaptureResult = {
    ok: true;
    dataUrl: string;
} | {
    ok: false;
    reason: "too-many-nodes" | "timed-out" | "failed";
};
export type CaptureOptions = {
    root?: HTMLElement;
    nodeCap?: number;
    timeoutMs?: number;
    allowedImageOrigins?: string[];
};
export declare function capturePage(options?: CaptureOptions): Promise<CaptureResult>;
