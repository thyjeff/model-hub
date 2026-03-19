"""Voice bridge: mic -> STT -> Claude CLI -> ESP32 LCD.

Requirements (Python 3.9+):
  pip install sounddevice vosk

Download a Vosk model and set VOSK_MODEL_PATH below.
Models: https://alphacephei.com/vosk/models

Usage:
  python tools\voice_bridge.py
"""

import json
import queue
import re
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import sounddevice as sd
from vosk import KaldiRecognizer, Model

# ---- Config ----
SAMPLE_RATE = 16000
BLOCK_SIZE = 8000
CHANNELS = 1

WAKE_WORDS = ["hey agent", "hi agent"]
LISTEN_TIMEOUT_SEC = 10

# Claude CLI command. The bridge will send the query via stdin.
CLI_COMMAND = [
    "claude",
    "--resume",
    "0f142655-687f-4153-b58c-3ca35ddfbd7a",
]

# Vosk model directory (download and unzip first)
VOSK_MODEL_PATH = "C:/vosk/vosk-model-small-en-us-0.15"

# HTTP server for ESP32 to poll
HTTP_HOST = "0.0.0.0"
HTTP_PORT = 5000

# ---- State ----
state = {
    "you": "",
    "agent": "",
    "ts": 0,
    "status": "idle",
}

_audio_q = queue.Queue()


def _normalize(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text


def _find_wake(text: str):
    for ww in WAKE_WORDS:
        idx = text.find(ww)
        if idx != -1:
            return idx, ww
    return -1, ""


def _run_cli(prompt: str) -> str:
    try:
        result = subprocess.run(
            CLI_COMMAND,
            input=prompt + "\n",
            capture_output=True,
            text=True,
            check=False,
        )
        output = (result.stdout or "").strip()
        if not output:
            output = (result.stderr or "").strip()
        return output or "(no response)"
    except Exception as exc:
        return f"CLI error: {exc}"


class ReplyHandler(BaseHTTPRequestHandler):
    def _send_json(self, payload, code=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/reply"):
            self._send_json(state)
            return
        self._send_json({"ok": True, "status": state["status"]})

    def log_message(self, format, *args):
        return


def _http_server():
    httpd = ThreadingHTTPServer((HTTP_HOST, HTTP_PORT), ReplyHandler)
    httpd.serve_forever()


def _audio_callback(indata, frames, time_info, status):
    if status:
        return
    _audio_q.put(bytes(indata))


def main():
    print("Starting voice bridge...")
    print(f"HTTP server on http://{HTTP_HOST}:{HTTP_PORT}")

    model = Model(VOSK_MODEL_PATH)
    rec = KaldiRecognizer(model, SAMPLE_RATE)
    rec.SetWords(False)

    threading.Thread(target=_http_server, daemon=True).start()

    armed = False
    armed_since = 0.0

    with sd.RawInputStream(
        samplerate=SAMPLE_RATE,
        blocksize=BLOCK_SIZE,
        dtype="int16",
        channels=CHANNELS,
        callback=_audio_callback,
    ):
        print("Listening for wake word...")
        while True:
            data = _audio_q.get()
            if rec.AcceptWaveform(data):
                result = json.loads(rec.Result())
                text = _normalize(result.get("text", ""))
                if not text:
                    continue

                if not armed:
                    idx, ww = _find_wake(text)
                    if idx != -1:
                        # If wake word and extra text are in same utterance, use remainder.
                        after = text[idx + len(ww):].strip()
                        armed = True
                        armed_since = time.time()
                        state["status"] = "listening"
                        if after:
                            query = after
                        else:
                            print("Wake detected. Say your query...")
                            continue
                    else:
                        continue
                else:
                    query = text

                if time.time() - armed_since > LISTEN_TIMEOUT_SEC:
                    armed = False
                    state["status"] = "idle"
                    continue

                if query:
                    state["you"] = query
                    state["status"] = "thinking"
                    print(f"YOU: {query}")
                    reply = _run_cli(query)
                    state["agent"] = reply
                    state["ts"] = int(time.time())
                    state["status"] = "idle"
                    print(f"AGENT: {reply}")
                    armed = False
            else:
                # Partial results are ignored for stability
                pass


if __name__ == "__main__":
    main()
