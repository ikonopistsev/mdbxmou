"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { MDBX_Env, MDBX_Param: P } = require("../lib/nativemou.js");
function fixture(run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-raw-current-")), env = new MDBX_Env();
    let txn; const cursors = [];
    try {
        env.openSync({ path: dir, maxDbi: 8 }); txn = env.startWrite();
        run(txn, db => { const cursor = txn.openCursor(db); cursors.push(cursor); return cursor; });
    } finally {
        for (const cursor of cursors) cursor.close();
        if (txn?.isActive()) txn.abort();
        env.closeSync(); fs.rmSync(dir, { recursive: true, force: true });
    }
}
test("raw current preserves non-UTF8 bytes, position and owning copies", () => fixture((txn, open) => {
    const db = txn.createMap({ name: "data", keyFlag: P.keyFlag.string, valueFlag: P.valueFlag.string });
    const key = Buffer.from([255]), value = Buffer.from([0, 254, 128]);
    db.put(txn, key, value); const cursor = open(db);
    const typed = cursor.first(), raw = cursor.current_raw();
    assert.deepEqual(raw, { key, value }); assert.equal(typeof typed.key, "string");
    assert.deepEqual(cursor.current(), typed);
    cursor.put(key, "next", P.putFlag.current); cursor.del(); cursor.close(); txn.commit();
    assert.deepEqual(raw, { key, value });
}));
test("raw current exposes exact ordinal bytes beyond Number precision", () => fixture((txn, open) => {
    const db = txn.createMap({ name: "numbers", keyMode: P.keyMode.ordinal });
    const key = (1n << 64n) - 1n; db.put(txn, key, Buffer.alloc(0)); const cursor = open(db);
    assert.equal(typeof cursor.first().key, "number");
    assert.deepEqual(cursor.current_raw(), { key: Buffer.alloc(8, 255), value: Buffer.alloc(0) });
    const rawDb = txn.openMap({ name: "numbers", flags: P.dbMode.accede, keyFlag: 0 });
    const oracle = open(rawDb); assert.deepEqual(cursor.current_raw(), oracle.first());
}));
test("raw current retains a 4-byte integer key without widening", () => fixture((txn, open) => {
    const db = txn.createMap({ name: "four", flags: 0x40008, keyFlag: 0 });
    const key = Buffer.alloc(4); key[os.endianness() === "LE" ? "writeUInt32LE" : "writeUInt32BE"](17);
    db.put(txn, key, "value"); const cursor = open(db); cursor.first();
    assert.deepEqual(cursor.current_raw().key, key);
}));
test("separate current methods preserve default output and native state errors", () => fixture((txn, open) => {
    const db = txn.createMap({ name: "data", keyFlag: P.keyFlag.string, valueFlag: P.valueFlag.string });
    const cursor = open(db);
    assert.throws(() => cursor.current_raw(), /No data available/);
    assert.equal(cursor.first(), undefined);
    db.put(txn, "a", "A"); const expected = cursor.first();
    for (const option of [{ raw: true }, { get raw() { assert.fail("current must not read raw option"); } }, { raw: 1 }, { raw: "true" }, { raw: false }, {}, false, null, undefined]) {
        assert.deepEqual(cursor.current(option), expected);
    }
    assert.equal(cursor.next(), undefined);
    assert.equal(cursor.eof(), true);
    assert.deepEqual(cursor.current(), expected);
    assert.deepEqual(cursor.current_raw(), { key: Buffer.from("a"), value: Buffer.from("A") });
    assert.equal(cursor.eof(), true);
    assert.equal(cursor.seek("missing"), undefined);
    assert.throws(() => cursor.current_raw(), /No data available/);
    cursor.close(); assert.throws(() => cursor.current_raw(), /cursor closed/);
}));
