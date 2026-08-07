"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");

function createEnvironment(options = {}) {
    const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-stage3-"));
    const env = new MDBX_Env();
    env.openSync({ path: dbPath, maxDbi: 8, ...options });
    return { dbPath, env };
}

function closeEnvironment(fixture) {
    if (!fixture) return;
    try {
        fixture.env.closeSync();
    } catch {
        // The assertion that failed owns the useful error.
    } finally {
        fs.rmSync(fixture.dbPath, { recursive: true, force: true });
    }
}

function bytes(view) {
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function assertStandardView(view) {
    assert.equal(view instanceof DataView, true);
    assert.equal(Object.getPrototypeOf(view), DataView.prototype);
}

function assertDetached(view) {
    assert.equal(view.buffer.byteLength, 0);
    assert.throws(() => view.getUint8(0), TypeError);
}

function makePayload(size, seed) {
    const payload = Buffer.allocUnsafe(size);
    for (let i = 0; i < size; ++i) {
        payload[i] = (i * 31 + seed) % 251;
    }
    return payload;
}

test("getView returns raw bytes and leaves copied get values owned", () => {
    const fixture = createEnvironment({
        valueFlag: MDBX_Param.valueFlag.string,
    });
    try {
        const writeTxn = fixture.env.startWrite();
        const dbi = writeTxn.createMap();
        dbi.put(writeTxn, "value", "raw-value");
        writeTxn.commit();

        const readTxn = fixture.env.startRead();
        const copied = dbi.get(readTxn, "value");
        const view = dbi.getView(readTxn, "value");

        assert.equal(copied, "raw-value");
        assertStandardView(view);
        assert.deepEqual(Buffer.from(bytes(view)), Buffer.from("raw-value"));
        assert.equal(readTxn._debugViewStats().issued, 1);

        readTxn.abort();

        assert.equal(copied, "raw-value");
        assertDetached(view);
    } finally {
        closeEnvironment(fixture);
    }
});

test("getView reads overflow values from 4 KiB through 8 MiB", () => {
    const fixture = createEnvironment();
    try {
        const sizes = [4 * 1024, 64 * 1024, 1024 * 1024, 8 * 1024 * 1024];
        const payloads = sizes.map((size, index) =>
            makePayload(size, index + 7),
        );
        const writeTxn = fixture.env.startWrite();
        const dbi = writeTxn.createMap();
        for (let i = 0; i < sizes.length; ++i) {
            dbi.put(writeTxn, `value-${sizes[i]}`, payloads[i]);
        }
        writeTxn.commit();

        const readTxn = fixture.env.startRead();
        const views = sizes.map((size, index) => {
            const view = dbi.getView(readTxn, `value-${size}`);
            const raw = bytes(view);
            const payload = payloads[index];

            assertStandardView(view);
            assert.equal(view.byteLength, size);
            for (const offset of [0, Math.floor(size / 2), size - 1]) {
                assert.equal(raw[offset], payload[offset]);
            }
            return view;
        });

        assert.equal(readTxn._debugViewStats().issued, sizes.length);
        readTxn.abort();
        for (const view of views) assertDetached(view);
    } finally {
        closeEnvironment(fixture);
    }
});

test("missing and empty values preserve their distinct results", () => {
    const fixture = createEnvironment();
    try {
        const writeTxn = fixture.env.startWrite();
        const dbi = writeTxn.createMap();
        dbi.put(writeTxn, "empty", Buffer.alloc(0));
        writeTxn.commit();

        const readTxn = fixture.env.startRead();
        const empty = dbi.getView(readTxn, "empty");

        assert.equal(dbi.getView(readTxn, "missing"), undefined);
        assertStandardView(empty);
        assert.equal(empty.byteLength, 0);
        assert.equal(readTxn._debugViewStats().issued, 0);

        readTxn.abort();
        assert.equal(empty.buffer.byteLength, 0);
    } finally {
        closeEnvironment(fixture);
    }
});

test("DUPSORT getView returns the first raw ordinal value", () => {
    const fixture = createEnvironment();
    try {
        const writeTxn = fixture.env.startWrite();
        const dbi = writeTxn.createMap(
            "duplicates",
            MDBX_Param.keyMode.ordinal,
            MDBX_Param.valueMode.multiOrdinal,
        );
        dbi.put(writeTxn, 7, 20);
        dbi.put(writeTxn, 7, 10);
        writeTxn.commit();

        const readTxn = fixture.env.startRead();
        const view = dbi.getView(readTxn, 7);

        assert.equal(dbi.get(readTxn, 7), 10);
        assert.equal(view.byteLength, BigUint64Array.BYTES_PER_ELEMENT);
        assert.equal(view.getBigUint64(0, true), 10n);

        readTxn.abort();
        assertDetached(view);
    } finally {
        closeEnvironment(fixture);
    }
});

test("getView validates transaction state and kind before lookup", () => {
    const fixture = createEnvironment();
    try {
        const setupTxn = fixture.env.startWrite();
        const dbi = setupTxn.createMap();
        dbi.put(setupTxn, "value", Buffer.from([1]));
        setupTxn.commit();

        assert.throws(
            () => dbi.getView({}, "value"),
            (error) =>
                error instanceof TypeError &&
                /argument must be MDBX_Txn instance/.test(error.message),
        );

        const writeTxn = fixture.env.startWrite();
        assert.throws(
            () => dbi.getView(writeTxn, "missing"),
            (error) =>
                error instanceof TypeError &&
                error.message === "getView: read-only transaction required",
        );
        writeTxn.abort();

        const completedTxn = fixture.env.startRead();
        completedTxn.abort();
        assert.throws(
            () => dbi.getView(completedTxn, "value"),
            /getView: txn already completed/,
        );
    } finally {
        closeEnvironment(fixture);
    }
});

test("getView rejects trapped and prototype-spoofed transaction objects", () => {
    const probe = path.join(
        __dirname,
        "stage3",
        "transaction-argument-safety.js",
    );

    for (const scenario of ["revoked-proxy", "prototype-spoof"]) {
        const result = spawnSync(process.execPath, [probe, scenario], {
            encoding: "utf8",
        });
        assert.equal(
            result.status,
            0,
            `${scenario} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        );
    }
});

test("getView rejects read transactions in a WRITEMAP environment", () => {
    const fixture = createEnvironment({
        flags: MDBX_Param.envFlag.writemap,
    });
    try {
        const writeTxn = fixture.env.startWrite();
        const dbi = writeTxn.createMap();
        dbi.put(writeTxn, "value", Buffer.from([1, 2, 3]));
        writeTxn.commit();

        const readTxn = fixture.env.startRead();
        assert.throws(
            () => dbi.getView(readTxn, "missing"),
            /getView: MDBX_WRITEMAP is not supported/,
        );
        assert.equal(readTxn._debugViewStats().issued, 0);
        readTxn.abort();
    } finally {
        closeEnvironment(fixture);
    }
});

test("getView remains available in a read-only environment", () => {
    const fixture = createEnvironment();
    const dbPath = fixture.dbPath;
    try {
        const writeTxn = fixture.env.startWrite();
        const dbi = writeTxn.createMap();
        dbi.put(writeTxn, "value", Buffer.from([0x41, 0x42]));
        writeTxn.commit();
        fixture.env.closeSync();

        const readOnlyEnv = new MDBX_Env();
        fixture.env = readOnlyEnv;
        readOnlyEnv.openSync({
            path: dbPath,
            flags: MDBX_Param.envFlag.rdonly,
        });
        const readTxn = readOnlyEnv.startRead();
        const readOnlyDbi = readTxn.openMap();
        const view = readOnlyDbi.getView(readTxn, "value");

        assert.deepEqual(Array.from(bytes(view)), [0x41, 0x42]);
        readTxn.abort();
        assertDetached(view);
    } finally {
        closeEnvironment(fixture);
    }
});

test("tracking is enabled by default and typo-safe", () => {
    const fixture = createEnvironment({
        trackBorrowedView: false,
        trackBorrowedViews: undefined,
    });
    try {
        const writeTxn = fixture.env.startWrite();
        const dbi = writeTxn.createMap();
        dbi.put(writeTxn, "value", Buffer.from([0x55]));
        writeTxn.commit();

        const readTxn = fixture.env.startRead();
        const view = dbi.getView(readTxn, "value");
        assert.equal(readTxn._debugViewStats().issued, 1);

        readTxn.abort();
        assertDetached(view);
    } finally {
        closeEnvironment(fixture);
    }
});

test("explicit untracked mode is captured at open and creates no refs", () => {
    const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-stage3-"));
    const options = { path: dbPath, trackBorrowedViews: false };
    const env = new MDBX_Env();
    const fixture = { dbPath, env };
    try {
        env.openSync(options);
        options.trackBorrowedViews = true;
        env.trackBorrowedViews = true;

        const writeTxn = env.startWrite();
        const dbi = writeTxn.createMap();
        dbi.put(writeTxn, "value", Buffer.from([0x33]));
        writeTxn.commit();

        const readTxn = env.startRead();
        let view = dbi.getView(readTxn, "value");
        assert.equal(view.getUint8(0), 0x33);
        assert.equal(readTxn._debugViewStats().issued, 0);

        view = undefined;
        readTxn.abort();
        assert.equal(readTxn._debugViewStats().detachCalls, 0);
    } finally {
        closeEnvironment(fixture);
    }
});

test("async environment open captures the same untracked mode", async () => {
    const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-stage3-"));
    const env = new MDBX_Env();
    const fixture = { dbPath, env };
    try {
        await env.open({ path: dbPath, trackBorrowedViews: false });

        const writeTxn = env.startWrite();
        const dbi = writeTxn.createMap();
        dbi.put(writeTxn, "value", Buffer.from([0x77]));
        writeTxn.commit();

        const readTxn = env.startRead();
        let view = dbi.getView(readTxn, "value");
        assert.equal(view.getUint8(0), 0x77);
        assert.equal(readTxn._debugViewStats().issued, 0);

        view = undefined;
        readTxn.abort();
        await env.close();
    } finally {
        closeEnvironment(fixture);
    }
});

test("trackBorrowedViews rejects every explicit non-boolean", () => {
    for (const value of ["false", 0, null, {}]) {
        const dbPath = fs.mkdtempSync(
            path.join(os.tmpdir(), "mdbxmou-stage3-invalid-"),
        );
        const env = new MDBX_Env();
        try {
            assert.throws(
                () =>
                    env.openSync({
                        path: dbPath,
                        trackBorrowedViews: value,
                    }),
                (error) =>
                    error instanceof TypeError &&
                    error.message ===
                        "trackBorrowedViews must be a boolean",
            );
        } finally {
            fs.rmSync(dbPath, { recursive: true, force: true });
        }
    }
});
