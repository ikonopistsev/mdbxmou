/// <reference types="node" />

export type MDBXKey = Buffer | string | number | bigint;
export type MDBXValue = Buffer | string;

export type MDBXCursorMode =
  | number
  | "first"
  | "last"
  | "next"
  | "prev"
  | "keyLesser"
  | "keyLesserThan"
  | "key_lesser_than"
  | "keyLesserOrEqual"
  | "key_lesser_or_equal"
  | "keyEqual"
  | "key_equal"
  | "keyGreaterOrEqual"
  | "key_greater_or_equal"
  | "keyGreater"
  | "keyGreaterThan"
  | "key_greater_than"
  | "multiExactKeyValueLesserThan"
  | "multi_exactkey_value_lesser_than"
  | "multiExactKeyValueLesserOrEqual"
  | "multi_exactkey_value_lesser_or_equal"
  | "multiExactKeyValueEqual"
  | "multi_exactkey_value_equal"
  | "multiExactKeyValueGreaterOrEqual"
  | "multi_exactkey_value_greater_or_equal"
  | "multiExactKeyValueGreater"
  | "multi_exactkey_value_greater";

export interface MDBXEnvGeometryFixed {
  fixedSize: number;
}

export interface MDBXEnvGeometryDynamic {
  dynamicSize: [number, number];
}

export interface MDBXEnvGeometryCustom {
  sizeNow?: number;
  sizeUpper?: number;
  growthStep?: number;
  shrinkThreshold?: number;
  pageSize?: number;
}

export type MDBXEnvGeometry =
  | MDBXEnvGeometryFixed
  | MDBXEnvGeometryDynamic
  | MDBXEnvGeometryCustom;

export interface MDBXEnvOpenOptions {
  path: string;
  flags?: number;
  keyFlag?: number;
  valueFlag?: number;
  maxDbi?: number;
  mode?: number;
  geometry?: MDBXEnvGeometry;
}

export interface MDBXDbiStat {
  pageSize: number;
  depth: number;
  branchPages: number;
  leafPages: number;
  overflowPages: number;
  entries: number;
  modTxnId: number;
}

export interface MDBX_Dbi<K extends MDBXKey = MDBXKey, V extends MDBXValue = MDBXValue> {
  readonly id: bigint;
  readonly dbMode: number;
  readonly keyMode: number;
  readonly valueMode: number;
  readonly keyFlag: number;
  readonly valueFlag: number;

  put(txn: MDBX_Txn, key: K, value: MDBXValue): void;
  get(txn: MDBX_Txn, key: K): V | undefined;
  del(txn: MDBX_Txn, key: K): boolean;
  has(txn: MDBX_Txn, key: K): boolean;

  forEach(txn: MDBX_Txn, cb: (key: K, value: V, index: number) => boolean | void): number;
  forEach(
    txn: MDBX_Txn,
    fromKey: K,
    cb: (key: K, value: V, index: number) => boolean | void
  ): number;
  forEach(
    txn: MDBX_Txn,
    fromKey: K,
    cursorMode: MDBXCursorMode,
    cb: (key: K, value: V, index: number) => boolean | void
  ): number;

  stat(txn: MDBX_Txn): MDBXDbiStat;
  keys(txn: MDBX_Txn): K[];
  keysFrom(txn: MDBX_Txn, fromKey: K, limit?: number, cursorMode?: MDBXCursorMode): K[];
  drop(txn: MDBX_Txn, deleteDb?: boolean): void;
}

export interface MDBX_Txn {
  commit(): void;
  abort(): void;

  openMap(keyMode: number | bigint): MDBX_Dbi;
  openMap(name: string): MDBX_Dbi;
  openMap(name: string, keyMode: number | bigint): MDBX_Dbi;

  createMap(keyMode: number | bigint): MDBX_Dbi;
  createMap(name: string): MDBX_Dbi;
  createMap(keyMode: number | bigint, valueMode: number): MDBX_Dbi;
  createMap(name: string, keyMode: number | bigint): MDBX_Dbi;
  createMap(name: string, keyMode: number | bigint, valueMode: number): MDBX_Dbi;

  isActive(): boolean;
  isTopLevel(): boolean;

  startTransaction?: () => MDBX_Txn;
  getChildrenCount?: () => number;
}

export interface MDBXQueryItem {
  key: MDBXKey;
  value?: MDBXValue;
}

export interface MDBXQueryRequest {
  dbi: MDBX_Dbi;
  mode?: number;
  queryMode?: number;
  item: MDBXQueryItem[];
}

export interface MDBXQueryResultItem {
  key: MDBXKey;
  value?: MDBXValue | null;
  found?: boolean;
}

export type MDBXQueryResult = MDBXQueryResultItem[] | MDBXQueryResultItem[][];

export interface MDBXKeysRequestObject {
  dbi: MDBX_Dbi;
  from?: MDBXKey;
  limit?: number;
  cursorMode?: MDBXCursorMode;
}

export type MDBXKeysRequest = MDBX_Dbi | MDBXKeysRequestObject;
export type MDBXKeysResult = MDBXKey[] | MDBXKey[][];

export declare class MDBX_Env {
  constructor();

  open(options: MDBXEnvOpenOptions): Promise<void>;
  openSync(options: MDBXEnvOpenOptions): void;

  close(): Promise<void>;
  closeSync(): void;

  copyTo(path: string, flags?: number): Promise<void>;
  copyToSync(path: string, flags?: number): void;

  version(): string;

  startRead(): MDBX_Txn;
  startWrite(): MDBX_Txn;

  query(request: MDBXQueryRequest | MDBXQueryRequest[], txnMode?: number): Promise<MDBXQueryResult>;
  keys(request: MDBXKeysRequest | MDBXKeysRequest[], txnMode?: number): Promise<MDBXKeysResult>;
}

export interface MDBX_Param {
  readonly envFlag: {
    readonly validation: number;
    readonly rdonly: number;
    readonly exclusive: number;
    readonly accede: number;
    readonly writemap: number;
    readonly nostickythreads: number;
    readonly nordahead: number;
    readonly nomeminit: number;
    readonly liforeclaim: number;
    readonly nometasync: number;
    readonly safeNosync: number;
    readonly utterlyNosync: number;
  };

  readonly txnMode: {
    readonly ro: number;
  };

  readonly keyMode: {
    readonly reverse: number;
    readonly ordinal: number;
  };

  readonly keyFlag: {
    readonly string: number;
    readonly number: number;
    readonly bigint: number;
  };

  readonly valueMode: {
    readonly multi: number;
    readonly multiReverse: number;
    readonly multiSamelength: number;
    readonly multiOrdinal: number;
    readonly multiReverseSamelength: number;
  };

  readonly valueFlag: {
    readonly string: number;
  };

  readonly dbMode: {
    readonly create: number;
    readonly accede: number;
  };

  readonly queryMode: {
    readonly upsert: number;
    readonly update: number;
    readonly insertUnique: number;
    readonly get: number;
    readonly del: number;
  };

  readonly cursorMode: {
    readonly first: number;
    readonly last: number;
    readonly next: number;
    readonly prev: number;
    readonly keyLesserThan: number;
    readonly keyLesserOrEqual: number;
    readonly keyEqual: number;
    readonly keyGreaterOrEqual: number;
    readonly keyGreaterThan: number;
    readonly multiExactKeyValueLesserThan: number;
    readonly multiExactKeyValueLesserOrEqual: number;
    readonly multiExactKeyValueEqual: number;
    readonly multiExactKeyValueGreaterOrEqual: number;
    readonly multiExactKeyValueGreater: number;
  };
}

export declare const MDBX_Param: MDBX_Param;

export interface MDBX_Native {
  MDBX_Env: typeof MDBX_Env;
  MDBX_Param: MDBX_Param;
}

