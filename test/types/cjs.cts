import native = require("mdbxmou");
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

