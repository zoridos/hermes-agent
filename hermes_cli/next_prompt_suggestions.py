"""Classic-CLI ghost-text suggestion of the user's next prompt (``display.next_prompt_suggestions``).

When a turn settles, one background auxiliary call guesses the next prompt and parks it on the CLI;
``SlashCommandAutoSuggest`` renders it in the empty input and Tab accepts it. Nothing here writes
to the conversation: the suggestion is only ever sent if the user accepts it and presses Enter."""

import logging
from typing import Any, Callable, Optional

from prompt_toolkit.auto_suggest import Suggestion

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
    from agent.message_content import flatten_message_text
    assistant = user = ""
    for msg in reversed(history or []):
        role = msg.get("role")
        if role == "assistant" and not assistant and not msg.get("tool_calls"):
            assistant = flatten_message_text(msg.get("content"))
        elif role == "user" and assistant:
            user = flatten_message_text(msg.get("content"))
            break
    return user, assistant


def _deliver(cli: Any, generation: int, text: Optional[str]) -> None:
    state = _state(cli)
    if not text or state.generation != generation or not _idle_and_empty(cli):
        return
    state.text = text
    buf = _buffer(cli)
    buf.suggestion = Suggestion(text)
    cli._app.invalidate()


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

        def work() -> None:
            try:
                _deliver(cli, generation, generate_next_prompt(user, assistant))
            except Exception as exc:
                logger.debug("Next-prompt delivery failed: %s", exc, exc_info=True)

        _spawn(work)
    except Exception as exc:
        logger.debug("Next-prompt trigger failed: %s", exc, exc_info=True)
