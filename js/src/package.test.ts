import pkg from "../package.json" with { type: "json" };

test("ships dist as an ESM package with no install-time script", () => {
  expect(pkg.type).toBe("module");
  expect(pkg.exports).toEqual({
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    "./next": { types: "./dist/next.d.ts", import: "./dist/next.js" },
    "./server": { types: "./dist/server.d.ts", import: "./dist/server.js" },
    "./diagnostics": { types: "./dist/diagnostics-entry.d.ts", import: "./dist/diagnostics-entry.js" },
  });
  expect(pkg.files).toEqual(["dist"]);
  for (const name of ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack"]) {
    expect((pkg.scripts as Record<string, string>)[name]).toBeUndefined();
  }
});
