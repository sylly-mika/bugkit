import { jsx as _jsx } from "react/jsx-runtime";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { mergeLabels } from "./labels.js";
import { ScreenshotPane } from "./ScreenshotPane.js";
import { partProps, useBugkitStyles } from "./theme.js";
/** Edits one screenshot and hands back the marked-up PNG from its ref's `toBlob()`. */
export const ScreenshotEditor = forwardRef(function ScreenshotEditor({ image, labels, classNames, nonce, onMarkupChange }, ref) {
    useBugkitStyles(nonce);
    const paneRef = useRef(null);
    const [expanded, setExpanded] = useState(false);
    useImperativeHandle(ref, () => ({
        toBlob: () => (paneRef.current ? paneRef.current.toBlob() : Promise.resolve(null)),
    }), []);
    function onKeyDown(event) {
        if (event.key !== "Escape")
            return;
        if (paneRef.current?.cancelText()) {
            event.stopPropagation();
            return;
        }
        if (expanded) {
            event.stopPropagation();
            setExpanded(false);
        }
    }
    return (_jsx("div", { ...partProps(classNames, "editor"), "data-expanded": String(expanded), onKeyDown: onKeyDown, children: _jsx(ScreenshotPane, { ref: paneRef, dataUrl: image, labels: mergeLabels(labels), classNames: classNames, onImageChosen: () => { }, onMarkupChange: onMarkupChange, allowReplace: false, expanded: expanded, onToggleExpanded: () => setExpanded(!expanded) }) }));
});
