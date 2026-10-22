import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { toPng } from "html-to-image";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUG_REPORT_PARTS,
  BugReportButton,
  BugReportDialog,
  ScreenshotEditor,
  defaultLabels,
  type BugReportClassNames,
} from "./index.js";
import type { BugReportContext, BugReportEnvironment } from "./payload.js";

vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

const context: BugReportContext = {
  area: "/projects/7/board",
  version: "3862535",
  requestId: "req-42",
};

const environment: BugReportEnvironment = {
  user_agent: "TestAgent/1.0",
  viewport: "1440x900",
  at: "2026-09-06T09:12:33.000Z",
};

const LAYERS = "@layer theme, base, bugkit, components, utilities;";

function dialog(overrides: Partial<Parameters<typeof BugReportDialog>[0]> = {}) {
  return (
    <BugReportDialog
      capture={{ ok: true, dataUrl: "data:image/png;base64,AAECAw==" }}
      labels={defaultLabels}
      context={context}
      environment={environment}
      diagnostics={[]}
      submit={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />
  );
}

function recordNamedParts(into: Set<string>) {
  document.querySelectorAll<HTMLElement>("[data-bugkit]").forEach((el) => {
    if (el.classList.contains(`app-${el.dataset.bugkit}`)) into.add(el.dataset.bugkit!);
  });
}

function sheet(): HTMLStyleElement | null {
  return document.head.querySelector<HTMLStyleElement>("style[data-bugkit-styles]");
}

function rule(selector: string): string {
  const text = sheet()?.textContent ?? "";
  const start = text.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = start + selector.length + 2;
  return text.slice(body, text.indexOf("}", body));
}

describe("bugkit theme", () => {
  beforeEach(() => {
    document.head.querySelectorAll("style[data-bugkit-styles]").forEach((el) => el.remove());
  });

  it("gives every part the class the app names for it", async () => {
    const classNames = Object.fromEntries(
      BUG_REPORT_PARTS.map((part) => [part, `app-${part}`]),
    ) as BugReportClassNames;
    const dialogView = render(dialog({ classNames }));

    for (const part of ["overlay", "panel", "primary-button", "tool", "canvas", "field"]) {
      expect(document.querySelector(`[data-bugkit="${part}"]`)).not.toBeNull();
    }
    const tagged = document.querySelectorAll<HTMLElement>("[data-bugkit]");
    expect(tagged.length).toBeGreaterThan(0);
    tagged.forEach((el) => {
      expect(el).toHaveClass(`app-${el.dataset.bugkit}`);
    });
    const seen = new Set<string>();
    recordNamedParts(seen);
    dialogView.unmount();

    vi.mocked(toPng).mockResolvedValue("data:image/png;base64,AAECAw==");
    const user = userEvent.setup();
    render(
      <BugReportButton
        submit={vi.fn()}
        getContext={() => ({ area: "/projects/7/board", version: "3862535" })}
        diagnostics={() => []}
        classNames={classNames}
      />,
    );
    await user.click(screen.getByRole("button", { name: defaultLabels.buttonLabel }));
    await user.click(await screen.findByRole("button", { name: defaultLabels.retakeOnKey }));
    expect(document.querySelector('[data-bugkit="capture-hint"]')).not.toBeNull();
    recordNamedParts(seen);

    for (const part of ["screenshot-modes", "screenshot-mode", "capture-hint", "capture-cancel"]) {
      expect(seen.has(part), part).toBe(true);
    }
  });

  it("keeps only the editor's geometry inline", () => {
    render(dialog());

    const overlay = document.querySelector<HTMLElement>('[data-bugkit="overlay"]')!;
    expect(overlay.hasAttribute("style")).toBe(false);
    expect(document.querySelector('[data-bugkit="panel"]')!.hasAttribute("style")).toBe(false);
    overlay.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
      expect(["canvas-stage", "canvas"]).toContain(el.dataset.bugkit);
    });
    expect(document.querySelector<HTMLElement>('[data-bugkit="canvas-stage"]')!.style.cssText).toBe(
      "position: relative;",
    );
  });

  it("puts the default look in layer bugkit with zero-specificity selectors", () => {
    render(dialog());

    const text = sheet()?.textContent ?? "";
    expect(text.startsWith(LAYERS)).toBe(true);
    const rest = text.slice(LAYERS.length).trim();
    expect(rest.startsWith("@layer bugkit {")).toBe(true);
    expect(rest.endsWith("}")).toBe(true);

    const inner = rest.slice("@layer bugkit {".length, -1).replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...inner.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((match) =>
      match[1].split(",").map((selector) => selector.trim()),
    );
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector.startsWith(":where(")).toBe(true);
    }
  });

  it("injects one nonce-carrying sheet, first in head, across mounts", () => {
    const first = render(
      <>
        {dialog({ nonce: "n0nce" })}
        {dialog({ nonce: "n0nce" })}
      </>,
    );
    first.unmount();
    render(dialog({ nonce: "n0nce" }));

    const sheets = document.querySelectorAll("style[data-bugkit-styles]");
    expect(sheets).toHaveLength(1);
    expect(document.head.firstElementChild).toBe(sheets[0]);
    expect(sheets[0].getAttribute("nonce")).toBe("n0nce");
  });

  it("keeps the v0.2.1 look in the default rules", () => {
    render(dialog());

    expect(rule(':where([data-bugkit="overlay"])')).toContain("z-index: 59;");
    expect(rule(':where([data-bugkit="panel"])')).toContain(
      "background: var(--color-card, #ffffff);",
    );
    expect(rule(':where([data-bugkit="error"])')).toContain(
      "color: light-dark(#b3261e, #f28b82);",
    );
    const text = sheet()?.textContent ?? "";
    const toolSelector = ':where([data-bugkit="tool"])';
    const activeSelector = ':where([data-bugkit="tool"][aria-pressed="true"])';
    expect(text.indexOf(activeSelector)).toBeGreaterThan(text.indexOf(toolSelector));
    expect(rule(activeSelector)).toContain("border: 1px solid var(--color-ring, #171717);");
    expect(rule(':where([data-bugkit="primary-button"][aria-disabled="true"])')).toContain(
      "opacity: 0.6;",
    );
  });

  it("lays the editor out in layer bugkit, full screen and with a scrolling toolbar", () => {
    render(<ScreenshotEditor image="data:image/png;base64,AAAA" />);

    expect(rule(':where([data-bugkit="editor"][data-expanded="true"])')).toContain("position: fixed;");
    expect(rule(':where([data-bugkit="editor"] [data-bugkit="toolbar"])')).toContain("overflow-x: auto;");
  });

  it("gives the launcher and its dialog the app's classes and the nonce", async () => {
    vi.mocked(toPng).mockResolvedValue("data:image/png;base64,AAECAw==");
    render(
      <BugReportButton
        submit={vi.fn()}
        getContext={() => ({ area: "/projects/7/board", version: "3862535" })}
        diagnostics={() => []}
        className="host"
        classNames={{ launcher: "app-launch", panel: "app-panel" }}
        nonce="n0nce"
      />,
    );

    const launcher = document.querySelector<HTMLElement>("[data-bugreport-launcher]")!;
    expect(launcher).toHaveClass("host", "app-launch");
    expect(launcher.dataset.bugkit).toBe("launcher");

    await userEvent.setup().click(launcher);
    await waitFor(() =>
      expect(document.querySelector('[data-bugkit="panel"]')).toHaveClass("app-panel"),
    );
    expect(sheet()?.getAttribute("nonce")).toBe("n0nce");
  });
});
