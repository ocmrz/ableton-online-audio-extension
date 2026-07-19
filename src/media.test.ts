import assert from "node:assert/strict";
import { test } from "node:test";

import { parseResolvedMediaOutput } from "./media.js";

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
