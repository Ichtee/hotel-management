const cloudinary = require("cloudinary").v2;
const Request = require("../models/CheckInOutRequest");
const { HttpError } = require("../utils/validation");
// The photo of the ID document is private ("authenticated"): the browser uploads it with a signature made here,
// and only the front desk gets a short-lived download link (SRS 4.2.4: the ID is not shown to the Hotel Manager).
const cfg = () => {
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = process.env;
  if (!cloud || !key || !secret) throw new HttpError(503, "ID photo upload is not set up yet. Show the document at the front desk instead.");
  cloudinary.config({ cloud_name: cloud, api_key: key, api_secret: secret, secure: true });
  return { cloud, key, secret };
};
const folderOf = (userId, kind = "id") => `grandstay/${kind}/${userId}`; // kind "refund": the bank receipt of a refund (UC21)
function uploadParams(userId, kind) {
  const { cloud, key, secret } = cfg();
  // kind "room": a public room photo (shown on the website), so no "authenticated" type
  const p = { timestamp: Math.round(Date.now() / 1000), ...(kind === "room" ? { folder: "grandstay/room" } : { folder: folderOf(userId, kind), type: "authenticated", format: "jpg" }) };
  return { cloudName: cloud, apiKey: key, ...p, signature: cloudinary.utils.api_sign_request(p, secret) };
}
const ownsPhoto = (userId, publicId, kind) => typeof publicId === "string" && new RegExp(`^${folderOf(userId, kind)}/[A-Za-z0-9_-]{6,60}$`).test(publicId);
function downloadUrl(publicId) {
  cfg();
  return cloudinary.utils.private_download_url(publicId, "jpg", { type: "authenticated", expires_at: Math.round(Date.now() / 1000) + 300 });
}
const destroy = (publicId) => { try { cfg(); } catch { return Promise.resolve(); } return cloudinary.uploader.destroy(publicId, { type: "authenticated", invalidate: true }).catch((e) => console.error("ID photo delete failed:", e.message)); };
async function dropPhotos(filter) {
  for (const r of await Request.find({ ...filter, hasIdPhoto: true }).select("+idPhoto")) {
    if (r.idPhoto) await destroy(r.idPhoto);
    await Request.updateOne({ _id: r._id }, { $set: { hasIdPhoto: false }, $unset: { idPhoto: 1 } });
  }
}
module.exports = { uploadParams, ownsPhoto, downloadUrl, destroy, dropPhotos };
