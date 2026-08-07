"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { MDBX_Env } = require("../lib/nativemou.js");

function createFixture() {
    const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-stage2-"));
    const env = new MDBX_Env();
    env.openSync({ path: dbPath });

    const txn = env.startWrite();
    const dbi = txn.createMap();
    dbi.put(txn, "value", Buffer.from([0x11, 0x22, 0x33, 0x44]));
    dbi.put(txn, "empty", Buffer.alloc(0));
    txn.commit();

    return { dbPath, env, dbi };
}

function closeFixture(fixture) {
    if (!fixture) return;
    try {
        fixture.env.closeSync();
    } catch {
        // The assertion that failed owns the useful error.
    } finally {
        fs.rmSync(fixture.dbPath, { recursive: true, force: true });
    }
}

function assertStandardView(view) {
    assert.equal(view instanceof DataView, true);
    assert.equal(Object.getPrototypeOf(view), DataView.prototype);
}

function assertDetached(view, typedArray) {
    assert.equal(view.buffer.byteLength, 0);
    assert.throws(() => view.getUint8(0), TypeError);
    if (typedArray) assert.equal(typedArray.length, 0);
}

function consumeUntracked(txn, dbi) {
    const view = txn._debugIssueView(dbi, "value", { tracked: false });
    assertStandardView(view);
    assert.deepEqual(
        Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
        [0x11, 0x22, 0x33, 0x44],
    );
}

function runFixture(name) {
    const fixture = path.join(__dirname, "stage2", name);
    const result = childProcess.spawnSync(
        process.execPath,
        ["--expose-gc", fixture],
        { encoding: "utf8", timeout: 30_000 },
    );

    assert.ifError(result.error);
    assert.equal(
        result.status,
        0,
        `fixture ${name} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
}

function runFatalFixture(name, fault) {
    const fixture = path.join(__dirname, "stage2", name);
    const result = childProcess.spawnSync(
        process.execPath,
        ["--expose-gc", fixture, fault],
        { encoding: "utf8", timeout: 30_000 },
    );

    assert.ifError(result.error);
    assert.notEqual(result.status, 0, `${fault} unexpectedly exited cleanly`);
    assert.match(
        result.stderr,
        /FATAL ERROR: mdbxmou::txnmou::detach_issued_noexcept[\s\S]*borrowed views remain attached/,
    );
}

test("test build returns a standard tracked DataView and abort detaches it", () => {
    const fixture = createFixture();
    try {
        const txn = fixture.env.startRead();
        const view = txn._debugIssueView(fixture.dbi, "value");
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

        assertStandardView(view);
        assert.deepEqual(Array.from(bytes), [0x11, 0x22, 0x33, 0x44]);
        assert.equal(txn._debugViewStats().issued, 1);

        txn.abort();

        assertDetached(view, bytes);
        assert.equal(txn._debugViewStats().issued, 0);
        assert.equal(txn._debugViewStats().detachCalls, 1);
    } finally {
        closeFixture(fixture);
    }
});

test("commit detaches every tracked backing ArrayBuffer", () => {
    const fixture = createFixture();
    try {
        const txn = fixture.env.startRead();
        const views = Array.from({ length: 32 }, () =>
            txn._debugIssueView(fixture.dbi, "value"),
        );

        assert.equal(txn._debugViewStats().issued, views.length);
        txn.commit();

        for (const view of views) assertDetached(view);
        assert.equal(txn._debugViewStats().issued, 0);
    } finally {
        closeFixture(fixture);
    }
});

test("open cursor rejects completion without detaching views", () => {
    const fixture = createFixture();
    try {
        const txn = fixture.env.startRead();
        const cursor = txn.openCursor(fixture.dbi);
        const view = txn._debugIssueView(fixture.dbi, "value");

        assert.throws(() => txn.abort(), /cursor\(s\) still open/);
        assert.equal(view.getUint8(0), 0x11);
        assert.equal(view.buffer.byteLength, 4);

        cursor.close();
        txn.abort();
        assertDetached(view);
    } finally {
        closeFixture(fixture);
    }
});

test("zero-length values use an ordinary untracked DataView", () => {
    const fixture = createFixture();
    try {
        const txn = fixture.env.startRead();
        const view = txn._debugIssueView(fixture.dbi, "empty");

        assertStandardView(view);
        assert.equal(view.byteLength, 0);
        assert.equal(view.buffer.byteLength, 0);
        assert.equal(txn._debugViewStats().issued, 0);

        txn.abort();
        assert.equal(view.buffer.byteLength, 0);
    } finally {
        closeFixture(fixture);
    }
});

test("explicit untracked path creates no references", () => {
    const fixture = createFixture();
    try {
        const txn = fixture.env.startRead();
        consumeUntracked(txn, fixture.dbi);
        assert.equal(txn._debugViewStats().issued, 0);

        txn.abort();
        assert.equal(txn._debugViewStats().detachCalls, 0);
    } finally {
        closeFixture(fixture);
    }
});

test("issue faults roll back without returning an untracked view", () => {
    const fixture = createFixture();
    try {
        const txn = fixture.env.startRead();
        const faults = [
            "afterArrayBuffer",
            "afterDataView",
            "afterReference",
            "registryPush",
        ];

        for (const fault of faults) {
            assert.throws(
                () =>
                    txn._debugIssueView(fixture.dbi, "value", {
                        tracked: true,
                        fault,
                    }),
                /fault|failed to store/i,
            );
            assert.equal(txn.isActive(), true);
            assert.equal(txn._debugViewStats().issued, 0);
        }

        const view = txn._debugIssueView(fixture.dbi, "value");
        txn.abort();
        assertDetached(view);
    } finally {
        closeFixture(fixture);
    }
});

for (const fault of [
    "getReference",
    "isDetached",
    "detach",
    "deleteReference",
]) {
    test(`partial ${fault} failure keeps transaction active and retryable`, () => {
        const fixture = createFixture();
        try {
            const txn = fixture.env.startRead();
            const first = txn._debugIssueView(fixture.dbi, "value");
            const second = txn._debugIssueView(fixture.dbi, "value");

            txn._debugFailNextDetach(fault);
            assert.throws(() => txn.abort(), /failed to detach/);
            assert.equal(txn.isActive(), true);
            assert.equal(txn._debugViewStats().issued, 1);

            txn.abort();
            assert.equal(txn.isActive(), false);
            assertDetached(first);
            assertDetached(second);
            assert.equal(txn._debugViewStats().issued, 0);
        } finally {
            closeFixture(fixture);
        }
    });
}

test("write transactions and missing keys do not issue borrowed views", () => {
    const fixture = createFixture();
    try {
        const writeTxn = fixture.env.startWrite();
        assert.throws(
            () => writeTxn._debugIssueView(fixture.dbi, "value"),
            /read-only transaction required/,
        );
        writeTxn.abort();

        const readTxn = fixture.env.startRead();
        assert.equal(
            readTxn._debugIssueView(fixture.dbi, "missing"),
            undefined,
        );
        assert.equal(readTxn._debugViewStats().issued, 0);
        readTxn.abort();
    } finally {
        closeFixture(fixture);
    }
});

test("transaction finalizer detaches a retained DataView", () => {
    runFixture("gc-finalizer.js");
});

test("transaction and environment ownership survive GC in every direction", () => {
    runFixture("reachability.js");
});

test("dead weak references are pruned without losing live views", () => {
    runFixture("pruning.js");
});

test("native failures cross the debug N-API boundary as JavaScript errors", () => {
    runFixture("native-error-boundary.js");
});

test("finalizer tolerates reference cleanup failure after safe detach", () => {
    runFixture("finalizer-reference-cleanup.js");
});

test("finalizer stays fatal when backing buffer safety cannot be proven", () => {
    for (const fault of ["getReference", "isDetached", "detach"]) {
        runFatalFixture("finalizer-safety-fault.js", fault);
    }
});
