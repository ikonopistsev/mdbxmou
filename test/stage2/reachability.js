"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { MDBX_Env } = require("../../lib/nativemou.js");

if (typeof global.gc !== "function") {
    throw new Error("reachability.js requires --expose-gc");
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

function createEnvironmentWithView(prefix) {
    const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const env = new MDBX_Env();
    env.openSync({ path: dbPath });

    const writeTxn = env.startWrite();
    const dbi = writeTxn.createMap();
    dbi.put(writeTxn, "value", Buffer.from([1, 2, 3, 4]));
    writeTxn.commit();

    const txn = env.startRead();
    return {
        dbPath,
        envRef: new WeakRef(env),
        txn,
        view: txn._debugIssueView(dbi, "value"),
    };
}

function createLostTransaction(env, dbi) {
    const txn = env.startRead();
    const view = txn._debugIssueView(dbi, "value");
    return {
        txnRef: new WeakRef(txn),
        viewRef: new WeakRef(view),
    };
}

async function transactionKeepsEnvironmentAlive() {
    let { dbPath, envRef, txn, view } = createEnvironmentWithView(
        "mdbxmou-stage2-owned-",
    );

    for (let index = 0; index < 20; ++index) await gcTurn();
    assert.notEqual(
        envRef.deref(),
        undefined,
        "active transaction lost its environment",
    );
    assert.equal(view.getUint8(0), 1);

    txn.abort();
    assert.equal(view.buffer.byteLength, 0);
    txn = null;
    view = null;

    await waitUntil(
        () => envRef.deref() === undefined,
        "environment remained retained after transaction completion",
    );

    fs.rmSync(dbPath, { recursive: true, force: true });
    dbPath = null;
    envRef = null;
}

async function bothTransactionAndViewCanBeCollected() {
    const dbPath = fs.mkdtempSync(
        path.join(os.tmpdir(), "mdbxmou-stage2-both-lost-"),
    );
    const env = new MDBX_Env();
    env.openSync({ path: dbPath });

    const writeTxn = env.startWrite();
    const dbi = writeTxn.createMap();
    dbi.put(writeTxn, "value", Buffer.from([1, 2, 3, 4]));
    writeTxn.commit();

    let { txnRef, viewRef } = createLostTransaction(env, dbi);
    await waitUntil(
        () => txnRef.deref() === undefined && viewRef.deref() === undefined,
        "lost transaction or DataView remained retained",
    );

    assert.doesNotThrow(() => env.closeSync());
    fs.rmSync(dbPath, { recursive: true, force: true });
    txnRef = null;
    viewRef = null;
}

(async () => {
    await transactionKeepsEnvironmentAlive();
    await bothTransactionAndViewCanBeCollected();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
