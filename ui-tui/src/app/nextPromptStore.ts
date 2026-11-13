import { atom } from 'nanostores'

import type { GatewayClient } from '../gatewayClient.js'
import type { AnyGatewayEvent } from '../gatewayTypes.js'

import { getUiState } from './uiStore.js'

// Ghost-text guess of the user's next prompt (`display.next_prompt_suggestions`, classic-CLI
// parity). A settled turn asks the gateway for one (`prompt.next_prompt`); the answer
// (`next_prompt.complete`) shows as the composer's placeholder and Tab or Right accepts it.
// Nothing is sent unless the user accepts it and presses Enter.
export const $nextPrompt = atom('')
export const $nextPromptEnabled = atom(false)

// The in-flight request's task id; null orphans whatever answer is still on its way.
let pending: null | Promise<null | string> = null
let composerEmpty = true

/** Forget the suggestion and any answer still in flight (new turn, new session, typing). */
export function dropNextPrompt() {
  pending = null
  $nextPrompt.set('')
}

/** Mirror of the composer: a draft drops the suggestion, since it only fits an empty input. */
export function noteComposerDraft(hasDraft: boolean) {
  composerEmpty = !hasDraft

  if (hasDraft) {
    dropNextPrompt()
  }
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
    (ev.type === 'message.complete' && (interrupted || ev.payload?.status === 'error'))
  ) {
    dropNextPrompt()
  } else if (ev.type === 'message.complete') {
    requestNextPrompt(gw, getUiState().sid)
  }

  return false
}

/** The suggestion being accepted: returns it and clears it. */
export function takeNextPrompt(): string {
  const text = $nextPrompt.get()

  dropNextPrompt()

  return text
}

export const acceptsNextPrompt = (key: { rightArrow?: boolean; shift?: boolean; tab?: boolean }) =>
  (!!key.tab && !key.shift) || !!key.rightArrow
