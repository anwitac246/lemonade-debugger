# Lemonade AI Debugger – Agentic Architecture Plan

## Goal

Build a **terminal‑native AI debugger** that works alongside a normal shell. The CLI will be built with **Ink + React** and will allow users to run regular shell commands while invoking AI debugging through commands like:

```
lemonade debug <query>
```

The system will combine **tool‑based agents, Debug Adapter Protocol (DAP), model routing, and safe user permissions** to analyze and fix code issues.

---

# High Level Architecture

```
User Terminal
      │
      ▼
Ink + React CLI
      │
      ▼
Command Router
      │
 ├─ Normal command → NodePTY shell
 └─ "lemonade" command → Agentic System

Agentic System
      │
      ▼
LangGraph Orchestrator
      │
      ▼
Agents + Tool Layer
      │
      ▼
Filesystem / Runtime / Debugger / Web
```

---

# CLI Integration

### Ink + React

Handles:

* terminal UI
* streaming responses
* interactive prompts
* permission approvals

### NodePTY

Runs the real shell.

Flow:

```
if command starts with "lemonade"
    route to agent system
else
    forward to shell
```

---

# Agentic Layer

The agent layer will be orchestrated using **LangGraph**.

Agents communicate through **tools** and share session state.

## Planned Agents

### 1. Planner Agent

Responsible for deciding next steps.

Responsibilities:

* interpret user request
* decide which tools/agents to invoke
* manage workflow

---

### 2. Context Agent

Collects relevant project information.

Tools used:

* read_file
* list_files
* search_code
* parse_ast

Goal:

* minimize LLM context
* retrieve only relevant files/functions

---

### 3. Debug Agent

Handles runtime debugging.

Tools used:

* start_debugger
* set_breakpoint
* get_stack_trace
* inspect_variables

Uses **Debug Adapter Protocol (DAP)**.

---

### 4. Fix Agent

Generates code fixes.

Responsibilities:

* generate patches
* validate patches
* propose fixes

Uses patch-based edits instead of rewriting files.

---

### 5. Web Agent

Handles external documentation lookup.

Tools used:

* web_search
* search_docs

Used when:

* version mismatches
* framework errors
* missing documentation

---

# Tool Layer

Tools are deterministic functions used by agents.

## Filesystem Tools

* read_file
* write_file
* list_files

## Code Discovery

* search_code (ripgrep based)

## Static Analysis

* run_linter
* run_compiler
* parse_ast

## Debugging (DAP)

* start_debugger
* set_breakpoint
* get_stack_trace
* inspect_variables

## Web / Documentation

* web_search
* search_docs

## Patch System

* generate_patch
* preview_patch
* apply_patch

---

# Permission System

Certain actions require user approval.

| Action         | Permission |
| -------------- | ---------- |
| read files     | allowed    |
| search code    | allowed    |
| run commands   | ask        |
| start debugger | ask        |
| write files    | ask        |
| web access     | ask        |

Example CLI prompt:

```
Lemonade wants to run:
npm test
Allow? (y/n)
```

---

# Model Routing

A routing layer selects which model to use for each task.

Example:

| Task             | Model       |
| ---------------- | ----------- |
| classification   | small model |
| planning         | small model |
| debug reasoning  | large model |
| patch generation | large model |

Benefits:

* lower cost
* faster responses

---

# Auto‑Fix Workflow

Fixing code uses a patch pipeline:

```
analyze bug
↓
generate patch
↓
validate patch
↓
preview patch
↓
apply patch
```

Patch example:

```
- login()
+ login(user)
```

---

# Debugging Workflow

Example session:

```
lemonade debug appointmentService.ts
```

Flow:

1. Planner agent interprets request
2. Context agent loads relevant files
3. Static analysis runs (lint/compile)
4. Debug agent attaches debugger
5. Stack + variables analyzed
6. Web agent retrieves documentation if needed
7. Fix agent proposes patch
8. User approves patch

---

# Performance Strategy (Lightweight CLI)

To keep Lemonade fast:

* lazy file loading
* ripgrep search
* small context windows
* caching tool outputs
* streaming LLM responses
* limit agent steps

---

# Initial MVP Scope

Agents:

* Planner
* Context
* Debug
* Fix

Tools:

* read_file
* list_files
* search_code
* run_linter
* run_compiler
* start_debugger
* get_stack_trace
* inspect_variables

Supported runtimes:

* Node / TypeScript
* Python

---

# Long Term Vision

Future features:

* multi-language debugging
* automatic bug reproduction
* git-aware debugging
* project knowledge memory
* plugin ecosystem

Lemonade aims to become a **terminal‑first AI debugging assistant with deep runtime awareness.**
