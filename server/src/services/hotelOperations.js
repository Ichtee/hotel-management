const mongoose = require("mongoose");
const OperationLock = require("../models/OperationLock");

// Tuần tự hóa thay đổi tồn phòng và phân công trong transaction để tránh ghi lệch.
async function hotelTransaction(work) {
  try {
    await OperationLock.updateOne({ _id: "hotel" }, { $setOnInsert: { version: 0 } }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  try {
    return await mongoose.connection.transaction(async (session) => {
      await OperationLock.updateOne({ _id: "hotel" }, { $inc: { version: 1 } }, { session });
      return work(session);
    });
  } catch (error) {
    if (error.message && (error.message.includes("replica set") || error.message.includes("Transaction numbers"))) {
      await OperationLock.updateOne({ _id: "hotel" }, { $inc: { version: 1 } });
      return work(undefined);
    }
    throw error;
  }
}
module.exports = { hotelTransaction };
