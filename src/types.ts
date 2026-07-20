/** One search / URL result that could be imported into Live. */
export type MediaSource =
  | "youtube"
  | "soundcloud"
  | "bbc"
  | "archive"
  | "openverse";

/** Upstream Openverse catalog provider (not a top-level MediaSource). */
export type OpenverseProvider = "freesound" | "jamendo" | "wikimedia_audio";

/** UI type filter: Music vs Sound Effect. */
export type ItemKind = "music" | "sound-effect";

export interface Candidate {
  id: string;
  url: string;
  title: string;
  artists: string[];
  album: string | null;
  durationS: number | null;
  source: MediaSource;
  channel: string | null;
  searchRank: number;
  /** When set (e.g. Archive), overrides source-based Music / Sound Effect typing. */
  kind?: ItemKind;
  /** Openverse upstream provider when source is openverse. */
  provider?: OpenverseProvider;
}

export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  notes: string[];
}

export interface TimeRange {
  startS: number;
  endS: number;
}

export function artistStr(c: Candidate): string {
  return c.artists.join(", ");
}

export function displayName(c: Candidate): string {
  const artists = artistStr(c);
  if (artists) return `${c.title} — ${artists}`;
  if (c.channel) return `${c.title} — ${c.channel}`;
  return c.title;
}
