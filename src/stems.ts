/** Stem choices mirror Ableton Live's Separate Stems dialog. */
export type StemId = "vocals" | "drums" | "bass" | "other";

export type StemQuality = "speed" | "quality";

export interface StemSelection {
  vocals: boolean;
  drums: boolean;
  bass: boolean;
  other: boolean;
  quality: StemQuality;
}

export const ALL_STEMS: readonly StemId[] = [
  "vocals",
  "drums",
  "bass",
  "other",
];

export function defaultStemSelection(): StemSelection {
  return {
    vocals: false,
    drums: false,
    bass: false,
    other: false,
    quality: "speed",
  };
}

export function selectedStemIds(selection: StemSelection): StemId[] {
  return ALL_STEMS.filter((id) => selection[id]);
}

/** True when a non-trivial subset of stems should be separated. */
export function needsStemSeparation(selection: StemSelection | null): boolean {
  if (!selection) return false;
  const selected = selectedStemIds(selection);
  return selected.length > 0 && selected.length < ALL_STEMS.length;
}

export function stemModelForQuality(quality: StemQuality): "htdemucs" | "htdemucs_ft" {
  return quality === "quality" ? "htdemucs_ft" : "htdemucs";
}

/** Vocals-only or full instrumental (no vocals) — use MDX / RoFormer. */
export function usesVocalSpecialist(selection: StemSelection): boolean {
  const selected = selectedStemIds(selection);
  if (selected.length === 1 && selected[0] === "vocals") return true;
  return (
    selected.length === 3 &&
    !selection.vocals &&
    selection.drums &&
    selection.bass &&
    selection.other
  );
}

export type VocalSpecialistModel =
  | "Kim_Vocal_2.onnx"
  | "model_bs_roformer_ep_317_sdr_12.9755.ckpt";

/** High Speed → MDX Kim_Vocal_2; High Quality → BS-RoFormer. */
export function vocalModelForQuality(quality: StemQuality): VocalSpecialistModel {
  return quality === "quality"
    ? "model_bs_roformer_ep_317_sdr_12.9755.ckpt"
    : "Kim_Vocal_2.onnx";
}

export function vocalSpecialistStem(selection: StemSelection): "Vocals" | "Instrumental" {
  return selection.vocals ? "Vocals" : "Instrumental";
}

export function stemLabel(id: StemId): string {
  switch (id) {
    case "vocals":
      return "Vocals";
    case "drums":
      return "Drums";
    case "bass":
      return "Bass";
    case "other":
      return "Others";
  }
}

export function stemSuffix(selection: StemSelection): string {
  const labels = selectedStemIds(selection).map(stemLabel);
  if (labels.length === 0) return "";
  return ` [${labels.join("+")}]`;
}

export function parseStemSelection(value: unknown): StemSelection | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const quality = o.quality === "quality" || o.quality === "speed" ? o.quality : null;
  if (!quality) return null;
  if (
    typeof o.vocals !== "boolean" ||
    typeof o.drums !== "boolean" ||
    typeof o.bass !== "boolean" ||
    typeof o.other !== "boolean"
  ) {
    return null;
  }
  return {
    vocals: o.vocals,
    drums: o.drums,
    bass: o.bass,
    other: o.other,
    quality,
  };
}
