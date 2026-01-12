"use strict";

const fs = require("fs");
const MDBX = require("../lib/nativemou.js");
const { MDBX_Env, MDBX_Param } = MDBX;

const { keyMode, keyFlag, valueFlag, dbMode } = MDBX_Param;

const dbPath = "./keysTest-db";
const KEY_COUNT = 1024;

async function test() {
    console.log(`=== Keys Test with ${KEY_COUNT} records ===\n`);

    // Cleanup
    await fs.promises.rm(dbPath, { recursive: true, force: true });

    const env = new MDBX_Env();
    await env.open({
        path: dbPath,
        valueFlag: valueFlag.string,
        maxDbi: 10 // для именованных таблиц
    });

    // ============ Test 1: Ordinal keys (Number) ============
    console.log("--- Test 1: Ordinal keys (Number) ---");
    let ordinalDbi;
    {
        const txn = env.startWrite();
        ordinalDbi = txn.createMap("ordinal_keys", keyMode.ordinal);
        
        for (let i = 0; i < KEY_COUNT; i++) {
            ordinalDbi.put(txn, i, `value_${i}`);
        }
        txn.commit();
        console.log(`Inserted ${KEY_COUNT} ordinal records`);
    }

    // Sync keys test (Number keys)
    {
        const txn = env.startRead();
        const dbi = txn.openMap("ordinal_keys", keyMode.ordinal); // number -> keys as Number
        const syncKeys = dbi.keys(txn);
        txn.commit();

        console.log(`Sync keys count: ${syncKeys.length}`);
        console.log(`First 5: [${syncKeys.slice(0, 5).join(", ")}]`);
        console.log(`Last 5: [${syncKeys.slice(-5).join(", ")}]`);

        let ok = true;
        for (let i = 0; i < syncKeys.length; i++) {
            if (syncKeys[i] !== i) {
                console.error(`SYNC ERROR at ${i}: expected ${i}, got ${syncKeys[i]}`);
                ok = false;
                break;
            }
        }
        if (ok && syncKeys.length === KEY_COUNT) {
            console.log(`✓ Sync ordinal keys (Number): all ${KEY_COUNT} verified`);
        } else if (syncKeys.length !== KEY_COUNT) {
            console.error(`✗ Sync: expected ${KEY_COUNT} keys, got ${syncKeys.length}`);
        }
    }

    // Sync keys test (BigInt keys)
    {
        const txn = env.startRead();
        const dbi = txn.openMap("ordinal_keys", BigInt(keyMode.ordinal)); // BigInt -> keys as BigInt
        const syncKeys = dbi.keys(txn);
        txn.commit();

        let ok = true;
        for (let i = 0; i < syncKeys.length; i++) {
            if (syncKeys[i] !== BigInt(i)) {
                console.error(`SYNC BigInt ERROR at ${i}: expected ${i}n, got ${syncKeys[i]}`);
                ok = false;
                break;
            }
        }
        if (ok && syncKeys.length === KEY_COUNT) {
            console.log(`✓ Sync ordinal keys (BigInt): all ${KEY_COUNT} verified`);
        }
    }

    // Async keys test
    {
        const asyncKeys = await env.keys(ordinalDbi);
        console.log(`Async keys count: ${asyncKeys.length}`);

        let ok = true;
        for (let i = 0; i < asyncKeys.length; i++) {
            if (asyncKeys[i] !== i) {
                console.error(`ASYNC ERROR at ${i}: expected ${i}, got ${asyncKeys[i]}`);
                ok = false;
                break;
            }
        }
        if (ok && asyncKeys.length === KEY_COUNT) {
            console.log(`✓ Async ordinal keys: all ${KEY_COUNT} verified`);
        } else if (asyncKeys.length !== KEY_COUNT) {
            console.error(`✗ Async: expected ${KEY_COUNT} keys, got ${asyncKeys.length}`);
        }
    }

    // ============ Test 2: String keys (named dbi) ============
    console.log("\n--- Test 2: String keys ---");
    let stringDbi;
    {
        const txn = env.startWrite();
        // именованная таблица со string ключами (keyFlag наследуется от env)
        stringDbi = txn.createMap("string_keys");
        
        for (let i = 0; i < KEY_COUNT; i++) {
            const key = `key_${String(i).padStart(5, "0")}`;
            stringDbi.put(txn, key, `value_${i}`);
        }
        txn.commit();
        console.log(`Inserted ${KEY_COUNT} string records`);
    }

    // Sync keys test
    {
        const txn = env.startRead();
        const dbi = txn.openMap("string_keys");
        const syncKeys = dbi.keys(txn);
        txn.commit();

        console.log(`Sync keys count: ${syncKeys.length}`);
        console.log(`First 3: [${syncKeys.slice(0, 3).map(k => k.toString()).join(", ")}]`);
        console.log(`Last 3: [${syncKeys.slice(-3).map(k => k.toString()).join(", ")}]`);

        let ok = true;
        for (let i = 0; i < syncKeys.length; i++) {
            const expected = `key_${String(i).padStart(5, "0")}`;
            const actual = syncKeys[i].toString();
            if (actual !== expected) {
                console.error(`SYNC ERROR at ${i}: expected "${expected}", got "${actual}"`);
                ok = false;
                break;
            }
        }
        if (ok && syncKeys.length === KEY_COUNT) {
            console.log(`✓ Sync string keys: all ${KEY_COUNT} verified`);
        } else if (syncKeys.length !== KEY_COUNT) {
            console.error(`✗ Sync: expected ${KEY_COUNT} keys, got ${syncKeys.length}`);
        }
    }

    // Async keys test
    {
        const asyncKeys = await env.keys(stringDbi);
        console.log(`Async keys count: ${asyncKeys.length}`);

        let ok = true;
        for (let i = 0; i < asyncKeys.length; i++) {
            const expected = `key_${String(i).padStart(5, "0")}`;
            const actual = asyncKeys[i].toString();
            if (actual !== expected) {
                console.error(`ASYNC ERROR at ${i}: expected "${expected}", got "${actual}"`);
                ok = false;
                break;
            }
        }
        if (ok && asyncKeys.length === KEY_COUNT) {
            console.log(`✓ Async string keys: all ${KEY_COUNT} verified`);
        } else if (asyncKeys.length !== KEY_COUNT) {
            console.error(`✗ Async: expected ${KEY_COUNT} keys, got ${asyncKeys.length}`);
        }
    }

    // ============ Test 3: Large batch test (exceeds MDBX_BATCH_LIMIT) ============
    console.log("\n--- Test 3: Large batch (5000 records) ---");
    const LARGE_COUNT = 5000;
    let largeDbi;
    {
        const txn = env.startWrite();
        largeDbi = txn.createMap("large_batch", keyMode.ordinal);
        
        for (let i = 0; i < LARGE_COUNT; i++) {
            largeDbi.put(txn, i, `v${i}`);
        }
        txn.commit();
        console.log(`Inserted ${LARGE_COUNT} records`);
    }

    // Sync
    {
        const txn = env.startRead();
        const dbi = txn.openMap("large_batch", keyMode.ordinal);
        const syncKeys = dbi.keys(txn);
        txn.commit();

        if (syncKeys.length === LARGE_COUNT) {
            // Verify first and last (Number keys)
            const firstOk = syncKeys[0] === 0;
            const lastOk = syncKeys[LARGE_COUNT - 1] === LARGE_COUNT - 1;
            if (firstOk && lastOk) {
                console.log(`✓ Sync large batch: ${LARGE_COUNT} keys verified`);
            } else {
                console.error(`✗ Sync large batch: boundary check failed`);
            }
        } else {
            console.error(`✗ Sync: expected ${LARGE_COUNT}, got ${syncKeys.length}`);
        }
    }

    // Async
    {
        const asyncKeys = await env.keys(largeDbi);
        if (asyncKeys.length === LARGE_COUNT) {
            const firstOk = asyncKeys[0] === 0;
            const lastOk = asyncKeys[LARGE_COUNT - 1] === LARGE_COUNT - 1;
            if (firstOk && lastOk) {
                console.log(`✓ Async large batch: ${LARGE_COUNT} keys verified`);
            } else {
                console.error(`✗ Async large batch: boundary check failed`);
            }
        } else {
            console.error(`✗ Async: expected ${LARGE_COUNT}, got ${asyncKeys.length}`);
        }
    }

    // Cleanup
    await env.close();
    await fs.promises.rm(dbPath, { recursive: true, force: true });

    console.log("\n=== All keys tests completed ===");
}

test().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
