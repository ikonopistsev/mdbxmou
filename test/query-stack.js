"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { MDBX_Env, MDBX_Param: P } = require("../lib/nativemou.js");
const Q = P.queryMode;
const b = (text) => Buffer.from(text);

async function fixture(callback, Env = MDBX_Env) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-stack-"));
    const env = new Env();
    const pending = new Set();
    const query = env.query.bind(env);
    Object.defineProperty(env, "query", { value: (...args) => {
        const promise = query(...args);
        pending.add(promise);
        promise.then(() => pending.delete(promise), () => pending.delete(promise));
        return promise;
    } });
    try {
        env.openSync({ path: root, maxDbi: 16 });
        const txn = env.startWrite();
        const source = txn.createMap({ name: "source" });
        const target = txn.createMap({ name: "target" });
        txn.commit();
        await callback(env, source, target);
    } finally {
        await Promise.allSettled([...pending]);
        env.closeSync();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

const get = (dbi, key, extra = {}) => ({ dbi, mode: Q.get, push: true, result: false, item: [{ key }], ...extra });
const put = (dbi, key, value, extra = {}) => ({ dbi, mode: Q.upsert, result: false, item: [{ key, value }], ...extra });
const del = (dbi, key, extra = {}) => ({ dbi, mode: Q.del, result: false, item: [{ key }], ...extra });

function read(env, dbi, key) {
    const txn = env.startRead();
    try { return dbi.get(txn, key); } finally { txn.abort(); }
}

test("owning old images survive updates, deletion, pop, commit and producer echo", async () => fixture(async (env, source, target) => {
    const key = b("source");
    const old = Buffer.alloc(65539, 0xfe);
    old[1] = 0; old[2] = 0x80;
    const middle = b("middle");
    const output = await env.query([
        put(source, key, old),
        get(source, key, { result: true }),
        put(source, key, middle),
        get(source, key, { result: true }),
        put(source, key, b("last")),
        del(source, key),
        put(target, b("middle"), { pop: true }, { result: true }),
        put(target, b("old"), { pop: true }, { result: true }),
    ]);
    assert.deepEqual(output[1], [{ key, value: old }]);
    assert.deepEqual(output[3], [{ key, value: middle }]);
    assert.deepEqual(output[6], [{ key: b("middle"), value: middle }]);
    assert.deepEqual(output[7], [{ key: b("old"), value: old }]);
    assert.deepEqual(read(env, target, b("old")), old);
    assert.deepEqual(read(env, target, b("middle")), middle);
    assert.equal(read(env, source, key), undefined);
}));

test("empty is found and copied; missing aborts earlier writes with echo on or off", async () => fixture(async (env, source, target) => {
    const empty = Buffer.alloc(0);
    const out = await env.query([
        put(source, b("empty"), empty), get(source, b("empty"), { result: true }),
        put(target, b("copy"), { pop: true }, { result: true }),
    ]);
    // Preserve the existing public echo convention; internal presence is separate.
    assert.equal(out[1][0].value, null);
    assert.equal(out[2][0].value, null);
    assert.deepEqual(read(env, target, b("copy")), empty);
    for (const result of [false, true]) {
        await assert.rejects(env.query([
            put(target, b("rolled-back"), b("v")),
            get(source, b("missing")), put(target, b("bad"), { pop: true }, { result }),
        ]), /^Error: query operand missing/);
        assert.equal(read(env, target, b("rolled-back")), undefined);
        assert.equal(read(env, target, b("bad")), undefined);
    }
}));

test("multi-item LIFO, key before value, peek reuse, reference get and del", async () => fixture(async (env, source, target) => {
    await env.query([put(source, b("v"), b("payload")), put(source, b("k"), b("target"))]);
    const out = await env.query([
        { dbi: source, mode: Q.get, push: true, result: false, item: [{ key: b("v") }, { key: b("k") }] },
        put(target, { peek: 0 }, { peek: 1 }, { result: true }),
        put(target, { pop: true }, { peek: 0 }),
        put(target, b("copy"), { peek: 0 }),
        put(target, b("copy2"), { pop: true }),
        get(source, b("k")),
        get(target, { peek: 0 }, { push: false, result: true }),
        del(target, { pop: true }),
    ]);
    assert.deepEqual(out[1], [{ key: b("target"), value: b("payload") }]);
    assert.deepEqual(out[6], [{ key: b("target"), value: b("payload") }]);
    assert.equal(out[7], undefined);
    assert.ok(Object.hasOwn(out, 7));
    assert.equal(read(env, target, b("target")), undefined);
    assert.deepEqual(read(env, target, b("copy2")), b("payload"));
}));

test("pop key then pop value consumes two entries in order", async () => fixture(async (env, source, target) => {
    const out = await env.query([
        put(source, b("v"), b("value")), put(source, b("k"), b("key")),
        get(source, b("v")), get(source, b("k")),
        put(target, { pop: true }, { pop: true }, { result: true }),
    ]);
    assert.deepEqual(out[4], [{ key: b("key"), value: b("value") }]);
}));

test("malformed operands and stack misuse fail synchronously before any mutation", async () => fixture(async (env, source, target) => {
    const malformed = [{ pop: false }, { pop: 1 }, { pop: true, peek: 0 },
        { pop: true, typo: 1 }, { peek: -1 }, { peek: 0.5 }, { peek: NaN },
        { peek: Infinity }, { peek: Number.MAX_SAFE_INTEGER + 1 }, { peek: "0" },
        { peek: 1 }, { peek: Number.MAX_SAFE_INTEGER }];
    for (const value of malformed) {
        assert.throws(() => env.query([
            put(target, b("uncommitted"), b("v")), get(source, b("a")),
            put(target, b("bad"), value),
        ]), TypeError);
    }
    for (const value of [{}, []]) {
        // Objects without operand fields retain legacy literal validation.
        assert.throws(() => env.query(put(target, b("bad"), value)), Error);
    }
    for (const key of [[], [1]]) {
        assert.throws(() => env.query(get(source, key)), /key must be a Buffer or String/);
    }
    for (const row of [put(target, b("a"), { pop: true }),
        get(source, { pop: true }), put(target, b("a"), b("b"), { push: true }),
        del(target, b("a"), { push: true }), get(source, b("a"), { push: 1 })]) {
        assert.throws(() => env.query(row), TypeError);
    }
    assert.equal(read(env, target, b("uncommitted")), undefined);
}));

test("concurrent batches have independent stacks and read-only references work", async () => fixture(async (env, source, target) => {
    await env.query([put(source, b("a"), b("b")), put(source, b("b"), b("value"))]);
    const out = await env.query([get(source, b("a")), get(source, { pop: true }, { result: true })], P.txnMode.ro);
    assert.deepEqual(out[1], [{ key: b("b"), value: b("value") }]);
    await Promise.all(Array.from({ length: 12 }, (_, i) => env.query([
        put(source, b("shared"), b(`${i}`)), get(source, b("shared")),
        put(target, b(`${i}`), { pop: true }),
    ])));
    for (let i = 0; i < 12; i++) assert.deepEqual(read(env, target, b(`${i}`)), b(`${i}`));
    assert.throws(() => env.query(put(target, b("new"), { pop: true })), TypeError);
}));

function ordinal(value, width) {
    const bytes = Buffer.alloc(width);
    if (width === 4) bytes[os.endianness() === "LE" ? "writeUInt32LE" : "writeUInt32BE"](Number(value));
    else bytes[os.endianness() === "LE" ? "writeBigUInt64LE" : "writeBigUInt64BE"](BigInt(value));
    return bytes;
}

for (const width of [4, 8]) for (const outputType of ["number", "bigint"]) {
    test(`ordinal key and INTEGERDUP references preserve native ${width}-byte width with ${outputType} echo`, async () => fixture(async (env, source) => {
        const txn = env.startWrite();
        const keyMap = txn.createMap({ name: "keys", keyMode: P.keyMode.ordinal, keyFlag: P.keyFlag[outputType] });
        const valMap = txn.createMap({ name: "values", valueMode: P.valueMode.multiOrdinal, valueFlag: P.valueFlag[outputType] });
        const rawKeys = txn.openMap({ name: "keys", flags: keyMap.flags(txn), keyMode: 0, keyFlag: 0 });
        const rawVals = txn.openMap({ name: "values", flags: valMap.flags(txn), valueMode: 0, valueFlag: 0 });
        txn.commit();
        const number = width === 4 ? 0x80000000n : 0x8000000000000000n;
        const expected = outputType === "bigint" ? number : Number(number);
        const legacyGetValue = outputType === "number" && width === 8 ? -Number(number) : expected;
        const bytes = ordinal(number, width);
        const out = await env.query([
            put(source, b("n"), bytes), get(source, b("n")),
            put(keyMap, { peek: 0 }, b("value"), { result: true }),
            put(valMap, b("key"), { pop: true }, { result: true }),
            get(valMap, b("key"), { result: true }),
            get(keyMap, { pop: true }, { result: true, push: false }),
        ]);
        assert.deepEqual(out[2], [{ key: expected, value: b("value") }]);
        assert.deepEqual(out[3], [{ key: b("key"), value: expected }]);
        assert.deepEqual(out[4], [{ key: b("key"), value: legacyGetValue }]);
        assert.deepEqual(out[5], [{ key: expected, value: b("value") }]);
        assert.deepEqual(read(env, rawKeys, bytes), b("value"));
        assert.deepEqual(read(env, rawVals, b("key")), bytes);
        const deleted = await env.query([get(source, b("n")), del(keyMap, { pop: true }, { result: true })]);
        assert.deepEqual(deleted[1], [{ key: expected, found: true }]);
        assert.equal(read(env, rawKeys, bytes), undefined);
    }));
}

test("wrong ordinal width rejects before commit, including suppressed responses", async () => fixture(async (env, source, target) => {
    const txn = env.startWrite();
    const numeric = txn.createMap({ name: "numbers", keyMode: P.keyMode.ordinal });
    txn.commit();
    for (const result of [true, false]) {
        await assert.rejects(env.query([
            put(source, b("bad"), b("abc")), get(source, b("bad")),
            put(target, b("before"), b("write")),
            put(numeric, { pop: true }, b("v"), { result }),
        ]), /^Error: query operand width/);
        assert.equal(read(env, target, b("before")), undefined);
        assert.equal(read(env, source, b("bad")), undefined);
    }
}));

test("string echo does not reencode raw transferred bytes", async () => fixture(async (env, source) => {
    const txn = env.startWrite();
    const strings = txn.createMap({ name: "strings", valueFlag: P.valueFlag.string });
    const raw = txn.openMap({ name: "strings", valueFlag: 0 });
    txn.commit();
    const bytes = Buffer.from([0xff, 0x00, 0xc3, 0x28]);
    const out = await env.query([
        put(source, b("raw"), bytes), get(source, b("raw")),
        put(strings, b("key"), { pop: true }, { result: true }),
    ]);
    assert.equal(out[2][0].value, bytes.toString("utf8"));
    assert.deepEqual(read(env, raw, b("key")), bytes);
}));

test("ESM entry exposes the same native stack API", async () => {
    const esm = await import("../lib/index.mjs");
    await fixture(async (env, source, target) => {
        await env.query([put(source, b("a"), b("v")), get(source, b("a")), put(target, b("b"), { pop: true })]);
        assert.deepEqual(read(env, target, b("b")), b("v"));
    }, esm.MDBX_Env);
});

test("literal key getter is read once and operand descriptors are captured before Queue", async () => fixture(async (env, source, target) => {
    await env.query(put(source, b("key"), b("value")));
    let calls = 0;
    const operand = { pop: true };
    const gate = env.startWrite();
    let pending;
    try {
        pending = env.query([
            get(source, b("unused"), { item: [{ get key() { calls++; return calls === 1 ? b("key") : b("wrong"); } }] }),
            put(target, b("copy"), operand),
        ]);
        pending.catch(() => {});
        operand.pop = false;
        operand.peek = 999;
        global.gc();
    } finally { gate.commit(); }
    await pending;
    assert.equal(calls, 1);
    assert.deepEqual(read(env, target, b("copy")), b("value"));
}));

test("DUPSORT get copies the first duplicate before deleting all duplicates", async () => fixture(async (env, source, target) => {
    const txn = env.startWrite();
    const duplicates = txn.createMap({ name: "duplicates", valueMode: P.valueMode.multi });
    duplicates.put(txn, b("k"), b("z"));
    duplicates.put(txn, b("k"), b("a"));
    txn.commit();
    await env.query([get(duplicates, b("k")), del(duplicates, b("k")), put(target, b("first"), { pop: true })]);
    assert.deepEqual(read(env, target, b("first")), b("a"));
    assert.equal(read(env, duplicates, b("k")), undefined);
}));

test("native failure after copying a reference aborts all preceding writes", async () => fixture(async (env, source, target) => {
    await env.query(put(target, b("occupied"), b("old")));
    await assert.rejects(env.query([
        put(source, b("k"), b("new")), get(source, b("k")),
        put(target, b("copied"), { peek: 0 }),
        put(target, b("occupied"), { pop: true }, { mode: Q.insertUnique }),
    ]));
    assert.equal(read(env, source, b("k")), undefined);
    assert.equal(read(env, target, b("copied")), undefined);
    assert.deepEqual(read(env, target, b("occupied")), b("old"));
}));

test("suppressed unused gets need no retained image; a later reference still does", async () => fixture(async (env, source, target) => {
    const output = await env.query([
        put(source, b("k"), b("old")),
        get(source, b("missing")), // Unused missing stack entries are allowed.
        get(source, b("k")), // Unused push is also allowed.
        get(source, b("k"), { push: false }),
        get(source, b("k")), // Only this producer is consumed.
        put(source, b("k"), b("new")),
        put(target, b("old"), { pop: true }),
    ]);
    assert.deepEqual(output, Array(7).fill(undefined));
    assert.deepEqual(read(env, target, b("old")), b("old"));
    assert.deepEqual(read(env, source, b("k")), b("new"));
}));

test("same-row get chain pushes each item before the next; missing aborts earlier writes", async () => fixture(async (env, source, target) => {
    await env.query([put(source, b("a"), b("b")), put(source, b("b"), b("c")), put(source, b("c"), b("payload"))]);
    const chain = { dbi: source, mode: Q.get, push: true,
        item: [{ key: b("a") }, { key: { pop: true } }, { key: { pop: true } }] };
    const out = await env.query([chain, put(target, b("copy"), { pop: true })]);
    assert.deepEqual(out[0], [{ key: b("a"), value: b("b") },
        { key: b("b"), value: b("c") }, { key: b("c"), value: b("payload") }]);
    assert.deepEqual(read(env, target, b("copy")), b("payload"));
    await env.query(del(source, b("b")));
    await assert.rejects(env.query([put(target, b("before"), b("x")), chain,
        put(target, b("bad"), { pop: true })]), /^Error: query operand missing/);
    assert.equal(read(env, target, b("before")), undefined);
}));

test("legacy get/del ignore value without invoking its getter", async () => fixture(async (env, source) => {
    await env.query(put(source, b("key"), b("value")));
    const item = { key: b("key"), get value() { throw new Error("must stay unused"); } };
    assert.deepEqual(await env.query({ dbi: source, mode: Q.get, item: [item] }), [{ key: b("key"), value: b("value") }]);
    assert.deepEqual(await env.query({ dbi: source, mode: Q.del, item: [item] }), [{ key: b("key"), found: true }]);
}));
