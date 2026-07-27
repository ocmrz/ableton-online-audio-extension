import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
  demucsCliArgs,
  separateAudio,
  vocalSpecialistCliArgs,
} from "./separate.js";
import type { StemSelection } from "./stems.js";

const vocalsOnly: StemSelection = {
  vocals: true,
  drums: false,
  bass: false,
  other: false,
  quality: "speed",
};

const drumsOnly: StemSelection = {
  vocals: false,
  drums: true,
  bass: false,
  other: false,
  quality: "speed",
};

test("demucsCliArgs maps selection to model and stem flags", () => {
  assert.deepEqual(
    demucsCliArgs("/in.wav", "/out", {
      vocals: true,
      drums: true,
      bass: false,
      other: false,
      quality: "quality",
    }),
    ["/in.wav", "-m", "htdemucs_ft", "-s", "vocals,drums", "-o", "/out"],
  );
});

test("vocalSpecialistCliArgs maps speed/quality to MDX and RoFormer", () => {
  assert.deepEqual(
    vocalSpecialistCliArgs("/in.wav", "/out", "/models", vocalsOnly),
    [
      "/in.wav",
      "-m",
      "Kim_Vocal_2.onnx",
      "--output_dir",
      "/out",
      "--output_format",
      "WAV",
      "--model_file_dir",
      "/models",
      "--single_stem",
      "Vocals",
      "--custom_output_names",
      '{"Vocals":"vocals"}',
    ],
  );

  assert.deepEqual(
    vocalSpecialistCliArgs("/in.wav", "/out", "/models", {
      ...vocalsOnly,
      quality: "quality",
    }).slice(0, 3),
    ["/in.wav", "-m", "model_bs_roformer_ep_317_sdr_12.9755.ckpt"],
  );

  assert.equal(
    vocalSpecialistCliArgs("/in.wav", "/out", "/models", {
      vocals: false,
      drums: true,
      bass: true,
      other: true,
      quality: "speed",
    }).includes("Instrumental"),
    true,
  );
});

test("separateAudio uses MDX for vocals-only and demucs for other stems", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "online-audio-stems-"));
  const inputPath = path.join(tempDir, "track.wav");
  await fsp.writeFile(inputPath, Buffer.alloc(5_000, 1));

  const runnerCalls: Array<{ bin: string; args: string[] }> = [];
  const processRunner = async (bin: string, args: string[]) => {
    runnerCalls.push({ bin, args });

    if (bin === "/managed/audio-separator") {
      const outIdx = args.indexOf("--output_dir");
      const outDir = args[outIdx + 1]!;
      await fsp.mkdir(outDir, { recursive: true });
      await fsp.writeFile(path.join(outDir, "vocals.wav"), Buffer.alloc(5_000, 2));
      return { stdout: "", stderr: "", code: 0 };
    }

    const outIdx = args.indexOf("-o");
    if (outIdx >= 0) {
      const outDir = args[outIdx + 1]!;
      await fsp.mkdir(outDir, { recursive: true });
      const stemsArg = args[args.indexOf("-s") + 1]!;
      for (const stem of stemsArg.split(",")) {
        await fsp.writeFile(
          path.join(outDir, `${stem}.wav`),
          Buffer.alloc(5_000, 2),
        );
      }
      return { stdout: "", stderr: "", code: 0 };
    }

    const output = args[args.length - 1]!;
    await fsp.writeFile(output, Buffer.alloc(5_000, 3));
    return { stdout: "", stderr: "", code: 0 };
  };

  const vocals = await separateAudio(
    inputPath,
    tempDir,
    new AbortController().signal,
    {
      audioSeparatorPath: "/managed/audio-separator",
      audioSeparatorModelDir: "/models",
      ffmpegPath: "/managed/ffmpeg",
      selection: vocalsOnly,
      processRunner,
    },
  );
  assert.match(vocals, /\[Vocals\]\.wav$/);
  assert.equal(runnerCalls[0]?.bin, "/managed/audio-separator");
  assert.equal(runnerCalls[0]?.args.includes("Kim_Vocal_2.onnx"), true);

  const drums = await separateAudio(
    inputPath,
    tempDir,
    new AbortController().signal,
    {
      demucsPath: "/managed/demucs",
      ffmpegPath: "/managed/ffmpeg",
      selection: drumsOnly,
      processRunner,
    },
  );
  assert.match(drums, /\[Drums\]\.wav$/);
  assert.equal(runnerCalls.at(-1)?.bin, "/managed/demucs");

  const mixed = await separateAudio(
    inputPath,
    tempDir,
    new AbortController().signal,
    {
      demucsPath: "/managed/demucs",
      ffmpegPath: "/managed/ffmpeg",
      selection: {
        vocals: true,
        drums: true,
        bass: false,
        other: false,
        quality: "speed",
      },
      processRunner,
    },
  );
  assert.match(mixed, /\[Vocals\+Drums\]\.wav$/);
  assert.equal(runnerCalls.at(-1)?.bin, "/managed/ffmpeg");
});
