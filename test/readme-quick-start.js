"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");

(async () => {
  const dbPath = path.join(__dirname, "readme-quick-start-db");
  await fs.promises.rm(dbPath, { recursive: true, force: true });

  const env = new MDBX_Env();
  await env.open({
    path: dbPath,
    keyFlag: MDBX_Param.keyFlag.string,
    valueFlag: MDBX_Param.valueFlag.string,
  });

  const txn = env.startWrite();
  const dbi = txn.createMap(MDBX_Param.keyMode.ordinal);
  dbi.put(txn, 1, "hello");
  dbi.put(txn, 2, "world");
  txn.commit();

  const readTxn = env.startRead();
  const readDbi = readTxn.openMap(BigInt(MDBX_Param.keyMode.ordinal));
  const value = readDbi.get(readTxn, 1);
  assert.strictEqual(value, "hello");
  readTxn.commit();

  await env.close();
  await fs.promises.rm(dbPath, { recursive: true, force: true });

  console.log("readme-quick-start ok");
})().catch((err) => {
  console.error("readme-quick-start failed:", err);
  process.exit(1);
});
