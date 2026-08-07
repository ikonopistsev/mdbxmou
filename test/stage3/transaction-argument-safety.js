"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MDBX_Env } = require("../../lib/nativemou.js");

const scenario = process.argv[2];
const dbPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "mdbxmou-stage3-argument-safety-"),
);
const env = new MDBX_Env();
let readTxn;

function assertInvalidTransaction(dbi, value) {
    assert.throws(
        () => dbi.getView(value, "value"),
        (error) =>
            error instanceof TypeError &&
            error.message ===
                "getView: argument must be MDBX_Txn instance",
    );
}

try {
    env.openSync({ path: dbPath });
    const writeTxn = env.startWrite();
    const dbi = writeTxn.createMap();
    dbi.put(writeTxn, "value", Buffer.from([1]));
    writeTxn.commit();
    readTxn = env.startRead();

    if (scenario === "revoked-proxy") {
        const revocable = Proxy.revocable({}, {});
        revocable.revoke();
        assertInvalidTransaction(dbi, revocable.proxy);
    } else if (scenario === "prototype-spoof") {
        const txnPrototype = Object.getPrototypeOf(readTxn);
        assertInvalidTransaction(dbi, Object.create(txnPrototype));

        const envPrototype = Object.getPrototypeOf(env);
        Object.setPrototypeOf(env, txnPrototype);
        try {
            assertInvalidTransaction(dbi, env);
        } finally {
            Object.setPrototypeOf(env, envPrototype);
        }
    } else {
        throw new Error(`unknown scenario: ${scenario}`);
    }

    readTxn.abort();
    readTxn = undefined;
    env.closeSync();
} finally {
    if (readTxn?.isActive()) {
        readTxn.abort();
    }
    try {
        env.closeSync();
    } catch {
        // A failed assertion owns the useful error.
    }
    fs.rmSync(dbPath, { recursive: true, force: true });
}
