"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");

(async () => {
  const dbPath = path.join(__dirname, "e9-db");
  await fs.promises.rm(dbPath, { recursive: true, force: true });

  const { keyMode, valueMode, valueFlag, queryMode } = MDBX_Param;

  const env = new MDBX_Env();
  await env.open({ path: dbPath, maxDbi: 10 });

  const writeTxn = env.startWrite();
  const dbi = writeTxn.createMap("multiOrdinal", keyMode.ordinal, valueMode.multiOrdinal);
  assert.equal(dbi.valueFlag, valueFlag.number);

  dbi.put(writeTxn, 5, 30);
  dbi.put(writeTxn, 5, 10);
  dbi.put(writeTxn, 5, 20n);
  dbi.put(writeTxn, 6, 40);
  writeTxn.commit();

  const readTxn = env.startRead();
  const readDbi = readTxn.openMap("multiOrdinal", keyMode.ordinal, valueMode.multiOrdinal);

  assert.equal(readDbi.valueFlag, valueFlag.number);
  assert.equal(readDbi.get(readTxn, 5), 10);
  assert.equal(readDbi.get(readTxn, 6), 40);

  const range = readDbi.getRange(readTxn, { start: 5, end: 5 });
  assert.deepEqual(range.map(({ key }) => key), [5, 5, 5]);
  assert.deepEqual(range.map(({ value }) => value), [10, 20, 30]);

  const values = readDbi.valuesRange(readTxn, { start: 5, end: 5 });
  assert.deepEqual(values, [10, 20, 30]);

  const iterValues = [];
  const count = readDbi.forEach(readTxn, 5, "keyEqual", (_key, value) => {
    iterValues.push(value);
  });
  assert.equal(count, 3);
  assert.deepEqual(iterValues, [10, 20, 30]);

  const cursor = readTxn.openCursor(readDbi);
  const first = cursor.seek(5);
  assert.deepEqual(first, { key: 5, value: 10 });
  const second = cursor.next();
  assert.deepEqual(second, { key: 5, value: 20 });
  cursor.close();

  readTxn.commit();

  const writeResult = await env.query({
    dbi,
    mode: queryMode.upsert,
    item: [{ key: 7, value: 70n }, { key: 7, value: 60 }],
  });
  assert.deepEqual(writeResult.map((item) => item.value), [70, 60]);

  const queryResult = await env.query({
    dbi,
    mode: queryMode.get,
    item: [{ key: 7 }],
  });
  assert.equal(queryResult[0].value, 60);

  await env.close();
  await fs.promises.rm(dbPath, { recursive: true, force: true });

  console.log("e9 ok");
})().catch((err) => {
  console.error("e9 failed:", err);
  process.exit(1);
});
