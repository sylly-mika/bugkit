import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ScreenshotPane } from "./ScreenshotPane.js";
import { styles } from "./styles.js";
import { BUG_IMPACTS, buildBugReportForm, reportAsText, } from "./payload.js";
import { formatFiled } from "./labels.js";
const IMPACT_LABEL = {
    blocks: "impactBlocks",
    workaround: "impactWorkaround",
    cosmetic: "impactCosmetic",
};
/** The backend refuses a longer description with a 422, so the field stops first. */
const DESCRIPTION_LIMIT = 5_000;
/**
 * The backend refuses a larger screenshot with a 413. Past the cap the image is
 * dropped rather than the report: the words and the diagnostics are what make a
 * report actionable, and a refusal would cost all three.
 */
const SCREENSHOT_LIMIT_BYTES = 5 * 1024 * 1024;
const COPIED_RESET_MS = 4_000;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const TITLE_ID = "bug-report-title";
const DESCRIPTION_ID = "bug-report-description";
const ERROR_ID = "bug-report-description-error";
const COUNTER_ID = "bug-report-description-count";
/**
 * Defer to whoever locked the body first, and hand back the undo.
 *
 * A counter of our own cannot work here: the folder must not import the app's
 * Modal, so the two counters would be independent, and both restore the same
 * `document.body.style.overflow`. Whichever unlocks last wins — and when that is
 * this dialog it writes back the "hidden" it captured while the modal held the
 * lock, leaving the panel unscrollable until a reload. Doing nothing when the
 * body is already hidden leaves exactly one owner of the property.
 */
function lockBodyScroll() {
    if (document.body.style.overflow === "hidden")
        return () => { };
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
        document.body.style.overflow = original;
    };
}
export function BugReportDialog(props) {
    const { capture, labels, context, environment, diagnostics, submit, onClose } = props;
    const [dataUrl, setDataUrl] = useState(capture.ok ? capture.dataUrl : null);
    const [description, setDescription] = useState("");
    const [impact, setImpact] = useState("workaround");
    const [invalid, setInvalid] = useState(false);
    const [oversize, setOversize] = useState(false);
    const [copyState, setCopyState] = useState("idle");
    const [phase, setPhase] = useState({ name: "editing" });
    const paneRef = useRef(null);
    const panelRef = useRef(null);
    const descriptionRef = useRef(null);
    const successRef = useRef(null);
    const manualRef = useRef(null);
    useEffect(() => {
        const trapTab = (event) => {
            const panel = panelRef.current;
            if (!panel)
                return;
            const stops = [...panel.querySelectorAll(FOCUSABLE)];
            if (stops.length === 0)
                return;
            const first = stops[0];
            const last = stops[stops.length - 1];
            const active = document.activeElement;
            const outside = !(active instanceof Node) || !panel.contains(active);
            if (event.shiftKey && (outside || active === first)) {
                event.preventDefault();
                last.focus();
            }
            else if (!event.shiftKey && (outside || active === last)) {
                event.preventDefault();
                first.focus();
            }
        };
        const onKey = (event) => {
            if (event.key === "Escape") {
                // While this dialog is open the key is ours, whatever we do with it. The
                // app's Modal listens for Escape on `window` too and this dialog opens on
                // top of one, so without stopping it here a single press closes both and
                // takes the form the reporter was filling in with it.
                event.stopImmediatePropagation();
                // Not while sending: the request is already on its way, and closing here
                // would lose the reporter's words with no way to tell them whether it
                // landed.
                if (phase.name !== "sending")
                    onClose();
                return;
            }
            if (event.key === "Tab")
                trapTab(event);
            // The page's search shortcut, also on `window`. Letting it through moves
            // focus to a box hidden under this overlay: the reporter types into what
            // they cannot see, Enter navigates the page underneath, and the Escape
            // they reach for next closes the report.
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
                event.stopImmediatePropagation();
                event.preventDefault();
            }
        };
        // Capture phase, so this runs before any listener the page registered on
        // `window` in the usual way — stopping propagation from the bubble phase
        // would be too late to keep the modal underneath from seeing the key.
        window.addEventListener("keydown", onKey, { capture: true });
        return () => window.removeEventListener("keydown", onKey, { capture: true });
    }, [onClose, phase.name]);
    useEffect(() => {
        const restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const unlockBodyScroll = lockBodyScroll();
        // The dialog is a portal at the end of <body>, so without this the caret
        // stays behind on the page the reporter just photographed.
        descriptionRef.current?.focus();
        return () => {
            unlockBodyScroll();
            restoreTo?.focus();
        };
    }, []);
    useEffect(() => {
        if (phase.name === "sent")
            successRef.current?.focus();
    }, [phase.name]);
    useEffect(() => {
        if (copyState !== "copied")
            return;
        const timer = setTimeout(() => setCopyState("idle"), COPIED_RESET_MS);
        return () => clearTimeout(timer);
    }, [copyState]);
    useEffect(() => {
        if (copyState !== "manual")
            return;
        manualRef.current?.focus();
        manualRef.current?.select();
    }, [copyState]);
    const sending = phase.name === "sending";
    async function send() {
        // aria-disabled leaves the button clickable, so the guard the attribute only
        // advertises has to live here.
        if (sending)
            return;
        if (description.trim() === "") {
            setInvalid(true);
            descriptionRef.current?.focus();
            return;
        }
        setInvalid(false);
        setPhase({ name: "sending" });
        // Text-only until the export says otherwise, and declared out here so the
        // failure phase can hand the reporter their words back however far the
        // attempt got. The export itself is awaited INSIDE the try: a handle that
        // rejects rather than resolving null would otherwise leave the dialog stuck
        // on "sending", with Escape and Cancel both refusing to close it.
        let payload = {
            kind: "bug",
            summary: "",
            description: description.trim(),
            impact,
            context,
            environment,
            diagnostics,
            screenshot: null,
        };
        try {
            const screenshot = (await paneRef.current?.toBlob()) ?? null;
            const tooLarge = screenshot !== null && screenshot.size > SCREENSHOT_LIMIT_BYTES;
            setOversize(tooLarge);
            payload = { ...payload, screenshot: tooLarge ? null : screenshot };
            const result = await submit(buildBugReportForm(payload));
            setPhase({ name: "sent", number: result.number });
        }
        catch (error) {
            // The reporter's words must survive a network blip; the failure state
            // hands them back rather than asking them to type it all again. The
            // server's own sentence goes with them — "not configured" and "try again
            // in 40 seconds" are different problems and only one is worth retrying.
            setPhase({
                name: "failed",
                payload,
                detail: error instanceof Error ? error.message : null,
            });
        }
    }
    async function copyReport(payload) {
        const text = reportAsText(payload);
        try {
            // Absent outside a secure context, and a present one still rejects when
            // the document is not focused or permission is refused. Both end in the
            // same place: the text on screen, selected, for a manual Ctrl+C.
            if (!window.navigator.clipboard) {
                throw new Error("clipboard unavailable");
            }
            await window.navigator.clipboard.writeText(text);
            setCopyState("copied");
        }
        catch {
            setCopyState("manual");
        }
    }
    // Everything the submission carries, so nobody sends what they have not seen.
    // The request id is the host's own reference and is shown only when the host
    // gives one. The reporter's identity is not listed: the server adds it from
    // its own session, so nothing here can name the reporter wrongly.
    const contextRows = [
        [labels.contextRoute, context.area],
        [labels.contextVersion, context.version],
        ...(typeof context.requestId === "string" && context.requestId !== ""
            ? [[labels.contextRequestId, context.requestId]]
            : []),
        [labels.contextBrowser, environment.user_agent],
        [labels.contextViewport, environment.viewport],
        [labels.contextTimestamp, environment.at],
    ];
    const describedBy = invalid ? `${ERROR_ID} ${COUNTER_ID}` : COUNTER_ID;
    return createPortal(_jsx("div", { style: styles.overlay, role: "dialog", "aria-modal": "true", "aria-labelledby": TITLE_ID, children: _jsxs("div", { ref: panelRef, style: styles.panel, children: [_jsx("h2", { id: TITLE_ID, style: styles.title, children: labels.dialogTitle }), phase.name === "sent" ? (_jsxs("div", { style: styles.phaseRegion, children: [_jsxs("div", { role: "status", children: [_jsx("p", { ref: successRef, tabIndex: -1, children: labels.successTitle }), _jsx("p", { children: formatFiled(labels.filed, phase.number) }), oversize ? _jsx("p", { style: styles.muted, children: labels.screenshotTooLarge }) : null] }), _jsx("div", { style: styles.actions, children: _jsx("button", { type: "button", style: styles.primaryButton, onClick: onClose, children: labels.close }) })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { style: styles.columns, children: [_jsx("div", { style: styles.imageColumn, children: _jsx(ScreenshotPane, { ref: paneRef, dataUrl: dataUrl, labels: labels, onImageChosen: setDataUrl }) }), _jsxs("div", { style: styles.formColumn, children: [_jsxs("div", { children: [_jsx("label", { htmlFor: DESCRIPTION_ID, style: styles.label, children: labels.descriptionLabel }), _jsx("textarea", { id: DESCRIPTION_ID, ref: descriptionRef, style: styles.textarea, placeholder: labels.descriptionPlaceholder, maxLength: DESCRIPTION_LIMIT, required: true, "aria-invalid": invalid, "aria-describedby": describedBy, value: description, onChange: (event) => {
                                                        setDescription(event.target.value);
                                                        if (invalid)
                                                            setInvalid(false);
                                                    } }), _jsx("p", { id: COUNTER_ID, style: styles.counter, children: labels.characterCount(description.length, DESCRIPTION_LIMIT) }), invalid ? (_jsx("p", { id: ERROR_ID, role: "alert", style: styles.error, children: labels.descriptionRequired })) : null] }), _jsxs("fieldset", { style: { border: "none", margin: 0, padding: 0 }, children: [_jsx("legend", { style: styles.label, children: labels.impactLabel }), BUG_IMPACTS.map((value) => (_jsxs("label", { style: styles.radioRow, htmlFor: `bug-report-impact-${value}`, children: [_jsx("input", { id: `bug-report-impact-${value}`, type: "radio", name: "bug-report-impact", checked: impact === value, onChange: () => setImpact(value) }), labels[IMPACT_LABEL[value]]] }, value)))] }), _jsxs("div", { children: [_jsx("p", { style: styles.label, children: labels.contextTitle }), _jsx("table", { style: styles.contextTable, children: _jsx("tbody", { children: contextRows.map(([key, value]) => (_jsxs("tr", { children: [_jsx("th", { scope: "row", style: styles.contextKey, children: key }), _jsx("td", { style: styles.contextValue, children: value })] }, key))) }) })] })] })] }), _jsxs("div", { style: styles.phaseRegion, children: [_jsxs("div", { role: "status", children: [phase.name === "sending" ? _jsx("p", { style: styles.muted, children: labels.sending }) : null, phase.name === "failed" ? (_jsxs(_Fragment, { children: [_jsx("p", { style: styles.error, children: labels.failureTitle }), phase.detail ? _jsx("p", { style: styles.muted, children: phase.detail }) : null, oversize ? _jsx("p", { style: styles.muted, children: labels.screenshotTooLarge }) : null] })) : null] }), phase.name === "failed" ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", style: styles.secondaryButton, onClick: () => copyReport(phase.payload), children: copyState === "copied" ? labels.copied : labels.copyToClipboard }), copyState === "manual" ? (_jsxs(_Fragment, { children: [_jsx("p", { style: styles.muted, children: labels.copyManually }), _jsx("textarea", { ref: manualRef, readOnly: true, style: styles.textarea, "aria-label": labels.copyToClipboard, value: reportAsText(phase.payload) })] })) : null] })) : null] }), _jsxs("div", { style: styles.actions, children: [_jsx("button", { type: "button", style: sending ? { ...styles.secondaryButton, ...styles.buttonBusy } : styles.secondaryButton, onClick: () => {
                                        if (!sending)
                                            onClose();
                                    }, "aria-disabled": sending, children: labels.cancel }), _jsx("button", { type: "button", style: sending ? { ...styles.primaryButton, ...styles.buttonBusy } : styles.primaryButton, onClick: send, "aria-disabled": sending, children: sending ? labels.sending : labels.send })] })] }))] }) }), document.body);
}
