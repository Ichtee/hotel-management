const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} = require("node:crypto");

function key() {
  const secret = process.env.DATA_KEY || process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production")
    throw new Error("DATA_KEY is required.");
  return createHash("sha256")
    .update(secret || "development-only-data-key")
    .digest();
}

function encrypt(value) {
  if (value == null || value === "") return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:v1:${[iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(":")}`;
}

// Đọc được dữ liệu cũ để chuyển đổi dần mà không mất thông tin.
function decrypt(value) {
  if (!value?.startsWith("enc:v1:")) return value;
  const [iv, tag, data] = value
    .slice(7)
    .split(":")
    .map((s) => Buffer.from(s, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

function mask(value) {
  const text = decrypt(value);
  return text ? `••••${text.slice(-4)}` : "";
}

function phoneHash(value) {
  return createHmac("sha256", key()).update(value.trim()).digest("hex");
}

module.exports = { encrypt, decrypt, mask, phoneHash };
