import { useInput } from '@hermes/ink'
import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { $nextPrompt, acceptsNextPrompt, dropNextPrompt, noteComposerDraft, takeNextPrompt } from './nextPromptStore.js'
import { $isBlocked } from './overlayStore.js'
import { $uiState } from './uiStore.js'

interface SuggestionComposer {
  input: string
  inputBuf: string[]
  updateInput: (value: string) => void
}

/** The composer side of next-prompt suggestions: returns the ghost text to show in the empty
 *  input, and lets Tab or Right turn it into editable text (classic-CLI parity). */
export function useNextPromptSuggestion(composer: SuggestionComposer): string {
  const suggestion = useStore($nextPrompt)
  const blocked = useStore($isBlocked)
  const { sid } = useStore($uiState)
  const hasDraft = !!composer.input || composer.inputBuf.length > 0

  // The suggestion only fits an empty composer, and belongs to the session it was made for.
  useEffect(() => noteComposerDraft(hasDraft), [hasDraft])
  useEffect(() => dropNextPrompt, [sid])

  useInput(
    (_ch, key) => {
      if (acceptsNextPrompt(key)) {
        composer.updateInput(takeNextPrompt())
      }
    },
    { isActive: !!suggestion && !hasDraft && !blocked }
  )

  return suggestion
}
