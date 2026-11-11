const mongoose = require("mongoose");
const OperationLock = require("../models/OperationLock");

// Tuần tự hóa thay đổi phòng và phân công trong giao dịch để tránh ghi lệch.
async function hotelTransaction(work) {
  try {
    await OperationLock.updateOne({ _id: "hotel" }, { $setOnInsert: { version: 0 } }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  return mongoose.connection.transaction(async (session) => {
    await OperationLock.updateOne({ _id: "hotel" }, { $inc: { version: 1 } }, { session });
    return work(session);
  });
}
module.exports = { hotelTransaction };
