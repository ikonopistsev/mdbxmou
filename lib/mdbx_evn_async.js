"use strict";
const { Worker } = require("worker_threads");
const workerFile = require.resolve("./mdbx_worker.js");
let nextReqId = 1;
let nextTxnId = 1;
let nextDbiId = 1;

class MDBX_Async_Env {
  constructor() {
    this.worker = null;
    // Ожидающие запросы: id -> { resolve, reject }
    this.pending = new Map();
    this.envOpened = false;
  }

  _createWorker() {
    const w = new Worker(workerFile);
    
    // Обработка ответов
    w.on("message", (m) => {
      const p = this.pending.get(m.id);
      if (!p) return; // неизвестный или уже очищенный
      this.pending.delete(m.id);
      if (m.ok) {
        p.resolve(m.result);
      } else {
        p.reject(new Error(m.error));
      }
    });
    
    // Обработка ошибок воркера
    w.on("error", (e) => {
      for (const [id, p] of this.pending) {
        p.reject(e);
        this.pending.delete(id);
      }
    });
    
    // При выходе воркера
    w.on("exit", (code) => {
      if (code !== 0) {
        const err = new Error(`worker exited with code ${code}`);
        for (const [id, p] of this.pending) {
          p.reject(err);
          this.pending.delete(id);
        }
      }
    });
    
    return w;
  }

  _dispatch(cmd, params) {
    const id = nextReqId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, cmd, params });
      } catch (e) {
        // Если отправка упала синхронно, чистим
        if (this.pending.get(id)) this.pending.delete(id);
        reject(e);
      }
    });
  }

  async open(opts) {
    if (this.envOpened) throw new Error("env already open");
    if (!this.worker) {
      this.worker = this._createWorker();
    }
    await this._dispatch("env_open", opts);
    this.envOpened = true;
  }

  async close() {
    if (!this.envOpened) return;
    await this._dispatch("env_close");
    this.envOpened = false;
  }

  async terminate() {
    // Сначала закрываем env если открыт
    if (this.envOpened) {
      await this.close();
    }
    
    // Отменяем все ожидающие запросы
    const cancelError = new Error("Environment terminated");
    for (const [id, p] of this.pending) {
      p.reject(cancelError);
    }
    this.pending.clear();
    
    // Завершаем worker
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }

  async startWrite() {
    if (!this.worker) throw new Error("Environment not opened");
    const txnId = nextTxnId++;
    await this._dispatch("txn_begin", { txnId, mode: "write" });
    return new Txn_Proxy(this, txnId, true);
  }

  async startRead() {
    if (!this.worker) throw new Error("Environment not opened");
    const txnId = nextTxnId++;
    await this._dispatch("txn_begin", { txnId, mode: "read" });
    return new Txn_Proxy(this, txnId, false);
  }
}

class Txn_Proxy {
  constructor(env, txnId, write) {
    this._env = env;
    this._txnId = txnId;
    this._write = write;
    this._closed = false;
  }

  _call(cmd, params) {
    if (this._closed) return Promise.reject(new Error("txn closed"));
    return this._env._dispatch(cmd, { txnId: this._txnId, ...params });
  }

  async openMap(opts = {}) {
    // opts: { name, keyMode, valMode, flags, create }
    const dbiId = nextDbiId++;
    const result = await this._call("map_open", {
      dbiId,
      name: opts.name || null,
      keyMode: opts.keyMode ?? 0,
      valMode: opts.valMode ?? 0,
      flags: opts.flags ?? 0,
      create: !!opts.create
    });
    return new Dbi_Proxy(this, dbiId, result.meta);
  }

  put(...args) { throw new Error("Use dbi.put()"); }

  async commit() {
    if (this._closed) return;
    await this._call("txn_commit");
    this._closed = true;
  }

  async abort() {
    if (this._closed) return;
    await this._call("txn_abort");
    this._closed = true;
  }
}

class Dbi_Proxy {
  constructor(tx, dbiId, meta) {
    this._tx = tx;
    this._dbiId = dbiId;
    this.meta = meta;
  }

  _call(cmd, params) {
    return this._tx._call(cmd, { dbiId: this._dbiId, ...params });
  }

  put(key, value, flags = 0) {
    return this._call("dbi_put", { key, value, flags });
  }

  get(key) {
    return this._call("dbi_get", { key });
  }

  del(key) {
    return this._call("dbi_del", { key });
  }

  stat() {
    return this._call("dbi_stat", {});
  }

  forEach(cb) {
    // Потоково: worker возвращает батчи
    return this._call("dbi_iter_all", {}).then(arr => {
      arr.forEach((kv, i) => cb(kv.key, kv.value, i));
    });
  }

  // Групповые операции
  getBatch(keys) {
    // Читаем множество ключей одной командой
    return this._call("dbi_get_batch", { keys });
  }

  putBatch(items, flags = 0) {
    // Записываем множество пар ключ-значение одной командой
    // items: [{ key, value }, ...]
    return this._call("dbi_put_batch", { items, flags });
  }

  delBatch(keys) {
    // Удаляем множество ключей одной командой
    return this._call("dbi_del_batch", { keys });
  }
}

module.exports = { MDBX_Async_Env };
