"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");

const childTimeoutMs = 30_000;
const readerLimit = 4_096;
const contentionIterations = 200;
const lifecycleIterations = 1_000;

function createTemporaryDatabase(label) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `mdbxmou-${label}-`));
    return { root, dbPath: path.join(root, "db") };
}

function removeTemporaryDatabase(root) {
    fs.rmSync(root, { recursive: true, force: true });
}

function openEnvironment(dbPath, options = {}) {
    const env = new MDBX_Env();
    env.openSync({ path: dbPath, maxDbi: 8, ...options });
    return env;
}

function valueAsString(dbi, txn, key) {
    const value = dbi.get(txn, key);
    return value === undefined ? undefined : value.toString();
}

function initializeValues(env, value = "seed") {
    const txn = env.startWrite();
    const dbi = txn.createMap("values");
    dbi.put(txn, "current", value);
    txn.commit();
    return dbi;
}

function withTimeout(promise, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`${label} timed out after ${childTimeoutMs} ms`)),
            childTimeoutMs,
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function watchChildExit(child) {
    const exit = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    exit.catch(() => {});
    return exit;
}

function waitForChildMessage(child, type) {
    return withTimeout(
        new Promise((resolve, reject) => {
            const cleanup = () => {
                child.off("message", onMessage);
                child.off("error", onError);
                child.off("exit", onExit);
            };
            const onMessage = (message) => {
                if (message.type === type) {
                    cleanup();
                    resolve(message);
                }
            };
            const onError = (error) => {
                cleanup();
                reject(error);
            };
            const onExit = (code, signal) => {
                cleanup();
                reject(
                    new Error(
                        `child exited before ${type}: code=${code} signal=${signal}`,
                    ),
                );
            };

            child.on("message", onMessage);
            child.once("error", onError);
            child.once("exit", onExit);
        }),
        `child message ${type}`,
    );
}

function runWriteOnceChild(dbPath, value) {
    const env = openEnvironment(dbPath);
    try {
        const txn = env.startWrite();
        const dbi = txn.openMap("values");
        dbi.put(txn, "current", value);
        txn.commit();
    } finally {
        env.closeSync();
    }
}

function runContinuousWriterChild(dbPath) {
    const env = openEnvironment(dbPath, {
        flags: MDBX_Param.envFlag.safeNosync,
    });
    const dbiTxn = env.startRead();
    const dbi = dbiTxn.openMap("values");
    dbiTxn.abort();
    let writes = 0;
    let stopping = false;

    process.on("message", (message) => {
        if (message.type === "stop") {
            stopping = true;
        }
    });

    const finish = () => {
        env.closeSync();
        process.send({ type: "stopped", writes }, () => process.disconnect());
    };

    const step = () => {
        if (stopping) {
            finish();
            return;
        }

        try {
            const txn = env.startWrite();
            dbi.put(txn, "current", `child-${writes}`);
            txn.commit();
            writes += 1;
            if (writes === 1) {
                process.send({ type: "ready" });
            }
            setImmediate(step);
        } catch (error) {
            console.error(error);
            process.exitCode = 1;
            env.closeSync();
            process.disconnect();
        }
    };

    step();
}

function runSynchronousChild(mode, ...args) {
    const result = spawnSync(process.execPath, [__filename, mode, ...args], {
        encoding: "utf8",
    });
    if (result.error) {
        throw result.error;
    }
    assert.equal(
        result.status,
        0,
        `child ${mode} failed:\n${result.stdout}${result.stderr}`,
    );
}

async function runCase(name, callback) {
    const startedAt = Date.now();
    await callback();
    console.log(`ok - ${name} (${Date.now() - startedAt} ms)`);
}

function testTransitionsAndGuards() {
    const { root, dbPath } = createTemporaryDatabase("commit-read-api");
    const env = openEnvironment(dbPath);

    try {
        const dbi = initializeValues(env);
        const txn = env.startWrite();
        dbi.put(txn, "current", "own-commit");

        const writeCursor = txn.openCursor(dbi);
        assert.throws(
            () => txn.commitAndStartRead(),
            /txn commitAndStartRead: 1 cursor\(s\) still open/,
        );
        assert.equal(txn.isActive(), true);
        writeCursor.close();

        txn.commitAndStartRead();
        assert.equal(txn.isActive(), true);
        assert.equal(valueAsString(dbi, txn, "current"), "own-commit");
        assert.equal(txn.openMap("values").getRange(txn).length, 1);

        const readCursor = txn.openCursor(dbi);
        assert.ok(readCursor.first());
        readCursor.close();

        assert.throws(
            () => txn.commitAndStartRead(),
            (error) => error instanceof TypeError && error.message === "write transaction required",
        );
        assert.throws(() => txn.createMap("other"), /read-only transaction/);
        assert.throws(() => dbi.put(txn, "blocked", "value"));

        const view = dbi.getView(txn, "current");
        assert.ok(view instanceof DataView);
        assert.equal(Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString(), "own-commit");
        assert.throws(() => env.closeSync(), /transaction in progress/);
        txn.abort();
        assert.equal(view.buffer.byteLength, 0);
        assert.throws(() => txn.commitAndStartRead(), /txn already completed/);

        const pureTxn = env.startWrite();
        pureTxn.commitAndStartRead();
        assert.equal(valueAsString(dbi, pureTxn, "current"), "own-commit");
        const pureView = dbi.getView(pureTxn, "current");
        pureTxn.commit();
        assert.equal(pureView.buffer.byteLength, 0);

        const readTxn = env.startRead();
        assert.throws(
            () => readTxn.commitAndStartRead(),
            (error) => error instanceof TypeError && error.message === "write transaction required",
        );
        assert.equal(readTxn.isActive(), true);
        readTxn.abort();
    } finally {
        env.closeSync();
        removeTemporaryDatabase(root);
    }
}

function testSplitSequenceNegativeControl() {
    const { root, dbPath } = createTemporaryDatabase("commit-read-split");
    const env = openEnvironment(dbPath);

    try {
        const dbi = initializeValues(env);
        const txn = env.startWrite();
        dbi.put(txn, "current", "parent");
        txn.commit();

        runSynchronousChild("--write-once", dbPath, "child");

        const readTxn = env.startRead();
        assert.equal(valueAsString(dbi, readTxn, "current"), "child");
        readTxn.abort();
    } finally {
        env.closeSync();
        removeTemporaryDatabase(root);
    }
}

async function testContendedExactSnapshot() {
    const { root, dbPath } = createTemporaryDatabase("commit-read-contention");
    const env = openEnvironment(dbPath, {
        flags: MDBX_Param.envFlag.safeNosync,
    });
    initializeValues(env);

    const child = spawn(process.execPath, [__filename, "--writer", dbPath], {
        stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const exit = watchChildExit(child);
    let stopped = false;

    try {
        await waitForChildMessage(child, "ready");
        for (let i = 0; i < contentionIterations; i += 1) {
            const txn = env.startWrite();
            const dbi = txn.openMap("values");
            const expected = `parent-${i}`;
            dbi.put(txn, "current", expected);
            txn.commitAndStartRead();
            assert.equal(valueAsString(dbi, txn, "current"), expected);
            txn.abort();
        }

        const stoppedMessage = waitForChildMessage(child, "stopped");
        child.send({ type: "stop" });
        const result = await stoppedMessage;
        stopped = true;
        assert.ok(result.writes > 0);
        const status = await withTimeout(exit, "writer exit");
        assert.deepEqual(status, { code: 0, signal: null });
    } finally {
        if (!stopped && child.exitCode === null) {
            child.kill();
            await exit.catch(() => {});
        }
        env.closeSync();
        removeTemporaryDatabase(root);
    }
}

function testReaderTableExhaustion() {
    const { root, dbPath } = createTemporaryDatabase("commit-read-readers-full");
    const env = openEnvironment(dbPath, {
        maxReaders: 1,
        flags: MDBX_Param.envFlag.nostickythreads,
    });
    const heldReaders = [];
    let writeTxn;
    let freshRead;

    try {
        const dbi = initializeValues(env);
        let exhaustionError;
        for (let i = 0; i < readerLimit; i += 1) {
            try {
                heldReaders.push(env.startRead());
            } catch (error) {
                exhaustionError = error;
                break;
            }
        }

        assert.ok(exhaustionError, `reader table did not fill after ${readerLimit} attempts`);
        assert.match(exhaustionError.message, /MDBX_READERS_FULL/);
        assert.ok(heldReaders.length > 1);

        writeTxn = env.startWrite();
        dbi.put(writeTxn, "current", "committed-before-reader-failure");
        assert.throws(
            () => writeTxn.commitAndStartRead(),
            /txn commitAndStartRead: .*MDBX_READERS_FULL/,
        );
        assert.equal(writeTxn.isActive(), false);

        heldReaders.pop().abort();
        freshRead = env.startRead();
        assert.equal(
            valueAsString(dbi, freshRead, "current"),
            "committed-before-reader-failure",
        );
        freshRead.abort();
        freshRead = undefined;
    } finally {
        if (freshRead?.isActive()) {
            freshRead.abort();
        }
        if (writeTxn?.isActive()) {
            writeTxn.abort();
        }
        for (const txn of heldReaders) {
            if (txn.isActive()) {
                txn.abort();
            }
        }
        env.closeSync();
        removeTemporaryDatabase(root);
    }
}

function testRetainedHandleError() {
    const { root, dbPath } = createTemporaryDatabase("commit-read-map-full");
    const env = openEnvironment(dbPath, {
        geometry: { fixedSize: 1 * 1024 * 1024 },
    });
    let txn;

    try {
        initializeValues(env);
        txn = env.startWrite();
        const dbi = txn.openMap("values");
        const payload = Buffer.alloc(128 * 1024, 0x5a);
        let mapFullError;

        for (let i = 0; i < 1_024; i += 1) {
            try {
                dbi.put(txn, `large-${i}`, payload);
            } catch (error) {
                mapFullError = error;
                break;
            }
        }

        assert.ok(mapFullError, "fixed geometry did not reach MDBX_MAP_FULL");
        assert.match(mapFullError.message, /MDBX_MAP_FULL/);
        assert.equal(txn.isActive(), true);
        assert.throws(
            () => txn.commitAndStartRead(),
            /txn commitAndStartRead: .*MDBX_BAD_TXN/,
        );
        assert.equal(txn.isActive(), true);
        assert.throws(() => dbi.getView(txn, "current"), /read-only transaction required/);
        txn.abort();
        txn = undefined;
    } finally {
        if (txn?.isActive()) {
            txn.abort();
        }
        env.closeSync();
        removeTemporaryDatabase(root);
    }
}

function testLifecycleLoop() {
    const { root, dbPath } = createTemporaryDatabase("commit-read-lifecycle");
    const env = openEnvironment(dbPath, {
        flags: MDBX_Param.envFlag.safeNosync,
    });

    try {
        const dbi = initializeValues(env);
        for (let i = 0; i < lifecycleIterations; i += 1) {
            const txn = env.startWrite();
            const expected = `value-${i}`;
            dbi.put(txn, "current", expected);
            txn.commitAndStartRead();
            assert.equal(valueAsString(dbi, txn, "current"), expected);
            txn.abort();
        }
    } finally {
        env.closeSync();
        removeTemporaryDatabase(root);
    }
}

async function main() {
    await runCase("transitions, guards, views and completion", testTransitionsAndGuards);
    await runCase("split commit/startRead negative control", testSplitSequenceNegativeControl);
    await runCase("contended exact snapshot", testContendedExactSnapshot);
    await runCase("post-commit reader allocation failure", testReaderTableExhaustion);
    await runCase("pre-commit retained handle error", testRetainedHandleError);
    await runCase("1000 transition lifecycle iterations", testLifecycleLoop);
    console.log("commitAndStartRead suite ok");
}

if (process.argv[2] === "--write-once") {
    runWriteOnceChild(process.argv[3], process.argv[4]);
} else if (process.argv[2] === "--writer") {
    runContinuousWriterChild(process.argv[3]);
} else {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
