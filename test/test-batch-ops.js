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
    
    console.log("\n=== Тест с двумя базами данных ===");
    
    // Открываем заново для multi-database теста
    await env.open({ path: testPath });
    
    // 1. Создаем транзакцию и две базы данных
    console.log("1. Создаем транзакцию и две базы...");
    const multiW = await env.startWrite();
    const oddDbi = await multiW.openMap({ 
      name: "odd_numbers", 
      keyMode: keyMode.ordinal, 
      create: true 
    });
    const evenDbi = await multiW.openMap({ 
      name: "even_numbers", 
      keyMode: keyMode.ordinal, 
      create: true 
    });
    
    // 2. Заполняем начальными данными
    console.log("2. Заполняем начальными данными...");
    const oddInitial = [
      { key: 1n, value: "один" },
      { key: 3n, value: "три" },
      { key: 5n, value: "пять" }
    ];
    const evenInitial = [
      { key: 2n, value: "два" },
      { key: 4n, value: "четыре" }
    ];
    
    const oddResults = await oddDbi.putBatch(oddInitial);
    const evenResults = await evenDbi.putBatch(evenInitial);
    
    console.log("Нечетные числа записаны:", oddResults.every(r => r.success));
    console.log("Четные числа записаны:", evenResults.every(r => r.success));
    
    // 3. Добавляем дополнительные данные в ту же транзакцию
    console.log("3. Добавляем дополнительные числа...");
    const oddAdditional = [
      { key: 7n, value: "семь" },
      { key: 9n, value: "девять" }
    ];
    const evenAdditional = [
      { key: 6n, value: "шесть" },
      { key: 8n, value: "восемь" }
    ];
    
    await oddDbi.putBatch(oddAdditional);
    await evenDbi.putBatch(evenAdditional);
    
    console.log("Дополнительные числа добавлены");
    
    // 4. Коммитим всё одной транзакцией
    console.log("4. Коммитим обе базы одной транзакцией...");
    await multiW.commit();
    
    // 5. Проверяем результаты в обеих базах
    console.log("5. Проверяем результаты...");
    const checkR = await env.startRead();
    const checkOddDbi = await checkR.openMap({ 
      name: "odd_numbers", 
      keyMode: keyMode.ordinal 
    });
    const checkEvenDbi = await checkR.openMap({ 
      name: "even_numbers", 
      keyMode: keyMode.ordinal 
    });
    
    // Читаем все нечетные числа
    const oddKeys = [1n, 3n, 5n, 7n, 9n];
    const oddFinalResults = await checkOddDbi.getBatch(oddKeys);
    console.log("База нечетных чисел:");
    oddFinalResults.forEach(r => {
      console.log(`  ${r.key}: ${r.found ? r.value : 'ОТСУТСТВУЕТ'}`);
    });
    
    // Читаем все четные числа
    const evenKeys = [2n, 4n, 6n, 8n];
    const evenFinalResults = await checkEvenDbi.getBatch(evenKeys);
    console.log("База четных чисел:");
    evenFinalResults.forEach(r => {
      console.log(`  ${r.key}: ${r.found ? r.value : 'ОТСУТСТВУЕТ'}`);
    });
    
    await checkR.commit();
    
    // 6. Тест межбазовых операций в одной транзакции
    console.log("6. Тест межбазовых операций...");
    const crossW = await env.startWrite();
    const crossOddDbi = await crossW.openMap({ 
      name: "odd_numbers", 
      keyMode: keyMode.ordinal 
    });
    const crossEvenDbi = await crossW.openMap({ 
      name: "even_numbers", 
      keyMode: keyMode.ordinal 
    });
    
    // Удаляем некоторые числа из обеих баз
    console.log("Удаляем 5 из нечетных и 4 из четных...");
    await crossOddDbi.delBatch([5n]);
    await crossEvenDbi.delBatch([4n]);
    
    // Добавляем новые числа
    console.log("Добавляем 11 в нечетные и 10 в четные...");
    await crossOddDbi.putBatch([{ key: 11n, value: "одиннадцать" }]);
    await crossEvenDbi.putBatch([{ key: 10n, value: "десять" }]);
    
    await crossW.commit();
    
    // 7. Финальная проверка
    console.log("7. Финальная проверка всех баз...");
    const finalCheckR = await env.startRead();
    const finalOddDbi = await finalCheckR.openMap({ 
      name: "odd_numbers", 
      keyMode: keyMode.ordinal 
    });
    const finalEvenDbi = await finalCheckR.openMap({ 
      name: "even_numbers", 
      keyMode: keyMode.ordinal 
    });
    
    const allOddKeys = [1n, 3n, 5n, 7n, 9n, 11n];
    const allEvenKeys = [2n, 4n, 6n, 8n, 10n];
    
    const finalOddResults = await finalOddDbi.getBatch(allOddKeys);
    const finalEvenResults = await finalEvenDbi.getBatch(allEvenKeys);
    
    console.log("Финальное состояние нечетных:");
    finalOddResults.forEach(r => {
      console.log(`  ${r.key}: ${r.found ? r.value : 'УДАЛЕНО'}`);
    });
    
    console.log("Финальное состояние четных:");
    finalEvenResults.forEach(r => {
      console.log(`  ${r.key}: ${r.found ? r.value : 'УДАЛЕНО'}`);
    });
    
    await finalCheckR.commit();
    
    await env.close();
    console.log("Тест с двумя базами завершен успешно!");
    
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
