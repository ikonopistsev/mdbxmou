"use strict";

const fs = require('fs');
const MDBX = require('../lib/nativemou.js');
const { MDBX_Env, MDBX_Param } = MDBX;

const testCursorMode = async () => {
  const path = 'test-cursor-mode';

  await Promise.all([
    fs.promises.rm(path, { recursive: true, force: true })
  ]);

  const { keyMode, cursorMode } = MDBX_Param;

  const db = new MDBX_Env();

  console.log('Opening database...');
  await db.open({
      path: path,
      valueFlag: MDBX_Param.valueFlag.string
  });

  // добавим тестовые данные
  const w = db.startWrite();
  const wdbi = w.createMap(keyMode.ordinal);
  for (let i = 1; i <= 10; i++) {
    wdbi.put(i, `value${i}`);
  }
  w.commit();

  // читаем данные
  const r = db.startRead();
  const dbi = r.openMap(keyMode.ordinal);

  console.log('=== Testing forEach variants ===');

  // 1. forEach(fn)
  console.log('\n1. forEach(fn):');
  let count = dbi.forEach((k, v, i) => {
    console.log(`  ${i}: ${k} = ${v}`);
    return i >= 2; // останавливаем после 3 элементов
  });
  console.log(`Processed ${count} items`);

  // 2. forEach(fromKey, fn)
  console.log('\n2. forEach(fromKey=5, fn):');
  count = dbi.forEach(5, (k, v, i) => {
    console.log(`  ${i}: ${k} = ${v}`);
    return i >= 2; // останавливаем после 3 элементов
  });
  console.log(`Processed ${count} items`);

  // 3. forEach(fromKey, cursorMode, fn) - строковый режим
  console.log('\n3. forEach(fromKey=7, "keyGreater", fn):');
  count = dbi.forEach(7, 'keyGreater', (k, v, i) => {
    console.log(`  ${i}: ${k} = ${v}`);
    return i >= 1; // останавливаем после 2 элементов
  });
  console.log(`Processed ${count} items`);

  // 4. forEach(fromKey, cursorMode, fn) - числовой режим key_lesser_or_equal (обратное сканирование)
  console.log('\n4. forEach(fromKey=7, cursorMode.key_lesser_or_equal, fn):');
  count = dbi.forEach(7, cursorMode.key_lesser_or_equal, (k, v, i) => {
    console.log(`  ${i}: ${k} = ${v}`);
    return i >= 2; // останавливаем после 3 элементов
  });
  console.log(`Processed ${count} items`);

  // 5. forEach(fromKey, cursorMode, fn) - keyEqual
  console.log('\n5. forEach(fromKey=5, "keyEqual", fn):');
  count = dbi.forEach(5, 'keyEqual', (k, v, i) => {
    console.log(`  ${i}: ${k} = ${v}`);
    return i >= 0; // останавливаем после первого элемента для демонстрации
  });
  console.log(`Processed ${count} items`);

  r.commit();
  await db.close();
  
  console.log('\n=== Test completed successfully ===');
}

testCursorMode().catch(console.error);
