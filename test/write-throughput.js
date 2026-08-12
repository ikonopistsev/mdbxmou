"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const projectRoot = path.resolve(__dirname, "..");
const durationMs = readPositiveNumber("BENCH_DURATION_MS", 10_000);
const warmupMs = readPositiveNumber("BENCH_WARMUP_MS", 1_000);
const batchSizes = readBatchSizes();
const pageSize = readPositiveNumber("BENCH_PAGE_SIZE", 4_096);
const mapSize = readPositiveNumber("BENCH_MAP_SIZE", 4 * 1024 ** 3);
const databaseRoot = process.env.BENCH_ROOT ?? os.tmpdir();

const { MDBX_Env, MDBX_Param } = require(
    path.join(projectRoot, "lib", "nativemou.js"),
);

const { envFlag, keyMode, queryMode } = MDBX_Param;
const flags =
    envFlag.exclusive |
    envFlag.writemap |
    envFlag.nomeminit |
    envFlag.utterlyNosync;

function readPositiveNumber(name, fallback) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} must be positive`);
    }
    return value;
}

function readBatchSizes() {
    const values = (process.env.BENCH_BATCH_SIZES ??
        "50,100,150,200,250,300,350")
        .split(",")
        .map((value) => Number(value.trim()));
    if (
        values.length === 0 ||
        values.some((value) => !Number.isSafeInteger(value) || value <= 0)
    ) {
        throw new Error("BENCH_BATCH_SIZES must contain positive integers");
    }
    return values;
}

function writeUntil(
    environment,
    database,
    firstValue,
    runMs,
    mode,
    batchSize,
    checkpointTransaction,
) {
    const started = performance.now();
    const deadline = started + runMs;
    const encodedValue = Buffer.allocUnsafe(8);
    let value = firstValue;
    let transactions = 0;
    let writeTransaction = checkpointTransaction;

    do {
        if (mode === "commit") {
            writeTransaction = environment.startWrite();
        }
        for (let offset = 0; offset < batchSize; ++offset) {
            encodedValue.writeDoubleLE(value, 0);
            database.put(writeTransaction, value, encodedValue);
            ++value;
        }
        if (mode === "commit") {
            writeTransaction.commit();
        } else {
            assert.equal(writeTransaction.checkpoint(), false);
        }
        ++transactions;
    } while (performance.now() < deadline);

    const elapsedMs = performance.now() - started;
    return {
        elapsedMs,
        nextValue: value,
        writes: value - firstValue,
        transactions,
    };
}

async function writeUntilQuery(
    environment,
    database,
    firstValue,
    runMs,
    batchSize,
) {
    const items = Array.from({ length: batchSize }, () => ({
        key: 0,
        value: Buffer.allocUnsafe(8),
    }));
    const request = {
        dbi: database,
        mode: queryMode.upsert,
        item: items,
    };
    const started = performance.now();
    const deadline = started + runMs;
    let value = firstValue;
    let transactions = 0;

    do {
        for (const item of items) {
            item.key = value;
            item.value.writeDoubleLE(value, 0);
            ++value;
        }
        const result = await environment.query(request);
        assert.equal(result.length, batchSize);
        ++transactions;
    } while (performance.now() < deadline);

    const elapsedMs = performance.now() - started;
    return {
        elapsedMs,
        nextValue: value,
        writes: value - firstValue,
        transactions,
    };
}

async function runMode(mode, batchSize) {
    const dbPath = fs.mkdtempSync(
        path.join(databaseRoot, `mdbxmou-${mode}-bench-`),
    );
    const environment = new MDBX_Env();
    let opened = false;

    try {
        environment.openSync({
            path: dbPath,
            flags,
            maxDbi: 2,
            maxReaders: 2,
            geometry: {
                sizeNow: mapSize,
                sizeUpper: mapSize,
                growthStep: 0,
                shrinkThreshold: 0,
                pageSize,
            },
            trackBorrowedViews: false,
        });
        opened = true;

        const setupTransaction = environment.startWrite();
        const database = setupTransaction.createMap("numbers", keyMode.ordinal);
        setupTransaction.commit();

        const checkpointTransaction =
            mode === "checkpoint" ? environment.startWrite() : undefined;
        const warmup =
            mode === "query"
                ? await writeUntilQuery(
                      environment,
                      database,
                      0,
                      warmupMs,
                      batchSize,
                  )
                : writeUntil(
                      environment,
                      database,
                      0,
                      warmupMs,
                      mode,
                      batchSize,
                      checkpointTransaction,
                  );
        const measured =
            mode === "query"
                ? await writeUntilQuery(
                      environment,
                      database,
                      warmup.nextValue,
                      durationMs,
                      batchSize,
                  )
                : writeUntil(
                      environment,
                      database,
                      warmup.nextValue,
                      durationMs,
                      mode,
                      batchSize,
                      checkpointTransaction,
                  );
        checkpointTransaction?.abort();

        const readTransaction = environment.startRead();
        const entries = database.stat(readTransaction).entries;
        const lastValue = database.get(
            readTransaction,
            measured.nextValue - 1,
        );
        readTransaction.commit();
        assert.equal(entries, measured.nextValue);
        assert.notEqual(lastValue, undefined);
        assert.equal(lastValue.readDoubleLE(0), measured.nextValue - 1);

        return {
            mode,
            batchSize,
            durationSeconds: measured.elapsedMs / 1_000,
            writes: measured.writes,
            writesPerSecond: measured.writes / (measured.elapsedMs / 1_000),
            transactions: measured.transactions,
            transactionsPerSecond:
                measured.transactions / (measured.elapsedMs / 1_000),
        };
    } finally {
        if (opened) environment.closeSync();
        fs.rmSync(dbPath, { recursive: true, force: true });
    }
}

async function main() {
    process.stdout.write(
        `root=${databaseRoot} flags=0x${(flags >>> 0).toString(16)} ` +
            `map=${mapSize} page=${pageSize}\n`,
    );

    const results = [];
    for (const batchSize of batchSizes) {
        for (const mode of ["commit", "checkpoint", "query"]) {
            const result = await runMode(mode, batchSize);
            results.push(result);
            const operation =
                mode === "commit"
                    ? "transactions"
                    : mode === "checkpoint"
                      ? "checkpoints"
                      : "queries";
            process.stdout.write(
                `batch=${batchSize} ${mode}: ` +
                    `${result.writesPerSecond.toFixed(0)} writes/sec, ` +
                    `${result.transactionsPerSecond.toFixed(0)} ` +
                    `${operation}/sec (${result.writes} writes in ` +
                    `${result.durationSeconds.toFixed(3)} s)\n`,
            );
        }
    }

    process.stdout.write("\nsummary\n");
    process.stdout.write(
        "batch\tcommit writes/s\tcommit tx/s\tcheckpoint writes/s\t" +
            "checkpoint/s\tquery writes/s\tquery/s\n",
    );
    for (const batchSize of batchSizes) {
        const find = (mode) =>
            results.find(
                (result) =>
                    result.batchSize === batchSize && result.mode === mode,
            );
        const committed = find("commit");
        const checkpointed = find("checkpoint");
        const queried = find("query");
        process.stdout.write(
            `${batchSize}\t${committed.writesPerSecond.toFixed(0)}\t` +
                `${committed.transactionsPerSecond.toFixed(0)}\t` +
                `${checkpointed.writesPerSecond.toFixed(0)}\t` +
                `${checkpointed.transactionsPerSecond.toFixed(0)}\t` +
                `${queried.writesPerSecond.toFixed(0)}\t` +
                `${queried.transactionsPerSecond.toFixed(0)}\n`,
        );
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
