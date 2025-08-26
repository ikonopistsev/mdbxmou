"use strict";

const fs = require('fs');
const MDBX = require('../lib/nativemou.js');
const { MDBX_Env, MDBX_Param } = MDBX;

const test = async () => {
    const dbDir = 'e2';

    await fs.promises.rm(dbDir, { recursive: true, force: true });

    console.log("MDBX_Param:", MDBX_Param);
    // получаем константы
    const { keyMode } = MDBX_Param;

    const db = new MDBX_Env();

    db.openSync({ path: dbDir });

    const txn = db.startWrite();
    const dbi = txn.createMap(keyMode.ordinal);
    const k = dbi.keys(txn);
    const f = dbi.forEach(txn, (key, value, index) => {
      console.log(`Key: ${key}, Value: ${value}, Index: ${index}`);
    });
    txn.commit();
    await db.close();
}

test().catch(console.error);
