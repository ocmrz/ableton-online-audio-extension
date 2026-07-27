import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaultStemSelection,
  needsStemSeparation,
  parseStemSelection,
  selectedStemIds,
  stemModelForQuality,
  stemSuffix,
  usesVocalSpecialist,
  vocalModelForQuality,
} from "./stems.js";

test("needsStemSeparation only for a non-trivial subset", () => {
  assert.equal(needsStemSeparation(null), false);
  assert.equal(needsStemSeparation(defaultStemSelection()), false);

  const vocals = { ...defaultStemSelection(), vocals: true };
  assert.equal(needsStemSeparation(vocals), true);

  const all = {
    vocals: true,
    drums: true,
    bass: true,
    other: true,
    quality: "speed" as const,
  };
  assert.equal(needsStemSeparation(all), false);
});

test("selectedStemIds and model mapping", () => {
  const selection = {
    vocals: true,
    drums: false,
    bass: true,
    other: false,
    quality: "quality" as const,
  };
  assert.deepEqual(selectedStemIds(selection), ["vocals", "bass"]);
  assert.equal(stemModelForQuality("speed"), "htdemucs");
  assert.equal(stemModelForQuality("quality"), "htdemucs_ft");
  assert.equal(stemSuffix(selection), " [Vocals+Bass]");
});

test("usesVocalSpecialist routes vocals and instrumental to MDX/RoFormer", () => {
  assert.equal(
    usesVocalSpecialist({ ...defaultStemSelection(), vocals: true }),
    true,
  );
  assert.equal(
    usesVocalSpecialist({
      vocals: false,
      drums: true,
      bass: true,
      other: true,
      quality: "speed",
    }),
    true,
  );
  assert.equal(
    usesVocalSpecialist({ ...defaultStemSelection(), drums: true }),
    false,
  );
  assert.equal(
    usesVocalSpecialist({
      vocals: true,
      drums: true,
      bass: false,
      other: false,
      quality: "speed",
    }),
    false,
  );
  assert.equal(vocalModelForQuality("speed"), "Kim_Vocal_2.onnx");
  assert.equal(
    vocalModelForQuality("quality"),
    "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
  );
});

test("parseStemSelection validates shape", () => {
  assert.equal(parseStemSelection(null), null);
  assert.equal(parseStemSelection({ vocals: true }), null);
  assert.deepEqual(
    parseStemSelection({
      vocals: true,
      drums: false,
      bass: false,
      other: true,
      quality: "speed",
    }),
    {
      vocals: true,
      drums: false,
      bass: false,
      other: true,
      quality: "speed",
    },
  );
});
