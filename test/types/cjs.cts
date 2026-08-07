import native = require("mdbxmou");
import type { MDBX_BorrowedView } from "mdbxmou";

const { MDBX_Env, MDBX_Param } = native;
const { MDBX_Async_Env } = require("mdbxmou/async");

const env = new MDBX_Env();
const txn = env.startRead();
const dbi = txn.openMap({});
const view: MDBX_BorrowedView | undefined = dbi.getView(txn, "key");
view?.getUint8(0);
// @ts-expect-error borrowed views intentionally omit mutable DataView setters
view?.setUint8(0, 1);
void MDBX_Param.envFlag.validation;
void MDBX_Async_Env;
void env;
