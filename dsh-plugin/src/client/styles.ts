/**
 * Self-contained stylesheet, injected once as a <style> element: the plugin
 * ships no CSS build step, and class names are prefixed to stay collision
 * free inside the web shell.
 *
 * Visual language: hairline monochrome. A floating surface is white, bounded
 * by a 1px hairline, and lifts with one soft wide shadow only where it must
 * read as "above" something. Colour carries meaning and nothing else: ink for
 * the primary action, one cool indigo for the active tier, amber for a stale
 * draft, red for a failure.
 *
 * Every colour is a --pe-* token declared on the plugin's own roots, so the
 * picker, the panel and the dock line share one palette and one radius scale
 * instead of each hardcoding literals. Light is the default; a dark palette
 * is layered on top through prefers-color-scheme so the plugin follows the
 * shell theme without depending on host theme internals.
 * @module dsh-prompt-enhance/client/styles
 */

const STYLE_ID = 'dsh-prompt-enhance-styles'

/** The plugin's stylesheet. */
export const CSS = `
/* ---- tokens -------------------------------------------------------------
   Declared on every root the plugin owns. The composer slot has no host
   variables of its own, so anything read outside these roots carries a
   literal fallback as well. The tier root is listed in its own right: the
   popover is rendered inside the composer cluster today, but a menu that
   only inherits its palette from that wrapper would paint itself with the
   light fallbacks the moment it is mounted anywhere else. */
.dsh-pe-cluster,
.dsh-pe-tier,
.dsh-pe-panel,
.dsh-pe-undo,
.dsh-pe-working,
.dsh-pe-notice {
  --pe-surface: #ffffff;
  --pe-surface-2: #f7f8fa;
  --pe-surface-3: #eef0f4;
  --pe-fg: #0f1115;
  --pe-fg-2: #5f6673;
  --pe-fg-3: #8b919c;
  --pe-line: rgba(9, 11, 15, 0.1);
  --pe-line-2: rgba(9, 11, 15, 0.18);
  --pe-hover: rgba(9, 11, 15, 0.045);
  --pe-ink: #12141a;
  --pe-on-ink: #ffffff;
  --pe-accent: #4a5bd6;
  --pe-accent-soft: rgba(74, 91, 214, 0.1);
  --pe-accent-line: rgba(74, 91, 214, 0.28);
  --pe-danger: #b42318;
  --pe-danger-soft: rgba(180, 35, 24, 0.08);
  --pe-ok: #1c7a52;
  --pe-warn-fg: #8a5a00;
  --pe-warn-line: rgba(176, 122, 0, 0.28);
  --pe-warn-bg: rgba(230, 158, 60, 0.1);
  --pe-radius-lg: 14px;
  --pe-radius-md: 10px;
  --pe-radius-sm: 7px;
  /* One lift, used only by surfaces that float: a wide soft drop plus a
     hairline ring, so the edge stays crisp at any zoom instead of blurring
     into the page. */
  --pe-shadow-float: 0 1px 2px rgba(9, 11, 15, 0.06),
    0 12px 28px -10px rgba(9, 11, 15, 0.2),
    0 0 0 1px rgba(9, 11, 15, 0.06);
  --pe-shadow-panel: 0 2px 4px rgba(9, 11, 15, 0.05),
    0 24px 48px -18px rgba(9, 11, 15, 0.22),
    0 0 0 1px rgba(9, 11, 15, 0.07);
  --pe-ring: rgba(74, 91, 214, 0.32);
  --pe-ease: 140ms cubic-bezier(0.16, 1, 0.3, 1);
  --pe-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif;
  --pe-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas,
    'Liberation Mono', monospace;
}

@media (prefers-color-scheme: dark) {
  .dsh-pe-cluster,
  .dsh-pe-tier,
  .dsh-pe-panel,
  .dsh-pe-undo,
  .dsh-pe-working,
  .dsh-pe-notice {
    --pe-surface: #191b20;
    --pe-surface-2: #212429;
    --pe-surface-3: #2a2e35;
    --pe-fg: #e9ecf2;
    --pe-fg-2: #a4abb8;
    --pe-fg-3: #7d8492;
    --pe-line: rgba(255, 255, 255, 0.1);
    --pe-line-2: rgba(255, 255, 255, 0.19);
    --pe-hover: rgba(255, 255, 255, 0.06);
    --pe-ink: #e9ecf2;
    --pe-on-ink: #14161a;
    --pe-accent: #9aa6ff;
    --pe-accent-soft: rgba(154, 166, 255, 0.14);
    --pe-accent-line: rgba(154, 166, 255, 0.32);
    --pe-danger: #ff9a90;
    --pe-danger-soft: rgba(255, 154, 144, 0.12);
    --pe-ok: #6ddba4;
    --pe-warn-fg: #e5c07b;
    --pe-warn-line: rgba(229, 192, 123, 0.3);
    --pe-warn-bg: rgba(229, 192, 123, 0.12);
    --pe-shadow-float: 0 1px 2px rgba(0, 0, 0, 0.4),
      0 12px 28px -10px rgba(0, 0, 0, 0.6),
      0 0 0 1px rgba(255, 255, 255, 0.07);
    --pe-shadow-panel: 0 2px 4px rgba(0, 0, 0, 0.4),
      0 24px 48px -18px rgba(0, 0, 0, 0.66),
      0 0 0 1px rgba(255, 255, 255, 0.08);
    --pe-ring: rgba(154, 166, 255, 0.38);
  }
}

/* ---- focus ---------------------------------------------------------------
   One focus treatment for everything clickable. It never shifts layout, and it
   only appears for keyboard users, so a mouse click does not leave a ring
   behind on the composer. */
.dsh-pe-cluster :focus-visible,
.dsh-pe-panel :focus-visible,
.dsh-pe-undo :focus-visible,
.dsh-pe-working :focus-visible,
.dsh-pe-notice :focus-visible {
  outline: 2px solid var(--pe-ring);
  outline-offset: 2px;
}

/* ---- composer cluster ----------------------------------------------------
   The tier capsule and the ✨ button are one control group: they share a
   height, a radius and a hover treatment, so the row reads as a unit rather
   than two unrelated chips. */
.dsh-pe-cluster {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--pe-font);
}

.dsh-pe-tier { position: relative; display: inline-flex; }
.dsh-pe-tier > summary { list-style: none; }
.dsh-pe-tier > summary::-webkit-details-marker { display: none; }

.dsh-pe-tier-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 7px 0 6px;
  border: 1px solid var(--pe-line, rgba(9, 11, 15, 0.1));
  border-radius: var(--pe-radius-sm, 7px);
  background: var(--pe-surface, #ffffff);
  color: var(--pe-fg-2, #5f6673);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition: background var(--pe-ease, 140ms ease),
    border-color var(--pe-ease, 140ms ease),
    color var(--pe-ease, 140ms ease);
}
.dsh-pe-tier-btn:hover {
  border-color: var(--pe-line-2, rgba(9, 11, 15, 0.18));
  color: var(--pe-fg, #0f1115);
}
.dsh-pe-tier[open] > .dsh-pe-tier-btn {
  border-color: var(--pe-line-2, rgba(9, 11, 15, 0.18));
  color: var(--pe-fg, #0f1115);
  background: var(--pe-surface-2, #f7f8fa);
}

.dsh-pe-tier-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border-radius: 5px;
  background: var(--pe-surface-3, #eef0f4);
  color: var(--pe-fg-2, #5f6673);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1;
  transition: background var(--pe-ease, 140ms ease),
    color var(--pe-ease, 140ms ease);
}
/* The caret is drawn, not a glyph: at 9px the font version sat on the
   baseline and read as a stray comma. */
.dsh-pe-tier-caret {
  width: 7px;
  height: 7px;
  border-right: 1.4px solid currentColor;
  border-bottom: 1.4px solid currentColor;
  transform: translateY(-1.5px) rotate(45deg);
  opacity: 0.55;
  transition: transform var(--pe-ease, 140ms ease);
}
.dsh-pe-tier[open] > .dsh-pe-tier-btn > .dsh-pe-tier-caret {
  transform: translateY(1px) rotate(225deg);
}

/* ---- tier popover --------------------------------------------------------
   324px: wide enough that an 11px Chinese hint holds two lines, narrow enough
   to sit under the capsule without covering the composer. */
.dsh-pe-tier-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  /* The capsule sits at the right edge of the composer, so the menu grows
     leftward; anchoring at left:0 would push it off-screen. */
  left: auto;
  right: 0;
  z-index: 40;
  width: 324px;
  padding: 6px;
  border-radius: var(--pe-radius-lg, 14px);
  border: 1px solid var(--pe-line, rgba(9, 11, 15, 0.1));
  background: var(--pe-surface, #ffffff);
  color: var(--pe-fg, #0f1115);
  box-shadow: var(--pe-shadow-float, 0 12px 28px -10px rgba(9, 11, 15, 0.2));
  font-size: 12px;
  font-family: var(--pe-font);
  transform-origin: bottom right;
  animation: dsh-pe-pop-in var(--pe-ease, 140ms ease);
}

.dsh-pe-tier-title {
  padding: 6px 8px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--pe-fg-3, #8b919c);
}

.dsh-pe-tier-legend {
  padding: 0 8px 8px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--pe-fg-3, #8b919c);
}

.dsh-pe-tier-row {
  display: flex;
  align-items: stretch;
  gap: 2px;
  border-radius: var(--pe-radius-md, 10px);
}
.dsh-pe-tier-row:hover { background: var(--pe-hover, rgba(9, 11, 15, 0.045)); }
.dsh-pe-tier-row.is-active {
  background: var(--pe-surface-2, #f7f8fa);
  box-shadow: inset 2px 0 0 var(--pe-accent, #4a5bd6);
}

.dsh-pe-tier-item {
  display: block;
  flex: 1;
  min-width: 0;
  padding: 8px 9px;
  border: none;
  border-radius: var(--pe-radius-md, 10px);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.dsh-pe-tier-item-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--pe-fg, #0f1115);
}
.dsh-pe-tier-row.is-active .dsh-pe-tier-badge {
  background: var(--pe-accent-soft, rgba(74, 91, 214, 0.1));
  color: var(--pe-accent, #4a5bd6);
}
/* The tick is decoration for the checked row: the radio group already exposes
   the state, so it is aria-hidden in the markup. */
.dsh-pe-tier-mark {
  margin-left: auto;
  font-size: 11px;
  color: var(--pe-accent, #4a5bd6);
  opacity: 0;
  transition: opacity var(--pe-ease, 140ms ease);
}
.dsh-pe-tier-item[aria-checked='true'] .dsh-pe-tier-mark { opacity: 1; }
.dsh-pe-tier-item-hint {
  display: block;
  margin-top: 3px;
  padding-left: 24px;
  font-size: 11px;
  line-height: 1.55;
  color: var(--pe-fg-3, #8b919c);
}

/* Native radio / checkbox restyled rather than replaced: the tests and the
   keyboard both address them by role, and appearance:none keeps that working
   while letting the control share the palette. */
.dsh-pe-tier-default {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  flex: none;
  border-radius: var(--pe-radius-md, 10px);
  cursor: pointer;
}
.dsh-pe-tier-default:hover { background: var(--pe-hover, rgba(9, 11, 15, 0.045)); }
.dsh-pe-tier-default.is-locked { opacity: 0.4; cursor: not-allowed; }
.dsh-pe-tier-default.is-locked:hover { background: transparent; }

.dsh-pe-tier-default input,
.dsh-pe-tier-context input {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
  width: 15px;
  height: 15px;
  flex: none;
  border: 1px solid var(--pe-line-2, rgba(9, 11, 15, 0.18));
  background: var(--pe-surface, #ffffff);
  cursor: pointer;
  transition: border-color var(--pe-ease, 140ms ease),
    background var(--pe-ease, 140ms ease);
}
.dsh-pe-tier-default input { border-radius: 50%; }
.dsh-pe-tier-default input:checked {
  border-color: var(--pe-accent, #4a5bd6);
  background: radial-gradient(
    circle,
    var(--pe-accent, #4a5bd6) 0 3.5px,
    transparent 4px
  );
}
.dsh-pe-tier-default input:disabled,
.dsh-pe-tier-context input:disabled { cursor: not-allowed; }

.dsh-pe-tier-context {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  padding: 8px 9px;
  border-top: 1px solid var(--pe-line, rgba(9, 11, 15, 0.1));
  font-size: 12px;
  color: var(--pe-fg, #0f1115);
  cursor: pointer;
}
.dsh-pe-tier-context:hover { background: var(--pe-hover, rgba(9, 11, 15, 0.045)); }
.dsh-pe-tier-context input { border-radius: 4px; }
.dsh-pe-tier-context input:checked {
  border-color: var(--pe-ink, #12141a);
  background-color: var(--pe-ink, #12141a);
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2l2.2 2.2 4.8-5' fill='none' stroke='%23ffffff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: center;
  background-size: 11px 11px;
}
.dsh-pe-tier-context.is-locked { opacity: 0.5; cursor: not-allowed; }
.dsh-pe-tier-context.is-locked:hover { background: transparent; }

.dsh-pe-tier-foot {
  margin-top: 4px;
  padding: 8px 9px 4px;
  border-top: 1px solid var(--pe-line, rgba(9, 11, 15, 0.1));
  font-size: 11px;
  line-height: 1.55;
  color: var(--pe-fg-3, #8b919c);
}

/* ---- ✨ button ----------------------------------------------------------- */
.dsh-pe-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--pe-radius-sm, 7px);
  background: transparent;
  color: var(--pe-fg-2, #5f6673);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--pe-ease, 140ms ease),
    border-color var(--pe-ease, 140ms ease);
}
.dsh-pe-btn:hover:not(:disabled):not([aria-disabled='true']) {
  background: var(--pe-hover, rgba(9, 11, 15, 0.045));
  border-color: var(--pe-line, rgba(9, 11, 15, 0.1));
}
.dsh-pe-btn:disabled,
.dsh-pe-btn[aria-disabled='true'] { opacity: 0.45; cursor: default; }
/* The busy icon is the ring itself and rotates by its own rule. Rotating this
   wrapper as well would spin it twice, and the old dotted-circle glyph it used
   to hold is rotationally symmetric — animating it looked frozen. */
.dsh-pe-btn.is-busy .dsh-pe-btn-icon { display: inline-flex; align-items: center; }
.dsh-pe-ring-sm { width: 12px; height: 12px; }

/* ---- dock rows ------------------------------------------------------------
   One quiet line above the composer. Same height and same icon column for the
   working, applied and failed states, so the composer never jumps when one
   replaces another. */
.dsh-pe-undo,
.dsh-pe-working,
.dsh-pe-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
  padding: 1px 2px;
  font-size: 12px;
  font-family: var(--pe-font);
  color: var(--pe-fg-2, #5f6673);
}
.dsh-pe-undo .dsh-pe-undo-check { color: var(--pe-ok, #1c7a52); font-size: 11px; }
.dsh-pe-undo-link {
  border: 1px solid var(--pe-line, rgba(9, 11, 15, 0.1));
  background: var(--pe-surface, #ffffff);
  color: var(--pe-fg, #0f1115);
  border-radius: 6px;
  padding: 2px 9px;
  font-size: 11.5px;
  line-height: 1.5;
  cursor: pointer;
  transition: background var(--pe-ease, 140ms ease),
    border-color var(--pe-ease, 140ms ease);
}
.dsh-pe-undo-link:hover {
  border-color: var(--pe-line-2, rgba(9, 11, 15, 0.18));
  background: var(--pe-surface-2, #f7f8fa);
}
.dsh-pe-undo-x,
.dsh-pe-working-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.5;
  cursor: pointer;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 5px;
  font-size: 11px;
  transition: opacity var(--pe-ease, 140ms ease),
    background var(--pe-ease, 140ms ease);
}
.dsh-pe-undo-x:hover,
.dsh-pe-working-x:hover {
  opacity: 1;
  background: var(--pe-hover, rgba(9, 11, 15, 0.045));
}
.dsh-pe-undo-hint { font-size: 11px; color: var(--pe-fg-3, #8b919c); }

.dsh-pe-working-label { flex: 1; min-width: 0; }
.dsh-pe-working-elapsed {
  font-size: 11px;
  color: var(--pe-fg-3, #8b919c);
  font-variant-numeric: tabular-nums;
}
/* A real ring: a font glyph that is rotationally symmetric looks frozen when
   it spins. */
.dsh-pe-ring {
  width: 12px;
  height: 12px;
  flex: none;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  animation: dsh-pe-spin 0.8s linear infinite;
  opacity: 0.7;
}

/* Failure line: only the icon carries colour, so a wall of red copy does not
   fight the composer underneath. */
.dsh-pe-notice { color: var(--pe-fg, #0f1115); }
.dsh-pe-notice-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--pe-danger-soft, rgba(180, 35, 24, 0.08));
  color: var(--pe-danger, #b42318);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  flex: none;
}
.dsh-pe-notice-text { flex: 1; min-width: 0; }

/* ---- preview panel -------------------------------------------------------
   Two placements. Standalone (no composer to attach to): a centred sheet over
   a light scrim. Anchored: the panel hangs directly above the composer card,
   matching its width and horizontal edges, so the result reads as an
   extension of the box the user was typing in. */
.dsh-pe-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--dsh-pe-z-index, 1000);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(9, 11, 15, 0.14);
  padding: 24px;
  animation: dsh-pe-fade-in var(--pe-ease, 140ms ease);
}
/* Anchored mode is not modal: the user is still looking at the composer it
   belongs to, so there is nothing to dim. The overlay stays click-to-close. */
.dsh-pe-overlay.is-anchored {
  display: block;
  padding: 0;
  background: transparent;
  animation: none;
}

.dsh-pe-panel {
  display: flex;
  flex-direction: column;
  width: min(880px, 100%);
  max-height: min(70vh, 640px);
  border-radius: var(--pe-radius-lg, 14px);
  border: 1px solid var(--pe-line, rgba(9, 11, 15, 0.1));
  background: var(--pe-surface, #ffffff);
  color: var(--pe-fg, #0f1115);
  box-shadow: var(--pe-shadow-panel, 0 24px 48px -18px rgba(9, 11, 15, 0.22));
  overflow: hidden;
  outline: none;
  font-family: var(--pe-font);
}
.dsh-pe-overlay:not(.is-anchored) .dsh-pe-panel {
  animation: dsh-pe-lift-in var(--pe-ease, 140ms ease);
}
/* Anchored placement is inline-styled by ResultPanel with the composer card's
   measured rect; this rule only pins it out of the flex flow. */
.dsh-pe-overlay.is-anchored .dsh-pe-panel {
  position: fixed;
  animation: dsh-pe-lift-in var(--pe-ease, 140ms ease);
}

.dsh-pe-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--pe-line, rgba(9, 11, 15, 0.1));
}
.dsh-pe-head-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--pe-accent-soft, rgba(74, 91, 214, 0.1));
  font-size: 11px;
  line-height: 1;
  flex: none;
}
.dsh-pe-head-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.dsh-pe-head .dsh-pe-meta {
  margin-left: auto;
  font-size: 11px;
  font-weight: 400;
  color: var(--pe-fg-3, #8b919c);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-pe-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-left: auto;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--pe-fg-3, #8b919c);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  flex: none;
  transition: background var(--pe-ease, 140ms ease),
    color var(--pe-ease, 140ms ease);
}
/* The close button shares the row with the meta line, so it only claims the
   auto margin when the meta is absent. */
.dsh-pe-head .dsh-pe-meta + .dsh-pe-close { margin-left: 4px; }
.dsh-pe-close:hover {
  background: var(--pe-hover, rgba(9, 11, 15, 0.045));
  color: var(--pe-fg, #0f1115);
}

.dsh-pe-body { display: flex; flex: 1; min-height: 0; }
.dsh-pe-col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.dsh-pe-col + .dsh-pe-col { border-left: 1px solid var(--pe-line, rgba(9, 11, 15, 0.1)); }
.dsh-pe-col-title {
  padding: 10px 14px 4px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--pe-fg-3, #8b919c);
}
.dsh-pe-col-text {
  flex: 1;
  margin: 0;
  padding: 0 14px 14px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--pe-fg, #0f1115);
}

.dsh-pe-loading {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 30px 16px;
  font-size: 12.5px;
  color: var(--pe-fg-2, #5f6673);
}
.dsh-pe-loading .dsh-pe-hint { font-size: 11px; color: var(--pe-fg-3, #8b919c); }
.dsh-pe-stream {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
}
.dsh-pe-stream .dsh-pe-col-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 14px;
}

.dsh-pe-error {
  padding: 22px 16px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--pe-danger, #b42318);
  white-space: pre-wrap;
}
.dsh-pe-error .dsh-pe-error-detail {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: var(--pe-radius-sm, 7px);
  background: var(--pe-surface-2, #f7f8fa);
  color: var(--pe-fg-2, #5f6673);
  font-family: var(--pe-mono);
  font-size: 11px;
  line-height: 1.6;
}

.dsh-pe-stale {
  padding: 8px 14px;
  border-top: 1px solid var(--pe-warn-line, rgba(176, 122, 0, 0.28));
  background: var(--pe-warn-bg, rgba(230, 158, 60, 0.1));
  color: var(--pe-warn-fg, #8a5a00);
  font-size: 11.5px;
  line-height: 1.6;
}

.dsh-pe-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--pe-line, rgba(9, 11, 15, 0.1));
  background: var(--pe-surface, #ffffff);
}
.dsh-pe-foot .dsh-pe-grow { flex: 1; }
.dsh-pe-btn-action {
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 6px 12px;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  transition: background var(--pe-ease, 140ms ease),
    border-color var(--pe-ease, 140ms ease);
}
.dsh-pe-btn-action.primary {
  background: var(--pe-ink, #12141a);
  color: var(--pe-on-ink, #ffffff);
}
.dsh-pe-btn-action.primary:hover { opacity: 0.88; }
.dsh-pe-btn-action.plain {
  background: var(--pe-surface, #ffffff);
  border-color: var(--pe-line, rgba(9, 11, 15, 0.1));
  color: var(--pe-fg, #0f1115);
}
.dsh-pe-btn-action.plain:hover {
  background: var(--pe-surface-2, #f7f8fa);
  border-color: var(--pe-line-2, rgba(9, 11, 15, 0.18));
}
.dsh-pe-spin {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid var(--pe-line, rgba(9, 11, 15, 0.1));
  border-top-color: var(--pe-accent, #4a5bd6);
  animation: dsh-pe-spin 0.9s linear infinite;
}
.dsh-pe-spin.small { width: 11px; height: 11px; border-width: 1.5px; }

/* ---- motion -------------------------------------------------------------- */
@keyframes dsh-pe-spin { to { transform: rotate(360deg); } }
@keyframes dsh-pe-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes dsh-pe-lift-in {
  from { opacity: 0; transform: translateY(6px) scale(0.995); }
  to { opacity: 1; transform: none; }
}
@keyframes dsh-pe-pop-in {
  from { opacity: 0; transform: translateY(4px) scale(0.985); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-pe-tier-menu,
  .dsh-pe-overlay,
  .dsh-pe-panel { animation: none; }
  .dsh-pe-tier-caret { transition: none; }
  .dsh-pe-ring { animation-duration: 2s; }
}
`

/**
 * Inject the stylesheet once per document.
 * @returns true when injected, false when it was already present.
 */
export function ensureStyles(): boolean {
  if (document.getElementById(STYLE_ID) !== null) return false
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = CSS
  document.head.appendChild(element)
  return true
}
