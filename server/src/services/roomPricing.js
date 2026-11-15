const RoomType = require('../models/RoomType');
const v = require('../utils/validation');
const { HttpError } = v;

// Cập nhật giá mùa; các màn đặt phòng dùng chung pricing.js để tính tiền.
async function updatePricing(id, input) {
  v.id(id);
  v.keys(input, ['basePrice', 'seasonalPricing']);
  const { basePrice, seasonalPricing } = input;
  const update = {};
  // Giá phải là số nguyên đồng lớn hơn không.
  const whole = (n) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
  if (basePrice !== undefined) {
    if (!whole(basePrice)) throw new HttpError(400, 'The base price must be a whole amount greater than 0.');
    update.basePrice = basePrice;
  }
  if (seasonalPricing !== undefined) {
    if (!Array.isArray(seasonalPricing)) throw new HttpError(400, 'seasonalPricing must be a list.');
    // Kiểm tra ngày, giá và chặn khoảng giá chồng lấn của cùng loại phòng.
    // CR-04: chỉ nhận ngày có thật; form gửi lại các mức giá cũ dạng ISO đầy đủ nên lấy phần ngày.
    const day = (value, field) => new Date(v.date(typeof value === 'string' ? value.slice(0, 10) : value, field));
    const spans = seasonalPricing.map((season) => {
      if (!season || typeof season !== 'object') throw new HttpError(400, 'Each rate must be an object.');
      v.keys(season, ['_id', 'description', 'startDate', 'endDate', 'price']);
      if (season.description !== undefined) season.description = v.text(season.description, 'description', 0, 100);
      const start = day(season.startDate, 'startDate');
      const end = day(season.endDate, 'endDate');
      if (end < start)
        throw new HttpError(400, `Rate "${season.description || 'Custom'}": the end date cannot be before the start date.`);
      if (!whole(season.price))
        throw new HttpError(400, `Rate "${season.description || 'Custom'}": the price must be a whole amount greater than 0.`);
      return { name: season.description || 'Custom', start, end };
    }).sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++)
      // Khoảng giá tính cả ngày bắt đầu và ngày kết thúc.
      if (spans[i].start <= spans[i - 1].end)
        throw new HttpError(409, `Rate "${spans[i].name}" overlaps "${spans[i - 1].name}". Change its dates.`);
    update.seasonalPricing = seasonalPricing;
  }

  const roomType = await RoomType.findByIdAndUpdate(id, update, {
    new: true,
    runValidators: true
  });
  if (!roomType) {
    const error = new Error('Room type not found');
    error.status = 404;
    throw error;
  }
  return roomType;
}
module.exports = { updatePricing };
