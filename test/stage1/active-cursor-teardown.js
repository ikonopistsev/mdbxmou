"use strict";

const { MDBX_Env } = require("../../lib/nativemou.js");

const dbPath = process.env.MDBXMOU_STAGE1_DB_PATH;
if (!dbPath) throw new Error("MDBXMOU_STAGE1_DB_PATH is required");

const env = new MDBX_Env();
env.openSync({ path: dbPath });
const txn = env.startRead();
const dbi = txn.openMap();
globalThis.__cursor = txn.openCursor(dbi);
