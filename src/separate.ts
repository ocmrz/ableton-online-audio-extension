import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { runProcess } from "./process.js";
import {
  selectedStemIds,
  stemModelForQuality,
  stemSuffix,
  usesVocalSpecialist,
  vocalModelForQuality,
  vocalSpecialistStem,
  type StemId,
  type StemSelection,
} from "./stems.js";

export interface SeparateProgress {
  message: string;
  pct: number;
}

export interface SeparateAudioOptions {
  demucsPath?: string;
  audioSeparatorPath?: string;
  audioSeparatorModelDir?: string;
  ffmpegPath: string;
  selection: StemSelection;
  processRunner?: typeof runProcess;
}

function ffmpegMergeArgs(inputs: string[], outputPath: string): string[] {
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
  for (const input of inputs) args.push("-i", input);
  const labels = inputs.map((_, index) => `[${index}:a]`).join("");
  args.push(
    "-filter_complex",
    `${labels}amix=inputs=${inputs.length}:duration=longest:dropout_transition=0:normalize=0`,
    "-c:a",
    "pcm_s16le",
    outputPath,
  );
  return args;
}

async function assertNonEmptyWav(filePath: string): Promise<void> {
  const stat = await fsp.stat(filePath);
  // RIFF header + some PCM frames; silent/empty bugs write tiny files.
  if (stat.size < 4_096) {
    throw new Error(
      `Stem separation produced an empty file (${path.basename(filePath)}).`,
    );
  }
}

function progressTicker(
  onProgress: ((p: SeparateProgress) => void) | undefined,
  message: string,
  halfLifeMs: number,
): { stop: () => void } {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const pct = Math.min(
      95,
      Math.round(8 + 87 * (1 - Math.exp(-elapsed / halfLifeMs))),
    );
    onProgress?.({ message, pct });
  }, 250);
  return {
    stop: () => clearInterval(timer),
  };
}

export function demucsCliArgs(
  inputPath: string,
  outputDir: string,
  selection: StemSelection,
): string[] {
  const stems = selectedStemIds(selection) as StemId[];
  return [
    inputPath,
    "-m",
    stemModelForQuality(selection.quality),
    "-s",
    stems.join(","),
    "-o",
    outputDir,
  ];
}

export function vocalSpecialistCliArgs(
  inputPath: string,
  outputDir: string,
  modelDir: string,
  selection: StemSelection,
): string[] {
  const stem = vocalSpecialistStem(selection);
  const stemKey = stem === "Vocals" ? "Vocals" : "Instrumental";
  const customNames = JSON.stringify({ [stemKey]: stemKey.toLowerCase() });
  return [
    inputPath,
    "-m",
    vocalModelForQuality(selection.quality),
    "--output_dir",
    outputDir,
    "--output_format",
    "WAV",
    "--model_file_dir",
    modelDir,
    "--single_stem",
    stem,
    "--custom_output_names",
    customNames,
  ];
}

async function separateWithDemucs(
  inputPath: string,
  tempDir: string,
  signal: AbortSignal,
  options: SeparateAudioOptions,
  onProgress?: (p: SeparateProgress) => void,
): Promise<string> {
  const selection = options.selection;
  const stems = selectedStemIds(selection);
  if (!options.demucsPath) {
    throw new Error("The managed stem separator is not ready.");
  }

  const processRunner = options.processRunner ?? runProcess;
  const workDir = path.join(
    tempDir,
    `stems-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await fsp.mkdir(workDir, { recursive: true });

  onProgress?.({ message: "Separating stems…", pct: 0 });
  const ticker = progressTicker(onProgress, "Separating stems…", 45_000);

  let result;
  try {
    result = await processRunner(
      options.demucsPath,
      demucsCliArgs(inputPath, workDir, selection),
      signal,
    );
  } catch (error) {
    ticker.stop();
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "The managed stem separator could not be started. Try importing again.",
      );
    }
    throw error;
  } finally {
    ticker.stop();
  }

  if (signal.aborted) throw new Error("aborted");
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).slice(-800);
    throw new Error(
      `Stem separation failed (demucs exit ${result.code}).\n${detail}`,
    );
  }

  const stemPaths: string[] = [];
  for (const stem of stems) {
    const stemPath = path.join(workDir, `${stem}.wav`);
    await fsp.access(stemPath);
    await assertNonEmptyWav(stemPath);
    stemPaths.push(stemPath);
  }

  const inputBase = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(tempDir, `${inputBase}${stemSuffix(selection)}.wav`);

  if (stemPaths.length === 1) {
    await fsp.copyFile(stemPaths[0]!, outputPath);
    onProgress?.({ message: "Stems ready", pct: 100 });
    return outputPath;
  }

  onProgress?.({ message: "Mixing selected stems…", pct: 97 });
  const merge = await processRunner(
    options.ffmpegPath,
    ffmpegMergeArgs(stemPaths, outputPath),
    signal,
  );
  if (signal.aborted) throw new Error("aborted");
  if (merge.code !== 0) {
    throw new Error(
      `Mixing stems failed (FFmpeg exit ${merge.code}).\n${merge.stderr.slice(-800)}`,
    );
  }
  await assertNonEmptyWav(outputPath);
  onProgress?.({ message: "Stems ready", pct: 100 });
  return outputPath;
}

async function separateWithVocalSpecialist(
  inputPath: string,
  tempDir: string,
  signal: AbortSignal,
  options: SeparateAudioOptions,
  onProgress?: (p: SeparateProgress) => void,
): Promise<string> {
  const selection = options.selection;
  if (!options.audioSeparatorPath || !options.audioSeparatorModelDir) {
    throw new Error("The managed vocal separator is not ready.");
  }

  const processRunner = options.processRunner ?? runProcess;
  const workDir = path.join(
    tempDir,
    `vocal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await fsp.mkdir(workDir, { recursive: true });

  const label = "Separating vocals…";
  onProgress?.({ message: label, pct: 0 });
  const ticker = progressTicker(
    onProgress,
    label,
    selection.quality === "quality" ? 90_000 : 40_000,
  );

  let result;
  try {
    result = await processRunner(
      options.audioSeparatorPath,
      vocalSpecialistCliArgs(
        inputPath,
        workDir,
        options.audioSeparatorModelDir,
        selection,
      ),
      signal,
      undefined,
      {
        PATH: path.dirname(options.ffmpegPath),
      },
    );
  } catch (error) {
    ticker.stop();
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "The managed vocal separator could not be started. Try importing again.",
      );
    }
    throw error;
  } finally {
    ticker.stop();
  }

  if (signal.aborted) throw new Error("aborted");
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).slice(-800);
    throw new Error(
      `Vocal separation failed (${vocalModelForQuality(selection.quality)}, exit ${result.code}).\n${detail}`,
    );
  }

  const stemName = vocalSpecialistStem(selection).toLowerCase();
  const preferred = path.join(workDir, `${stemName}.wav`);
  let sourcePath = preferred;
  try {
    await fsp.access(preferred);
  } catch {
    const files = await fsp.readdir(workDir);
    const match = files.find((file) => {
      const lower = file.toLowerCase();
      return (
        lower.endsWith(".wav") &&
        lower.includes(stemName)
      );
    });
    if (!match) {
      throw new Error(
        `Vocal separation finished but no ${stemName} WAV was written.`,
      );
    }
    sourcePath = path.join(workDir, match);
  }

  await assertNonEmptyWav(sourcePath);
  const inputBase = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(tempDir, `${inputBase}${stemSuffix(selection)}.wav`);
  await fsp.copyFile(sourcePath, outputPath);
  onProgress?.({ message: "Stems ready", pct: 100 });
  return outputPath;
}

/**
 * Separate selected stems from a local WAV and return a single WAV path
 * (one stem, or a mix of several). Caller owns cleanup of temp files.
 *
 * Vocals-only / instrumental-only use MDX (High Speed) or BS-RoFormer
 * (High Quality). Other stem mixes use HTDemucs via demucs-rs.
 */
export async function separateAudio(
  inputPath: string,
  tempDir: string,
  signal: AbortSignal,
  options: SeparateAudioOptions,
  onProgress?: (p: SeparateProgress) => void,
): Promise<string> {
  const selection = options.selection;
  const stems = selectedStemIds(selection);
  if (stems.length === 0 || stems.length === 4) {
    return inputPath;
  }

  if (usesVocalSpecialist(selection)) {
    return separateWithVocalSpecialist(
      inputPath,
      tempDir,
      signal,
      options,
      onProgress,
    );
  }

  return separateWithDemucs(inputPath, tempDir, signal, options, onProgress);
}
