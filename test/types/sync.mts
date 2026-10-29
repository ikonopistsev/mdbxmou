import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { MDBX_Native } from "mdbxmou/types";

import native, {
  MDBX_Env, MDBX_Param, type MDBXCursorMode, type MDBX_Dbi, type MDBX_Cursor,
  type MDBXQueryRequest, type MDBXQueryResultItem,
  type MDBXQueryRowResult, type MDBXQueryResult,
} from "mdbxmou";
const nativeTypes: MDBX_Native = native;
void nativeTypes;

const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mdbxmou-ts-"));
const dbPath = path.join(tmp, "e4");

const env = new MDBX_Env();
await env.open({ path: dbPath, valueFlag: MDBX_Param.valueFlag.string });

const w = env.startWrite();
const dbi = w.createMap(MDBX_Param.keyMode.ordinal);
dbi.put(w, 1, "one");
dbi.put(w, 2, "two");
// @ts-expect-error value must not be an object
dbi.put(w, 3, { bad: true });
const dup = w.createMap("dup", MDBX_Param.keyMode.ordinal, MDBX_Param.valueMode.multiOrdinal);
dup.put(w, 1, 10);
dup.put(w, 1, 20n);
const checkpointed: boolean = w.checkpoint();
void checkpointed;
w.commitAndStartRead();
w.abort();

const r = env.startRead();
const dbi2 = r.openMap(BigInt(MDBX_Param.keyMode.ordinal));
const v = dbi2.get(r, 2n);
v?.toString();

const cursorMode: MDBXCursorMode = "keyGreaterOrEqual";
dbi2.forEach(r, 0n, cursorMode, (_k, _val) => false);
r.commit();

const keys = await env.keys(dbi2);
keys.length;

const result = await env.query({
  dbi: dbi2,
  mode: MDBX_Param.queryMode.get,
  item: [{ key: 1n }, { key: 2n }]
});
result.length;

await env.query({
  dbi,
  mode: MDBX_Param.queryMode.upsert,
  putFlag: MDBX_Param.putFlag.noOverwrite,
  item: [{ key: 3, value: "three" }]
});

await env.close();

void native.MDBX_Param.envFlag.validation;

// Compile-only checks for every query result overload and rejected narrowing.
function queryResultTypes(env: MDBX_Env, dbi: MDBX_Dbi, flag: boolean,
  request: MDBXQueryRequest, union: MDBXQueryRequest | MDBXQueryRequest[]) {
  const base = { dbi, mode: MDBX_Param.queryMode.upsert, item: [{ key: "key", value: "value" }] };
  const suppressed = env.query({ ...base, result: false });
  const noItems: Promise<undefined> = suppressed;
  // @ts-expect-error suppressed writes return undefined, never an item array
  const wrongItems: Promise<MDBXQueryResultItem[]> = suppressed;

  const echoed: Promise<MDBXQueryResultItem[]> = env.query({ ...base, result: true });
  const defaultEcho: Promise<MDBXQueryResultItem[]> = env.query(base);
  const undefinedEcho: Promise<MDBXQueryResultItem[]> = env.query({ ...base, result: undefined });
  // @ts-expect-error explicit echo cannot be narrowed to undefined
  const wrongUndefined: Promise<undefined> = env.query({ ...base, result: true });

  const dynamic: Promise<MDBXQueryRowResult> = env.query({ ...base, result: flag });
  // @ts-expect-error a dynamic boolean may suppress the write response
  const wrongDynamic: Promise<MDBXQueryResultItem[]> = env.query({ ...base, result: flag });
  const genericRow: Promise<MDBXQueryRowResult> = env.query(request);
  // @ts-expect-error a general request can suppress its result
  const wrongGenericRow: Promise<MDBXQueryResultItem[]> = env.query(request);
  const legacyArray: Promise<MDBXQueryResultItem[] | MDBXQueryResultItem[][]> = env.query([base, base]);
  const oneRowArray: Promise<MDBXQueryResultItem[] | MDBXQueryResultItem[][]> = env.query([base]);
  // @ts-expect-error even a one-row array can return its items directly
  const wrongOneRowArray: Promise<MDBXQueryResultItem[][]> = env.query([base]);
  // @ts-expect-error a general echo array can return nested arrays
  const wrongLegacyArray: Promise<MDBXQueryResultItem[]> = env.query([base, base]);
  const mixed: Promise<MDBXQueryResult> = env.query([{ ...base, result: false }, base]);
  const genericArray: Promise<MDBXQueryResult> = env.query([request]);
  // @ts-expect-error generic array rows can have undefined results
  const wrongGenericArray: Promise<MDBXQueryResultItem[] | MDBXQueryResultItem[][]> = env.query([request]);
  const unionResult: Promise<MDBXQueryResult> = env.query(union);
  // @ts-expect-error the union fallback must include suppressed rows
  const wrongUnion: Promise<MDBXQueryResultItem[] | MDBXQueryResultItem[][]> = env.query(union);
  // @ts-expect-error mixed batches can contain undefined or return a single row directly
  const wrongMixed: Promise<MDBXQueryResultItem[][]> = env.query([{ ...base, result: false }, base]);
  // @ts-expect-error result is a boolean, not a numeric switch
  env.query({ ...base, result: 0 });
  // @ts-expect-error result belongs to write query requests, not keys options
  env.keys({ dbi, result: false });
  void [noItems, wrongItems, echoed, defaultEcho, undefinedEcho, wrongUndefined,
    dynamic, wrongDynamic, genericRow, legacyArray, oneRowArray, mixed,
    genericArray, unionResult, wrongMixed, wrongGenericRow, wrongOneRowArray,
    wrongLegacyArray, wrongGenericArray, wrongUnion];
}
void queryResultTypes;

function queryStackTypes(env: MDBX_Env, dbi: MDBX_Dbi) {
  const result: Promise<MDBXQueryResult> = env.query([
    { dbi, push: true, result: false, item: [{ key: Buffer.from("key") }] },
    { dbi, mode: MDBX_Param.queryMode.upsert, item: [{ key: { peek: 0 }, value: { pop: true } }] },
  ]);
  const suppressed: Promise<undefined> = env.query({ dbi, result: false, item: [{ key: { pop: true } }] });
  // @ts-expect-error operands select one operation
  env.query({ dbi, item: [{ key: { pop: true, peek: 0 } }] });
  // @ts-expect-error pop must be true
  env.query({ dbi, item: [{ key: { pop: false } }] });
  // @ts-expect-error push is a boolean
  env.query({ dbi, push: 1, item: [] });
  void [result, suppressed];
}
void queryStackTypes;

function rawCurrentTypes(cursor: MDBX_Cursor<string, string>) {
  const row = cursor.current_raw();
  const key: Buffer | undefined = row?.key;
  const value: Buffer | undefined = row?.value;
  const typed: string | undefined = cursor.current()?.value;
  // @ts-expect-error raw getter always returns bytes
  const wrong: string | undefined = row?.key;
  // @ts-expect-error current no longer accepts an options object
  cursor.current({ raw: true });
  // @ts-expect-error raw getter takes no options
  cursor.current_raw({ raw: false });
  void [key, value, typed, wrong];
}
void rawCurrentTypes;

function bulkTypes(cursor: ReturnType<ReturnType<typeof env.startWrite>["openCursor"]>) {
  const count: bigint = cursor.deleteRange(null, false);
  const count2: bigint = cursor.deleteRange(cursor);
  const count3: bigint = cursor.deleteBunch(MDBX_Param.bunchAction.beforeIncluding);
  // @ts-expect-error count is not a JS Number
  const wrong: number = cursor.deleteBunch(MDBX_Param.bunchAction.whole);
  // @ts-expect-error inclusion flag must be boolean
  cursor.deleteRange(cursor, 1);
  void [count, count2, count3, wrong];
}
void bulkTypes;

async function queryBulkTypes(env: InstanceType<typeof MDBX_Env>, dbi: ReturnType<ReturnType<typeof env.startWrite>["createMap"]>) {
  const result = await env.query({op: "bulk", dbi, action: "range", from: null, to: "z", push: ["count", "firstKey"]});
  const count: bigint = result.count;
  const key: Buffer | undefined = result.first?.key;
  const suppressed: undefined = await env.query({op: "bulk", dbi, action: MDBX_Param.bunchAction.whole, result: false});
  void env.query({op: "bulk", dbi, action: "range", from: {pop: true}, to: {peek: 0}});
  void env.query({op: "bulk", dbi, action: MDBX_Param.bunchAction.beforeIncluding, key: {pop: true}});
  // @ts-expect-error helpers are not part of the query API
  env.query({op: "compute", value: Buffer.alloc(0), push: true, result: false});
  // @ts-expect-error conditions are not part of the query API
  env.query({dbi, when: 1n, item: []});
  // @ts-expect-error byte expressions are not query operands
  env.query({dbi, item: [{key: "k", value: {parts: [Buffer.alloc(0)]}}]});
  // @ts-expect-error unknown bulk output name
  env.query({op: "bulk", dbi, action: "range", push: ["oops"]});
  // @ts-expect-error bulk uses named outputs, not boolean push
  env.query({op: "bulk", dbi, action: "range", push: true});
  void [count, key, suppressed];
}
void queryBulkTypes;

function seekBothTypes(cursor: MDBX_Cursor<string, Buffer>) {
  const row = cursor.seekBoth("key", Buffer.from("value"));
  const key: string | undefined = row?.key;
  const value: Buffer | undefined = row?.value;
  // @ts-expect-error value is required
  cursor.seekBoth("key");
  // @ts-expect-error key must match cursor key type
  cursor.seekBoth(1, "value");
  // @ts-expect-error object is not a value
  cursor.seekBoth("key", {});
  void [key, value];
}
void seekBothTypes;

function dbRawTypes(txn: ReturnType<MDBX_Env["startRead"]>) {
  const db = txn.openMap({ name: "raw-types", valueFlag: MDBX_Param.valueFlag.string });
  const raw: Buffer | undefined = db.get_raw(txn, "key");
  // @ts-expect-error raw never returns a string, regardless of DBI presentation
  const wrong: string | undefined = db.get_raw(txn, "key");
  // @ts-expect-error transaction is required
  db.get_raw("key");
  // @ts-expect-error objects are not keys
  db.get_raw(txn, {});
  void [raw, wrong];
}
void dbRawTypes;
