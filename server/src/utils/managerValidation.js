const v = require("./validation");

// Kiểm tra danh sách chuỗi, giới hạn kích thước và loại phần tử trùng.
function strings(value, field, maxItems = 30, maxLength = 200) {
  if (!Array.isArray(value) || value.length > maxItems) v.fail(`Invalid ${field} list.`, field);
  return [...new Set(value.map((item) => v.text(item, field, 1, maxLength)))];
}

// Chỉ nhận URL ảnh HTTP hoặc HTTPS, không tải ảnh từ backend.
function images(value) {
  const result = strings(value, "images", 20, 2048);
  for (const item of result) {
    let url;
    try { url = new URL(item); } catch { v.fail("Image must be an HTTP(S) URL.", "images"); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      v.fail("Image must be an HTTP(S) URL without credentials.", "images");
  }
  return result;
}

// Chặn nội dung rỗng và các trường không thuộc thao tác.
function body(value, allowed) {
  v.keys(value, allowed);
  if (!Object.keys(value).length) v.fail("Provide at least one field.");
}
module.exports = { strings, images, body };
