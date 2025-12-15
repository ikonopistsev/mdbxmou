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

  const { valueFlag } = MDBX_Param;
  await Promise.all([
    db4.open({
      path: path4,
      valueFlag: valueFlag.string
    }),
    db5.open({
      path: path5,
    })
  ]);

  console.log('Start write test...');
  const count = 10;
  const { keyMode } = MDBX_Param;
  const txn = db4.startWrite();
  // при изменении типа ключей надо указывать MDBX_CREATE если базы еще нет
  const dbi = txn.createMap(keyMode.ordinal);
  console.log('dbi', dbi.id);       // ID базы данных
  console.log(dbi.dbMode);    // режим базы данных
  console.log(dbi.keyMode);   // режим ключей
  console.log(dbi.valueMode); // режим значений
  console.log(dbi.keyFlag);   // флаги ключей
  console.log(dbi.valueFlag); // флаги значений
  for (let i = 0; i < count; i++) {
    dbi.put(txn, i, `value_${i}`);
  }
  txn.commit();
  console.log('Start write finish');

  await Promise.all([await db4.close(), await db5.close()]);

  //await db.copyTo('e4_copy_async');

  await db4.open({
    path: path4,
    valueFlag: valueFlag.string
  });

  let val = "";
  {
    const txn = db4.startRead();
    // для read транакций не нужно указывать MDBX_CREATE иначе будет Permission denied
    const dbi = txn.openMap(BigInt(keyMode.ordinal));
    const stat = dbi.stat(txn);
    for (let i = 0; i < count; i++) {
      val = dbi.get(txn, i);
    }
    console.log('last value:', val.toString());
    console.log('stat:', JSON.stringify(stat));
    txn.commit();
  }

  {
    const txn = db4.startRead();
    const dbi = txn.openMap(BigInt(keyMode.ordinal));
    dbi.forEach(txn, (key, value) => {
      console.log(key, value);
    });
    txn.commit();
  }


  // query() принимает DBI (или объект { dbi }) и использует его параметры.
  const { queryMode } = MDBX_Param;
  const queryTxn = db4.startRead();
  const queryDbi = queryTxn.openMap(BigInt(keyMode.ordinal));
  queryTxn.commit();

  const result = await db4.query([
    { dbi: queryDbi, mode: queryMode.get, item: [{ key: 0 }, { key: 1n }, { key: 2n }] },
    { dbi: queryDbi, mode: queryMode.get, item: [{ key: 3n }, { key: 4n }, { key: 5n }] }
  ]);
  const json = JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  console.log('query', json);

  await db4.close();
}

test().catch(console.error);
