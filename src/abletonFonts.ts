import * as fsp from "node:fs/promises";
import * as path from "node:path";

const LIVE_APP_CANDIDATES = [
  process.env.EXTENSION_HOST_PATH,
  "/Applications/Ableton Live 12 Beta.app",
  "/Applications/Ableton Live 12 Suite.app",
  "/Applications/Ableton Live 12 Standard.app",
  "/Applications/Ableton Live 12 Intro.app",
].filter((p): p is string => Boolean(p));

async function findFontsDir(): Promise<string | null> {
  for (const app of LIVE_APP_CANDIDATES) {
    const dir = path.join(app, "Contents/App-Resources/Fonts");
    try {
      await fsp.access(path.join(dir, "AbletonSansSmall-Regular.ttf"));
      return dir;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Embed AbletonSansSmall from the Live app bundle so the WebView actually
 * renders it (named fonts often fall back to system sans).
 */
export async function abletonFontFaceCss(): Promise<string> {
  const dir = await findFontsDir();
  if (!dir) return "/* AbletonSansSmall not found */";

  const regular = await fsp.readFile(
    path.join(dir, "AbletonSansSmall-Regular.ttf"),
  );
  const bold = await fsp.readFile(path.join(dir, "AbletonSansSmall-Bold.ttf"));

  return `
@font-face {
  font-family: "AbletonSansSmall";
  src: url(data:font/ttf;base64,${regular.toString("base64")}) format("truetype");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "AbletonSansSmall";
  src: url(data:font/ttf;base64,${bold.toString("base64")}) format("truetype");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
`.trim();
}
