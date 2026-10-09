const Payment = require("../models/Payment");
const Refund = require("../models/Refund");
const v = require("../utils/validation");
const timezone = "Asia/Ho_Chi_Minh";
async function revenue(req, res) {
  v.keys(req.query, ["from", "to", "groupBy", "format"]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    new Date(),
  );
  const from = v.date(req.query.from || `${today.slice(0, 7)}-01`, "from");
  const to = v.date(req.query.to || today, "to");
  const start = new Date(`${from}T00:00:00+07:00`);
  const end = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400000);
  if (end <= start || end - start > 366 * 5 * 86400000)
    v.fail("Choose an ordered date range of at most five years.");
  const groupBy = v.choice(req.query.groupBy || "day", "groupBy", [
    "day",
    "month",
  ]);
  if (req.query.format) v.choice(req.query.format, "format", ["csv"]);
  const group = (field) => ({
    $group: {
      _id: {
        $dateToString: {
          format: groupBy === "day" ? "%Y-%m-%d" : "%Y-%m",
          date: `$${field}`,
          timezone,
        },
      },
      amount: { $sum: "$amount" },
      count: { $sum: 1 },
    },
  });
  const bookingJoin = (local) => [
    {
      $lookup: {
        from: "bookings",
        localField: local,
        foreignField: "_id",
        as: "booking",
      },
    },
    { $unwind: "$booking" },
    { $match: { "booking.hotelId": req.hotelId } },
  ];
  const [payments, refunds] = await Promise.all([
    Payment.aggregate([
      {
        $match: {
          status: "success",
          currency: "VND",
          paidAt: { $gte: start, $lt: end },
        },
      },
      ...bookingJoin("bookingId"),
      group("paidAt"),
    ]),
    Refund.aggregate([
      {
        $match: {
          status: "completed",
          currency: "VND",
          processedAt: { $gte: start, $lt: end },
        },
      },
      {
        $lookup: {
          from: "payments",
          localField: "paymentId",
          foreignField: "_id",
          as: "payment",
        },
      },
      { $unwind: "$payment" },
      {
        $match: {
          "payment.status": "success",
          "payment.currency": "VND",
          $expr: { $eq: ["$bookingId", "$payment.bookingId"] },
        },
      },
      ...bookingJoin("payment.bookingId"),
      group("processedAt"),
    ]),
  ]);
  const rows = new Map();
  for (
    const d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const key = d.toISOString().slice(0, groupBy === "day" ? 10 : 7);
    if (!rows.has(key))
      rows.set(key, {
        date: key,
        received: 0,
        refunded: 0,
        net: 0,
        paymentCount: 0,
        refundCount: 0,
      });
  }
  for (const p of payments)
    Object.assign(rows.get(p._id), {
      received: p.amount,
      paymentCount: p.count,
    });
  for (const r of refunds)
    Object.assign(rows.get(r._id), {
      refunded: r.amount,
      refundCount: r.count,
    });
  const series = [...rows.values()].map((r) => ({
    ...r,
    net: r.received - r.refunded,
  }));
  const totals = series.reduce(
    (sum, r) => {
      for (const key of Object.keys(sum)) sum[key] += r[key];
      return sum;
    },
    { received: 0, refunded: 0, net: 0, paymentCount: 0, refundCount: 0 },
  );
  if (req.query.format === "csv")
    return res
      .attachment(`revenue-${from}-${to}.csv`)
      .type("text/csv")
      .send(
        "Date,Received (VND),Refunded (VND),Net (VND),Payments,Refunds\r\n" +
          series
            .map((r) =>
              [
                r.date,
                r.received,
                r.refunded,
                r.net,
                r.paymentCount,
                r.refundCount,
              ].join(","),
            )
            .join("\r\n"),
      );
  res.json({
    data: { from, to, groupBy, timezone, currency: "VND", totals, series },
  });
}
module.exports = { revenue };
