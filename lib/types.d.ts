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

/** Result of cursor navigation/search operations */
export interface MDBXCursorResult<K extends MDBXKey = MDBXKey, V extends MDBXValue = MDBXValue> {
  key: K;
  value: V;
}

export interface MDBXRangeOptions<K extends MDBXKey = MDBXKey> {
  start?: K;
  end?: K;
  limit?: number;
  offset?: number;
  reverse?: boolean;
  includeStart?: boolean;
  includeEnd?: boolean;
}

/**
 * Database cursor for sequential access and range queries.
 * Must be closed before transaction commit/abort.
 * @example
 * ```js
 * const cursor = txn.openCursor(dbi);
 * for (let item = cursor.first(); item; item = cursor.next()) {
 *   console.log(item.key, item.value);
 * }
 * cursor.close();
 * txn.commit();
 * ```
 */
export interface MDBX_Cursor<K extends MDBXKey = MDBXKey, V extends MDBXValue = MDBXValue> {
  /** Move to first record. Returns undefined if database is empty. */
  first(): MDBXCursorResult<K, V> | undefined;
  /** Move to last record. Returns undefined if database is empty. */
  last(): MDBXCursorResult<K, V> | undefined;
  /** Move to next record. Returns undefined if at end. */
  next(): MDBXCursorResult<K, V> | undefined;
  /** Move to previous record. Returns undefined if at beginning. */
  prev(): MDBXCursorResult<K, V> | undefined;
  /** Get current record without moving cursor. */
  current(): MDBXCursorResult<K, V> | undefined;
  
  /**
   * Seek to exact key match.
   * @param key - The key to find
   * @returns Record if found, undefined otherwise
   */
  seek(key: K): MDBXCursorResult<K, V> | undefined;
  
  /**
   * Seek to key >= given key (lower_bound semantics).
   * @param key - The key to search from
   * @returns First record with key >= given key, undefined if none
   */
  seekGE(key: K): MDBXCursorResult<K, V> | undefined;
  
  /**
   * Insert or update a key-value pair.
   * @param key - The key
   * @param value - The value (Buffer or string)
   * @param flags - Optional MDBX put flags
   */
  put(key: K, value: MDBXValue, flags?: number): void;
  
  /**
   * Delete record at current cursor position.
   * @param flags - Optional MDBX delete flags
   * @returns true if deleted, false if not found
   */
  del(flags?: number): boolean;
  
  /**
   * Iterate over all records.
   * @param callback - Called for each record. Return true to stop iteration.
   * @param backward - If true, iterate from last to first
   * @example
   * ```js
   * cursor.forEach(({key, value}) => {
   *   console.log(key, value);
   *   if (key === 'stop') return true; // stop iteration
   * });
   * ```
   */
  forEach(callback: (item: MDBXCursorResult<K, V>) => boolean | void, backward?: boolean): void;
  
  /** 
   * Check if cursor is at end-of-data (beyond first or last record).
   * @returns true if cursor has no valid position
   */
  eof(): boolean;
  
  /** 
   * Check if cursor is on first record in database.
   * @returns true if on first record
   */
  onFirst(): boolean;
  
  /** 
   * Check if cursor is on last record in database.
   * @returns true if on last record
   */
  onLast(): boolean;
  
  /** 
   * Check if cursor is on first value of current key (DUPSORT databases).
   * @returns true if on first value for current key
   */
  onFirstMultival(): boolean;
  
  /** 
   * Check if cursor is on last value of current key (DUPSORT databases).
   * @returns true if on last value for current key
   */
  onLastMultival(): boolean;
  
  /** 
   * Close cursor. Must be called before transaction commit/abort.
   * Safe to call multiple times.
   */
  close(): void;
}

export interface MDBX_Dbi<K extends MDBXKey = MDBXKey, V extends MDBXValue = MDBXValue> {
  readonly id: bigint;
  readonly dbMode: number;
  readonly keyMode: number;
  readonly valueMode: number;
  readonly keyFlag: number;
  readonly valueFlag: number;

  put(txn: MDBX_Txn, key: K, value: MDBXValue, flags?: number): void;
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
  getRange(txn: MDBX_Txn, options?: MDBXRangeOptions<K>): MDBXCursorResult<K, V>[];
  keysRange(txn: MDBX_Txn, options?: MDBXRangeOptions<K>): K[];
  valuesRange(txn: MDBX_Txn, options?: MDBXRangeOptions<K>): V[];
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

  /** Open a cursor for the given dbi */
  openCursor<K extends MDBXKey = MDBXKey, V extends MDBXValue = MDBXValue>(
    dbi: MDBX_Dbi<K, V>
  ): MDBX_Cursor<K, V>;

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
  putFlag?: number;
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
  /** syncPeriod expects seconds and may be fractional; other options use integer values. */
  setOption(option: number, value: number | bigint): void;
  syncEx(force: boolean, nonblock: boolean): number;
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

  readonly envOption: {
    readonly maxDb: number;
    readonly maxReaders: number;
    readonly syncBytes: number;
    readonly syncPeriod: number;
    readonly rpAugmentLimit: number;
    readonly looseLimit: number;
    readonly dpReserveLimit: number;
    readonly txnDpLimit: number;
    readonly txnDpInitial: number;
    readonly spillMaxDenominator: number;
    readonly spillMinDenominator: number;
    readonly spillParent4childDenominator: number;
    readonly mergeThreshold16dot16Percent: number;
    readonly writethroughThreshold: number;
    readonly prefaultWriteEnable: number;
    readonly gcTimeLimit: number;
    readonly preferWafInsteadofBalance: number;
    readonly subpageLimit: number;
    readonly subpageRoomThreshold: number;
    readonly subpageReservePrereq: number;
    readonly subpageReserveLimit: number;
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

  readonly putFlag: {
    readonly noOverwrite: number;
    readonly noDupData: number;
    readonly current: number;
    readonly allDups: number;
    readonly reserve: number;
    readonly append: number;
    readonly appendDup: number;
    readonly multiple: number;
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

/** Runtime constants exported by the native module. */
export declare const MDBX_Param: MDBX_Param;

export interface MDBX_Native {
  MDBX_Env: typeof MDBX_Env;
  MDBX_Param: typeof MDBX_Param;
}
