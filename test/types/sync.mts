import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import native, {
  MDBX_Env, MDBX_Param, type MDBXCursorMode, type MDBX_Dbi,
  type MDBXQueryRequest, type MDBXQueryResultItem,
  type MDBXQueryRowResult, type MDBXQueryResult,
} from "mdbxmou";

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
  const legacyArray: Promise<MDBXQueryResultItem[] | MDBXQueryResultItem[][]> = env.query([base, base]);
  const oneRowArray: Promise<MDBXQueryResultItem[] | MDBXQueryResultItem[][]> = env.query([base]);
  const mixed: Promise<MDBXQueryResult> = env.query([{ ...base, result: false }, base]);
  const genericArray: Promise<MDBXQueryResult> = env.query([request]);
  const unionResult: Promise<MDBXQueryResult> = env.query(union);
  // @ts-expect-error mixed batches can contain undefined or return a single row directly
  const wrongMixed: Promise<MDBXQueryResultItem[][]> = env.query([{ ...base, result: false }, base]);
  // @ts-expect-error result is a boolean, not a numeric switch
  env.query({ ...base, result: 0 });
  // @ts-expect-error result belongs to write query requests, not keys options
  env.keys({ dbi, result: false });
  void [noItems, wrongItems, echoed, defaultEcho, undefinedEcho, wrongUndefined,
    dynamic, wrongDynamic, genericRow, legacyArray, oneRowArray, mixed,
    genericArray, unionResult, wrongMixed];
}
void queryResultTypes;
