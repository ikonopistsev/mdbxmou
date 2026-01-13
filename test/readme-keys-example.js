"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");

(async () => {
  const dbPath = path.join(__dirname, "readme-keys-db");
  await fs.promises.rm(dbPath, { recursive: true, force: true });

  const env = new MDBX_Env();
  await env.open({ path: dbPath });

  const writeTxn = env.startWrite();
  const dbi = writeTxn.createMap(MDBX_Param.keyMode.ordinal);
  for (let i = 1; i <= 10; i++) {
    dbi.put(writeTxn, i, `value-${i}`);
  }
  writeTxn.commit();

  const allKeys = await env.keys(dbi);
  assert.strictEqual(allKeys.length, 10);
  assert.ok(allKeys.every((k) => typeof k === "number"));

  const allKeys2 = await env.keys({ dbi });
  assert.strictEqual(allKeys2.length, 10);

  const multiKeys = await env.keys([dbi, dbi]);
  assert.strictEqual(multiKeys.length, 2);
  assert.strictEqual(multiKeys[0].length, 10);
  assert.strictEqual(multiKeys[1].length, 10);

  const limitedKeys = await env.keys([
    { dbi, limit: 3, from: 5 },
  ]);
  assert.strictEqual(limitedKeys.length, 3);
  assert.deepStrictEqual(limitedKeys, [5, 6, 7]);

  await env.close();
  await fs.promises.rm(dbPath, { recursive: true, force: true });

  console.log("readme-keys-example ok");
})().catch((err) => {
  console.error("readme-keys-example failed:", err);
  process.exit(1);
});
