"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { MDBX_Env, MDBX_Param: P } = require("../lib/nativemou.js");
const first = Buffer.from("first");
const second = Buffer.from("second");
const value = Buffer.from("value");

async function withEnvironment(callback) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-query-result-"));
    const env = new MDBX_Env();
    const pending = new Set();
    const nativeQuery = env.query.bind(env);
    // Drain unexpected queued work when a validation assertion fails on the
    // baseline, so teardown does not hide the actual regression.
    Object.defineProperty(env, "query", { value: (...args) => {
        const promise = nativeQuery(...args);
        pending.add(promise);
        promise.then(() => pending.delete(promise), () => pending.delete(promise));
        return promise;
    } });
    try {
        env.openSync({ path: root, maxDbi: 8 });
        await callback(env, root);
    } finally {
        await Promise.allSettled([...pending]);
        env.closeSync();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function seed(env, rows = [], options = { name: "m" }) {
    const txn = env.startWrite();
    try {
        const dbi = txn.createMap(options);
        for (const { key, value } of rows) dbi.put(txn, key, value);
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

function flagError(callback, message) {
    assert.throws(callback, (error) => error instanceof TypeError && error.message === message);
}

for (const mode of ["upsert", "update", "insertUnique"]) {
    test(`${mode}: false skips echo; true, undefined and default keep it`, async () => {
        await withEnvironment(async (env) => {
            const dbi = seed(env);
            let index = 0;
            for (const flag of [false, true, undefined, "omitted"]) {
                const key = Buffer.from(`${index++}`);
                const item = [{ key, value }];
                if (mode === "update") {
                    const txn = env.startWrite();
                    dbi.put(txn, key, Buffer.from("old"));
                    txn.commit();
                }
                const request = { dbi, mode: P.queryMode[mode], item };
                if (flag !== "omitted") request.result = flag;
                assert.deepEqual(await env.query(request), flag === false ? undefined : item);
                assert.ok(contents(env, dbi).some((row) => row.key.equals(key) && row.value.equals(value)));
            }
        });
    });
}

test("array-of-one returns its row directly, including strict undefined", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env);
        const item = [{ key: first, value }];
        for (const result of [false, true, undefined]) {
            assert.deepEqual(await env.query([{ dbi, mode: P.queryMode.upsert, result, item }]),
                result === false ? undefined : item);
        }
    });
});

test("multiple suppressed writes retain dense undefined positions", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env);
        const requests = [first, second].map((key) => ({
            dbi, mode: P.queryMode.upsert, result: false, item: [{ key, value }],
        }));
        const result = await env.query(requests);
        assert.deepEqual(result, [undefined, undefined]);
        assert.ok(Object.hasOwn(result, 0) && Object.hasOwn(result, 1));
        assert.deepEqual(contents(env, dbi), [{ key: first, value }, { key: second, value }]);
    });
});

test("mixed DBIs preserve write/get/del responses and committed data after reopen", async () => {
    await withEnvironment(async (env, root) => {
        const dbi = seed(env);
        const other = seed(env, [{ key: second, value }], { name: "other" });
        const result = await env.query([
            { dbi, mode: P.queryMode.upsert, result: false, item: [{ key: first, value }] },
            { dbi, mode: P.queryMode.get, item: [{ key: first }] },
            { dbi: other, mode: P.queryMode.del, item: [{ key: second }, { key: first }] },
            { dbi: other, mode: P.queryMode.upsert, result: true, item: [{ key: first, value }] },
        ]);
        assert.deepEqual(result, [undefined, [{ key: first, value }],
            [{ key: second, found: true }, { key: first, found: false }], [{ key: first, value }]]);
        assert.ok(Object.hasOwn(result, 0));
        assert.deepEqual(await env.keys(dbi), [first]);
        env.closeSync();
        env.openSync({ path: root, maxDbi: 8 });
        const txn = env.startRead();
        let reopened;
        try { reopened = txn.openMap("m"); } finally { txn.abort(); }
        assert.deepEqual(contents(env, reopened), [{ key: first, value }]);
    });
});

test("empty item and empty request arrays keep their specified forms", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env);
        assert.equal(await env.query({ dbi, mode: P.queryMode.upsert, result: false, item: [] }), undefined);
        assert.deepEqual(await env.query({ dbi, mode: P.queryMode.upsert, result: true, item: [] }), []);
        assert.deepEqual(await env.query([]), []);
        assert.deepEqual(await env.query([
            { dbi, mode: P.queryMode.upsert, result: false, item: [] },
            { dbi, mode: P.queryMode.get, item: [] },
        ]), [undefined, []]);
    });
});

test("result:undefined behaves as an absent flag on get and del", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env, [{ key: first, value }]);
        assert.deepEqual(await env.query({ dbi, result: undefined, item: [{ key: first }] }),
            [{ key: first, value }]);
        assert.deepEqual(await env.query({ dbi, mode: P.queryMode.del, result: undefined, item: [{ key: first }] }),
            [{ key: first, found: true }]);
    });
});

test("invalid result types throw TypeError synchronously and leave no work", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env);
        for (const result of [0, 1, "false", null, {}, [], new Boolean(false)]) {
            flagError(() => env.query({ dbi, mode: P.queryMode.upsert, result, item: [{ key: first, value }] }),
                "query result must be a boolean");
        }
        assert.equal(await env.query({ dbi, mode: P.queryMode.upsert, result: false, item: [{ key: second, value }] }), undefined);
        assert.deepEqual(contents(env, dbi), [{ key: second, value }]);
        await env.close();
    });
});

test("get/default-get/alias-get/del reject both booleans with deterministic error order", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env, [{ key: first, value }]);
        for (const mode of [{}, { mode: P.queryMode.get }, { queryMode: P.queryMode.get }, { mode: P.queryMode.del }]) {
            for (const result of [false, true]) {
                flagError(() => env.query({ dbi, ...mode, result, item: [{ key: first }] }),
                    "query result requires write queryMode");
            }
        }
        flagError(() => env.query({ dbi, result: 0, item: [] }), "query result must be a boolean");
        flagError(() => env.query({ dbi, putFlag: P.putFlag.noOverwrite, result: 0, item: [] }),
            "query putFlag requires write queryMode");
        assert.deepEqual(contents(env, dbi), [{ key: first, value }]);
    });
});

test("invalid late row prevents all writes and permits closing", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env);
        flagError(() => env.query([
            { dbi, mode: P.queryMode.upsert, result: false, item: [{ key: first, value }] },
            { dbi, mode: P.queryMode.upsert, result: null, item: [] },
        ]), "query result must be a boolean");
        assert.equal(await env.query({ dbi, mode: P.queryMode.upsert, result: false,
            item: [{ key: second, value }] }), undefined);
        assert.deepEqual(contents(env, dbi), [{ key: second, value }]);
        await env.close();
    });
});

test("inherited flags are parsed and throwing getters preserve exception identity", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env);
        const request = Object.assign(Object.create({ result: false }), {
            dbi, mode: P.queryMode.upsert, item: [{ key: first, value }],
        });
        assert.equal(await env.query(request), undefined);
        for (const mode of [P.queryMode.get, P.queryMode.del]) {
            for (const result of [false, true]) {
                flagError(() => env.query(Object.assign(Object.create({ result }), {
                    dbi, mode, item: [{ key: first }],
                })), "query result requires write queryMode");
            }
        }
        for (const error of [new Error("getter"), { reason: "getter" }]) {
            const throwing = { dbi, mode: P.queryMode.upsert, item: [{ key: second, value }],
                get result() { throw error; } };
            assert.throws(() => env.query(throwing), (caught) => caught === error);
        }
        assert.deepEqual(contents(env, dbi), [{ key: first, value }]);
        assert.equal(await env.query({ dbi, mode: P.queryMode.upsert, result: false,
            item: [{ key: first, value: Buffer.from("after-getter") }] }), undefined);
        assert.deepEqual(contents(env, dbi), [{ key: first, value: Buffer.from("after-getter") }]);
        await env.close();
    });
});

for (const result of [false, true]) {
    test(`native write failures reject and roll back the batch with result:${result}`, async () => {
        await withEnvironment(async (env) => {
            const dbi = seed(env, [{ key: second, value }]);
            for (const options of [
                { mode: P.queryMode.insertUnique },
                { mode: P.queryMode.upsert, putFlag: P.putFlag.noOverwrite },
            ]) {
                await assert.rejects(env.query({ dbi, ...options, result,
                    item: [{ key: first, value }, { key: second, value: Buffer.from("new") }],
                }));
                assert.deepEqual(contents(env, dbi), [{ key: second, value }]);
            }
            await assert.rejects(env.query([
                { dbi, mode: P.queryMode.upsert, result, item: [{ key: first, value }] },
                { dbi, mode: P.queryMode.insertUnique, result, item: [{ key: second, value }] },
            ]));
            assert.deepEqual(contents(env, dbi), [{ key: second, value }]);
        });
    });
}

test("putFlag append/current work without echo; mode validation remains ordinary Error", async () => {
    await withEnvironment(async (env) => {
        const dbi = seed(env, [{ key: first, value }]);
        for (const [putFlag, key] of [[P.putFlag.append, second], [P.putFlag.current, first]]) {
            assert.equal(await env.query({ dbi, mode: P.queryMode.upsert, putFlag, result: false,
                item: [{ key, value: Buffer.from("new") }] }), undefined);
        }
        for (const [mode, txnMode, message] of [
            [P.queryMode.upsert, P.txnMode.ro, "rw query in read-only transaction"],
            [P.queryMode.get | P.queryMode.del, undefined, "queryMode must be one of get/del/upsert/update/insertUnique"],
        ]) {
            assert.throws(() => env.query({ dbi, mode, result: false, item: [] }, txnMode === undefined ? 0 : txnMode),
                (error) => error instanceof Error && !(error instanceof TypeError) && error.message === message);
        }
        assert.deepEqual(contents(env, dbi), [
            { key: first, value: Buffer.from("new") }, { key: second, value: Buffer.from("new") },
        ]);
    });
});

test("suppressed writes retain binary/subarray/string/ordinal keys and values", async () => {
    await withEnvironment(async (env) => {
        const cases = [
            [{}, Buffer.from([0xaa, 0, 0xff, 0xbb]).subarray(1, 3), Buffer.from([0xcc, 0, 0xff, 0xdd]).subarray(1, 3)],
            [{ keyFlag: P.keyFlag.string, valueFlag: P.valueFlag.string }, "ключ", "значение"],
            [{ keyMode: P.keyMode.ordinal }, 42, value],
            [{ keyMode: BigInt(P.keyMode.ordinal) }, 42n, value],
            [{ keyMode: P.keyMode.ordinal, valueMode: P.valueMode.multiOrdinal }, 42, 7],
            [{ keyMode: P.keyMode.ordinal, valueMode: P.valueMode.multiOrdinal, valueFlag: P.valueFlag.bigint }, 42, 7n],
        ];
        for (const [index, [options, key, value]] of cases.entries()) {
            const dbi = seed(env, [], { name: `m${index}`, ...options });
            assert.equal(await env.query({ dbi, mode: P.queryMode.upsert, result: false, item: [{ key, value }] }), undefined);
            assert.deepEqual(contents(env, dbi), [{ key, value }]);
        }
        const empty = seed(env, [], { name: "empty" });
        assert.equal(await env.query({ dbi: empty, mode: P.queryMode.upsert, result: false,
            item: [{ key: Buffer.alloc(0), value: Buffer.alloc(0) }] }), undefined);
        assert.deepEqual(contents(env, empty), [{ key: Buffer.alloc(0), value: Buffer.alloc(0) }]);
    });
});

test("suppressed write owns input bytes before Queue and completes only after commit", async () => {
    assert.equal(typeof global.gc, "function", "run with --expose-gc");
    await withEnvironment(async (env) => {
        const dbi = seed(env);
        const gate = env.startWrite();
        let pending;
        let settled = false;
        try {
            let key = Buffer.allocUnsafeSlow(first.length);
            first.copy(key);
            let inputValue = Buffer.allocUnsafeSlow(value.length);
            value.copy(inputValue);
            let request = { dbi, mode: P.queryMode.upsert, result: false, item: [{ key, value: inputValue }] };
            pending = env.query(request);
            pending.then(() => { settled = true; }, () => { settled = true; });
            key.fill(0xff);
            inputValue.fill(0xff);
            key = null;
            inputValue = null;
            request = null;
            global.gc();
            await new Promise((resolve) => setImmediate(resolve));
            assert.equal(settled, false, "held writer prevents commit and settlement");
        } finally {
            gate.commit();
        }
        assert.equal(await pending, undefined);
        assert.deepEqual(contents(env, dbi), [{ key: first, value }]);
    });
});
