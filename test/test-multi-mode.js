"use strict";

const fs = require('fs');
const MDBX = require('../lib/nativemou.js');
const { MDBX_Env, MDBX_Param } = MDBX;

const testMultiMode = async () => {
  const path = 'test-multi-mode';

  await Promise.all([
    fs.promises.rm(path, { recursive: true, force: true })
  ]);

  const { keyMode, valueMode, cursorMode } = MDBX_Param;

  const db = new MDBX_Env();

  console.log('Opening database with multi value mode...');
  await db.open({
      path,
      valueFlag: MDBX_Param.valueFlag.string
  });

  // добавим тестовые данные в multi режиме
  const w = db.startWrite();
  const wdbi = w.createMap(keyMode.ordinal, valueMode.multi);
  
  // Добавляем несколько значений для одного ключа
  wdbi.put(w, 5, 'value5_1');
  wdbi.put(w, 5, 'value5_2');
  wdbi.put(w, 5, 'value5_3');
  
  // Добавляем данные для других ключей
  for (let i = 1; i <= 10; i++) {
    if (i !== 5) {
      wdbi.put(w, i, `value${i}`);
    }
  }
  
  w.commit();

  // читаем данные
  const r = db.startRead();
  const dbi = r.openMap(keyMode.ordinal, valueMode.multi);

  console.log('=== Testing multi mode with key_equal ===');

  // 1. Обычный forEach - должен показать все записи
  console.log('\n1. forEach(fn) - все записи:');
  let count = dbi.forEach(r, (k, v, i) => {
    console.log(`  ${i}: key=${k} value=${v}`);
    return false; // продолжаем
  });
  console.log(`Total processed: ${count} items`);

  // 2. forEach с key_equal для ключа 5 - должен показать все три записи
  console.log('\n2. forEach(key=5, "keyEqual", fn) - три записи для ключа 5:');
  count = dbi.forEach(r, 5, 'keyEqual', (k, v, i) => {
    console.log(`  ${i}: key=${k} value=${v}`);
  });
  console.log(`Processed: ${count} items`);

  // 3. forEach с key_greater_or_equal для ключа 5 - должен показать все записи начиная с ключа 5
  console.log('\n3. forEach(key=5, "keyGreaterOrEqual", fn) - все записи от ключа 5:');
  count = dbi.forEach(r, 5, 'keyGreaterOrEqual', (k, v, i) => {
    console.log(`  ${i}: key=${k} value=${v}`);
    return i >= 4; // останавливаем после 5 элементов
  });
  console.log(`Processed: ${count} items`);

  // 4. keysFrom с key_equal - должен вернуть три ключа
  console.log('\n4. keysFrom(key=5, limit=10, "keyEqual") - три ключа:');
  const keysEqual = dbi.keysFrom(r, 5, 10, 'keyEqual');
  console.log(`Keys: [${keysEqual.join(', ')}]`);

  // 5. keysFrom с key_greater_or_equal - должен вернуть все ключи от 5
  console.log('\n5. keysFrom(key=5, limit=10, "keyGreaterOrEqual") - все ключи от 5:');
  const keysGreater = dbi.keysFrom(r, 5, 10, 'keyGreaterOrEqual');
  console.log(`Keys: [${keysGreater.join(', ')}]`);

  r.commit();
  await db.close();
  
  console.log('\n=== Multi mode test completed successfully ===');
}

testMultiMode().catch(console.error);
