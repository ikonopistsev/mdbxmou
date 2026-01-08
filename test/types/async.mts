import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { MDBX_Param } from "mdbxmou";
import AsyncDefault, { MDBX_Async_Env } from "mdbxmou/async";

const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mdbxmou-ats-"));
const dbPath = path.join(tmp, "async");

const env1 = new MDBX_Async_Env(1);
const env2 = new AsyncDefault();
void env2;

await env1.open({ path: dbPath });

const w = await env1.startWrite();
const dbi = await w.openMap({ keyMode: MDBX_Param.keyMode.ordinal, create: true });
await dbi.put(1n, "one");
await dbi.put(2n, Buffer.from("two"));
// @ts-expect-error value must be Buffer|string
await dbi.put(3n, 123);
await w.commit();

const r = await env1.startRead();
const dbi2 = await r.openMap({ keyMode: MDBX_Param.keyMode.ordinal });
const v = await dbi2.get(2n);
v?.toString();
await r.commit();

await env1.close();
await env1.terminate();

