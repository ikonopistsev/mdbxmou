"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");

(() => {
  const dbPath = path.join(__dirname, "readme-range-example-db");
  fs.rmSync(dbPath, { recursive: true, force: true });

  const env = new MDBX_Env();
  env.openSync({
    path: dbPath,
    valueFlag: MDBX_Param.valueFlag.string,
  });

  const writeTxn = env.startWrite();
  const dbi = writeTxn.createMap(MDBX_Param.keyMode.ordinal);
  for (let i = 0; i < 10; i++) {
    dbi.put(writeTxn, i, `value_${i}`);
  }
  writeTxn.commit();

  const readTxn = env.startRead();
  const readDbi = readTxn.openMap(MDBX_Param.keyMode.ordinal);

  const rows = readDbi.getRange(readTxn, { start: 3, end: 6 });
  assert.deepStrictEqual(rows, [
    { key: 3, value: "value_3" },
    { key: 4, value: "value_4" },
    { key: 5, value: "value_5" },
    { key: 6, value: "value_6" },
  ]);

  const total = readDbi.getCount(readTxn, { start: 3, end: 8 });
  assert.strictEqual(total, 6);

  const keys = readDbi.keysRange(readTxn, {
    start: 3,
    end: 8,
    offset: 1,
    limit: 3,
  });
  assert.deepStrictEqual(keys, [4, 5, 6]);

  const values = readDbi.valuesRange(readTxn, {
    start: 3,
    end: 6,
    reverse: true,
    includeEnd: false,
  });
  assert.deepStrictEqual(values, ["value_5", "value_4", "value_3"]);

  readTxn.commit();
  env.closeSync();
  fs.rmSync(dbPath, { recursive: true, force: true });

  console.log("readme-range-example ok");
})();
