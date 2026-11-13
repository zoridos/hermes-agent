import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetConnectionOperationsForTests } from '../app/connectionOperationStore.js'
import { createGatewayEventHandler } from '../app/createGatewayEventHandler.js'
import { $nextPrompt, $nextPromptEnabled, dropNextPrompt, noteComposerDraft } from '../app/nextPromptStore.js'
import { resetOverlayState } from '../app/overlayStore.js'
import { resetServerRequestsForTests } from '../app/serverRequestStore.js'
import { turnController } from '../app/turnController.js'
import { resetTurnState } from '../app/turnStore.js'
import { patchUiState, resetUiState } from '../app/uiStore.js'
import { applyDisplay } from '../app/useConfigSync.js'

// The ctx builder and beforeEach are duplicated from createGatewayEventHandler.test.ts
// (file-size budget).
const ref = <T>(current: T) => ({ current })

const buildCtx = () =>
  ({
    composer: {
      dequeue: () => undefined,
      queueEditRef: ref<null | number>(null),
      sendQueued: vi.fn(),
      setInput: vi.fn()
    },
    gateway: {
      gw: { request: vi.fn(async () => ({ task_id: 'np_1' })) },
      rpc: vi.fn(async () => null)
    },
    session: {
      STARTUP_RESUME_ID: '',
      colsRef: ref(80),
      newSession: vi.fn(),
      resetSession: vi.fn(),
      resumeById: vi.fn(),
      setCatalog: vi.fn()
    },
    submission: {
      submitRef: { current: vi.fn() }
    },
    system: {
      bellOnComplete: false,
      sys: vi.fn()
    },
    transcript: {
      appendMessage: vi.fn(),
      panel: vi.fn(),
      setHistoryItems: vi.fn()
    },
    voice: {
      setProcessing: vi.fn(),
      setRecording: vi.fn(),
      setVoiceEnabled: vi.fn()
    }
  }) as any

const nextPromptCalls = (ctx: any) =>
  ctx.gateway.gw.request.mock.calls.filter(([method]: [string]) => method === 'prompt.next_prompt')

describe('createGatewayEventHandler — next-prompt suggestions', () => {
  beforeEach(() => {
    resetOverlayState()
    resetUiState()
    resetTurnState()
    resetServerRequestsForTests()
    resetConnectionOperationsForTests()
    turnController.fullReset()
    dropNextPrompt()
    noteComposerDraft(false)
    $nextPromptEnabled.set(true)
    patchUiState({ sid: 'sess-1' })
  })

  it('asks for a suggestion when a turn settles and shows the answer', async () => {
    const ctx = buildCtx()
    const onEvent = createGatewayEventHandler(ctx)

    onEvent({ payload: {}, type: 'message.start' } as any)
    onEvent({ payload: { text: 'Done.' }, type: 'message.complete' } as any)
    expect(nextPromptCalls(ctx)).toEqual([['prompt.next_prompt', { session_id: 'sess-1' }]])

    onEvent({ payload: { task_id: 'np_1', text: 'now run the tests' }, type: 'next_prompt.complete' } as any)
    await vi.waitFor(() => expect($nextPrompt.get()).toBe('now run the tests'))
  })

  it('asks for nothing after a failed turn', () => {
    const ctx = buildCtx()
    const onEvent = createGatewayEventHandler(ctx)

    onEvent({ payload: {}, type: 'message.start' } as any)
    onEvent({ payload: { error: 'boom', status: 'error', text: 'Error: boom' }, type: 'message.complete' } as any)

    expect(nextPromptCalls(ctx)).toEqual([])
  })

  it('asks for nothing after an interrupted turn', () => {
    const ctx = buildCtx()
    const onEvent = createGatewayEventHandler(ctx)

    onEvent({ payload: {}, type: 'message.start' } as any)
    turnController.interruptTurn({ appendMessage: vi.fn(), gw: ctx.gateway.gw, sid: 'sess-1', sys: vi.fn() })
    onEvent({ payload: { status: 'interrupted', text: '' }, type: 'message.complete' } as any)

    expect(nextPromptCalls(ctx)).toEqual([])
  })

  it('removes the suggestion when the next turn starts', async () => {
    const ctx = buildCtx()
    const onEvent = createGatewayEventHandler(ctx)

    onEvent({ payload: {}, type: 'message.start' } as any)
    onEvent({ payload: { text: 'Done.' }, type: 'message.complete' } as any)
    onEvent({ payload: { task_id: 'np_1', text: 'now run the tests' }, type: 'next_prompt.complete' } as any)
    await vi.waitFor(() => expect($nextPrompt.get()).toBe('now run the tests'))

    onEvent({ payload: {}, type: 'message.start' } as any)
    expect($nextPrompt.get()).toBe('')
  })
})

describe('applyDisplay — display.next_prompt_suggestions', () => {
  it('turns suggestions on and off with the config value', () => {
    applyDisplay({ config: { display: { next_prompt_suggestions: true } } } as any, vi.fn())
    expect($nextPromptEnabled.get()).toBe(true)

    applyDisplay({ config: { display: {} } } as any, vi.fn())
    expect($nextPromptEnabled.get()).toBe(false)
  })
})
