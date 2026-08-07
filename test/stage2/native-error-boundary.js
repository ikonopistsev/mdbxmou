"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MDBX_Env } = require("../../lib/nativemou.js");

const firstPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "mdbxmou-stage2-native-error-a-"),
);
const secondPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "mdbxmou-stage2-native-error-b-"),
);
const first = new MDBX_Env();
const second = new MDBX_Env();

try {
    first.openSync({ path: firstPath });
    second.openSync({ path: secondPath });

    const firstWrite = first.startWrite();
    const firstDbi = firstWrite.createMap();
    firstDbi.put(firstWrite, "key", Buffer.from([1]));
    firstWrite.commit();

    const secondWrite = second.startWrite();
    const foreignDbi = secondWrite.createMap("foreign");
    foreignDbi.put(secondWrite, "key", Buffer.from([2]));
    secondWrite.commit();

    const read = first.startRead();
    assert.throws(
        () => read._debugIssueView(foreignDbi, "key"),
        /MDBX_BAD_DBI/,
    );
    assert.equal(read.isActive(), true);
    read.abort();
} finally {
    first.closeSync();
    second.closeSync();
    fs.rmSync(firstPath, { recursive: true, force: true });
    fs.rmSync(secondPath, { recursive: true, force: true });
}
