import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const native = require("./nativemou.js");
const { MDBX_Async_Env } = require("./mdbx_evn_async.js");

export const MDBX_Env = native.MDBX_Env;
export const MDBX_Param = native.MDBX_Param;
export { MDBX_Async_Env };

export default native;
