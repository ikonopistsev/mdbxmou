"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { MDBX_Env } = require("../../lib/nativemou.js");

if (typeof global.gc !== "function") {
    throw new Error("finalizer-safety-fault.js requires --expose-gc");
}

const fault = process.argv[2];
if (!fault) throw new Error("detach fault name is required");

let retainedView;

function issueLostTransaction(env, dbi) {
    const txn = env.startRead();
    retainedView = txn._debugIssueView(dbi, "value");
    txn._debugFailNextDetach(fault);
}

(async () => {
    const dbPath = fs.mkdtempSync(
        path.join(os.tmpdir(), "mdbxmou-stage2-finalizer-safety-"),
    );
    const env = new MDBX_Env();
    env.openSync({ path: dbPath });

    const write = env.startWrite();
    const dbi = write.createMap();
    dbi.put(write, "value", Buffer.from([1, 2, 3, 4]));
    write.commit();

    issueLostTransaction(env, dbi);
    for (let attempt = 0; attempt < 200; ++attempt) {
        global.gc();
        await nextTurn();
        Buffer.allocUnsafe(256 * 1024);
    }

    throw new Error(`finalizer did not reject unsafe ${fault} failure`);
})().catch((error) => {
    retainedView = null;
    console.error(error);
    process.exitCode = 1;
});
