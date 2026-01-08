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
  return (done) => {
    if (done === lastPrintedDone) return;
    const now = Date.now();
    if (done < total && now < nextReportAt) return;

    const percent = Math.min(100, (done / total) * 100);
    console.log(`${label}: ${percent.toFixed(2)}% (${done}/${total}) | Memory: ${formatMemoryUsage()}`);
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
  const db_dir = 'e3';

  await fs.promises.rm(db_dir, { recursive: true, force: true });

  console.log("MDBX_Param:", MDBX_Param);
  // получаем константы
  const { keyMode } = MDBX_Param;

  const db = new MDBX_Env();

  console.log('Opening database...');

  await db.open({
      path: db_dir
    });

  const txn = db.startWrite();
  const dbi = txn.createMap(keyMode.ordinal);
  txn.commit();

  console.log('Start write (memory leak test)');
  const count = Number.parseInt(process.env.E3_COUNT ?? '10000', 10);
  const reportEveryMs = 5000;
  const reportWrite = createPeriodicReporter({ everyMs: reportEveryMs, total: count, label: 'Write' });
  const reportVerify = createPeriodicReporter({ everyMs: reportEveryMs, total: count, label: 'Verify' });
  console.log(`Start | Memory: ${formatMemoryUsage()}`);
  for (let i = 0; i < count; i++) {
    const txn = db.startWrite();
    dbi.put(txn, i, `value_${i}`);
    txn.commit();
    reportWrite(i + 1);
  }
  reportWrite(count);

  console.log('Start verify read-after-write');
  {
    const rtxn = db.startRead();
    const rdbi = rtxn.openMap(keyMode.ordinal);

    let seen = 0;
    let expectedKey = 0;
    rdbi.forEach(rtxn, (key, value) => {
      const keyNum = typeof key === 'bigint' ? Number(key) : key;
      if (keyNum !== expectedKey) {
        throw new Error(`Verify failed: expected key=${expectedKey}, got key=${String(key)}`);
      }
      const expectedValue = `value_${expectedKey}`;
      const actualValue = normalizeValueToString(value);
      if (actualValue !== expectedValue) {
        throw new Error(`Verify failed: key=${expectedKey}, expected value=${expectedValue}, got value=${actualValue}`);
      }
      expectedKey++;
      seen++;
      reportVerify(seen);
    });

    if (seen !== count) {
      throw new Error(`Verify failed: expected ${count} items, got ${seen}`);
    }

    reportVerify(count);
    rtxn.commit();
  }
  console.log('Verify finish');
  
  console.log('Write finish');

  await db.close();
  await maybeRunGC('After close #1');
  await sleep(200);
  console.log(`After close #1 (after 200ms) | Memory: ${formatMemoryUsage()}`);

  console.log('Reopen database and verify again');
  const db2 = new MDBX_Env();
  await db2.open({ path: db_dir });
  {
    const rtxn = db2.startRead();
    const rdbi = rtxn.openMap(keyMode.ordinal);
    const reportVerify2 = createPeriodicReporter({ everyMs: reportEveryMs, total: count, label: 'Verify(reopen)' });

    let seen = 0;
    let expectedKey = 0;
    rdbi.forEach(rtxn, (key, value) => {
      const keyNum = typeof key === 'bigint' ? Number(key) : key;
      if (keyNum !== expectedKey) {
        throw new Error(`Verify(reopen) failed: expected key=${expectedKey}, got key=${String(key)}`);
      }
      const expectedValue = `value_${expectedKey}`;
      const actualValue = normalizeValueToString(value);
      if (actualValue !== expectedValue) {
        throw new Error(`Verify(reopen) failed: key=${expectedKey}, expected value=${expectedValue}, got value=${actualValue}`);
      }
      expectedKey++;
      seen++;
      reportVerify2(seen);
    });

    if (seen !== count) {
      throw new Error(`Verify(reopen) failed: expected ${count} items, got ${seen}`);
    }

    reportVerify2(count);
    rtxn.commit();
  }
  await db2.close();
  await maybeRunGC('After close #2');
}

test().catch(console.error);
