#!/usr/bin/env python3
"""
Elastic cron scaler — adjusts agent cron job intervals based on recent activity.

Runs as a system cron (every 3 min). Zero LLM cost.

Logic per agent:
  - Reads the last N runs from ~/.openclaw/cron/runs/<job_id>.jsonl
  - Classifies each as WORK, NOOP, or ERROR
  - If recent runs are mostly NOOP → back off (increase interval)
  - If recent runs are mostly WORK → speed up (decrease interval)
  - Applies changes via `openclaw cron edit --every <duration>`

Tiers (per-agent, based on last 5 finished runs):
  - 4-5 WORK runs  → "hot"     → min interval (every 2m)
  - 2-3 WORK runs  → "warm"    → medium interval (every 4m)
  - 0-1 WORK runs  → "cold"    → slow interval (every 8m)
  - All ERROR       → "broken"  → leave unchanged (don't touch broken jobs)

Sentinel rule: each agent always keeps at least one job enabled, even when cold.
"""

import json
import os
import sys
import time
from pathlib import Path

CRON_DIR = Path.home() / ".openclaw" / "cron"
RUNS_DIR = CRON_DIR / "runs"
JOBS_FILE = CRON_DIR / "jobs.json"
STATE_FILE = Path.home() / ".openclaw" / "workspace" / "data" / "cron-scaler-state.json"

# How many recent finished runs to consider
WINDOW = 5

# Interval tiers in milliseconds
TIER_HOT_MS = 2 * 60 * 1000       # 2 min
TIER_WARM_MS = 4 * 60 * 1000      # 4 min
TIER_COLD_MS = 8 * 60 * 1000      # 8 min

# Agents that should NOT be scaled (manual management)
EXCLUDE_AGENTS = {"hermes", "ceo"}

# Job name patterns to exclude from scaling
EXCLUDE_PATTERNS = {"babysit", "check-in", "checkin", "digest", "lembrete", "gtd", "willian"}

DRY_RUN = "--dry-run" in sys.argv
VERBOSE = "--verbose" in sys.argv or DRY_RUN


def log(msg: str) -> None:
    if VERBOSE:
        print(msg)


def classify_run(entry: dict) -> str:
    """Classify a cron run as WORK, NOOP, or ERROR."""
    status = entry.get("status", "")
    if status == "error":
        return "ERROR"

    summary = entry.get("summary")
    duration_ms = entry.get("durationMs", 0)

    # No summary field — use duration as proxy.
    # Runs >30s almost certainly did real work.
    if summary is None:
        return "WORK" if duration_ms > 30_000 else "NOOP"

    summary = summary.strip()
    summary_lower = summary.lower()

    # NOOP patterns
    if "heartbeat_ok" in summary_lower:
        # Check if it's a genuine no-op vs "HEARTBEAT_OK but I did stuff"
        # Short HEARTBEAT_OK responses are true no-ops
        if len(summary) < 200:
            return "NOOP"
        # Longer ones that mention "no active task" / "no tasks available" are still NOOPs
        if "no active task" in summary_lower or "no tasks available" in summary_lower:
            return "NOOP"

    if summary_lower.startswith("no_reply"):
        return "NOOP"

    # Very short responses with no real content
    if len(summary) < 20 and status == "ok":
        return "NOOP"

    return "WORK"


def load_recent_runs(job_id: str) -> list[dict]:
    """Load the last WINDOW finished runs for a job."""
    jsonl_path = RUNS_DIR / f"{job_id}.jsonl"
    if not jsonl_path.exists():
        return []

    finished = []
    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if entry.get("action") == "finished":
                    finished.append(entry)
            except json.JSONDecodeError:
                continue

    return finished[-WINDOW:]


def compute_tier(runs: list[dict]) -> tuple[str, int]:
    """Compute the scaling tier based on recent runs.

    Returns (tier_name, interval_ms).
    """
    if not runs:
        return ("unknown", TIER_WARM_MS)

    classifications = [classify_run(r) for r in runs]
    work_count = classifications.count("WORK")
    error_count = classifications.count("ERROR")
    noop_count = classifications.count("NOOP")

    # If all errors, don't touch it
    if error_count == len(classifications):
        return ("broken", -1)

    # Count only non-error runs for tier decision
    effective = [c for c in classifications if c != "ERROR"]
    if not effective:
        return ("broken", -1)

    work_ratio = work_count / len(effective) if effective else 0

    if work_ratio >= 0.6:  # 3+ out of 5 non-error runs had work
        return ("hot", TIER_HOT_MS)
    elif work_ratio >= 0.3:  # 2+ out of 5
        return ("warm", TIER_WARM_MS)
    else:
        return ("cold", TIER_COLD_MS)


def should_scale(job: dict) -> bool:
    """Check if a job should be managed by the scaler."""
    name = (job.get("name") or "").lower()
    agent_id = (job.get("agentId") or "").lower()

    # Skip excluded agents
    if agent_id in EXCLUDE_AGENTS:
        return False

    # Skip excluded patterns
    for pattern in EXCLUDE_PATTERNS:
        if pattern in name:
            return False

    # Only scale agentTurn jobs
    payload = job.get("payload", {})
    if payload.get("kind") != "agentTurn":
        return False

    # Only scale "every" schedule jobs (not cron expressions)
    schedule = job.get("schedule", {})
    if schedule.get("kind") != "every":
        return False

    return True


def apply_interval(job_id: str, name: str, interval_ms: int, jobs_data: dict) -> bool:
    """Apply a new interval to a cron job by editing jobs.json directly."""
    minutes = interval_ms // 60000

    if DRY_RUN:
        log(f"  [DRY RUN] Would set {name} to every {minutes}m")
        return True

    for job in jobs_data.get("jobs", []):
        if job["id"] == job_id:
            job["schedule"]["everyMs"] = interval_ms
            log(f"  Set {name} to every {minutes}m")
            return True

    log(f"  ERROR: job {name} not found in jobs.json")
    return False


def load_state() -> dict:
    """Load previous scaler state."""
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception:
            pass
    return {}


def save_state(state: dict) -> None:
    """Save scaler state."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def main() -> None:
    if not JOBS_FILE.exists():
        print("No jobs.json found")
        return

    with open(JOBS_FILE) as f:
        data = json.load(f)

    jobs = data.get("jobs", [])
    previous_state = load_state()
    new_state: dict = {"ts": int(time.time() * 1000), "jobs": {}}
    changes = 0

    # Group jobs by agent
    by_agent: dict[str, list[dict]] = {}
    for job in jobs:
        if not job.get("enabled", True):
            continue
        if not should_scale(job):
            continue
        agent = job.get("agentId", "unknown")
        by_agent.setdefault(agent, []).append(job)

    for agent, agent_jobs in sorted(by_agent.items()):
        log(f"\n--- {agent} ({len(agent_jobs)} jobs) ---")

        for job in agent_jobs:
            job_id = job["id"]
            name = job.get("name", job_id)
            current_ms = job.get("schedule", {}).get("everyMs", 0)

            runs = load_recent_runs(job_id)
            tier, target_ms = compute_tier(runs)

            classifications = [classify_run(r) for r in runs]
            work = classifications.count("WORK")
            noop = classifications.count("NOOP")
            error = classifications.count("ERROR")

            log(f"  {name}: {tier} (W={work} N={noop} E={error}) current={current_ms//60000}m target={target_ms//60000 if target_ms > 0 else '?'}m")

            new_state["jobs"][job_id] = {
                "name": name,
                "agent": agent,
                "tier": tier,
                "work": work,
                "noop": noop,
                "error": error,
                "currentMs": current_ms,
                "targetMs": target_ms,
            }

            if tier == "broken" or target_ms < 0:
                log(f"  Skipping {name} (broken)")
                continue

            # Only change if the tier actually differs
            if current_ms == target_ms:
                continue

            # Avoid flip-flopping: require 2 consecutive same-tier readings
            prev_tier = previous_state.get("jobs", {}).get(job_id, {}).get("tier")
            if prev_tier != tier:
                log(f"  Tier changed {prev_tier} -> {tier}, waiting for confirmation")
                continue

            if apply_interval(job_id, name, target_ms, data):
                changes += 1

    # Write back if we made changes
    if changes > 0 and not DRY_RUN:
        with open(JOBS_FILE, "w") as f:
            json.dump(data, f, indent=2)

    save_state(new_state)

    if VERBOSE or changes > 0:
        print(f"\nElastic scaler: {changes} interval changes applied")


if __name__ == "__main__":
    main()
