// WHY: no runtime imports, so dist/server.js loads in Node and Edge without React or the DOM.
/**
 * createBugReportRoute returns a Fetch-API handler for POST bug reports. It checks
 * a report the way bugkit's Go handler does and relays it to the intake with the
 * key kept on the server.
 */
export function createBugReportRoute(options) {
    return async (request) => {
        try {
            return await handle(options, request);
        }
        catch (error) {
            if (error instanceof Refusal) {
                return problem(request, error.status, error.detail, error.headers);
            }
            throw error;
        }
    };
}
class Refusal {
    status;
    detail;
    headers;
    constructor(status, detail, headers = {}) {
        this.status = status;
        this.detail = detail;
        this.headers = headers;
    }
}
const JSON_TYPE = "application/json; charset=UTF-8";
const BODY_LIMIT = 6_291_456;
const SCREENSHOT_LIMIT = 5_242_880;
const DIAGNOSTICS_LIMIT_BYTES = 32_768;
const UPSTREAM_TIMEOUT_MS = 30_000;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BUG_KINDS = ["bug", "feature"];
const BUG_IMPACTS = ["blocks", "workaround", "cosmetic"];
const NOT_CONFIGURED = "Bug reporting is not configured on this server.";
const FILING_FAILED = "The report could not be filed. Copy it and try again.";
const BODY_TOO_LARGE = "The report is larger than 6 MiB.";
const TITLES = {
    400: "Bad Request",
    401: "Unauthorized",
    413: "Request Entity Too Large",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
    502: "Bad Gateway",
    503: "Service Unavailable",
};
async function handle(options, request) {
    const reporter = await options.reporter(request);
    if (!reporter) {
        throw new Refusal(401, "Not authenticated.");
    }
    if (!options.intakeUrl || !options.intakeKey) {
        throw new Refusal(503, NOT_CONFIGURED);
    }
    if (options.limit) {
        const wait = await options.limit(request, reporter);
        if (typeof wait === "number" && wait > 0) {
            throw tooMany(Math.ceil(wait));
        }
    }
    const form = await readForm(request);
    const checked = await checkFields(form, request);
    return relay(options, intakeForm(checked, reporter));
}
async function readForm(request) {
    const bytes = await readBody(request);
    try {
        const type = request.headers.get("content-type") ?? "";
        return await new Response(bytes, { headers: { "content-type": type } }).formData();
    }
    catch {
        throw new Refusal(400, "The report body is not a readable multipart form.");
    }
}
async function readBody(request) {
    if (Number(request.headers.get("content-length")) > BODY_LIMIT) {
        throw new Refusal(413, BODY_TOO_LARGE);
    }
    if (request.body === null) {
        return new Uint8Array(0);
    }
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        size += value.byteLength;
        if (size > BODY_LIMIT) {
            await reader.cancel();
            throw new Refusal(413, BODY_TOO_LARGE);
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}
async function checkFields(form, request) {
    const kind = text(form, "kind") || "bug";
    if (!BUG_KINDS.includes(kind)) {
        throw new Refusal(422, "Kind must be bug or feature.");
    }
    const summary = text(form, "summary");
    if (codePoints(summary) > 200) {
        throw new Refusal(422, "Summary must be at most 200 characters.");
    }
    const description = text(form, "description");
    if (description === "") {
        throw new Refusal(422, "A description is required.");
    }
    if (codePoints(description) > 5000) {
        throw new Refusal(422, "Description must be at most 5000 characters.");
    }
    const impact = text(form, "impact");
    if (!BUG_IMPACTS.includes(impact)) {
        throw new Refusal(422, "Impact must be one of blocks, workaround or cosmetic.");
    }
    const area = text(form, "area");
    if (area === "") {
        throw new Refusal(422, "An area is required.");
    }
    if (!area.startsWith("/")) {
        throw new Refusal(422, 'Area must be a route path starting with "/".');
    }
    if (codePoints(area) > 512) {
        throw new Refusal(422, "Area must be at most 512 characters.");
    }
    const diagnostics = text(form, "diagnostics");
    if (new TextEncoder().encode(diagnostics).length > DIAGNOSTICS_LIMIT_BYTES) {
        throw new Refusal(422, "Diagnostics must be at most 32 KiB.");
    }
    if (!isJson(diagnostics)) {
        throw new Refusal(422, "Diagnostics must be JSON.");
    }
    const version = text(form, "version");
    if (codePoints(version) > 128) {
        throw new Refusal(422, "Version must be at most 128 characters.");
    }
    const viewport = text(form, "viewport");
    if (codePoints(viewport) > 64) {
        throw new Refusal(422, "Viewport must be at most 64 characters.");
    }
    const userAgent = [...(request.headers.get("user-agent") ?? "")].slice(0, 256).join("");
    const requestId = text(form, "request_id");
    if (codePoints(requestId) > 128) {
        throw new Refusal(422, "Request id must be at most 128 characters.");
    }
    const screenshot = await screenshotBytes(form.get("screenshot"));
    return { kind, summary, description, impact, area, diagnostics, version, viewport, userAgent, requestId, screenshot };
}
function text(form, name) {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
}
function codePoints(value) {
    return [...value].length;
}
function isJson(value) {
    try {
        JSON.parse(value);
        return true;
    }
    catch {
        return false;
    }
}
async function screenshotBytes(value) {
    if (value === null || typeof value === "string" || value.size === 0) {
        return null;
    }
    if (value.size > SCREENSHOT_LIMIT) {
        throw new Refusal(413, "The screenshot is larger than 5 MiB.");
    }
    const bytes = new Uint8Array(await value.arrayBuffer());
    if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
        throw new Refusal(422, "Screenshot must be a PNG image.");
    }
    return bytes;
}
function intakeForm(checked, reporter) {
    const form = new FormData();
    form.append("kind", checked.kind);
    if (checked.summary)
        form.append("summary", checked.summary);
    form.append("description", checked.description);
    form.append("impact", checked.impact);
    form.append("area", checked.area);
    form.append("diagnostics", checked.diagnostics);
    if (checked.version)
        form.append("version", checked.version);
    if (checked.viewport)
        form.append("viewport", checked.viewport);
    if (checked.userAgent)
        form.append("user_agent", checked.userAgent);
    if (checked.requestId)
        form.append("request_id", checked.requestId);
    if (reporter.name)
        form.append("reporter_name", reporter.name);
    if (reporter.email)
        form.append("reporter_email", reporter.email);
    if (checked.screenshot) {
        form.append("screenshot", new Blob([checked.screenshot], { type: "image/png" }), "screenshot.png");
    }
    return form;
}
async function relay(options, body) {
    let upstream;
    try {
        upstream = await fetch(options.intakeUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${options.intakeKey}`, Accept: "application/json" },
            body,
            redirect: "manual",
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
    }
    catch (error) {
        console.error("bugkit: submission failed", { error: error instanceof Error ? error.message : String(error) });
        throw new Refusal(502, FILING_FAILED);
    }
    if (upstream.status === 201) {
        const filed = await filedResult(upstream);
        if (filed) {
            return new Response(JSON.stringify(filed), { status: 201, headers: { "content-type": JSON_TYPE } });
        }
    }
    throw upstreamRefusal(upstream.status, upstream.headers.get("retry-after"));
}
async function filedResult(response) {
    try {
        const body = (await response.json());
        if (typeof body?.id === "string" && body.id !== "") {
            return { id: body.id, number: body.number };
        }
        return null;
    }
    catch {
        return null;
    }
}
function upstreamRefusal(status, retryAfter) {
    console.error("bugkit: submission failed", { status });
    if (status === 429) {
        const seconds = Number.parseInt(retryAfter ?? "", 10);
        return tooMany(seconds > 0 ? seconds : 60);
    }
    if (status === 401 || status === 403 || status === 409) {
        return new Refusal(503, NOT_CONFIGURED);
    }
    return new Refusal(502, FILING_FAILED);
}
function tooMany(seconds) {
    return new Refusal(429, `Too many bug reports. Try again in ${seconds} seconds.`, { "Retry-After": String(seconds) });
}
function problem(request, status, detail, headers = {}) {
    const body = {
        type: "about:blank",
        title: TITLES[status],
        status,
        detail,
        instance: new URL(request.url).pathname,
    };
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": JSON_TYPE, ...headers },
    });
}
