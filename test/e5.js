"use strict";

const fs = require('fs');
const MDBX = require('../lib/nativemou.js');
const { MDBX_Env, MDBX_db_flag, MDBX_txn_flag, MDBX_put_flag, MDBX_mou_option } = MDBX;

const test = async () => {
  const path = 'e5';

  console.log("MDBX_db_flag", MDBX_db_flag);
  console.log("MDBX_txn_flag", MDBX_txn_flag);
  console.log("MDBX_put_flag", MDBX_put_flag);
  console.log("MDBX_mou_option", MDBX_mou_option);

  await Promise.all([
    fs.promises.rm(path, { recursive: true, force: true })
  ]);

  const db = new MDBX_Env();

  console.log('Opening database...');
  const rc = await db.open({
      path: path,
      valString: true,
  });

  const db_flag = MDBX_db_flag.MDBX_INTEGERKEY|MDBX_db_flag.MDBX_CREATE;
  const count = 2;
  console.log('Start write');
  const txn = db.startWrite();
  // при изменении типа ключей надо указывать MDBX_CREATE если базы еще нет
  const dbi = txn.getDbi(db_flag);
  for (let i = 0; i < count; i++) {
    dbi.put(BigInt(i), `val-${i}`, 0);
  }
  txn.commit();
  console.log('Write finish');


  // вычитаем key = 2 - асинхронно
  // по умолчаниюю чтение идет в режиме wr убираем флаг MDBX_CREATE
  // чтобы не получить Permission denied
  const out = await db.query([
    { 
      "flag": MDBX_db_flag.MDBX_INTEGERKEY, 
      "oper": MDBX_put_flag.MDBXMOU_GET, 
      "item": [{ "key": Number(1) }] 
    },
    { 
      "flag": MDBX_db_flag.MDBX_INTEGERKEY, 
      "oper": MDBX_put_flag.MDBX_UPSERT, 
      "item": [{ "key": Number(2), "value":"val-2" }] 
    }
  ], MDBX_txn_flag.MDBX_TXN_READWRITE);
  console.log(JSON.stringify(out));

  // вычитаем key = 2 - синхронно
  const r = db.startRead();
  const rdbi = r.getDbi(BigInt(MDBX_db_flag.MDBX_INTEGERKEY));
  const val = rdbi.get(2);
  console.log("keys", rdbi.keys());
  console.log("read 2", val);

  console.log("forEach");
  rdbi.forEach((key, value, index) => {
    console.log(key, value, index);
  });

  r.commit();


  await db.close();
}

test().catch(console.error);
