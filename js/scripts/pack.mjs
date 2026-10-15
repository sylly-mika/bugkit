// npm pack takes only the files under js/, so the README and LICENSE at the
// repository root are copied in for the pack and removed again afterwards.
import { execFileSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const js = resolve(import.meta.dirname, "..");
const COPIED = ["README.md", "LICENSE"];

export function packPackage(npmArgs = []) {
  const copies = COPIED.map((file) => join(js, file));
  try {
    for (const file of COPIED) copyFileSync(join(js, "..", file), join(js, file));
    const out = execFileSync("npm", ["pack", "--json", ...npmArgs], {
      cwd: js,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [info] = JSON.parse(out);
    return info;
  } finally {
    for (const copy of copies) rmSync(copy, { force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(packPackage(process.argv.slice(2)).filename);
}
