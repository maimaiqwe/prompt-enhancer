/**
 * Self-contained stylesheet, injected once as a <style> element: the plugin
 * ships no CSS build step, and class names are prefixed to stay collision
 * free inside the web shell. Colors are declared as panel-scoped variables
 * with a dark default and a light `prefers-color-scheme` override, so the
 * panel follows the OS/shell theme without depending on host theme internals.
 * @module dsh-prompt-enhance/client/styles
 */

const STYLE_ID = 'dsh-prompt-enhance-styles'

/** The plugin's stylesheet. */
export const CSS = `
.dsh-pe-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--dsh-pe-z-index, 1000);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
  padding: 24px 16px;
}
.dsh-pe-panel {
  --pe-bg: #1f2127;
  --pe-fg: #e6e8ee;
  --pe-fg-dim: rgba(230, 232, 238, 0.55);
  --pe-border: rgba(127, 127, 127, 0.35);
  --pe-separator: rgba(127, 127, 127, 0.25);
  --pe-hover: rgba(127, 127, 127, 0.18);
  --pe-danger: #ffb4a8;
  --pe-warn-fg: #e8c07d;
  --pe-warn-border: rgba(230, 158, 60, 0.35);
  --pe-warn-bg: rgba(230, 158, 60, 0.12);
  display: flex;
  flex-direction: column;
  width: min(880px, 100%);
  max-height: min(70vh, 640px);
  border-radius: 12px;
  border: 1px solid var(--pe-border);
  background: var(--pe-bg);
  color: var(--pe-fg);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  outline: none;
}
@media (prefers-color-scheme: light) {
  .dsh-pe-panel {
    --pe-bg: #ffffff;
    --pe-fg: #1c1e24;
    --pe-fg-dim: rgba(28, 30, 36, 0.55);
    --pe-border: rgba(0, 0, 0, 0.18);
    --pe-separator: rgba(0, 0, 0, 0.12);
    --pe-hover: rgba(0, 0, 0, 0.08);
    --pe-danger: #a63a2e;
    --pe-warn-fg: #8a5a00;
    --pe-warn-border: rgba(176, 122, 0, 0.4);
    --pe-warn-bg: rgba(230, 158, 60, 0.15);
  }
}
.dsh-pe-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--pe-separator);
  font-size: 13px;
  font-weight: 600;
}
.dsh-pe-head .dsh-pe-meta { margin-left: auto; font-weight: 400; font-size: 11px; opacity: 0.6; }
.dsh-pe-close {
  border: none; background: transparent; color: inherit; opacity: 0.6;
  font-size: 15px; cursor: pointer; padding: 2px 6px; border-radius: 4px;
}
.dsh-pe-close:hover { opacity: 1; background: var(--pe-hover); }
.dsh-pe-body { display: flex; flex: 1; min-height: 0; }
.dsh-pe-col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.dsh-pe-col + .dsh-pe-col { border-left: 1px solid var(--pe-separator); }
.dsh-pe-col-title {
  padding: 8px 14px 6px;
  font-size: 11px;
  letter-spacing: 0.04em;
  opacity: 0.55;
}
.dsh-pe-col-text {
  flex: 1;
  margin: 0;
  padding: 0 14px 12px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
}
.dsh-pe-error {
  padding: 20px 16px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--pe-danger);
  white-space: pre-wrap;
}
.dsh-pe-error .dsh-pe-error-detail {
  margin-top: 8px;
  font-size: 12px;
  opacity: 0.75;
  color: inherit;
}
.dsh-pe-loading {
  display: flex; flex-direction: column; gap: 8px;
  align-items: center; justify-content: center;
  flex: 1; padding: 28px 16px; font-size: 13px;
}
.dsh-pe-loading .dsh-pe-hint { font-size: 11px; opacity: 0.55; }
/* Incremental view: the streamed text takes the whole body, left-aligned. */
.dsh-pe-stream {
  display: flex; flex-direction: column;
  flex: 1; min-height: 0; width: 100%;
}
.dsh-pe-stream .dsh-pe-col-title {
  display: flex; align-items: center; gap: 6px;
  padding-left: 0;
}
.dsh-pe-spin.small { width: 11px; height: 11px; border-width: 1px; }
.dsh-pe-spin {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid var(--pe-separator); border-top-color: #6ea8ff;
  animation: dsh-pe-spin 0.9s linear infinite;
}
.dsh-pe-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--pe-separator);
}
.dsh-pe-foot .dsh-pe-grow { flex: 1; }
.dsh-pe-btn-action {
  border: none; border-radius: 6px; padding: 6px 14px;
  font-size: 12px; cursor: pointer; line-height: 1;
}
.dsh-pe-btn-action.primary { background: #3f76e1; color: #fff; }
.dsh-pe-btn-action.primary:hover { background: #4d82ec; }
.dsh-pe-btn-action.plain { background: var(--pe-hover); color: inherit; }
.dsh-pe-btn-action.plain:hover { background: rgba(127, 127, 127, 0.3); }

.dsh-pe-stale {
  padding: 8px 14px;
  font-size: 12px;
  line-height: 1.5;
  border-top: 1px solid var(--pe-warn-border);
  background: var(--pe-warn-bg);
  color: var(--pe-warn-fg);
}

.dsh-pe-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  opacity: 0.75;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
}
.dsh-pe-btn:hover:not(:disabled) { opacity: 1; background: var(--pe-hover); }
.dsh-pe-btn:disabled { opacity: 0.45; cursor: default; }
.dsh-pe-btn .dsh-pe-btn-icon { font-size: 14px; }
.dsh-pe-btn.is-busy .dsh-pe-btn-icon { animation: dsh-pe-spin 1s linear infinite; }
@keyframes dsh-pe-spin { to { transform: rotate(360deg); } }

.dsh-pe-undo {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px;
  font-size: 12px;
  color: inherit;
  opacity: 0.85;
}
.dsh-pe-undo .dsh-pe-undo-check { color: #7ed491; }
.dsh-pe-undo-link {
  border: none; background: var(--pe-hover); color: inherit;
  border-radius: 5px; padding: 3px 10px; font-size: 12px; cursor: pointer;
}
.dsh-pe-undo-link:hover { background: rgba(127,127,127,0.3); }
.dsh-pe-undo-x {
  border: none; background: transparent; color: inherit; opacity: 0.55;
  cursor: pointer; padding: 0 4px; font-size: 12px;
}
.dsh-pe-undo-x:hover { opacity: 1; }

/* Tier picker + ✨ share one row. The composer slot has no --pe-* variables of
   its own, so every color here carries a literal fallback: inside the slot
   those variables are undefined and an unguarded reference would paint
   nothing. */
.dsh-pe-cluster {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.dsh-pe-tier { position: relative; display: inline-flex; }
.dsh-pe-tier > summary { list-style: none; }
.dsh-pe-tier > summary::-webkit-details-marker { display: none; }
.dsh-pe-tier-btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  padding: 0 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  opacity: 0.75;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.dsh-pe-tier-btn:hover { opacity: 1; background: var(--pe-hover, rgba(127, 127, 127, 0.18)); }
.dsh-pe-tier[open] .dsh-pe-tier-btn { opacity: 1; background: var(--pe-hover, rgba(127, 127, 127, 0.18)); }
.dsh-pe-tier-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--pe-hover, rgba(127, 127, 127, 0.22));
  font-size: 11px;
  line-height: 1;
}
.dsh-pe-tier-caret { font-size: 9px; opacity: 0.7; }
.dsh-pe-tier-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  /* The capsule sits at the right edge of the composer, so the menu grows
     leftward; anchoring at left:0 would push it off-screen. */
  left: auto;
  right: 0;
  z-index: 40;
  width: 268px;
  padding: 6px;
  border: 1px solid var(--pe-border, rgba(127, 127, 127, 0.28));
  border-radius: 10px;
  background: var(--pe-bg, #1f2124);
  color: var(--pe-fg, inherit);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  font-size: 12px;
}
@media (prefers-color-scheme: light) {
  .dsh-pe-tier-menu { background: var(--pe-bg, #ffffff); }
}
.dsh-pe-tier-title {
  padding: 2px 6px 6px;
  font-size: 11px;
  opacity: 0.6;
}
.dsh-pe-tier-item {
  display: block;
  width: 100%;
  padding: 6px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-pe-tier-item:hover { background: var(--pe-hover, rgba(127, 127, 127, 0.18)); }
.dsh-pe-tier-item.is-active { background: var(--pe-hover, rgba(127, 127, 127, 0.26)); }
.dsh-pe-tier-item-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
.dsh-pe-tier-item-hint {
  display: block;
  margin-top: 2px;
  padding-left: 22px;
  font-size: 11px;
  line-height: 1.45;
  opacity: 0.62;
}
.dsh-pe-tier-context {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  padding: 6px;
  border-top: 1px solid var(--pe-separator, rgba(127, 127, 127, 0.22));
  cursor: pointer;
}
.dsh-pe-tier-context input { accent-color: currentColor; }
.dsh-pe-tier-context.is-locked { opacity: 0.45; cursor: not-allowed; }
.dsh-pe-tier-context.is-locked input { cursor: not-allowed; }
.dsh-pe-tier-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 26px;
  padding: 2px 4px 2px;
}
.dsh-pe-tier-pinned { font-size: 11px; opacity: 0.65; }
.dsh-pe-tier-pin {
  border: none;
  border-radius: 6px;
  background: var(--pe-hover, rgba(127, 127, 127, 0.22));
  color: inherit;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}
.dsh-pe-tier-pin:hover { background: rgba(127, 127, 127, 0.32); }
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
