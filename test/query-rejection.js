"use strict";
// Unsupported query syntax must fail before any batch writes.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { MDBX_Env, MDBX_Param: P } = require("../lib/nativemou.js");
const b = s => Buffer.from(s);
test("query rejects removed rows/when before any batch writes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "query-rejection-")), env = new MDBX_Env(); let txn;
    try {
        env.openSync({ path: dir, maxDbi: 8 }); txn = env.startWrite(); const dbi = txn.createMap("data"); txn.commit();
        const write = { dbi, mode: P.queryMode.upsert, item: [{ key: b("k"), value: b("v") }] };
        const rows = [
            { op: "compute", value: b("v"), push: true, result: false },
            { op: "expect", test: 0n, result: false },
            { op: "chunks", dbi, source: b("v"), capacity: 1n, key: b("k"), value: { chunk: "bytes" }, result: false },
            { ...write, when: 0n }, { ...write, when: 1n },
            { op: "bulk", dbi, action: "range", when: 0n },
            { op: "bulk", dbi, action: "range", when: 1n },
        ];
        for (const row of rows) {
            assert.throws(() => env.query([write, row]), /unsupported query operation|query when is not supported/);
            txn = env.startRead(); assert.equal(dbi.get(txn, b("k")), undefined); txn.abort();
        }
        assert.throws(() => env.query([write, { ...write, item: [{ key: b("expr"), value: { parts: [b("x")] } }] }]));
        txn = env.startRead(); assert.equal(dbi.get(txn, b("k")), undefined); txn.abort();
        await env.query({ ...write, when: undefined });
        const result = await env.query({ dbi, item: [{ key: b("k") }] });
        assert.deepEqual(result, [{ key: b("k"), value: b("v") }]);
    } finally { if (txn?.isActive()) txn.abort(); env.closeSync(); fs.rmSync(dir, { recursive: true, force: true }); }
});
