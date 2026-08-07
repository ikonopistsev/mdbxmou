"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { MDBX_Env } = require("../../lib/nativemou.js");

if (typeof global.gc !== "function") {
    throw new Error("gc-finalizer.js requires --expose-gc");
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

function issueLostTransaction(env, dbi) {
    const txn = env.startRead();
    return {
        txnRef: new WeakRef(txn),
        view: txn._debugIssueView(dbi, "value"),
    };
}

(async () => {
    const dbPath = fs.mkdtempSync(
        path.join(os.tmpdir(), "mdbxmou-stage2-finalizer-"),
    );
    const env = new MDBX_Env();
    env.openSync({ path: dbPath });

    const writeTxn = env.startWrite();
    const dbi = writeTxn.createMap();
    dbi.put(writeTxn, "value", Buffer.from([1, 2, 3, 4]));
    writeTxn.commit();

    let { txnRef, view } = issueLostTransaction(env, dbi);
    assert.equal(view.buffer.byteLength, 4);

    await waitUntil(
        () => txnRef.deref() === undefined,
        "transaction with a retained view was not finalized",
    );

    assert.equal(view.buffer.byteLength, 0);
    assert.throws(() => view.getUint8(0), TypeError);
    assert.doesNotThrow(() => env.closeSync());

    fs.rmSync(dbPath, { recursive: true, force: true });
    txnRef = null;
    view = null;
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
