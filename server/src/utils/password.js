const { randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const derive = promisify(scrypt);
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, 64);
  return `scrypt:${salt}:${key.toString("hex")}`;
}
async function verifyPassword(password, hash = "") {
  const [algorithm, salt, hex] = hash.split(":");
  if (algorithm !== "scrypt" || !salt || !hex || typeof password !== "string")
    return false;
  const key = await derive(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return expected.length === key.length && timingSafeEqual(key, expected);
}
module.exports = { hashPassword, verifyPassword };
