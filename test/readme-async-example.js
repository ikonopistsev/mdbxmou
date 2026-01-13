"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");

(async () => {
  const dbPath = path.join(__dirname, "readme-async-example-db");
  await fs.promises.rm(dbPath, { recursive: true, force: true });

  const env = new MDBX_Env();
  await env.open({ path: dbPath });

  const writeTxn = env.startWrite();
  const dbi = writeTxn.createMap(MDBX_Param.keyMode.ordinal);
  for (let i = 0; i < 200; i++) {
    dbi.put(writeTxn, i, `value_${i}`);
  }
  writeTxn.commit();

  const readTxn = env.startRead();
  const readDbi = readTxn.openMap(BigInt(MDBX_Param.keyMode.ordinal));

  const value = readDbi.get(readTxn, 42);
  assert.ok(Buffer.isBuffer(value));
  assert.strictEqual(value.toString(), "value_42");

  let forEachCount = 0;
  readDbi.forEach(readTxn, (key, val, index) => {
    assert.strictEqual(typeof key, "bigint");
    assert.ok(Buffer.isBuffer(val));
    assert.strictEqual(val.toString(), `value_${Number(key)}`);
    forEachCount++;
    return index >= 9;
  });
  assert.strictEqual(forEachCount, 10);

  const bigIntKeys = readDbi.keysFrom(readTxn, 100n, 50);
  assert.strictEqual(bigIntKeys.length, 50);
  assert.strictEqual(bigIntKeys[0], 100n);
  assert.strictEqual(bigIntKeys[49], 149n);

  readTxn.commit();
  await env.close();
  await fs.promises.rm(dbPath, { recursive: true, force: true });

  console.log("readme-async-example ok");
})().catch((err) => {
  console.error("readme-async-example failed:", err);
  process.exit(1);
});
