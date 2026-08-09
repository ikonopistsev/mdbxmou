"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const {
    Worker,
    isMainThread,
    parentPort,
    workerData,
} = require("node:worker_threads");

const childModeEnvironmentName = "MDBXMOU_WORKER_TEST_CHILD";
const childMode = process.env[childModeEnvironmentName];
const childTimeoutMs = 45_000;
const operationTimeoutMs = 10_000;
let workerGraph;

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`${label} timed out after ${milliseconds} ms`)),
            milliseconds,
        );
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createLiveGraph(native, dbPath) {
    const env = new native.MDBX_Env();
    env.openSync({ path: dbPath });

    const writeTxn = env.startWrite();
    const writeDbi = writeTxn.createMap();
    writeDbi.put(writeTxn, "payload", Buffer.alloc(256, 0x5a));
    writeTxn.commit();

    const readTxn = env.startRead();
    const readDbi = readTxn.openMap();
    const cursor = readTxn.openCursor(readDbi);
    const secondCursor = readTxn.openCursor(readDbi);
    const view = readDbi.getView(readTxn, "payload");

    assert.ok(view instanceof DataView);
    assert.equal(view.byteLength, 256);
    assert.equal(view.getUint8(0), 0x5a);

    return {
        env,
        writeTxn,
        writeDbi,
        readTxn,
        readDbi,
        cursor,
        secondCursor,
        view,
        prototypes: {
            txn: Object.getPrototypeOf(readTxn),
            dbi: Object.getPrototypeOf(readDbi),
            cursor: Object.getPrototypeOf(cursor),
        },
        prototypeStable:
            Object.getPrototypeOf(writeTxn) === Object.getPrototypeOf(readTxn) &&
            Object.getPrototypeOf(writeDbi) === Object.getPrototypeOf(readDbi) &&
            Object.getPrototypeOf(cursor) === Object.getPrototypeOf(secondCursor),
    };
}

function closeGraph(graph) {
    graph.cursor.close();
    graph.secondCursor.close();
    graph.readTxn.abort();
    graph.env.closeSync();
}

function assertPrototypeIdentity(expected, actual) {
    assert.strictEqual(actual.txn, expected.txn);
    assert.strictEqual(actual.dbi, expected.dbi);
    assert.strictEqual(actual.cursor, expected.cursor);
}

function readLifecycle(native) {
    assert.equal(
        typeof native._debugAddonState,
        "function",
        "testing build must export _debugAddonState",
    );
    const value = native._debugAddonState();
    assert.equal(value.created - value.finalized, value.live);
    return value;
}

async function waitForLifecycle(native, expected, label) {
    const deadline = Date.now() + operationTimeoutMs;
    let actual;

    do {
        actual = readLifecycle(native);
        if (
            actual.created === expected.created &&
            actual.finalized === expected.finalized &&
            actual.live === expected.live
        ) {
            return actual;
        }
        await delay(10);
    } while (Date.now() < deadline);

    assert.deepEqual(actual, expected, `${label}: lifecycle counters`);
}

function waitForMessage(worker, type) {
    return withTimeout(
        new Promise((resolve, reject) => {
            const onMessage = (message) => {
                if (message.type === "error") {
                    cleanup();
                    reject(new Error(message.error));
                } else if (message.type === type) {
                    cleanup();
                    resolve(message);
                }
            };
            const onError = (error) => {
                cleanup();
                reject(error);
            };
            const onExit = (code) => {
                cleanup();
                reject(new Error(`Worker exited with code ${code} before ${type}`));
            };
            const cleanup = () => {
                worker.off("message", onMessage);
                worker.off("error", onError);
                worker.off("exit", onExit);
            };

            worker.on("message", onMessage);
            worker.once("error", onError);
            worker.once("exit", onExit);
        }),
        operationTimeoutMs,
        `Worker message ${type}`,
    );
}

function watchExit(worker) {
    const exit = new Promise((resolve, reject) => {
        worker.once("exit", resolve);
        worker.once("error", reject);
    });
    exit.catch(() => {});
    return exit;
}

async function startDirectWorker(dbPath) {
    const worker = new Worker(__filename, {
        workerData: { role: "direct", dbPath },
    });
    const exit = watchExit(worker);
    await waitForMessage(worker, "waiting");
    worker.postMessage({ type: "start" });
    const ready = await waitForMessage(worker, "ready");
    assert.equal(ready.prototypeStable, true);
    assert.equal(ready.viewByteLength, 256);
    return { worker, exit };
}

async function finishDirectWorker(handle, mode) {
    if (mode === "natural") {
        handle.worker.postMessage({ type: "exit" });
        const code = await withTimeout(
            handle.exit,
            operationTimeoutMs,
            "natural Worker exit",
        );
        assert.equal(code, 0);
        return;
    }

    const terminateCode = await withTimeout(
        handle.worker.terminate(),
        operationTimeoutMs,
        "worker.terminate()",
    );
    const exitCode = await withTimeout(
        handle.exit,
        operationTimeoutMs,
        "terminated Worker exit",
    );
    assert.equal(terminateCode, 1);
    assert.equal(exitCode, terminateCode);
}

async function verifyMainGraph(native, root, sequence, expectedPrototypes) {
    const graph = createLiveGraph(native, path.join(root, `main-${sequence}`));
    assert.equal(graph.prototypeStable, true);
    assertPrototypeIdentity(expectedPrototypes, graph.prototypes);
    closeGraph(graph);
}

async function runDirectScenario() {
    const native = require("../lib/nativemou.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-isolates-"));

    try {
        const baselineGraph = createLiveGraph(native, path.join(root, "main-baseline"));
        assert.equal(baselineGraph.prototypeStable, true);
        const mainPrototypes = baselineGraph.prototypes;
        closeGraph(baselineGraph);

        let expected = readLifecycle(native);
        assert.equal(expected.live, 1);

        let sequence = 0;
        for (const mode of ["natural", "terminate", "natural", "terminate"]) {
            const before = expected;
            const mainGraph = createLiveGraph(
                native,
                path.join(root, `main-live-${sequence}`),
            );
            const handle = await startDirectWorker(
                path.join(root, `worker-${sequence}`),
            );

            await waitForLifecycle(
                native,
                {
                    created: before.created + 1,
                    finalized: before.finalized,
                    live: before.live + 1,
                },
                `${mode} ready`,
            );

            closeGraph(mainGraph);
            await finishDirectWorker(handle, mode);
            expected = {
                created: before.created + 1,
                finalized: before.finalized + 1,
                live: before.live,
            };
            await waitForLifecycle(native, expected, `${mode} teardown`);
            await verifyMainGraph(native, root, `after-${sequence}`, mainPrototypes);
            sequence += 1;
        }

        const parallelCount = 4;
        const beforeParallel = expected;
        const workers = Array.from({ length: parallelCount }, (_, index) => {
            const worker = new Worker(__filename, {
                workerData: {
                    role: "direct",
                    dbPath: path.join(root, `parallel-${index}`),
                },
            });
            return { worker, exit: watchExit(worker) };
        });

        await Promise.all(workers.map(({ worker }) => waitForMessage(worker, "waiting")));
        const readyPromises = workers.map(({ worker }) => waitForMessage(worker, "ready"));
        workers.forEach(({ worker }) => worker.postMessage({ type: "start" }));
        const ready = await Promise.all(readyPromises);
        ready.forEach((message) => {
            assert.equal(message.prototypeStable, true);
            assert.equal(message.viewByteLength, 256);
        });

        await waitForLifecycle(
            native,
            {
                created: beforeParallel.created + parallelCount,
                finalized: beforeParallel.finalized,
                live: beforeParallel.live + parallelCount,
            },
            "parallel ready",
        );

        await Promise.all(
            workers.map((handle, index) =>
                finishDirectWorker(handle, index % 2 === 0 ? "natural" : "terminate"),
            ),
        );
        expected = {
            created: beforeParallel.created + parallelCount,
            finalized: beforeParallel.finalized + parallelCount,
            live: beforeParallel.live,
        };
        await waitForLifecycle(native, expected, "parallel teardown");
        await verifyMainGraph(native, root, "after-parallel", mainPrototypes);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function asyncRoundTrip(environment, value) {
    const writeTxn = await environment.startWrite();
    const writeDbi = await writeTxn.openMap({ create: true });
    await writeDbi.put("key", value);
    await writeTxn.commit();

    const readTxn = await environment.startRead();
    const readDbi = await readTxn.openMap();
    assert.equal(await readDbi.get("key"), value);
    await readTxn.abort();
}

async function runAsyncRootScenario() {
    const rootExport = await import("mdbxmou");
    const native = rootExport.default;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-async-root-"));

    try {
        const mainGraph = createLiveGraph(native, path.join(root, "main"));
        const mainPrototypes = mainGraph.prototypes;
        closeGraph(mainGraph);

        let expected = readLifecycle(native);
        const environment = new rootExport.MDBX_Async_Env();

        await environment.open({ path: path.join(root, "first") });
        await asyncRoundTrip(environment, "first");
        await environment.close();
        await waitForLifecycle(
            native,
            {
                created: expected.created + 1,
                finalized: expected.finalized,
                live: expected.live + 1,
            },
            "async close keeps Worker",
        );
        await environment.terminate();
        expected = {
            created: expected.created + 1,
            finalized: expected.finalized + 1,
            live: expected.live,
        };
        await waitForLifecycle(native, expected, "async terminate");

        await environment.open({ path: path.join(root, "second") });
        await asyncRoundTrip(environment, "second");
        await environment.terminate();
        expected = {
            created: expected.created + 1,
            finalized: expected.finalized + 1,
            live: expected.live,
        };
        await waitForLifecycle(native, expected, "async reopen teardown");

        const parallelCount = 3;
        const environments = Array.from(
            { length: parallelCount },
            () => new rootExport.MDBX_Async_Env(),
        );
        await Promise.all(
            environments.map(async (item, index) => {
                await item.open({ path: path.join(root, `parallel-${index}`) });
                await asyncRoundTrip(item, `parallel-${index}`);
            }),
        );
        await waitForLifecycle(
            native,
            {
                created: expected.created + parallelCount,
                finalized: expected.finalized,
                live: expected.live + parallelCount,
            },
            "async parallel ready",
        );
        await Promise.all(environments.map((item) => item.terminate()));
        expected = {
            created: expected.created + parallelCount,
            finalized: expected.finalized + parallelCount,
            live: expected.live,
        };
        await waitForLifecycle(native, expected, "async parallel teardown");
        await verifyMainGraph(native, root, "after-async", mainPrototypes);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function runAsyncSubpathScenario() {
    const asyncExport = await import("mdbxmou/async");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-async-subpath-"));
    const environment = new asyncExport.MDBX_Async_Env();

    try {
        await environment.open({ path: path.join(root, "worker-first") });
        await asyncRoundTrip(environment, "worker-first");

        const native = require("../lib/nativemou.js");
        await waitForLifecycle(
            native,
            { created: 2, finalized: 0, live: 2 },
            "Worker-first then main load",
        );
        const graph = createLiveGraph(native, path.join(root, "main-second"));
        assert.equal(graph.prototypeStable, true);
        closeGraph(graph);

        await environment.terminate();
        await waitForLifecycle(
            native,
            { created: 2, finalized: 1, live: 1 },
            "subpath teardown",
        );
    } finally {
        await environment.terminate().catch(() => {});
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function runWorkerMode() {
    parentPort.postMessage({ type: "waiting" });
    parentPort.once("message", (message) => {
        if (message.type !== "start") {
            parentPort.postMessage({ type: "error", error: "expected start" });
            parentPort.close();
            return;
        }

        try {
            const native = require("../lib/nativemou.js");
            workerGraph = createLiveGraph(native, workerData.dbPath);
            parentPort.postMessage({
                type: "ready",
                prototypeStable: workerGraph.prototypeStable,
                viewByteLength: workerGraph.view.byteLength,
            });
            parentPort.once("message", (command) => {
                if (command.type === "exit") {
                    parentPort.close();
                }
            });
        } catch (error) {
            parentPort.postMessage({
                type: "error",
                error: error && error.stack ? error.stack : String(error),
            });
            parentPort.close();
            process.exitCode = 1;
        }
    });
}

async function runChild(mode) {
    if (mode === "direct") {
        await runDirectScenario();
    } else if (mode === "async-root") {
        await runAsyncRootScenario();
    } else if (mode === "async-subpath") {
        await runAsyncSubpathScenario();
    } else {
        throw new Error(`unknown child mode: ${mode}`);
    }
    process.stdout.write(`${JSON.stringify({ mode, status: "ok" })}\n`);
}

function runChildProcess(mode) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [__filename], {
            env: {
                ...process.env,
                [childModeEnvironmentName]: mode,
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
            child.kill();
            reject(
                new Error(
                    `subprocess ${mode} timed out after ${childTimeoutMs} ms\n${stdout}${stderr}`,
                ),
            );
        }, childTimeoutMs);

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.once("exit", (code, signal) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve(stdout);
                return;
            }
            reject(
                new Error(
                    `${mode} failed: code=${code} signal=${signal}\n${stdout}${stderr}`,
                ),
            );
        });
    });
}

function checkReleaseBuild() {
    const native = require("../lib/nativemou.js");
    assert.equal(Object.hasOwn(native, "_debugAddonState"), false);
    assert.equal(native._debugAddonState, undefined);
    process.stdout.write("release addon has no testing lifecycle accessor\n");
}

function runNode(args) {
    const runtimePath = `${path.dirname(process.execPath)}${path.delimiter}${
        process.env.PATH || ""
    }`;
    const childEnv = {
        ...process.env,
        PATH: runtimePath,
    };
    for (const name of Object.keys(childEnv)) {
        if (name.toUpperCase() === childModeEnvironmentName) {
            delete childEnv[name];
        }
    }

    const result = spawnSync(process.execPath, args, {
        cwd: path.resolve(__dirname, ".."),
        env: childEnv,
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

function runCanonicalSuite() {
    let testError;
    try {
        runNode(["build.js", "--testing"]);
        runNode([__filename]);
    } catch (error) {
        testError = error;
    }

    let restoreError;
    try {
        runNode(["build.js"]);
        runNode([__filename, "--check-release"]);
    } catch (error) {
        restoreError = error;
    }

    if (testError && restoreError) {
        throw new AggregateError(
            [testError, restoreError],
            "Worker suite failed and release build could not be restored",
        );
    }
    if (restoreError) {
        throw restoreError;
    }
    if (testError) {
        throw testError;
    }
}

if (!isMainThread && workerData && workerData.role === "direct") {
    void runWorkerMode();
} else if (isMainThread && process.argv.includes("--run-suite")) {
    runCanonicalSuite();
} else if (isMainThread && process.argv.includes("--check-release")) {
    checkReleaseBuild();
} else if (isMainThread && childMode) {
    runChild(childMode).catch((error) => {
        process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
        process.exitCode = 1;
    });
} else if (isMainThread) {
    const test = require("node:test");

    test("direct Worker lifecycle is isolate-local", { timeout: 50_000 }, async () => {
        await runChildProcess("direct");
    });

    test("root MDBX_Async_Env supports terminate and reopen", { timeout: 50_000 }, async () => {
        await runChildProcess("async-root");
    });

    test("mdbxmou/async supports Worker-first addon initialization", { timeout: 50_000 }, async () => {
        await runChildProcess("async-subpath");
    });
}
