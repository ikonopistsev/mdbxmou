/// <reference types="node" />

export type MDBXKey = Buffer | string | number | bigint;
export type MDBXValue = Buffer | string | number | bigint;

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
  /**
   * Track non-empty buffers borrowed through `getView()` and detach them when
   * their transaction commits or aborts. Defaults to `true`. Empty values have
   * no borrowed MDBX pointer and return an ordinary zero-length view.
   *
   * Set to `false` only for a measured hot path. In that mode callers must
   * drop every borrowed view before transaction completion and never access it
   * afterwards.
   */
  trackBorrowedViews?: boolean;
}

declare const mdbxBorrowedView: unique symbol;

/**
 * Read-only TypeScript surface for the standard `DataView` returned by
 * `MDBX_Dbi.getView()`.
 *
 * For a non-empty value, the bytes belong to the active read transaction. With
 * the default tracking mode, commit or abort detaches the borrowed backing
 * `ArrayBuffer`. An empty value has no borrowed MDBX pointer and returns an
 * ordinary zero-length view. The runtime value is still a normal mutable
 * `DataView`; setter methods are omitted here to express the supported
 * contract.
 */
export interface MDBX_BorrowedView {
  readonly [mdbxBorrowedView]: true;
  readonly buffer: ArrayBuffer;
  readonly byteOffset: number;
  readonly byteLength: number;

  getInt8(byteOffset: number): number;
  getUint8(byteOffset: number): number;
  getInt16(byteOffset: number, littleEndian?: boolean): number;
  getUint16(byteOffset: number, littleEndian?: boolean): number;
  getInt32(byteOffset: number, littleEndian?: boolean): number;
  getUint32(byteOffset: number, littleEndian?: boolean): number;
  getBigInt64(byteOffset: number, littleEndian?: boolean): bigint;
  getBigUint64(byteOffset: number, littleEndian?: boolean): bigint;
  getFloat32(byteOffset: number, littleEndian?: boolean): number;
  getFloat64(byteOffset: number, littleEndian?: boolean): number;
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

export interface MDBXMapOptions {
  name?: string;
  keyFlag?: number;
  valueFlag?: number;
  keyMode?: number | bigint;
  valueMode?: number;
  flags?: number;
  create?: boolean;
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
  /**
   * Borrow raw MDBX value bytes without copying or applying `valueFlag`
   * decoding. Requires an active read-only transaction and an environment
   * without `MDBX_WRITEMAP`.
   *
   * The returned view is valid only until `txn.commit()` or `txn.abort()`.
   * Missing keys return `undefined`; empty values return an ordinary
   * zero-length view without a borrowed MDBX pointer. Do not transfer a
   * borrowed backing buffer to another JavaScript isolate.
   */
  getView(txn: MDBX_Txn, key: K): MDBX_BorrowedView | undefined;
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
  flags(txn: MDBX_Txn): number;
  keys(txn: MDBX_Txn): K[];
  keysFrom(txn: MDBX_Txn, fromKey: K, limit?: number, cursorMode?: MDBXCursorMode): K[];
  getRange(txn: MDBX_Txn, options?: MDBXRangeOptions<K>): MDBXCursorResult<K, V>[];
  getCount(txn: MDBX_Txn, options?: MDBXRangeOptions<K>): number;
  keysRange(txn: MDBX_Txn, options?: MDBXRangeOptions<K>): K[];
  valuesRange(txn: MDBX_Txn, options?: MDBXRangeOptions<K>): V[];
  drop(txn: MDBX_Txn, deleteDb?: boolean): void;
}

export interface MDBX_Txn {
  commit(): void;
  /**
   * Commit an active write transaction and keep this wrapper active over the
   * exact post-commit read snapshot.
   *
   * Complete the resulting read transaction before starting another write
   * transaction on the same thread.
   *
   * If this method throws and `isActive()` is false, the write may already be
   * committed even though the read transaction could not be created. Verify
   * the result with a fresh read before retrying the write.
   */
  commitAndStartRead(): void;
  /**
   * Commit the current write batch and immediately continue the same wrapper
   * as a write transaction without releasing the writer lock.
   *
   * Matches mdbx++ boolean semantics: returns false after committing changes
   * and true when the transaction has no changes. Finish the continuation
   * transaction promptly because it blocks every other writer. Every call
   * invalidates borrowed views, including a no-op call that returns true.
   */
  checkpoint(): boolean;
  abort(): void;

  openMap(keyMode: number | bigint): MDBX_Dbi;
  openMap(name: string): MDBX_Dbi;
  openMap(name: string, keyMode: number | bigint): MDBX_Dbi;
  openMap(options: MDBXMapOptions): MDBX_Dbi;

  createMap(keyMode: number | bigint): MDBX_Dbi;
  createMap(name: string): MDBX_Dbi;
  createMap(keyMode: number | bigint, valueMode: number): MDBX_Dbi;
  createMap(name: string, keyMode: number | bigint): MDBX_Dbi;
  createMap(name: string, keyMode: number | bigint, valueMode: number): MDBX_Dbi;
  createMap(options: MDBXMapOptions): MDBX_Dbi;

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
  /**
   * Write queries only: false skips returning the written key/value items.
   * Omitted/undefined defaults to true in the first release with this flag;
   * the next planned minor release defaults writes to false. Explicit true
   * always returns items. Get/del and keys keep their current results.
   */
  result?: boolean;
  item: MDBXQueryItem[];
}

export interface MDBXQueryResultItem {
  key: MDBXKey;
  value?: MDBXValue | null;
  found?: boolean;
}

export type MDBXQueryRowResult = MDBXQueryResultItem[] | undefined;
/** Single-row input returns a row directly; multiple rows retain undefined slots. */
export type MDBXQueryResult = MDBXQueryRowResult | MDBXQueryRowResult[];

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

  /**
   * Throws synchronously while transactions, query/keys, or an async copy are active,
   * or with "operation in progress" during async open/close.
   */
  close(): Promise<void>;
  closeSync(): void;

  /**
   * Copies a native MVCC snapshot; defaults to copyFlag.compact.
   * Transactions, query/keys and syncEx may continue during the async copy.
   * While copying, close, another copy and setOption throw synchronously.
   * The snapshot starts in native work and may retain old pages/reader slots.
   */
  copyTo(path: string, flags?: number): Promise<void>;
  /** Synchronous copy; throws synchronously if an async copy is active. */
  copyToSync(path: string, flags?: number): void;

  version(): string;

  startRead(): MDBX_Txn;
  startWrite(): MDBX_Txn;

  /**
   * Commits the entire batch before resolving. Write rows with result:false
   * return undefined without copying their input items back to JavaScript.
   * An array of one request also returns the row directly; mixed batches keep
   * an own undefined slot for every suppressed write row. Validation throws
   * synchronously, and native transaction failures reject the Promise.
   */
  query(request: MDBXQueryRequest & { result: false }, txnMode?: number): Promise<undefined>;
  query(request: MDBXQueryRequest & { result?: true }, txnMode?: number): Promise<MDBXQueryResultItem[]>;
  query(request: MDBXQueryRequest, txnMode?: number): Promise<MDBXQueryRowResult>;
  query(request: (MDBXQueryRequest & { result?: true })[], txnMode?: number): Promise<MDBXQueryResultItem[] | MDBXQueryResultItem[][]>;
  query(request: MDBXQueryRequest[], txnMode?: number): Promise<MDBXQueryResult>;
  query(request: MDBXQueryRequest | MDBXQueryRequest[], txnMode?: number): Promise<MDBXQueryResult>;
  keys(request: MDBXKeysRequest | MDBXKeysRequest[], txnMode?: number): Promise<MDBXKeysResult>;
  /**
   * syncPeriod expects seconds and may be fractional; other options use integer values.
   * Throws while an async copy or open/close is in progress, or the environment is closed.
   */
  setOption(option: number, value: number | bigint): void;
  /**
   * Returns 0 (MDBX_SUCCESS) or -1 (MDBX_RESULT_TRUE, nothing to sync).
   * Both are successful results; real errors still throw, including MDBX_BUSY
   * when nonblock=true cannot acquire the writer lock, and read-only or closed environments.
   * Use (true, false) to force and wait for synchronization of committed data.
   * With force=false, the environment's sync policy and autosync thresholds apply;
   * a successful return, including 0, does not guarantee that all pending data was flushed.
   * Allowed during async copying; rejected while async open/close is in progress.
   */
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
    readonly mergeThreshold: number;
    readonly mergeThreshold16dot16Percent: number;
    readonly writethroughThreshold: number;
    readonly prefaultWriteEnable: number;
    readonly gcTimeLimit: number;
    readonly preferWafInsteadofBalance: number;
    readonly subpageLimit: number;
    readonly subpageRoomThreshold: number;
    readonly subpageReservePrereq: number;
    readonly subpageReserveLimit: number;
    readonly splitReserve: number;
  };

  readonly copyFlag: {
    readonly defaults: number;
    readonly compact: number;
    readonly overwrite: number;
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
    readonly number: number;
    readonly bigint: number;
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
