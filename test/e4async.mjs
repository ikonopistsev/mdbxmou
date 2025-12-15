import fs from "node:fs";

import { MDBX_Env, MDBX_Param } from "mdbxmou";
import { MDBX_Async_Env } from "mdbxmou/async";

async function main() {
  const path = "e4async";

  await fs.promises.rm(path, { recursive: true, force: true }).catch(() => {});

  const env = new MDBX_Env();
  await env.open({ path, valueFlag: MDBX_Param.valueFlag.string });

  try {
    const wtxn = env.startWrite();
    const dbi = wtxn.createMap(MDBX_Param.keyMode.ordinal);
    for (let i = 0; i < 10; i++) {
      dbi.put(wtxn, i, `value_${i}`);
    }
    wtxn.commit();

    const result = await env.query([
      {
        dbi,
        mode: MDBX_Param.queryMode.get,
        item: [{ key: 0 }, { key: 1n }, { key: 2n }],
      },
      {
        dbi,
        mode: MDBX_Param.queryMode.get,
        item: [{ key: 3n }, { key: 4n }, { key: 5n }],
      },
    ]);
    const json = JSON.stringify(result, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    console.log("query", json);
  } finally {
    await env.close();
  }

  const asyncEnv = new MDBX_Async_Env(1);
  try {
    await asyncEnv.open({ path });

    const rtxn = await asyncEnv.startRead();
    const rdbi = await rtxn.openMap({ keyMode: MDBX_Param.keyMode.ordinal });
    const v = await rdbi.get(2n);
    if (v !== "value_2") {
      throw new Error(`Unexpected value: ${v}`);
    }
    await rtxn.commit();

    await asyncEnv.close();
  } finally {
    await asyncEnv.terminate();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
