import native = require("mdbxmou");
import type { MDBX_Native, MDBX_Cursor } from "mdbxmou/types";
const nativeTypes: MDBX_Native = native;
void nativeTypes;
const { MDBX_Env, MDBX_Param } = native;
const { MDBX_Async_Env } = require("mdbxmou/async");

const env = new MDBX_Env();
void MDBX_Param.envFlag.validation;
void MDBX_Async_Env;
void env;

function stackTypes(txn: ReturnType<typeof env.startWrite>) {
  const dbi = txn.createMap("stack-types");
  const operand: native.MDBXQueryOperand = { pop: true };
  void env.query([
    { dbi, push: true, result: false, item: [{ key: Buffer.from("k") }] },
    { dbi, mode: MDBX_Param.queryMode.upsert, item: [{ key: Buffer.from("copy"), value: operand }] },
  ]);
}
void stackTypes;

function rawCurrentTypes(cursor: ReturnType<ReturnType<typeof env.startWrite>["openCursor"]>) {
  const row = cursor.current_raw();
  const key: Buffer | undefined = row?.key;
  const value: Buffer | undefined = row?.value;
  const typed = cursor.current()?.value;
  void [key, value, typed];
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
