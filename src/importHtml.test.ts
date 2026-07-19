import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

test("import dialog inline script is valid JavaScript", async () => {
  const html = await fsp.readFile(new URL("./import.html", import.meta.url), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script, { filename: "import.html" }));
});
