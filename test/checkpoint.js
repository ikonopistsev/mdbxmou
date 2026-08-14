"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork, spawnSync } = require("node:child_process");
const {
    Worker,
    isMainThread,
    parentPort,
    threadId,
    workerData,
} = require("node:worker_threads");

const readerCount = 4;
const checkpointRounds = 4;
const lifecycleIterations = 1_000;
const childTimeoutMs = 30_000;
const projectRoot = path.resolve(__dirname, "..");
let MDBX_Env;
let MDBX_Param;

function loadAddon() {
    if (!MDBX_Env) {
        ({ MDBX_Env, MDBX_Param } = require("../lib/nativemou.js"));
    }
}

function createTemporaryDatabase(label) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `mdbxmou-${label}-`));
    return { root, dbPath: path.join(root, "db") };
}

function openEnvironment(dbPath, flags = 0) {
    loadAddon();
    const env = new MDBX_Env();
    env.openSync({
        path: dbPath,
        maxDbi: 8,
        keyFlag: MDBX_Param.keyFlag.number,
        valueFlag: MDBX_Param.valueFlag.string,
        flags,
    });
    return env;
}

function waitForMessage(endpoint, predicate, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`${label} timed out after ${childTimeoutMs} ms`));
        }, childTimeoutMs);
        const cleanup = () => {
            clearTimeout(timer);
            endpoint.off("message", onMessage);
            endpoint.off("error", onError);
            endpoint.off("exit", onExit);
        };
        const onMessage = (message) => {
            if (message.type === "error") {
                cleanup();
                reject(new Error(`${label}: ${message.error}`));
                return;
            }
            if (predicate(message)) {
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
                    `${label}: endpoint exited with code=${code} signal=${signal}`,
                ),
            );
        };

        endpoint.on("message", onMessage);
        endpoint.once("error", onError);
        endpoint.once("exit", onExit);
    });
}

function watchExit(endpoint) {
    const result = new Promise((resolve, reject) => {
        endpoint.once("error", reject);
        endpoint.once("exit", (code, signal = null) => resolve({ code, signal }));
    });
    result.catch(() => {});
    return result;
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function monotonicMilliseconds() {
    return Number(process.hrtime.bigint()) / 1_000_000;
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

function createReaderHandle(endpoint, send, isRunning, terminate, label) {
    const ready = waitForMessage(
        endpoint,
        (message) => message.type === "ready",
        `${label} ready`,
    );
    ready.catch(() => {});
    return {
        endpoint,
        send,
        isRunning,
        terminate,
        label,
        exit: watchExit(endpoint),
        ready,
    };
}

async function startReaderPool(dbPath, kind) {
    const readers = [];

    try {
        for (let index = 0; index < readerCount; index += 1) {
            const label = `${kind} reader ${index}`;
            if (kind === "process") {
                const child = fork(__filename, ["--reader", dbPath], {
                    stdio: ["ignore", "inherit", "inherit", "ipc"],
                });
                readers.push(
                    createReaderHandle(
                        child,
                        (message) => child.send(message),
                        () => child.exitCode === null && child.signalCode === null,
                        () => child.kill(),
                        label,
                    ),
                );
                continue;
            }

            const worker = new Worker(__filename, {
                workerData: { role: "checkpoint-reader", dbPath },
            });
            readers.push(
                createReaderHandle(
                    worker,
                    (message) => worker.postMessage(message),
                    () => worker.threadId !== -1,
                    () => worker.terminate(),
                    label,
                ),
            );
        }

        const ready = await Promise.all(readers.map((reader) => reader.ready));
        if (kind === "process") {
            const readerPids = ready.map((message) => message.pid);
            assert.equal(new Set(readerPids).size, readerCount);
            assert.equal(readerPids.includes(process.pid), false);
        } else {
            assert.deepEqual(
                ready.map((message) => message.pid),
                Array(readerCount).fill(process.pid),
            );
            assert.equal(
                new Set(ready.map((message) => message.threadId)).size,
                readerCount,
            );
        }
        return readers;
    } catch (error) {
        try {
            await terminateReaderPool(readers);
        } catch (cleanupError) {
            throw new AggregateError(
                [error, cleanupError],
                `${kind} reader pool startup and cleanup failed`,
            );
        }
        throw error;
    }
}

async function requestReader(reader, requestId, request, label) {
    const responsePromise = waitForMessage(
        reader.endpoint,
        (message) => message.requestId === requestId,
        label,
    );
    reader.send({ ...request, requestId });
    const response = await responsePromise;
    if (response.type === "error") {
        throw new Error(`${label}: ${response.error}`);
    }
    return response;
}

async function readFromAll(readers, requestId, key) {
    return Promise.all(
        readers.map(async (reader, readerIndex) => {
            const response = await requestReader(
                reader,
                requestId,
                { type: "read", key },
                `${reader.label} response ${requestId}`,
            );
            assert.equal(response.type, "value");
            return response.value;
        }),
    );
}

async function terminateReaderPool(readers) {
    const results = await Promise.allSettled(
        readers.map(async (reader) => {
            if (reader.isRunning()) {
                await reader.terminate();
            }
            return withTimeout(reader.exit, `${reader.label} forced exit`);
        }),
    );
    const errors = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason);
    if (errors.length > 0) {
        throw new AggregateError(errors, "reader pool cleanup failed");
    }
}

async function stopReaderPool(readers) {
    try {
        const stopped = readers.map((reader) => {
            if (!reader.isRunning()) {
                return Promise.resolve();
            }
            const response = waitForMessage(
                reader.endpoint,
                (message) => message.type === "stopped",
                `${reader.label} stop`,
            );
            reader.send({ type: "stop" });
            return response;
        });
        await Promise.all(stopped);

        const exits = await Promise.all(
            readers.map((reader) =>
                withTimeout(reader.exit, `${reader.label} graceful exit`),
            ),
        );
        for (const status of exits) {
            assert.deepEqual(status, { code: 0, signal: null });
        }
    } catch (error) {
        try {
            await terminateReaderPool(readers);
        } catch (cleanupError) {
            throw new AggregateError(
                [error, cleanupError],
                "reader pool stop and cleanup failed",
            );
        }
        throw error;
    }
}

async function testFourReaders(kind) {
    const { root, dbPath } = createTemporaryDatabase(`checkpoint-${kind}-readers`);
    const env = openEnvironment(dbPath);
    let readers = [];
    let writer;

    try {
        const setup = env.startWrite();
        setup.createMap("values", MDBX_Param.keyMode.ordinal);
        setup.commit();

        readers = await startReaderPool(dbPath, kind);
        writer = env.startWrite();
        const dbi = writer.openMap("values", MDBX_Param.keyMode.ordinal);

        for (let value = 1; value <= checkpointRounds; value += 1) {
            const key = value;
            const expected = String(value);
            dbi.put(writer, key, expected);
            assert.equal(writer.checkpoint(), false);
            assert.equal(writer.isActive(), true);

            const valuesPromise = readFromAll(readers, value, key);
            assert.equal(writer.isActive(), true);
            const values = await valuesPromise;

            assert.deepEqual(values, Array(readerCount).fill(expected));
            assert.equal(writer.isActive(), true);
        }

        const snapshotKey = 100;
        dbi.put(writer, snapshotKey, "before");
        assert.equal(writer.checkpoint(), false);
        const held = await requestReader(
            readers[0],
            100,
            { type: "hold", key: snapshotKey },
            "reader hold checkpoint snapshot",
        );
        assert.equal(held.value, "before");

        dbi.put(writer, snapshotKey, "after");
        assert.equal(writer.checkpoint(), false);
        const fresh = await requestReader(
            readers[1],
            101,
            { type: "read", key: snapshotKey },
            "fresh reader after later checkpoint",
        );
        assert.equal(fresh.value, "after");
        const stillHeld = await requestReader(
            readers[0],
            102,
            { type: "readHeld", key: snapshotKey },
            "held checkpoint snapshot",
        );
        assert.equal(stillHeld.value, "before");
        await requestReader(
            readers[0],
            103,
            { type: "releaseHeld" },
            "release held checkpoint snapshot",
        );

        assert.equal(writer.checkpoint(), true);
        assert.equal(writer.isActive(), true);
        dbi.put(writer, 101, "after-no-op");
        assert.equal(writer.checkpoint(), false);
        const afterNoop = await requestReader(
            readers[2],
            104,
            { type: "read", key: 101 },
            "fresh reader after no-op continuation",
        );
        assert.equal(afterNoop.value, "after-no-op");

        dbi.put(writer, 102, "committed-continuation");
        writer.commit();
        writer = undefined;
        const afterCommit = await requestReader(
            readers[3],
            105,
            { type: "read", key: 102 },
            "fresh reader after continuation commit",
        );
        assert.equal(afterCommit.value, "committed-continuation");

        await stopReaderPool(readers);
        readers = [];
    } finally {
        if (writer?.isActive()) {
            writer.abort();
        }
        if (readers.length > 0) {
            await terminateReaderPool(readers).catch(() => {});
        }
        env.closeSync();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function testTwoTransactionalWritersFourReaders(kind) {
    const { root, dbPath } = createTemporaryDatabase(
        `transactions-${kind}-two-writers-four-readers`,
    );
    const env = openEnvironment(dbPath);
    let readers = [];
    let firstWriter;
    let secondWriter;
    let firstWriterExit;
    let secondWriterExit;

    try {
        const setup = env.startWrite();
        setup.createMap("values", MDBX_Param.keyMode.ordinal);
        setup.commit();

        readers = await startReaderPool(dbPath, kind);
        firstWriter = fork(__filename, ["--transactional-writer", dbPath], {
            stdio: ["ignore", "inherit", "inherit", "ipc"],
        });
        secondWriter = fork(__filename, ["--transactional-writer", dbPath], {
            stdio: ["ignore", "inherit", "inherit", "ipc"],
        });
        firstWriterExit = watchExit(firstWriter);
        secondWriterExit = watchExit(secondWriter);

        const writerReady = await Promise.all([
            waitForMessage(
                firstWriter,
                (message) => message.type === "ready",
                `${kind} first transactional writer ready`,
            ),
            waitForMessage(
                secondWriter,
                (message) => message.type === "ready",
                `${kind} second transactional writer ready`,
            ),
        ]);
        assert.equal(new Set(writerReady.map((message) => message.pid)).size, 2);
        assert.equal(
            writerReady.some((message) => message.pid === process.pid),
            false,
        );

        const firstAcquired = waitForMessage(
            firstWriter,
            (message) => message.type === "acquired",
            `${kind} first transactional writer acquired`,
        );
        firstWriter.send({
            type: "begin",
            key: 200,
            value: "first-writer",
            hold: true,
        });
        await firstAcquired;

        const secondAttempting = waitForMessage(
            secondWriter,
            (message) => message.type === "attempting",
            `${kind} second transactional writer attempting`,
        );
        const secondAcquired = waitForMessage(
            secondWriter,
            (message) => message.type === "acquired",
            `${kind} second transactional writer acquired`,
        );
        const secondCommitted = waitForMessage(
            secondWriter,
            (message) => message.type === "committed",
            `${kind} second transactional writer committed`,
        );
        secondWriter.send({
            type: "begin",
            key: 201,
            value: "second-writer",
            hold: false,
        });
        await secondAttempting;
        const secondAttemptedAt = monotonicMilliseconds();

        const acquiredBeforeFirstCommit = await Promise.race([
            secondAcquired.then(() => true),
            delay(250).then(() => false),
        ]);
        assert.equal(acquiredBeforeFirstCommit, false);

        const firstCommitted = waitForMessage(
            firstWriter,
            (message) => message.type === "committed",
            `${kind} first transactional writer committed`,
        ).then((message) => ({ message, receivedAt: monotonicMilliseconds() }));
        const secondAcquiredTimed = secondAcquired.then((message) => ({
            message,
            receivedAt: monotonicMilliseconds(),
        }));
        const secondCommittedTimed = secondCommitted.then((message) => ({
            message,
            receivedAt: monotonicMilliseconds(),
        }));
        const firstCommitRequestedAt = monotonicMilliseconds();
        firstWriter.send({ type: "commit" });
        const [firstCommitEvent, secondAcquireEvent, secondCommitEvent] =
            await Promise.all([
                firstCommitted,
                secondAcquiredTimed,
                secondCommittedTimed,
            ]);

        const visibilityCheckStartedAt = monotonicMilliseconds();
        assert.deepEqual(
            await readFromAll(readers, 200, 200),
            Array(readerCount).fill("first-writer"),
        );
        assert.deepEqual(
            await readFromAll(readers, 201, 201),
            Array(readerCount).fill("second-writer"),
        );
        const visibilityCheckFinishedAt = monotonicMilliseconds();

        assert.deepEqual(await firstWriterExit, { code: 0, signal: null });
        firstWriter = undefined;
        assert.deepEqual(await secondWriterExit, { code: 0, signal: null });
        secondWriter = undefined;

        await stopReaderPool(readers);
        readers = [];

        return {
            kind,
            writerLockWaitMs:
                secondAcquireEvent.receivedAt - secondAttemptedAt,
            handoffAfterCommitRequestMs:
                secondAcquireEvent.receivedAt - firstCommitRequestedAt,
            firstCommitAcknowledgedMs:
                firstCommitEvent.receivedAt - firstCommitRequestedAt,
            secondCommitAfterAcquireMs:
                secondCommitEvent.receivedAt - secondAcquireEvent.receivedAt,
            fourReaderVisibilityCheckMs:
                visibilityCheckFinishedAt - visibilityCheckStartedAt,
        };
    } finally {
        for (const [writer, exit] of [
            [firstWriter, firstWriterExit],
            [secondWriter, secondWriterExit],
        ]) {
            if (writer && writer.exitCode === null) {
                writer.kill();
                await exit?.catch(() => {});
            }
        }
        if (readers.length > 0) {
            await terminateReaderPool(readers).catch(() => {});
        }
        env.closeSync();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function testWriterLockRetention() {
    const { root, dbPath } = createTemporaryDatabase("checkpoint-writer-lock");
    const env = openEnvironment(dbPath);
    let writer;
    let competitor;
    let competitorExit;

    try {
        const setup = env.startWrite();
        const dbi = setup.createMap("values", MDBX_Param.keyMode.ordinal);
        setup.commit();

        competitor = fork(__filename, ["--writer", dbPath], {
            stdio: ["ignore", "inherit", "inherit", "ipc"],
        });
        competitorExit = watchExit(competitor);
        await waitForMessage(
            competitor,
            (message) => message.type === "ready",
            "competing writer ready",
        );

        writer = env.startWrite();
        dbi.put(writer, 1, "checkpointed");
        assert.equal(writer.checkpoint(), false);

        const attempting = waitForMessage(
            competitor,
            (message) => message.type === "attempting",
            "competing writer attempting",
        );
        const acquired = waitForMessage(
            competitor,
            (message) => message.type === "acquired",
            "competing writer acquired",
        );
        competitor.send({ type: "start" });
        await attempting;

        const acquiredBeforeRelease = await Promise.race([
            acquired.then(() => true),
            delay(250).then(() => false),
        ]);
        assert.equal(acquiredBeforeRelease, false);

        writer.abort();
        writer = undefined;
        await acquired;
        assert.deepEqual(await competitorExit, { code: 0, signal: null });
        competitor = undefined;
    } finally {
        if (writer?.isActive()) {
            writer.abort();
        }
        if (competitor && competitor.exitCode === null) {
            competitor.kill();
            await competitorExit.catch(() => {});
        }
        env.closeSync();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function testRetainedError() {
    const { root, dbPath } = createTemporaryDatabase("checkpoint-map-full");
    loadAddon();
    const env = new MDBX_Env();
    env.openSync({
        path: dbPath,
        maxDbi: 8,
        geometry: { fixedSize: 1 * 1024 * 1024 },
    });
    let txn;

    try {
        const setup = env.startWrite();
        setup.createMap("values");
        setup.commit();

        txn = env.startWrite();
        const dbi = txn.openMap("values");
        const payload = Buffer.alloc(128 * 1024, 0x5a);
        let mapFullError;
        for (let key = 0; key < 1_024; key += 1) {
            try {
                dbi.put(txn, `large-${key}`, payload);
            } catch (error) {
                mapFullError = error;
                break;
            }
        }

        assert.ok(mapFullError, "fixed geometry did not reach MDBX_MAP_FULL");
        assert.match(mapFullError.message, /MDBX_MAP_FULL/);
        assert.throws(() => txn.checkpoint(), /txn checkpoint: .*MDBX_BAD_TXN/);
        assert.equal(txn.isActive(), true);
        txn.abort();
        txn = undefined;

        const retry = env.startWrite();
        dbi.put(retry, "after-abort", "ok");
        retry.commit();
    } finally {
        if (txn?.isActive()) {
            txn.abort();
        }
        env.closeSync();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function testTerminalError() {
    const { root, dbPath } = createTemporaryDatabase("checkpoint-terminal");
    const env = openEnvironment(dbPath);

    try {
        const setup = env.startWrite();
        setup.createMap("values", MDBX_Param.keyMode.ordinal);
        setup.commit();

        const txn = env.startWrite();
        const dbi = txn.openMap("values", MDBX_Param.keyMode.ordinal);
        dbi.put(txn, 1, "not-committed");
        assert.equal(typeof txn._debugFinishBeforeCheckpoint, "function");
        txn._debugFinishBeforeCheckpoint();
        assert.throws(() => txn.checkpoint(), /txn checkpoint:/);
        assert.equal(txn.isActive(), false);
        assert.throws(() => txn.abort(), /txn already completed/);

        const reader = env.startRead();
        assert.equal(dbi.get(reader, 1), undefined);
        reader.abort();
    } finally {
        env.closeSync();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function testLifecycleLoop() {
    const { root, dbPath } = createTemporaryDatabase("checkpoint-lifecycle");
    const env = new MDBX_Env();
    env.openSync({
        path: dbPath,
        maxDbi: 8,
        flags: MDBX_Param.envFlag.safeNosync,
        keyFlag: MDBX_Param.keyFlag.number,
        valueFlag: MDBX_Param.valueFlag.string,
    });

    try {
        const setup = env.startWrite();
        const dbi = setup.createMap("values", MDBX_Param.keyMode.ordinal);
        setup.commit();

        for (let value = 0; value < lifecycleIterations; value += 1) {
            const txn = env.startWrite();
            dbi.put(txn, value, String(value));
            assert.equal(txn.checkpoint(), false);
            txn.abort();
        }
    } finally {
        env.closeSync();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function testCheckpointGuards() {
    const { root, dbPath } = createTemporaryDatabase("checkpoint-guards");
    const env = openEnvironment(dbPath);
    let txn;

    try {
        txn = env.startWrite();
        const dbi = txn.createMap("values", MDBX_Param.keyMode.ordinal);
        dbi.put(txn, 1, "1");

        const cursor = txn.openCursor(dbi);
        assert.throws(
            () => txn.checkpoint(),
            /txn checkpoint: 1 cursor\(s\) still open/,
        );
        assert.equal(txn.isActive(), true);
        cursor.close();

        assert.equal(txn.checkpoint(), false);
        assert.equal(txn.checkpoint(), true);
        txn.abort();
        txn = undefined;

        const reader = env.startRead();
        assert.throws(
            () => reader.checkpoint(),
            (error) => error instanceof TypeError && error.message === "write transaction required",
        );
        assert.equal(reader.isActive(), true);
        reader.abort();
    } finally {
        if (txn?.isActive()) {
            txn.abort();
        }
        env.closeSync();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function runReaderServer(dbPath, flags, transport) {
    const env = openEnvironment(dbPath, flags);
    const setup = env.startRead();
    const dbi = setup.openMap("values", MDBX_Param.keyMode.ordinal);
    setup.abort();
    let stopped = false;
    let heldTxn;

    const closeResources = () => {
        if (heldTxn?.isActive()) {
            heldTxn.abort();
            heldTxn = undefined;
        }
        env.closeSync();
    };
    const stop = () => {
        if (stopped) {
            return;
        }
        stopped = true;
        closeResources();
        transport.send({ type: "stopped" }, transport.close);
    };

    transport.onMessage((message) => {
        if (message.type === "stop") {
            stop();
            return;
        }
        let txn;
        try {
            if (message.type === "read") {
                txn = env.startRead();
                const value = dbi.get(txn, message.key);
                txn.abort();
                txn = undefined;
                transport.send({
                    type: "value",
                    requestId: message.requestId,
                    value,
                });
            } else if (message.type === "hold") {
                assert.equal(heldTxn, undefined);
                heldTxn = env.startRead();
                transport.send({
                    type: "held",
                    requestId: message.requestId,
                    value: dbi.get(heldTxn, message.key),
                });
            } else if (message.type === "readHeld") {
                assert.ok(heldTxn?.isActive());
                transport.send({
                    type: "value",
                    requestId: message.requestId,
                    value: dbi.get(heldTxn, message.key),
                });
            } else if (message.type === "releaseHeld") {
                assert.ok(heldTxn?.isActive());
                heldTxn.abort();
                heldTxn = undefined;
                transport.send({
                    type: "released",
                    requestId: message.requestId,
                });
            }
        } catch (error) {
            if (txn?.isActive()) {
                txn.abort();
            }
            transport.send({
                type: "error",
                requestId: message.requestId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
    transport.onceClosed(() => {
        if (!stopped) {
            closeResources();
        }
    });
    transport.send({ type: "ready", ...transport.identity });
}

function runReaderProcess(dbPath) {
    loadAddon();
    runReaderServer(dbPath, MDBX_Param.envFlag.rdonly, {
        identity: { pid: process.pid },
        send: (message, callback) => process.send(message, callback),
        onMessage: (handler) => process.on("message", handler),
        onceClosed: (handler) => process.once("disconnect", handler),
        close: () => process.disconnect(),
    });
}

function runReaderWorker(dbPath) {
    loadAddon();
    // libmdbx strips ACCEDE from read-only opens, so workers adopt the
    // environment mode and create read transactions only.
    runReaderServer(dbPath, MDBX_Param.envFlag.accede, {
        identity: { pid: process.pid, threadId },
        send: (message, callback) => {
            parentPort.postMessage(message);
            callback?.();
        },
        onMessage: (handler) => parentPort.on("message", handler),
        onceClosed: (handler) => parentPort.once("close", handler),
        close: () => parentPort.close(),
    });
}

function runWriterProcess(dbPath) {
    const env = openEnvironment(dbPath);
    process.once("message", (message) => {
        if (message.type !== "start") {
            return;
        }
        process.send({ type: "attempting" }, () => {
            try {
                const txn = env.startWrite();
                process.send({ type: "acquired" }, () => {
                    txn.abort();
                    env.closeSync();
                    process.disconnect();
                });
            } catch (error) {
                console.error(error);
                process.exitCode = 1;
                env.closeSync();
                process.disconnect();
            }
        });
    });
    process.send({ type: "ready", pid: process.pid });
}

function runTransactionalWriterProcess(dbPath) {
    const env = openEnvironment(dbPath);
    const setup = env.startRead();
    const dbi = setup.openMap("values", MDBX_Param.keyMode.ordinal);
    setup.abort();
    let transaction;

    const close = () => {
        if (transaction?.isActive()) {
            transaction.abort();
        }
        env.closeSync();
        process.disconnect();
    };
    const fail = (error) => {
        console.error(error);
        process.exitCode = 1;
        close();
    };
    const commit = () => {
        try {
            transaction.commit();
            transaction = undefined;
            process.send({ type: "committed" }, close);
        } catch (error) {
            fail(error);
        }
    };

    process.once("message", (message) => {
        if (message.type !== "begin") {
            fail(new Error(`unexpected writer command: ${message.type}`));
            return;
        }
        process.send({ type: "attempting" }, () => {
            try {
                transaction = env.startWrite();
                dbi.put(transaction, message.key, message.value);
                process.send({ type: "acquired" }, () => {
                    if (message.hold) {
                        process.once("message", (nextMessage) => {
                            if (nextMessage.type === "commit") {
                                commit();
                            } else {
                                fail(
                                    new Error(
                                        `unexpected writer command: ${nextMessage.type}`,
                                    ),
                                );
                            }
                        });
                    } else {
                        commit();
                    }
                });
            } catch (error) {
                fail(error);
            }
        });
    });
    process.send({ type: "ready", pid: process.pid });
}

async function runDefaultTests() {
    loadAddon();
    await testFourReaders("process");
    await testTwoTransactionalWritersFourReaders("process");
    await testWriterLockRetention();
    testCheckpointGuards();
    testRetainedError();
    testLifecycleLoop();
    if (typeof MDBX_Env.prototype._debugStartWriter === "function") {
        testTerminalError();
    } else {
        console.log("checkpoint terminal error test skipped: release addon");
    }
    console.log("checkpoint default suite ok");
}

async function runWorkerTests() {
    assert.equal(process.env.MDBX_DBG_LEGACY_MULTIOPEN, "1");
    loadAddon();
    await testFourReaders("worker");
    await testTwoTransactionalWritersFourReaders("worker");
    console.log("checkpoint worker suite ok");
}

function summarizeValues(values) {
    const sorted = [...values].sort((left, right) => left - right);
    const percentile = (fraction) => {
        const position = (sorted.length - 1) * fraction;
        const lower = Math.floor(position);
        const upper = Math.ceil(position);
        if (lower === upper) return sorted[lower];
        return (
            sorted[lower] +
            (sorted[upper] - sorted[lower]) * (position - lower)
        );
    };
    return {
        min: sorted[0],
        median: percentile(0.5),
        p95: percentile(0.95),
        max: sorted.at(-1),
    };
}

async function runTwoWriterStatistics() {
    const kind = process.env.CHECKPOINT_READER_KIND ?? "process";
    assert.ok(["process", "worker"].includes(kind));
    if (kind === "worker") {
        assert.equal(process.env.MDBX_DBG_LEGACY_MULTIOPEN, "1");
    }
    const repetitions = Number(process.env.CHECKPOINT_STATS_REPETITIONS ?? 20);
    assert.ok(Number.isSafeInteger(repetitions) && repetitions > 0);
    loadAddon();

    const samples = [];
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const sample = await testTwoTransactionalWritersFourReaders(kind);
        samples.push(sample);
        console.log(
            `two-writer-sample ${JSON.stringify({ repetition, ...sample })}`,
        );
    }

    const metricNames = [
        "writerLockWaitMs",
        "handoffAfterCommitRequestMs",
        "firstCommitAcknowledgedMs",
        "secondCommitAfterAcquireMs",
        "fourReaderVisibilityCheckMs",
    ];
    const metrics = Object.fromEntries(
        metricNames.map((name) => [
            name,
            summarizeValues(samples.map((sample) => sample[name])),
        ]),
    );
    console.log(
        `two-writer-summary ${JSON.stringify({
            kind,
            repetitions,
            node: process.version,
            metrics,
        })}`,
    );
}

function runNode(args, environment = {}) {
    const result = spawnSync(process.execPath, args, {
        cwd: projectRoot,
        env: { ...process.env, ...environment },
        stdio: "inherit",
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(
            `${process.execPath} ${args.join(" ")} exited with ${result.status}`,
        );
    }
}

function runCheckpointTests() {
    runNode([__filename, "--test-default"]);
    // ACCEDE adopts the database mode, while libmdbx still requires this
    // explicit legacy opt-in for multiple independent envs in one process.
    runNode([__filename, "--test-workers"], {
        MDBX_DBG_LEGACY_MULTIOPEN: "1",
    });
    console.log("checkpoint suite ok");
}

function checkReleaseAddon() {
    const { root, dbPath } = createTemporaryDatabase("checkpoint-release");
    const env = openEnvironment(dbPath);
    try {
        const txn = env.startWrite();
        assert.equal(txn._debugFinishBeforeCheckpoint, undefined);
        txn.abort();
    } finally {
        env.closeSync();
        fs.rmSync(root, { recursive: true, force: true });
    }
    console.log("release addon has no checkpoint test hook");
}

function runSuite() {
    const failures = [];
    try {
        runNode(["build.js", "--testing"]);
        runCheckpointTests();
    } catch (error) {
        failures.push(error);
    }

    try {
        runNode(["build.js"]);
        runNode([__filename, "--check-release"]);
    } catch (error) {
        failures.push(error);
    }

    if (failures.length > 0) {
        throw new AggregateError(failures, "checkpoint regression suite failed");
    }
    console.log("checkpoint build matrix ok");
}

if (!isMainThread && workerData?.role === "checkpoint-reader") {
    try {
        runReaderWorker(workerData.dbPath);
    } catch (error) {
        parentPort.postMessage({
            type: "error",
            error: error instanceof Error ? error.message : String(error),
        });
        process.exitCode = 1;
    }
} else if (process.argv[2] === "--reader") {
    try {
        runReaderProcess(process.argv[3]);
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
} else if (process.argv[2] === "--writer") {
    try {
        runWriterProcess(process.argv[3]);
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
} else if (process.argv[2] === "--transactional-writer") {
    try {
        runTransactionalWriterProcess(process.argv[3]);
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
} else if (process.argv[2] === "--run-suite") {
    try {
        runSuite();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
} else if (process.argv[2] === "--check-release") {
    checkReleaseAddon();
} else if (process.argv[2] === "--test-default") {
    runDefaultTests().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
} else if (process.argv[2] === "--test-workers") {
    runWorkerTests().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
} else if (process.argv[2] === "--two-writer-statistics") {
    runTwoWriterStatistics().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
} else {
    try {
        runCheckpointTests();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}
