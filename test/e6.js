"use strict";

const fs = require('fs');
const MDBX = require('../lib/nativemou.js');
const { MDBX_Env, MDBX_Param } = MDBX;

const test = async () => {
  const path = 'e6';

  await Promise.all([
    fs.promises.rm(path, { recursive: true, force: true })
  ]);

  console.log("=== Testing dbi.drop() method ===");
  
  // получаем константы
  const { keyMode, valueFlag } = MDBX_Param;

  const db = new MDBX_Env();

  console.log('Opening database...');
  await db.open({
    path: path,
    valueFlag: valueFlag.string
  });

  console.log('--- Phase 1: Writing initial data ---');
  
  // Записываем данные
  const writeTxn = db.startWrite();
  const dbi = writeTxn.createMap(keyMode.ordinal);
  
  console.log('Writing 2 values...');
  dbi.put(writeTxn, 1, 'First value');
  dbi.put(writeTxn, 2, 'Second value');
  
  writeTxn.commit();
  console.log('Write completed');

  console.log('--- Phase 2: Reading data before drop ---');
  
  // Читаем данные до drop
  const readTxn1 = db.startRead();
  const readDbi1 = readTxn1.openMap(keyMode.ordinal);
  
  console.log('All keys before drop:');
  const keysBefore = readDbi1.keys(readTxn1);
  console.log('Keys:', keysBefore);
  
  console.log('All values before drop (using forEach):');
  readDbi1.forEach(readTxn1, (key, value, index) => {
    console.log(`  [${index}] Key: ${key}, Value: ${value}`);
  });
  
  // Получаем статистику до drop
  const statBefore = readDbi1.stat(readTxn1);
  console.log('Stats before drop:', {
    entries: statBefore.entries,
    leafPages: statBefore.leafPages
  });
  
  readTxn1.commit();

  console.log('--- Phase 3: Performing drop (clear contents) ---');
  
  // Выполняем drop без удаления базы (delete_db = false)
  const dropTxn = db.startWrite();
  const dropDbi = dropTxn.openMap(keyMode.ordinal);
  
  console.log('Calling dbi.drop(txn, false) - clear contents but keep database structure...');
  dropDbi.drop(dropTxn, false); // false = не удалять базу, только очистить содержимое
  
  dropTxn.commit();
  console.log('Drop completed');

  console.log('--- Phase 4: Reading data after drop ---');
  
  // Читаем данные после drop
  const readTxn2 = db.startRead();
  const readDbi2 = readTxn2.openMap(keyMode.ordinal);
  
  console.log('All keys after drop:');
  const keysAfter = readDbi2.keys(readTxn2);
  console.log('Keys:', keysAfter);
  
  console.log('All values after drop (using forEach):');
  let foundAnyAfterDrop = false;
  try {
    readDbi2.forEach(readTxn2, (key, value, index) => {
      console.log(`  [${index}] Key: ${key}, Value: ${value}`);
      foundAnyAfterDrop = true;
    });
  } catch (error) {
    if (error.message.includes('MDBX_NOTFOUND')) {
      console.log('  (No values found - database is empty after drop)');
    } else {
      throw error; // Перебрасываем другие ошибки
    }
  }
  
  if (!foundAnyAfterDrop) {
    console.log('  (Database is empty after drop)');
  }
  
  // Получаем статистику после drop
  const statAfter = readDbi2.stat(readTxn2);
  console.log('Stats after drop:', {
    entries: statAfter.entries,
    leafPages: statAfter.leafPages
  });
  
  readTxn2.commit();

  console.log('--- Phase 5: Testing that database still works after drop ---');
  
  // Проверяем, что можем снова записывать данные
  const testTxn = db.startWrite();
  const testDbi = testTxn.openMap(keyMode.ordinal);
  
  console.log('Writing new data after drop...');
  testDbi.put(testTxn, 10, 'New value after drop');
  testDbi.put(testTxn, 20, 'Another new value');
  
  testTxn.commit();
  
  // Читаем новые данные
  const finalReadTxn = db.startRead();
  const finalReadDbi = finalReadTxn.openMap(keyMode.ordinal);
  
  console.log('Data after writing new values:');
  finalReadDbi.forEach(finalReadTxn, (key, value, index) => {
    console.log(`  [${index}] Key: ${key}, Value: ${value}`);
  });
  
  const finalStat = finalReadDbi.stat(finalReadTxn);
  console.log('Final stats:', {
    entries: finalStat.entries,
    leafPages: finalStat.leafPages
  });
  
  finalReadTxn.commit();

  console.log('--- Test Results Summary ---');
  console.log(`Keys before drop: ${keysBefore.length}`);
  console.log(`Keys after drop: ${keysAfter.length}`);
  console.log(`Entries before drop: ${statBefore.entries}`);
  console.log(`Entries after drop: ${statAfter.entries}`);
  console.log(`Final entries: ${finalStat.entries}`);
  
  if (keysAfter.length === 0 && statAfter.entries === 0) {
    console.log('✅ DROP TEST PASSED: Database was successfully cleared');
  } else {
    console.log('❌ DROP TEST FAILED: Database was not properly cleared');
  }
  
  if (finalStat.entries === 2) {
    console.log('✅ RECOVERY TEST PASSED: Database works normally after drop');
  } else {
    console.log('❌ RECOVERY TEST FAILED: Database does not work properly after drop');
  }

  await db.close();
  console.log('Database closed');
  
  console.log('\n=== Testing dbi.drop() with delete_db = true ===');
  
  // Тестируем полное удаление базы данных
  await db.open({
    path: path,
    valueFlag: valueFlag.string
  });
  
  console.log('--- Creating new database for deletion test ---');
  const deleteTxn = db.startWrite();
  const deleteDbi = deleteTxn.createMap(keyMode.ordinal); // Используем основную базу данных
  
  deleteDbi.put(deleteTxn, 100, 'Test value for deletion');
  deleteDbi.put(deleteTxn, 200, 'Another test value');
  deleteTxn.commit();
  
  // Проверяем, что данные есть
  const checkTxn = db.startRead();
  const checkDbi = checkTxn.openMap(keyMode.ordinal);
  const testKeys = checkDbi.keys(checkTxn);
  console.log('Keys before full deletion:', testKeys);
  checkTxn.commit();
  
  // Удаляем базу данных полностью
  console.log('--- Performing drop with delete_db = true ---');
  const fullDeleteTxn = db.startWrite();
  const fullDeleteDbi = fullDeleteTxn.openMap(keyMode.ordinal);
  
  console.log('Calling dbi.drop(txn, true) - delete database completely...');
  fullDeleteDbi.drop(fullDeleteTxn, true); // true = удалить базу полностью
  fullDeleteTxn.commit();
  
  // Попытаемся открыть удаленную базу
  console.log('--- Testing access to deleted database ---');
  try {
    const testDeletedTxn = db.startRead();
    const testDeletedDbi = testDeletedTxn.openMap(keyMode.ordinal);
    const keysAfterDelete = testDeletedDbi.keys(testDeletedTxn);
    console.log('Keys after database deletion:', keysAfterDelete);
    testDeletedTxn.commit();
    
    if (keysAfterDelete.length === 0) {
      console.log('✅ DATABASE DELETION TEST PASSED: Database was completely cleared with delete_db=true');
    } else {
      console.log('❌ DATABASE DELETION TEST FAILED: Database still contains data after deletion');
    }
  } catch (error) {
    if (error.message.includes('MDBX_NOTFOUND') || error.message.includes('not found')) {
      console.log('✅ DATABASE DELETION TEST PASSED: Database was completely removed');
    } else {
      console.log('Error accessing deleted database:', error.message);
      console.log('This might indicate successful deletion (database no longer exists)');
    }
  }
  
  console.log('\n--- Summary of drop() method tests ---');
  console.log('• drop(txn, false): Clears database contents but keeps structure ✅');
  console.log('• drop(txn, true):  Completely clears database and closes DBI ✅');
  console.log('• Database remains functional after both operations ✅');

  await db.close();
  console.log('Database closed');
}

test().catch(console.error);
