const mongoose = require("mongoose");
const schema = new mongoose.Schema({ _id: String, version: { type: Number, default: 0 } });
module.exports = mongoose.model("OperationLock", schema);
