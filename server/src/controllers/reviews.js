const { createReview } = require("../services/reviews");
const v = require("../utils/validation");

// Mỗi booking đã hoàn tất chỉ có một đánh giá của đúng khách đăng nhập.
async function create(req, res) {
  v.keys(req.body, ["rating", "title", "comment"]);
  const review = await createReview(req.user._id, req.params.id, req.body);
  res.status(201).json({ data: review });
}
module.exports = { create };
