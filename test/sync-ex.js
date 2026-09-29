"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { MDBX_Env, MDBX_Param } = require("../lib/nativemou.js");

function withEnvironment(options, callback) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-sync-ex-"));
    const dbPath = path.join(root, "db");
    const env = new MDBX_Env();
    try {
        env.openSync({ path: dbPath, ...options });
        callback(env, dbPath);
    } finally {
        env.closeSync();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function writeValue(env, value) {
    const txn = env.startWrite();
    try {
        const dbi = txn.createMap();
        dbi.put(txn, Buffer.from("key"), Buffer.from(value));
        txn.commit();
    } finally {
        if (txn.isActive()) txn.abort();
    }
}

function assertValue(env, expected) {
    const txn = env.startRead();
    try {
        const dbi = txn.openMap();
        assert.equal(dbi.get(txn, Buffer.from("key")).toString(), expected);
    } finally {
        txn.abort();
    }
}

function runLifecycleChild(mode, dbPath) {
    const env = new MDBX_Env();
    try {
        if (mode === "closed") {
            env.openSync({ path: dbPath });
            env.closeSync();
        }
        assert.throws(() => env.syncEx(true, false), {
            name: "Error",
            message: "closed",
        });
        // The error must release the wrapper mutex and leave the object reusable.
        env.openSync({ path: dbPath });
        writeValue(env, "reopened");
        assert.equal(env.syncEx(true, false), -1);
        assertValue(env, "reopened");
    } finally {
        env.closeSync();
    }
}

if (process.argv[2] === "--lifecycle-child") {
    runLifecycleChild(process.argv[3], process.argv[4]);
} else {
    const test = require("node:test");
    const safeNosync = { flags: MDBX_Param.envFlag.safeNosync };

    test("clean environment accepts MDBX_RESULT_TRUE for every sync mode", () => {
        withEnvironment({}, (env) => {
            for (const force of [true, false]) {
                for (const nonblock of [false, true]) {
                    assert.equal(env.syncEx(force, nonblock), -1);
                }
            }
        });
    });

    test("safeNosync returns 0 for pending data and -1 on repeated sync", () => {
        withEnvironment(safeNosync, (env) => {
            writeValue(env, "first");
            assert.equal(env.syncEx(true, false), 0);
            assert.equal(env.syncEx(true, false), -1);
            assertValue(env, "first");

            writeValue(env, "second");
            assert.equal(env.syncEx(true, false), 0);
            assert.equal(env.syncEx(true, false), -1);
            assertValue(env, "second");
        });
    });

    test("durable commit needs no additional sync", () => {
        withEnvironment({}, (env) => {
            writeValue(env, "durable");
            assert.equal(env.syncEx(true, false), -1);
            assertValue(env, "durable");
        });
    });

    test("autosync can flush a safeNosync commit before explicit sync", () => {
        withEnvironment(safeNosync, (env) => {
            env.setOption(MDBX_Param.envOption.syncBytes, 1);
            writeValue(env, "autosynced");
            assert.equal(env.syncEx(true, false), -1);
            assertValue(env, "autosynced");
        });
    });

    test("polling below autosync thresholds still allows a forced flush", () => {
        withEnvironment(safeNosync, (env) => {
            env.setOption(MDBX_Param.envOption.syncBytes, 64 * 1024 * 1024);
            env.setOption(MDBX_Param.envOption.syncPeriod, 0);
            writeValue(env, "pending");
            assert.ok([0, -1].includes(env.syncEx(false, false)));
            assert.equal(env.syncEx(true, false), 0);
            assert.equal(env.syncEx(true, false), -1);
            assertValue(env, "pending");
        });
    });

    test("read-only environments still reject sync", () => {
        withEnvironment({}, (env, dbPath) => {
            writeValue(env, "read-only");
            env.closeSync();
            env.openSync({ path: dbPath, flags: MDBX_Param.envFlag.rdonly });
            for (const force of [true, false]) {
                for (const nonblock of [false, true]) {
                    assert.throws(() => env.syncEx(force, nonblock), Error);
                }
            }
            assertValue(env, "read-only");
        });
    });

    test("sync arguments must include two booleans", () => {
        withEnvironment({}, (env) => {
            assert.throws(() => env.syncEx(), TypeError);
            assert.throws(() => env.syncEx(true), TypeError);
            for (const value of [undefined, null, 0, 1, "true", {}, []]) {
                assert.throws(() => env.syncEx(value, false), TypeError);
                assert.throws(() => env.syncEx(true, value), TypeError);
            }
            assert.equal(env.syncEx(true, false), -1);
        });
    });

    for (const mode of ["unopened", "closed"]) {
        test(`${mode} environment throws in JS and can be opened again`, () => {
            const root = fs.mkdtempSync(
                path.join(os.tmpdir(), "mdbxmou-sync-ex-lifecycle-"),
            );
            try {
                const result = spawnSync(
                    process.execPath,
                    [__filename, "--lifecycle-child", mode, path.join(root, "db")],
                    { encoding: "utf8", timeout: 10_000, cwd: root },
                );
                if (result.error) throw result.error;
                assert.equal(
                    result.status,
                    0,
                    `child failed: signal=${result.signal}\n${result.stdout}${result.stderr}`,
                );
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        });
    }
}
