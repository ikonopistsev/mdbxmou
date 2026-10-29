"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { MDBX_Env, MDBX_Param: P } = require("../lib/nativemou.js");

function fixture(options, seed, run, readonly = false) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-seek-both-"));
    const env = new MDBX_Env();
    let txn; const cursors = [];
    try {
        env.openSync({ path: dir, maxDbi: 8 });
        txn = env.startWrite();
        const db = txn.createMap({ name: "data", valueMode: P.valueMode.multi, ...options });
        for (const [key, value] of seed) db.put(txn, key, value);
        if (readonly) { txn.commit(); txn = env.startRead(); }
        const open = () => { const cursor = txn.openCursor(db); cursors.push(cursor); return cursor; };
        run({ txn, db, cursor: open(), open });
    } finally {
        for (const cursor of cursors) cursor.close();
        if (txn?.isActive()) txn.abort();
        env.closeSync(); fs.rmSync(dir, { recursive: true, force: true });
    }
}
const strings = { keyFlag: P.keyFlag.string, valueFlag: P.valueFlag.string };
for (const readonly of [false, true]) {
    test(`seekBoth exact pair and missing pair in ${readonly ? "read" : "write"} transaction`, () =>
        fixture(strings, [["k", "10"], ["k", "20"], ["k", "30"], ["z", "25"]], ({ cursor }) => {
            assert.deepEqual(cursor.seek("k"), { key: "k", value: "10" });
            assert.deepEqual(cursor.seekBoth("k", "20"), { key: "k", value: "20" });
            assert.deepEqual(cursor.current(), { key: "k", value: "20" });
            assert.deepEqual(cursor.next(), { key: "k", value: "30" });
            assert.equal(cursor.seekBoth("k", "25"), undefined);
            assert.equal(cursor.seekBoth("missing", "20"), undefined);
            assert.deepEqual(cursor.seekBoth("k", "10"), { key: "k", value: "10" });
            assert.deepEqual(cursor.seekGE("y"), { key: "z", value: "25" });
        }, readonly));
}
test("seekBoth preserves bytes and result ownership; accepts offset Uint8Array", () => {
    const key = Buffer.from([255, 0]), value = Buffer.from([0, 254, 128]);
    fixture({}, [[key, Buffer.alloc(0)], [key, value]], ({ txn, cursor }) => {
        const input = new Uint8Array([99, 0, 254, 128, 99]).subarray(1, 4);
        const found = cursor.seekBoth(key, input);
        assert.deepEqual(found, { key, value });
        const raw = cursor.current_raw();
        assert.deepEqual(raw, found);
        assert.equal(cursor.del(), true);
        assert.equal(cursor.seekBoth(key, value), undefined);
        assert.deepEqual(cursor.seekBoth(key, Buffer.alloc(0)), { key, value: Buffer.alloc(0) });
        cursor.close(); txn.commit();
        assert.deepEqual(found, { key, value });
        assert.deepEqual(raw, found);
    });
});
test("seekBoth output follows DBI presentation while current_raw keeps original bytes", () => {
    const key = Buffer.from([255]), value = Buffer.from([254]);
    fixture(strings, [[key, value]], ({ cursor }) => {
        assert.deepEqual(cursor.seekBoth(key, value), { key: key.toString(), value: value.toString() });
        assert.deepEqual(cursor.current_raw(), { key, value });
    });
});
test("seekBoth shares ordinal input conversion with put", () => {
    fixture({ keyMode: P.keyMode.ordinal, valueMode: P.valueMode.multiOrdinal },
        [[1n, 10n], [1n, 256n], [2n, 10n]], ({ cursor }) => {
            const row = cursor.seekBoth(1n, 256n);
            assert.ok(row);
            assert.equal(BigInt(row.key), 1n);
            assert.equal(BigInt(row.value), 256n);
            assert.equal(cursor.seekBoth(1, 20), undefined);
            assert.ok(cursor.seekBoth(1, 10));
        });
});
test("seekBoth on empty DUPSORT and invalid arguments", () => fixture(strings, [], ({ txn, cursor }) => {
    assert.equal(cursor.seekBoth("k", "v"), undefined);
    assert.throws(() => cursor.seekBoth(), /key and value required/);
    assert.throws(() => cursor.seekBoth("k"), /key and value required/);
    assert.throws(() => cursor.seekBoth({}, "v"));
    assert.throws(() => cursor.seekBoth("k", {}), /unsupported value/);
    cursor.close();
    assert.throws(() => cursor.seekBoth("k", "v"), /cursor closed/);
    txn.abort();
    assert.throws(() => cursor.seekBoth("k", "v"), /cursor closed/);
}));
test("seekBoth propagates non-DUPSORT native error without changing data", () =>
    fixture({ ...strings, valueMode: 0 }, [["k", "v"]], ({ db, txn, cursor }) => {
        assert.throws(() => cursor.seekBoth("k", "v"));
        assert.equal(db.get(txn, "k"), "v");
    }));
test("seekBoth positions exact pair for deletion and leaves other cursor independent", () =>
    fixture(strings, [["k", "10"], ["k", "20"], ["k", "30"]], ({ cursor, open }) => {
        const other = open();
        assert.deepEqual(other.seek("k"), { key: "k", value: "10" });
        cursor.seekBoth("k", "20");
        assert.deepEqual(other.current(), { key: "k", value: "10" });
        assert.equal(cursor.del(), true);
        assert.equal(cursor.seekBoth("k", "20"), undefined);
        assert.deepEqual(cursor.seekBoth("k", "10"), { key: "k", value: "10" });
        assert.deepEqual(cursor.next(), { key: "k", value: "30" });
        assert.equal(cursor.next(), undefined);
    }));

for (const valueMode of [P.valueMode.multiReverse, P.valueMode.multiSamelength]) {
    test(`seekBoth respects native DUPSORT mode ${valueMode}`, () =>
        fixture({ ...strings, valueMode }, [["k", "ab"], ["k", "ba"]], ({ cursor }) => {
            assert.deepEqual(cursor.seekBoth("k", "ba"), { key: "k", value: "ba" });
            assert.equal(cursor.seekBoth("k", "aa"), undefined);
            assert.deepEqual(cursor.seekBoth("k", "ab"), { key: "k", value: "ab" });
        }));
}
