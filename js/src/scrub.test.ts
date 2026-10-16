import { cutStack, scrubPath, scrubText } from "./scrub.js";

const BODY = "aB3-x_".repeat(8).slice(0, 43);
const HASH = "0123456789abcdef0123456789abcdef";
const UUID = "3f2b9c1e-8a4d-4f6b-9c2e-1a2b3c4d5e6f";

describe("scrubText", () => {
  it("a review link, a review session and an intake key become [token]", () => {
    const out = scrubText(`a rvl_${BODY} b rvs_${BODY} c itk_${BODY}`);
    expect(out).toBe("a [token] b [token] c [token]");
    expect(out).not.toContain(BODY);
    expect(out).not.toContain("rvl_");
    expect(out).not.toContain("rvs_");
  });

  it("a prefixed token needs 16 characters after the prefix", () => {
    expect(scrubText(`rvl_${BODY.slice(0, 16)}`)).toBe("[token]");
    expect(scrubText(`rvl_${BODY.slice(0, 15)}`)).toBe(`rvl_${BODY.slice(0, 15)}`);
  });

  it("a bearer credential is redacted", () => {
    expect(scrubText("Authorization: Bearer x")).toBe("Authorization: Bearer [redacted]");
    const out = scrubText("bearer abc.def==");
    expect(out).toBe("bearer [redacted]");
    expect(out).not.toContain("abc.def");
  });

  it("a JWT becomes [token]", () => {
    const out = scrubText("t eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl end");
    expect(out).toBe("t [token] end");
    expect(out).not.toContain("eyJ");
  });

  it("an e-mail address becomes [email] and a package path stays", () => {
    const out = scrubText(
      "mail anna.berzina@example.lv failed; at node_modules/@sylly-mika/bugkit/dist/x.js react@19.2.7",
    );
    expect(out).toBe(
      "mail [email] failed; at node_modules/@sylly-mika/bugkit/dist/x.js react@19.2.7",
    );
    expect(out).not.toContain("anna.berzina");
  });

  it("a pair named like a credential loses its value, in any case", () => {
    expect(scrubText("GET /a?token=x&page=2")).toBe("GET /a?token=[redacted]&page=2");
    const out = scrubText(
      "api_key=abc; Session_Id=s1 Password=hunter2 auth_code=99 page=2&sort=name",
    );
    expect(out).toBe(
      "api_key=[redacted]; Session_Id=[redacted] Password=[redacted] auth_code=[redacted] page=2&sort=name",
    );
    expect(out).not.toContain("hunter2");
  });

  it("a mixed run of 32 characters becomes [token]", () => {
    expect(scrubText(`id ${HASH} done`)).toBe("id [token] done");
    expect(scrubText(`id ${HASH.slice(1)} done`)).toBe(`id ${HASH.slice(1)} done`);
    expect(scrubText("a".repeat(40))).toBe("a".repeat(40));
    expect(scrubText("1".repeat(40))).toBe("1".repeat(40));
  });

  it("a hashed asset name is kept, a .json one is not", () => {
    const text = `/_next/static/chunks/${HASH}.js:1:2 ${HASH}.mjs ${HASH}.css ${HASH}.map ${HASH}.json`;
    expect(scrubText(text)).toBe(
      `/_next/static/chunks/${HASH}.js:1:2 ${HASH}.mjs ${HASH}.css ${HASH}.map [token].json`,
    );
  });

  it("a canonical UUID is kept, its query value is redacted", () => {
    expect(scrubText(`/api/v1/orders/${UUID}?token=x`)).toBe(
      `/api/v1/orders/${UUID}?token=[redacted]`,
    );
  });

  it("a typed input value becomes [input]", () => {
    const out = scrubText("save failed for Bērziņš Jānis", { secrets: ["Bērziņš Jānis"] });
    expect(out).toBe("save failed for [input]");
    expect(out).not.toContain("Bērziņš");
  });

  it("a secret under 3 characters is ignored", () => {
    expect(scrubText("abacus", { secrets: ["ab", "  "] })).toBe("abacus");
  });

  it("a secret is matched literally", () => {
    expect(scrubText("x abc.def* y abcXdefz", { secrets: ["abc.def*"] })).toBe(
      "x [input] y abcXdefz",
    );
  });

  it("the longer of two overlapping secrets wins", () => {
    const out = scrubText("x abcdef y abc", { secrets: ["abc", "abcdef"] });
    expect(out).toBe("x [input] y [input]");
    expect(out).not.toContain("def");
  });

  it("the cut comes after the scrubbing", () => {
    const out = scrubText("x".repeat(495) + "secret123", { secrets: ["secret123"] });
    expect(Array.from(out).length).toBe(500);
    expect(out.endsWith("[inp…")).toBe(true);
    expect(out).not.toContain("secr");
  });

  it("the cut counts code points and ends in …", () => {
    const long = scrubText("a".repeat(600));
    expect(Array.from(long).length).toBe(500);
    expect(long.endsWith("…")).toBe(true);
    expect(scrubText("😀".repeat(10), { limit: 5 })).toBe("😀😀😀😀…");
    expect(scrubText("abc", { limit: 3 })).toBe("abc");
  });

  it("a long message is scrubbed in linear time", () => {
    const big =
      "a".repeat(30000) +
      " eyJ" +
      "eyJ".repeat(10000) +
      " " +
      "key".repeat(10000) +
      " " +
      "rvl_".repeat(10000);
    const started = performance.now();
    const out = scrubText(big);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(250);
    expect(Array.from(out).length).toBe(500);
  });
});

describe("scrubPath", () => {
  it("scrubPath drops origin, query and fragment and hides a review token", () => {
    const out = scrubPath(`https://shop.example/review/rvl_${BODY}?token=x#frag`);
    expect(out).toBe("/review/:token");
    expect(out).not.toContain("rvl_");
    expect(out).not.toContain("token=");
    expect(out).not.toContain("frag");
    expect(scrubPath("/api/v1/products/42?q=brake")).toBe("/api/v1/products/42");
  });

  it("scrubPath hides a mixed 32-character segment and keeps an asset name", () => {
    expect(scrubPath(`/api/v1/orders/${HASH}`)).toBe("/api/v1/orders/:token");
    expect(scrubPath(`/api/v1/orders/${UUID}`)).toBe(`/api/v1/orders/${UUID}`);
    expect(scrubPath(`/static/${HASH}.js`)).toBe(`/static/${HASH}.js`);
  });

  it('scrubPath answers "" for a URL it cannot parse', () => {
    expect(scrubPath("http://[")).toBe("");
  });

  it("scrubPath cuts at 512 code points", () => {
    expect(Array.from(scrubPath("/" + "a".repeat(600))).length).toBe(512);
  });
});

describe("cutStack", () => {
  it("cutStack keeps the first 15 lines", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `    at f${i + 1} (https://shop.example/app.js:${i + 1}:1)`);
    const out = cutStack(lines.join("\n")).split("\n");
    expect(out.length).toBe(15);
    expect(out[14]).toBe("    at f15 (https://shop.example/app.js:15:1)");
  });

  it("cutStack scrubs a token in a frame URL", () => {
    expect(cutStack(`Error: x\n    at g (https://shop.example/review/rvl_${BODY}:1:2)`)).toBe(
      "Error: x\n    at g (https://shop.example/review/[token]:1:2)",
    );
  });

  it("cutStack cuts at 1500 code points", () => {
    const lines = Array.from({ length: 15 }, (_, i) => `    at f${i + 1} (` + "y/".repeat(100) + ")");
    const out = cutStack(lines.join("\n"));
    expect(Array.from(out).length).toBe(1500);
    expect(out.endsWith("…")).toBe(true);
  });
});
