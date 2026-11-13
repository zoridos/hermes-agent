import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $nextPrompt,
  $nextPromptEnabled,
  acceptsNextPrompt,
  caretAtEnd,
  dropNextPrompt,
  nextPromptInView,
  nextPromptRemainder,
  noteComposerDraft,
  parkNextPrompt,
  requestNextPrompt
} from '../app/nextPromptStore.js'
import { patchUiState, resetUiState } from '../app/uiStore.js'

const gateway = (taskId = 'np_1') => ({ request: vi.fn(async () => ({ task_id: taskId })) }) as any

describe('next-prompt suggestion (display.next_prompt_suggestions)', () => {
  beforeEach(() => {
    resetUiState()
    dropNextPrompt()
    noteComposerDraft(false)
    $nextPromptEnabled.set(true)
  })

  it('asks the gateway after a settled turn and parks the answer as the suggestion', async () => {
    const gw = gateway()

    requestNextPrompt(gw, 'sess-1')
    await parkNextPrompt({ task_id: 'np_1', text: 'run the tests' })

    expect(gw.request).toHaveBeenCalledWith('prompt.next_prompt', { session_id: 'sess-1' })
    expect($nextPrompt.get()).toBe('run the tests')
  })

  it('asks nothing while the setting is off', () => {
    const gw = gateway()
    $nextPromptEnabled.set(false)

    requestNextPrompt(gw, 'sess-1')

    expect(gw.request).not.toHaveBeenCalled()
  })

  it('asks nothing while the composer holds a draft', () => {
    const gw = gateway()
    noteComposerDraft(true)

    requestNextPrompt(gw, 'sess-1')

    expect(gw.request).not.toHaveBeenCalled()
  })

  it('drops an answer that lands while the composer holds a draft', async () => {
    requestNextPrompt(gateway(), 'sess-1')
    noteComposerDraft(true)
    await parkNextPrompt({ task_id: 'np_1', text: 'run the tests' })
    noteComposerDraft(false)

    expect($nextPrompt.get()).toBe('')
  })

  it('drops an answer that lands while a turn is running', async () => {
    requestNextPrompt(gateway(), 'sess-1')
    patchUiState({ busy: true })
    await parkNextPrompt({ task_id: 'np_1', text: 'run the tests' })

    expect($nextPrompt.get()).toBe('')
  })

  it('ignores the answer to an earlier request', async () => {
    requestNextPrompt(gateway('np_old'), 'sess-1')
    requestNextPrompt(gateway('np_new'), 'sess-1')
    await parkNextPrompt({ task_id: 'np_old', text: 'stale guess' })

    expect($nextPrompt.get()).toBe('')
  })

  it('stays quiet when the gateway refuses the request', async () => {
    const gw = { request: vi.fn(async () => Promise.reject(new Error('next_prompt_suggestions is disabled'))) } as any

    requestNextPrompt(gw, 'sess-1')
    await parkNextPrompt({ task_id: 'np_1', text: 'run the tests' })

    expect($nextPrompt.get()).toBe('')
  })

  it('keeps a parked suggestion while the user types, so deleting back to a prefix can show it again', async () => {
    requestNextPrompt(gateway(), 'sess-1')
    await parkNextPrompt({ task_id: 'np_1', text: 'run the tests' })
    noteComposerDraft(true)

    expect($nextPrompt.get()).toBe('run the tests')
  })

  it('shows the rest of the suggestion while the typed text is a prefix of it', () => {
    expect(nextPromptRemainder('run the tests', '')).toBe('run the tests')
    expect(nextPromptRemainder('run the tests', 'run')).toBe(' the tests')
  })

  it('shows nothing once the typed text leaves the suggestion or completes it', () => {
    expect(nextPromptRemainder('run the tests', 'rux')).toBe('')
    expect(nextPromptRemainder('run the tests', 'Run')).toBe('')
    expect(nextPromptRemainder('run the tests', 'run the tests')).toBe('')
    expect(nextPromptRemainder('', 'run')).toBe('')
  })

  it('treats the caret as at the end only when it is known to be, for the text now in the composer', () => {
    expect(caretAtEnd({ cursor: 3, value: 'run' }, 'run')).toBe(true)
    expect(caretAtEnd({ cursor: 0, value: '' }, '')).toBe(true)
    expect(caretAtEnd({ cursor: 1, value: 'run' }, 'run')).toBe(false)
    // A caret reported for an older text (forward Delete moved no cursor) proves nothing.
    expect(caretAtEnd({ cursor: 3, value: 'run' }, 'ru')).toBe(false)
    expect(caretAtEnd(null, 'run')).toBe(false)
  })

  it('offers nothing while a completion list, an overlay or a multi-line draft owns the composer', () => {
    const idle = { blocked: false, completing: false, input: 'run', multiline: false }

    expect(nextPromptInView('run the tests', idle)).toBe(' the tests')
    expect(nextPromptInView('run the tests', { ...idle, completing: true })).toBe('')
    expect(nextPromptInView('run the tests', { ...idle, blocked: true })).toBe('')
    expect(nextPromptInView('run the tests', { ...idle, multiline: true })).toBe('')
  })

  it('is accepted by Tab, or by Right with the cursor at the end of the text', () => {
    expect(acceptsNextPrompt({ tab: true }, false)).toBe(true)
    expect(acceptsNextPrompt({ rightArrow: true }, true)).toBe(true)
  })

  it('is not accepted by Shift+Tab, other keys, or Right while the cursor is inside the text', () => {
    expect(acceptsNextPrompt({ shift: true, tab: true }, true)).toBe(false)
    expect(acceptsNextPrompt({}, true)).toBe(false)
    expect(acceptsNextPrompt({ rightArrow: true }, false)).toBe(false)
  })
})
