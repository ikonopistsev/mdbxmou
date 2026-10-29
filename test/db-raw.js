"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { MDBX_Env, MDBX_Param: P } = require("../lib/nativemou.js");
function fixture(options, seed, run, readonly = false, envOptions = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-db-raw-"));
    const env = new MDBX_Env(); let txn;
    try {
        env.openSync({ path: dir, maxDbi: 8, ...envOptions }); txn = env.startWrite();
        const db = txn.createMap({ name: "data", ...options });
        for (const [key, value] of seed) db.put(txn, key, value);
        if (readonly) { txn.commit(); txn = env.startRead(); }
        return run({ env, txn, db });
    } finally {
        if (txn?.isActive()) txn.abort();
        env.closeSync(); fs.rmSync(dir, { recursive: true, force: true });
    }
}
const strings = { keyFlag: P.keyFlag.string, valueFlag: P.valueFlag.string };
for (const readonly of [false, true]) {
    test(`get_raw bypasses string output in ${readonly ? "RO" : "RW"} transaction`, () => {
        const bytes = Buffer.from([255, 0, 128]);
        const result = fixture(strings, [["key", bytes]], ({ txn, db }) => {
            assert.equal(db.get(txn, "key"), bytes.toString());
            const raw = db.get_raw(txn, "key");
            assert.deepEqual(raw, bytes);
            raw[0] = 1;
            assert.deepEqual(db.get_raw(txn, "key"), bytes);
            return db.get_raw(txn, "key");
        }, readonly);
        assert.deepEqual(result, bytes); // still owned after abort and environment close
    });
}
test("get_raw distinguishes missing keys from empty binary values", () =>
    fixture(strings, [["empty", Buffer.alloc(0)]], ({ txn, db }) => {
        assert.equal(db.get_raw(txn, "missing"), undefined);
        assert.equal(db.get(txn, "missing"), undefined);
        assert.deepEqual(db.get_raw(txn, "empty"), Buffer.alloc(0));
        assert.equal(db.get(txn, "empty"), "");
    }));
test("get_raw copies survive overwrite/delete/commit and no borrowed-view option is needed", () => {
    const original = Buffer.from([254, 128, 0]);
    const copy = fixture(strings, [["key", original]], ({ txn, db }) => {
        const raw = db.get_raw(txn, "key");
        assert.throws(() => db.getView(txn, "key"), /read-only/);
        db.put(txn, "key", "replacement");
        assert.equal(db.get(txn, "key"), "replacement");
        db.del(txn, "key"); txn.commit();
        return raw;
    });
    assert.deepEqual(copy, original);
});
test("get_raw uses get key conversion for ordinal keys beyond Number precision", () => {
    const key = (1n << 64n) - 1n;
    fixture({ keyMode: P.keyMode.ordinal, valueFlag: P.valueFlag.string }, [[key, "value"]], ({ txn, db }) => {
        assert.deepEqual(db.get_raw(txn, key), Buffer.from("value"));
        assert.equal(db.get(txn, key), "value");
        assert.equal(db.get_raw(txn, key - 1n), undefined);
    });
});
test("get_raw returns the first DUPSORT value like get", () =>
    fixture({ ...strings, valueMode: P.valueMode.multi }, [["k", "30"], ["k", "10"], ["k", "20"]], ({ txn, db }) => {
        assert.equal(db.get(txn, "k"), "10");
        assert.deepEqual(db.get_raw(txn, "k"), Buffer.from("10"));
    }));
test("get_raw preserves numeric DUPSORT bytes instead of applying numeric output conversion", () =>
    fixture({ valueMode: P.valueMode.multiOrdinal }, [["k", 10n]], ({ txn, db }) => {
        const cursor = txn.openCursor(db);
        try {
            cursor.seek("k");
            assert.deepEqual(db.get_raw(txn, "k"), cursor.current_raw().value);
            assert.equal(BigInt(db.get(txn, "k")), 10n);
        } finally { cursor.close(); }
    }));
test("get_raw default binary output agrees with get and returns independent copies", () =>
    fixture({}, [[Buffer.from([255]), Buffer.from([254])]], ({ txn, db }) => {
        const key = Buffer.from([255]);
        assert.deepEqual(db.get_raw(txn, key), db.get(txn, key));
        const a = db.get_raw(txn, key), b = db.get_raw(txn, key);
        a.fill(0); assert.deepEqual(b, Buffer.from([254]));
    }));
test("get_raw rejects missing/invalid transaction, invalid key and completed transaction", () =>
    fixture({}, [["k", "v"]], ({ txn, db }) => {
        assert.throws(() => db.get_raw(), /get_raw: txnmou and key required/);
        assert.throws(() => db.get_raw(txn), /get_raw: txnmou and key required/);
        assert.throws(() => db.get_raw({}, "k"), /get_raw/);
        assert.throws(() => db.get_raw(null, "k"), /get_raw/);
        assert.throws(() => db.get_raw(txn, {}), /get_raw/);
        txn.abort();
        assert.throws(() => db.get_raw(txn, "k"), /get_raw/);
        assert.throws(() => db.get(txn, "k"), /get:/);
    }));

test("get_raw remains an owned copy in WRITEMAP where getView is unavailable", () => {
    const raw = fixture(strings, [["k", "value"]], ({ txn, db }) => {
        assert.throws(() => db.getView(txn, "k"), /MDBX_WRITEMAP/);
        return db.get_raw(txn, "k");
    }, true, { flags: P.envFlag.writemap });
    assert.deepEqual(raw, Buffer.from("value"));
});
