"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");
const { queryMode, keyMode, cursorMode } = MDBX_Param;
const binary = (hex) => Buffer.from(hex, "hex");
const first = binary("010203");
const second = binary("040506");
const a1 = binary("a1");
const a2 = binary("a2");

async function withEnvironment(callback, options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-query-buffer-"));
    const env = new MDBX_Env();
    try {
        env.openSync({ path: root, maxDbi: 8, ...options });
        await callback(env, root);
    } finally {
        env.closeSync();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function seed(env, entries = [], options = { name: "m" }) {
    const txn = env.startWrite();
    try {
        const dbi = txn.createMap(options);
        for (const [key, value] of entries) dbi.put(txn, key, value);
        txn.commit();
        return dbi;
    } finally {
        if (txn.isActive()) txn.abort();
    }
}

function contents(env, dbi) {
    const txn = env.startRead();
    try {
        const rows = [];
        dbi.forEach(txn, (key, value) => rows.push({ key, value }));
        return rows;
    } finally {
        txn.abort();
    }
}

test("query upsert preserves distinct Buffer keys and a string key", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env);
        const expected = [
            { key: first, value: a1 },
            { key: second, value: a2 },
            { key: Buffer.from("text"), value: binary("a3") },
        ];
        const result = await env.query([{
            dbi, mode: queryMode.upsert,
            item: [...expected.slice(0, 2), { key: "text", value: binary("a3") }],
        }]);
        assert.deepEqual(contents(env, dbi), expected);
        assert.deepEqual(result, expected);
    });
});

for (const mode of ["update", "insertUnique"]) {
    test(`query ${mode} uses the requested Buffer keys`, async () => {
        await withEnvironment(async (env) => {
            const dbi = seed(env, mode === "update"
                ? [[first, binary("11")], [second, binary("22")]] : []);
            const item = [{ key: first, value: a1 }, { key: second, value: a2 }];
            assert.deepEqual(await env.query({ dbi, mode: queryMode[mode], item }), item);
            assert.deepEqual(contents(env, dbi), item);
        });
    });
}

test("query get reads Buffer keys rather than the empty-key sentinel", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env, [[Buffer.alloc(0), binary("ee")], [first, a1], [second, a2]]);
        assert.deepEqual(await env.query({
            dbi, queryMode: queryMode.get, item: [{ key: first }, { key: second }],
        }), [{ key: first, value: a1 }, { key: second, value: a2 }]);
    });
});

test("Buffer keys preserve putFlag errors, transaction rollback and append order", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env, [[first, a1]]);
        await assert.rejects(env.query({
            dbi, mode: queryMode.upsert, putFlag: MDBX_Param.putFlag.noOverwrite,
            item: [{ key: binary("00ff"), value: a2 }, { key: first, value: a2 }],
        }));
        assert.deepEqual(contents(env, dbi), [{ key: first, value: a1 }]);
        assert.deepEqual(await env.query({
            dbi, mode: queryMode.upsert, putFlag: MDBX_Param.putFlag.append,
            item: [{ key: second, value: a2 }],
        }), [{ key: second, value: a2 }]);
        assert.deepEqual(contents(env, dbi), [{ key: first, value: a1 }, { key: second, value: a2 }]);
    });
});

test("query del removes only the Buffer key and reports found correctly", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env, [[Buffer.alloc(0), binary("ee")], [first, a1], [second, a2]]);
        assert.deepEqual(await env.query({
            dbi, mode: queryMode.del, item: [{ key: first }, { key: binary("090909") }],
        }), [{ key: first, found: true }, { key: binary("090909"), found: false }]);
        assert.deepEqual(contents(env, dbi), [
            { key: Buffer.alloc(0), value: binary("ee") }, { key: second, value: a2 },
        ]);
    });
});

test("keys uses binary from for inclusive, exclusive and reverse scans", async () => {
    await withEnvironment(async (env) => {
        const keys = [Buffer.alloc(0), binary("00ff"), first, second, binary("ff00")];
        const dbi = seed(env, keys.map((key) => [key, a1]));
        const cases = [
            [cursorMode.keyGreaterOrEqual, keys.slice(3)],
            [cursorMode.keyGreaterThan, keys.slice(4)],
            [cursorMode.keyLesserOrEqual, keys.slice(0, 4).reverse()],
            [cursorMode.keyLesserThan, keys.slice(0, 3).reverse()],
        ];
        for (const [mode, expected] of cases) {
            assert.deepEqual(await env.keys({ dbi, from: second, cursorMode: mode }), expected,
                `cursorMode ${mode}`);
        }
        assert.deepEqual(await env.keys({ dbi, from: second, limit: 1 }), [second]);
    });
});

test("query and keys copy only the visible Buffer.subarray bytes", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env);
        const backing = binary("aa00ffbb");
        const key = backing.subarray(1, 3);
        await env.query({ dbi, mode: queryMode.upsert, item: [{ key, value: a1 }] });
        assert.deepEqual(contents(env, dbi), [{ key: binary("00ff"), value: a1 }]);
        assert.deepEqual(await env.keys({ dbi, from: key }), [key]);
    });
});

for (const operation of ["upsert", "get", "del", "keys"]) {
    test(`${operation} owns Buffer bytes before Queue, including after mutation and GC`, async () => {
        assert.equal(typeof global.gc, "function", "run this suite with --expose-gc");
        await withEnvironment(async (env) => {
            const dbi = seed(env, operation === "keys"
                ? [[Buffer.alloc(0), binary("ee")], [first, a1], [second, a2]]
                : [[first, a1], [second, a2]]);
            // All these default query/keys transactions are writers. Holding a
            // synchronous writer prevents native access until the input is gone.
            const gate = env.startWrite();
            let pending;
            try {
                let key = Buffer.from(first);
                let request = operation === "keys" ? { dbi, from: key } : {
                    dbi, mode: queryMode[operation], item: [{ key, value: binary("b1") }],
                };
                pending = operation === "keys" ? env.keys(request) : env.query(request);
                // Attach a handler before releasing the writer even on failure.
                pending.catch(() => {});
                key.fill(0xff);
                key = null;
                request = null;
                global.gc();
            } finally {
                gate.commit();
            }
            const result = await pending;
            if (operation === "keys") {
                assert.deepEqual(result, [first, second]);
            } else if (operation === "del") {
                assert.deepEqual(result, [{ key: first, found: true }]);
                assert.deepEqual(contents(env, dbi), [{ key: second, value: a2 }]);
            } else {
                assert.deepEqual(result, [{ key: first, value: operation === "get" ? a1 : binary("b1") }]);
                if (operation === "upsert") {
                    assert.deepEqual(contents(env, dbi), [
                        { key: first, value: binary("b1") }, { key: second, value: a2 },
                    ]);
                }
            }
        });
    });
}

test("multiple DBIs and mixed query modes keep their result positions and persist", async () => {
    await withEnvironment(async (env, root) => {
        const dbi = seed(env);
        const other = seed(env, [[second, a2]], { name: "other" });
        const written = [{ key: first, value: a1 }];
        const result = await env.query([
            { dbi, mode: queryMode.upsert, item: written },
            { dbi: other, mode: queryMode.get, item: [{ key: second }] },
        ]);
        assert.deepEqual(result, [written, [{ key: second, value: a2 }]]);
        assert.deepEqual(await env.keys([{ dbi, from: first }, { dbi: other, from: second }]),
            [[first], [second]]);
        env.closeSync();
        env.openSync({ path: root, maxDbi: 8 });
        const txn = env.startRead();
        let reopened;
        try {
            reopened = txn.openMap("m");
        } finally {
            txn.abort();
        }
        assert.deepEqual(contents(env, reopened), written);
    });
});

test("empty Buffer keys retain their existing contract", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env);
        const key = Buffer.alloc(0);
        const written = [{ key, value: a1 }];
        assert.deepEqual(await env.query({ dbi, mode: queryMode.upsert, item: written }), written);
        assert.deepEqual(await env.query({ dbi, mode: queryMode.get, item: [{ key }] }), written);
        assert.deepEqual(await env.keys({ dbi, from: key }), [key]);
        assert.deepEqual(await env.query({ dbi, mode: queryMode.del, item: [{ key }] }),
            [{ key, found: true }]);
        assert.deepEqual(contents(env, dbi), []);
    });
});

test("string and ordinal Number/BigInt keys keep their existing behavior", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env);
        assert.deepEqual(await env.query({
            dbi, mode: queryMode.upsert, item: [{ key: "text", value: a1 }],
        }), [{ key: Buffer.from("text"), value: a1 }]);
        assert.deepEqual(await env.keys({ dbi, from: "text" }), [Buffer.from("text")]);
        for (const [name, mode, one, two] of [
            ["numbers", keyMode.ordinal, 1, 2],
            ["bigints", BigInt(keyMode.ordinal), 1n, 2n],
        ]) {
            const ordinal = seed(env, [], { name, keyMode: mode });
            const item = [{ key: one, value: a1 }, { key: two, value: a2 }];
            assert.deepEqual(await env.query({ dbi: ordinal, mode: queryMode.upsert, item }), item);
            assert.deepEqual(await env.query({
                dbi: ordinal, mode: queryMode.get, item: [{ key: one }],
            }), [item[0]]);
            assert.deepEqual(await env.keys({ dbi: ordinal, from: two }), [two]);
        }
    });
});

test("invalid key types still fail during parsing and the environment stays usable", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env, [[first, a1]]);
        const ordinal = seed(env, [], { name: "ordinal", keyMode: keyMode.ordinal });
        for (const key of [42, 42n, {}, null]) {
            assert.throws(() => env.query({ dbi, mode: queryMode.get, item: [{ key }] }),
                /key must be a Buffer or String/);
            assert.throws(() => env.keys({ dbi, from: key }), /key must be a Buffer or String/);
        }
        assert.throws(() => env.query({
            dbi: ordinal, mode: queryMode.get, item: [{ key: first }],
        }), /key must be a Number or BigInt/);
        assert.deepEqual(await env.query({ dbi, mode: queryMode.get, item: [{ key: first }] }),
            [{ key: first, value: a1 }]);
    });
});


for (const kind of ["binary", "string", "number", "bigint"]) {
    test(`keys empty ranges return [] for ${kind} keys`, async () => {
        await withEnvironment(async env => {
            const ordinal = kind === "number" || kind === "bigint";
            const key = n => kind === "binary" ? Buffer.from([n]) : kind === "string" ? String(n)
                : kind === "bigint" ? BigInt(n) : n;
            const options = name => ({ name, ...(ordinal ? { keyMode: keyMode.ordinal,
                ...(kind === "bigint" ? { keyFlag: MDBX_Param.keyFlag.bigint } : {}) } : {}) });
            const empty = seed(env, [], options("empty")), full = seed(env, [[key(2), a1], [key(4), a2]], options("full"));
            assert.deepEqual(await env.keys(empty), []);
            for (const mode of [cursorMode.keyEqual, cursorMode.keyGreaterOrEqual, cursorMode.keyGreaterThan,
                cursorMode.keyLesserOrEqual, cursorMode.keyLesserThan])
                assert.deepEqual(await env.keys({ dbi: empty, from: key(3), cursorMode: mode }), []);
            for (const [mode, from] of [[cursorMode.keyEqual, 3], [cursorMode.keyGreaterOrEqual, 5],
                [cursorMode.keyGreaterThan, 4], [cursorMode.keyLesserOrEqual, 1], [cursorMode.keyLesserThan, 2]])
                assert.deepEqual(await env.keys({ dbi: full, from: key(from), cursorMode: mode }), []);
            const convert = n => ordinal ? key(n) : Buffer.isBuffer(key(n)) ? key(n) : Buffer.from(key(n));
            assert.deepEqual(await env.keys({ dbi: full, from: key(2), limit: 1 }), [convert(2)]);
            assert.deepEqual(await env.keys({ dbi: full, from: key(4), cursorMode: cursorMode.keyLesserOrEqual }), [convert(4), convert(2)]);
            assert.deepEqual(await env.keys([
                { dbi: empty, from: key(3) },
                { dbi: full, from: key(2), cursorMode: cursorMode.keyGreaterOrEqual, limit: 1 },
                { dbi: full, from: key(3), cursorMode: cursorMode.keyEqual },
                { dbi: full, from: key(4), cursorMode: cursorMode.keyEqual },
            ]), [[], [convert(2)], [], [convert(4)]]);
        });
    });
}

test("keys empty scan handling does not mask native operation errors or closed environment", async () => {
    await withEnvironment(async env => {
        const dbi = seed(env, [[first, a1]]);
        // FIRST is valid as a cursor operation but invalid as scan_from's start operation.
        await assert.rejects(env.keys({ dbi, from: first, cursorMode: cursorMode.first }));
        await assert.rejects(env.keys([
            { dbi, from: binary("ff"), cursorMode: cursorMode.keyGreaterOrEqual },
            { dbi, from: first, cursorMode: cursorMode.first },
        ]));
        assert.deepEqual(await env.keys({ dbi, from: first }), [first]);
        const closed = new MDBX_Env();
        assert.throws(() => closed.keys({ dbi, from: first }));
    });
});
