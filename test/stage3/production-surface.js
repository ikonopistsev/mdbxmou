"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MDBX_Env } = require("../../lib/nativemou.js");

const dbPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "mdbxmou-stage3-surface-"),
);
const env = new MDBX_Env();

try {
    env.openSync({ path: dbPath });
    const writeTxn = env.startWrite();
    const dbi = writeTxn.createMap();
    dbi.put(writeTxn, "value", Buffer.from([0x11, 0x22]));
    writeTxn.commit();

    const readTxn = env.startRead();
    const view = dbi.getView(readTxn, "value");

    assert.equal(view instanceof DataView, true);
    assert.deepEqual(
        Array.from(
            new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
        ),
        [0x11, 0x22],
    );
    assert.equal(readTxn._debugIssueView, undefined);
    assert.equal(readTxn._debugViewStats, undefined);

    readTxn.abort();
    assert.equal(view.buffer.byteLength, 0);
    env.closeSync();
} finally {
    fs.rmSync(dbPath, { recursive: true, force: true });
}
