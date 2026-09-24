#!/usr/bin/env python3
"""Generate or edit an image with an OpenRouter image model (default: Nano Banana 2).

Usage:
  scripts/gen-image.py OUT.png "prompt" [--ref IMG ...] [--model MODEL] [--aspect 1:1]

Reads OPENROUTER_API_KEY from the environment or .env.local. Stdlib only.
"""

import argparse
import base64
import json
import mimetypes
import os
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_MODEL = "google/gemini-3.1-flash-image"


def api_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY")
    env = ROOT / ".env.local"
    if not key and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("OPENROUTER_API_KEY="):
                key = line.split("=", 1)[1].strip().strip("'\"")
    if not key:
        sys.exit("OPENROUTER_API_KEY not set (env or .env.local)")
    return key


def data_url(path: str) -> str:
    mime = mimetypes.guess_type(path)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(pathlib.Path(path).read_bytes()).decode()}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("prompt")
    ap.add_argument("--ref", action="append", default=[], help="reference image(s) to edit or match")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--aspect", default="1:1")
    args = ap.parse_args()

    content = [{"type": "text", "text": args.prompt}]
    content += [{"type": "image_url", "image_url": {"url": data_url(r)}} for r in args.ref]
    body = {
        "model": args.model,
        "messages": [{"role": "user", "content": content}],
        "modalities": ["image", "text"],
        "image_config": {"aspect_ratio": args.aspect},
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {api_key()}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            res = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:500]}")

    msg = res["choices"][0]["message"]
    images = msg.get("images") or []
    if not images:
        sys.exit(f"no image returned: {(msg.get('content') or '')[:300]}")
    url = images[0]["image_url"]["url"]
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(base64.b64decode(url.split(",", 1)[1]))
    cost = res.get("usage", {}).get("cost")
    print(f"{out}  ({out.stat().st_size // 1024} KB{f', ${cost:.4f}' if cost else ''})")


if __name__ == "__main__":
    main()
