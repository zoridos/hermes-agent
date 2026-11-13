import { atom } from 'nanostores'

import type { GatewayClient } from '../gatewayClient.js'
import type { AnyGatewayEvent } from '../gatewayTypes.js'

import { getUiState } from './uiStore.js'

// Ghost-text guess of the user's next prompt (`display.next_prompt_suggestions`, classic-CLI
// parity). A settled turn asks the gateway for one (`prompt.next_prompt`); the answer
// (`next_prompt.complete`) stays parked until the next turn. The composer shows whatever part of it
// the typed text has not reached yet, and Tab or Right accepts it. Nothing is sent unless the user
// accepts it and presses Enter.
export const $nextPrompt = atom('')
export const $nextPromptEnabled = atom(false)

// message.complete statuses that leave nothing to follow up on. `interrupted` also arrives for a turn
// another client stopped on a shared gateway, which the local interrupt flag never sees.
const UNSETTLED = new Set(['error', 'interrupted'])

// The in-flight request's task id; null orphans whatever answer is still on its way.
let pending: null | Promise<null | string> = null
let composerEmpty = true

/** Forget the suggestion and any answer still in flight (new turn, new session). */
export function dropNextPrompt() {
  pending = null
  $nextPrompt.set('')
}

/** Mirror of the composer: a guess is only asked for, and only lands, while it is empty. */
export function noteComposerDraft(hasDraft: boolean) {
  composerEmpty = !hasDraft
}

export function requestNextPrompt(gw: Pick<GatewayClient, 'request'>, sid: null | string | undefined) {
  dropNextPrompt()

  if (!$nextPromptEnabled.get() || !composerEmpty || !sid) {
    return
  }

  // Straight to the client, not the `rpc` wrapper: a refusal (setting just turned off, session
  // gone) must not print an error line for a suggestion nobody asked for.
  pending = gw
    .request<{ task_id?: string }>('prompt.next_prompt', { session_id: sid })
    .then(r => r?.task_id ?? null)
    .catch(() => null)
}

/** `next_prompt.complete`: park the guess if it answers the latest request and the input is still idle. */
export async function parkNextPrompt(payload: undefined | { task_id?: string; text?: string }) {
  const asked = pending
  const taskId = await asked

  if (!taskId || asked !== pending || taskId !== payload?.task_id || !composerEmpty || getUiState().busy) {
    return
  }

  pending = null
  $nextPrompt.set(String(payload.text ?? '').trim())
}

/** Turn-edge events: a new turn drops the suggestion, a cleanly settled one asks for the next, and
 *  `next_prompt.complete` (the only event fully handled here, hence true) delivers it. */
export function handleNextPromptEvent(
  ev: AnyGatewayEvent,
  gw: Pick<GatewayClient, 'request'>,
  interrupted: boolean
): boolean {
  if (ev.type === 'next_prompt.complete') {
    void parkNextPrompt(ev.payload)

    return true
  }

  if (
    ev.type === 'message.start' ||
    (ev.type === 'message.complete' && (interrupted || UNSETTLED.has(String(ev.payload?.status))))
  ) {
    dropNextPrompt()
  } else if (ev.type === 'message.complete') {
    requestNextPrompt(gw, getUiState().sid)
  }

  return false
}

/** What is left to show of `suggestion` after the typed `input`: all of it over an empty input, the
 *  rest while the input is a prefix of it, nothing once the input differs or already equals it. */
export const nextPromptRemainder = (suggestion: string, input: string) =>
  input.length < suggestion.length && suggestion.startsWith(input) ? suggestion.slice(input.length) : ''

/** The ghost text the composer may draw now: none while a completion list (which owns Tab), an
 *  overlay or a multi-line draft has it. */
export const nextPromptInView = (
  suggestion: string,
  composer: { blocked: boolean; completing: boolean; input: string; multiline: boolean }
) =>
  composer.blocked || composer.completing || composer.multiline ? '' : nextPromptRemainder(suggestion, composer.input)

/** True only for a caret reported at the end of the text the composer holds now; a report for an
 *  older text (a forward Delete moves no cursor, so none follows it) proves nothing. */
export const caretAtEnd = (caret: null | { cursor: number; value: string }, input: string) =>
  !!caret && caret.value === input && caret.cursor >= input.length

/** Tab takes the suggestion from anywhere; Right only where it has nowhere left to move. */
export const acceptsNextPrompt = (
  key: { rightArrow?: boolean; shift?: boolean; tab?: boolean },
  cursorAtEnd: boolean
) => (!!key.tab && !key.shift) || (!!key.rightArrow && cursorAtEnd)
