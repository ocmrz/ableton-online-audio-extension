import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { runProcess } from "./process.js";
import { ensureUv } from "./uvBootstrap.js";

const AUDIO_SEPARATOR_SPEC = "audio-separator[cpu]==0.44.5";
const AUDIO_SEPARATOR_VERSION = "0.44.5";

export interface AudioSeparatorPaths {
  toolDir: string;
  binDir: string;
  binPath: string;
  versionPath: string;
  modelDir: string;
}

export function audioSeparatorPaths(storageDir: string): AudioSeparatorPaths {
  const toolDir = path.join(storageDir, "uv-tools");
  const binDir = path.join(storageDir, "uv-bin");
  return {
    toolDir,
    binDir,
    binPath: path.join(
      binDir,
      os.platform() === "win32" ? "audio-separator.exe" : "audio-separator",
    ),
    versionPath: path.join(binDir, "audio-separator-version.txt"),
    modelDir: path.join(storageDir, "models", "audio-separator"),
  };
}

async function readText(file: string): Promise<string | null> {
  try {
    return (await fsp.readFile(file, "utf8")).trim();
  } catch {
    return null;
  }
}

const activeInstalls = new Map<string, Promise<string>>();

/**
 * Ensure audio-separator is installed via uv into extension storage.
 * Used for vocals-only / instrumental MDX and RoFormer models.
 */
export function ensureAudioSeparator(
  storageDir: string,
  opts?: {
    onStatus?: (message: string, pct?: number) => void;
    signal?: AbortSignal;
  },
): Promise<string> {
  const paths = audioSeparatorPaths(storageDir);
  const active = activeInstalls.get(paths.binPath);
  if (active) return active;

  const installation = (async () => {
    await fsp.mkdir(paths.binDir, { recursive: true });
    await fsp.mkdir(paths.toolDir, { recursive: true });
    await fsp.mkdir(paths.modelDir, { recursive: true });

    const installed =
      fs.existsSync(paths.binPath) &&
      (await readText(paths.versionPath)) === AUDIO_SEPARATOR_VERSION;
    if (installed) {
      opts?.onStatus?.("Vocal separator ready", 100);
      return paths.binPath;
    }

    opts?.onStatus?.("Preparing Python tool runner…", 5);
    const uvOpts: {
      onStatus?: (message: string, pct?: number) => void;
      signal?: AbortSignal;
    } = {
      onStatus: (message, pct) => {
        opts?.onStatus?.(message, Math.round(5 + (pct ?? 0) * 0.25));
      },
    };
    if (opts?.signal) uvOpts.signal = opts.signal;
    const uvPath = await ensureUv(storageDir, uvOpts);
    if (opts?.signal?.aborted) throw new Error("aborted");

    opts?.onStatus?.(
      "Installing vocal separator (first time may take several minutes)…",
      35,
    );
    const result = await runProcess(
      uvPath,
      [
        "tool",
        "install",
        "--force",
        "--python",
        "3.12",
        AUDIO_SEPARATOR_SPEC,
      ],
      opts?.signal,
      undefined,
      {
        UV_TOOL_DIR: paths.toolDir,
        UV_TOOL_BIN_DIR: paths.binDir,
        UV_PYTHON_INSTALL_DIR: path.join(storageDir, "uv-python"),
      },
    );
    if (opts?.signal?.aborted) throw new Error("aborted");
    if (result.code !== 0) {
      throw new Error(
        `Could not install the vocal separator.\n${(result.stderr || result.stdout).slice(-800)}`,
      );
    }
    if (!fs.existsSync(paths.binPath)) {
      throw new Error("Vocal separator install finished but the binary is missing.");
    }
    await fsp.writeFile(paths.versionPath, AUDIO_SEPARATOR_VERSION, "utf8");
    opts?.onStatus?.("Vocal separator ready", 100);
    return paths.binPath;
  })().finally(() => {
    activeInstalls.delete(paths.binPath);
  });

  activeInstalls.set(paths.binPath, installation);
  return installation;
}
