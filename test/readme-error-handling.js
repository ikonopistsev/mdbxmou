"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");

(async () => {
  const dbPath = path.join(__dirname, "readme-error-handling-db");
  await fs.promises.rm(dbPath, { recursive: true, force: true });

  const env = new MDBX_Env();
  await env.open({ path: dbPath });

  const writeTxn = env.startWrite();
  const dbi = writeTxn.createMap(MDBX_Param.keyMode.ordinal);
  dbi.put(writeTxn, 1, "one");
  writeTxn.commit();

  let thrown = false;
  let txn;
  try {
    txn = env.startRead();
    const readDbi = txn.openMap(MDBX_Param.keyMode.ordinal);
    readDbi.put(txn, 2, "two");
  } catch (err) {
    thrown = true;
    if (txn) {
      txn.abort();
    }
  }

  assert.strictEqual(thrown, true);

  await env.close();
  await fs.promises.rm(dbPath, { recursive: true, force: true });

  console.log("readme-error-handling ok");
})().catch((err) => {
  console.error("readme-error-handling failed:", err);
  process.exit(1);
});
