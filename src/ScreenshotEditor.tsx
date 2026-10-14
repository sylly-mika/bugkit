import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { mergeLabels, type BugReportLabelOverrides } from "./labels.js";
import { ScreenshotPane, type ScreenshotPaneHandle } from "./ScreenshotPane.js";
import { partProps, useBugkitStyles, type BugReportClassNames } from "./theme.js";

export type ScreenshotEditorHandle = {
  toBlob(): Promise<Blob | null>;
};

export type ScreenshotEditorProps = {
  image: string;
  labels?: BugReportLabelOverrides;
  classNames?: BugReportClassNames;
  nonce?: string;
  onMarkupChange?: (marked: boolean) => void;
};

/** Edits one screenshot and hands back the marked-up PNG from its ref's `toBlob()`. */
export const ScreenshotEditor = forwardRef<ScreenshotEditorHandle, ScreenshotEditorProps>(
  function ScreenshotEditor({ image, labels, classNames, nonce, onMarkupChange }, ref) {
    useBugkitStyles(nonce);
    const paneRef = useRef<ScreenshotPaneHandle>(null);
    const [expanded, setExpanded] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        toBlob: () => (paneRef.current ? paneRef.current.toBlob() : Promise.resolve(null)),
      }),
      [],
    );

    function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (event.key !== "Escape") return;
      if (paneRef.current?.cancelText()) {
        event.stopPropagation();
        return;
      }
      if (expanded) {
        event.stopPropagation();
        setExpanded(false);
      }
    }

    return (
      <div
        {...partProps(classNames, "editor")}
        data-expanded={String(expanded)}
        onKeyDown={onKeyDown}
      >
        <ScreenshotPane
          ref={paneRef}
          dataUrl={image}
          labels={mergeLabels(labels)}
          classNames={classNames}
          onImageChosen={() => {}}
          onMarkupChange={onMarkupChange}
          allowReplace={false}
          expanded={expanded}
          onToggleExpanded={() => setExpanded(!expanded)}
        />
      </div>
    );
  },
);
