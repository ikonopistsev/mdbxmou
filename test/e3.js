"use strict";

const fs = require('fs');
const MDBX = require('../lib/nativemou.js');
const { MDBX_Env, MDBX_Param } = MDBX;

const test = async () => {
  const db_dir = 'e3';

  await fs.promises.rm(db_dir, { recursive: true, force: true });

  console.log("MDBX_Param:", MDBX_Param);
  // получаем константы
  const { key_mode, key_flag, query_mode, value_flag } = MDBX_Param;

  const db = new MDBX_Env();

  console.log('Opening database...');

  await db.open({
      path: db_dir
    });

  console.log('Start write');
  const count = 100000;
  for (let i = 0; i < count; i++) {
    const txn = db.startWrite();
    const dbi = txn.createMap(key_mode.ordinal);
    dbi.put(i, `value_${i}`);
    txn.commit();
  }
  
  console.log('Write finish');

  await db.close();
}

test().catch(console.error);
