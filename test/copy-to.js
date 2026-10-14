"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const { createHook } = require("node:async_hooks");
const addonPath = process.env.MDBXMOU_COPY_TEST_ADDON || path.resolve(__dirname, "../build/Release/mdbxmou.node");
const native = require(addonPath);
const { MDBX_Env, MDBX_Param: P, _copyTest: hooks } = native;
const operations = ["open", "close", "copy", "query", "keys"];

async function waitFor(predicate, label) {
    const deadline = Date.now() + 10_000;
    while (!predicate()) {
        assert.ok(Date.now() < deadline, `${label} timed out`);
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
}

function graph(root, { unopened = false, nosync = false, large = false } = {}) {
    const env = new MDBX_Env();
    const options = {
        path: path.join(root, "db"),
        flags: P.envFlag.nostickythreads | (nosync ? P.envFlag.safeNosync : 0),
        geometry: { sizeUpper: 128 * 1024 * 1024 },
    };
    const result = { env, options, root, dbi: null, count: large ? 1024 : 2 };
    if (unopened) return result;
    env.openSync(options);
    const txn = env.startWrite();
    result.dbi = txn.createMap();
    const value = Buffer.alloc(large ? 4096 : 32, 1);
    for (let index = 0; index < result.count; ++index)
        result.dbi.put(txn, Buffer.from(`key-${index}`), value);
    txn.commit();
    env.syncEx(true, false);
    return result;
}

function destination(g, name = "backup") {
    const dest = path.join(g.root, name);
    return { dest, file: dest };
}

function call(kind, g, flags = P.copyFlag.compact, dest) {
    if (kind === "open") return g.env.open(g.options);
    if (kind === "close") return g.env.close();
    if (kind === "copy") return g.env.copyTo(dest || destination(g).dest, flags);
    if (kind === "query") return g.env.query({
        dbi: g.dbi, mode: P.queryMode.get, item: [{ key: "key-0" }],
    }, P.txnMode.ro);
    return g.env.keys(g.dbi, P.txnMode.ro);
}

function busyCalls(g) {
    return [
        () => g.env.open(g.options), () => g.env.openSync(g.options),
        () => g.env.close(), () => g.env.closeSync(),
        () => g.env.copyTo(path.join(g.root, "unused")),
        () => g.env.copyToSync(path.join(g.root, "unused")),
        () => g.env.startRead(), () => g.env.startWrite(),
        () => g.env.query([], P.txnMode.ro), () => g.env.keys([], P.txnMode.ro),
        () => g.env.syncEx(true, false),
        () => g.env.setOption(P.envOption.syncBytes, 1024),
        ...(g.env._debugStartWriter ? [() => g.env._debugStartWriter()] : []),
    ];
}

function checkReusable(g, kind, succeeded = false) {
    if (kind === "open" && !succeeded) g.env.openSync(g.options);
    if (kind === "close" && succeeded) g.env.openSync(g.options);
    const txn = g.env.startRead();
    txn.abort();
    g.env.setOption(P.envOption.syncBytes, 0);
    g.env.closeSync();
    assert.equal(g.env.close(), undefined);
    g.env.openSync(g.options);
    g.env.closeSync();
}

async function deleted(name) {
    await waitFor(() => hooks.state(name)?.deleted === 1, `${name} delete`);
    const value = hooks.state(name);
    assert.equal(value.deleted, 1);
    assert.equal(value.timedOut, false);
    return value;
}

function assertSnapshot(g, backupPath, expected, count = g.count) {
    const backup = new MDBX_Env();
    backup.openSync({ path: backupPath, flags: P.envFlag.rdonly | P.envFlag.nostickythreads });
    const txn = backup.startRead();
    try {
        const dbi = txn.openMap();
        assert.equal(dbi.keys(txn).length, count);
        for (let index = 0; index < g.count; ++index) {
            const value = dbi.get(txn, Buffer.from(`key-${index}`));
            assert.ok(value.equals(Buffer.alloc(value.length, expected)), `snapshot key-${index}`);
        }
    } finally {
        txn.abort();
        backup.closeSync();
    }
}

async function basicCopy(g, flags) {
    const target = destination(g);
    const promise = call("copy", g, flags, target.dest);
    const oldRead = g.env.startRead();
    assert.equal(g.dbi.get(oldRead, Buffer.from("key-0"))[0], 1);
    const txn = g.env.startWrite();
    for (let index = 0; index < g.count; ++index)
        g.dbi.put(txn, Buffer.from(`key-${index}`), Buffer.alloc(32, 2));
    txn.commit();
    for (let index = 0; index < 3; ++index) {
        assert.throws(() => call("copy", g, flags, target.dest), /operation in progress/);
        assert.throws(() => g.env.copyToSync(target.dest, flags), /operation in progress/);
        assert.throws(() => g.env.setOption(P.envOption.syncBytes, 1), /operation in progress/);
        assert.throws(() => g.env.close(), /active transactions/);
        assert.throws(() => g.env.closeSync(), /transaction in progress/);
    }
    assert.throws(() => g.env.open(g.options), /already opened/);
    assert.throws(() => g.env.openSync(g.options), /already opened/);
    assert.equal(typeof g.env.version(), "string");
    assert.ok([0, -1].includes(g.env.syncEx(true, false)));
    const query = call("query", g);
    const keys = call("keys", g);
    await Promise.all([promise, query, keys]);
    assert.throws(() => g.env.close(), /active transactions/);
    // The snapshot time belongs to native copy, not to its JS invocation.
    const backup = new MDBX_Env();
    backup.openSync({ path: target.dest, flags: P.envFlag.rdonly | P.envFlag.nostickythreads });
    const read = backup.startRead();
    const generation = read.openMap().get(read, Buffer.from("key-0"))[0];
    read.abort();
    backup.closeSync();
    assert.ok([1, 2].includes(generation));
    assertSnapshot(g, target.dest, generation);
    oldRead.abort();
    g.env.closeSync();
}

async function testCase(input, root) {
    const name = "subject";
    if (input.type === "exceptions") {
        const g = graph(root, { unopened: true });
        assert.throws(() => g.env.copyTo("unused"), /closed/);
        assert.throws(() => g.env.setOption(P.envOption.syncBytes, 1), /closed/);
        assert.throws(() => g.env.syncEx(true, false), /closed/);
        if (g.env._debugStartWriter) assert.throws(() => g.env._debugStartWriter(), /closed/);
        assert.equal(g.env.close(), undefined);
        g.env.openSync(g.options);
        assert.throws(() => g.env.syncEx(1, false), TypeError);
        assert.throws(() => g.env.setOption("bad", 1), TypeError);
        assert.throws(() => g.env.setOption(P.envOption.syncBytes, -1n), TypeError);
        assert.throws(() => g.env.setOption(P.envOption.syncPeriod, "bad"), TypeError);
        for (const value of [-1, NaN, Infinity, 65536])
            assert.throws(() => g.env.setOption(P.envOption.syncPeriod, value), RangeError);
        g.env.setOption(P.envOption.syncPeriod, 0.1);
        await assert.rejects(g.env.copyTo(path.join(root, "missing", "backup")));
        const target = destination(g);
        await g.env.copyTo(target.dest);
        g.env.closeSync();
        return;
    }
    if (input.type === "worker") return workerCase(input, root);
    const g = graph(root, { unopened: input.op === "open", nosync: input.nosync, large: input.type === "io" });
    try {
        if (input.type === "basic") return await basicCopy(g, input.flags);
        if (input.type === "busy") {
            hooks.arm(name, { gate: true });
            const promise = call(input.op, g);
            for (let repeat = 0; repeat < 3; ++repeat)
                for (const operation of busyCalls(g)) assert.throws(operation, /operation in progress/);
            assert.equal(typeof g.env.version(), "string");
            if (g.env._debugWriterState) assert.equal(g.env._debugWriterState().phase, "idle");
            assert.throws(() => g.env.syncEx(1, false), TypeError);
            await waitFor(() => hooks.state(name).entered, "busy gate");
            hooks.release(name);
            await promise;
            await deleted(name);
            checkReusable(g, input.op, true);
        } else if (input.type === "fault") {
            hooks.arm(name, { fault: input.fault });
            assert.throws(() => call(input.op, g), Error);
            const stats = hooks.state(name);
            assert.equal(stats.executed, 0);
            assert.equal(stats.queued, 0);
            assert.equal(stats.deleted, input.fault === "create" ? 0 : 1);
            checkReusable(g, input.op);
        } else if (input.type === "native-error") {
            hooks.arm(name, { nativeError: true });
            await assert.rejects(call(input.op, g), /injected native error/);
            const stats = await deleted(name);
            assert.equal(stats.executed, 1);
            checkReusable(g, input.op);
        } else if (input.type === "cancel") {
            if (input.cancel === "queued") {
                hooks.blockPool("pool");
                await waitFor(() => hooks.state("pool").entered, "pool gate");
            }
            hooks.arm(name, { cancel: input.cancel });
            const promise = call(input.op, g);
            assert.equal(hooks.state(name).cancelStatus, input.cancel === "queued" ? hooks.ok : hooks.genericFailure);
            if (input.cancel === "queued") {
                hooks.release("pool");
                // Cancelled work never settles its Promise; wait for native cleanup.
            } else await promise;
            const stats = await deleted(name);
            assert.equal(stats.executed, input.cancel === "queued" ? 0 : 1);
            assert.equal(stats.cancelled, input.cancel === "queued" ? 1 : 0);
            checkReusable(g, input.op, input.cancel === "running");
        } else if (input.type === "io") {
            const target = destination(g);
            hooks.arm(name, { ioPath: target.file, portable: input.flags === P.copyFlag.defaults });
            const copy = call("copy", g, input.flags, target.dest);
            await waitFor(() => hooks.state(name).ioEntered, "target write");
            assert.throws(() => g.env.closeSync(), /transaction in progress/);
            const before = g.env.startRead();
            const write = g.env.startWrite();
            for (let index = 0; index < g.count; ++index)
                g.dbi.put(write, Buffer.from(`key-${index}`), Buffer.alloc(4096, 2));
            write.checkpoint();
            write.commitAndStartRead();
            const transitioned = write;
            for (const force of [false, true]) assert.ok([0, -1].includes(g.env.syncEx(force, false)));
            assert.ok([0, -1].includes(g.env.syncEx(false, true)));
            const cursor = transitioned.openCursor(g.dbi);
            assert.equal(cursor.first().value[0], 2);
            cursor.close();
            const qRead = await call("query", g);
            assert.equal(qRead[0].value[0], 2);
            await g.env.query({ dbi: g.dbi, mode: P.queryMode.upsert, item: [{ key: "extra", value: Buffer.alloc(32, 2) }] });
            await call("keys", g);
            assert.equal(g.dbi.get(before, Buffer.from("key-0"))[0], 1);
            before.abort();
            transitioned.abort();
            hooks.release(name);
            await copy;
            await deleted(name);
            assertSnapshot(g, target.dest, 1);
        } else if (input.type === "counter") {
            hooks.arm("copy", { gate: true });
            const copy = call("copy", g);
            const read = g.env.startRead();
            hooks.arm("query", { gate: true });
            const query = call("query", g);
            hooks.arm("keys", { gate: true });
            const keys = call("keys", g);
            await waitFor(() => ["copy", "query", "keys"].every((id) => hooks.state(id).entered), "three work gates");
            hooks.release("copy");
            await copy;
            assert.throws(() => g.env.closeSync(), /transaction in progress/);
            read.abort();
            hooks.release("query");
            await query;
            assert.throws(() => g.env.closeSync(), /transaction in progress/);
            hooks.release("keys");
            await keys;
            await g.env.close();
        } else if (input.type === "reentrant") {
            let init = 0;
            const hook = createHook({ init(_id, type) {
                if (type !== "generic") return;
                ++init;
                assert.throws(() => g.env.startRead(), /operation in progress/);
                assert.equal(typeof g.env.version(), "string");
            } });
            hook.enable();
            let promise;
            try { promise = call(input.op, g); } finally { hook.disable(); }
            await promise;
            assert.equal(init, 1);
            checkReusable(g, input.op, true);
        } else if (input.type === "publication") {
            const error = new Promise((resolve) => process.once("uncaughtException", resolve));
            hooks.arm(name, { publishError: true, nativeError: input.error });
            call(input.op, g).catch(() => {});
            assert.ok(await error instanceof Error);
            const stats = await deleted(name);
            assert.equal(stats.publicationFailures, 1);
            checkReusable(g, input.op, !input.error);
        }
    } finally {
        if (hooks) for (const id of [name, "copy", "query", "keys"]) hooks.release(id);
        // A failed assertion may intentionally leave transactions/work active;
        // preserve that original failure instead of replacing it with close.
        try { g.env?.closeSync(); } catch {}
    }
}

function startGc(root, op, afterCopy) {
    const g = graph(root, { unopened: op === "open" });
    const weak = new WeakRef(g.env);
    let copy;
    if (afterCopy) copy = call("copy", g);
    hooks.arm("gc", { gate: true });
    const promise = call(op, g);
    return { weak, promise, copy };
}

async function gcCase(input, root) {
    assert.equal(typeof global.gc, "function");
    const handle = startGc(root, input.op, input.afterCopy);
    if (handle.copy) await handle.copy;
    await waitFor(() => hooks.state("gc").entered, "GC gate");
    for (let index = 0; index < 8; ++index) {
        await new Promise((resolve) => setImmediate(resolve));
        global.gc();
        assert.ok(handle.weak.deref(), "receiver must retain owner");
    }
    hooks.release("gc");
    await handle.promise;
    await deleted("gc");
    await waitFor(() => {
        global.gc();
        return !handle.weak.deref();
    }, "owner GC after cleanup");
}

async function victim() {
    const { input, root } = workerData;
    const g = graph(root, { unopened: input.op === "open", large: input.io });
    const options = { gate: input.stage === "running", nativeError: input.error };
    let dest;
    if (input.io) {
        const target = destination(g);
        dest = target.dest;
        options.gate = false;
        options.ioPath = target.file;
        options.portable = input.flags === P.copyFlag.defaults;
    }
    hooks.arm("victim", options);
    call(input.op, g, input.flags, dest).catch(() => {});
    parentPort.postMessage("queued");
    parentPort.close();
}

async function workerCase(input, root) {
    if (input.stage === "queued") {
        hooks.blockPool("pool");
        await waitFor(() => hooks.state("pool").entered, "worker pool gate");
    }
    const worker = new Worker(__filename, { workerData: { input, root } });
    await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", (code) => reject(new Error(`victim exited early: ${code}`)));
    });
    if (input.stage === "running")
        await waitFor(() => hooks.state("victim")?.entered, "victim native gate");
    else assert.equal(hooks.state("victim").executed, 0);
    const terminated = worker.terminate();
    // A failed native settlement/throw is the oracle that cleanup forbids JS;
    // query/keys may fail while building the result, before Resolve is reached.
    const timer = setTimeout(() => hooks.release(input.stage === "queued" ? "pool" : "victim"), 100);
    try { await terminated; } finally { clearTimeout(timer); }
    const stats = await deleted("victim");
    assert.equal(stats.executed, 1);
    assert.equal(stats.completed, 1);
    assert.ok(stats.publicationFailures + stats.throwFailures > 0);
}

async function child(input) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-copy-"));
    try {
        if (input.type === "gc") await gcCase(input, root);
        else await testCase(input, root);
        process.stdout.write(JSON.stringify({ case: input, node: process.version, passed: true }) + "\n");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

if (!isMainThread) {
    victim().catch((error) => { throw error; });
} else if (process.argv[2] === "--case") {
    child(JSON.parse(process.argv[3])).catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
} else {
    const test = require("node:test");
    if (process.argv.includes("--native")) assert.ok(hooks, "build with MDBXMOU_COPY_TESTING=ON");
    const cases = [{ type: "exceptions" }];
    for (const flags of [P.copyFlag.defaults, P.copyFlag.compact])
        for (const nosync of [false, true]) cases.push({ type: "basic", flags, nosync });
    if (hooks) {
        for (const op of ["open", "close"]) cases.push({ type: "busy", op });
        for (const op of operations) {
            for (const fault of ["create", "promise", "receiver", "queue"])
                cases.push({ type: "fault", op, fault });
            cases.push({ type: "native-error", op });
            for (const cancel of ["queued", "running"]) cases.push({ type: "cancel", op, cancel });
            cases.push({ type: "gc", op }, { type: "reentrant", op });
            for (const error of [false, true]) {
                cases.push({ type: "publication", op, error });
                for (const stage of ["queued", "running"]) cases.push({ type: "worker", op, error, stage });
            }
        }
        cases.push({ type: "counter" });
        for (const op of ["query", "keys"]) cases.push({ type: "gc", op, afterCopy: true });
        for (const flags of [P.copyFlag.defaults, P.copyFlag.compact]) {
            for (const nosync of [false, true]) cases.push({ type: "io", flags, nosync });
            cases.push({ type: "worker", op: "copy", stage: "running", flags, io: true, error: false });
        }
    }
    for (const input of cases) test(JSON.stringify(input), () => {
        const env = { ...process.env, UV_THREADPOOL_SIZE: input.cancel === "queued" || input.stage === "queued" ? "1" : "4" };
        const result = spawnSync(process.execPath, ["--expose-gc", __filename, "--case", JSON.stringify(input)], {
            env, encoding: "utf8", timeout: 30_000,
        });
        if (result.error) throw result.error;
        assert.equal(result.status, 0, `signal=${result.signal}\n${result.stdout}${result.stderr}`);
        assert.ok(result.stdout.includes('"passed":true'));
    });
}
