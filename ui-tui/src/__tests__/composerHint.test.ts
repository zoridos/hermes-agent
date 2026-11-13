import { describe, expect, it } from 'vitest'

import { composerHint } from '../components/appLayout.js'
import { hintInView } from '../components/textInput.js'

describe('composerHint — what the empty composer shows', () => {
  it('shows a parked next-prompt suggestion instead of the example placeholder or busy hint', () => {
    expect(composerHint('', 'run the tests', true, '')).toBe('run the tests')
    expect(composerHint('', 'run the tests', false, 'esc to interrupt')).toBe('run the tests')
  })

  it('keeps live dictation text above a suggestion', () => {
    expect(composerHint('schedule a', 'run the tests', false, '')).toBe('schedule a')
  })

  it('falls back to the busy hint when there is no suggestion', () => {
    expect(composerHint('', '', false, 'esc to interrupt')).toBe('esc to interrupt')
  })
})

describe('hintInView — the hint the input draws', () => {
  it('shows the placeholder over an empty input', () => {
    expect(hintInView('', 'Try it', 'ignored', true)).toBe('Try it')
  })

  it('shows the ghost completion after typed text while the cursor is at its end', () => {
    expect(hintInView('run', 'Try it', ' the tests', true)).toBe(' the tests')
  })

  it('shows nothing after typed text when the cursor is inside it or there is no ghost', () => {
    expect(hintInView('run', 'Try it', ' the tests', false)).toBe('')
    expect(hintInView('run', 'Try it', undefined, true)).toBe('')
  })
})
