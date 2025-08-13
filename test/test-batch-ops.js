"use strict";
const fs = require("fs");
const { MDBX_Async_Env } = require("../lib/mdbx_evn_async.js");
const MDBX = require("../lib/nativemou.js");
const { MDBX_Param } = MDBX;

(async () => {
  const testPath = "batch-ops-db";
  await fs.promises.rm(testPath, { recursive: true, force: true }).catch(() => {});
  
  const env = new MDBX_Async_Env();
  
  try {
    await env.open({ path: testPath });
    const { keyMode } = MDBX_Param;

    console.log("=== Тест групповых операций ===");
    
    // 1. Создаем транзакцию
    console.log("1. Создаем транзакцию записи...");
    const w = await env.startWrite();
    const dbi = await w.openMap({ keyMode: keyMode.ordinal, create: true });
    
    // 2. Групповая запись множества ключей
    console.log("2. Групповая запись 5 ключей...");
    const itemsToWrite = [
      { key: 1n, value: "value1" },
      { key: 2n, value: "value2" },
      { key: 3n, value: "value3" },
      { key: 4n, value: "value4" },
      { key: 5n, value: "value5" }
    ];
    
    const writeResults = await dbi.putBatch(itemsToWrite);
    console.log("Результат записи:", writeResults);
    
    // 3. Коммитим транзакцию
    console.log("3. Коммитим транзакцию...");
    await w.commit();
    
    // 4. Создаем транзакцию чтения
    console.log("4. Создаем транзакцию чтения...");
    const r = await env.startRead();
    const readDbi = await r.openMap({ keyMode: keyMode.ordinal });
    
    // 5. Групповое чтение множества ключей
    console.log("5. Групповое чтение ключей...");
    const keysToRead = [1n, 2n, 3n, 42n, 5n]; // 42n не существует
    const readResults = await readDbi.getBatch(keysToRead);
    console.log("Результат чтения:");
    readResults.forEach(r => {
      console.log(`  Ключ ${r.key}: ${r.found ? r.value : 'НЕ НАЙДЕН'}`);
    });
    
    await r.commit();
    
    // 6. Создаем транзакцию для удаления
    console.log("6. Создаем транзакцию для удаления...");
    const d = await env.startWrite();
    const delDbi = await d.openMap({ keyMode: keyMode.ordinal });
    
    // 7. Групповое удаление ключей
    console.log("7. Групповое удаление ключей...");
    const keysToDelete = [2n, 4n, 42n]; // 42n не существует
    const deleteResults = await delDbi.delBatch(keysToDelete);
    console.log("Результат удаления:");
    deleteResults.forEach(r => {
      console.log(`  Ключ ${r.key}: ${r.deleted ? 'УДАЛЕН' : 'НЕ НАЙДЕН'}`);
    });
    
    await d.commit();
    
    // 8. Проверяем финальное состояние
    console.log("8. Проверяем финальное состояние...");
    const final = await env.startRead();
    const finalDbi = await final.openMap({ keyMode: keyMode.ordinal });
    
    const allKeys = [1n, 2n, 3n, 4n, 5n];
    const finalResults = await finalDbi.getBatch(allKeys);
    console.log("Финальное состояние:");
    finalResults.forEach(r => {
      console.log(`  Ключ ${r.key}: ${r.found ? r.value : 'ОТСУТСТВУЕТ'}`);
    });
    
    await final.commit();
    
    await env.close();
    console.log("Тест завершен успешно!");
    
  } catch (error) {
    console.error("Ошибка теста:", error);
  } finally {
    try {
      await env.terminate();
    } catch (e) {
      console.error("Ошибка при завершении:", e.message);
    }
  }
})();
