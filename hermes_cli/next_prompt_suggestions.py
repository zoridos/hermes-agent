"""Classic-CLI ghost-text suggestion of the user's next prompt (``display.next_prompt_suggestions``).

When a turn settles, one background auxiliary call guesses the next prompt and parks it on the CLI;
``SlashCommandAutoSuggest`` renders it in the empty input and Tab accepts it. Nothing here writes
to the conversation: the suggestion is only ever sent if the user accepts it and presses Enter."""

import logging
from typing import Any, Callable, Optional

from prompt_toolkit.auto_suggest import Suggestion

from agent.aux_accounting import set_accounting_context
from agent.next_prompt_suggester import generate_next_prompt

logger = logging.getLogger(__name__)

_STATE_ATTR = "_next_prompt_state"


class _State:
    """Pending suggestion plus a generation counter; bumping it orphans in-flight results."""

    def __init__(self) -> None:
        self.text: Optional[str] = None
        self.generation = 0


def _state(cli: Any) -> _State:
    state = getattr(cli, _STATE_ATTR, None)
    if state is None:
        state = _State()
        setattr(cli, _STATE_ATTR, state)
    return state


def pending_suggestion(cli: Any) -> Optional[str]:
    return _state(cli).text


def clear_suggestion(cli: Any) -> None:
    """Drop the pending suggestion and orphan any in-flight call (submit / new turn)."""
    state = _state(cli)
    buf = _buffer(cli)
    if buf is not None and state.text and buf.suggestion is not None and buf.suggestion.text == state.text:
        buf.suggestion = None
    state.text = None
    state.generation += 1


def _setting_enabled() -> bool:
    from hermes_cli.config import load_config_readonly
    return bool(((load_config_readonly() or {}).get("display") or {}).get("next_prompt_suggestions"))


def _spawn(fn: Callable[[], None]) -> None:
    from agent.memory_provider import spawn_context_thread
    spawn_context_thread(fn, name="next-prompt-suggest").start()


def _buffer(cli: Any):
    app = getattr(cli, "_app", None)
    return getattr(app, "current_buffer", None)


def _idle_and_empty(cli: Any) -> bool:
    """Nothing running, nothing queued, nothing typed: the only moment a ghost suggestion is welcome."""
    buf = _buffer(cli)
    return (buf is not None and not buf.text and not cli._agent_running
            and cli._pending_input.empty() and cli._interrupt_queue.empty())


def _last_exchange(history: list) -> tuple[str, str]:
    """(user, assistant) text of the latest assistant message and the user message before it;
    empty when that latest assistant message carries no text (never reaches back to an older reply)."""
    from agent.message_content import flatten_message_text
    messages = list(history or [])
    idx = next((i for i in range(len(messages) - 1, -1, -1) if messages[i].get("role") == "assistant"), None)
    if idx is None:
        return "", ""
    assistant = flatten_message_text(messages[idx].get("content"))
    user = next((flatten_message_text(m.get("content")) for m in reversed(messages[:idx])
                 if m.get("role") == "user"), "")
    return user, assistant


def _apply(cli: Any, generation: int, text: str) -> None:
    """Runs on the UI thread: the generation and idle/empty checks and the buffer write are one step,
    so a keystroke cannot land between them."""
    state = _state(cli)
    if state.generation != generation or not _idle_and_empty(cli):
        return
    state.text = text
    _buffer(cli).suggestion = Suggestion(text)
    cli._app.invalidate()


def _deliver(cli: Any, generation: int, text: Optional[str]) -> None:
    """Hand a worker-thread result to the app loop (inline when there is none, e.g. before the app runs)."""
    if not text:
        return
    loop = getattr(getattr(cli, "_app", None), "loop", None)
    if loop is not None:
        loop.call_soon_threadsafe(lambda: _apply(cli, generation, text))
    else:
        _apply(cli, generation, text)


def _runtime_snapshot(cli: Any) -> dict:
    """The live session route, taken on the owning thread (like /btw and the titler): launch and
    ``/model`` overrides live on the agent, not in config.yaml."""
    agent = getattr(cli, "agent", None)
    keys = ("model", "provider", "base_url", "api_key", "api_mode", "session_id")
    return {k: getattr(agent, k, None) or getattr(cli, k, None) for k in keys}


def maybe_suggest_next_prompt(cli: Any) -> None:
    """Turn-settle hook: start the background suggestion if gating allows. Never raises."""
    try:
        if (not _setting_enabled() or not _idle_and_empty(cli)
                or cli._last_turn_interrupted or cli._last_turn_failed):
            return
        user, assistant = _last_exchange(cli.conversation_history)
        if not (user and assistant):
            return
        state = _state(cli)
        state.text = None
        state.generation += 1
        generation = state.generation

        main_runtime = _runtime_snapshot(cli)
        session_db = getattr(getattr(cli, "agent", None), "_session_db", None) or getattr(cli, "_session_db", None)
        session_id = main_runtime["session_id"]

        def work() -> None:
            try:
                # The worker starts outside any turn, so republish the owning session's accounting handles.
                set_accounting_context(session_db, session_id)
                _deliver(cli, generation, generate_next_prompt(user, assistant, main_runtime=main_runtime))
            except Exception as exc:
                logger.debug("Next-prompt delivery failed: %s", exc, exc_info=True)

        _spawn(work)
    except Exception as exc:
        logger.debug("Next-prompt trigger failed: %s", exc, exc_info=True)
