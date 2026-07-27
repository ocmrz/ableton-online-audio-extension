import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";

import { uvAssetForPlatform, uvPaths } from "./uvBootstrap.js";

test("uvAssetForPlatform selects pinned release assets", () => {
  assert.equal(
    uvAssetForPlatform("darwin", "arm64").archive,
    "uv-aarch64-apple-darwin.tar.gz",
  );
  assert.equal(
    uvAssetForPlatform("win32", "x64").format,
    "zip",
  );
  assert.match(uvAssetForPlatform("linux", "x64").sha256, /^[a-f0-9]{64}$/);
});

test("uvPaths keeps the managed binary in extension storage", () => {
  const mac = uvPaths("/extension-storage", "darwin");
  assert.equal(mac.binPath, path.join("/extension-storage", "bin", "uv"));
});
