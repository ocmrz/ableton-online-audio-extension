import { URL } from "node:url";

import type { MediaSource } from "./types.js";

export type DetectedInput =
  | { kind: "url"; source: MediaSource; url: string }
  | { kind: "query"; query: string };

const YT_HOST =
  /(?:^|\.)(?:youtube\.com|youtu\.be|music\.youtube\.com)$/i;
const SC_HOST = /(?:^|\.)(?:soundcloud\.com|on\.soundcloud\.com)$/i;

function tryParseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    if (/^https?:\/\//i.test(trimmed)) return new URL(trimmed);
    if (/^(www\.|m\.|music\.)?(youtube\.com|youtu\.be|soundcloud\.com)\//i.test(trimmed)) {
      return new URL(`https://${trimmed}`);
    }
  } catch {
    return null;
  }
  return null;
}

export function detectInput(raw: string): DetectedInput {
  const trimmed = raw.trim();
  const url = tryParseUrl(trimmed);
  if (url) {
    const host = url.hostname.replace(/^www\./i, "");
    if (YT_HOST.test(host) || host === "youtu.be") {
      return { kind: "url", source: "youtube", url: url.toString() };
    }
    if (SC_HOST.test(host)) {
      return { kind: "url", source: "soundcloud", url: url.toString() };
    }
  }
  return { kind: "query", query: trimmed };
}
