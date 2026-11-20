#!/usr/bin/env python3
"""
Times the real question on the Ollama of the machine it runs on (the model speed test of docs/operations/vm-runbook.md), and says whether the first word comes soon enough.

  python3 deploy/model-speed.py <model> [--base http://127.0.0.1:11434] [--limit 30]

In this order: the model is unloaded so that the first read is cold; a question is asked (the model loads and reads the whole prompt); a second is asked (the prompt is read
already, as the second question of a conversation is); four are asked at once, as four people would; and where the model sits, on the card or on the processor, is read from Ollama.
The prompts are the ones the portal builds for the made-up estate of server/scripts/bakeoff, taken from prompt-sample.json, so nothing of HCML's is sent. Python 3 and its own
library only. Exit 0 when the first word of the cold question came within --limit seconds, 1 when it did not, 2 when the test could not run.
"""
import argparse
import concurrent.futures
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SAMPLE = os.path.join(HERE, "..", "server", "scripts", "bakeoff", "prompt-sample.json")


class Trouble(Exception):
    """The test could not run: Ollama does not answer, or does not know the model."""


class Refused(Trouble):
    def __init__(self, status, text):
        super().__init__(f"HTTP {status}: {text}")
        self.status = status
        self.text = text


def call(base, method, path, body=None, timeout=600):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(base + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode() or "{}")
    except urllib.error.HTTPError as err:
        raise Refused(err.code, err.read().decode(errors="replace")[:300]) from None
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise Trouble(f"{base} does not answer ({getattr(err, 'reason', err)}). Is Ollama running, and is this the right --base?") from None


def seconds(reply, key):
    return (reply.get(key) or 0) / 1e9


def ask(args, sample, item):
    """One question as the portal asks it: the system text, then the question; the whole reply at once, so the first word is load plus reading."""
    system = sample["prefix"] + ("\n\n" + item["tail"] if item["tail"] else "")
    body = {
        "model": args.model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": item["q"]}],
        "stream": False,
        "think": False,
        "keep_alive": "15m",
        "options": {"num_ctx": args.num_ctx, "num_predict": args.predict},
    }
    started = time.monotonic()
    try:
        reply = call(args.base, "POST", "/api/chat", body, args.timeout)
    except Refused as err:
        if err.status == 404:
            raise Trouble(f"{args.model} is not on this machine. Pull it first: ollama pull {args.model}") from None
        if "think" not in err.text.lower():
            raise
        # A model with no thinking mode refuses the switch; the portal sends it only to those that have one.
        del body["think"]
        reply = call(args.base, "POST", "/api/chat", body, args.timeout)
    wall = time.monotonic() - started
    read = seconds(reply, "prompt_eval_duration")
    load = seconds(reply, "load_duration")
    return {
        "wall": wall,
        "load": load,
        "read": read,
        "first": load + read,
        "prompt_tokens": reply.get("prompt_eval_count", 0),
        "tokens": reply.get("eval_count", 0),
        "rate": (reply.get("eval_count", 0) / seconds(reply, "eval_duration")) if seconds(reply, "eval_duration") else 0.0,
    }


def unload(args):
    call(args.base, "POST", "/api/generate", {"model": args.model, "keep_alive": 0}, 60)
    for _ in range(30):
        if not any(m.get("name") == args.model or m.get("model") == args.model for m in call(args.base, "GET", "/api/ps", None, 10).get("models", [])):
            return
        time.sleep(1)
    print("note: Ollama still lists the model as loaded after 30 s, so the first read may not be cold", file=sys.stderr)


def placement(args):
    for m in call(args.base, "GET", "/api/ps", None, 10).get("models", []):
        if m.get("name") == args.model or m.get("model") == args.model:
            size, vram = m.get("size", 0), m.get("size_vram", 0)
            if not size:
                return "not reported"
            share = round(100 * vram / size)
            gb = lambda n: f"{n / 1e9:.1f} GB"
            where = "100% GPU" if share >= 100 else ("100% processor" if share == 0 else f"{share}% GPU / {100 - share}% processor")
            return f"{where} ({gb(vram)} of {gb(size)} on the card)"
    return "not loaded"


def gpu_memory():
    """Used and total memory of the first NVIDIA card, or None on a machine without one."""
    if not shutil.which("nvidia-smi"):
        return None
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=20, check=True).stdout
        used, total = [int(v) for v in out.splitlines()[0].split(",")]
        return used, total
    except (subprocess.SubprocessError, ValueError, IndexError):
        return None


def main(argv):
    parser = argparse.ArgumentParser(description="Time the real question on this machine's Ollama.")
    parser.add_argument("model")
    parser.add_argument("--base", default=os.environ.get("OLLAMA_BASE", "http://127.0.0.1:11434"))
    parser.add_argument("--limit", type=float, default=30, help="seconds the first word of a cold question may take")
    parser.add_argument("--num-ctx", type=int, default=8192)
    parser.add_argument("--predict", type=int, default=150, help="tokens of each answer to wait for")
    parser.add_argument("--timeout", type=float, default=600)
    parser.add_argument("--sample", default=DEFAULT_SAMPLE)
    args = parser.parse_args(argv)
    args.base = args.base.rstrip("/")

    try:
        with open(args.sample, encoding="utf-8") as handle:
            sample = json.load(handle)
    except (OSError, ValueError) as err:
        print(f"cannot read the prompts at {args.sample}: {err}", file=sys.stderr)
        return 2

    try:
        unload(args)
        before = gpu_memory()
        cold = ask(args, sample, sample["questions"][0])
        warm = ask(args, sample, sample["questions"][1])
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            started = time.monotonic()
            futures = [pool.submit(lambda item: (ask(args, sample, item), time.monotonic() - started), item) for item in sample["questions"][:4]]
            together = sorted(f.result()[1] for f in futures)
        sits = placement(args)
        after = gpu_memory()
    except Trouble as err:
        print(f"model-speed: {err}", file=sys.stderr)
        return 2

    rate = lambda r: f"{r['prompt_tokens'] / r['read']:.0f} tokens a second" if r["read"] else "not timed"
    print(f"model         {args.model} on {args.base}, context {args.num_ctx}")
    print(f"sits on       {sits}")
    print(f"cold          first word after {cold['first']:.1f} s (load {cold['load']:.1f} s, then {cold['prompt_tokens']} tokens read in {cold['read']:.1f} s, {rate(cold)}); answer done in {cold['wall']:.1f} s")
    print(f"warm          first word after {warm['first']:.1f} s; answer done in {warm['wall']:.1f} s")
    print(f"speed         {warm['rate']:.0f} tokens a second while answering")
    print(f"four at once  the last was done after {together[-1]:.1f} s (each: {', '.join(f'{t:.1f}' for t in together)})")
    if before and after:
        print(f"card memory   {before[0]} MiB before, {after[0]} MiB after, of {after[1]} MiB (look again after a day of use)")
    ok = cold["first"] <= args.limit
    print(f"verdict       {'PASS' if ok else 'FAIL'}: the first word of a cold question came after {cold['first']:.1f} s; the limit is {args.limit:.0f} s")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
