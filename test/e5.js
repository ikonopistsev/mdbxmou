"use strict";

const fs = require('fs');
const MDBX = require('../lib/nativemou.js');
const { MDBX_Env, MDBX_Param } = MDBX;

const test = async () => {
  const path = 'e5';

  await Promise.all([
    fs.promises.rm(path, { recursive: true, force: true })
  ]);

  console.log("MDBX_Param:", MDBX_Param);
  // получаем константы
  const { key_mode, key_flag, query_mode, value_flag } = MDBX_Param;


  const db = new MDBX_Env();

  console.log('Opening database...');
  const rc = await db.open({
      path: path,
      value_flag: value_flag.string
  });

  const count = 2;
  console.log('Start write');
  const txn = db.startWrite();
  // будем использовать ordinal ключи
  const dbi = txn.createMap(key_mode.ordinal);
  for (let i = 0; i < count; i++) {
    dbi.put(i, `val-${i}`, 0);
  }
  txn.commit();
  console.log('Write finish');


  // вычитаем key = 1 - асинхронно
  // запишем при этом key = 2
  // по умолчаниюю query выполняется в режиме wr
  const out = await db.query([
    { 
      mode: query_mode.get, 
      key_mode: key_mode.ordinal, 
      key_flag: key_flag.number,
      item: [{ "key": Number(1) }] 
    },
    { 
      mode: query_mode.insert_unique, 
      key_mode: key_mode.ordinal,
      key_flag: key_flag.number,
      item: [{ "key": 2, "value":"val-2" }] 
    }
  ]);
  console.log(JSON.stringify(out));

  // вычитаем key = 2 - синхронно
  const r = db.startRead();
  const rdbi = r.openMap(key_mode.ordinal);
  const val = rdbi.get(2);
  console.log("keys", rdbi.keys());
  console.log("read 2", val);

  console.log("forEach");
  rdbi.forEach((key, value, index) => {
    console.log(`[${index}]`, key, value);
  });

  r.commit();


  await db.close();
}

test().catch(console.error);
