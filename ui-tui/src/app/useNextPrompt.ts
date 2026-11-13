import { useInput } from '@hermes/ink'
import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { getInputSelection } from './inputSelectionStore.js'
import {
  $nextPrompt,
  acceptsNextPrompt,
  dropNextPrompt,
  nextPromptRemainder,
  noteComposerDraft
} from './nextPromptStore.js'
import { $isBlocked } from './overlayStore.js'
import { $uiState } from './uiStore.js'

interface SuggestionComposer {
  completions: unknown[]
  input: string
  inputBuf: string[]
  updateInput: (value: string) => void
}

/** The composer side of next-prompt suggestions: returns the ghost text to draw after the typed
 *  text (the whole suggestion over an empty input, the rest while the input is a prefix of it), and
 *  lets Tab or Right turn it into editable text (classic-CLI parity). */
export function useNextPromptSuggestion(composer: SuggestionComposer): string {
  const suggestion = useStore($nextPrompt)
  const blocked = useStore($isBlocked)
  const { sid } = useStore($uiState)
  const hasDraft = !!composer.input || composer.inputBuf.length > 0
  const remainder = blocked || composer.inputBuf.length ? '' : nextPromptRemainder(suggestion, composer.input)

  // A guess is only asked for over an empty composer, and belongs to the session it was made for.
  useEffect(() => noteComposerDraft(hasDraft), [hasDraft])
  useEffect(() => dropNextPrompt, [sid])

  useInput(
    (_ch, key) => {
      const caret = getInputSelection()

      if (acceptsNextPrompt(key, !caret || caret.cursor >= caret.value.length)) {
        composer.updateInput(suggestion)
      }
    },
    // An open completion list owns Tab.
    { isActive: !!remainder && !composer.completions.length }
  )

  return remainder
}
