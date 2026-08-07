"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { MDBX_Env } = require("../../lib/nativemou.js");

if (typeof global.gc !== "function") {
    throw new Error("pruning.js requires --expose-gc");
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

function issueViews(txn, dbi) {
    const views = Array.from({ length: 1024 }, () =>
        txn._debugIssueView(dbi, "value"),
    );
    return {
        deadRef: new WeakRef(views[0]),
        retained: views.slice(-16),
    };
}

(async () => {
    const dbPath = fs.mkdtempSync(
        path.join(os.tmpdir(), "mdbxmou-stage2-prune-"),
    );
    const env = new MDBX_Env();
    env.openSync({ path: dbPath });

    const writeTxn = env.startWrite();
    const dbi = writeTxn.createMap();
    dbi.put(writeTxn, "value", Buffer.from([1, 2, 3, 4]));
    writeTxn.commit();

    const txn = env.startRead();
    let { deadRef, retained } = issueViews(txn, dbi);
    assert.equal(txn._debugViewStats().issued, 1024);

    await waitUntil(
        () => deadRef.deref() === undefined,
        "discarded DataViews remained reachable",
    );

    const trigger = txn._debugIssueView(dbi, "value");
    const stats = txn._debugViewStats();
    assert.equal(stats.pruneRuns >= 1, true);
    assert.equal(stats.prunedRefs >= 1008, true);
    assert.equal(stats.issued <= 17, true);

    txn.abort();
    for (const view of retained) assert.equal(view.buffer.byteLength, 0);
    assert.equal(trigger.buffer.byteLength, 0);
    assert.equal(txn._debugViewStats().issued, 0);

    env.closeSync();
    fs.rmSync(dbPath, { recursive: true, force: true });
    deadRef = null;
    retained = null;
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
