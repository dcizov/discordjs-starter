import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createDemo, type DemoState } from "./demo-seed";
// Demo is deliberately single-process. Live services always use PostgreSQL.
const globalStore = globalThis as unknown as {
  orbitDemoLock?: Promise<unknown>;
};
function storePath() {
  return resolve(
    process.env.DEMO_DATA_PATH ??
      join(
        process.cwd().endsWith("/apps/web") ? "../.." : ".",
        ".data",
        "demo.json"
      )
  );
}
async function load(): Promise<DemoState> {
  try {
    return JSON.parse(await readFile(storePath(), "utf8"));
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
    return createDemo();
  }
}
export async function demoTransaction<T>(
  fn: (data: DemoState) => T | Promise<T>
): Promise<T> {
  const previous = globalStore.orbitDemoLock ?? Promise.resolve();
  const result = previous
    .catch(() => {})
    .then(async () => {
      const data = await load();
      const value = await fn(data);
      const p = storePath();
      await mkdir(resolve(p, ".."), { recursive: true });
      const temp = `${p}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
      await rename(temp, p);
      return value;
    });
  globalStore.orbitDemoLock = result.catch(() => {});
  return result;
}
export async function demoRead(): Promise<DemoState> {
  await (globalStore.orbitDemoLock ?? Promise.resolve());
  try {
    return JSON.parse(await readFile(storePath(), "utf8"));
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
    return demoTransaction((d) => structuredClone(d));
  }
}
