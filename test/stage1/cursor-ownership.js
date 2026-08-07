"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { MDBX_Env } = require("../../lib/nativemou.js");

if (typeof global.gc !== "function") {
    throw new Error("cursor-ownership.js requires --expose-gc");
}

function createOwnedCursor(env) {
    const txn = env.startRead();
    const dbi = txn.openMap();
    return {
        cursor: txn.openCursor(dbi),
        dbiRef: new WeakRef(dbi),
        txnRef: new WeakRef(txn),
    };
}

async function gcTurn() {
    global.gc();
    await nextTurn();
    Buffer.allocUnsafe(256 * 1024);
    global.gc();
    await nextTurn();
}

async function waitUntil(predicate, message) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await gcTurn();
    }
    assert.fail(message);
}

(async () => {
    const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-stage1-cursor-"));
    const env = new MDBX_Env();
    env.openSync({ path: dbPath });

    let { cursor, dbiRef, txnRef } = createOwnedCursor(env);

    for (let i = 0; i < 20; ++i) await gcTurn();
    assert.notEqual(txnRef.deref(), undefined, "cursor lost its transaction");
    assert.notEqual(dbiRef.deref(), undefined, "cursor lost its DBI wrapper");
    assert.equal(cursor.first(), undefined);

    cursor.close();
    await waitUntil(
        () => txnRef.deref() === undefined && dbiRef.deref() === undefined,
        "cursor retained its parents after close",
    );

    assert.doesNotThrow(() => env.closeSync());
    fs.rmSync(dbPath, { recursive: true, force: true });
    cursor = null;
    dbiRef = null;
    txnRef = null;
    console.log("stage1 cursor ownership ok");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
