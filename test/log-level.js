"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

if (process.argv.includes("--child")) {
    const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "mdbxmou-log-level-"));
    try {
        const { MDBX_Env } = require("../lib/nativemou.js");
        const env = new MDBX_Env();
        env.openSync({
            path: dbPath,
            geometry: {
                pageSize: 16 * 1024,
                sizeUpper: 4 * 1024 ** 3,
                growthStep: 64 * 1024 ** 2,
                shrinkThreshold: 128 * 1024 ** 2,
            },
        });
        env.closeSync();
    } finally {
        fs.rmSync(dbPath, { recursive: true, force: true });
    }
    process.exit(0);
}

const child = spawnSync(process.execPath, [__filename, "--child"], {
    encoding: "utf8",
});

assert.equal(child.status, 0, child.stderr || child.stdout);
assert.equal(child.stderr, "", `unexpected native stderr:\n${child.stderr}`);
console.log("libmdbx NOTICE logging is suppressed");
