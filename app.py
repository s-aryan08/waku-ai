"""Waku AI Companion - Flask Application.

Serves the modern chat interface and handles real-time dialogue and streaming
with Waku using the Google Agent Development Kit (ADK).
"""

import asyncio
import json
import logging
import os
import queue
import threading
from typing import Dict
from flask import Flask, Response, jsonify, render_template, request
from dotenv import load_dotenv
from google.adk.runners import InMemoryRunner, RunConfig
from google.genai import types

# Load environment variables from .env file if available
load_dotenv()

# Fallback: check standard Cloud Shell credential locations if GEMINI_API_KEY is not set
if "GEMINI_API_KEY" not in os.environ:
    for fallback_file in [
        os.path.expanduser("~/gemini_key.txt"),
        os.path.expanduser("~/api_key.txt"),
    ]:
        if os.path.exists(fallback_file):
            try:
                with open(fallback_file, "r", encoding="utf-8") as f:
                    key = f.read().strip()
                    if key:
                        os.environ["GEMINI_API_KEY"] = key
                        break
            except OSError:
                pass

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("waku_ai")

app = Flask(__name__)

# Initialize Google ADK runner with character agent
runner = None
StreamingMode = None

try:
    import character
    StreamingMode = RunConfig.model_fields["streaming_mode"].annotation

    runner = InMemoryRunner(
        agent=character.root_agent,
        app_name="Waku AI",
    )
    logger.info("ADK InMemoryRunner initialized successfully with agent: %s", character.root_agent.name)
except Exception as e:
    logger.warning("Could not initialize ADK Runner: %s", e)

# Thread-safe mapping of active session IDs to their abort events
active_aborts: Dict[str, asyncio.Event] = {}
aborts_lock = threading.Lock()


def build_prompt_with_locale(user_message: str, language: str) -> str:
    """Formats the prompt with voice language context if non-English voice selected."""
    if language.lower().startswith("hi"):
        return f"[Voice: Hindi (hi-IN). Reply in natural conversational Hindi in Devanagari script. No asterisks or physical action descriptions]\n{user_message}"
    if language.lower().startswith("en"):
        return f"[Voice: English. Reply in natural conversational English. No asterisks or physical action descriptions]\n{user_message}"
    if language:
        return f"[Voice Locale: {language}. Reply in this language. No asterisks or physical action descriptions]\n{user_message}"
    return user_message


@app.route("/")
def index():
    """Renders the main Waku AI companion interface."""
    return render_template("index.html")


@app.route("/chat", methods=["POST"])
async def chat():
    """Non-streaming chat endpoint returning complete JSON response."""
    data = request.get_json(silent=True)
    if not data or "message" not in data:
        return jsonify({"error": "Missing 'message' in request body."}), 400

    user_message = data.get("message", "").strip()
    session_id = data.get("session_id", "default_session").strip()
    language = data.get("language", "en-US").strip()

    if not user_message:
        return jsonify({"error": "Message content cannot be empty."}), 400

    if runner is None:
        return jsonify({
            "response": "I'm having trouble connecting to my agent right now. Please check server configuration.",
        }), 503

    try:
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

        prompt_text = build_prompt_with_locale(user_message, language)
        content = types.Content(role="user", parts=[types.Part(text=prompt_text)])
        response_text = ""

        # In non-streaming mode, final event has complete text
        async for event in runner.run_async(
            user_id=adk_session.user_id,
            session_id=adk_session.id,
            new_message=content,
        ):
            if event.content and event.content.parts:
                for part in event.content.parts:
                    if part.text:
                        response_text += part.text

        if not response_text:
            response_text = "I heard you, but I'm not sure how to respond just yet! Could you ask that again?"

        return jsonify({"response": response_text})

    except Exception as exc:
        logger.error("Error in /chat: %s", exc, exc_info=True)
        return jsonify({
            "response": "Sorry, my thoughts got a little tangled. Could you try asking me that again?",
            "error": str(exc),
        }), 200


@app.route("/chat/stream", methods=["POST"])
def chat_stream():
    """Real-time SSE streaming endpoint with chunk-level cancellation support."""
    data = request.get_json(silent=True) or {}
    user_message = data.get("message", "").strip()
    session_id = data.get("session_id", "default_session").strip()
    language = data.get("language", "en-US").strip()

    if not user_message:
        return jsonify({"error": "Message content cannot be empty."}), 400

    if runner is None:
        return jsonify({"error": "Runner not initialized."}), 503

    def generate_events():
        q: queue.Queue = queue.Queue()
        sentinel = object()
        abort_event = asyncio.Event()

        with aborts_lock:
            active_aborts[session_id] = abort_event

        def worker():
            async def run():
                try:
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

                    prompt_text = build_prompt_with_locale(user_message, language)
                    content = types.Content(role="user", parts=[types.Part(text=prompt_text)])
                    run_cfg = RunConfig(streaming_mode=StreamingMode.SSE)
                    full_text = ""

                    async for event in runner.run_async(
                        user_id=adk_session.user_id,
                        session_id=adk_session.id,
                        new_message=content,
                        run_config=run_cfg,
                        abort_signal=abort_event,
                    ):
                        if abort_event.is_set():
                            break

                        # Intermediate events contain delta chunks
                        if not event.is_final_response() and event.content and event.content.parts:
                            for p in event.content.parts:
                                if p.text:
                                    full_text += p.text
                                    q.put(json.dumps({"type": "chunk", "text": p.text}))

                        # Final event marks end of turn
                        elif event.is_final_response():
                            q.put(json.dumps({"type": "done", "full_text": full_text}))

                except Exception as exc:
                    logger.error("Error during streaming generation: %s", exc, exc_info=True)
                    q.put(json.dumps({"type": "error", "error": str(exc)}))
                finally:
                    with aborts_lock:
                        active_aborts.pop(session_id, None)
                    q.put(sentinel)

            asyncio.run(run())

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()

        try:
            while True:
                item = q.get()
                if item is sentinel:
                    break
                yield f"data: {item}\n\n"
        except GeneratorExit:
            # Client disconnected or cancelled fetch
            abort_event.set()
            with aborts_lock:
                active_aborts.pop(session_id, None)

    return Response(
        generate_events(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.route("/chat/stop", methods=["POST"])
def chat_stop():
    """Cancels active response generation for a given session."""
    data = request.get_json(silent=True) or {}
    session_id = data.get("session_id", "").strip()

    with aborts_lock:
        abort_ev = active_aborts.get(session_id)
        if abort_ev:
            abort_ev.set()
            logger.info("Session %s aborted via /chat/stop", session_id)
            return jsonify({"status": "cancelled", "session_id": session_id})

    return jsonify({"status": "not_active", "session_id": session_id})


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run Waku AI Companion server")
    parser.add_argument("--port", "-p", type=int, default=None, help="Port to run on (default: 5000 or $PORT)")
    parser.add_argument("--host", type=str, default=None, help="Host to bind to (default: 0.0.0.0 or $HOST)")
    parser.add_argument("pos_port", nargs="?", type=int, default=None, help="Optional positional port (e.g. python app.py 8080)")
    args, _ = parser.parse_known_args()

    host = args.host or os.environ.get("HOST", "0.0.0.0")
    port = args.port or args.pos_port or int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() in ("true", "1", "t")

    logger.info("Starting Waku AI server on %s:%d (debug=%s)", host, port, debug)
    app.run(host=host, port=port, debug=debug)
