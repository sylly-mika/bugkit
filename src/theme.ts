import { useInsertionEffect } from "react";

export const BUG_REPORT_PARTS = [
  "launcher",
  "overlay",
  "panel",
  "header",
  "header-text",
  "header-end",
  "back-button",
  "title",
  "muted",
  "phase",
  "actions",
  "body",
  "image-column",
  "form",
  "kind-choices",
  "impact-choices",
  "field",
  "label",
  "choice",
  "input",
  "textarea",
  "counter",
  "error",
  "disclosure",
  "context-table",
  "context-key",
  "context-value",
  "note",
  "confirm",
  "confirm-title",
  "primary-button",
  "secondary-button",
  "toolbar",
  "tool",
  "zoom-level",
  "placeholder",
  "canvas-scroll",
  "canvas-stage",
  "canvas",
  "text-input",
] as const;

export type BugReportPart = (typeof BUG_REPORT_PARTS)[number];

export type BugReportClassNames = Partial<Record<BugReportPart, string>>;

// WHY: unlayered rules beat every layer, so an unlayered sheet would beat Tailwind v4 utilities; a layer declared first and placed between `base` and `components` sits above Tailwind v4's preflight (the look survives, as the admin needs) and below its utilities and any unlayered app CSS (app classes win). On a page without Tailwind the other four layers are empty.
export const BUGKIT_CSS = `@layer theme, base, bugkit, components, utilities;
@layer bugkit {
  :where([data-bugkit="overlay"]) {
    position: fixed;
    inset: 0px;
    /* WHY: above Modal (z-50), so a report can be filed while a form modal is open, and above the header the launcher's slot sits in. Below the toasts (z-60): at the same index the later node paints on top, and this one is a portal at the end of <body>, so "level" meant a save that failed while the reporter typed was announced behind the scrim, its close button unreachable. */
    z-index: 59;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 16px;
    overflow: auto;
    background: rgba(0,0,0,0.5);
  }
  :where([data-bugkit="title"]) {
    margin: 0px;
    font-size: var(--font-lg, 16px);
    font-weight: 600;
  }
  :where([data-bugkit="confirm-title"]) {
    margin: 0px;
    font-size: var(--font-lg, 16px);
    font-weight: 600;
  }
  :where([data-bugkit="panel"]) {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: 16px;
    border-radius: var(--radius-md, 12px);
    background: var(--color-card, #ffffff);
    color: var(--color-card-foreground, #171717);
    font-size: var(--font-base, 14px);
    overflow: hidden;
  }
  :where([data-bugkit="header"]) {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  :where([data-bugkit="header-text"]) {
    flex: 1;
    min-width: 0px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  :where([data-bugkit="header-end"]) {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  :where([data-bugkit="back-button"]) {
    padding: 4px 10px;
    border: 1px solid var(--color-input, #d6d6d6);
    border-radius: var(--radius-sm, 8px);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  :where([data-bugkit="body"]) {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    flex: 1;
    min-height: 0px;
    align-items: stretch;
  }
  :where([data-bugkit="image-column"]) {
    flex: 1 1 560px;
    min-width: 280px;
    min-height: 0px;
    overflow: auto;
  }
  :where([data-bugkit="form"]) {
    flex: 0 1 400px;
    min-width: 260px;
    min-height: 0px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  :where([data-bugkit="kind-choices"]) {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  :where([data-bugkit="impact-choices"]) {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  :where([data-bugkit="field"]) {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  :where([data-bugkit="input"]) {
    width: 100%;
    box-sizing: border-box;
    padding: 8px;
    border: 1px solid var(--color-input, #d6d6d6);
    border-radius: var(--radius-sm, 8px);
    background: var(--color-background, #ffffff);
    color: var(--color-foreground, #171717);
    font: inherit;
  }
  :where([data-bugkit="disclosure"]) {
    align-self: flex-start;
    padding: 0px;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  :where([data-bugkit="note"]) {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    border-radius: var(--radius-sm, 8px);
    background: var(--color-muted, #f5f5f5);
  }
  :where([data-bugkit="confirm"]) {
    position: absolute;
    top: 30%;
    left: 50%;
    transform: translateX(-50%);
    width: 360px;
    max-width: 90%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border-radius: var(--radius-md, 12px);
    background: var(--color-card, #ffffff);
    box-shadow: 0 8px 32px rgba(0,0,0,0.25);
  }
  :where([data-bugkit="label"]) {
    display: block;
    margin-bottom: 4px;
    font-size: var(--font-sm, 13px);
    font-weight: 500;
  }
  :where([data-bugkit="textarea"]) {
    width: 100%;
    min-height: 96px;
    padding: 8px;
    border: 1px solid var(--color-input, #d6d6d6);
    border-radius: var(--radius-sm, 8px);
    background: var(--color-background, #ffffff);
    color: var(--color-foreground, #171717);
    font: inherit;
    resize: vertical;
  }
  :where([data-bugkit="choice"]) {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--font-sm, 13px);
  }
  :where([data-bugkit="placeholder"]) {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 240px;
    padding: 16px;
    border: 1px dashed var(--color-border, #e5e5e5);
    border-radius: var(--radius-sm, 8px);
    color: var(--color-muted-foreground, #666666);
    text-align: center;
  }
  :where([data-bugkit="canvas"]) {
    display: block;
    max-width: 100%;
    border: 1px solid var(--color-border, #e5e5e5);
    border-radius: var(--radius-sm, 8px);
  }
  :where([data-bugkit="canvas-scroll"]) {
    overflow: auto;
    max-height: 70vh;
  }
  :where([data-bugkit="canvas-stage"]) {
    display: inline-block;
    max-width: 100%;
  }
  :where([data-bugkit="text-input"]) {
    min-width: 120px;
    padding: 2px 4px;
    border: 1px solid var(--color-ring, #171717);
    background: #ffffff;
    color: #e11d48;
    font: 600 14px system-ui, sans-serif;
  }
  :where([data-bugkit="zoom-level"]) {
    min-width: 48px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-xs, 11px);
  }
  :where([data-bugkit="context-table"]) {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-xs, 11px);
  }
  :where([data-bugkit="context-key"]) {
    padding: 2px 8px 2px 0px;
    text-align: left;
    font-weight: 500;
    color: var(--color-muted-foreground, #666666);
    white-space: nowrap;
    vertical-align: top;
  }
  :where([data-bugkit="context-value"]) {
    padding: 2px 0px;
    word-break: break-all;
  }
  :where([data-bugkit="actions"]) {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  :where([data-bugkit="primary-button"]) {
    height: 36px;
    padding: 0px 16px;
    border: none;
    border-radius: var(--radius-sm, 8px);
    background: var(--color-primary, #171717);
    color: var(--color-primary-foreground, #ffffff);
    font: inherit;
    cursor: pointer;
  }
  /* WHY: Send and Cancel say aria-disabled rather than disabled, so the browser does not grey them for us. Without this the two look live while they are inert. */
  :where([data-bugkit="primary-button"][aria-disabled="true"]) {
    opacity: 0.6;
    cursor: not-allowed;
  }
  :where([data-bugkit="secondary-button"]) {
    height: 36px;
    padding: 0px 16px;
    border: 1px solid var(--color-border, #e5e5e5);
    border-radius: var(--radius-sm, 8px);
    background: transparent;
    color: var(--color-foreground, #171717);
    font: inherit;
    cursor: pointer;
  }
  :where([data-bugkit="toolbar"]) {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
  }
  :where([data-bugkit="tool"]) {
    height: 28px;
    padding: 0px 8px;
    border: 1px solid var(--color-border, #e5e5e5);
    border-radius: var(--radius-xs, 2px);
    background: transparent;
    color: var(--color-foreground, #171717);
    font: inherit;
    font-size: var(--font-xs, 11px);
    cursor: pointer;
  }
  /* WHY: the full border shorthand, not border-color, because tool sets the shorthand; a longhand here would leave the active button's border half-set as the selection moves. */
  :where([data-bugkit="tool"][aria-pressed="true"]) {
    background: var(--color-accent, #f5f5f5);
    border: 1px solid var(--color-ring, #171717);
  }
  /* WHY: the one colour the folder does not borrow from the panel. --color-destructive is 3.79:1 on the dark card, under the 4.5:1 a body-text error has to clear, and no single literal can pass against BOTH a white card and a #1a1a1a one; the two requirements point opposite ways. light-dark() reads the color-scheme the theme already sets (:root light, .dark dark), giving 6.5:1 and 7.3:1. */
  :where([data-bugkit="error"]) {
    color: light-dark(#b3261e, #f28b82);
    font-size: var(--font-sm, 13px);
  }
  :where([data-bugkit="muted"]) {
    color: var(--color-muted-foreground, #666666);
    font-size: var(--font-sm, 13px);
  }
  :where([data-bugkit="counter"]) {
    align-self: flex-end;
    font-size: var(--font-xs, 11px);
    color: var(--color-muted-foreground, #666666);
  }
  :where([data-bugkit="phase"]) {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
}`;

export function useBugkitStyles(nonce?: string): void {
  useInsertionEffect(() => {
    if (document.head.querySelector("style[data-bugkit-styles]")) return;
    const style = document.createElement("style");
    style.setAttribute("data-bugkit-styles", "");
    if (nonce) style.setAttribute("nonce", nonce);
    style.textContent = BUGKIT_CSS;
    document.head.prepend(style);
  }, [nonce]);
}

export function partProps(
  classNames: BugReportClassNames | undefined,
  part: BugReportPart,
  extra?: string,
): { "data-bugkit": BugReportPart; className?: string } {
  const className = [extra, classNames?.[part]].filter(Boolean).join(" ");
  return { "data-bugkit": part, ...(className ? { className } : {}) };
}
