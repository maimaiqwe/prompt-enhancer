/**
 * The composer iterate button (conversation.input.right, left of ✨): opens
 * the iteration overlay. It never runs anything by itself — the panel owns
 * the base resolution, the call, and the persistence.
 * @module dsh-prompt-enhance/client/IterationButton
 */

import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { EnhanceButtonProps } from './EnhanceButton'
import { IterationPanel } from './IterationPanel'
import { useSessionKey, serverSessionId } from './session-key'

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** One composer's iterate trigger. */
export function IterationButton(props: EnhanceButtonProps): ReactNode {
  const { t, sessionId, session, useInput, inputActions } = props
  const sources = { sessionId, session }
  const uiKey = useSessionKey(sources, inputActions)
  const wireId = serverSessionId(sources)
  const draft = useInput((state) => stringOf((state as { draft?: unknown }).draft))
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        title={t('iter.button.title')}
        aria-label={t('iter.button.title')}
        onClick={() => setOpen(true)}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, padding: '0 4px', lineHeight: 1 }}
      >
        ↻
      </button>
      {open
        ? createPortal(
          <IterationPanel
            t={t}
            uiKey={uiKey}
            wireId={wireId}
            inputActions={{ setDraft: (text: string) => inputActions.setDraft(text) }}
            draft={draft}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )
        : null}
    </>
  )
}
