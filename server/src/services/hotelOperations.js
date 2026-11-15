const mongoose = require("mongoose");
const { AsyncLocalStorage } = require("node:async_hooks");
const OperationLock = require("../models/OperationLock");
const transactionContext = new AsyncLocalStorage();

// Mọi truy vấn bên trong giao dịch tự dùng cùng session, kể cả service gọi lồng nhau.
mongoose.set("transactionAsyncLocalStorage", true);

// Tuần tự hóa thay đổi phòng và phân công trong giao dịch để tránh ghi lệch.
async function hotelTransaction(work) {
  const active = transactionContext.getStore();
  if (active) return work(active.session);
  try {
    await OperationLock.updateOne({ _id: "hotel" }, { $setOnInsert: { version: 0 } }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  let effects;
  try {
    const result = await mongoose.connection.transaction(async (session) => {
      effects = [];
      await OperationLock.updateOne({ _id: "hotel" }, { $inc: { version: 1 } }, { session });
      return transactionContext.run({ session, effects }, () => work(session));
    });
    for (const effect of effects) {
      try { await effect(); } catch (error) { console.error("Post-commit action failed:", error.message); }
    }
    return result;
  } catch (error) {
    if (error.message && (error.message.includes("replica set") || error.message.includes("Transaction numbers"))) {
      await OperationLock.updateOne({ _id: "hotel" }, { $inc: { version: 1 } });
      return work(undefined);
    }
    throw error;
  }
}

// Chỉ gọi dịch vụ ngoài sau commit để không gửi lặp khi transaction thử lại.
async function afterCommit(work) {
  const active = transactionContext.getStore();
  if (active) { active.effects.push(work); return; }
  return work();
}

// Chỉ gửi HTTP thành công sau khi toàn bộ dữ liệu đã được commit.
const transactional = (work, status = 200, prepare) => async (req, res) => {
  if (prepare) await prepare(req);
  const payload = await hotelTransaction(() => work(req));
  res.status(status).json(payload);
};

module.exports = { hotelTransaction, afterCommit, transactional };
