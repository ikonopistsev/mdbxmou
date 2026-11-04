"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");

const UINT64_FIELDS = ["mapSize", "dxbFileSize", "dxbFileAllocated", "lastPageNumber",
    "recentTxnId", "latterReaderTxnId", "selfLatterReaderTxnId", "unsyncVolume", "autosyncThreshold"];
const UINT32_FIELDS = ["maxReaders", "numReaders", "dxbPageSize", "sysPageSize", "sysUpcblk", "sysIoblk",
    "sinceSyncSeconds16dot16", "autosyncPeriodSeconds16dot16", "sinceReaderCheckSeconds16dot16", "mode"];
const TOP_LEVEL = ["geometry", ...UINT64_FIELDS.slice(0, 7), "metaTxnId", "metaSign", ...UINT32_FIELDS.slice(0, 6),
    "bootId", "unsyncVolume", "autosyncThreshold", ...UINT32_FIELDS.slice(6), "pageOperations", "dxbId"];
const GEOMETRY = ["lower", "upper", "current", "shrink", "grow"];
const PAGE_OPERATIONS = ["newly", "cow", "clone", "split", "merge", "spill", "unspill", "wops",
    "prefault", "mincore", "msync", "fsync"];
const ID = /^[0-9a-f]{32}$/;

function tempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-env-info-"));
}

function open(dbPath, options = {}) {
    const env = new MDBX_Env();
    env.openSync({ path: dbPath, ...options });
    return env;
}

function write(env, key, value) {
    const txn = env.startWrite();
    try {
        txn.createMap().put(txn, Buffer.from(key), Buffer.from(value));
        txn.commit();
    } finally {
        if (txn.isActive()) txn.abort();
    }
}

function assertId(value, nullable) {
    if (value === null) { assert.ok(nullable, "ID must not be null"); return; }
    assert.match(value, ID);
}

function assertShape(info) {
    // Exact native field set: a missing or extra mapping fails here.
    assert.deepEqual(Object.keys(info), TOP_LEVEL);
    assert.deepEqual(Object.keys(info.geometry), GEOMETRY);
    assert.deepEqual(Object.keys(info.pageOperations), PAGE_OPERATIONS);
    assert.deepEqual(Object.keys(info.bootId), ["current", "meta"]);
    for (const field of GEOMETRY) assert.equal(typeof info.geometry[field], "bigint", `geometry.${field}`);
    for (const field of PAGE_OPERATIONS) assert.equal(typeof info.pageOperations[field], "bigint", `pageOperations.${field}`);
    for (const field of UINT64_FIELDS) assert.equal(typeof info[field], "bigint", field);
    for (const field of UINT32_FIELDS) {
        assert.ok(Number.isInteger(info[field]) && info[field] >= 0 && info[field] <= 0xffffffff, field);
    }
    for (const field of ["metaTxnId", "metaSign"]) {
        assert.ok(Array.isArray(info[field]) && info[field].length === 3, field);
        for (const value of info[field]) assert.equal(typeof value, "bigint", field);
    }
    assert.ok(Array.isArray(info.bootId.meta) && info.bootId.meta.length === 3);
    for (const value of info.bootId.meta) assertId(value, true);
    assertId(info.bootId.current, true);
    assertId(info.dxbId, false);
}

function testShapeAndValues() {
    const root = tempRoot();
    const env = open(path.join(root, "db"));
    try {
        write(env, "a", "1");
        const before = env.info();
        assertShape(before);
        assert.ok(before.recentTxnId >= 1n);
        assert.ok(before.metaTxnId.includes(before.recentTxnId), "recent txn is one of the meta pages");
        assert.ok(before.dxbPageSize >= 256);
        if (process.platform === "linux" && fs.existsSync("/proc/sys/kernel/random/boot_id")) {
            // MDBX parses the UUID text as one 128-bit number (y:x); the binding prints x then y.
            const text = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim().replace(/-/g, "");
            assert.equal(before.bootId.current, text.slice(16) + text.slice(0, 16), "exact native x/y components");
        }

        write(env, "b", "2");
        const after = env.info();
        assert.equal(after.recentTxnId, before.recentTxnId + 1n);
        assert.equal(after.dxbId, before.dxbId, "dxbId belongs to the file, not to a transaction");

        const read = env.startRead();
        try {
            const withTxn = env.info(read);
            assertShape(withTxn);
            assert.equal(withTxn.recentTxnId, after.recentTxnId);
            assert.equal(withTxn.dxbId, after.dxbId);
        } finally {
            read.abort();
        }

        // The call only reads: no transaction appears and no write happens.
        assert.equal(env.info().recentTxnId, after.recentTxnId);

        const pages = 7;
        env.setOption(MDBX_Param.envOption.syncBytes, pages * after.dxbPageSize);
        assert.equal(env.info().autosyncThreshold, BigInt(pages * after.dxbPageSize), "uint64 keeps native bytes");
    } finally {
        env.closeSync();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function testTransactionArgument() {
    const root = tempRoot();
    const first = open(path.join(root, "first"));
    const second = open(path.join(root, "second"));
    try {
        write(first, "a", "1");
        const write2 = first.startWrite();
        try {
            assertShape(first.info(write2));
        } finally {
            write2.abort();
        }
        const finished = first.startRead();
        finished.abort();
        assert.throws(() => first.info(finished), /transaction is not active/);

        const foreign = second.startRead();
        try {
            assert.throws(() => first.info(foreign), /another environment/);
        } finally {
            foreign.abort();
        }
        assert.throws(() => first.info({}), { name: "TypeError", message: /must be MDBX_Txn instance/ });
        assert.throws(() => first.info(Object.create(Object.getPrototypeOf(foreign))), { name: "TypeError" });
        assertShape(first.info(undefined));
    } finally {
        first.closeSync();
        second.closeSync();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function testClosedAndReadOnly() {
    const root = tempRoot();
    const dbPath = path.join(root, "db");
    const env = new MDBX_Env();
    try {
        assert.throws(() => env.info(), { message: "closed" });
        env.openSync({ path: dbPath });
        write(env, "a", "1");
        const { dxbId, recentTxnId } = env.info();
        env.closeSync();
        assert.throws(() => env.info(), { message: "closed" });

        const ro = open(dbPath, { flags: MDBX_Param.envFlag.rdonly });
        try {
            const info = ro.info();
            assertShape(info);
            assert.equal(info.dxbId, dxbId);
            assert.equal(info.recentTxnId, recentTxnId);
        } finally {
            ro.closeSync();
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function testCopiesAndFileIdentity() {
    const root = tempRoot();
    const source = path.join(root, "source");
    const env = open(source);
    try {
        write(env, "a", "1");
        const original = env.info().dxbId;
        const copies = [];
        for (const [name, flags] of [["compact", MDBX_Param.copyFlag.compact], ["asis", 0]]) {
            const target = path.join(root, `copy-${name}`);
            env.copyToSync(target, flags);
            copies.push(target);
        }
        env.closeSync();

        const raw = path.join(root, "raw");
        fs.mkdirSync(raw);
        fs.copyFileSync(path.join(source, "mdbx.dat"), path.join(raw, "mdbx.dat"));

        const ids = copies.map(target => {
            const copy = open(target);
            try { return copy.info().dxbId; } finally { copy.closeSync(); }
        });
        for (const id of ids) {
            assertId(id, false);
            assert.notEqual(id, original, "MDBX copy gets a new file ID");
        }
        assert.notEqual(ids[0], ids[1]);

        const rawCopy = open(raw);
        try {
            assert.equal(rawCopy.info().dxbId, original, "byte copy keeps the file ID");
        } finally {
            rawCopy.closeSync();
        }
    } finally {
        if (fs.existsSync(source)) fs.rmSync(root, { recursive: true, force: true });
    }
}

function testAsyncOpenIsRejected() {
    const root = tempRoot();
    const env = new MDBX_Env();
    const opening = env.open({ path: path.join(root, "db") });
    assert.throws(() => env.info(), /operation in progress|closed/);
    return opening.then(async () => {
        assertShape(env.info());
        write(env, "a", "1");
        const copying = env.copyTo(path.join(root, "copy"));
        assertShape(env.info()); // like syncEx, allowed while the async copy runs
        await copying;
        await env.close();
        fs.rmSync(root, { recursive: true, force: true });
    });
}

testShapeAndValues();
testTransactionArgument();
testClosedAndReadOnly();
testCopiesAndFileIdentity();
testAsyncOpenIsRejected().then(() => {
    console.log("env-info: ok");
}, error => {
    console.error(error);
    process.exitCode = 1;
});
