"""The real post-turn path: snapshot on the owning thread, background call, delivery on the app loop."""

import queue
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from agent import aux_accounting, next_prompt_suggester
from hermes_cli import next_prompt_suggestions as nps


class _Buffer:
    def __init__(self):
        self.text = ""
        self.suggestion = None


class _Loop:
    """Collects callbacks the way prompt_toolkit's loop would defer them to the UI thread."""

    def __init__(self):
        self.callbacks = []

    def call_soon_threadsafe(self, fn):
        self.callbacks.append(fn)


def _cli(loop=None, db=None):
    agent = SimpleNamespace(model="live-model", provider="live-provider", base_url="http://live",
                            api_key="live-key", api_mode="chat_completions", session_id="sess-1",
                            _session_db=db)
    buf = _Buffer()
    return SimpleNamespace(
        _app=SimpleNamespace(current_buffer=buf, invalidate=lambda: None, loop=loop),
        _agent_running=False, _pending_input=queue.Queue(), _interrupt_queue=queue.Queue(),
        _last_turn_interrupted=False, _last_turn_failed=False, agent=agent, session_id="sess-1",
        conversation_history=[{"role": "user", "content": "run the tests"},
                              {"role": "assistant", "content": "All green."}],
    ), buf


def _run_background(monkeypatch, cli, fake_call_llm):
    done = threading.Event()
    real_generate = nps.generate_next_prompt

    def generate(*a, **kw):
        try:
            return real_generate(*a, **kw)
        finally:
            done.set()

    monkeypatch.setattr(next_prompt_suggester, "call_llm", fake_call_llm)
    monkeypatch.setattr(nps, "generate_next_prompt", generate)
    monkeypatch.setattr(nps, "_setting_enabled", lambda: True)
    nps.maybe_suggest_next_prompt(cli)
    assert done.wait(5)


def _resp(text="commit that"):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))], usage=None)


def test_live_session_route_reaches_call_llm(monkeypatch):
    cli, _ = _cli()
    seen = {}

    def fake(**kw):
        seen.update(kw)
        return _resp()

    _run_background(monkeypatch, cli, fake)
    assert seen["main_runtime"] == {
        "model": "live-model", "provider": "live-provider", "base_url": "http://live",
        "api_key": "live-key", "api_mode": "chat_completions", "session_id": "sess-1"}


def test_aux_usage_is_recorded_against_the_owning_session(monkeypatch):
    db = MagicMock()
    cli, _ = _cli(db=db)
    seen = {}

    def fake(**kw):
        seen["ctx"] = aux_accounting._accounting.get()
        return _resp()

    _run_background(monkeypatch, cli, fake)
    assert seen["ctx"] == (db, "sess-1")


def test_keystroke_between_check_and_apply_leaves_no_ghost(monkeypatch):
    loop = _Loop()
    cli, buf = _cli(loop=loop)
    _run_background(monkeypatch, cli, lambda **kw: _resp())
    assert len(loop.callbacks) == 1  # delivery is deferred to the UI thread, not applied by the worker
    assert buf.suggestion is None
    buf.text = "x"  # the user types before the UI thread gets to it
    loop.callbacks[0]()
    assert buf.suggestion is None and nps.pending_suggestion(cli) is None


def test_delivery_on_the_app_loop_shows_the_ghost(monkeypatch):
    loop = _Loop()
    cli, buf = _cli(loop=loop)
    _run_background(monkeypatch, cli, lambda **kw: _resp())
    loop.callbacks[0]()
    assert buf.suggestion.text == "commit that"


def test_latest_assistant_message_without_text_gives_no_suggestion(monkeypatch):
    cli, _ = _cli()
    cli.conversation_history = [
        {"role": "user", "content": "q1"}, {"role": "assistant", "content": "old reply"},
        {"role": "user", "content": "q2"}, {"role": "assistant", "content": "", "tool_calls": [{}]},
    ]
    monkeypatch.setattr(nps, "_setting_enabled", lambda: True)
    spawned = []
    monkeypatch.setattr(nps, "_spawn", spawned.append)
    nps.maybe_suggest_next_prompt(cli)
    assert spawned == []
