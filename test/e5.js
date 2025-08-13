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
  const { keyMode, keyFlag, queryMode, valueFlag } = MDBX_Param;

  const db = new MDBX_Env();

  console.log('Opening database...');
  const rc = await db.open({
      path: path,
      valueFlag: valueFlag.string
  });

  const count = 2;
  console.log('Start write');
  const txn = db.startWrite();
  // будем использовать ordinal ключи
  const dbi = txn.createMap(keyMode.ordinal);
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
      mode: queryMode.get, 
      keyMode: keyMode.ordinal, 
      keyFlag: keyFlag.number,
      item: [{ "key": 1 }, { "key": 42 }] 
    },
    { 
      mode: queryMode.insertUnique, 
      keyMode: keyMode.ordinal,
      keyFlag: keyFlag.number,
      item: [{ "key": 2, "value":"val-2" }] 
    }
  ]);
  console.log('q1', JSON.stringify(out));

  // вычитаем key = 2 - синхронно
  const r = db.startRead();
  const rdbi = r.openMap(keyMode.ordinal);
  const keys = rdbi.keys();
  const val = rdbi.get(2);
  console.log("keys", keys);
  console.log("read 2", val);

  console.log("forEach");
  rdbi.forEach((key, value, index) => {
    console.log(`[${index}]`, key, value);
  });

  console.log("forEach from key 1");
  rdbi.forEach(1, (key, value, index) => {
    console.log(`[${index}]`, key, value);
  });

  {
    const out = rdbi.keysFrom(1);
    console.log("keysFrom()", out);
  }  

  r.commit();

  {
    // почитаем асинхронно в упрощенном режиме
    console.log("Read key = 2 in simple async mode to out2");
    const out2 = await db.query({
      keyMode: keyMode.ordinal,
      item: [{ "key": 2 }, { "key": 42 }]  
    });
    console.log("out2", JSON.stringify(out2));
  }
  
  {
    // почитаем асинхронно в упрощенном режиме
    const out = await db.keys({
      keyMode: BigInt(keyMode.ordinal),
    });
    console.log("await keys()", out);
  }

  // добавим не существующий ключ
  keys.push(42);
  // удалим все ключи
  const rm = await db.query([
      { 
        mode: queryMode.del, 
        keyMode: keyMode.ordinal, 
        item: keys.map(key => ({ "key": key }))
      }
  ]);
  console.log("rm keys", JSON.stringify(rm));

  // Тестируем forEach с cursorMode
  {
    console.log("=== Testing forEach with cursorMode ===");
    
    // добавим тестовые данные
    const w = db.startWrite();
    const wdbi = w.createMap(keyMode.ordinal);
    for (let i = 1; i <= 10; i++) {
      wdbi.put(i, `value${i}`);
    }
    w.commit();
    
    // читаем заново
    const r = db.startRead();
    const dbi = r.openMap(keyMode.ordinal);
    
    // forEach(fn) - обычный вызов
    console.log("forEach(fn):");
    dbi.forEach((k, v, i) => {
      console.log(`  ${i}: ${k} = ${v}`);
      return i >= 2; // останавливаем после 3 элементов
    });
    
    // forEach(fromKey, fn) - с начального ключа
    console.log("forEach(fromKey=5, fn):");
    dbi.forEach(5, (k, v, i) => {
      console.log(`  ${i}: ${k} = ${v}`);
      return i >= 2; // останавливаем после 3 элементов
    });
    
    // forEach(fromKey, cursorMode, fn) - с cursorMode
    console.log("forEach(fromKey=7, cursorMode=keyGreater, fn):");
    dbi.forEach(7, 'keyGreater', (k, v, i) => {
      console.log(`  ${i}: ${k} = ${v}`);
      return i >= 1; // останавливаем после 2 элементов
    });
    
    r.commit();
  }

  // вычитаем все ключи
  {
    // вычитаем key = 2 - синхронно
    const r = db.startRead();
    const dbi = r.openMap(keyMode.ordinal);
    console.log("keys", dbi.keys());
    r.commit();
  }
  await db.close();
}

test().catch(console.error);
