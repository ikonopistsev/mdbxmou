"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHook } = require("node:async_hooks");
const { performance } = require("node:perf_hooks");
const { MDBX_Env, MDBX_Param: P } = require("../lib/nativemou.js");

const warmupPairs = 10;
const measuredPairs = 100;
const itemsPerMap = 3000;
const databaseParent = process.env.MDBXMOU_BENCHMARK_DIR || os.tmpdir();
const root = fs.mkdtempSync(path.join(databaseParent, "mdbxmou-query-result-bench-"));
let measurement;

const hook = createHook({
    init(id, type) {
        if (measurement?.scheduling && type !== "PROMISE") {
            measurement.resources.push({ id, type });
        }
    },
    before(id) {
        if (id === measurement?.workId) measurement.callbackStart = performance.now();
    },
    after(id) {
        if (id === measurement?.workId) {
            measurement.completionMs = performance.now() - measurement.callbackStart;
        }
    },
});

const items = [220, 30].map((size) => Array.from({ length: itemsPerMap }, (_, index) => {
    const key = Buffer.alloc(8);
    key.writeBigUInt64BE(BigInt(index));
    return { key, value: Buffer.alloc(size) };
}));

function createContext(name) {
    const env = new MDBX_Env();
    try {
        env.openSync({ path: path.join(root, name), maxDbi: 4 });
        const txn = env.startWrite();
        let maps;
        try {
            maps = [txn.createMap("large"), txn.createMap("small")];
            txn.commit();
        } finally {
            if (txn.isActive()) txn.abort();
        }
        return { env, maps, samples: [] };
    } catch (error) {
        env.closeSync();
        throw error;
    }
}

function verifyData(context) {
    const txn = context.env.startRead();
    try {
        for (const [mapIndex, dbi] of context.maps.entries()) {
            let index = 0;
            dbi.forEach(txn, (key, value) => {
                const expected = items[mapIndex][index++];
                assert.ok(key.equals(expected.key) && value.equals(expected.value));
            });
            assert.equal(index, itemsPerMap);
        }
    } finally {
        txn.abort();
    }
}

async function measure(context, result) {
    const requests = context.maps.map((dbi, index) => ({
        dbi, mode: P.queryMode.upsert, result, item: items[index],
    }));
    const state = { scheduling: true, resources: [], workId: null };
    measurement = state;
    const start = performance.now();
    let promise;
    let prepared;
    try {
        promise = context.env.query(requests);
        prepared = performance.now();
    } finally {
        state.scheduling = false;
    }
    // Controlled literal input creates only the native work resource besides
    // promises. Reject measurements that cannot identify exactly one resource.
    // Always await queued work before closing the environment on failure.
    if (state.resources.length === 1) state.workId = state.resources[0].id;
    const returned = await promise;
    const settled = performance.now();
    assert.equal(state.resources.length, 1, JSON.stringify(state.resources));
    assert.ok(Number.isFinite(state.callbackStart) && Number.isFinite(state.completionMs),
        "native completion before/after hooks were not observed");
    if (result) {
        assert.deepEqual(returned, items);
    } else {
        assert.deepEqual(returned, [undefined, undefined]);
        assert.ok(Object.hasOwn(returned, 0) && Object.hasOwn(returned, 1));
    }
    measurement = undefined;
    verifyData(context);
    return {
        preparationMs: prepared - start,
        completionMs: state.completionMs,
        totalMs: settled - start,
        resourceType: state.resources[0].type,
    };
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

(async () => {
    const contexts = [];
    try {
        contexts.push(createContext("with-result"));
        contexts.push(createContext("without-result"));
        hook.enable();
        for (let pair = 0; pair < warmupPairs + measuredPairs; ++pair) {
            // Each pair writes identical changed values to both environments.
            // This avoids benchmarking repeated no-op durable commits.
            for (const rows of items) for (const item of rows) item.value.fill((pair + 1) % 251);
            const order = pair % 2 ? [1, 0] : [0, 1];
            for (const index of order) {
                const sample = await measure(contexts[index], index === 0);
                if (pair >= warmupPairs) contexts[index].samples.push(sample);
            }
        }
        hook.disable();
        const results = contexts.map((context, index) => ({
            result: index === 0,
            samples: context.samples.length,
            medianMs: Object.fromEntries(["preparationMs", "completionMs", "totalMs"].map((key) =>
                [key, median(context.samples.map((sample) => sample[key]))])),
            resourceTypes: [...new Set(context.samples.map((sample) => sample.resourceType))],
            rawSamples: context.samples,
        }));
        console.log(JSON.stringify({
            environment: {
                node: process.version, packageVersion: require("../package.json").version,
                libmdbx: JSON.parse(fs.readFileSync(path.join(__dirname, "../deps/libmdbx/VERSION.json"), "utf8")).semver,
                os: `${os.platform()} ${os.release()} ${os.arch()}`,
                cpu: os.cpus()[0]?.model,
                filesystemType: `0x${fs.statfsSync(root).type.toString(16)}`,
                databaseParent,
                build: "Release without native test hooks",
                durability: "default env flags; no safeNosync/utterlyNosync",
            },
            methodology: {
                warmupPairs, measuredPairs, itemsPerMap, valueSizes: [220, 30],
                order: "alternate true/false first on every pair",
                completion: "async_hooks before/after native worker callback, including C++ Destroy, excluding Promise continuations",
                overhead: "identical async_hooks instrumentation on both variants",
                verification: "every committed key and value checked outside timed regions",
            },
            results,
        }, null, 2));
    } finally {
        hook.disable();
        measurement = undefined;
        for (const context of contexts) context.env.closeSync();
        fs.rmSync(root, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
