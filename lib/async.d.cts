import type { MDBXDbiStat, MDBXEnvOpenOptions, MDBXKey, MDBXValue } from "./types";

export interface MDBXAsyncMapOpenOptions {
  name?: string;
  keyMode?: number;
  valMode?: number;
  flags?: number;
  create?: boolean;
}

export interface MDBXAsyncDbiMeta {
  name: string;
  keyMode: number;
  valMode: number;
}

export interface MDBXAsyncGetBatchResultItem {
  key: MDBXKey;
  value: string | null;
  found: boolean;
}

export interface MDBXAsyncPutBatchResultItem {
  key: MDBXKey;
  success: boolean;
  error?: string;
}

export interface MDBXAsyncDelBatchResultItem {
  key: MDBXKey;
  deleted: boolean;
  error?: string;
}

declare class MDBX_Async_Dbi {
  readonly meta: MDBXAsyncDbiMeta;

  put(key: MDBXKey, value: MDBXValue, flags?: number): Promise<boolean>;
  get(key: MDBXKey): Promise<string | null | undefined>;
  del(key: MDBXKey): Promise<boolean>;
  stat(): Promise<MDBXDbiStat>;

  forEach(cb: (key: MDBXKey, value: MDBXValue, index: number) => void): Promise<void>;

  getBatch(keys: MDBXKey[]): Promise<MDBXAsyncGetBatchResultItem[]>;
  putBatch(items: Array<{ key: MDBXKey; value: MDBXValue }>, flags?: number): Promise<MDBXAsyncPutBatchResultItem[]>;
  delBatch(keys: MDBXKey[]): Promise<MDBXAsyncDelBatchResultItem[]>;
}

declare class MDBX_Async_Txn {
  openMap(opts?: MDBXAsyncMapOpenOptions): Promise<MDBX_Async_Dbi>;
  commit(): Promise<void>;
  abort(): Promise<void>;
}

declare class MDBX_Async_Env {
  constructor(workerCount?: number);
  open(opts: MDBXEnvOpenOptions): Promise<void>;
  close(): Promise<void>;
  terminate(): Promise<void>;
  startWrite(): Promise<MDBX_Async_Txn>;
  startRead(): Promise<MDBX_Async_Txn>;
}

declare const exportsCjs: {
  MDBX_Async_Env: typeof MDBX_Async_Env;
};

export = exportsCjs;
