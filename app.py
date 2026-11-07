"""Waku AI Companion - Flask Application.

Serves the chat interface and streams Google ADK responses with reliable,
thread-safe cancellation.
"""

import asyncio
import json
import logging
import os
import queue
import threading
from dataclasses import dataclass
from typing import Optional

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request, stream_with_context
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import InMemoryRunner
from google.genai import types

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

load_dotenv()

# Optional fallback locations used in the original Cloud Shell setup.
if not os.environ.get("GEMINI_API_KEY"):
    for fallback_file in (
        os.path.expanduser("~/gemini_key.txt"),
        os.path.expanduser("~/api_key.txt"),
    ):
        try:
            if os.path.isfile(fallback_file):
                key = open(fallback_file, "r", encoding="utf-8").read().strip()
                if key:
                    os.environ["GEMINI_API_KEY"] = key
                    break
        except OSError:
            pass

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("waku_ai")

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Google ADK runner
# ---------------------------------------------------------------------------

runner = None

try:
    import character

    runner = InMemoryRunner(
        agent=character.root_agent,
        app_name="Waku AI",
    )
    logger.info(
        "ADK InMemoryRunner initialized with agent: %s",
        character.root_agent.name,
    )
except Exception:
    logger.exception("Could not initialize the Google ADK runner")


# ---------------------------------------------------------------------------
# Active stream registry
#
# IMPORTANT:
# asyncio.Event is bound to the event loop that owns it. Flask's stop route
# runs in a different thread, so it must NOT call event.set() directly.
# Instead, it schedules event.set() with loop.call_soon_threadsafe().
# ---------------------------------------------------------------------------

@dataclass
class ActiveRun:
    cancel_requested: threading.Event
    loop: Optional[asyncio.AbstractEventLoop] = None
    abort_signal: Optional[asyncio.Event] = None


active_runs: dict[str, ActiveRun] = {}
active_runs_lock = threading.Lock()


def request_cancellation(session_id: str) -> bool:
    """Request cancellation safely from any Flask/worker thread."""
    with active_runs_lock:
        active = active_runs.get(session_id)
        if active is None:
            return False

        active.cancel_requested.set()

        loop = active.loop
        abort_signal = active.abort_signal

        if loop is not None and abort_signal is not None and not loop.is_closed():
            try:
                loop.call_soon_threadsafe(abort_signal.set)
            except RuntimeError:
                # The worker's event loop may have closed during cleanup.
                pass

        return True


def remove_active_run(session_id: str, active: ActiveRun) -> None:
    """Remove a run only if it is still the registered run for this session."""
    with active_runs_lock:
        if active_runs.get(session_id) is active:
            active_runs.pop(session_id, None)


def build_prompt_with_locale(user_message: str, language: str) -> str:
    """Add language instructions to the user's message."""
    language = (language or "en-US").strip()

    if language.lower().startswith("hi"):
        instruction = (
            "[Voice: Hindi (hi-IN). Reply in natural conversational Hindi "
            "in Devanagari script. No asterisks or physical action descriptions.]\n"
        )
    elif language.lower().startswith("en"):
        instruction = (
            "[Voice: English. Reply in natural conversational English. "
            "No asterisks or physical action descriptions.]\n"
        )
    else:
        instruction = (
            f"[Voice Locale: {language}. Reply in this language. "
            "No asterisks or physical action descriptions.]\n"
        )

    return instruction + user_message


async def get_or_create_session(session_id: str):
    """Get the ADK session, creating it if this is the first message."""
    adk_session = await runner.session_service.get_session(
        app_name=runner.app_name,
        user_id="inapp_user",
        session_id=session_id,
    )

    if adk_session is None:
        adk_session = await runner.session_service.create_session(
            app_name=runner.app_name,
            user_id="inapp_user",
            session_id=session_id,
        )

    return adk_session


def make_sse(payload: dict) -> str:
    """Encode one Server-Sent Event using the existing frontend JSON format."""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


# ---------------------------------------------------------------------------
# Pages and non-streaming chat
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/chat", methods=["POST"])
async def chat():
    """Return a complete response as JSON (non-streaming endpoint)."""
    data = request.get_json(silent=True) or {}

    user_message = str(data.get("message", "")).strip()
    session_id = str(data.get("session_id") or "default_session").strip()
    language = str(data.get("language") or "en-US").strip()

    if not user_message:
        return jsonify({"error": "Message content cannot be empty."}), 400

    if runner is None:
        return jsonify({"error": "The AI agent is not initialized."}), 503

    try:
        adk_session = await get_or_create_session(session_id)
        content = types.Content(
            role="user",
            parts=[types.Part(text=build_prompt_with_locale(user_message, language))],
        )

        response_parts = []

        async for event in runner.run_async(
            user_id=adk_session.user_id,
            session_id=adk_session.id,
            new_message=content,
        ):
            if event.content and event.content.parts:
                for part in event.content.parts:
                    if part.text:
                        response_parts.append(part.text)

        response_text = "".join(response_parts).strip()
        if not response_text:
            response_text = (
                "I heard you, but I'm not sure how to respond just yet. "
                "Could you ask that again?"
            )

        return jsonify({"response": response_text})

    except Exception as exc:
        logger.exception("Error in /chat")
        return jsonify({
            "response": "Sorry, my thoughts got a little tangled. Please try again.",
            "error": str(exc),
        }), 500


# ---------------------------------------------------------------------------
# Streaming chat with cancellation
# ---------------------------------------------------------------------------

@app.route("/chat/stream", methods=["POST"])
def chat_stream():
    """Stream response chunks over SSE and support the Stop button."""
    data = request.get_json(silent=True) or {}

    user_message = str(data.get("message", "")).strip()
    session_id = str(data.get("session_id") or "default_session").strip()
    language = str(data.get("language") or "en-US").strip()

    if not user_message:
        return jsonify({"error": "Message content cannot be empty."}), 400

    if runner is None:
        return jsonify({"error": "The AI agent is not initialized."}), 503

    if not session_id:
        return jsonify({"error": "A valid session_id is required."}), 400

    def generate_events():
        event_queue: queue.Queue = queue.Queue()
        sentinel = object()
        active = ActiveRun(cancel_requested=threading.Event())

        # Register before starting the worker so an immediate Stop request
        # can find this generation.
        with active_runs_lock:
            previous = active_runs.get(session_id)
            if previous is not None:
                previous.cancel_requested.set()
                if previous.loop and previous.abort_signal and not previous.loop.is_closed():
                    try:
                        previous.loop.call_soon_threadsafe(previous.abort_signal.set)
                    except RuntimeError:
                        pass
            active_runs[session_id] = active

        def worker():
            async def run_agent():
                loop = asyncio.get_running_loop()
                abort_signal = asyncio.Event()

                # Publish the loop-owned asyncio.Event for the stop endpoint.
                with active_runs_lock:
                    active.loop = loop
                    active.abort_signal = abort_signal
                    already_cancelled = active.cancel_requested.is_set()

                if already_cancelled:
                    abort_signal.set()

                full_text = ""
                final_response_seen = False

                try:
                    adk_session = await get_or_create_session(session_id)

                    if active.cancel_requested.is_set():
                        abort_signal.set()
                        event_queue.put({"type": "cancelled"})
                        return

                    content = types.Content(
                        role="user",
                        parts=[
                            types.Part(
                                text=build_prompt_with_locale(user_message, language)
                            )
                        ],
                    )
                    run_config = RunConfig(streaming_mode=StreamingMode.SSE)

                    async for event in runner.run_async(
                        user_id=adk_session.user_id,
                        session_id=adk_session.id,
                        new_message=content,
                        run_config=run_config,
                        abort_signal=abort_signal,
                    ):
                        if active.cancel_requested.is_set():
                            break

                        if event.content and event.content.parts:
                            for part in event.content.parts:
                                if part.text and not event.is_final_response():
                                    full_text += part.text
                                    event_queue.put({
                                        "type": "chunk",
                                        "text": part.text,
                                    })

                        if event.is_final_response():
                            final_response_seen = True

                    if active.cancel_requested.is_set() or abort_signal.is_set():
                        event_queue.put({"type": "cancelled"})
                    else:
                        event_queue.put({
                            "type": "done",
                            "full_text": full_text,
                        })

                    if not final_response_seen and not active.cancel_requested.is_set():
                        logger.warning(
                            "ADK stream ended without a final response for session %s",
                            session_id,
                        )

                except Exception as exc:
                    if active.cancel_requested.is_set():
                        event_queue.put({"type": "cancelled"})
                    else:
                        logger.exception("Error during streaming generation")
                        event_queue.put({
                            "type": "error",
                            "error": "The assistant encountered an error. Please try again.",
                        })
                finally:
                    remove_active_run(session_id, active)
                    event_queue.put(sentinel)

            try:
                asyncio.run(run_agent())
            except Exception:
                logger.exception("Streaming worker failed")
                remove_active_run(session_id, active)
                event_queue.put({
                    "type": "error",
                    "error": "The assistant could not complete this response.",
                })
                event_queue.put(sentinel)

        worker_thread = threading.Thread(
            target=worker,
            name=f"waku-stream-{session_id[:24]}",
            daemon=True,
        )
        worker_thread.start()

        try:
            while True:
                try:
                    item = event_queue.get(timeout=15)
                except queue.Empty:
                    # Heartbeat keeps proxies from closing an idle SSE stream
                    # and gives the server regular opportunities to notice disconnects.
                    yield ": keep-alive\n\n"
                    continue

                if item is sentinel:
                    break

                yield make_sse(item)

        except GeneratorExit:
            # Browser closed the stream or its fetch was aborted.
            request_cancellation(session_id)
            raise
        finally:
            # Also cancel if the response is closed for any other reason.
            if active_runs.get(session_id) is active:
                request_cancellation(session_id)

    response = Response(
        stream_with_context(generate_events()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
    response.timeout = None
    return response


# ---------------------------------------------------------------------------
# Stop endpoint
# ---------------------------------------------------------------------------

@app.route("/chat/stop", methods=["POST"])
def chat_stop():
    """Stop the currently running generation for the supplied session."""
    data = request.get_json(silent=True) or {}
    session_id = str(data.get("session_id") or "").strip()

    if not session_id:
        return jsonify({
            "status": "error",
            "error": "session_id is required.",
        }), 400

    if request_cancellation(session_id):
        logger.info("Cancellation requested for session %s", session_id)
        return jsonify({
            "status": "cancellation_requested",
            "session_id": session_id,
        }), 200

    return jsonify({
        "status": "not_active",
        "session_id": session_id,
    }), 200


# ---------------------------------------------------------------------------
# Health check and local startup
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "agent_ready": runner is not None,
        "active_streams": len(active_runs),
    })


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run Waku AI Companion server")
    parser.add_argument("--port", "-p", type=int, default=None)
    parser.add_argument("--host", type=str, default=None)
    parser.add_argument("pos_port", nargs="?", type=int, default=None)
    args, _ = parser.parse_known_args()

    host = args.host or os.environ.get("HOST", "0.0.0.0")
    port = args.port or args.pos_port or int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() in ("true", "1", "t")

    logger.info(
        "Starting Waku AI server on %s:%d (debug=%s)",
        host,
        port,
        debug,
    )
    app.run(host=host, port=port, debug=debug, threaded=True)
