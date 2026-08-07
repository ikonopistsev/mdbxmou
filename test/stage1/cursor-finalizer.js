"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { MDBX_Env } = require("../../lib/nativemou.js");

if (typeof global.gc !== "function") {
    throw new Error("cursor-finalizer.js requires --expose-gc");
}

function createCursorWeakRef(txn, dbi) {
    return new WeakRef(txn.openCursor(dbi));
}

async function waitUntilCollected(ref) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        if (ref.deref() === undefined) return;
        global.gc();
        await nextTurn();
        Buffer.allocUnsafe(256 * 1024);
        global.gc();
        await nextTurn();
    }
    assert.fail("lost cursor was not collected");
}

(async () => {
    const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-stage1-cursor-gc-"));
    const env = new MDBX_Env();
    env.openSync({ path: dbPath });

    const txn = env.startRead();
    const dbi = txn.openMap();
    let cursorRef = createCursorWeakRef(txn, dbi);

    await waitUntilCollected(cursorRef);
    assert.doesNotThrow(() => txn.abort());
    assert.doesNotThrow(() => env.closeSync());

    cursorRef = null;
    fs.rmSync(dbPath, { recursive: true, force: true });
    console.log("stage1 cursor finalizer ok");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
