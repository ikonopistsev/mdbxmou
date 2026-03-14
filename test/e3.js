"use strict";

const fs = require('fs');
const MDBX = require('../lib/nativemou.js');
const { MDBX_Env, MDBX_Param } = MDBX;

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
  const db_dir = 'e3';

  await fs.promises.rm(db_dir, { recursive: true, force: true });

  console.log("MDBX_Param:", MDBX_Param);
  // получаем константы
  const { keyMode, envFlag, envOption } = MDBX_Param;

  const db = new MDBX_Env();

  console.log('Opening database...');

  const buffSize = 4096;
  await db.open({
    path: db_dir,
    flags: envFlag.safeNosync,
    geometry: {
      pageSize: buffSize * 2
    }
  });
  db.setOption(envOption.syncBytes, 4 * 1024 * 1024); // MDBX_opt_syncbytes
  db.setOption(envOption.syncPeriod, 1.23); // syncPeriod in seconds

  const txn = db.startWrite();
  const dbi = txn.createMap(keyMode.ordinal);
  const s = dbi.stat(txn);
  console.log(JSON.stringify(s));
  txn.commit();

  console.log('Start write (memory leak test)');
  const count = Number.parseInt(process.env.E3_COUNT ?? '1000000', 10);
  const reportEveryMs = 5000;
  const reportWrite = createPeriodicReporter({ everyMs: reportEveryMs, total: count, label: 'Write' });
  const reportVerify = createPeriodicReporter({ everyMs: reportEveryMs, total: count, label: 'Verify' });
  console.log(`Start | Memory: ${formatMemoryUsage()}`);
  
  let stat = {};
  for (let i = 0; i < count; i++) {
    const id = i % 10000;
    const txn = db.startWrite();

    // пытаемся читать 
    const val = dbi.get(txn, id);
    if (val) {
      let n = val.readInt32BE(buffSize - 4);
      ++n;
      val.writeInt32BE(n, buffSize - 4);
      dbi.put(txn, id, val);
    } else {
      // иначе просто создаем новый объект
      dbi.put(txn, id, Buffer.alloc(buffSize));
    }
    
    stat = dbi.stat(txn);
    txn.commit();

    reportWrite(i + 1, stat);

    if ((i % 1000) == 0) {
      await sleep(1);
    }
  }

  reportWrite(count, stat);
  
  console.log('Write finish');

  await db.close();
  await maybeRunGC('After close #1');

  await sleep(200);
  console.log(`After close #1 (after 200ms) | Memory: ${formatMemoryUsage()}`);
}

test().catch(console.error);
