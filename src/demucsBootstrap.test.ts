import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";

import { demucsAssetForPlatform, demucsPaths } from "./demucsBootstrap.js";

test("demucsAssetForPlatform selects pinned release assets", () => {
  assert.equal(
    demucsAssetForPlatform("darwin", "arm64").archive,
    "demucs-aarch64-apple-darwin.tar.gz",
  );
  assert.equal(
    demucsAssetForPlatform("linux", "x64").binaryName,
    "demucs",
  );
  assert.equal(
    demucsAssetForPlatform("win32", "x64").binaryName,
    "demucs.exe",
  );
  assert.match(
    demucsAssetForPlatform("darwin", "arm64").sha256,
    /^[a-f0-9]{64}$/,
  );
  assert.throws(
    () => demucsAssetForPlatform("darwin", "x64"),
    /not available for darwin\/x64/,
  );
});

test("demucsPaths keeps the managed binary in extension storage", () => {
  const mac = demucsPaths("/extension-storage", "darwin");
  assert.equal(mac.binPath, path.join("/extension-storage", "bin", "demucs"));
  assert.equal(
    mac.versionPath,
    path.join("/extension-storage", "bin", "demucs-version.txt"),
  );

  const windows = demucsPaths("C:\\storage", "win32");
  assert.equal(path.basename(windows.binPath), "demucs.exe");
});
