import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const DEMUCS_RELEASE = "v0.3.4";
const RELEASE_BASE =
  `https://github.com/nikhilunni/demucs-rs/releases/download/${DEMUCS_RELEASE}`;

export interface DemucsAsset {
  archive: string;
  sha256: string;
  binaryName: string;
  format: "tar.gz" | "zip";
}

const ASSETS: Record<string, DemucsAsset> = {
  "darwin-arm64": {
    archive: "demucs-aarch64-apple-darwin.tar.gz",
    sha256: "bb6a6346392892ef3f172df0b60d97f4cb54aa38f7306ec129a60d786d261225",
    binaryName: "demucs",
    format: "tar.gz",
  },
  "linux-x64": {
    archive: "demucs-x86_64-unknown-linux-gnu.tar.gz",
    sha256: "38bb1edb812bdf7a22116cb71b0e3473662b12064b3d8c8e7a6a56507c9a867d",
    binaryName: "demucs",
    format: "tar.gz",
  },
  "win32-x64": {
    archive: "demucs-x86_64-pc-windows-msvc.zip",
    sha256: "67e77186295a00758df0b760f3345fd0b9081b328f923ecc35307f6190f472d1",
    binaryName: "demucs.exe",
    format: "zip",
  },
};

export function demucsAssetForPlatform(
  platform: NodeJS.Platform = os.platform(),
  arch: string = os.arch(),
): DemucsAsset {
  const asset = ASSETS[`${platform}-${arch}`];
  if (!asset) {
    throw new Error(
      `Stem separation is not available for ${platform}/${arch}.`,
    );
  }
  return asset;
}

export interface DemucsPaths {
  binDir: string;
  binPath: string;
  versionPath: string;
  noticePath: string;
}

export function demucsPaths(
  storageDir: string,
  platform: NodeJS.Platform = os.platform(),
): DemucsPaths {
  const binDir = path.join(storageDir, "bin");
  const binaryName = platform === "win32" ? "demucs.exe" : "demucs";
  return {
    binDir,
    binPath: path.join(binDir, binaryName),
    versionPath: path.join(binDir, "demucs-version.txt"),
    noticePath: path.join(binDir, "demucs-NOTICE.txt"),
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
    throw new Error(`Stem separator download failed (HTTP ${response.status}).`);
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
    throw new Error("The downloaded stem separator failed its security check.");
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
  format: DemucsAsset["format"],
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
    /* The downloaded file normally has no quarantine attribute. */
  }
}

function demucsNotice(asset: DemucsAsset): string {
  return [
    "demucs-rs",
    "",
    `Binary release: ${DEMUCS_RELEASE}`,
    `Binary asset: ${asset.archive}`,
    `SHA-256: ${asset.sha256}`,
    `Binary source: https://github.com/nikhilunni/demucs-rs/releases/tag/${DEMUCS_RELEASE}`,
    "Project: https://github.com/nikhilunni/demucs-rs",
    "License: Apache License 2.0",
    "License text: https://github.com/nikhilunni/demucs-rs/blob/main/LICENSE",
    "",
    "Model weights download from Hugging Face on first stem separation and are",
    "cached by demucs-rs under the system cache directory (demucs-rs).",
    "",
    "demucs-rs is a separate program and is not covered by Online Audio's MIT license.",
    "",
  ].join("\n");
}

const activeInstalls = new Map<string, Promise<string>>();

/**
 * Ensure a verified demucs-rs binary exists under storageDir.
 * Downloaded on the first stem import and reused afterward.
 */
export function ensureDemucs(
  storageDir: string,
  opts?: {
    onStatus?: (message: string, pct?: number) => void;
    signal?: AbortSignal;
  },
): Promise<string> {
  const paths = demucsPaths(storageDir);
  const active = activeInstalls.get(paths.binPath);
  if (active) return active;

  const installation = (async () => {
    await fsp.mkdir(paths.binDir, { recursive: true });
    const installed =
      fs.existsSync(paths.binPath) &&
      (await readText(paths.versionPath)) === DEMUCS_RELEASE;
    if (installed) return paths.binPath;

    const asset = demucsAssetForPlatform();
    const archivePath = path.join(paths.binDir, `${asset.archive}.partial`);
    await fsp.rm(archivePath, { force: true });
    opts?.onStatus?.("Downloading stem separator…", 0);

    try {
      await downloadVerifiedFile(
        `${RELEASE_BASE}/${asset.archive}`,
        archivePath,
        asset.sha256,
        (pct) => opts?.onStatus?.("Downloading stem separator…", pct),
        opts?.signal,
      );
      if (opts?.signal?.aborted) throw new Error("aborted");

      opts?.onStatus?.("Installing stem separator…", 99);
      const extractedPath = path.join(paths.binDir, asset.binaryName);
      await fsp.rm(extractedPath, { force: true });
      await fsp.rm(paths.binPath, { force: true });
      await extractArchive(archivePath, paths.binDir, asset.format);
      if (!fs.existsSync(extractedPath)) {
        throw new Error("Stem separator archive did not contain the expected binary.");
      }
      if (extractedPath !== paths.binPath) {
        await fsp.rename(extractedPath, paths.binPath);
      }
      if (os.platform() !== "win32") await fsp.chmod(paths.binPath, 0o755);
      await clearMacOSQuarantine(paths.binPath);
      await fsp.writeFile(paths.versionPath, DEMUCS_RELEASE, "utf8");
      await fsp.writeFile(paths.noticePath, demucsNotice(asset), "utf8");
      opts?.onStatus?.("Stem separator ready", 100);
      return paths.binPath;
    } finally {
      await fsp.rm(archivePath, { force: true }).catch(() => {});
    }
  })().finally(() => {
    activeInstalls.delete(paths.binPath);
  });

  activeInstalls.set(paths.binPath, installation);
  return installation;
}
