"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");

(() => {
  const dbPath = path.join(__dirname, "readme-key-types-db");
  fs.rmSync(dbPath, { recursive: true, force: true });

  const env = new MDBX_Env();
  env.openSync({ path: dbPath });

  const txn = env.startWrite();
  const dbi = txn.createMap(MDBX_Param.keyMode.ordinal);
  dbi.put(txn, 1, "one");
  dbi.put(txn, 2, "two");
  dbi.put(txn, 3, "three");
  txn.commit();

  const readTxn1 = env.startRead();
  const numberDbi = readTxn1.openMap(MDBX_Param.keyMode.ordinal);
  const numberTypes = [];
  numberDbi.forEach(readTxn1, (key) => {
    numberTypes.push(typeof key);
  });
  readTxn1.commit();
  assert.ok(numberTypes.length > 0);
  assert.ok(numberTypes.every((t) => t === "number"));

  const readTxn2 = env.startRead();
  const bigintDbi = readTxn2.openMap(BigInt(MDBX_Param.keyMode.ordinal));
  const bigintTypes = [];
  bigintDbi.forEach(readTxn2, (key) => {
    bigintTypes.push(typeof key);
  });
  readTxn2.commit();
  assert.ok(bigintTypes.length > 0);
  assert.ok(bigintTypes.every((t) => t === "bigint"));

  env.closeSync();
  fs.rmSync(dbPath, { recursive: true, force: true });

  console.log("readme-key-types ok");
})();
