![alt text](image.png)

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lemonade AI Debugger — Full Architecture</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --color-background-primary: #ffffff;
    --color-background-secondary: #f5f4f0;
    --color-text-primary: #1a1a18;
    --color-text-secondary: #5a5a56;
    --color-text-tertiary: #9a9a94;
    --color-border-tertiary: rgba(0,0,0,0.10);
    --color-border-secondary: rgba(0,0,0,0.18);
    --font-sans: system-ui, -apple-system, sans-serif;
    --border-radius-md: 8px;
    --border-radius-lg: 12px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --color-background-primary: #1c1c1a;
      --color-background-secondary: #242422;
      --color-text-primary: #e8e6de;
      --color-text-secondary: #9a9890;
      --color-text-tertiary: #5a5a56;
      --color-border-tertiary: rgba(255,255,255,0.08);
      --color-border-secondary: rgba(255,255,255,0.14);
    }
  }
  body {
    font-family: var(--font-sans);
    background: var(--color-background-primary);
    color: var(--color-text-primary);
    padding: 32px 24px;
    max-width: 860px;
    margin: 0 auto;
  }
  h1 {
    font-size: 18px;
    font-weight: 500;
    color: var(--color-text-primary);
    margin-bottom: 4px;
  }
  .subtitle {
    font-size: 13px;
    color: var(--color-text-secondary);
    margin-bottom: 24px;
  }
  .wrap { display: flex; flex-direction: column; gap: 20px; }
  .section-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
    margin-bottom: 8px;
  }
  .phase-bar { display: flex; gap: 4px; align-items: stretch; }
  .phase {
    flex: 1;
    border-radius: var(--border-radius-md);
    padding: 10px 12px;
    cursor: pointer;
    border: 1.5px solid transparent;
    transition: border-color .15s, opacity .15s;
  }
  .phase:hover { opacity: .85; }
  .phase.active { border-color: currentColor; }
  .phase-num { font-size: 10px; font-weight: 500; opacity: .6; margin-bottom: 2px; }
  .phase-title { font-size: 12px; font-weight: 500; }
  .ph-dap   { background: #E1F5EE; color: #0F6E56; }
  .ph-tools { background: #E6F1FB; color: #185FA5; }
  .ph-graph { background: #EEEDFE; color: #3C3489; }
  .ph-agents{ background: #FAEEDA; color: #854F0B; }
  .ph-mem   { background: #FBEAF0; color: #72243E; }
  @media (prefers-color-scheme: dark) {
    .ph-dap   { background: #04342C; color: #9FE1CB; }
    .ph-tools { background: #042C53; color: #85B7EB; }
    .ph-graph { background: #26215C; color: #AFA9EC; }
    .ph-agents{ background: #412402; color: #FAC775; }
    .ph-mem   { background: #4B1528; color: #ED93B1; }
  }
  .detail-card {
    border-radius: var(--border-radius-lg);
    border: 1px solid var(--color-border-tertiary);
    background: var(--color-background-secondary);
    padding: 16px;
    display: none;
  }
  .detail-card.show { display: block; }
  .detail-title { font-size: 15px; font-weight: 500; color: var(--color-text-primary); margin-bottom: 4px; }
  .detail-sub { font-size: 12px; color: var(--color-text-secondary); margin-bottom: 14px; line-height: 1.5; }
  .cols  { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .cols3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
  .card {
    border-radius: var(--border-radius-md);
    border: 1px solid var(--color-border-tertiary);
    padding: 10px 12px;
    background: var(--color-background-primary);
  }
  .card-label { font-size: 10px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-tertiary); margin-bottom: 4px; }
  .card-title { font-size: 13px; font-weight: 500; color: var(--color-text-primary); margin-bottom: 3px; }
  .card-body  { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; }
  code { font-family: monospace; font-size: 11px; background: var(--color-border-tertiary); padding: 1px 4px; border-radius: 3px; }
  .tag { display: inline-block; font-size: 10px; font-weight: 500; padding: 2px 6px; border-radius: 4px; margin-top: 6px; }
  .tag-sm  { background: #E1F5EE; color: #0F6E56; }
  .tag-lg  { background: #FAEEDA; color: #854F0B; }
  .tag-det { background: #EEEDFE; color: #3C3489; }
  @media (prefers-color-scheme: dark) {
    .tag-sm  { background: #04342C; color: #9FE1CB; }
    .tag-lg  { background: #412402; color: #FAC775; }
    .tag-det { background: #26215C; color: #AFA9EC; }
  }
  .flow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .fnode {
    font-size: 11px; font-weight: 500; padding: 4px 8px;
    border-radius: 5px; border: 1px solid var(--color-border-tertiary);
    background: var(--color-background-primary); color: var(--color-text-primary);
  }
  .farr { font-size: 11px; color: var(--color-text-tertiary); }
  .fnode.hi   { background: #E1F5EE; color: #0F6E56; border-color: #5DCAA5; }
  .fnode.loop { background: #FAEEDA; color: #854F0B; border-color: #EF9F27; }
  @media (prefers-color-scheme: dark) {
    .fnode.hi   { background: #04342C; color: #9FE1CB; border-color: #1D9E75; }
    .fnode.loop { background: #412402; color: #FAC775; border-color: #BA7517; }
  }
  .risk {
    margin-top: 12px; padding: 10px 12px;
    border-radius: var(--border-radius-md);
    border-left: 3px solid #EF9F27;
    background: var(--color-background-primary);
    font-size: 12px; color: var(--color-text-secondary); line-height: 1.5;
  }
  .risk strong { color: var(--color-text-primary); font-weight: 500; }
</style>
</head>
<body>
<h1>Lemonade AI Debugger — Architecture Plan</h1>
<p class="subtitle">Full system overview across all 5 build phases. Click a phase to explore.</p>

<div class="wrap">
  <div>
    <div class="section-label">Build phases — click to explore</div>
    <div class="phase-bar">
      <div class="phase ph-dap active" onclick="show('dap',this)">
        <div class="phase-num">Phase 1</div>
        <div class="phase-title">DAP Client</div>
      </div>
      <div class="phase ph-tools" onclick="show('tools',this)">
        <div class="phase-num">Phase 2</div>
        <div class="phase-title">Tool layer</div>
      </div>
      <div class="phase ph-graph" onclick="show('graph',this)">
        <div class="phase-num">Phase 3</div>
        <div class="phase-title">LangGraph + state</div>
      </div>
      <div class="phase ph-agents" onclick="show('agents',this)">
        <div class="phase-num">Phase 4</div>
        <div class="phase-title">Agents</div>
      </div>
      <div class="phase ph-mem" onclick="show('mem',this)">
        <div class="phase-num">Phase 5</div>
        <div class="phase-title">Memory + CLI</div>
      </div>
    </div>
  </div>

  <!-- Phase 1: DAP -->
  <div id="dap" class="detail-card show">
    <div class="detail-title">DAP Client — the technical foundation</div>
    <div class="detail-sub">Built and validated in isolation before touching LangGraph. This is the highest-risk piece — get it working standalone first.</div>
    <div class="cols">
      <div class="card">
        <div class="card-label">Core</div>
        <div class="card-title">DAPClient.js</div>
        <div class="card-body">Content-Length message framing. Seq-number request/response matching. Async event emitter for stopped, terminated, output events. TCP + stdio transports.</div>
      </div>
      <div class="card">
        <div class="card-label">Adapters</div>
        <div class="card-title">Node.js + Python</div>
        <div class="card-body">Node: spawns <code>@vscode/debugadapter</code> over stdio. Python: connects to <code>debugpy</code> over TCP (debugpy opens its own socket). Each adapter handles launch config.</div>
      </div>
      <div class="card">
        <div class="card-label">Session API</div>
        <div class="card-title">DAPSession.js</div>
        <div class="card-body">Thin wrapper over DAPClient. Exposes initialize → launch → configurationDone lifecycle. Emits clean <code>stopped</code> event with frame + variables already resolved.</div>
      </div>
      <div class="card">
        <div class="card-label">Agent tools</div>
        <div class="card-title">5 tool functions</div>
        <div class="card-body"><code>start_debugger</code>, <code>set_breakpoint</code>, <code>get_stack_trace</code>, <code>inspect_variables</code>, <code>continue_execution</code> — all Zod-validated in/out.</div>
      </div>
    </div>
    <div class="risk"><strong>Protocol flow:</strong> connect → initialize → launch → setBreakpoints → configurationDone → [wait for stopped event] → stackTrace → variables → continue</div>
    <div class="flow">
      <span class="fnode hi">connect()</span><span class="farr">→</span>
      <span class="fnode">initialize</span><span class="farr">→</span>
      <span class="fnode">launch / attach</span><span class="farr">→</span>
      <span class="fnode">setBreakpoints</span><span class="farr">→</span>
      <span class="fnode">configDone</span><span class="farr">→</span>
      <span class="fnode hi">stopped event</span><span class="farr">→</span>
      <span class="fnode">stackTrace</span><span class="farr">→</span>
      <span class="fnode">variables</span><span class="farr">→</span>
      <span class="fnode">continue</span>
    </div>
  </div>

  <!-- Phase 2: Tools -->
  <div id="tools" class="detail-card">
    <div class="detail-title">Tool layer — all deterministic, no LLM inside</div>
    <div class="detail-sub">Every tool is a pure function: validated input in, structured result out. Agents call these — they never talk to the filesystem or runtime directly.</div>
    <div class="cols3">
      <div class="card"><div class="card-label">Filesystem</div><div class="card-title">read / write / list</div><div class="card-body">read_file, write_file (approval-gated), list_files</div></div>
      <div class="card"><div class="card-label">Discovery</div><div class="card-title">search_code</div><div class="card-body">ripgrep-based. Regex or text across the entire project. Fast enough to use on every query.</div></div>
      <div class="card"><div class="card-label">AST</div><div class="card-title">parse_ast</div><div class="card-body">tree-sitter. Extracts function sigs, imports, call graphs without loading full files.</div></div>
      <div class="card"><div class="card-label">Static analysis</div><div class="card-title">run_linter / run_compiler</div><div class="card-body">ESLint / Pylint, TSC / mypy. Results cached within session.</div></div>
      <div class="card"><div class="card-label">Patch</div><div class="card-title">generate / preview / apply</div><div class="card-body">Diff-style patches only. apply_patch is the only disk-write, gated behind user approval.</div></div>
      <div class="card"><div class="card-label">Web</div><div class="card-title">web_search / search_docs</div><div class="card-body">External lookups. Framework docs targeted directly. Optional — only Web Agent uses these.</div></div>
    </div>
    <div class="risk"><strong>Schema approach:</strong> all tools share a Zod schema file. Input schema validates before the function runs. Output schema validates before returning to the agent. Mismatches surface as tool errors, not silent bad data.</div>
  </div>

  <!-- Phase 3: LangGraph -->
  <div id="graph" class="detail-card">
    <div class="detail-title">LangGraph — state machine + checkpointer</div>
    <div class="detail-sub">The graph is the orchestrator. Agents are nodes. Tool outputs write to shared state. The Reflect → Fix loop is the key non-linear path.</div>
    <div class="cols">
      <div class="card"><div class="card-label">Shared state fields</div><div class="card-title">Single source of truth</div><div class="card-body">userQuery, loadedFiles, analysisResults, debugSession, proposedPatch, pendingPermission, reflectionScore, nextAgent. All Zod-typed.</div></div>
      <div class="card"><div class="card-label">Checkpointer</div><div class="card-title">MemorySaver → SQLite</div><div class="card-body">Dev: MemorySaver (in-memory). Prod: SQLite/Postgres. Enables <code>lemonade resume</code> after a terminal restart.</div></div>
    </div>
    <div class="risk"><strong>Conditional edges:</strong> Static Analysis → Fix (if lint/compile error is self-explanatory) or → Debug Agent (if runtime issue). Reflect → Fix (score &lt; 0.7) or → interrupt (score ≥ 0.7).</div>
    <div class="flow">
      <span class="fnode">Planner</span><span class="farr">→</span>
      <span class="fnode">Context</span><span class="farr">→</span>
      <span class="fnode">Static analysis</span><span class="farr">→</span>
      <span class="fnode">Debug Agent</span><span class="farr">→</span>
      <span class="fnode">Fix Agent</span><span class="farr">→</span>
      <span class="fnode loop">Reflect ↺</span><span class="farr">→</span>
      <span class="fnode hi">interrupt()</span><span class="farr">→</span>
      <span class="fnode">Apply patch</span>
    </div>
  </div>

  <!-- Phase 4: Agents -->
  <div id="agents" class="detail-card">
    <div class="detail-title">Agent roster — model routing per task</div>
    <div class="detail-sub">Small models handle classification and retrieval. Large models handle reasoning. Never overspend on a simple task.</div>
    <div class="cols3">
      <div class="card"><div class="card-label">Entry point</div><div class="card-title">Planner</div><div class="card-body">Interprets query, picks strategy (static-first vs runtime-first), routes to next agent.</div><span class="tag tag-sm">small model</span></div>
      <div class="card"><div class="card-label">Context loading</div><div class="card-title">Context Agent</div><div class="card-body">Loads minimum viable context. Target file + imports + involved functions. Keeps tokens low.</div><span class="tag tag-sm">small model</span></div>
      <div class="card"><div class="card-label">Deterministic node</div><div class="card-title">Static Analysis</div><div class="card-body">No LLM. Runs linter + compiler, writes results to state. Routes to Fix or Debug based on output.</div><span class="tag tag-det">no model</span></div>
      <div class="card"><div class="card-label">Runtime</div><div class="card-title">Debug Agent</div><div class="card-body">Attaches via DAP. Sets breakpoints, collects stack trace + live variables, reasons about runtime state.</div><span class="tag tag-lg">large model</span></div>
      <div class="card"><div class="card-label">Patch generation</div><div class="card-title">Fix Agent</div><div class="card-body">Generates diff-style patch + explanation. Never writes to disk — proposes only.</div><span class="tag tag-lg">large model</span></div>
      <div class="card"><div class="card-label">Self-critique</div><div class="card-title">Reflect</div><div class="card-body">Scores patch 0–1. Does it address root cause? Regressions? Score &lt; 0.7 → back to Fix with critique.</div><span class="tag tag-lg">large model</span></div>
    </div>
  </div>

  <!-- Phase 5: Memory + CLI -->
  <div id="mem" class="detail-card">
    <div class="detail-title">Memory layers + CLI wiring</div>
    <div class="detail-sub">Five distinct memory stores, each solving a different scope problem. CLI connects via streaming.</div>
    <div class="cols">
      <div class="card"><div class="card-label">Short-term</div><div class="card-title">Session state</div><div class="card-body">Active conversation compressed into structured snapshot when too large. Keeps token usage bounded across long sessions.</div></div>
      <div class="card"><div class="card-label">Long-term</div><div class="card-title">LEMONADE.md</div><div class="card-body"><code>~/.lemonade/</code> for global prefs. <code>project_root/</code> for project rules. Read at session start, writable mid-session via save_memory tool.</div></div>
      <div class="card"><div class="card-label">Runtime</div><div class="card-title">Debug session memory</div><div class="card-body">Breakpoints, stack traces, variable values at each frame. Passed directly into Debug Agent context.</div></div>
      <div class="card"><div class="card-label">CLI integration</div><div class="card-title">Ink → graph via streaming</div><div class="card-body">LangGraph streams agent steps. Ink renders each step as it arrives. Permission interrupts pause the stream for user input.</div></div>
    </div>
    <div class="risk"><strong>Permission system:</strong> LangGraph interrupt() pauses mid-graph. Ink renders approval dialog. User response resumes or terminates the edge. Denied actions write to state so Planner can re-route.</div>
  </div>
</div>

<script>
function show(id, el) {
  document.querySelectorAll('.detail-card').forEach(c => c.classList.remove('show'));
  document.querySelectorAll('.phase').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('show');
  el.classList.add('active');
}
</script>
</body>
</html>
