import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { URL } from "node:url";

import { detectInput } from "./detect.js";
import { rankCandidates } from "./rank.js";
import {
  mergeSearchResults,
  resolveUrl,
  searchSoundCloud,
  searchYouTube,
  searchYouTubeMusic,
} from "./search.js";
import type { Candidate } from "./types.js";
import { artistStr } from "./types.js";

export type Brand = "youtube" | "youtube-music" | "soundcloud";

export interface SearchServer {
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

export function brandFor(c: Candidate): Brand {
  if (c.source === "soundcloud") return "soundcloud";
  if (
    c.url.includes("music.youtube.com") ||
    (c.channel != null && c.channel.endsWith(" - Topic"))
  ) {
    return "youtube-music";
  }
  return "youtube";
}

function toItem(c: Candidate, score: number | null, notes: string) {
  return {
    id: c.id,
    title: c.title,
    subtitle: artistStr(c) || c.channel || c.source,
    source: c.source,
    brand: brandFor(c),
    durationS: c.durationS,
    score,
    notes,
    candidate: c,
  };
}

export async function startSearchServer(opts: {
  html: string;
  ytDlpPath: string;
  storageDir: string;
}): Promise<SearchServer> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");

      if (
        req.method === "GET" &&
        (url.pathname === "/" || url.pathname === "/index.html")
      ) {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(opts.html);
        return;
      }

      if (req.method === "GET" && url.pathname === "/search") {
        const q = (url.searchParams.get("q") || "").trim();

        if (!q) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ items: [] }));
          return;
        }

        const detected = detectInput(q);

        if (detected.kind === "url") {
          const one = await Promise.race([
            resolveUrl(opts.ytDlpPath, detected.url, detected.source, {
              storageDir: opts.storageDir,
            }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("URL resolve timed out")),
                20_000,
              ),
            ),
          ]);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ items: [toItem(one, null, "")] }));
          return;
        }

        const rankedQuery = detected.query;
        const [ytm, yt, sc] = await Promise.all([
          searchYouTubeMusic(rankedQuery).catch(() => [] as Candidate[]),
          searchYouTube(opts.ytDlpPath, rankedQuery).catch(
            () => [] as Candidate[],
          ),
          searchSoundCloud(rankedQuery, {
            storageDir: opts.storageDir,
          }).catch(() => [] as Candidate[]),
        ]);
        const ranked = rankCandidates(
          mergeSearchResults(ytm, yt, sc),
          rankedQuery,
        );
        const items = ranked.map((s) =>
          toItem(s.candidate, s.score, s.notes.slice(0, 2).join(", ")),
        );

        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ items }));
        return;
      }

      res.writeHead(404).end("Not found");
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const port = (server.address() as AddressInfo).port;
  return {
    port,
    baseUrl: `http://localhost:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
