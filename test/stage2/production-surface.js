"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MDBX_Env } = require("../../lib/nativemou.js");

const dbPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "mdbxmou-stage2-surface-"),
);
const env = new MDBX_Env();

try {
    env.openSync({ path: dbPath });
    const txn = env.startRead();

    assert.equal(txn._debugIssueView, undefined);
    assert.equal(txn._debugViewStats, undefined);
    assert.equal(txn._debugPruneViews, undefined);
    assert.equal(txn._debugFailNextDetach, undefined);

    txn.abort();
    env.closeSync();
} finally {
    fs.rmSync(dbPath, { recursive: true, force: true });
}
