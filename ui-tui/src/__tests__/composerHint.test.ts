import { describe, expect, it } from 'vitest'

import { composerHint } from '../components/appLayout.js'

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
