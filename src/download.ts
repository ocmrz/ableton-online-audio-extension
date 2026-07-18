import * as fsp from "node:fs/promises";
import * as path from "node:path";

import type { Candidate } from "./types.js";
import { runProcess } from "./process.js";

export interface DownloadProgress {
  pct: number;
  speed: string;
}

/**
 * Download bestaudio (prefer m4a) with yt-dlp — no FFmpeg conversion.
 * Returns the absolute path to the downloaded file.
 */
export async function downloadAudio(
  ytDlpPath: string,
  candidate: Candidate,
  tempDir: string,
  onProgress: (p: DownloadProgress) => void,
  signal: AbortSignal,
): Promise<string> {
  const safeId = candidate.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const base = `ym-${Date.now()}-${safeId}`;
  const outTemplate = path.join(tempDir, `${base}.%(ext)s`);

  const result = await runProcess(
    ytDlpPath,
    [
      candidate.url,
      "-f",
      "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio/best",
      // `--print` suppresses default progress unless `--progress` is explicit.
      "--progress",
      "--newline",
      "--no-playlist",
      "--no-warning",
      "--no-update",
      "-o",
      outTemplate,
      "--print",
      "after_move:filepath",
    ],
    signal,
    (raw) => {
      const line = raw.trim();
      if (!line) return;
      const pct = /\[download\]\s+([\d.]+)%/.exec(line);
      if (pct?.[1]) {
        const n = parseFloat(pct[1]);
        const speed = /at\s+(\S+\/s)/.exec(line);
        onProgress({ pct: n, speed: speed?.[1] ?? "" });
      }
    },
  );

  if (signal.aborted) throw new Error("aborted");
  if (result.code !== 0) {
    throw new Error(
      `Download failed (yt-dlp exit ${result.code}).\n${result.stderr.slice(-800)}`,
    );
  }

  // Prefer printed filepath; fall back to scanning temp dir.
  const printed = result.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith(tempDir) || /\/ym-\d+-/.test(l))
    .at(-1);

  if (printed) {
    try {
      await fsp.access(printed);
      return printed;
    } catch {
      /* fall through */
    }
  }

  const files = await fsp.readdir(tempDir);
  const match = files.find((f) => f.startsWith(base + "."));
  if (!match) {
    throw new Error(`Download finished but output file missing for ${base}`);
  }
  return path.join(tempDir, match);
}
