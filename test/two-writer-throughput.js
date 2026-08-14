"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const databaseRoot = process.env.BENCH_ROOT ?? os.tmpdir();
const warmupMs = readPositiveInteger("BENCH_WARMUP_MS", 1_000);
const durationMs = readPositiveInteger("BENCH_DURATION_MS", 10_000);
const repetitions = readPositiveInteger("BENCH_REPETITIONS", 5);
const batchSize = readPositiveInteger("BENCH_BATCH_SIZE", 200);
const readerCount = readPositiveInteger("BENCH_READER_COUNT", 4);
const pageSize = readPositiveInteger("BENCH_PAGE_SIZE", 4_096);
const mapSize = readPositiveInteger("BENCH_MAP_SIZE", 4 * 1024 ** 3);
const childTimeoutMs = durationMs + warmupMs + 30_000;

const { MDBX_Env, MDBX_Param } = require(
    path.join(projectRoot, "lib", "nativemou.js"),
);
const { envFlag, keyMode } = MDBX_Param;
const flags =
    envFlag.writemap | envFlag.nomeminit | envFlag.utterlyNosync;

function readPositiveInteger(name, fallback) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}

function openEnvironment(dbPath, readOnly = false) {
    const env = new MDBX_Env();
    const options = {
        path: dbPath,
        flags: readOnly ? envFlag.rdonly : flags,
        maxDbi: 2,
        maxReaders: readerCount + 8,
        trackBorrowedViews: false,
    };
    if (!readOnly) {
        options.geometry = {
            sizeNow: mapSize,
            sizeUpper: mapSize,
            growthStep: 0,
            shrinkThreshold: 0,
            pageSize,
        };
    }
    env.openSync(options);
    return env;
}

function waitForMessage(child, predicate, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`${label} timed out after ${childTimeoutMs} ms`));
        }, childTimeoutMs);
        const cleanup = () => {
            clearTimeout(timer);
            child.off("message", onMessage);
            child.off("error", onError);
            child.off("exit", onExit);
        };
        const onMessage = (message) => {
            if (message.type === "error") {
                cleanup();
                reject(new Error(`${label}: ${message.error}`));
            } else if (predicate(message)) {
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
                new Error(`${label} exited code=${code} signal=${signal}`),
            );
        };
        child.on("message", onMessage);
        child.once("error", onError);
        child.once("exit", onExit);
    });
}

function spawnRole(role, dbPath, index) {
    const child = fork(__filename, [`--${role}`, dbPath, String(index)], {
        stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const exit = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    exit.catch(() => {});
    return { child, exit, role, index };
}

async function stopChildren(handles) {
    await Promise.all(
        handles.map(async ({ child, exit }) => {
            if (child.exitCode === null && child.signalCode === null) {
                child.send({ type: "stop" });
            }
            const status = await exit;
            assert.deepEqual(status, { code: 0, signal: null });
        }),
    );
}

async function killChildren(handles) {
    await Promise.all(
        handles.map(async ({ child, exit }) => {
            if (child.exitCode === null && child.signalCode === null) {
                child.kill();
            }
            await exit.catch(() => {});
        }),
    );
}

function startPhase(handles, phase, runMs) {
    const startAtMs = Date.now() + 250;
    return Promise.all(
        handles.map(({ child, role, index }) => {
            const result = waitForMessage(
                child,
                (message) =>
                    message.type === "result" && message.phase === phase,
                `${role} ${index} ${phase}`,
            );
            child.send({
                type: "run",
                phase,
                startAtMs,
                runMs,
                batchSize,
            });
            return result;
        }),
    );
}

function summarize(values) {
    const sorted = [...values].sort((left, right) => left - right);
    const median =
        sorted.length % 2 === 1
            ? sorted[(sorted.length - 1) / 2]
            : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    return { min: sorted[0], median, max: sorted.at(-1) };
}

async function runCase(writerCount, repetition) {
    const root = fs.mkdtempSync(
        path.join(databaseRoot, `mdbxmou-${writerCount}w-${readerCount}r-`),
    );
    const dbPath = path.join(root, "db");
    const handles = [];

    try {
        const setupEnv = new MDBX_Env();
        setupEnv.openSync({
            path: dbPath,
            flags,
            maxDbi: 2,
            maxReaders: readerCount + 8,
            geometry: {
                sizeNow: mapSize,
                sizeUpper: mapSize,
                growthStep: 0,
                shrinkThreshold: 0,
                pageSize,
            },
            trackBorrowedViews: false,
        });
        const setupTxn = setupEnv.startWrite();
        const dbi = setupTxn.createMap("numbers", keyMode.ordinal);
        dbi.put(setupTxn, 0, Buffer.alloc(8));
        setupTxn.commit();
        setupEnv.closeSync();

        for (let index = 0; index < writerCount; index += 1) {
            handles.push(spawnRole("writer", dbPath, index));
        }
        for (let index = 0; index < readerCount; index += 1) {
            handles.push(spawnRole("reader", dbPath, index));
        }
        await Promise.all(
            handles.map(({ child, role, index }) =>
                waitForMessage(
                    child,
                    (message) => message.type === "ready",
                    `${role} ${index} ready`,
                ),
            ),
        );

        const warmup = await startPhase(handles, "warmup", warmupMs);
        const measured = await startPhase(handles, "measured", durationMs);
        const writerResults = measured.filter(
            (result) => result.role === "writer",
        );
        const readerResults = measured.filter(
            (result) => result.role === "reader",
        );
        const startedNs = writerResults.map((result) => BigInt(result.startedNs));
        const endedNs = writerResults.map((result) => BigInt(result.endedNs));
        const wallStartedNs = startedNs.reduce((left, right) =>
            left < right ? left : right,
        );
        const wallEndedNs = endedNs.reduce((left, right) =>
            left > right ? left : right,
        );
        const wallSeconds = Number(wallEndedNs - wallStartedNs) / 1e9;
        const writes = writerResults.reduce(
            (total, result) => total + result.writes,
            0,
        );
        const transactions = writerResults.reduce(
            (total, result) => total + result.transactions,
            0,
        );
        const readerOps = readerResults.reduce(
            (total, result) => total + result.operations,
            0,
        );
        assert.equal(
            readerResults.reduce((total, result) => total + result.errors, 0),
            0,
        );

        const allWriterResults = [...warmup, ...measured].filter(
            (result) => result.role === "writer",
        );
        const expectedEntries =
            1 +
            allWriterResults.reduce(
                (total, result) => total + result.writes,
                0,
            );
        const verifyEnv = openEnvironment(dbPath, true);
        const verifyTxn = verifyEnv.startRead();
        const verifyDbi = verifyTxn.openMap("numbers", keyMode.ordinal);
        assert.equal(verifyDbi.stat(verifyTxn).entries, expectedEntries);
        verifyTxn.abort();
        verifyEnv.closeSync();

        await stopChildren(handles);
        handles.length = 0;
        return {
            repetition,
            writerCount,
            readerCount,
            batchSize,
            wallSeconds,
            writes,
            writesPerSecond: writes / wallSeconds,
            transactions,
            transactionsPerSecond: transactions / wallSeconds,
            readerOps,
            readerOpsPerSecond: readerOps / wallSeconds,
            perWriterWrites: writerResults.map((result) => result.writes),
        };
    } finally {
        if (handles.length > 0) await killChildren(handles);
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function runChild(role, dbPath, index) {
    const env = openEnvironment(dbPath, role === "reader");
    const setupTxn = env.startRead();
    const dbi = setupTxn.openMap("numbers", keyMode.ordinal);
    setupTxn.abort();
    let sequence = 0;
    let stopped = false;

    process.on("message", async (message) => {
        try {
            if (message.type === "stop") {
                stopped = true;
                env.closeSync();
                process.disconnect();
                return;
            }
            if (message.type !== "run" || stopped) return;
            const waitMs = Math.max(0, message.startAtMs - Date.now());
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            const startedNs = process.hrtime.bigint();
            const deadlineNs =
                startedNs + BigInt(message.runMs) * 1_000_000n;

            if (role === "writer") {
                const encoded = Buffer.allocUnsafe(8);
                let writes = 0;
                let transactions = 0;
                do {
                    const txn = env.startWrite();
                    for (let offset = 0; offset < message.batchSize; offset += 1) {
                        const key = 1 + index + sequence * 2;
                        encoded.writeDoubleLE(key, 0);
                        dbi.put(txn, key, encoded);
                        sequence += 1;
                        writes += 1;
                    }
                    txn.commit();
                    transactions += 1;
                } while (process.hrtime.bigint() < deadlineNs);
                process.send({
                    type: "result",
                    role,
                    index,
                    phase: message.phase,
                    startedNs: String(startedNs),
                    endedNs: String(process.hrtime.bigint()),
                    writes,
                    transactions,
                });
            } else {
                let operations = 0;
                let errors = 0;
                do {
                    const txn = env.startRead();
                    const value = dbi.get(txn, 0);
                    txn.abort();
                    if (!value || value.length !== 8) errors += 1;
                    operations += 1;
                } while (process.hrtime.bigint() < deadlineNs);
                process.send({
                    type: "result",
                    role,
                    index,
                    phase: message.phase,
                    startedNs: String(startedNs),
                    endedNs: String(process.hrtime.bigint()),
                    operations,
                    errors,
                });
            }
        } catch (error) {
            process.send({
                type: "error",
                error: error instanceof Error ? error.stack : String(error),
            });
        }
    });
    process.send({ type: "ready", role, index, pid: process.pid });
}

async function main() {
    process.stdout.write(
        `root=${databaseRoot} flags=0x${(flags >>> 0).toString(16)} ` +
            `map=${mapSize} page=${pageSize} batch=${batchSize} ` +
            `readers=${readerCount} warmupMs=${warmupMs} ` +
            `durationMs=${durationMs} repetitions=${repetitions}\n`,
    );
    const results = [];
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const order = repetition % 2 === 1 ? [1, 2] : [2, 1];
        for (const writerCount of order) {
            const result = await runCase(writerCount, repetition);
            results.push(result);
            process.stdout.write(`result ${JSON.stringify(result)}\n`);
        }
    }

    const byWriterCount = Object.fromEntries(
        [1, 2].map((writerCount) => {
            const cases = results.filter(
                (result) => result.writerCount === writerCount,
            );
            return [
                writerCount,
                {
                    writesPerSecond: summarize(
                        cases.map((result) => result.writesPerSecond),
                    ),
                    transactionsPerSecond: summarize(
                        cases.map((result) => result.transactionsPerSecond),
                    ),
                    readerOpsPerSecond: summarize(
                        cases.map((result) => result.readerOpsPerSecond),
                    ),
                },
            ];
        }),
    );
    const ratio =
        byWriterCount[2].writesPerSecond.median /
        byWriterCount[1].writesPerSecond.median;
    process.stdout.write(
        `summary ${JSON.stringify({ byWriterCount, twoToOneRatio: ratio })}\n`,
    );
}

if (process.argv[2] === "--writer" || process.argv[2] === "--reader") {
    runChild(process.argv[2].slice(2), process.argv[3], Number(process.argv[4])).catch(
        (error) => {
            console.error(error);
            process.exitCode = 1;
        },
    );
} else {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
