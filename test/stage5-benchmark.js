"use strict";

// MDBXMOU-0001-S5-BENCH: reproducible baseline kept outside the regular test suite.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { MDBX_Env } = require("../lib/nativemou.js");

if (typeof global.gc !== "function") {
    throw new Error("stage5-benchmark.js requires --expose-gc");
}

function parseList(name, fallback) {
    const values = (process.env[name] ?? fallback)
        .split(",")
        .map((value) => value.trim());
    if (values.length === 0 || values.some((value) => value.length === 0)) {
        throw new Error(`${name} must be a comma-separated number list`);
    }
    return values.map((value) => {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            throw new Error(`${name} contains a non-number: ${value}`);
        }
        return number;
    });
}

function positiveInteger(name, fallback) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}

const config = {
    sizes: parseList(
        "STAGE5_SIZES",
        "4096,16384,65536,262144,1048576,8388608",
    ),
    samples: positiveInteger("STAGE5_SAMPLES", "5"),
    warmups: positiveInteger("STAGE5_WARMUPS", "1"),
    touchTargetBytes: positiveInteger("STAGE5_TOUCH_TARGET_BYTES", "268435456"),
    checksumTargetBytes: positiveInteger(
        "STAGE5_CHECKSUM_TARGET_BYTES",
        "67108864",
    ),
    lifecycleCounts: parseList("STAGE5_LIFECYCLE_COUNTS", "1,10,1000,100000"),
    retainedFractions: parseList("STAGE5_RETAINED_FRACTIONS", "0,0.01,1"),
    lifecycleSamples: positiveInteger("STAGE5_LIFECYCLE_SAMPLES", "3"),
};

if (config.sizes.length === 0) {
    throw new Error("STAGE5_SIZES must not be empty");
}
for (const size of config.sizes) {
    if (!Number.isSafeInteger(size) || size < 1) {
        throw new Error("STAGE5_SIZES must contain positive integers");
    }
}
for (const count of config.lifecycleCounts) {
    if (!Number.isSafeInteger(count) || count < 1) {
        throw new Error("STAGE5_LIFECYCLE_COUNTS must contain positive integers");
    }
}
if (config.lifecycleCounts.length === 0) {
    throw new Error("STAGE5_LIFECYCLE_COUNTS must not be empty");
}
if (config.retainedFractions.length === 0) {
    throw new Error("STAGE5_RETAINED_FRACTIONS must not be empty");
}
for (const fraction of config.retainedFractions) {
    if (fraction < 0 || fraction > 1) {
        throw new Error("STAGE5_RETAINED_FRACTIONS must be between 0 and 1");
    }
}

function percentile(values, fraction) {
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(
        sorted.length - 1,
        Math.ceil(sorted.length * fraction) - 1,
    );
    return sorted[index];
}

function summarize(values) {
    return {
        min: Math.min(...values),
        p50: percentile(values, 0.5),
        p99: percentile(values, 0.99),
        max: Math.max(...values),
    };
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

function subtract(after, before) {
    return Object.fromEntries(
        Object.keys(before).map((key) => [key, after[key] - before[key]]),
    );
}

async function gcTurns() {
    const started = performance.now();
    for (let index = 0; index < 3; ++index) {
        global.gc();
        await nextTurn();
    }
    return performance.now() - started;
}

function makePayload(size) {
    const value = Buffer.allocUnsafe(size);
    for (let index = 0; index < size; ++index) {
        value[index] = (index * 31 + size) & 0xff;
    }
    return value;
}

function bytesOf(value) {
    if (Buffer.isBuffer(value)) return value;
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function touch8(value) {
    const bytes = bytesOf(value);
    let checksum = 0;
    for (let index = 0; index < 8; ++index) {
        const offset = Math.floor((index * (bytes.length - 1)) / 7);
        checksum = (checksum + bytes[offset]) >>> 0;
    }
    return checksum;
}

function checksum(value) {
    const bytes = bytesOf(value);
    let result = 0;
    for (let index = 0; index < bytes.length; ++index) {
        result = (result + bytes[index]) >>> 0;
    }
    return result;
}

function abortQuietly(txn) {
    try {
        txn.abort();
    } catch {
        // Preserve the original benchmark or setup failure.
    }
}

function openFixture(name, sizes, trackBorrowedViews) {
    const dbPath = fs.mkdtempSync(
        path.join(os.tmpdir(), `mdbxmou-stage5-${name}-`),
    );
    let env;
    let opened = false;
    let txn;

    try {
        env = new MDBX_Env();
        env.openSync({
            path: dbPath,
            maxDbi: sizes.length + 4,
            trackBorrowedViews,
        });
        opened = true;

        txn = env.startWrite();
        const records = new Map();
        for (const size of sizes) {
            const dbi = txn.createMap(`value-${size}`);
            const payload = makePayload(size);
            dbi.put(txn, "value", payload);
            records.set(size, {
                dbi,
                expectedTouch8: touch8(payload),
                expectedChecksum: checksum(payload),
            });
        }
        txn.commit();
        txn = undefined;

        return {
            env,
            records,
            close() {
                let closeError;
                try {
                    env.closeSync();
                } catch (error) {
                    closeError = error;
                }
                try {
                    fs.rmSync(dbPath, { recursive: true, force: true });
                } catch (error) {
                    closeError ??= error;
                }
                if (closeError) throw closeError;
            },
        };
    } catch (error) {
        if (txn) abortQuietly(txn);
        if (opened) {
            try {
                env.closeSync();
            } catch (cleanupError) {
                console.error("fixture environment cleanup failed", cleanupError);
            }
        }
        try {
            fs.rmSync(dbPath, { recursive: true, force: true });
        } catch (cleanupError) {
            console.error("fixture directory cleanup failed", cleanupError);
        }
        throw error;
    }
}

function readValue(mode, dbi, txn) {
    return mode === "get" ? dbi.get(txn, "value") : dbi.getView(txn, "value");
}

function iterationsFor(size, access) {
    const target =
        access === "touch8"
            ? config.touchTargetBytes
            : config.checksumTargetBytes;
    return Math.max(8, Math.min(100_000, Math.floor(target / size)));
}

function runReadSample(fixture, mode, size, access, iterations) {
    const { dbi, expectedTouch8, expectedChecksum } = fixture.records.get(size);
    const consume = access === "touch8" ? touch8 : checksum;
    const expected = access === "touch8" ? expectedTouch8 : expectedChecksum;
    const txn = fixture.env.startRead();
    let completed = false;
    let observed = 0;

    try {
        const started = performance.now();
        for (let index = 0; index < iterations; ++index) {
            const value = readValue(mode, dbi, txn);
            assert(value, `${mode} returned no value`);
            observed = (observed + consume(value)) >>> 0;
        }
        const readMs = performance.now() - started;

        assert.equal(observed, Math.imul(expected, iterations) >>> 0);

        const completionStarted = performance.now();
        txn.abort();
        completed = true;
        const completionMs = performance.now() - completionStarted;

        return { readMs, completionMs };
    } finally {
        if (!completed) abortQuietly(txn);
    }
}

function summarizeReadCase(mode, size, access, iterations, samples) {
    const readMs = samples.map((sample) => sample.readMs);
    const completionMs = samples.map((sample) => sample.completionMs);
    const opsPerSecond = readMs.map((value) => (iterations * 1000) / value);
    const averageReadLatencyUs = readMs.map((value) => (value * 1000) / iterations);
    const consumedBytes = access === "touch8" ? 8 : size;
    const consumedGiBPerSecond = opsPerSecond.map(
        (value) => (value * consumedBytes) / 2 ** 30,
    );
    const payloadGiBPerSecond = opsPerSecond.map(
        (value) => (value * size) / 2 ** 30,
    );

    return {
        mode,
        size,
        access,
        iterations,
        samples: samples.length,
        opsPerSecond: summarize(opsPerSecond),
        averageReadLatencyUs: summarize(averageReadLatencyUs),
        consumedGiBPerSecond: summarize(consumedGiBPerSecond),
        payloadGiBPerSecond: summarize(payloadGiBPerSecond),
        completionMs: summarize(completionMs),
    };
}

async function runThroughput(fixtures) {
    const results = [];
    for (const size of config.sizes) {
        for (const access of ["touch8", "checksum"]) {
            const iterations = iterationsFor(size, access);
            for (const mode of ["get", "getViewTracked", "getViewUntracked"]) {
                const fixture =
                    mode === "getViewUntracked" ? fixtures.untracked : fixtures.tracked;
                for (let index = 0; index < config.warmups; ++index) {
                    runReadSample(
                        fixture,
                        mode === "get" ? "get" : "getView",
                        size,
                        access,
                        iterations,
                    );
                }
                const samples = [];
                for (let index = 0; index < config.samples; ++index) {
                    samples.push(
                        runReadSample(
                            fixture,
                            mode === "get" ? "get" : "getView",
                            size,
                            access,
                            iterations,
                        ),
                    );
                }
                results.push(
                    summarizeReadCase(mode, size, access, iterations, samples),
                );
                await nextTurn();
            }
        }
    }
    return results;
}

function retainedTarget(count, fraction) {
    return Math.min(count, Math.round(count * fraction));
}

function shouldRetain(index, count, target) {
    return (
        Math.floor(((index + 1) * target) / count) >
        Math.floor((index * target) / count)
    );
}

async function runLifecycleSample(fixture, mode, count, retainedFraction) {
    const { dbi, expectedTouch8 } = fixture.records.get(4096);
    await gcTurns();
    const before = memory();
    const txn = fixture.env.startRead();
    const target = retainedTarget(count, retainedFraction);
    let completed = false;
    let retained = [];
    let lastView;
    let observed = 0;

    try {
        const issueStarted = performance.now();
        for (let index = 0; index < count; ++index) {
            lastView = dbi.getView(txn, "value");
            observed = (observed + touch8(lastView)) >>> 0;
            if (shouldRetain(index, count, target)) retained.push(lastView);
        }
        const issueMs = performance.now() - issueStarted;
        assert.equal(observed, Math.imul(expectedTouch8, count) >>> 0);
        assert.equal(retained.length, target);
        const afterIssue = memory();

        const retainedCount = retained.length;
        lastView = undefined;
        if (mode === "untracked") retained = [];
        const gcMs = await gcTurns();
        const afterGc = memory();

        if (mode === "tracked") {
            for (const view of retained) assert.equal(view.byteLength, 4096);
        }

        const completionStarted = performance.now();
        txn.abort();
        completed = true;
        const completionMs = performance.now() - completionStarted;

        if (mode === "tracked") {
            for (const view of retained) assert.equal(view.buffer.byteLength, 0);
        }

        const afterCompletion = memory();
        retained = [];
        await gcTurns();

        return {
            issueMs,
            completionMs,
            gcMs,
            retainedCount,
            retainedFractionAchieved: retainedCount / count,
            memoryDelta: {
                afterIssue: subtract(afterIssue, before),
                afterGc: subtract(afterGc, before),
                afterCompletion: subtract(afterCompletion, before),
            },
        };
    } finally {
        lastView = undefined;
        if (mode === "untracked") retained = [];
        if (!completed) abortQuietly(txn);
    }
}

function medianMemory(samples, point) {
    const keys = Object.keys(samples[0].memoryDelta[point]);
    return Object.fromEntries(
        keys.map((key) => [
            key,
            percentile(
                samples.map((sample) => sample.memoryDelta[point][key]),
                0.5,
            ),
        ]),
    );
}

async function runLifecycle(fixtures) {
    const results = [];
    for (const count of config.lifecycleCounts) {
        for (const retainedFraction of config.retainedFractions) {
            for (const mode of ["tracked", "untracked"]) {
                const samples = [];
                for (let index = 0; index < config.lifecycleSamples; ++index) {
                    samples.push(
                        await runLifecycleSample(
                            fixtures[mode],
                            mode,
                            count,
                            retainedFraction,
                        ),
                    );
                }
                results.push({
                    mode,
                    count,
                    retainedFraction,
                    retainedCount: samples[0].retainedCount,
                    retainedFractionAchieved: samples[0].retainedFractionAchieved,
                    samples: samples.length,
                    issueOpsPerSecond: summarize(
                        samples.map((sample) => (count * 1000) / sample.issueMs),
                    ),
                    completionMs: summarize(
                        samples.map((sample) => sample.completionMs),
                    ),
                    gcMs: summarize(samples.map((sample) => sample.gcMs)),
                    medianMemoryDelta: {
                        afterIssue: medianMemory(samples, "afterIssue"),
                        afterGc: medianMemory(samples, "afterGc"),
                        afterCompletion: medianMemory(samples, "afterCompletion"),
                    },
                });
            }
        }
    }
    return results;
}

function writeResult(result) {
    const json = `${JSON.stringify(result, null, 2)}\n`;
    const output = process.env.STAGE5_OUTPUT;
    if (output) {
        const outputPath = path.resolve(output);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, json);
        console.log(`STAGE5_BENCHMARK_OUTPUT=${outputPath}`);
    } else {
        console.log(`STAGE5_BENCHMARK_JSON=${JSON.stringify(result)}`);
    }
}

async function main() {
    const fixtureSizes = [...new Set([...config.sizes, 4096])];
    const fixtures = {};
    let result;
    let runError;

    try {
        fixtures.tracked = openFixture("tracked", fixtureSizes, true);
        fixtures.untracked = openFixture("untracked", fixtureSizes, false);
        result = {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            environment: {
                node: process.version,
                napi: process.versions.napi,
                platform: process.platform,
                arch: process.arch,
                release: os.release(),
                cpu: os.cpus()[0]?.model ?? "unknown",
                cpuCount: os.cpus().length,
                totalMemory: os.totalmem(),
            },
            config,
            methodology: {
                residency: "warm",
                accessPattern: "single-key repeated point read",
                transaction: "one read transaction per sample",
                timing: "read loop and transaction completion measured separately",
                latency: "percentiles of per-sample average read latency, not per-operation tails",
                gc: "explicit GC runs only in lifecycle cases, not throughput cases",
                correctness: "every sample validates deterministic touch/checksum",
                checksum: "uint32 sum of every byte, not a cryptographic hash",
                tracking: "tracked is the safe default; untracked disables reference tracking and detach",
                retention: "target count is round(count * retainedFraction); achieved fraction is reported",
            },
            throughput: await runThroughput(fixtures),
            lifecycle: await runLifecycle(fixtures),
        };
    } catch (error) {
        runError = error;
    }

    const cleanupErrors = [];
    for (const name of ["untracked", "tracked"]) {
        if (!fixtures[name]) continue;
        try {
            fixtures[name].close();
        } catch (error) {
            cleanupErrors.push(error);
        }
    }

    if (runError) {
        for (const error of cleanupErrors) console.error("cleanup failed", error);
        throw runError;
    }
    if (cleanupErrors.length > 0) {
        throw new AggregateError(cleanupErrors, "benchmark cleanup failed");
    }

    writeResult(result);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
