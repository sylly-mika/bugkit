import type { CSSProperties } from "react";

export const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    // Above Modal (z-50), so a report can be filed while a form modal is open,
    // and above the header the launcher's slot sits in. Below the toasts (z-60): at
    // the same index the later node paints on top, and this one is a portal at
    // the end of <body> — so "level" meant a save that failed while the
    // reporter typed was announced behind the scrim, its close button
    // unreachable.
    zIndex: 59,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: 16,
    overflow: "auto",
    background: "rgba(0,0,0,0.5)",
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    width: "100%",
    maxWidth: 1080,
    padding: 16,
    borderRadius: "var(--radius-md, 12px)",
    background: "var(--color-card, #ffffff)",
    color: "var(--color-card-foreground, #171717)",
    fontSize: "var(--font-base, 14px)",
  },
  title: { margin: 0, fontSize: "var(--font-lg, 16px)", fontWeight: 600 },
  columns: { display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" },
  imageColumn: { flex: "2 1 480px", minWidth: 280 },
  formColumn: {
    flex: "1 1 280px",
    minWidth: 260,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  label: { display: "block", marginBottom: 4, fontSize: "var(--font-sm, 13px)", fontWeight: 500 },
  textarea: {
    width: "100%",
    minHeight: 96,
    padding: 8,
    border: "1px solid var(--color-input, #d6d6d6)",
    borderRadius: "var(--radius-sm, 8px)",
    background: "var(--color-background, #ffffff)",
    color: "var(--color-foreground, #171717)",
    font: "inherit",
    resize: "vertical",
  },
  radioRow: { display: "flex", alignItems: "center", gap: 8, fontSize: "var(--font-sm, 13px)" },
  placeholder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 240,
    padding: 16,
    border: "1px dashed var(--color-border, #e5e5e5)",
    borderRadius: "var(--radius-sm, 8px)",
    color: "var(--color-muted-foreground, #666666)",
    textAlign: "center",
  },
  image: {
    display: "block",
    maxWidth: "100%",
    border: "1px solid var(--color-border, #e5e5e5)",
    borderRadius: "var(--radius-sm, 8px)",
  },
  canvasScroll: { overflow: "auto", maxHeight: "70vh" },
  canvasStage: { position: "relative", display: "inline-block", maxWidth: "100%" },
  textInput: {
    position: "absolute",
    minWidth: 120,
    padding: "2px 4px",
    border: "1px solid var(--color-ring, #171717)",
    background: "#ffffff",
    color: "#e11d48",
    font: "600 14px system-ui, sans-serif",
  },
  zoomLevel: {
    minWidth: 48,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "var(--font-xs, 11px)",
  },
  contextTable: { width: "100%", borderCollapse: "collapse", fontSize: "var(--font-xs, 11px)" },
  contextKey: {
    padding: "2px 8px 2px 0",
    textAlign: "left",
    fontWeight: 500,
    color: "var(--color-muted-foreground, #666666)",
    whiteSpace: "nowrap",
    verticalAlign: "top",
  },
  contextValue: { padding: "2px 0", wordBreak: "break-all" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  primaryButton: {
    height: 36,
    padding: "0 16px",
    border: "none",
    borderRadius: "var(--radius-sm, 8px)",
    background: "var(--color-primary, #171717)",
    color: "var(--color-primary-foreground, #ffffff)",
    font: "inherit",
    cursor: "pointer",
  },
  secondaryButton: {
    height: 36,
    padding: "0 16px",
    border: "1px solid var(--color-border, #e5e5e5)",
    borderRadius: "var(--radius-sm, 8px)",
    background: "transparent",
    color: "var(--color-foreground, #171717)",
    font: "inherit",
    cursor: "pointer",
  },
  /**
   * Send and Cancel say aria-disabled rather than disabled, so the browser does
   * not grey them for us. Without this the two look live while they are inert.
   */
  buttonBusy: { opacity: 0.6, cursor: "not-allowed" },
  toolbar: { display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 },
  tool: {
    height: 28,
    padding: "0 8px",
    border: "1px solid var(--color-border, #e5e5e5)",
    borderRadius: "var(--radius-xs, 2px)",
    background: "transparent",
    color: "var(--color-foreground, #171717)",
    font: "inherit",
    fontSize: "var(--font-xs, 11px)",
    cursor: "pointer",
  },
  /**
   * The full `border` shorthand, not borderColor. `tool` sets the shorthand, so
   * a longhand here means the active button gains and loses borderColor as the
   * selection moves — and React logs "mixing shorthand and non-shorthand
   * properties can lead to styling bugs" on every tool switch.
   */
  toolActive: {
    background: "var(--color-accent, #f5f5f5)",
    border: "1px solid var(--color-ring, #171717)",
  },
  /**
   * The one colour the folder does not borrow from the panel. `--color-destructive`
   * is 3.79:1 on the dark card, under the 4.5:1 a body-text error has to clear,
   * and no single literal can pass against BOTH a white card and a #1a1a1a one —
   * the two requirements point opposite ways. light-dark() reads the color-scheme
   * the theme already sets (`:root` light, `.dark` dark), giving 6.5:1 and 7.3:1.
   */
  error: { color: "light-dark(#b3261e, #f28b82)", fontSize: "var(--font-sm, 13px)" },
  muted: { color: "var(--color-muted-foreground, #666666)", fontSize: "var(--font-sm, 13px)" },
  counter: {
    alignSelf: "flex-end",
    fontSize: "var(--font-xs, 11px)",
    color: "var(--color-muted-foreground, #666666)",
  },
  phaseRegion: { display: "flex", flexDirection: "column", gap: 8 },
} satisfies Record<string, CSSProperties>;
