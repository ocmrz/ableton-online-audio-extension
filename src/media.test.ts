import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MediaResolver,
  YOUTUBE_AGE_RESTRICTED_MESSAGE,
  isYoutubeAgeRestriction,
  parseResolvedMediaOutput,
} from "./media.js";
import type { Candidate } from "./types.js";

test("parseResolvedMediaOutput reads tagged yt-dlp output", () => {
  const media = parseResolvedMediaOutput(
    [
      "preview:url=https://media.example/audio.m4a?token=test",
      "preview:ext=m4a",
      "preview:duration=123.45",
      'preview:headers={"User-Agent":"Preview Test","X-Test":"one\\r\\ntwo"}',
    ].join("\n"),
  );

  assert.equal(media.url, "https://media.example/audio.m4a?token=test");
  assert.equal(media.ext, "m4a");
  assert.equal(media.durationS, 123.45);
  assert.deepEqual(media.httpHeaders, {
    "User-Agent": "Preview Test",
    "X-Test": "one two",
  });
});

test("isYoutubeAgeRestriction recognizes YouTube age gates", () => {
  assert.equal(
    isYoutubeAgeRestriction("LOGIN_REQUIRED", "Sign in to confirm your age"),
    true,
  );
  assert.equal(
    isYoutubeAgeRestriction("AGE_VERIFICATION_REQUIRED", undefined),
    true,
  );
  assert.equal(
    isYoutubeAgeRestriction("LOGIN_REQUIRED", "Sign in to confirm you’re not a bot"),
    false,
  );
  assert.equal(
    YOUTUBE_AGE_RESTRICTED_MESSAGE,
    "This audio is age-restricted. Please choose another result.",
  );
});

test("YouTube imports fall back when a stream rejects FFmpeg's range", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const probeRanges: string[] = [];
  let fallbackCalls = 0;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/youtubei/v1/player")) {
      const body = JSON.parse(String(init?.body)) as {
        context: { client: { clientName: string } };
      };
      if (body.context.client.clientName === "IOS") {
        return new Response(
          JSON.stringify({
            playabilityStatus: { status: "OK" },
            streamingData: {
              adaptiveFormats: [
                {
                  itag: 140,
                  url: "https://rr1---sn-test.googlevideo.com/audio?token=test",
                  mimeType: 'audio/mp4; codecs="mp4a.40.2"',
                  bitrate: 129000,
                  approxDurationMs: "10000",
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(
        JSON.stringify({
          playabilityStatus: {
            status: "LOGIN_REQUIRED",
            reason: "Sign in to confirm you’re not a bot",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (url.startsWith("https://rr1---sn-test.googlevideo.com/")) {
      const range = new Headers(init?.headers).get("Range") ?? "";
      probeRanges.push(range);
      return new Response(null, {
        status: range === "bytes=0-0" ? 206 : 403,
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };
  console.warn = () => {};

  const candidate: Candidate = {
    id: "YE7VzlLtp-4",
    url: "https://www.youtube.com/watch?v=YE7VzlLtp-4",
    title: "Test video",
    artists: [],
    album: null,
    durationS: 10,
    source: "youtube",
    channel: "Test channel",
    searchRank: 0,
  };
  const resolver = new MediaResolver(
    "/managed/yt-dlp",
    async (_bin, args) => {
      fallbackCalls += 1;
      assert.equal(args.at(-1), candidate.url);
      return {
        stdout: [
          "preview:url=https://fallback.example/audio.m4a",
          "preview:ext=m4a",
          "preview:duration=10",
          'preview:headers={"User-Agent":"Fallback Test"}',
        ].join("\n"),
        stderr: "",
        code: 0,
      };
    },
  );

  try {
    const media = await resolver.resolve(candidate, undefined, "download");
    assert.deepEqual(probeRanges, ["bytes=0-"]);
    assert.equal(fallbackCalls, 1);
    assert.equal(media.url, "https://fallback.example/audio.m4a");
  } finally {
    resolver.close();
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test("BBC media uses MP3 for preview and WAV for import", async () => {
  const candidate: Candidate = {
    id: "07005210",
    url: "https://sound-effects.bbcrewind.co.uk/search?q=07005210",
    title: "Heavy rain, on turf and trees.",
    artists: [],
    album: "Nature",
    durationS: 367.922744,
    source: "bbc",
    channel: "BBC Sound Effects",
    searchRank: 0,
  };
  const resolver = new MediaResolver("/managed/yt-dlp");
  try {
    const preview = await resolver.resolve(candidate, undefined, "preview");
    const download = await resolver.resolve(candidate, undefined, "download");
    assert.equal(
      preview.url,
      "https://sound-effects-media.bbcrewind.co.uk/mp3/07005210.mp3",
    );
    assert.equal(preview.ext, "mp3");
    assert.equal(
      download.url,
      "https://sound-effects-media.bbcrewind.co.uk/wav/07005210.wav",
    );
    assert.equal(download.ext, "wav");
  } finally {
    resolver.close();
  }
});

test("Internet Archive media picks MP3 for preview and WAV for import", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        files: [
          {
            name: "thunder.mp3",
            format: "VBR MP3",
            length: "12.5",
            size: "200000",
            source: "original",
          },
          {
            name: "thunder.wav",
            format: "WAVE",
            length: "12.5",
            size: "2000000",
            source: "original",
          },
          {
            name: "long-bed.mp3",
            format: "VBR MP3",
            length: "600",
            size: "9000000",
            source: "original",
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  const candidate: Candidate = {
    id: "thunder-pack",
    url: "https://archive.org/details/thunder-pack",
    title: "Thunder Pack",
    artists: [],
    album: "opensource_audio",
    durationS: null,
    source: "archive",
    channel: "Internet Archive",
    searchRank: 0,
  };
  const resolver = new MediaResolver("/managed/yt-dlp");
  try {
    const preview = await resolver.resolve(candidate, undefined, "preview");
    const download = await resolver.resolve(candidate, undefined, "download");
    assert.equal(
      preview.url,
      "https://archive.org/download/thunder-pack/thunder.mp3",
    );
    assert.equal(preview.ext, "mp3");
    assert.equal(preview.durationS, 12.5);
    assert.equal(
      download.url,
      "https://archive.org/download/thunder-pack/thunder.wav",
    );
    assert.equal(download.ext, "wav");
  } finally {
    resolver.close();
    globalThis.fetch = originalFetch;
  }
});

test("Openverse media resolves the detail CDN URL", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        url: "https://cdn.freesound.org/previews/401/401275_5121236-hq.mp3",
        filetype: "mp3",
        duration: 60116,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const candidate: Candidate = {
    id: "6b072076-066b-45b6-9695-367a6260c96d",
    url: "https://freesound.org/people/InspectorJ/sounds/401275",
    title: "Rain, Moderate, C.wav",
    artists: ["InspectorJ"],
    album: "Freesound",
    durationS: 60.116,
    source: "openverse",
    channel: "Freesound",
    searchRank: 0,
    kind: "sound-effect",
    provider: "freesound",
  };
  const resolver = new MediaResolver("/managed/yt-dlp");
  try {
    const media = await resolver.resolve(candidate, undefined, "preview");
    assert.match(
      requestedUrl,
      /api\.openverse\.org\/v1\/audio\/6b072076-066b-45b6-9695-367a6260c96d\//,
    );
    assert.equal(
      media.url,
      "https://cdn.freesound.org/previews/401/401275_5121236-hq.mp3",
    );
    assert.equal(media.ext, "mp3");
    assert.equal(media.durationS, 60.116);
  } finally {
    resolver.close();
    globalThis.fetch = originalFetch;
  }
});
