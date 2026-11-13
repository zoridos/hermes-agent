import { useInput } from '@hermes/ink'
import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { getInputSelection } from './inputSelectionStore.js'
import {
  $nextPrompt,
  acceptsNextPrompt,
  caretAtEnd,
  dropNextPrompt,
  nextPromptInView,
  noteComposerDraft
} from './nextPromptStore.js'
import { $isBlocked } from './overlayStore.js'
import { $uiState } from './uiStore.js'

interface SuggestionComposer {
  completions: unknown[]
  input: string
  inputBuf: string[]
  queuedDisplay: unknown[]
  updateInput: (value: string) => void
}

/** The composer side of next-prompt suggestions: returns the ghost text to draw after the typed
 *  text (the whole suggestion over an empty input, the rest while the input is a prefix of it), and
 *  lets Tab or Right turn it into editable text (classic-CLI parity). */
export function useNextPromptSuggestion(composer: SuggestionComposer): string {
  const suggestion = useStore($nextPrompt)
  const blocked = useStore($isBlocked)
  const { sid } = useStore($uiState)
  // A queued message is the next prompt already, so it counts as a draft: no guess is asked for.
  const hasDraft = !!composer.input || composer.inputBuf.length > 0 || composer.queuedDisplay.length > 0

  const remainder = nextPromptInView(suggestion, {
    blocked,
    completing: composer.completions.length > 0,
    input: composer.input,
    multiline: composer.inputBuf.length > 0
  })

  // A guess is only asked for over an empty composer, and belongs to the session it was made for.
  useEffect(() => noteComposerDraft(hasDraft), [hasDraft])
  useEffect(() => dropNextPrompt, [sid])

  useInput(
    (_ch, key) => {
      if (acceptsNextPrompt(key, caretAtEnd(getInputSelection(), composer.input))) {
        composer.updateInput(suggestion)
      }
    },
    { isActive: !!remainder }
  )

  return remainder
}
