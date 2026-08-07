"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const fixture = path.join(__dirname, "stage4", "dbi-argument-safety.js");

for (const scenario of ["open-cursor", "query", "keys"]) {
    test(`DBI type tag rejects ${scenario} prototype spoofing`, () => {
        const result = spawnSync(process.execPath, [fixture, scenario], {
            encoding: "utf8",
            timeout: 20_000,
        });

        assert.ifError(result.error);
        assert.equal(
            result.status,
            0,
            `${scenario} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        );
    });
}
