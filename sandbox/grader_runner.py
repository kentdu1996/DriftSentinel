#!/usr/bin/env python3
"""DriftSentinel code grader sandbox.

Reads a JSON job from stdin: {"code": "...", "test": "...", "timeout_s": 5}
Runs `code` + `test` in a resource-limited subprocess and reports pass/fail.

Isolation here uses POSIX rlimits + a hard timeout. This is a local-dev
substitute for the Docker sandbox described in the TDD (Docker not available
on this machine). The stdin/stdout contract is identical, so the TS caller
can switch to `docker run ... grader_runner.py` later with no code change.
"""
import json
import sys
import os
import tempfile
import subprocess

CHILD_PREAMBLE = r"""
import resource, sys
# CPU seconds hard cap
try:
    resource.setrlimit(resource.RLIMIT_CPU, ({cpu}, {cpu}))
except Exception:
    pass
# Address space cap (bytes); skip on macOS where it is unreliable
try:
    if sys.platform != "darwin":
        resource.setrlimit(resource.RLIMIT_AS, ({mem}, {mem}))
except Exception:
    pass
# No new files larger than 1MB
try:
    resource.setrlimit(resource.RLIMIT_FSIZE, (1_000_000, 1_000_000))
except Exception:
    pass
"""


def run_job(job: dict) -> dict:
    code = job.get("code", "")
    test = job.get("test", "")
    timeout_s = float(job.get("timeout_s", 5))
    cpu = max(1, int(timeout_s) + 1)
    mem = 512 * 1024 * 1024  # 512 MB

    program = (
        CHILD_PREAMBLE.format(cpu=cpu, mem=mem)
        + "\n# --- model code ---\n"
        + code
        + "\n# --- unit test ---\n"
        + test
        + "\nprint('__GRADER_PASS__')\n"
    )

    with tempfile.NamedTemporaryFile(
        "w", suffix=".py", delete=False, encoding="utf-8"
    ) as f:
        f.write(program)
        path = f.name

    try:
        proc = subprocess.run(
            [sys.executable, "-I", "-S", path],
            capture_output=True,
            text=True,
            timeout=timeout_s,
            env={"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"},
        )
        passed = "__GRADER_PASS__" in proc.stdout
        return {
            "passed": passed,
            "total": 1,
            "stderr": proc.stderr[-2000:] if not passed else "",
        }
    except subprocess.TimeoutExpired:
        return {"passed": False, "total": 1, "stderr": "timeout"}
    except Exception as e:  # noqa: BLE001
        return {"passed": False, "total": 1, "stderr": f"sandbox-error: {e}"}
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def main() -> None:
    raw = sys.stdin.read()
    try:
        job = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"passed": False, "total": 1, "stderr": f"bad-json: {e}"}))
        return
    print(json.dumps(run_job(job)))


if __name__ == "__main__":
    main()
