"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { MDBX_Env } = require("../../lib/nativemou.js");

if (typeof global.gc !== "function") {
    throw new Error("gc-lifecycle.js requires --expose-gc");
}

function createEnvironment(prefix) {
    const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const env = new MDBX_Env();
    env.openSync({ path: dbPath });
    return { dbPath, env };
}

function createTransactionWeakRef(env) {
    const txn = env.startRead();
    return new WeakRef(txn);
}

function createOwnedTransaction() {
    const { dbPath, env } = createEnvironment("mdbxmou-stage1-owned-");
    return {
        dbPath,
        envRef: new WeakRef(env),
        txn: env.startRead(),
    };
}

function isCollected(ref) {
    return ref.deref() === undefined;
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

async function testTransactionKeepsEnvironmentAlive() {
    let { dbPath, envRef, txn } = createOwnedTransaction();

    for (let i = 0; i < 20; ++i) await gcTurn();
    assert.equal(isCollected(envRef), false, "active transaction lost its environment");

    txn.abort();
    txn = null;
    await waitUntil(
        () => isCollected(envRef),
        "environment remained retained after transaction completion",
    );

    fs.rmSync(dbPath, { recursive: true, force: true });
    dbPath = null;
    envRef = null;
}

async function testLostTransactionIsFinalized() {
    const { dbPath, env } = createEnvironment("mdbxmou-stage1-finalize-");
    let txnRef = createTransactionWeakRef(env);

    await waitUntil(
        () => isCollected(txnRef),
        "lost transaction was not collected",
    );

    assert.doesNotThrow(() => env.closeSync());
    fs.rmSync(dbPath, { recursive: true, force: true });
    txnRef = null;
}

(async () => {
    await testTransactionKeepsEnvironmentAlive();
    await testLostTransactionIsFinalized();
    console.log("stage1 gc lifecycle ok");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
