"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { BugReportButton } from "./BugReportButton.js";
/**
 * BugReport is the launcher and dialog wired to a server route. It posts the
 * report to `endpoint` (default `/api/bug-report`) with `init` merged into the
 * request, and shows the number the server files it under or the server's
 * sentence when it refuses.
 */
export function BugReport({ endpoint = "/api/bug-report", init, version, getContext, ...rest }) {
    const submit = async (form) => {
        const resolvedInit = typeof init === "function" ? await init() : (init ?? {});
        const response = await fetch(endpoint, { ...resolvedInit, method: "POST", body: form });
        const body = (await response.json().catch(() => null));
        if (response.ok && body) {
            return { id: body.id, number: body.number };
        }
        const detail = body?.detail;
        throw new Error(typeof detail === "string" && detail !== "" ? detail : `HTTP ${response.status}`);
    };
    return (_jsx(BugReportButton, { ...rest, submit: submit, getContext: getContext ?? (() => ({ area: window.location.pathname, version: version ?? "" })) }));
}
