// check:pack packs bugkit as a git install sees it and uses the package from
// a temp app with no bundler: its files, its runtime exports, a server render
// of the button, and its types under nodenext and bundler resolution.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const failures = [];

const FORBIDDEN_SCRIPTS = ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack"];
const ALLOWED = /^(package\.json|README\.md|LICENSE|dist\/[A-Za-z0-9_./-]+\.(js|d\.ts))$/;
const REQUIRED = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/next.js",
  "dist/next.d.ts",
  "dist/server.js",
  "dist/server.d.ts",
];
const EXPORTS = "BUG_KINDS,BUG_REPORT_PARTS,BugReportButton,BugReportDialog,SUMMARY_LIMIT,buildBugReportForm,defaultLabels";
const LINKED = ["react", "react-dom", "html-to-image", "@types/react", "@types/react-dom"];

const PROBE_MJS = `import * as kit from "@sylly-mika/bugkit";
import react from "react";
import server from "react-dom/server";

export const names = Object.keys(kit).sort();
export const nextNames = Object.keys(await import("@sylly-mika/bugkit/next")).sort();
export const serverNames = Object.keys(await import("@sylly-mika/bugkit/server")).sort();
export const html = server.renderToString(
  react.createElement(kit.BugReportButton, {
    submit: async () => ({ id: "00000000-0000-0000-0000-000000000000", number: 1 }),
    getContext: () => ({ area: "/", version: "dev" }),
  }),
);
`;

const PROBE_TS = `import { BugReportButton, BugReportDialog, buildBugReportForm, defaultLabels } from "@sylly-mika/bugkit";
import type {
  BugReportButtonProps,
  BugReportContext,
  BugReportLabels,
  BugReportResult,
  BugReportSubmit,
} from "@sylly-mika/bugkit";

const submit: BugReportSubmit = async (form: FormData) => ({ id: String(form.get("area")), number: 1 });
const context: BugReportContext = { area: "/", version: "dev", requestId: "r" };
const props: BugReportButtonProps = { submit, getContext: () => context, labels: { filed: "Filed #{number}" }, className: "x" };
const labels: BugReportLabels = defaultLabels;
const result: BugReportResult = { id: "a", number: 2 };
// @ts-expect-error a result needs its number
const partial: BugReportResult = { id: "a" };

export const used = [BugReportButton, BugReportDialog, buildBugReportForm, props, labels, result, partial];
import { BugReport } from "@sylly-mika/bugkit/next";
import { createBugReportRoute } from "@sylly-mika/bugkit/server";
export const r: (q: Request) => Promise<Response> = createBugReportRoute({ intakeUrl: "u", intakeKey: "k", reporter: () => null });
export const b = BugReport;
`;

function checkScripts() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const name of FORBIDDEN_SCRIPTS) {
    if (pkg.scripts && name in pkg.scripts) {
      failures.push(`package.json has a "${name}" script; a git install would run it`);
    }
  }
}

function pack(tmp) {
  const out = execFileSync(
    "npm",
    ["pack", "--json", "--offline", "--ignore-scripts", "--pack-destination", tmp],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const [info] = JSON.parse(out);
  const paths = info.files.map((f) => f.path);
  for (const p of paths) {
    if (!ALLOWED.test(p) || p.includes(".test.")) failures.push(`packed file not allowed: ${p}`);
  }
  for (const p of REQUIRED) {
    if (!paths.includes(p)) failures.push(`packed file missing: ${p}`);
  }
  for (const p of paths) {
    if (p.startsWith("dist/") && p.endsWith(".js") && !paths.includes(p.slice(0, -3) + ".d.ts")) {
      failures.push(`no declaration for ${p}`);
    }
  }
  return join(tmp, info.filename);
}

function makeApp(tmp, tarball) {
  const app = join(tmp, "app");
  const pkgDir = join(app, "node_modules", "@sylly-mika", "bugkit");
  mkdirSync(pkgDir, { recursive: true });
  mkdirSync(join(app, "node_modules", "@types"), { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", pkgDir, "--strip-components=1"]);
  for (const dep of LINKED) {
    symlinkSync(join(root, "node_modules", dep), join(app, "node_modules", dep), "dir");
  }
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "bugkit-probe", private: true, type: "module" }));
  writeFileSync(join(app, "probe.mjs"), PROBE_MJS);
  writeFileSync(join(app, "probe.ts"), PROBE_TS);
  return app;
}

async function checkEntries(app) {
  const pkgDir = join(app, "node_modules", "@sylly-mika", "bugkit");
  if (!readFileSync(join(pkgDir, "dist/next.js"), "utf8").startsWith('"use client";')) {
    failures.push('dist/next.js does not start with "use client"');
  }
  const seen = new Set();
  const queue = ["dist/server.js"];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(join(pkgDir, file), "utf8");
    for (const [, spec] of source.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
      if (/^(react|react-dom|html-to-image)(\/|$)/.test(spec)) {
        failures.push(`dist/server.js reaches ${spec} through ${file}`);
      } else if (spec.startsWith("./")) {
        queue.push(posix.join(posix.dirname(file), spec));
      }
    }
  }
}

async function checkRuntime(app) {
  try {
    const probe = await import(pathToFileURL(join(app, "probe.mjs")).href);
    if (probe.names.join(",") !== EXPORTS) failures.push(`runtime exports are ${probe.names.join(",")}`);
    if (probe.nextNames.join(",") !== "BugReport") failures.push(`./next exports are ${probe.nextNames.join(",")}`);
    if (probe.serverNames.join(",") !== "createBugReportRoute") {
      failures.push(`./server exports are ${probe.serverNames.join(",")}`);
    }
    if (!probe.html.includes("<button")) failures.push("BugReportButton rendered no button");
  } catch (err) {
    failures.push(`runtime import failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function checkTypes(app) {
  const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
  for (const [resolution, module] of [["nodenext", "nodenext"], ["bundler", "esnext"]]) {
    const config = join(app, `tsconfig.${resolution}.json`);
    writeFileSync(
      config,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          lib: ["ES2022", "DOM"],
          module,
          moduleResolution: resolution,
          jsx: "react-jsx",
          skipLibCheck: true,
          types: [],
        },
        files: ["probe.ts"],
      }),
    );
    try {
      execFileSync(process.execPath, [tsc, "-p", config], { cwd: app, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      failures.push(`types (${resolution}) failed:\n${err.stdout || err.message}`);
    }
  }
}

const tmp = mkdtempSync(join(tmpdir(), "bugkit-pack-"));
try {
  checkScripts();
  let tarball = null;
  try {
    tarball = pack(tmp);
  } catch (err) {
    failures.push(`npm pack failed: ${err.stderr || err.message}`);
  }
  if (tarball) {
    const app = makeApp(tmp, tarball);
    checkEntries(app);
    await checkRuntime(app);
    checkTypes(app);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("check:pack: FAILED");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("check:pack: ok");
