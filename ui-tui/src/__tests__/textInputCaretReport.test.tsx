import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { renderSync } from '@hermes/ink'
import React, { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { getInputSelection } from '../app/inputSelectionStore.js'
import { TextInput } from '../components/textInput.js'

// The stream fakes are duplicated from textInputRedoShift.test.tsx.
class FakeInput extends EventEmitter {
  chunks: string[] = []
  isRaw = false
  isTTY = true
  readableLength = 0

  read() {
    const next = this.chunks.shift() ?? null
    this.readableLength = this.chunks.length

    return next
  }

  ref = vi.fn()

  send(...chunks: string[]) {
    this.chunks.push(...chunks)
    this.readableLength = this.chunks.length
    this.emit('readable')
  }

  setEncoding = vi.fn()

  setRawMode = vi.fn((enabled: boolean) => {
    this.isRaw = enabled
  })

  unref = vi.fn()
}

const settle = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))

function makeStreams() {
  const stdin = new FakeInput()
  const stdout = new PassThrough()
  const stderr = new PassThrough()

  Object.assign(stdout, { columns: 80, isTTY: false, rows: 24 })
  Object.assign(stderr, { columns: 80, isTTY: false, rows: 24 })

  return { stderr, stdin, stdout }
}

describe('TextInput caret report ($inputSelection)', () => {
  it('reports the new text after an edit that leaves the cursor where it was', async () => {
    const streams = makeStreams()

    function Harness() {
      const [value, setValue] = useState('ab')

      return <TextInput columns={80} onChange={setValue} onSubmit={() => {}} value={value} />
    }

    const instance = renderSync(React.createElement(Harness), {
      patchConsole: false,
      stderr: streams.stderr as NodeJS.WriteStream,
      stdin: streams.stdin as unknown as NodeJS.ReadStream,
      stdout: streams.stdout as NodeJS.WriteStream
    })

    await settle()

    // Left, then forward Delete: "a|b" becomes "a|" with the cursor still at 1.
    streams.stdin.send('\u001b[D')
    await settle()
    expect(getInputSelection()).toMatchObject({ cursor: 1, value: 'ab' })

    streams.stdin.send('\u001b[3~')
    await settle()

    const caret = getInputSelection()

    instance.unmount()
    instance.cleanup()

    expect(caret).toMatchObject({ cursor: 1, value: 'a' })
  })
})
