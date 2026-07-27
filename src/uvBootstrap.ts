import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { runProcess } from "./process.js";

const UV_RELEASE = "0.11.32";
const RELEASE_BASE =
  `https://github.com/astral-sh/uv/releases/download/${UV_RELEASE}`;

export interface UvAsset {
  archive: string;
  sha256: string;
  format: "tar.gz" | "zip";
  nestedDir: string;
}

const ASSETS: Record<string, UvAsset> = {
  "darwin-arm64": {
    archive: "uv-aarch64-apple-darwin.tar.gz",
    sha256: "ed336d0ba49db8ef89b2b41fffa372ce63bd032f22a56f001c265891aec32829",
    format: "tar.gz",
    nestedDir: "uv-aarch64-apple-darwin",
  },
  "darwin-x64": {
    archive: "uv-x86_64-apple-darwin.tar.gz",
    sha256: "77f5ca26c0de20e992a3677a174fe1121ee25c36f9b1434a863f75bf077a05eb",
    format: "tar.gz",
    nestedDir: "uv-x86_64-apple-darwin",
  },
  "linux-arm64": {
    archive: "uv-aarch64-unknown-linux-gnu.tar.gz",
    sha256: "4d4fa08d95b06642e5800df6a22bd71455f23f988269e18da2847971d8c0bf31",
    format: "tar.gz",
    nestedDir: "uv-aarch64-unknown-linux-gnu",
  },
  "linux-x64": {
    archive: "uv-x86_64-unknown-linux-gnu.tar.gz",
    sha256: "aab924fd522efd06f1c5f3b93a243864fc453132c94b2dc49f1371b528a4b967",
    format: "tar.gz",
    nestedDir: "uv-x86_64-unknown-linux-gnu",
  },
  "win32-x64": {
    archive: "uv-x86_64-pc-windows-msvc.zip",
    sha256: "acfde570451cfdb8689fa159a138ee805ba4e241c466432750302c86254b0984",
    format: "zip",
    nestedDir: "uv-x86_64-pc-windows-msvc",
  },
  "win32-arm64": {
    archive: "uv-aarch64-pc-windows-msvc.zip",
    sha256: "a7427ea0440bb826b6716d1837ff3d173b8e7d496cb09ee8f456b4e023a2fdcd",
    format: "zip",
    nestedDir: "uv-aarch64-pc-windows-msvc",
  },
};

export function uvAssetForPlatform(
  platform: NodeJS.Platform = os.platform(),
  arch: string = os.arch(),
): UvAsset {
  const asset = ASSETS[`${platform}-${arch}`];
  if (!asset) {
    throw new Error(`Managed uv is not available for ${platform}/${arch}.`);
  }
  return asset;
}

export interface UvPaths {
  binDir: string;
  binPath: string;
  versionPath: string;
}

export function uvPaths(
  storageDir: string,
  platform: NodeJS.Platform = os.platform(),
): UvPaths {
  const binDir = path.join(storageDir, "bin");
  return {
    binDir,
    binPath: path.join(binDir, platform === "win32" ? "uv.exe" : "uv"),
    versionPath: path.join(binDir, "uv-version.txt"),
  };
}

async function readText(file: string): Promise<string | null> {
  try {
    return (await fsp.readFile(file, "utf8")).trim();
  } catch {
    return null;
  }
}

async function downloadVerifiedFile(
  url: string,
  destination: string,
  expectedSha256: string,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, {
    ...(signal ? { signal } : {}),
    headers: { "User-Agent": "online-audio-import" },
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    throw new Error(`uv download failed (HTTP ${response.status}).`);
  }

  const total = Number(response.headers.get("content-length") || 0);
  const hash = createHash("sha256");
  const reader = response.body.getReader();
  const file = await fsp.open(destination, "w");
  let received = 0;
  let lastReported = -1;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) throw new Error("aborted");
      await file.write(value);
      hash.update(value);
      received += value.byteLength;
      if (total > 0 && onProgress) {
        const pct = Math.min(99, Math.round((received / total) * 100));
        if (pct >= lastReported + 5) {
          lastReported = pct;
          onProgress(pct);
        }
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    await file.close();
  }

  const actualSha256 = hash.digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error("The downloaded uv binary failed its security check.");
  }
}

function runCommand(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin} exited with code ${code}`));
    });
  });
}

async function extractArchive(
  archivePath: string,
  destinationDir: string,
  format: UvAsset["format"],
): Promise<void> {
  if (format === "tar.gz") {
    await runCommand("tar", ["-xzf", archivePath, "-C", destinationDir]);
    return;
  }
  if (os.platform() === "win32") {
    await runCommand("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`,
    ]);
    return;
  }
  await runCommand("unzip", ["-o", archivePath, "-d", destinationDir]);
}

async function clearMacOSQuarantine(binPath: string): Promise<void> {
  if (os.platform() !== "darwin") return;
  try {
    await new Promise<void>((resolve) => {
      const child = spawn("xattr", ["-d", "com.apple.quarantine", binPath]);
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });
  } catch {
    /* ignore */
  }
}

async function systemUvPath(): Promise<string | null> {
  const result = await runProcess(
    os.platform() === "win32" ? "where" : "which",
    ["uv"],
  ).catch(() => null);
  if (!result || result.code !== 0) return null;
  const first = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first || null;
}

const activeInstalls = new Map<string, Promise<string>>();

/**
 * Prefer a system `uv`, otherwise download a verified standalone binary into
 * extension storage.
 */
export function ensureUv(
  storageDir: string,
  opts?: {
    onStatus?: (message: string, pct?: number) => void;
    signal?: AbortSignal;
  },
): Promise<string> {
  const key = path.join(storageDir, "uv");
  const active = activeInstalls.get(key);
  if (active) return active;

  const installation = (async () => {
    const system = await systemUvPath();
    if (system) {
      opts?.onStatus?.("Python tool runner ready", 100);
      return system;
    }

    const paths = uvPaths(storageDir);
    await fsp.mkdir(paths.binDir, { recursive: true });
    const installed =
      fs.existsSync(paths.binPath) &&
      (await readText(paths.versionPath)) === UV_RELEASE;
    if (installed) {
      opts?.onStatus?.("Python tool runner ready", 100);
      return paths.binPath;
    }

    const asset = uvAssetForPlatform();
    const archivePath = path.join(paths.binDir, `${asset.archive}.partial`);
    const extractDir = path.join(paths.binDir, "uv-extract");
    await fsp.rm(archivePath, { force: true });
    await fsp.rm(extractDir, { recursive: true, force: true });
    opts?.onStatus?.("Downloading Python tool runner…", 0);

    try {
      await downloadVerifiedFile(
        `${RELEASE_BASE}/${asset.archive}`,
        archivePath,
        asset.sha256,
        (pct) => opts?.onStatus?.("Downloading Python tool runner…", pct),
        opts?.signal,
      );
      if (opts?.signal?.aborted) throw new Error("aborted");

      opts?.onStatus?.("Installing Python tool runner…", 99);
      await fsp.mkdir(extractDir, { recursive: true });
      await extractArchive(archivePath, extractDir, asset.format);

      const extractedBinary = path.join(
        extractDir,
        asset.nestedDir,
        os.platform() === "win32" ? "uv.exe" : "uv",
      );
      const flatBinary = path.join(
        extractDir,
        os.platform() === "win32" ? "uv.exe" : "uv",
      );
      const source = fs.existsSync(extractedBinary)
        ? extractedBinary
        : flatBinary;
      if (!fs.existsSync(source)) {
        throw new Error("uv archive did not contain the expected binary.");
      }
      await fsp.rm(paths.binPath, { force: true });
      await fsp.rename(source, paths.binPath);
      if (os.platform() !== "win32") await fsp.chmod(paths.binPath, 0o755);
      await clearMacOSQuarantine(paths.binPath);
      await fsp.writeFile(paths.versionPath, UV_RELEASE, "utf8");
      opts?.onStatus?.("Python tool runner ready", 100);
      return paths.binPath;
    } finally {
      await fsp.rm(archivePath, { force: true }).catch(() => {});
      await fsp.rm(extractDir, { recursive: true, force: true }).catch(() => {});
    }
  })().finally(() => {
    activeInstalls.delete(key);
  });

  activeInstalls.set(key, installation);
  return installation;
}
