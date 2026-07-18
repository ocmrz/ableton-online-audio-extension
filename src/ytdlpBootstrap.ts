import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const RELEASES_API =
  "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface YtDlpPaths {
  binPath: string;
  versionPath: string;
  metaPath: string;
  binDir: string;
}

function assetForPlatform(): { asset: string; fileName: string } {
  const platform = os.platform();
  const arch = os.arch();
  if (platform === "darwin") {
    return { asset: "yt-dlp_macos", fileName: "yt-dlp" };
  }
  if (platform === "win32") {
    if (arch === "arm64") {
      return { asset: "yt-dlp_arm64.exe", fileName: "yt-dlp.exe" };
    }
    return { asset: "yt-dlp.exe", fileName: "yt-dlp.exe" };
  }
  // linux and others
  if (arch === "arm64") {
    return { asset: "yt-dlp_linux_aarch64", fileName: "yt-dlp" };
  }
  return { asset: "yt-dlp_linux", fileName: "yt-dlp" };
}

export function ytDlpPaths(storageDir: string): YtDlpPaths {
  const binDir = path.join(storageDir, "bin");
  const { fileName } = assetForPlatform();
  return {
    binDir,
    binPath: path.join(binDir, fileName),
    versionPath: path.join(binDir, "version.txt"),
    metaPath: path.join(binDir, "last-check.txt"),
  };
}

async function fetchLatestRelease(): Promise<{
  tag: string;
  downloadUrl: string;
}> {
  const { asset } = assetForPlatform();
  const res = await fetch(RELEASES_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "online-audio-import",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub releases HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string }>;
  };
  const match = data.assets.find((a) => a.name === asset);
  if (!match) {
    throw new Error(`No yt-dlp asset named ${asset} for this platform`);
  }
  return { tag: data.tag_name, downloadUrl: match.browser_download_url };
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    ...(signal ? { signal } : {}),
    headers: { "User-Agent": "online-audio-import" },
    redirect: "follow",
  });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed HTTP ${res.status}`);
  }
  const total = Number(res.headers.get("content-length") || 0);
  const tmp = `${dest}.partial`;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const fh = await fsp.open(tmp, "w");
  try {
    let received = 0;
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) throw new Error("aborted");
      await fh.write(value);
      received += value.byteLength;
      if (total > 0 && onProgress) {
        onProgress(Math.min(99, Math.round((received / total) * 100)));
      }
    }
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, dest);
  if (os.platform() !== "win32") {
    await fsp.chmod(dest, 0o755);
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return (await fsp.readFile(file, "utf8")).trim();
  } catch {
    return null;
  }
}

/**
 * Ensure a yt-dlp binary exists under storageDir.
 * Downloads on first run; checks GitHub for updates at most once per day.
 */
export async function ensureYtDlp(
  storageDir: string,
  opts?: {
    onStatus?: (message: string, pct?: number) => void;
    signal?: AbortSignal;
    forceCheck?: boolean;
  },
): Promise<string> {
  const paths = ytDlpPaths(storageDir);
  await fsp.mkdir(paths.binDir, { recursive: true });

  const installed = fs.existsSync(paths.binPath);
  const currentVersion = await readText(paths.versionPath);
  const lastCheckRaw = await readText(paths.metaPath);
  const lastCheck = lastCheckRaw ? Number(lastCheckRaw) : 0;
  const due =
    opts?.forceCheck ||
    !installed ||
    !currentVersion ||
    Date.now() - lastCheck > CHECK_INTERVAL_MS;

  if (!due && installed) {
    return paths.binPath;
  }

  opts?.onStatus?.(
    installed ? "Checking for downloader updates…" : "Downloading downloader…",
    installed ? 5 : 10,
  );

  let latest: { tag: string; downloadUrl: string };
  try {
    latest = await fetchLatestRelease();
  } catch (err) {
    if (installed) {
      console.warn("[yt-dlp] update check failed; using existing binary", err);
      return paths.binPath;
    }
    throw err;
  }

  await fsp.writeFile(paths.metaPath, String(Date.now()), "utf8");

  if (installed && currentVersion === latest.tag) {
    opts?.onStatus?.("Downloader up to date", 100);
    return paths.binPath;
  }

  opts?.onStatus?.(
    installed
      ? `Updating downloader (${latest.tag})…`
      : `Downloading downloader (${latest.tag})…`,
    15,
  );

  await downloadFile(
    latest.downloadUrl,
    paths.binPath,
    (pct) => {
      // Avoid flooding the progress UI with tiny chunk updates.
      if (pct === 15 || pct === 100 || pct % 5 === 0) {
        opts?.onStatus?.("Downloading downloader…", Math.max(15, pct));
      }
    },
    opts?.signal,
  );
  await fsp.writeFile(paths.versionPath, latest.tag, "utf8");
  if (os.platform() === "darwin") {
    // Clear Gatekeeper quarantine so Extension Host can exec the binary.
    try {
      const { spawn } = await import("node:child_process");
      await new Promise<void>((resolve) => {
        const child = spawn("xattr", ["-d", "com.apple.quarantine", paths.binPath]);
        child.on("close", () => resolve());
        child.on("error", () => resolve());
      });
    } catch {
      /* ignore */
    }
  }
  opts?.onStatus?.("Downloader ready", 100);
  return paths.binPath;
}
