import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ScreenshotPane } from "./ScreenshotPane.js";
import { partProps, useBugkitStyles } from "./theme.js";
import { BUG_KINDS, SUMMARY_LIMIT, buildBugReportForm, reportAsText, } from "./payload.js";
import { formatFiled } from "./labels.js";
import { DESCRIPTION_LIMIT, clearDraft, readDraft, writeDraft } from "./draft.js";
// WHY: the backend refuses a larger screenshot with a 413; past the cap the image is dropped, never the report.
const SCREENSHOT_LIMIT_BYTES = 5 * 1024 * 1024;
const COPIED_RESET_MS = 4_000;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const TITLE_ID = "bug-report-title";
const KIND_ID = "bug-report-kind-label";
const SUMMARY_ID = "bug-report-summary";
const SUMMARY_ERROR_ID = "bug-report-summary-error";
const DESCRIPTION_ID = "bug-report-description";
const ERROR_ID = "bug-report-description-error";
const COUNTER_ID = "bug-report-description-count";
const IMPACT_ID = "bug-report-impact-label";
const TECHNICAL_ID = "bug-report-technical";
const TECHNICAL_HINT_ID = "bug-report-technical-hint";
const SHARED_ID = "bug-report-shared";
const SHARED_HINT_ID = "bug-report-shared-hint";
const DISCARD_TITLE_ID = "bug-report-discard-title";
const DISCARD_BODY_ID = "bug-report-discard-body";
// WHY: the Modal restores the same body overflow; a second counter would write back a stale "hidden".
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
    const { capture, labels, context, environment, diagnostics, submit, onClose, classNames, nonce } = props;
    useBugkitStyles(nonce);
    const [restored] = useState(readDraft);
    const [kind, setKind] = useState(restored?.kind ?? "bug");
    const [summary, setSummary] = useState(restored?.summary ?? "");
    const [description, setDescription] = useState(restored?.description ?? "");
    const [impact, setImpact] = useState(restored?.impact ?? "workaround");
    const [draftSaved, setDraftSaved] = useState(restored !== null);
    const [dataUrl, setDataUrl] = useState(capture.ok ? capture.dataUrl : null);
    const [summaryInvalid, setSummaryInvalid] = useState(false);
    const [descriptionInvalid, setDescriptionInvalid] = useState(false);
    const [oversize, setOversize] = useState(false);
    const [copyState, setCopyState] = useState("idle");
    const [phase, setPhase] = useState({ name: "editing" });
    const [expanded, setExpanded] = useState(false);
    const [technicalOpen, setTechnicalOpen] = useState(false);
    const [sharedOpen, setSharedOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [markedUp, setMarkedUp] = useState(false);
    const paneRef = useRef(null);
    const panelRef = useRef(null);
    const summaryRef = useRef(null);
    const descriptionRef = useRef(null);
    const successRef = useRef(null);
    const manualRef = useRef(null);
    const keepEditingRef = useRef(null);
    const k = labels[kind];
    const sending = phase.name === "sending";
    const sent = phase.name === "sent";
    const hasWork = !sent && (summary !== "" || description !== "" || markedUp);
    const impactOptions = [
        { value: "blocks", label: k.impactBlocks, hint: k.impactBlocksHint },
        { value: "workaround", label: k.impactWorkaround, hint: k.impactWorkaroundHint },
        { value: "cosmetic", label: k.impactCosmetic, hint: k.impactCosmeticHint },
    ];
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
                // WHY: the app's Modal also listens for Escape on window; without stopping it here one press closes both.
                event.stopImmediatePropagation();
                // WHY: while sending, Escape must not close: the reporter could not tell whether their words landed.
                if (sending)
                    return;
                // WHY: a text box open on the screenshot takes Escape first, so it ends the edit, not the report.
                if (paneRef.current?.cancelText())
                    return;
                if (confirming) {
                    setConfirming(false);
                    return;
                }
                if (hasWork)
                    setConfirming(true);
                else
                    onClose();
                return;
            }
            if (event.key === "Tab")
                trapTab(event);
            // WHY: the page's search shortcut is also on window; letting it through focuses a box hidden under this overlay.
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
                event.stopImmediatePropagation();
                event.preventDefault();
            }
        };
        // WHY: capture phase, so it runs before the page's window listeners; bubble-phase stopping comes too late.
        window.addEventListener("keydown", onKey, { capture: true });
        return () => window.removeEventListener("keydown", onKey, { capture: true });
    }, [onClose, sending, confirming, hasWork]);
    useEffect(() => {
        const restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const unlockBodyScroll = lockBodyScroll();
        // WHY: the dialog is a portal at the end of body; without this the caret stays on the photographed page.
        summaryRef.current?.focus();
        return () => {
            unlockBodyScroll();
            restoreTo?.focus();
        };
    }, []);
    useEffect(() => {
        if (sent)
            successRef.current?.focus();
    }, [sent]);
    useEffect(() => {
        if (confirming)
            keepEditingRef.current?.focus();
    }, [confirming]);
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
    // WHY: storage that refuses the write must not claim a save; the indicator reports
    // only what the browser confirmed.
    function persist(next) {
        if (next.summary.trim() === "" && next.description.trim() === "") {
            clearDraft();
            setDraftSaved(false);
        }
        else {
            setDraftSaved(writeDraft(next));
        }
    }
    function changeKind(value) {
        setKind(value);
        persist({ kind: value, summary, description, impact });
    }
    function changeSummary(value) {
        setSummary(value);
        if (summaryInvalid)
            setSummaryInvalid(false);
        persist({ kind, summary: value, description, impact });
    }
    function changeDescription(value) {
        setDescription(value);
        if (descriptionInvalid)
            setDescriptionInvalid(false);
        persist({ kind, summary, description: value, impact });
    }
    function changeImpact(value) {
        setImpact(value);
        persist({ kind, summary, description, impact: value });
    }
    function requestClose() {
        if (sending)
            return;
        if (hasWork)
            setConfirming(true);
        else
            onClose();
    }
    function discard() {
        clearDraft();
        onClose();
    }
    async function send() {
        // WHY: aria-disabled leaves the button clickable, so the guard has to live in the handler.
        if (sending)
            return;
        const missingSummary = summary.trim() === "";
        const missingDescription = description.trim() === "";
        setSummaryInvalid(missingSummary);
        setDescriptionInvalid(!missingSummary && missingDescription);
        if (missingSummary) {
            summaryRef.current?.focus();
            return;
        }
        if (missingDescription) {
            descriptionRef.current?.focus();
            return;
        }
        setPhase({ name: "sending" });
        // WHY: declared outside the try so failure can return the words; an export that rejects must not strand "sending".
        let payload = {
            kind,
            summary: summary.trim(),
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
            clearDraft();
            setDraftSaved(false);
            setPhase({ name: "sent", number: result.number });
        }
        catch (error) {
            // WHY: keep the server's sentence too; "not configured" and "try again" need different actions.
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
    // WHY: the reporter's identity is left out; the server adds it from its own session.
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
    const descriptionDescribedBy = descriptionInvalid ? `${ERROR_ID} ${COUNTER_ID}` : COUNTER_ID;
    return createPortal(_jsx("div", { ...partProps(classNames, "overlay"), role: "dialog", "aria-modal": "true", "aria-labelledby": TITLE_ID, children: _jsxs("div", { ref: panelRef, ...partProps(classNames, "panel"), children: [_jsxs("header", { ...partProps(classNames, "header"), children: [_jsx("button", { type: "button", "aria-label": labels.back, ...partProps(classNames, "back-button"), onClick: requestClose, "aria-disabled": sending, children: "\u2190" }), _jsxs("div", { ...partProps(classNames, "header-text"), children: [_jsx("h2", { id: TITLE_ID, ...partProps(classNames, "title"), children: k.title }), _jsx("p", { ...partProps(classNames, "muted"), children: k.subtitle })] }), _jsxs("div", { ...partProps(classNames, "header-end"), children: [draftSaved && !sent ? (_jsxs("p", { ...partProps(classNames, "muted"), children: [_jsx("span", { "aria-hidden": "true", children: "\u2713 " }), _jsx("span", { children: labels.saved })] })) : null, sent ? null : (_jsx("button", { type: "button", ...partProps(classNames, "primary-button"), onClick: send, "aria-disabled": sending, children: sending ? labels.sending : k.send }))] })] }), sent ? (_jsxs("div", { ...partProps(classNames, "phase"), children: [_jsxs("div", { role: "status", children: [_jsx("p", { ref: successRef, tabIndex: -1, children: labels.successTitle }), _jsx("p", { children: formatFiled(labels.filed, phase.number) }), oversize ? _jsx("p", { ...partProps(classNames, "muted"), children: labels.screenshotTooLarge }) : null] }), _jsx("div", { ...partProps(classNames, "actions"), children: _jsx("button", { type: "button", ...partProps(classNames, "primary-button"), onClick: onClose, children: labels.close }) })] })) : (_jsxs("div", { ...partProps(classNames, "body"), children: [_jsx("div", { ...partProps(classNames, "image-column"), children: _jsx(ScreenshotPane, { ref: paneRef, dataUrl: dataUrl, labels: labels, onImageChosen: setDataUrl, expanded: expanded, onToggleExpanded: () => setExpanded(!expanded), onMarkupChange: setMarkedUp, classNames: classNames }) }), expanded ? null : (_jsxs("div", { ...partProps(classNames, "form"), children: [_jsxs("div", { role: "radiogroup", "aria-labelledby": KIND_ID, ...partProps(classNames, "kind-choices"), children: [_jsx("p", { id: KIND_ID, ...partProps(classNames, "label"), children: labels.kindLabel }), BUG_KINDS.map((value) => {
                                            const id = `bug-report-kind-${value}`;
                                            return (_jsxs("label", { ...partProps(classNames, "choice"), htmlFor: id, children: [_jsx("input", { id: id, type: "radio", name: "bug-report-kind", value: value, checked: kind === value, onChange: () => changeKind(value) }), value === "bug" ? labels.kindBug : labels.kindFeature] }, value));
                                        })] }), _jsxs("div", { ...partProps(classNames, "field"), children: [_jsx("label", { htmlFor: SUMMARY_ID, ...partProps(classNames, "label"), children: labels.summaryLabel }), _jsx("input", { id: SUMMARY_ID, ref: summaryRef, type: "text", ...partProps(classNames, "input"), placeholder: labels.summaryPlaceholder, maxLength: SUMMARY_LIMIT, "aria-required": "true", "aria-invalid": summaryInvalid, "aria-describedby": summaryInvalid ? SUMMARY_ERROR_ID : undefined, value: summary, onChange: (event) => changeSummary(event.target.value) }), summaryInvalid ? (_jsx("p", { id: SUMMARY_ERROR_ID, role: "alert", ...partProps(classNames, "error"), children: labels.summaryRequired })) : null] }), _jsxs("div", { ...partProps(classNames, "field"), children: [_jsx("label", { htmlFor: DESCRIPTION_ID, ...partProps(classNames, "label"), children: k.descriptionLabel }), _jsx("textarea", { id: DESCRIPTION_ID, ref: descriptionRef, ...partProps(classNames, "textarea"), placeholder: k.descriptionPlaceholder, maxLength: DESCRIPTION_LIMIT, required: true, "aria-invalid": descriptionInvalid, "aria-describedby": descriptionDescribedBy, value: description, onChange: (event) => changeDescription(event.target.value) }), _jsx("p", { id: COUNTER_ID, ...partProps(classNames, "counter"), children: labels.characterCount(description.length, DESCRIPTION_LIMIT) }), descriptionInvalid ? (_jsx("p", { id: ERROR_ID, role: "alert", ...partProps(classNames, "error"), children: k.descriptionRequired })) : null] }), _jsxs("div", { role: "radiogroup", "aria-labelledby": IMPACT_ID, ...partProps(classNames, "impact-choices"), children: [_jsx("p", { id: IMPACT_ID, ...partProps(classNames, "label"), children: k.impactLabel }), impactOptions.map(({ value, label, hint }) => {
                                            const id = `bug-report-impact-${value}`;
                                            const hintId = `${id}-hint`;
                                            return (_jsxs("div", { children: [_jsxs("label", { ...partProps(classNames, "choice"), htmlFor: id, children: [_jsx("input", { id: id, type: "radio", name: "bug-report-impact", checked: impact === value, "aria-describedby": hintId, onChange: () => changeImpact(value) }), label] }), _jsx("p", { id: hintId, ...partProps(classNames, "muted"), children: hint })] }, value));
                                        })] }), _jsxs("div", { ...partProps(classNames, "field"), children: [_jsx("button", { type: "button", ...partProps(classNames, "disclosure"), "aria-expanded": technicalOpen, "aria-controls": TECHNICAL_ID, "aria-describedby": TECHNICAL_HINT_ID, onClick: () => setTechnicalOpen(!technicalOpen), children: labels.technicalTitle }), _jsx("p", { id: TECHNICAL_HINT_ID, ...partProps(classNames, "muted"), children: labels.technicalHint }), _jsx("div", { id: TECHNICAL_ID, children: technicalOpen ? (_jsx("table", { ...partProps(classNames, "context-table"), children: _jsx("tbody", { children: contextRows.map(([key, value]) => (_jsxs("tr", { children: [_jsx("th", { scope: "row", ...partProps(classNames, "context-key"), children: key }), _jsx("td", { ...partProps(classNames, "context-value"), children: value })] }, key))) }) })) : null })] }), _jsxs("div", { ...partProps(classNames, "field"), children: [_jsx("button", { type: "button", ...partProps(classNames, "disclosure"), "aria-expanded": sharedOpen, "aria-controls": SHARED_ID, "aria-describedby": SHARED_HINT_ID, onClick: () => setSharedOpen(!sharedOpen), children: labels.sharedTitle }), _jsx("p", { id: SHARED_HINT_ID, ...partProps(classNames, "muted"), children: labels.sharedHint }), _jsx("div", { id: SHARED_ID, children: sharedOpen ? _jsx("p", { ...partProps(classNames, "muted"), children: labels.sharedBody }) : null })] }), _jsxs("div", { role: "note", ...partProps(classNames, "note"), children: [_jsx("p", { ...partProps(classNames, "label"), children: labels.sensitiveTitle }), _jsx("p", { ...partProps(classNames, "muted"), children: labels.sensitiveBody })] }), _jsxs("div", { ...partProps(classNames, "phase"), children: [_jsxs("div", { role: "status", children: [phase.name === "sending" ? (_jsx("p", { ...partProps(classNames, "muted"), children: labels.sending })) : null, phase.name === "failed" ? (_jsxs(_Fragment, { children: [_jsx("p", { ...partProps(classNames, "error"), children: labels.failureTitle }), phase.detail ? _jsx("p", { ...partProps(classNames, "muted"), children: phase.detail }) : null, oversize ? _jsx("p", { ...partProps(classNames, "muted"), children: labels.screenshotTooLarge }) : null] })) : null] }), phase.name === "failed" ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", ...partProps(classNames, "secondary-button"), onClick: () => copyReport(phase.payload), children: copyState === "copied" ? labels.copied : labels.copyToClipboard }), copyState === "manual" ? (_jsxs(_Fragment, { children: [_jsx("p", { ...partProps(classNames, "muted"), children: labels.copyManually }), _jsx("textarea", { ref: manualRef, readOnly: true, ...partProps(classNames, "textarea"), "aria-label": labels.copyToClipboard, value: reportAsText(phase.payload) })] })) : null] })) : null] })] }))] })), confirming ? (_jsxs("div", { role: "alertdialog", "aria-labelledby": DISCARD_TITLE_ID, "aria-describedby": DISCARD_BODY_ID, ...partProps(classNames, "confirm"), children: [_jsx("h3", { id: DISCARD_TITLE_ID, ...partProps(classNames, "confirm-title"), children: labels.discardTitle }), _jsx("p", { id: DISCARD_BODY_ID, ...partProps(classNames, "muted"), children: labels.discardBody }), _jsxs("div", { ...partProps(classNames, "actions"), children: [_jsx("button", { type: "button", ref: keepEditingRef, ...partProps(classNames, "primary-button"), onClick: () => setConfirming(false), children: labels.keepEditing }), _jsx("button", { type: "button", ...partProps(classNames, "secondary-button"), onClick: discard, children: labels.discard })] })] })) : null] }) }), document.body);
}
