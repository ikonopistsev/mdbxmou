"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");

(async () => {
  const dbPath = path.join(__dirname, "readme-query-db");
  await fs.promises.rm(dbPath, { recursive: true, force: true });

  const env = new MDBX_Env();
  await env.open({
    path: dbPath,
    valueFlag: MDBX_Param.valueFlag.string,
  });

  const writeTxn = env.startWrite();
  const dbi = writeTxn.createMap(MDBX_Param.keyMode.ordinal);
  writeTxn.commit();

  const alice = JSON.stringify({ name: "Alice" });
  const bob = JSON.stringify({ name: "Bob" });

  const results = await env.query([
    {
      dbi,
      mode: MDBX_Param.queryMode.insertUnique,
      item: [
        { key: 1, value: alice },
        { key: 2, value: bob },
      ],
    },
    {
      dbi,
      mode: MDBX_Param.queryMode.get,
      item: [{ key: 1 }, { key: 2 }],
    },
  ]);

  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].length, 2);
  assert.strictEqual(results[1].length, 2);
  assert.strictEqual(results[1][0].key, 1);
  assert.strictEqual(results[1][0].value, alice);
  assert.strictEqual(results[1][1].key, 2);
  assert.strictEqual(results[1][1].value, bob);

  await env.close();
  await fs.promises.rm(dbPath, { recursive: true, force: true });

  console.log("readme-query-example ok");
})().catch((err) => {
  console.error("readme-query-example failed:", err);
  process.exit(1);
});
