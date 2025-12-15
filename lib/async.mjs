import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MDBX_Async_Env } = require("./mdbx_evn_async.js");

export { MDBX_Async_Env };
export default MDBX_Async_Env;
