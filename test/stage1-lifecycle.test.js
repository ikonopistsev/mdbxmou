"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { MDBX_Env } = require("../lib/nativemou.js");

function createEnvironment() {
    const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-stage1-"));
    const env = new MDBX_Env();
    env.openSync({ path: dbPath });
    return { dbPath, env };
}

function removeEnvironment(dbPath, env) {
    if (env) {
        try {
            env.closeSync();
        } catch {
            // The assertion that failed owns the useful error.
        }
    }
    fs.rmSync(dbPath, { recursive: true, force: true });
}

function runFixture(name, exposeGc = false) {
    const fixture = path.join(__dirname, "stage1", name);
    const args = exposeGc ? ["--expose-gc", fixture] : [fixture];
    const fixtureDbPath = name.startsWith("active-")
        ? fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-stage1-teardown-"))
        : undefined;
    let result;

    try {
        result = childProcess.spawnSync(process.execPath, args, {
            encoding: "utf8",
            env: fixtureDbPath
                ? { ...process.env, MDBXMOU_STAGE1_DB_PATH: fixtureDbPath }
                : process.env,
            timeout: 20_000,
        });
    } finally {
        if (fixtureDbPath) {
            fs.rmSync(fixtureDbPath, { recursive: true, force: true });
        }
    }

    assert.ifError(result.error);
    assert.equal(
        result.status,
        0,
        `fixture ${name} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
}

test("active transaction owns its environment until abort", () => {
    const { dbPath, env } = createEnvironment();
    try {
        const txn = env.startRead();

        assert.equal(txn.isActive(), true);
        assert.throws(() => env.closeSync(), /transaction in progress/);

        txn.abort();

        assert.equal(txn.isActive(), false);
        assert.doesNotThrow(() => env.closeSync());
    } finally {
        removeEnvironment(dbPath, env);
    }
});

test("commit and abort reject double completion", () => {
    const { dbPath, env } = createEnvironment();
    try {
        const committed = env.startRead();
        const dbi = committed.openMap();
        committed.commit();
        assert.equal(committed.isActive(), false);
        assert.throws(() => committed.commit(), /txn already completed/);
        assert.throws(() => committed.abort(), /txn already completed/);
        assert.throws(() => committed.openMap(), /txn already completed/);
        assert.throws(() => committed.createMap(), /txn already completed/);
        assert.throws(() => committed.openCursor(dbi), /txn not active/);

        const aborted = env.startRead();
        aborted.abort();
        assert.equal(aborted.isActive(), false);
        assert.throws(() => aborted.commit(), /txn already completed/);
        assert.throws(() => aborted.abort(), /txn already completed/);
        assert.throws(() => aborted.openMap(), /txn already completed/);
        assert.throws(() => aborted.createMap(), /txn already completed/);
    } finally {
        removeEnvironment(dbPath, env);
    }
});

test("open cursor keeps transaction active when completion is rejected", () => {
    const { dbPath, env } = createEnvironment();
    try {
        const writeTxn = env.startWrite();
        writeTxn.createMap();
        writeTxn.commit();

        const readTxn = env.startRead();
        const dbi = readTxn.openMap();
        const cursor = readTxn.openCursor(dbi);

        assert.throws(() => readTxn.commit(), /cursor\(s\) still open/);
        assert.equal(readTxn.isActive(), true);
        assert.throws(() => env.closeSync(), /transaction in progress/);

        cursor.close();
        readTxn.commit();

        assert.equal(readTxn.isActive(), false);
    } finally {
        removeEnvironment(dbPath, env);
    }
});

test("GC finalizer aborts lost transaction and releases environment", () => {
    runFixture("gc-lifecycle.js", true);
});

test("cursor keeps transaction and DBI alive until close", () => {
    runFixture("cursor-ownership.js", true);
});

test("GC finalizer closes a lost cursor and releases its transaction", () => {
    runFixture("cursor-finalizer.js", true);
});

test("process teardown with active transaction does not crash", () => {
    runFixture("active-transaction-teardown.js");
});

test("process teardown with active cursor does not crash", () => {
    runFixture("active-cursor-teardown.js");
});
