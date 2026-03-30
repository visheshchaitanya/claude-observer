# Claude Observer

Real-time tool call observability for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

See every tool call Claude makes — in your terminal and in a live browser dashboard. Debug agent behavior, audit decisions, and understand the full agentic flow.

```
[claude-observer] Session abc-123
  > Bash          ls /foo                    ...
  + Bash          ls /foo               12ms
  > Read          src/index.ts               ...
  + Read          src/index.ts           8ms
  > Agent         coder                      ...
    > Bash        npm test                   ...
    + Bash        npm test             340ms
    > Write       out.ts                     ...
    + Write       out.ts                 5ms
  + Agent         coder               360ms
```

## Quick Start

```bash
npx @visheshchaitanya/claude-observer start
```

That's it. Open Claude Code in another terminal and start working — every tool call appears in real time.

## What It Does

1. **Captures** every tool call Claude Code makes via native `PreToolUse` / `PostToolUse` hooks
2. **Persists** all events to a local SQLite database, grouped by session
3. **Streams** events to a live terminal tree (with color-coded depth for sub-agents)
4. **Serves** a browser dashboard at `http://localhost:4242` with an interactive call graph

## Architecture

```
Claude Code (CLI)
  |
  |  PreToolUse hook  --> POST /event --> Observer Server
  |  PostToolUse hook --> POST /event --> Observer Server
  |
  v
Observer Server (Node.js, ~35MB resident)
  |
  +-- SQLite (persists per session)
  +-- Terminal stream (stderr, live tree)
  +-- WebSocket --> Browser dashboard (real-time call graph)
```

Hooks use `curl` with `--max-time 1` and `|| true` — if the observer is down, Claude Code is completely unaffected.

## Dashboard

The browser dashboard at `http://localhost:4242` shows:

- **Session sidebar** — switch between recorded sessions
- **Live call graph** — tool calls rendered as a tree, with Agent sub-calls nested
- **Event detail panel** — click any node to inspect full input/output JSON
- **Live indicator** — shows when the server is actively receiving events

Tool calls are color-coded by type (Bash, Read, Write, Agent, Grep, etc.) and Agent calls are collapsible sub-trees.

## CLI Commands

```bash
# Start the observer (injects hooks, starts server, opens dashboard)
npx @visheshchaitanya/claude-observer start

# Stop the observer (removes hooks, shuts down server)
npx @visheshchaitanya/claude-observer stop

# List all recorded sessions
npx @visheshchaitanya/claude-observer sessions

# Export a session to JSON
npx @visheshchaitanya/claude-observer export                     # most recent session to stdout
npx @visheshchaitanya/claude-observer export -s <session-id>     # specific session
npx @visheshchaitanya/claude-observer export -o session.json     # write to file
```

## How It Works

### Hook Injection

`claude-observer start` non-destructively merges hook entries into `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": ".*",
      "hooks": [{
        "type": "command",
        "command": "curl -s --max-time 1 -X POST 'http://localhost:4242/event?phase=pre' -H 'Content-Type: application/json' --data-binary @- || true # claude-observer"
      }]
    }],
    "PostToolUse": [{
      "matcher": ".*",
      "hooks": [{
        "type": "command",
        "command": "curl -s --max-time 1 -X POST 'http://localhost:4242/event?phase=post' -H 'Content-Type: application/json' --data-binary @- || true # claude-observer"
      }]
    }]
  }
}
```

Claude Code pipes the hook JSON (containing `session_id`, `tool_name`, `tool_input`/`tool_response`) via stdin to the observer server. `claude-observer stop` removes only the observer entries, leaving your other hooks untouched.

### Data Storage

Events are stored in `~/.claude-observer/sessions.db` (SQLite). Sessions are never auto-deleted.

### Sub-Agent Tracking

When Claude spawns sub-agents via the `Agent` tool, the observer tracks the parent-child relationship using an agent stack. Nested tool calls inside a sub-agent are linked to their parent Agent event, enabling the tree visualization in both the terminal and dashboard.

## Tech Stack

- **Server:** Node.js (`node:http`) + `ws` + `better-sqlite3`
- **Dashboard:** Preact + Vite (pre-built ~10KB gzipped bundle)
- **CLI:** `commander`
- **Storage:** SQLite via `better-sqlite3`

## Requirements

- Node.js >= 18
- Claude Code CLI installed

## Constraints

- Server stays under ~35MB resident memory
- Hook failure never blocks Claude Code
- Fully local — zero cloud dependencies
- Single `npx` command to install and start

## License

MIT
