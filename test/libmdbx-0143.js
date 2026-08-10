"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const scriptPath = __filename;
const projectRoot = path.resolve(__dirname, "..");

function loadAddon() {
    return require("../lib/nativemou.js");
}

function runNode(args) {
    const result = spawnSync(process.execPath, args, {
        cwd: projectRoot,
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

function runScenario(name, timeout) {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), `mdbxmou-0143-${name}-`),
    );
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [scriptPath, "--scenario", name, root],
            {
                cwd: projectRoot,
                stdio: ["ignore", "pipe", "pipe"],
            },
        );
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, timeout);
        child.once("error", (error) => {
            clearTimeout(timer);
            fs.rmSync(root, { recursive: true, force: true });
            reject(error);
        });
        child.once("close", (code, signal) => {
            clearTimeout(timer);
            fs.rmSync(root, { recursive: true, force: true });
            if (!timedOut && code === 0) {
                if (stdout.trim()) {
                    console.log(stdout.trim());
                }
                resolve();
                return;
            }
            const reason = timedOut
                ? `timeout ${timeout}ms`
                : `code=${code} signal=${signal}`;
            reject(new Error(`${name} failed: ${reason}\n${stdout}${stderr}`));
        });
    });
}

function updateDigest(hash, value) {
    let bytes;
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
        bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    } else {
        bytes = Buffer.from(String(value));
    }
    const size = Buffer.allocUnsafe(4);
    size.writeUInt32LE(bytes.length);
    hash.update(size);
    hash.update(bytes);
}

function updateRecordDigest(hash, key, value) {
    updateDigest(hash, key);
    updateDigest(hash, value);
}

function mapDigest(dbi, txn) {
    const hash = crypto.createHash("sha256");
    let count = 0;
    dbi.forEach(txn, (key, value) => {
        updateRecordDigest(hash, key, value);
        count += 1;
    });
    return { count, digest: hash.digest("hex") };
}

function openNostickyEnvironment(root) {
    const { MDBX_Env, MDBX_Param } = loadAddon();
    const env = new MDBX_Env();
    env.openSync({
        path: path.join(root, "db"),
        maxDbi: 8,
        flags:
            MDBX_Param.envFlag.nostickythreads | MDBX_Param.envFlag.safeNosync,
    });
    env.setOption(MDBX_Param.envOption.dpReserveLimit, 8);

    const txn = env.startWrite();
    const dbi = txn.createMap();
    dbi.put(txn, Buffer.from("seed"), Buffer.from("committed-unsynced-value"));
    txn.commit();
    return env;
}

async function waitForWriter(env) {
    const deadline = Date.now() + 5_000;
    let state = env._debugWriterState();
    while (!state.ready && !state.finished && Date.now() < deadline) {
        await new Promise(setImmediate);
        state = env._debugWriterState();
    }
    assert.equal(
        state.ready,
        true,
        `writer did not become ready: ${JSON.stringify(state)}`,
    );
    assert.equal(
        state.finished,
        false,
        `writer finished before overlap: ${JSON.stringify(state)}`,
    );
    assert.equal(state.beginCode, 0);
}

async function scenarioNostickySame(root) {
    const { MDBX_Param } = loadAddon();
    const env = openNostickyEnvironment(root);
    const txn = env.startWrite();
    try {
        assert.equal(
            env.setOption(MDBX_Param.envOption.dpReserveLimit, 0),
            undefined,
        );
        assert.equal(env.syncEx(true, false), 0);
    } finally {
        if (txn.isActive()) {
            txn.abort();
        }
        env.closeSync();
    }
}

async function scenarioNostickySetOption(root) {
    const { MDBX_Param } = loadAddon();
    const env = openNostickyEnvironment(root);
    const completion = env._debugStartWriter({
        holdMs: 5_000,
        publishDelayMs: 250,
        commit: true,
    });
    await waitForWriter(env);
    assert.equal(
        env.setOption(MDBX_Param.envOption.dpReserveLimit, 0),
        undefined,
    );
    assert.equal(env._debugWriterState().observedPhase, "finishing");
    await completion;
    assert.equal(env._debugWriterState().finishCode, 0);
    env.closeSync();
}

async function scenarioNostickyNonblockingSync(root) {
    const env = openNostickyEnvironment(root);
    const completion = env._debugStartWriter({ holdMs: 5_000, commit: false });
    await waitForWriter(env);
    assert.throws(() => env.syncEx(true, true), /MDBX_BUSY/);
    const state = env._debugWriterState();
    assert.equal(state.observedPhase, "ready");
    assert.equal(state.finished, false);
    await completion;
    assert.equal(env._debugWriterState().finishCode, 0);
    env.closeSync();
}

async function scenarioNostickyBlockingSync(root) {
    const env = openNostickyEnvironment(root);
    const completion = env._debugStartWriter({
        holdMs: 5_000,
        publishDelayMs: 250,
        commit: true,
    });
    await waitForWriter(env);
    assert.equal(env.syncEx(true, false), 0);
    assert.equal(env._debugWriterState().observedPhase, "finishing");
    await completion;
    assert.equal(env._debugWriterState().finishCode, 0);
    env.closeSync();
}

async function scenarioGeometryAndClose(root) {
    const { MDBX_Env } = loadAddon();
    const env = new MDBX_Env();
    env.openSync({
        path: path.join(root, "db"),
        geometry: { pageSize: 4_096 },
    });

    const txn = env.startWrite();
    assert.throws(() => env.closeSync(), /transaction in progress/);
    assert.throws(() => env.close(), /active transactions/);
    txn.abort();
    await env.close();
}

async function scenarioCursorSemantics(root) {
    const { MDBX_Env, MDBX_Param } = loadAddon();
    const { cursorMode, keyMode, valueFlag } = MDBX_Param;
    const env = new MDBX_Env();
    env.openSync({ path: path.join(root, "db"), valueFlag: valueFlag.string });

    const writeTxn = env.startWrite();
    const writeDbi = writeTxn.createMap("cursor", keyMode.ordinal);
    for (let key = 1; key <= 8; key += 1) {
        writeDbi.put(writeTxn, key, `value-${key}`);
    }
    writeTxn.commit();

    const readTxn = env.startRead();
    const dbi = readTxn.openMap("cursor", keyMode.ordinal);
    const first = [];
    const firstCount = dbi.forEach(readTxn, (key) => {
        first.push(key);
        return key === 3;
    });
    assert.equal(firstCount, 3);
    assert.deepEqual(first, [1, 2, 3]);

    const from = [];
    const fromCount = dbi.forEach(
        readTxn,
        4,
        cursorMode.keyGreaterOrEqual,
        (key, value) => {
            from.push([key, value]);
            return key === 6;
        },
    );
    assert.equal(fromCount, 3);
    assert.deepEqual(from, [
        [4, "value-4"],
        [5, "value-5"],
        [6, "value-6"],
    ]);
    assert.deepEqual(
        dbi.keysFrom(readTxn, 4, 3, cursorMode.keyGreaterOrEqual),
        [4, 5, 6],
    );
    assert.deepEqual(
        dbi.keysFrom(readTxn, 6, 3, cursorMode.keyLesserOrEqual),
        [6, 5, 4],
    );
    readTxn.commit();

    assert.deepEqual(
        await env.keys({
            dbi: writeDbi,
            from: 4,
            limit: 3,
            cursorMode: cursorMode.keyGreaterOrEqual,
        }),
        [4, 5, 6],
    );
    assert.deepEqual(
        await env.keys({
            dbi: writeDbi,
            from: 6,
            limit: 3,
            cursorMode: cursorMode.keyLesserOrEqual,
        }),
        [6, 5, 4],
    );
    await env.close();
}

function seedNamed(env, name, entries) {
    const txn = env.startWrite();
    const dbi = txn.createMap(name);
    for (const [key, value] of entries) {
        dbi.put(txn, Buffer.from(key), value);
    }
    txn.commit();
    return dbi;
}

async function scenarioDbiLifecycle(root) {
    const { MDBX_Env, MDBX_Param } = loadAddon();
    const env = new MDBX_Env();
    env.openSync({
        path: path.join(root, "db"),
        maxDbi: 16,
        flags: MDBX_Param.envFlag.nostickythreads,
        valueFlag: MDBX_Param.valueFlag.string,
    });

    seedNamed(env, "clear-only", [["key", "value"]]);
    let txn = env.startWrite();
    let dbi = txn.openMap("clear-only");
    dbi.drop(txn, false);
    txn.commit();
    txn = env.startRead();
    dbi = txn.openMap("clear-only");
    assert.equal(dbi.stat(txn).entries, 0);
    txn.commit();

    seedNamed(env, "abort-drop", [["key", "survives-abort"]]);
    txn = env.startWrite();
    dbi = txn.openMap("abort-drop");
    dbi.drop(txn, true);
    txn.abort();
    txn = env.startRead();
    dbi = txn.openMap("abort-drop");
    assert.equal(dbi.get(txn, Buffer.from("key")), "survives-abort");
    txn.commit();

    seedNamed(env, "drop-old", [["key", "snapshot-value"]]);
    const snapshotTxn = env.startRead();
    const snapshotDbi = snapshotTxn.openMap("drop-old");
    assert.equal(
        snapshotDbi.get(snapshotTxn, Buffer.from("key")),
        "snapshot-value",
    );
    const dropTxn = env.startWrite();
    const droppedDbi = dropTxn.openMap("drop-old");
    droppedDbi.drop(dropTxn, true);
    const replacementDbi = dropTxn.createMap("drop-replacement");
    replacementDbi.put(dropTxn, Buffer.from("key"), "replacement-value");
    assert.throws(
        () => droppedDbi.get(dropTxn, Buffer.from("key")),
        /MDBX_BAD_DBI/,
    );
    assert.equal(
        snapshotDbi.get(snapshotTxn, Buffer.from("key")),
        "snapshot-value",
    );
    dropTxn.commit();
    assert.throws(
        () => snapshotDbi.get(snapshotTxn, Buffer.from("key")),
        /MDBX_BAD_DBI/,
    );
    snapshotTxn.abort();

    const probeTxn = env.startRead();
    assert.throws(
        () => droppedDbi.get(probeTxn, Buffer.from("key")),
        /MDBX_BAD_DBI/,
    );
    assert.throws(() => probeTxn.openMap("drop-old"), /MDBX_NOTFOUND/);
    probeTxn.abort();

    const replacementTxn = env.startRead();
    const replacement = replacementTxn.openMap("drop-replacement");
    assert.equal(
        replacement.get(replacementTxn, Buffer.from("key")),
        "replacement-value",
    );
    replacementTxn.commit();
    env.closeSync();
}

function readCopyDataset(env) {
    const txn = env.startRead();
    const main = mapDigest(txn.openMap(), txn);
    const named = mapDigest(txn.openMap("named"), txn);
    txn.commit();
    return { main, named };
}

async function scenarioCopyPayload(root) {
    const { MDBX_Env, MDBX_Param } = loadAddon();
    const env = new MDBX_Env();
    env.openSync({ path: path.join(root, "source"), maxDbi: 8 });

    const txn = env.startWrite();
    const main = txn.createMap();
    const named = txn.createMap("named");
    for (let index = 0; index < 64; index += 1) {
        main.put(
            txn,
            Buffer.from(`main-${index.toString().padStart(3, "0")}`),
            Buffer.alloc(256, index),
        );
        named.put(
            txn,
            Buffer.from(`named-${index.toString().padStart(3, "0")}`),
            Buffer.alloc(384, 255 - index),
        );
    }
    txn.commit();
    const expected = readCopyDataset(env);
    assert.deepEqual(
        { main: expected.main.count, named: expected.named.count },
        { main: 65, named: 64 },
    );

    const syncRoot = path.join(root, "sync-copy");
    const asyncRoot = path.join(root, "async-copy");
    fs.mkdirSync(syncRoot);
    fs.mkdirSync(asyncRoot);
    env.copyToSync(
        path.join(syncRoot, "mdbx.dat"),
        MDBX_Param.copyFlag.defaults,
    );
    await env.copyTo(
        path.join(asyncRoot, "mdbx.dat"),
        MDBX_Param.copyFlag.defaults,
    );
    env.closeSync();

    for (const copyRoot of [syncRoot, asyncRoot]) {
        const copy = new MDBX_Env();
        copy.openSync({ path: copyRoot, maxDbi: 8 });
        assert.deepEqual(readCopyDataset(copy), expected);
        copy.closeSync();
    }
}

async function scenarioForcedSpilling(root) {
    const { MDBX_Env, MDBX_Param } = loadAddon();
    const dbPath = path.join(root, "db");
    let env = new MDBX_Env();
    env.openSync({ path: dbPath, maxDbi: 8 });

    let txn = env.startWrite();
    let dbi = txn.createMap("spill", MDBX_Param.keyMode.ordinal);
    txn.commit();
    txn = env.startRead();
    dbi = txn.openMap("spill", MDBX_Param.keyMode.ordinal);
    const pageSize = dbi.stat(txn).pageSize;
    txn.commit();

    const txnDpLimit = 128;
    const recordCount = 512;
    const payloadBytes = pageSize * 2;
    const estimatedDirtyPages = Math.ceil(
        (recordCount * payloadBytes) / pageSize,
    );
    assert.equal(pageSize, 4_096);
    assert.ok(payloadBytes > pageSize);
    assert.ok(estimatedDirtyPages > txnDpLimit);
    env.setOption(MDBX_Param.envOption.txnDpLimit, txnDpLimit);

    const expectedHash = crypto.createHash("sha256");
    txn = env.startWrite();
    dbi = txn.openMap("spill", MDBX_Param.keyMode.ordinal);
    for (let key = 0; key < recordCount; key += 1) {
        const value = Buffer.alloc(payloadBytes, key % 251);
        dbi.put(txn, key, value);
        updateRecordDigest(expectedHash, key, value);
    }
    txn.commit();
    const expected = { count: recordCount, digest: expectedHash.digest("hex") };
    env.closeSync();

    env = new MDBX_Env();
    env.openSync({ path: dbPath, maxDbi: 8 });
    txn = env.startRead();
    dbi = txn.openMap("spill", MDBX_Param.keyMode.ordinal);
    const actual = mapDigest(dbi, txn);
    txn.commit();
    env.closeSync();
    assert.deepEqual(actual, expected);
    console.log(
        JSON.stringify({
            pageSize,
            txnDpLimit,
            recordCount,
            payloadBytes,
            estimatedDirtyPages,
            totalBytes: recordCount * payloadBytes,
            digest: actual.digest,
        }),
    );
}

const scenarios = {
    "nosticky-same": scenarioNostickySame,
    "nosticky-set-option": scenarioNostickySetOption,
    "nosticky-sync-nonblocking": scenarioNostickyNonblockingSync,
    "nosticky-sync-blocking": scenarioNostickyBlockingSync,
    "geometry-close": scenarioGeometryAndClose,
    cursor: scenarioCursorSemantics,
    dbi: scenarioDbiLifecycle,
    copy: scenarioCopyPayload,
    spilling: scenarioForcedSpilling,
};

function registerTests() {
    const test = require("node:test");
    const cases = [
        ["same-thread NOSTICKYTHREADS env calls", "nosticky-same", 15_000],
        [
            "cross-thread setOption waits for writer",
            "nosticky-set-option",
            15_000,
        ],
        [
            "cross-thread nonblocking sync returns MDBX_BUSY",
            "nosticky-sync-nonblocking",
            15_000,
        ],
        [
            "cross-thread blocking sync waits for writer",
            "nosticky-sync-blocking",
            15_000,
        ],
        [
            "geometry open and active transaction close guard",
            "geometry-close",
            15_000,
        ],
        ["sync and async cursor traversal semantics", "cursor", 15_000],
        ["named DBI drop lifecycle", "dbi", 20_000],
        ["non-compacting sync and async copy preserve payload", "copy", 30_000],
        ["forced spilling survives commit and reopen", "spilling", 60_000],
    ];
    for (const [title, name, timeout] of cases) {
        test(title, { timeout: timeout + 2_000 }, async () =>
            runScenario(name, timeout),
        );
    }
}

function checkReleaseAddon() {
    const { MDBX_Env } = loadAddon();
    const env = new MDBX_Env();
    assert.equal(env._debugStartWriter, undefined);
    assert.equal(env._debugWriterState, undefined);
    console.log("release addon has no libmdbx-0143 test hooks");
}

function runSuite() {
    const failures = [];
    try {
        runNode(["build.js", "--testing"]);
        runNode([scriptPath, "--test-suite"]);
    } catch (error) {
        failures.push(error);
    }

    try {
        runNode(["build.js"]);
        runNode([scriptPath, "--check-release"]);
    } catch (error) {
        failures.push(error);
    }

    if (failures.length > 0) {
        throw new AggregateError(
            failures,
            "libmdbx v0.14.3 regression suite failed",
        );
    }
    console.log("libmdbx v0.14.3 regression suite passed");
}

const [command, scenarioName, scenarioRoot] = process.argv.slice(2);
if (command === "--scenario") {
    const scenario = scenarios[scenarioName];
    if (!scenario || !scenarioRoot) {
        throw new Error(
            `unknown or incomplete scenario: ${scenarioName ?? "<missing>"}`,
        );
    }
    scenario(scenarioRoot).catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
} else if (command === "--test-suite") {
    registerTests();
} else if (command === "--check-release") {
    checkReleaseAddon();
} else if (command === "--run-suite") {
    try {
        runSuite();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
} else {
    throw new Error(
        "expected --run-suite, --test-suite, --scenario, or --check-release",
    );
}
