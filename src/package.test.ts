import pkg from "../package.json" with { type: "json" };

test("ships dist as an ESM package with no install-time script", () => {
  expect(pkg.type).toBe("module");
  expect(pkg.exports).toEqual({
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
  });
  expect(pkg.files).toEqual(["dist"]);
  for (const name of ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack"]) {
    expect((pkg.scripts as Record<string, string>)[name]).toBeUndefined();
  }
});
