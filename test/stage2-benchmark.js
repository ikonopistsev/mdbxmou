"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { MDBX_Env } = require("../lib/nativemou.js");

if (typeof global.gc !== "function") {
    throw new Error("stage2-benchmark.js requires --expose-gc");
}

const counts = (process.env.STAGE2_COUNTS ?? "1,1000,100000")
    .split(",")
    .map((value) => Number.parseInt(value, 10));

async function gcTurns() {
    for (let index = 0; index < 3; ++index) {
        global.gc();
        await nextTurn();
    }
}

function memory() {
    const usage = process.memoryUsage();
    return {
        rss: usage.rss,
        heapUsed: usage.heapUsed,
        external: usage.external,
        arrayBuffers: usage.arrayBuffers,
    };
}

function delta(after, before) {
    return Object.fromEntries(
        Object.keys(before).map((key) => [key, after[key] - before[key]]),
    );
}

function issueTracked(txn, dbi, count, retainEvery = 1) {
    const retained = [];
    for (let index = 0; index < count; ++index) {
        const view = txn._debugIssueView(dbi, "value");
        if (index % retainEvery === 0) retained.push(view);
    }
    return retained;
}

function consumeUntracked(txn, dbi, count) {
    let checksum = 0;
    for (let index = 0; index < count; ++index) {
        const view = txn._debugIssueView(dbi, "value", { tracked: false });
        checksum += view.getUint8(0);
    }
    return checksum;
}

async function trackedLive(env, dbi, count) {
    await gcTurns();
    const before = memory();
    const txn = env.startRead();
    const issueStart = performance.now();
    let views = issueTracked(txn, dbi, count);
    const issueMs = performance.now() - issueStart;
    const afterIssue = memory();
    const issued = txn._debugViewStats().issued;
    const detachStart = performance.now();
    txn.abort();
    const detachMs = performance.now() - detachStart;
    if (views.length > 0) assert.equal(views[0].buffer.byteLength, 0);
    const afterCompletion = memory();
    views = null;
    await gcTurns();
    const afterGc = memory();
    return {
        issueMs,
        detachMs,
        issued,
        memoryDelta: {
            afterIssue: delta(afterIssue, before),
            afterCompletion: delta(afterCompletion, before),
            afterGc: delta(afterGc, before),
        },
    };
}

async function untracked(env, dbi, count) {
    await gcTurns();
    const before = memory();
    const txn = env.startRead();
    const issueStart = performance.now();
    const checksum = consumeUntracked(txn, dbi, count);
    const issueMs = performance.now() - issueStart;
    const afterIssue = memory();
    const abortStart = performance.now();
    txn.abort();
    const abortMs = performance.now() - abortStart;
    const afterCompletion = memory();
    await gcTurns();
    const afterGc = memory();
    return {
        issueMs,
        abortMs,
        checksum,
        issued: txn._debugViewStats().issued,
        memoryDelta: {
            afterIssue: delta(afterIssue, before),
            afterCompletion: delta(afterCompletion, before),
            afterGc: delta(afterGc, before),
        },
    };
}

async function manualPrune(env, dbi, count) {
    const txn = env.startRead();
    let views = issueTracked(txn, dbi, count);
    let retained = views.filter((_, index) => index % 16 === 0);
    views = null;
    await gcTurns();
    const before = txn._debugViewStats();
    const pruneStart = performance.now();
    const after = txn._debugPruneViews();
    const pruneMs = performance.now() - pruneStart;
    txn.abort();
    retained = null;
    await gcTurns();
    return { pruneMs, before, after };
}

function thresholdCount(limit) {
    if (limit < 1024) return limit;
    let value = 1024;
    while (value <= Math.floor(limit / 2)) value *= 2;
    return value;
}

async function automaticPrune(env, dbi, limit) {
    const count = thresholdCount(limit);
    const txn = env.startRead();
    let views = issueTracked(txn, dbi, count);
    let retained = views.filter((_, index) => index % 16 === 0);
    views = null;
    await gcTurns();
    const before = txn._debugViewStats();
    const pruneStart = performance.now();
    const trigger = txn._debugIssueView(dbi, "value");
    const pruneMs = performance.now() - pruneStart;
    const after = txn._debugViewStats();
    txn.abort();
    assert.equal(trigger.buffer.byteLength, 0);
    retained = null;
    await gcTurns();
    return { count, pruneMs, before, after };
}

(async () => {
    const dbPath = fs.mkdtempSync(
        path.join(os.tmpdir(), "mdbxmou-stage2-benchmark-"),
    );
    const env = new MDBX_Env();
    env.openSync({ path: dbPath });
    const writeTxn = env.startWrite();
    const dbi = writeTxn.createMap();
    dbi.put(writeTxn, "value", Buffer.alloc(4096, 0x5a));
    writeTxn.commit();

    const results = [];
    for (const count of counts) {
        results.push({
            count,
            trackedLive: await trackedLive(env, dbi, count),
            untracked: await untracked(env, dbi, count),
            manualPrune: await manualPrune(env, dbi, count),
            automaticPrune: await automaticPrune(env, dbi, count),
        });
    }

    env.closeSync();
    fs.rmSync(dbPath, { recursive: true, force: true });
    console.log(
        `STAGE2_BENCHMARK_JSON=${JSON.stringify({
            node: process.version,
            napi: process.versions.napi,
            results,
        })}`,
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
