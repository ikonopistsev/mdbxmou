"use strict";

const fs = require('fs');
const MDBX = require('../lib/nativemou.js');
const { MDBX_Env, MDBX_db_flag, MDBX_env_flag } = MDBX;

const test = async () => {
  const db_dir = 'e3';

  await fs.promises.rm(db_dir, { recursive: true, force: true });

  console.log(MDBX_env_flag);

  const db = new MDBX_Env();

  console.log('Opening database...');

  await db.open({
      path: db_dir,
      flag: MDBX_env_flag.MDBX_ACCEDE|
        MDBX_env_flag.MDBX_LIFORECLAIM|MDBX_env_flag.MDBX_UTTERLY_NOSYNC
    });

  console.log('Start write');
  const db_flag = BigInt(
    MDBX_db_flag.MDBX_CREATE|MDBX_db_flag.MDBX_INTEGERKEY);
  const count = 100000;
  for (let i = 0; i < count; i++) {
    const txn = db.startWrite();
    const dbi = txn.getDbi(db_flag);
    dbi.put(BigInt(i), `value_${i}`);
    txn.commit();
  }
  
  console.log('Write finish');

  await db.close();
}

test().catch(console.error);
