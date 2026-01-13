"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");

(() => {
  const dbPath = path.join(__dirname, "readme-cursor-db");
  fs.rmSync(dbPath, { recursive: true, force: true });

  const env = new MDBX_Env();
  env.openSync({ path: dbPath });

  const txn = env.startWrite();
  const dbi = txn.createMap(MDBX_Param.keyMode.ordinal);
  for (let i = 0; i < 100; i++) {
    dbi.put(txn, i, `value_${i}`);
  }
  txn.commit();

  const readTxn = env.startRead();
  const readDbi = readTxn.openMap(MDBX_Param.keyMode.ordinal);

  const allKeys = readDbi.keys(readTxn);
  assert.strictEqual(allKeys.length, 100);

  const firstTen = readDbi.keysFrom(readTxn, 0, 10);
  assert.strictEqual(firstTen.length, 10);
  assert.strictEqual(firstTen[0], 0);
  assert.strictEqual(firstTen[9], 9);

  const fromFifty = readDbi.keysFrom(readTxn, 50, 20);
  assert.strictEqual(fromFifty.length, 20);
  assert.strictEqual(fromFifty[0], 50);
  assert.strictEqual(fromFifty[19], 69);

  let count = 0;
  const seen = [];
  readDbi.forEach(readTxn, (key, value) => {
    if (key >= 80) {
      seen.push(key);
      count++;
    }
    return count >= 5;
  });
  assert.strictEqual(count, 5);
  assert.deepStrictEqual(seen, [80, 81, 82, 83, 84]);

  readTxn.commit();
  env.closeSync();
  fs.rmSync(dbPath, { recursive: true, force: true });

  console.log("readme-cursor-example ok");
})();
