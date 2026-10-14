import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from "react";
import { BugReportDialog } from "./BugReportDialog.js";
import { capturePage } from "./capture.js";
import { readEnvironment, } from "./payload.js";
import { mergeLabels } from "./labels.js";
import { partProps } from "./theme.js";
export function BugReportButton(props) {
    const { submit, getContext, diagnostics, allowedImageOrigins, className, children, onOpenChange, classNames, nonce, } = props;
    const labels = mergeLabels(props.labels);
    const [session, setSession] = useState(null);
    const [busy, setBusy] = useState(false);
    // The guard the state cannot be: two presses in one tick both read the
    // render's `busy` as false, and each starts a full-page clone.
    const capturing = useRef(false);
    async function open() {
        if (capturing.current)
            return;
        capturing.current = true;
        setBusy(true);
        try {
            // Capture first, dialog second — the page has to be photographed before
            // our own UI is in the frame. Everything else is read at the same instant
            // so the context and the image describe the same moment.
            const capture = await capturePage({ allowedImageOrigins });
            setSession({
                capture,
                context: getContext(),
                environment: readEnvironment(),
                diagnostics: diagnostics ? diagnostics() : [],
            });
            onOpenChange?.(true);
        }
        finally {
            capturing.current = false;
            setBusy(false);
        }
    }
    function close() {
        setSession(null);
        onOpenChange?.(false);
    }
    const name = busy ? labels.capturePending : labels.buttonLabel;
    return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", "data-bugreport-launcher": true, ...partProps(classNames, "launcher", className), onClick: open, "aria-busy": busy, "aria-label": name, title: name, children: children ?? name }), session ? (_jsx(BugReportDialog, { capture: session.capture, labels: labels, context: session.context, environment: session.environment, diagnostics: session.diagnostics, submit: submit, onClose: close, classNames: classNames, nonce: nonce })) : null] }));
}
