"use strict";

const fs = require('fs');
const MDBX = require('../lib/nativemou.js');
const { MDBX_Env, MDBX_Param } = MDBX;
const { v4: uuidv4 } = require("uuid");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes)) return String(bytes);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
};

const formatMemoryUsage = () => {
  const mu = process.memoryUsage();
  return [
    `rss=${formatBytes(mu.rss)}`,
    `heapUsed=${formatBytes(mu.heapUsed)}`,
    `heapTotal=${formatBytes(mu.heapTotal)}`,
    `external=${formatBytes(mu.external)}`,
    `arrayBuffers=${formatBytes(mu.arrayBuffers)}`,
  ].join(' ');
};

const createPeriodicReporter = ({ everyMs, total, label }) => {
  let nextReportAt = Date.now() + everyMs;
  let lastPrintedDone = -1;
  return (done, stat) => {
    if (done === lastPrintedDone) return;
    const now = Date.now();
    if (done < total && now < nextReportAt) return;

    const percent = Math.min(100, (done / total) * 100);
    console.log(`${label}: ${percent.toFixed(2)}% (${done}/${total}) ${JSON.stringify(stat)} | Memory: ${formatMemoryUsage()}`);
    lastPrintedDone = done;

    while (nextReportAt <= now) nextReportAt += everyMs;
  };
};

const normalizeValueToString = (value) => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (Buffer.isBuffer(value)) return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString();
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString();
  return String(value);
};

const maybeRunGC = async (label) => {
  if (typeof global.gc !== 'function') {
    console.log(`${label} | GC: not exposed (run node with --expose-gc) | Memory: ${formatMemoryUsage()}`);
    return;
  }
  global.gc();
  await sleep(0);
  global.gc();
  console.log(`${label} | GC: ok | Memory: ${formatMemoryUsage()}`);
};

const test = async () => {
  const db_dir = 'readKeysTestDB';
  await fs.promises.rm(db_dir, { recursive: true, force: true });

  // получаем константы
  const { keyMode, envFlag } = MDBX_Param;
  const { safeNosync } = envFlag;

  const db = new MDBX_Env();

  console.log('Opening database...');
  await db.open({
      path: db_dir, 
      flags: safeNosync,
    });

  const txn = db.startWrite();
  const dbi = txn.createMap();
  txn.commit();

  await maybeRunGC("After open");

    // заполняем тестовую базу uuid ключами
  console.log('Filling database with test data...');
  {
    const txn = db.startWrite();
    const total = 10;
    for (let i = 0; i < total; i++) {
      const key = uuidv4();
      const value = `value-for-${key}`;
      dbi.put(txn, key, value);
    }
    txn.commit();
  }
  await maybeRunGC("After filled");

    console.log("Start reading keys (memory leak test)");
    const count = 2000000; ///Number.parseInt(process.env.E3_COUNT ?? '100000', 10);
    const reportEveryMs = 5000;
    const reportRead = createPeriodicReporter({
      everyMs: reportEveryMs,
      total: count,
      label: "Read Keys",
    });
    const reportWrite = createPeriodicReporter({
      everyMs: reportEveryMs,
      total: count,
      label: "Write",
    });
    console.log(`Start | Memory: ${formatMemoryUsage()}`);

    let stat = {};
  // теперь просто получаем keys много раз и следим за утечкой памяти
  {
    
    for (let i = 0; i < count; i++) {
      const txn = db.startWrite();
      const keys = dbi.keys(txn);
      stat = dbi.stat(txn);
      txn.abort();

      // нормализуем ключи в строки чтобы избежать утечек памяти из-за буферов
      const normalizedKeys = keys.map(normalizeValueToString);

      reportRead(i + 1, stat);

      if ((i % 1000) == 0) {
        await sleep(1);
      }
    }
  }

  reportWrite(count, stat);
  
  console.log('Write finish');

  await db.close();
  await maybeRunGC('After close #1');

  await sleep(200);
  console.log(`After close #1 (after 200ms) | Memory: ${formatMemoryUsage()}`);

}

test().catch(console.error)
