"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { MDBX_Env, MDBX_Param: P } = require("../lib/nativemou.js");
const key = i => String(i).padStart(5, "0");
function fixture(run, { dup = false, size = 10 } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-delete-"));
    const env = new MDBX_Env(), cursors = [], txns = [];
    try {
        env.openSync({ path: dir, maxDbi: 8 });
        const start = (ro = false) => { const txn = ro ? env.startRead() : env.startWrite(); txns.push(txn); return txn; };
        let txn = start();
        const db = txn.createMap({ name: "data", keyFlag: P.keyFlag.string, valueFlag: P.valueFlag.string,
            valueMode: dup ? P.valueMode.multi : undefined });
        for (let i = 0; i < size; i++) {
            for (const value of dup ? ["a", "b", "c", "d", "e"] : ["v"]) db.put(txn, key(i), value);
        }
        txn.commit(); txn = start();
        const open = (t = txn, d = db) => { const c = t.openCursor(d); cursors.push(c); return c; };
        const rows = (t = txn) => {
            const c = open(t), result = [];
            try { for (let row = c.first(); row; row = c.next()) result.push([row.key, row.value]); }
            finally { c.close(); }
            return result;
        };
        const close = () => { for (const c of cursors) c.close(); };
        run({ env, txn, db, open, rows, start, close });
    } finally {
        for (const c of cursors) c.close();
        for (const t of txns) if (t.isActive()) t.abort();
        env.closeSync(); fs.rmSync(dir, { recursive: true, force: true });
    }
}
for (const [name, a, z, inclusive, removed] of [
    ["inclusive", 2, 5, true, [2, 3, 4, 5]],
    ["exclusive", 2, 5, false, [2, 3, 4]],
    ["same-inclusive", 2, 2, true, [2]],
    ["empty-exclusive", 2, 2, false, []],
    ["implicit-last", 7, null, true, [7, 8, 9]],
    ["implicit-last-exclusive", 7, null, false, [7, 8]],
]) test(`range ${name}, exact effects and abort`, () => fixture(({ txn, open, rows, close, start }) => {
    const before = rows(), begin = open(), end = z === null ? null : open();
    begin.seek(key(a)); end?.seek(key(z));
    assert.equal(begin.deleteRange(end, inclusive), BigInt(removed.length));
    assert.deepEqual(rows(), before.filter(([k]) => !removed.includes(Number(k))));
    close(); txn.abort(); const read = start(true); assert.deepEqual(rows(read), before);
}));
test("default end/inclusion and committed persistence", () => fixture(({ txn, open, rows, close, start }) => {
    const c = open(); c.seek(key(7)); assert.equal(c.deleteRange(), 3n);
    close(); txn.commit(); const read = start(true); assert.equal(rows(read).length, 7);
}));
for (const [action, removed] of [
    ["currentValue", [5]], ["beforeExcluding", [0, 1, 2, 3, 4]],
    ["beforeIncluding", [0, 1, 2, 3, 4, 5]], ["afterIncluding", [5, 6, 7, 8, 9]],
    ["afterExcluding", [6, 7, 8, 9]], ["whole", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
]) test(`bunch ${action}`, () => fixture(({ open, rows }) => {
    const before = rows(), c = open(); c.seek(key(5));
    assert.equal(c.deleteBunch(P.bunchAction[action]), BigInt(removed.length));
    assert.deepEqual(rows(), before.filter(([k]) => !removed.includes(Number(k))));
}));
for (const [action, removed] of [
    ["currentValue", ["c"]], ["currentMultivalBeforeExcluding", ["a", "b"]],
    ["currentMultivalBeforeIncluding", ["a", "b", "c"]],
    ["currentMultivalAfterIncluding", ["c", "d", "e"]],
    ["currentMultivalAfterExcluding", ["d", "e"]], ["currentMultivalAll", ["a", "b", "c", "d", "e"]],
]) test(`raw DUPSORT ${action}`, () => fixture(({ open, rows }) => {
    const before = rows(), c = open(); c.seek(key(1)); c.next(); c.next();
    assert.equal(c.deleteBunch(P.bunchAction[action]), BigInt(removed.length));
    assert.deepEqual(rows(), before.filter(([k, v]) => k !== key(1) || !removed.includes(v)));
}, { dup: true, size: 3 }));
test("raw DUPSORT range uses full cursor positions", () => fixture(({ open, rows }) => {
    const before = rows(), a = open(), z = open(); a.seek(key(1)); a.next(); z.seek(key(2)); z.next();
    assert.equal(a.deleteRange(z), 6n); assert.deepEqual(rows(), [...before.slice(0, 6), ...before.slice(12)]);
}, { dup: true, size: 4 }));
test("invalid arguments and native state errors leave data unchanged", () => fixture(({ txn, db, open, rows, start, close }) => {
    const before = rows(), a = open(), z = open();
    assert.throws(() => a.deleteRange(z)); assert.throws(() => a.deleteBunch(P.bunchAction.currentValue));
    a.seek(key(7)); z.seek(key(2)); assert.throws(() => a.deleteRange(z));
    z.seek(key(8));
    for (const bad of [{}, db, txn, 1, true, Object.create(Object.getPrototypeOf(a))]) assert.throws(() => a.deleteRange(bad), TypeError);
    for (const bad of [null, 1, "yes", {}]) assert.throws(() => a.deleteRange(z, bad), TypeError);
    for (const bad of [undefined, null, "0", 0n, {}]) assert.throws(() => a.deleteBunch(bad), TypeError);
    for (const bad of [-1, 11, 0.5, NaN, Infinity, 2 ** 32]) assert.throws(() => a.deleteBunch(bad), RangeError);
    const other = txn.createMap("other"); other.put(txn, "x", "v"); const foreign = open(txn, other); foreign.first();
    assert.throws(() => a.deleteRange(foreign));
    fixture(({ open: openForeign }) => {
        const foreignTxn = openForeign(); foreignTxn.first(); assert.throws(() => a.deleteRange(foreignTxn));
    });
    z.close(); assert.throws(() => a.deleteRange(z), /closed/);
    a.close(); assert.throws(() => a.deleteRange(), /closed/); assert.throws(() => a.deleteBunch(0), /closed/);
    assert.deepEqual(rows(), before);
    close(); txn.abort();
    const read = start(true), readonly = open(read); readonly.first();
    assert.throws(() => readonly.deleteRange());
    assert.throws(() => readonly.deleteBunch(P.bunchAction.whole));
    assert.deepEqual(rows(read), before);
}));
test("multi-page range preserves exact prefix/suffix and abort", () => fixture(({ txn, open, rows, close, start }) => {
    const before = rows(), a = open(), z = open(); a.seek(key(123)); z.seek(key(8500));
    assert.equal(a.deleteRange(z), 8378n);
    assert.deepEqual(rows(), [...before.slice(0, 123), ...before.slice(8501)]);
    close(); txn.abort(); assert.deepEqual(rows(start(true)), before);
}, { size: 10000 }));
test("ESM exposes the same generic constants", async () => {
    const esm = await import("../lib/index.mjs"); assert.equal(esm.MDBX_Param.bunchAction, P.bunchAction);
    assert.deepEqual(Object.values(P.bunchAction), Array.from({ length: 11 }, (_, i) => i));
});
