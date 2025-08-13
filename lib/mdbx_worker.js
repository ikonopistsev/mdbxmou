"use strict";
const { parentPort } = require("worker_threads");
const MDBX = require("./nativemou.js");
const { MDBX_Env } = MDBX;

// Хранилища
let env = null;
const txns = new Map();   // txnId -> { txn, write }
const dbis = new Map();   // dbiId -> { txnId, dbi }

function ok(id, result) { parentPort.postMessage({ id, ok: true, result }); }
function fail(id, error) { parentPort.postMessage({ id, ok: false, error }); }

async function handler(msg) {
  const { id, cmd, params } = msg;
  try {
    switch (cmd) {
      case "env_open":
        if (env) throw new Error("already open");
        env = new MDBX_Env();
        await env.openSync(params || {});
        return ok(id, true);

      case "env_close":
        if (env) {
          env.closeSync();
          env = null;
          txns.clear();
          dbis.clear();
        }
        return ok(id, true);

      case "txn_begin": {
        if (!env) throw new Error("env not open");
        const { txnId, mode } = params;
        if (txns.has(txnId)) throw new Error("txn exists");
        const txn = (mode === "write") ? env.startWrite() : env.startRead();
        txns.set(txnId, { txn, write: mode === "write" });
        return ok(id, true);
      }

      case "txn_commit": {
        const { txnId } = params;
        const t = txns.get(txnId);
        if (!t) throw new Error("no txn");
        t.txn.commit();
        txns.delete(txnId);
        // удалить связанные dbi
        for (const [k, v] of dbis) if (v.txnId === txnId) dbis.delete(k);
        return ok(id, true);
      }

      case "txn_abort": {
        const { txnId } = params;
        const t = txns.get(txnId);
        if (!t) return ok(id, true);
        if (t.txn.abort) t.txn.abort();
        txns.delete(txnId);
        for (const [k, v] of dbis) if (v.txnId === txnId) dbis.delete(k);
        return ok(id, true);
      }

      case "map_open": {
        const { txnId, dbiId, name, keyMode, valMode, flags, create } = params;
        const t = txns.get(txnId);
        if (!t) throw new Error("no txn");
        let dbi;
        if (create) {
          // createMap принимает (keyMode, valueMode)
          if (valMode !== undefined && valMode !== 0) {
            dbi = t.txn.createMap(keyMode, valMode);
          } else {
            dbi = t.txn.createMap(keyMode);
          }
        } else {
          // openMap для чтения принимает только keyMode
          dbi = t.txn.openMap(keyMode);
        }
        dbis.set(dbiId, { txnId, dbi });
        return ok(id, { meta: { name: name || "", keyMode, valMode } });
      }

      case "dbi_put": {
        const { txnId, dbiId, key, value, flags = 0 } = params;
        const d = dbis.get(dbiId);
        if (!d || d.txnId !== txnId) throw new Error("no dbi");
        d.dbi.put(key, value, flags);
        return ok(id, true);
      }

      case "dbi_get": {
        const { txnId, dbiId, key } = params;
        const d = dbis.get(dbiId);
        if (!d || d.txnId !== txnId) throw new Error("no dbi");
        const val = d.dbi.get(key);
        // Если val это Buffer, преобразуем в строку для удобства
        const result = (val && Buffer.isBuffer(val)) ? val.toString() : val;
        return ok(id, result);
      }

      case "dbi_del": {
        const { txnId, dbiId, key } = params;
        const d = dbis.get(dbiId);
        if (!d || d.txnId !== txnId) throw new Error("no dbi");
        const r = d.dbi.del(key);
        return ok(id, r);
      }

      case "dbi_stat": {
        const { txnId, dbiId } = params;
        const d = dbis.get(dbiId);
        if (!d || d.txnId !== txnId) throw new Error("no dbi");
        return ok(id, d.dbi.stat());
      }

      case "dbi_iter_all": {
        const { txnId, dbiId } = params;
        const d = dbis.get(dbiId);
        if (!d || d.txnId !== txnId) throw new Error("no dbi");
        const out = [];
        d.dbi.forEach((k, v) => {
          out.push({ key: k, value: v });
          return true;
        });
        return ok(id, out);
      }

      case "dbi_get_batch": {
        // Групповое чтение множества ключей
        const { txnId, dbiId, keys } = params;
        const d = dbis.get(dbiId);
        if (!d || d.txnId !== txnId) throw new Error("no dbi");
        
        const results = [];
        for (const key of keys) {
          try {
            const val = d.dbi.get(key);
            if (val !== undefined && val !== null) {
              const result = (val && Buffer.isBuffer(val)) ? val.toString() : val;
              results.push({ key, value: result, found: true });
            } else {
              results.push({ key, value: null, found: false });
            }
          } catch (e) {
            results.push({ key, value: null, found: false });
          }
        }
        return ok(id, results);
      }

      case "dbi_put_batch": {
        // Групповая запись множества пар ключ-значение
        const { txnId, dbiId, items, flags = 0 } = params;
        const d = dbis.get(dbiId);
        if (!d || d.txnId !== txnId) throw new Error("no dbi");
        
        const results = [];
        for (const item of items) {
          try {
            d.dbi.put(item.key, item.value, flags);
            results.push({ key: item.key, success: true });
          } catch (e) {
            results.push({ key: item.key, success: false, error: e.message });
          }
        }
        return ok(id, results);
      }

      case "dbi_del_batch": {
        // Групповое удаление множества ключей
        const { txnId, dbiId, keys } = params;
        const d = dbis.get(dbiId);
        if (!d || d.txnId !== txnId) throw new Error("no dbi");
        
        const results = [];
        for (const key of keys) {
          try {
            const r = d.dbi.del(key);
            results.push({ key, deleted: r });
          } catch (e) {
            results.push({ key, deleted: false, error: e.message });
          }
        }
        return ok(id, results);
      }

      default:
        throw new Error("unknown cmd " + cmd);
    }
  } catch (e) {
    return fail(id, e.message || String(e));
  }
}

parentPort.on("message", handler);
