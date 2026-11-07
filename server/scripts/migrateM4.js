const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const Booking = require("../src/models/Booking");
const Invoice = require("../src/models/Invoice");
const CouponUsage = require("../src/models/CouponUsage");
const AuditLog = require("../src/models/AuditLog");
const Service = require("../src/models/Service");
const { encrypt, decrypt, phoneHash } = require("../src/utils/guestData");
const { dates, day, amount } = require("../src/services/stayPricing");
const { hotelTransaction } = require("../src/services/hotelOperations");

function checkedHistory(booking, entry) {
  if (!entry) return {};
  if (booking.m4Version === 1) return {};
  const expectedDates = dates(
    day(booking.checkInDate),
    day(booking.checkOutDate),
  );
  if (
    !Array.isArray(entry.nightlyRates) ||
    entry.nightlyRates.length !== expectedDates.length
  )
    throw new Error("The reviewed nights must cover the entire booking.");
  const nightlyRates = entry.nightlyRates.map((night, i) => {
    if (
      night.date !== expectedDates[i] ||
      !mongoose.isObjectIdOrHexString(night.roomTypeId)
    )
      throw new Error("Invalid reviewed nightly rate.");
    return {
      date: night.date,
      roomTypeId: new mongoose.Types.ObjectId(night.roomTypeId),
      price: amount(night.price),
    };
  });
  if (nightlyRates.reduce((s, n) => s + n.price, 0) !== booking.roomAmount)
    throw new Error("Reviewed rates must preserve the stored room total.");
  const snapshot = entry.policySnapshot;
  if (
    !snapshot ||
    !["checkInTime", "checkOutTime"].every((k) =>
      /^([01]\d|2[0-3]):[0-5]\d$/.test(snapshot[k]),
    )
  )
    throw new Error("Reviewed stay times are required.");
  const changes = { nightlyRates, m4Version: 1 };
  for (const key of [
    "checkInTime",
    "checkOutTime",
    "earlyCheckInFee",
    "lateCheckOutFee",
  ])
    changes[`policySnapshot.${key}`] = key.endsWith("Fee")
      ? amount(snapshot[key])
      : snapshot[key];
  return changes;
}

// Chỉ thay chỉ mục cũ đã biết; không xóa bản ghi hay thay lịch sử hóa đơn.
async function migrateIndexes(apply) {
  const actions = [];
  const serviceIndexes = await Service.collection
    .listIndexes()
    .toArray()
    .catch((error) => {
      if (error.code === 26) return [];
      throw error;
    });
  const oldServiceIndex = serviceIndexes.find(
    (index) => index.name === "name_1" && index.unique,
  );
  if (oldServiceIndex)
    actions.push({
      collection: Service.collection.name,
      index: "name_1",
      action: "replace-legacy-unique-index",
    });
  if (apply) {
    await hotelTransaction(async (session) => {
      await Service.collection.updateMany(
        { kind: { $exists: false } },
        { $set: { kind: "service" } },
        { session },
      );
    });
    await Service.createIndexes();
    await Booking.createIndexes();
    if (oldServiceIndex)
      await Service.collection.dropIndex(oldServiceIndex.name);
  }
  for (const [Model, name] of [
    [Invoice, "bookingId_1"],
    [CouponUsage, "couponId_1_customerId_1"],
  ]) {
    const indexes = await Model.collection
      .listIndexes()
      .toArray()
      .catch((e) => {
        if (e.code === 26) return [];
        throw e;
      });
    const old = indexes.find(
      (i) => i.name === name && i.unique && !i.partialFilterExpression,
    );
    if (old) {
      actions.push({
        collection: Model.collection.name,
        index: name,
        action: "replace-legacy-unique-index",
      });
      if (apply) {
        await Model.collection.dropIndex(name);
        try {
          await Model.createIndexes();
        } catch (error) {
          await Model.collection.createIndex(old.key, {
            name: old.name,
            unique: true,
          });
          throw error;
        }
      }
    } else if (apply) await Model.createIndexes();
  }
  return actions;
}

// Sao chép theo lô, giữ ID và dữ liệu nguồn; chạy lại không ghi đè dữ liệu đã chuyển.
async function migrateStorage({
  source,
  apply = false,
  after,
  limit = 100,
} = {}) {
  if (!["catalog", "penalties"].includes(source))
    throw new Error("Storage source must be catalog or penalties.");
  const collection = mongoose.connection.collection(
    source === "catalog" ? "compensationitems" : "penalties",
  );
  const rows = await collection
    .find(after ? { _id: { $gt: new mongoose.Types.ObjectId(after) } } : {})
    .sort({ _id: 1 })
    .limit(limit)
    .toArray();
  const report = {
    source,
    apply,
    scanned: rows.length,
    copied: 0,
    skipped: 0,
    resumeAfter: rows.at(-1)?._id.toString(),
  };
  for (const row of rows) {
    const copy = async (session) => {
      const legacy = await collection.findOne({ _id: row._id }, { session });
      if (!legacy)
        throw new Error("A source record disappeared. Rerun this batch.");
      const target =
        source === "catalog"
          ? await Service.findById(row._id).session(session)
          : await Booking.findById(legacy.bookingId).session(session);
      if (legacy.m4MigratedAt) {
        if (
          source === "catalog"
            ? target?.kind !== "compensation"
            : !target?.penalties.id(row._id)
        )
          throw new Error(
            "A migrated target is missing. Review the source record.",
          );
        return false;
      }
      if (source === "catalog") {
        if (
          target ||
          (await Service.exists({
            kind: "compensation",
            name: legacy.name,
          }).session(session))
        )
          throw new Error(
            "A catalog ID or name conflicts. Review before migrating.",
          );
        const item = new Service({ ...legacy, kind: "compensation" });
        await item.validate();
        if (apply) await item.save({ session, timestamps: false });
      } else {
        if (!target)
          throw new Error("A penalty has no booking. Review before migrating.");
        if (
          (await Booking.exists({ "penalties._id": row._id }).session(
            session,
          )) ||
          (legacy.operationKey &&
            target.penalties.some(
              (p) => p.operationKey === legacy.operationKey,
            ))
        )
          throw new Error(
            "A penalty ID or operation key conflicts. Review before migrating.",
          );
        if (
          legacy.itemId &&
          !(await Service.exists({
            _id: legacy.itemId,
            kind: "compensation",
          }).session(session))
        )
          throw new Error(
            "Migrate the compensation catalog before its penalties.",
          );
        const penalty = target.penalties.create(legacy);
        await penalty.validate();
        if (apply)
          await Booking.collection.updateOne(
            { _id: target._id },
            {
              $push: { penalties: penalty.toObject() },
              $set: { updatedAt: new Date() },
            },
            { session },
          );
      }
      if (apply) {
        await collection.updateOne(
          { _id: row._id },
          { $set: { m4MigratedAt: new Date() } },
          { session },
        );
        await AuditLog.create(
          [
            {
              action: "m4.storage_migrated",
              targetType: source === "catalog" ? "Service" : "Booking",
              targetId: source === "catalog" ? row._id : legacy.bookingId,
              detail: { sourceId: row._id, totalsPreserved: true },
            },
          ],
          { session },
        );
      }
      return true;
    };
    const copied = apply ? await hotelTransaction(copy) : await copy(null);
    report[copied ? "copied" : "skipped"]++;
  }
  return report;
}

// Chạy lại theo ID; chỉ dùng lịch sử đã duyệt và giữ nguyên mọi tổng tiền.
async function migrate({
  apply = false,
  after,
  limit = 100,
  reviewed = {},
} = {}) {
  const rows = await Booking.collection
    .find(after ? { _id: { $gt: new mongoose.Types.ObjectId(after) } } : {})
    .sort({ _id: 1 })
    .limit(limit)
    .toArray();
  const report = {
    apply,
    scanned: rows.length,
    updated: 0,
    needsReview: [],
    resumeAfter: rows.at(-1)?._id.toString(),
    indexes: await migrateIndexes(false),
  };
  for (const row of rows) {
    const history = reviewed[String(row._id)];
    if (
      !row.nightlyRates?.length ||
      !row.policySnapshot?.checkInTime ||
      !row.policySnapshot?.checkOutTime
    )
      report.needsReview.push(String(row._id));
    const fields = checkedHistory(row, history);
    for (const key of ["guestPhone", "guestEmail", "guestIdDocumentNo"])
      if (row[key] && !row[key].startsWith("enc:v1:"))
        fields[key] = encrypt(row[key]);
    if (row.guestPhone && !row.guestPhoneHash)
      fields.guestPhoneHash = phoneHash(decrypt(row.guestPhone));
    if (!Object.keys(fields).length) continue;
    if (apply)
      await hotelTransaction(async (session) => {
        const current = await Booking.collection.findOne(
          { _id: row._id },
          { session },
        );
        if (String(current.updatedAt) !== String(row.updatedAt))
          throw new Error(
            "A booking changed during migration. Rerun this batch.",
          );
        await Booking.collection.updateOne(
          { _id: row._id },
          { $set: { ...fields, updatedAt: new Date() } },
          { session },
        );
        await AuditLog.create(
          [
            {
              action: "booking.m4_migrated",
              targetType: "Booking",
              targetId: row._id,
              detail: {
                historicalSnapshotReviewed: Boolean(history),
                totalsPreserved: true,
              },
            },
          ],
          { session },
        );
      });
    report.updated++;
  }
  return report;
}

async function main() {
  require("dotenv").config({
    path: path.resolve(__dirname, "../.env"),
    quiet: true,
  });
  const args = process.argv.slice(2),
    value = (key) => {
      const i = args.indexOf(key);
      return i < 0 ? undefined : args[i + 1];
    };
  const apply = args.includes("--apply"),
    indexes = args.includes("--apply-indexes");
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
  await mongoose.connect(process.env.MONGO_URI, {
    autoIndex: false,
    autoCreate: false,
  });
  try {
    if ((apply || indexes) && value("--database") !== mongoose.connection.name)
      throw new Error(
        "Pass --database with the exact database name before applying.",
      );
    if (
      (apply || indexes) &&
      !(process.env.DATA_KEY || process.env.SESSION_SECRET)
    )
      throw new Error(
        "A stable DATA_KEY or SESSION_SECRET is required before applying.",
      );
    const limit = Number(value("--limit") || 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("Limit must be 1 to 1000.");
    const reviewed = value("--reviewed")
      ? JSON.parse(fs.readFileSync(value("--reviewed"), "utf8"))
      : {};
    const indexReport = indexes ? await migrateIndexes(true) : undefined;
    const report = value("--storage")
      ? await migrateStorage({
          source: value("--storage"),
          apply,
          after: value("--after"),
          limit,
        })
      : await migrate({ apply, after: value("--after"), limit, reviewed });
    if (indexes) report.indexes = indexReport;
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { migrate, migrateIndexes, migrateStorage, checkedHistory };
