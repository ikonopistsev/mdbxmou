"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");

const { keyMode, keyFlag, valueFlag } = MDBX_Param;

(() => {
  const dbPath = path.join(__dirname, "e8-db");
  fs.rmSync(dbPath, { recursive: true, force: true });

  const env = new MDBX_Env();
  env.openSync({ path: dbPath, maxDbi: 10 });

  {
    const writeTxn = env.startWrite();
    const ordinalDbi = writeTxn.createMap("numbers", keyMode.ordinal);
    for (let i = 0; i < 10; i++) {
      ordinalDbi.put(writeTxn, i, `value_${i}`);
    }
    writeTxn.commit();
  }

  {
    const writeTxn = env.startWrite();
    const stringDbi = writeTxn.createMap("strings");
    for (const key of ["a", "b", "c", "d"]) {
      stringDbi.put(writeTxn, key, `v_${key}`);
    }
    writeTxn.commit();
  }

  const readTxn = env.startRead();
  const readOrdinalDbi = readTxn.openMap("numbers", keyMode.ordinal);

  let range = readOrdinalDbi.getRange(readTxn, { start: 3, end: 6 });
  assert.deepEqual(range.map(({ key }) => key), [3, 4, 5, 6]);
  assert.deepEqual(range.map(({ value }) => value.toString()), [
    "value_3",
    "value_4",
    "value_5",
    "value_6",
  ]);

  range = readOrdinalDbi.getRange(readTxn, {
    start: 3,
    end: 6,
    includeStart: false,
    includeEnd: false,
  });
  assert.deepEqual(range.map(({ key }) => key), [4, 5]);

  range = readOrdinalDbi.getRange(readTxn, { start: 3, end: 6, reverse: true });
  assert.deepEqual(range.map(({ key }) => key), [6, 5, 4, 3]);

  range = readOrdinalDbi.getRange(readTxn, {
    start: 3,
    end: 6,
    reverse: true,
    includeStart: false,
    includeEnd: false,
  });
  assert.deepEqual(range.map(({ key }) => key), [5, 4]);

  const keys = readOrdinalDbi.keysRange(readTxn, {
    start: 2,
    end: 8,
    offset: 2,
    limit: 3,
  });
  assert.deepEqual(keys, [4, 5, 6]);

  const values = readOrdinalDbi.valuesRange(readTxn, {
    start: 4,
    end: 6,
  });
  assert.deepEqual(values.map((value) => value.toString()), [
    "value_4",
    "value_5",
    "value_6",
  ]);

  const readStringDbi = readTxn.openMap("strings");
  const stringRange = readStringDbi.getRange(readTxn, { start: "b", end: "c" });
  assert.deepEqual(stringRange.map(({ key }) => key.toString()), ["b", "c"]);
  assert.deepEqual(stringRange.map(({ value }) => value.toString()), ["v_b", "v_c"]);

  const inexactStringRange = readStringDbi.getRange(readTxn, { start: "bb", end: "cc" });
  assert.deepEqual(inexactStringRange.map(({ key }) => key.toString()), ["c"]);

  const reverseInexactStringRange = readStringDbi.getRange(readTxn, {
    start: "bb",
    end: "cc",
    reverse: true,
  });
  assert.deepEqual(reverseInexactStringRange.map(({ key }) => key.toString()), ["c"]);

  assert.deepEqual(
    readStringDbi.keysRange(readTxn, { reverse: true, limit: 2 }).map((key) => key.toString()),
    ["d", "c"]
  );
  assert.deepEqual(
    readStringDbi.valuesRange(readTxn, { start: "b", end: "d" }).map((value) => value.toString()),
    ["v_b", "v_c", "v_d"]
  );

  readTxn.commit();

  env.closeSync();
  fs.rmSync(dbPath, { recursive: true, force: true });

  console.log("e8 ok");
})();
