"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MDBX_Env, MDBX_Param } = require("../../lib/nativemou.js");

const scenario = process.argv[2];
const dbPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "mdbxmou-stage4-dbi-safety-"),
);
const env = new MDBX_Env();
let readTxn;

function spoofDbiPrototype(dbi, value) {
    Object.setPrototypeOf(value, Object.getPrototypeOf(dbi));
    return value;
}

try {
    env.openSync({ path: dbPath });
    const writeTxn = env.startWrite();
    const dbi = writeTxn.createMap();
    dbi.put(writeTxn, "value", Buffer.from([1]));
    writeTxn.commit();
    readTxn = env.startRead();

    if (scenario === "open-cursor") {
        const fakeDbi = Object.create(Object.getPrototypeOf(dbi));
        assert.throws(
            () => readTxn.openCursor(fakeDbi),
            (error) =>
                error instanceof TypeError &&
                error.message ===
                    "openCursor: argument must be MDBX_Dbi instance",
        );
    } else if (scenario === "query" || scenario === "keys") {
        const txnPrototype = Object.getPrototypeOf(readTxn);
        const fakeDbi = spoofDbiPrototype(dbi, readTxn);
        try {
            let call;
            if (scenario === "query") {
                call = () =>
                    env.query({
                        dbi: fakeDbi,
                        mode: MDBX_Param.queryMode.get,
                        item: [{ key: "value" }],
                    });
            } else {
                call = () => env.keys({ dbi: fakeDbi });
            }
            const expectedMessage =
                `${scenario}: argument must be MDBX_Dbi instance`;
            assert.throws(
                call,
                (error) =>
                    error instanceof Error &&
                    error.message === expectedMessage,
            );
        } finally {
            Object.setPrototypeOf(readTxn, txnPrototype);
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
