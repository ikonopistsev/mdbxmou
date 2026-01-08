import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import native, { MDBX_Env, MDBX_Param, type MDBXCursorMode } from "mdbxmou";

const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mdbxmou-ts-"));
const dbPath = path.join(tmp, "e4");

const env = new MDBX_Env();
await env.open({ path: dbPath, valueFlag: MDBX_Param.valueFlag.string });

const w = env.startWrite();
const dbi = w.createMap(MDBX_Param.keyMode.ordinal);
dbi.put(w, 1, "one");
dbi.put(w, 2, "two");
// @ts-expect-error value must be Buffer|string
dbi.put(w, 3, 123);
w.commit();

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

await env.close();

void native.MDBX_Param.envFlag.validation;

