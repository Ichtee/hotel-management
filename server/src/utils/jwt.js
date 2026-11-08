const { createHmac, timingSafeEqual } = require("node:crypto");

// SDS 1 (middlewares): HS256 JSON Web Tokens. The header is fixed, so a token signed with another algorithm
// (or "none") never matches it.
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const HEADER = encode({ alg: "HS256", typ: "JWT" });
const mac = (data, secret) => createHmac("sha256", secret).update(data).digest();

function sign(payload, secret, ttlMs) {
  const now = Date.now();
  const data = `${HEADER}.${encode({ ...payload, iat: Math.floor(now / 1000), exp: Math.floor((now + ttlMs) / 1000) })}`;
  return `${data}.${mac(data, secret).toString("base64url")}`;
}

// The payload of a valid, unexpired token, otherwise null.
function verify(token, secret) {
  if (typeof token !== "string") return null;
  const [header, body, signature] = token.split(".");
  if (header !== HEADER || !body || !signature) return null;
  const given = Buffer.from(signature, "base64url");
  const expected = mac(`${header}.${body}`, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.exp * 1000 > Date.now() ? payload : null;
  } catch {
    return null;
  }
}
module.exports = { sign, verify };
