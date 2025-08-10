"use strict";

const fs = require('fs');
const MDBX = require('../lib/nativemou.js');
const { MDBX_Env, MDBX_db_flags } = MDBX;

const test = async () => {
  const path4 = 'e4';
  const path5 = 'e5';

  console.log(MDBX_db_flags);

  await Promise.all([
    fs.promises.rm(path4, { recursive: true, force: true }),
    fs.promises.rm(path5, { recursive: true, force: true })
  ]);

  const db4 = new MDBX_Env();
  const db5 = new MDBX_Env();

  console.log('Opening database...');

  await Promise.all([
    db4.open({
      path: path4,
    }),
    db5.open({
      path: path5,
    })
  ]);

  console.log('Start write test...');
  const count = 10;
  const txn = db4.startWrite();
  // при изменении типа ключей надо указывать MDBX_CREATE если базы еще нет
  const dbi = txn.getDbi(MDBX_db_flags.MDBX_REVERSEKEY|MDBX_db_flags.MDBX_CREATE);
  for (let i = 0; i < count; i++) {
    dbi.put(`key_${i}`, `value_${i}`, 0);
  }
  txn.commit();
  console.log('Start write finish');

  await Promise.all([await db4.close(), await db5.close()]);

  //await db.copyTo('e4_copy_async');

  await db4.open({
    path: path4,
    valString: true,
    keyString: true
  });

  let val = "";
  {
    const txn = db4.startRead();
    // для read транакций не нужно указывать MDBX_CREATE иначе будет Permission denied
    const dbi = txn.getDbi(MDBX_db_flags.MDBX_REVERSEKEY);
    const stat = dbi.stat();
    for (let i = 0; i < count; i++) {
      val = dbi.get(`key_${i}`);
    }
    console.log('last value:', val.toString());
    console.log('stat:', JSON.stringify(stat));
    txn.commit();
  }

  const result = await db4.query([
    { "item": [{ "key": "key_0" }, { "key": "key_1" }, { "key": "key_2" }] }, { "item": [{ "key": "key_3" }, { "key": "key_4" }, { "key": "key_5" }] }
  ]);
  console.log('query', JSON.stringify(result));

  await db4.close();
}

test().catch(console.error);
