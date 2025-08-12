"use strict";

const fs = require('fs');
const MDBX = require('../lib/nativemou.js');
const { MDBX_Env, MDBX_Param } = MDBX;

const test = async () => {
  const path4 = 'e4';
  const path5 = 'e5';

  console.log("MDBX_Param:", MDBX_Param);

  await Promise.all([
    fs.promises.rm(path4, { recursive: true, force: true }),
    fs.promises.rm(path5, { recursive: true, force: true })
  ]);

  const db4 = new MDBX_Env();
  const db5 = new MDBX_Env();

  console.log('Opening database...');

  const { value_flag } = MDBX_Param;
  await Promise.all([
    db4.open({
      path: path4,
      value_flag: value_flag.string
    }),
    db5.open({
      path: path5,
    })
  ]);

  console.log('Start write test...');
  const count = 10;
  const { key_mode } = MDBX_Param;
  const txn = db4.startWrite();
  // при изменении типа ключей надо указывать MDBX_CREATE если базы еще нет
  const dbi = txn.createMap(key_mode.ordinal);
  for (let i = 0; i < count; i++) {
    dbi.put(i, `value_${i}`);
  }
  txn.commit();
  console.log('Start write finish');

  await Promise.all([await db4.close(), await db5.close()]);

  //await db.copyTo('e4_copy_async');

  await db4.open({
    path: path4,
    value_flag: value_flag.string
  });

  let val = "";
  {
    const txn = db4.startRead();
    // для read транакций не нужно указывать MDBX_CREATE иначе будет Permission denied
    const dbi = txn.openMap(BigInt(key_mode.ordinal));
    const stat = dbi.stat();
    for (let i = 0; i < count; i++) {
      val = dbi.get(i);
    }
    console.log('last value:', val.toString());
    console.log('stat:', JSON.stringify(stat));
    txn.commit();
  }

  {
    const txn = db4.startRead();
    const dbi = txn.openMap(BigInt(key_mode.ordinal));
    dbi.forEach((key, value) => {
      console.log(key, value);
    });
    txn.commit();
  }


  const { txn_mode, query_mode, db_mode, key_flag } = MDBX_Param;
  const result = await db4.query([
    { db_mode: db_mode.accede, key_mode: key_mode.ordinal, key_flag: key_flag.bigint, mode: query_mode.get, item: [{ key: 0 }, { key: 1 }, { key: 2 }] },
    { db_mode: db_mode.accede, key_mode: key_mode.ordinal, key_flag: key_flag.bigint, mode: query_mode.get, item: [{ key: 3 }, { key: 4 }, { key: 5 }] }
  ]);
  console.log('query', JSON.stringify(result));

  await db4.close();
}

test().catch(console.error);
