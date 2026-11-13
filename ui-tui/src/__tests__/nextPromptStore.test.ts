import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $nextPrompt,
  $nextPromptEnabled,
  acceptsNextPrompt,
  caretAtEnd,
  dropNextPrompt,
  nextPromptDrawn,
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

  const caret = (cursor: number, selection = { end: cursor, start: cursor }) => ({ cursor, ...selection })

  it('treats the caret as at the end when it sits at or past the end of the text now in the composer', () => {
    expect(caretAtEnd(caret(3), 'run')).toBe(true)
    expect(caretAtEnd(caret(0), '')).toBe(true)
    expect(caretAtEnd(caret(1), 'run')).toBe(false)
    expect(caretAtEnd(null, 'run')).toBe(false)
  })

  it('judges the caret against the current text, since edits that move no cursor report no new caret', () => {
    // Home then submit: the composer is cleared and the caret, still 0, is at its end.
    expect(caretAtEnd(caret(0), '')).toBe(true)
    // Forward Delete of the last character: "ru|n" became "ru|".
    expect(caretAtEnd(caret(2), 'ru')).toBe(true)
  })

  it('does not treat a caret with a selection as at the end', () => {
    expect(caretAtEnd(caret(3, { end: 3, start: 0 }), 'run')).toBe(false)
  })

  it('keeps the ghost counted while the caret report for the last keystroke is still on its way', () => {
    // "ru" became "run": the input already draws the ghost after "run", the caret still says 2 of "ru".
    const lagging = { ...caret(2), value: 'ru' }

    expect(nextPromptDrawn(' the tests', { caret: lagging, input: 'run', voicePartial: '' })).toBe(' the tests')
  })

  it('reports the ghost as drawn only where the input draws it', () => {
    // Over an empty input it is the placeholder, unless live dictation text has that slot.
    expect(nextPromptDrawn('run the tests', { caret: null, input: '', voicePartial: '' })).toBe('run the tests')
    expect(nextPromptDrawn('run the tests', { caret: null, input: '', voicePartial: 'schedule a' })).toBe('')
    // After typed text it follows the caret, so only while that is at the end without a selection.
    expect(nextPromptDrawn(' the tests', { caret: caret(3), input: 'run', voicePartial: '' })).toBe(' the tests')
    expect(nextPromptDrawn(' the tests', { caret: caret(1), input: 'run', voicePartial: '' })).toBe('')
    expect(
      nextPromptDrawn(' the tests', { caret: caret(3, { end: 3, start: 0 }), input: 'run', voicePartial: '' })
    ).toBe('')
    expect(nextPromptDrawn(' the tests', { caret: null, input: 'run', voicePartial: '' })).toBe('')
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
