/**
 * CSS from Ableton Live theme files:
 *   Default Light Neutral Medium.ask
 *   Default Dark Neutral Medium.ask
 *
 * Matches Preferences → Theme: Default, Appearance: Follow System,
 * Tone: Neutral, High Contrast: Off (Medium).
 * Light/dark via prefers-color-scheme (Follow System).
 */
export const LIVE_THEME_CSS = /* css */ `
/*__ABLETON_FONTS__*/
:root {
  /* Default Light Neutral Medium */
  --p-live-ui-bg: #a5a5a5;
  --p-live-control-bg: #cfcfcf;
  --p-live-input-bg: #bcbcbc;
  --p-live-text-primary: #4f4f4f;
  --p-live-text-secondary: #6e6e6e;
  --p-live-control-border: #4f4f4f;
  --p-live-accent-primary: #ffb901;
  --p-live-control-text--enabled: #121212;
  --p-live-heading: #4f4f4f;
  --p-live-selection-bg: #cdf8ff;
  --p-live-row-hover: #bcbcbc;
  --p-live-row-border: #9c9c9c;
  --p-live-badge: #818181;
  --p-live-badge-youtube: #c44;
  --p-live-badge-soundcloud: #d16500;
  --p-live-titlebar-bg: #6e6e6e;
  --p-live-titlebar-fg: #f1f1f1;
  --p-live-chrome-bg: #818181;
  --p-live-panel-bg: #6e6e6e;
  --p-live-surface-bg: #a5a5a5;
  --p-live-surface-text: #121212;
  --p-live-surface-muted: #4f4f4f;
  --p-live-empty-text: #242424;
  --p-live-disclosure-bg: #121212;
  --p-live-disclosure-fg: #a5a5a5;
  --p-live-results-bar-bg: #ecca6d;
  --p-live-results-bar-fg: #121212;
  --p-live-chip-active-bg: #ecca6d;
  --p-live-chip-bg: #bcbcbc;
}

@media (prefers-color-scheme: dark) {
  :root {
    /* Default Dark Neutral Medium */
    --p-live-ui-bg: #363636;
    --p-live-control-bg: #1e1e1e;
    --p-live-input-bg: #2a2a2a;
    --p-live-text-primary: #b5b5b5;
    --p-live-text-secondary: #757575;
    --p-live-control-border: #111111;
    --p-live-accent-primary: #ffad56;
    --p-live-control-text--enabled: #b5b5b5;
    --p-live-heading: #e8e8e8;
    --p-live-selection-bg: #b0ddeb;
    --p-live-row-hover: #464646;
    --p-live-row-border: #303030;
    --p-live-badge: #464646;
    --p-live-badge-youtube: #8a3030;
    --p-live-badge-soundcloud: #8a4a18;
    --p-live-titlebar-bg: #2a2a2a;
    --p-live-titlebar-fg: #b5b5b5;
    --p-live-chrome-bg: #2a2a2a;
    --p-live-panel-bg: #242424;
    --p-live-surface-bg: #363636;
    --p-live-surface-text: #b5b5b5;
    --p-live-surface-muted: #757575;
    --p-live-empty-text: #b5b5b5;
    --p-live-disclosure-bg: #121212;
    --p-live-disclosure-fg: #b5b5b5;
    --p-live-results-bar-bg: #ecca6d;
    --p-live-results-bar-fg: #121212;
    --p-live-chip-active-bg: #ecca6d;
    --p-live-chip-bg: #242424;
  }
}

/* Live’s native modal chrome does not take a title from the Extensions API.
   Draw our own title strip so the dialog still has a clear name. */
.alx-titlebar {
  flex: 0 0 auto;
  height: 20px;
  line-height: 20px;
  padding: 0 8px;
  background: var(--p-live-titlebar-bg);
  color: var(--p-live-titlebar-fg);
  font-size: 11px;
  font-weight: 600;
  border-bottom: 1px solid var(--p-live-control-border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}
`;

const THEME_PLACEHOLDER = "/*__LIVE_THEME__*/";
const FONTS_PLACEHOLDER = "/*__ABLETON_FONTS__*/";

export function applyLiveTheme(html: string, fontFaceCss = ""): string {
  if (!html.includes(THEME_PLACEHOLDER)) {
    throw new Error(`HTML missing ${THEME_PLACEHOLDER}`);
  }
  const theme = LIVE_THEME_CSS.replace(
    FONTS_PLACEHOLDER,
    fontFaceCss || "/* no ableton fonts */",
  );
  return html.replace(THEME_PLACEHOLDER, theme);
}
