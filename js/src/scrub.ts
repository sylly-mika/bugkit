/** Default cut, in code points, for a recorded message. */
export const TEXT_LIMIT = 500;
/** How many lines of a stack trace are kept. */
export const STACK_LIMIT_LINES = 15;
/** Cut, in code points, for a kept stack trace. */
export const STACK_LIMIT_CHARS = 1500;

const PATH_LIMIT = 512;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi;
const PREFIXED = /(?:rvl|rvs|itk)_[A-Za-z0-9_-]{16,}/g;
const JWT = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PAIR = /(?<![\w.[\]-])([\w.[\]-]+)=[^\s&#;"'<>]+/g;
const CREDENTIAL = /token|key|secret|password|code|session/i;
const RUN = /[A-Za-z0-9_-]{32,}/g;
const ASSET = /^\.(?:js|mjs|css|map)(?![A-Za-z0-9])/;
const PREFIXED_SEGMENT = /^(?:rvl|rvs|itk)_[A-Za-z0-9_-]{16,}$/;
const JWT_SEGMENT = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const RUN_SEGMENT = /^[A-Za-z0-9_-]{32,}$/;
// WHY: a UUID is an id, not a secret, and triage needs it in the path.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mixed(run: string): boolean {
  return /[0-9]/.test(run) && /[A-Za-z]/.test(run);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cut(text: string, limit: number): string {
  const points = Array.from(text);
  if (points.length <= limit) return text;
  return points.slice(0, Math.max(1, limit) - 1).join("") + "…";
}

/** Redacts secrets, tokens, e-mail addresses and credential pairs, then cuts to `limit` code points. */
export function scrubText(text: string, options: { limit?: number; secrets?: readonly string[] } = {}): string {
  let out = text;
  const secrets = (options.secrets ?? [])
    .map((secret) => secret.trim())
    .filter((secret) => Array.from(secret).length >= 3)
    .sort((a, b) => b.length - a.length);
  if (secrets.length > 0) {
    out = out.replace(new RegExp(secrets.map(escapeRegExp).join("|"), "g"), "[input]");
  }
  out = out
    .replace(BEARER, "$1 [redacted]")
    .replace(PREFIXED, "[token]")
    .replace(JWT, "[token]")
    .replace(EMAIL, "[email]")
    .replace(PAIR, (pair: string, name: string) => (CREDENTIAL.test(name) ? `${name}=[redacted]` : pair));
  out = out.replace(RUN, (run: string, at: number, all: string) =>
    mixed(run) && !UUID.test(run) && !ASSET.test(all.slice(at + run.length)) ? "[token]" : run,
  );
  return cut(out, options.limit ?? TEXT_LIMIT);
}

/** The pathname of a URL with token segments replaced by `:token`; "" when the URL cannot be parsed. */
export function scrubPath(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url, "http://x").pathname;
  } catch {
    return "";
  }
  const scrubbed = pathname
    .split("/")
    .map((segment) =>
      PREFIXED_SEGMENT.test(segment) ||
      JWT_SEGMENT.test(segment) ||
      (RUN_SEGMENT.test(segment) && mixed(segment) && !UUID.test(segment))
        ? ":token"
        : segment,
    )
    .join("/");
  return Array.from(scrubbed).slice(0, PATH_LIMIT).join("");
}

/** The first lines of a stack trace, scrubbed and cut. */
export function cutStack(stack: string): string {
  return scrubText(stack.split(/\r?\n/).slice(0, STACK_LIMIT_LINES).join("\n"), { limit: STACK_LIMIT_CHARS });
}
