"use strict";

const fs = require('fs');
const MDBX = require('../lib/nativemou.js');
const { MDBX_Env } = MDBX;

const test = async () => {

  const path4 = 'e4';
  if (fs.existsSync(path4)) {
    fs.rmdirSync(path4, { recursive: true })
  }

  const path5 = 'e5';
  if (fs.existsSync(path5)) {
    fs.rm(path5, { recursive: true })
  }

  const db4 = new MDBX_Env();
  const db5 = new MDBX_Env();

  console.log('Opening database...');

  const rc = await Promise.all([
    await db4.open({
      path: path4,
    }),
    await db5.open({
      path: path5,
    })
  ]);

  const count = 10;
  const txn = db4.startWrite();
  const dbi = txn.getDbi();
  for (let i = 0; i < count; i++) {
    dbi.put(`key_${i}`, `value_${i}`, 0);
  }
  txn.commit();

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
    const dbi = txn.getDbi();
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
  console.log('get result:', JSON.stringify(result));

  await db4.close();
}

test().catch(console.error);
