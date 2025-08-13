"use strict";
const fs = require("fs");
const { MDBX_Async_Env } = require("../lib/mdbx_evn_async.js");
const MDBX = require("../lib/nativemou.js");
const { MDBX_Param } = MDBX;

(async () => {
  const testPath = "async-test-db";
  await fs.promises.rm(testPath, { recursive: true, force: true }).catch(() => {});
  
  // Создаем среду с параметрами и количеством worker'ов
  const envOptions = { 
    path: testPath, 
    envFlag: MDBX_Param.envFlag.nostickythreads 
  };
  const env = new MDBX_Async_Env(1);
  
  // Обработка сигналов для корректного завершения
  const cleanup = async () => {
    console.log("\nReceived interrupt signal, cleaning up...");
    try {
      await env.terminate();
      console.log("Cleanup completed");
    } catch (e) {
      console.error("Cleanup error:", e.message);
    }
    process.exit(0);
  };
  
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  
  try {
    await env.open({ path: testPath });

    const { keyMode } = MDBX_Param;

    // write txn
    const w = await env.startWrite();
    const dbi = await w.openMap({ keyMode: keyMode.ordinal, create: true });
    await dbi.put(1n, "one");
    await dbi.put(2n, "two");
    await w.commit();

    // read txn – может уйти в другой worker
    const r = await env.startRead();
    const dbi2 = await r.openMap({ keyMode: keyMode.ordinal });
    const v = await dbi2.get(2n);
    console.log("get(2) =", v);
    await r.commit();

    await env.close();
    console.log("Database closed");
    
    // Завершаем все worker'ы
    await env.terminate();
    console.log("Workers terminated");
  } catch (error) {
    console.error("Test failed:", error);
    try {
      await env.terminate();
    } catch (e) {
      console.error("Cleanup error:", e.message);
    }
    process.exit(1);
  }
})();