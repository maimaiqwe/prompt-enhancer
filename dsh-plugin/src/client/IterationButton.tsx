/**
 * The composer iterate trigger, rendered between the tier capsule and ✨:
 * opens the iteration overlay. It never runs anything by itself — the panel
 * owns the base resolution, the call, and the persistence.
 * @module dsh-prompt-enhance/client/IterationButton
 */

import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IterationPanel } from './IterationPanel'
import { useSessionKey, serverSessionId } from './session-key'

/** Narrow props: only what the trigger and panel actually consume. */
export interface IterationTriggerProps {
  t: TranslateNS<'prompt-enhance'>
  sessionId?: unknown
  session?: { sessionId?: unknown } | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useInput: (selector: (state: any) => any) => any
  inputActions: { setDraft: (text: string) => void }
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** One composer's iterate trigger. */
export function IterationButton(props: IterationTriggerProps): ReactNode {
  const { t, sessionId, session, useInput, inputActions } = props
  const sources = { sessionId, session }
  const uiKey = useSessionKey(sources, inputActions)
  const wireId = serverSessionId(sources)
  const draft = String(useInput((state: { draft?: unknown }) => stringOf(state?.draft)) ?? '')
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="dsh-pe-btn"
        title={t('iter.button.title')}
        aria-label={t('iter.button.title')}
        onClick={() => setOpen(true)}
      >
        <span className="dsh-pe-btn-icon" aria-hidden="true">↻</span>
      </button>
      {open
        ? createPortal(
          <IterationPanel
            t={t}
            uiKey={uiKey}
            wireId={wireId}
            inputActions={inputActions}
            draft={draft}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )
        : null}
    </>
  )
}
