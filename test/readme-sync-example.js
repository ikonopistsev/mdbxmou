"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");

(() => {
  const dbPath = path.join(__dirname, "readme-sync-example-db");
  fs.rmSync(dbPath, { recursive: true, force: true });

  const env = new MDBX_Env();
  env.openSync({ path: dbPath });

  const writeTxn = env.startWrite();
  const dbi = writeTxn.createMap(MDBX_Param.keyMode.ordinal);

  for (let i = 0; i < 200; i++) {
    dbi.put(writeTxn, i, `value_${i}`);
  }
  writeTxn.commit();

  const readTxn = env.startRead();
  const readDbi = readTxn.openMap(MDBX_Param.keyMode.ordinal);

  const value = readDbi.get(readTxn, 42);
  assert.ok(Buffer.isBuffer(value));
  assert.strictEqual(value.toString(), "value_42");

  let forEachCount = 0;
  readDbi.forEach(readTxn, (key, val, index) => {
    assert.strictEqual(typeof key, "number");
    assert.ok(Buffer.isBuffer(val));
    assert.strictEqual(val.toString(), `value_${key}`);
    forEachCount++;
    return index >= 9;
  });
  assert.strictEqual(forEachCount, 10);

  const someKeys = readDbi.keysFrom(readTxn, 100, 50);
  assert.strictEqual(someKeys.length, 50);
  assert.strictEqual(someKeys[0], 100);
  assert.strictEqual(someKeys[49], 149);

  readTxn.commit();

  env.closeSync();
  fs.rmSync(dbPath, { recursive: true, force: true });

  console.log("readme-sync-example ok");
})();
