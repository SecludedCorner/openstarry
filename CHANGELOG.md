# CHANGELOG

## [v0.59.9-alpha] — 2026-06-29 — Sandbox / Security hardening: live worker isolation + PathGuard on the live path + command-execution guard

Three Master-ratified security increments. Motivation: an adversarial study found the
project's flagship worker-thread plugin sandbox was **dormant and mis-marked** — wired into
every AgentCore but enabled by no shipped plugin, exercised by no real-worker test (every
sandbox test mocked `node:worker_threads`), and its SDK JSDoc falsely claimed `default: true`.
That violates the project's own "live-or-honestly-marked" criterion. These three changes
close the gap honestly, all microkernel-pure, each with a REAL (non-mock) e2e.

**① Worker sandbox made genuinely LIVE + mis-marking corrected.** New real-worker e2e
(`packages/core/__tests__/e2e/sandbox-live.e2e.test.ts`) spawns an ACTUAL
`node:worker_threads` Worker on the compiled `plugin-worker-runner` (no `vi.mock`) and proves
four behaviors end-to-end: tool RPC round-trip; a forbidden `require('fs')` blocked at runtime
by the CommonJS `Module._load` patch; an ESM static import of a forbidden builtin rejected
pre-spawn by the static import-analyzer; and a real V8 OOM tripping the dedicated worker's
`resourceLimits` memory cap. Committed dependency-free `.mjs` fixtures under
`__tests__/fixtures/sandbox-plugins/`. **Honesty fixes:** corrected the SDK `SandboxConfig`
JSDoc (sandbox is opt-in / off-by-default, NOT `default: true`), and documented in
`plugin-worker-runner.ts` that `Module._load` is **CommonJS-only** — ESM `import` enforcement
relies on the pre-spawn static analyzer, not a runtime hook (a real, now-documented boundary).
Honest scope: the heartbeat stall-kill is not asserted in the e2e (its monitor fires on a
fixed 45s cadence — impractical for CI; stays covered by the mocked `sandbox-heartbeat.test.ts`).

**② Symlink-aware PathGuard moved onto the LIVE filesystem tool path.** The live `fs` tool
validated paths lexically (resolve+normalize, no `realpath`), so a symlink placed inside an
allowed directory that pointed outside it escaped the jail. Extracted the symlink-aware
realpath jail into `@openstarry/shared` (`security/realpath-jail.ts` — single source of truth);
core's `SecurityLayer` now delegates to it (behavior byte-identical, regression tests
unchanged) and `standard-function-fs` uses it instead of its own lexical check. Real e2e
creates an in-jail symlink (junction) targeting outside and asserts read/write rejection, with
a control proving new-file writes still work. Microkernel purity preserved (shared is already a
permitted core/plugin dependency; the execution loop is untouched).

**③ Command-execution guard plugin (`@openstarry-plugin/standard-function-exec`).** Realizes
the (quarantined) Tech Spec 05 command-whitelist intent as a purity-clean ITool. `exec.run`
runs a single command via `child_process.execFile` with `shell:false` — argv never reaches a
shell (the real boundary) — gated by a default-OFF `allowShell` master switch, an exact-match
executable allowlist (fail-closed), shell-metacharacter rejection, and a defense-in-depth
denylist. On block it throws `SecurityError` and emits the EXISTING `AgentEventType.TOOL_BLOCKED`
event (zero new SDK surface — `audit:capability_denied` is not an SDK event). Policy is
plugin-local (`src/policy.ts`), merged under agent.json config. Unit tests + a real-process e2e
(`node -e` runs for real; a compound `cat … && rm x` is blocked pre-spawn and audited). Honest
scope: this is a guard, **not a sandbox** — a permitted command still runs with the agent's OS
privileges; denylists are defense-in-depth, not a containment guarantee. Plugins 48→49 loadable
(catalog 40→41 entries).

- Baseline: **328 files / 3422 passed / 0 failed / 4 skipped**; build / purity / verify-plugin-deps (50) green.
- Microkernel (`packages/core`) purity preserved: increment ② adds only a `@openstarry/shared`
  import (already permitted) and the loop is unchanged; increment ③ touches zero core; increment
  ① is test-only fixtures/e2e plus comment-only SDK/worker-runner honesty fixes.

## [v0.59.8-alpha] — 2026-06-27 — Fractal Society: naming (A) + comm transport (C/T1–T4 + pipeline) + supervisor + fork/branch (B)

Tenet #10 "好好實現". Two Master-ratified Spec Addenda land together (附錄紀律＝最嚴：
interface + impl + tests in one delivery):

**Addendum A — agent identity & naming** (was committed locally, shipped here):
per-parent generation counter (restart-persistent), optional human `name`,
auto-generated unique `<parent>-<gen>` ids, and a **fix for a real bug** —
`agentRegistry.set` silently overwrote a same-named child; collisions now
fail-closed. `ps --tree` shows `name [id] gen=N`. Real-daemon e2e.

**Addendum C — cross-daemon comm transport.** This is the step that turns the
daemon comm cluster (MessageRouter / EventBridge / GlobalServiceRegistry) from a
validated-but-dead set of primitives into a **live transport**. Every cross-daemon
message/event/registry call is HMAC-signed with the cluster key (C-2) and
fail-closed validated; every rejection is journaled as a new `comm_denied` audit
event. Honest scope: same-host, same-state-dir cluster (1 daemon = 1 agent →
agent↔agent is always cross-process). Cross-host / N>2 gossip remain future.

- **C/T1 — point-to-point messaging.** `MessageRouter` is promoted from a
  validation layer to a real transport: `validateOutbound` (sender canSendTo) +
  `validateInbound` (receiver canReceiveFrom + replay + freshness + envelope),
  split because in 1-daemon-1-agent the two daemons each only know their own
  agent's caps; the remote sender is authenticated by HMAC. New `CommTransport`
  (generalizes the proven alaya `IpcRemotePeer`), `comm.deliver` / `comm.send` /
  `comm.inbox` RPCs, bounded inbox + pushInput into the local loop. Two-process
  e2e: A→B delivered; forged-sig / wrong-sender / replay all rejected & journaled.
- **C/T2 — cluster pub/sub.** `EventBridge` gains its missing delivery layer
  (`setDeliveryFn` was never called → events were computed then dropped).
  Subscriber-initiated: `comm.subscribe` / `comm.event` (signed), `comm.subscribeTo`
  / `eventbridge.publish` / `comm.events` control plane. Two-process e2e: A
  subscribes to B; B's published events reach A; unsubscribed types + forged
  events/subscriptions rejected.
- **C/T3 — service discovery closure.** `GlobalServiceRegistry` had
  register/lookup but nothing used a lookup result to talk to the discovered
  peer. New signed `comm.register` / `comm.lookup` against a registry hub +
  `comm.registerOn` / `comm.findPeer`. Three-daemon e2e: a provider registers a
  service on a hub; a consumer discovers it by name and messages the discovered
  peer — no static peer config.
- **New plugin `@openstarry-plugin/agent-comm`** (6 tools): `agent.send` /
  `agent.inbox` (T1), `agent.subscribe` / `agent.events` (T2), `agent.register` /
  `agent.findPeer` (T3). Daemon-only; clear message when the service is absent.
- **`comm_denied` audit reason** added to the daemon denial-audit pipeline.
- **`--state-path` forwarded to spawned daemons** so a peer agentId resolves to
  its daemon socket in the same-home fractal society.

**Addendum C/T4 + topologies + supervisor (no new ratification — implements the
frozen CommPerformative/CommTopology + SupervisorStrategy over the real transport):**
- **C/T4 — performative/topology.** request-response (`comm.request` awaits a
  correlated reply via `correlationId`, with timeout; `comm.reply`) + broadcast
  (`comm.broadcast` fan-out, per-target result). agent-comm now 10 tools. e2e:
  cross-process request→reply, timeout, broadcast.
- **pipeline topology (A→B→C).** Source-routed relay over the transport: each
  daemon relays a pipeline message to the next hop (capability-checked + signed per
  hop; traceDepth-bounded; route/trail in metadata). 3-daemon e2e incl. a
  mid-chain fail-closed break.
- **supervisor restart strategy.** `SupervisorStrategy` was type-only; now the
  daemon supervises children it spawned — a crashed child (pid dead while status
  'running') is respawned per one-for-one / one-for-all / rest-for-one, bounded by
  maxRestarts. `agent.supervise` tool. Pure selection unit-tested; e2e: crash →
  auto-respawn, healthy child not spuriously restarted.

**Addendum B — fork / branch (Master-ratified 2026-06-27):** fork = spawn + inject
the parent's session snapshot as the child's initial session (D4-a); capabilities
stay child ⊆ parent (D4-b, lattice NOT bypassed); memory/alaya NOT inherited
(D4-c). branch = N forks off one snapshot (shared `forkOrigin`). merge/select =
honest future. `agent.fork` / `agent.branch` tools (agent-spawn now 4 tools). e2e:
child inherits the parent session; out-of-scope fork denied; branch group shares
forkOrigin.

**Doc 53 ICommChannel alignment — the abstraction is finally LIVE:** an audit found
`ICommChannel` was a frozen contract whose `commChannelRegistry` was populated by the
plugin loader but **never consumed** — `send()`/`onMessage()` did real work nowhere
(`comm-pipeline`'s channel was an EventBus stub). New plugin
**`@openstarry-plugin/comm-channel-p2p`** (skandha 色蘊/rupa) provides a real
point-to-point `ICommChannel` ('messaging') whose `send()` delivers cross-daemon via
the real DAEMON_COMM transport and whose `onMessage()` fires on real inbound. The
daemon now **consumes the registry**: it `connect()`s registered channels at startup
and dispatches every inbound CommMessage to them (`commChannelRegistry.list()` →
`channel.deliverInbound`). `comm.channelList` / `comm.channelSend` / `comm.channelReceived`
RPCs. Two-process e2e: A's `channel.send` reaches B's `channel.onMessage`; capability
lattice still bites. (comm-pipeline / comm-proxy / CompositeChannel remain in-process
composition reference impls — honestly marked.)

**Build-integrity fix (latent, pre-existing):** `apps/runner/scripts/verify-plugin-deps.mjs`
(the pre-publish guard requiring every workspace plugin in the runner's deps) was RED —
11 plugins missing (9 predate this batch: agent-ask/introspect/spawn, api-runtime, mesh,
provider-claude-cli, transport-local-cli, vasana-engine, context-keyword-retrieval; +
agent-comm; + comm-channel-p2p). All 11 added; guard now green (**49 plugins verified**).

**Pre-push adversarial audit hardening (4-lens skeptic pass over the later features):**
the audit cleared purity / honesty / regression, and surfaced two fixes:
- **(sec) request-response correlation binding** — `commDeliver` resolved a pending
  request on a `correlationId` match WITHOUT checking the reply came from the agent the
  request was sent to; a mis-sourced (even capability-allowed) reply could hijack it.
  Now the pending entry stores its `target` and only a reply whose `source` == that
  target resolves it; a mismatch is journaled (`comm_denied: CORRELATION_SOURCE`) and
  falls through to normal delivery. New 3-daemon e2e: a wrong-peer reply cannot hijack.
- **(correctness) supervisor restart budget** — `restartCount` only advanced on spawn
  SUCCESS, so a child whose spawn PERSISTENTLY failed retried every tick forever. Now
  the attempt is counted before spawning, so `maxRestarts` bounds total attempts.

Verified: **323 test files / 3393 passed / 0 failed / 4 skipped**; build clean;
purity PASS; verify-plugin-deps PASS (49); cold smoke boots healthy (only env
claude-cli 401). New plugins `agent-comm` + `comm-channel-p2p` ⇒ **48 loadable /
49 packages**. Honest future (not built): cross-host
transport, N>2 gossip, depth>3, fork merge/select, performative semantics beyond
request/inform.

## [v0.59.7-alpha] — 2026-06-16 — buildable_now batch: build the genuinely-buildable doc gaps

A doc-vs-code buildable-gap study (8 dimensions, 39 findings, strict
no-dead-code/no-inflation triage) classified the unbuilt-but-documented surface
into buildable_now / needs_architecture / bounded_by_design / should_stay_fiction.
This release lands the **7 buildable_now** items — each with a real producer +
consumer touchpoint, a passing test, and the corresponding doc flipped to LANDED.
Items lacking architectural prerequisites stay honestly stubbed (NOT built).
A subsequent pre-push doc-vs-code honesty audit (below) closed 5 silent-fiction
gaps, fixed a latent bug in the default context manager, and added tests to the
6 previously-untested plugins. Verified: **314 test files / 3290 passed / 0
failed / 4 skipped**; build clean; purity PASS; cold smoke PASS. Plugin counts
unchanged at 46 loadable / 47 packages.

### New features (doc gap → landed by building)
- **`workflow:status` ITool** (Doc 12): workflow-engine exposes persisted
  execution status as a queryable tool (disk-backed getStatus). +4 tests.
- **`@openstarry-plugin/context-keyword-retrieval`** (new plugin): IContextManager
  with keyword + recency retrieval. +7 tests.
- **`@openstarry-plugin/agent-introspect`** (new plugin): `agent.listChildren` /
  `agent.processTree` tools via the new `SERVICE_KEYS.DAEMON_INTROSPECT` daemon
  service (read-only). +4 tests.
- **Per-agent `VedanaClassificationConfig` wiring** (Doc 36 §13): per-agent
  classification config + a calibration-independent hard safety bound. +4 tests.
- **`ps --tree`** (Doc 13): CLI renders the cross-daemon agent process hierarchy
  via the existing `agent.processTree` RPC, indented by depth; child daemons
  folded under their parent. Read-only. +7 tests.
- **`/session list` + `agent.list-sessions` RPC** (Doc 26): attach REPL's
  `/session list` was a stub — now wired to a read-only RPC backed by
  `FileSessionPersistence.listSessions`; `IDaemonControlPlane.listSessions`
  completeness is compile-enforced. +5 tests.
- **Daemon denial-audit + lifecycle structured-log** (Tech Spec 18 / Doc 54):
  the background daemon had no observability — fail-closed rate-limit and
  spawn-constraint denials left no audit trail, lifecycle was console-only.
  New `agent_request_denied` audit event (rate_limited / spawn_constraint) +
  daemon:started / agent:registered / agent:deregistered / daemon:shutdown
  structured-log records, flushed at shutdown. Opt-in (env), no-op by default.
  +4 unit tests + 1 real-daemon e2e.

### Honest scope (NOT built — would have been dead code)
- DeepDive 07 DLQ/restart/hydration (no production message buffer / child-process
  supervision), §10 transport dual-registration (write-only registry), AT-1c/5b/4a
  (no cross-process message transport), RAG engine / workflow node executors /
  daemon supervisor / hot-reload (fiction), two-tier klesha / logprobToVedana
  (bounded by design) — all remain honestly marked, not stubbed-in. AT-4c
  (audit-log access) stays PARTIAL (file-permission only).

### Pre-push doc-vs-code honesty audit + hardening (2026-06-17)
A full-corpus audit (overclaim + silent-fiction hunt across 198 active docs)
confirmed the TENETS ledger and crown-jewel docs are honest (0 overclaim), and
closed the real gaps it found:
- **Bugfix — default context manager** (`context-sliding-window`): the sliding
  window kept an orphaned assistant/tool message from the oldest *dropped* turn
  (`cutIndex = i + 1` overwrote the already-correct cut), violating the documented
  "turn pair" contract. Surfaced by the first-ever test for this default component.
- **Test coverage**: added genuine tests to the 6 previously-untested plugins —
  `context-sliding-window`, `auditor-passthrough`, `standard-function-fs` (incl.
  path-traversal SECURITY assertions), `standard-core-commands`, `monitor-loop-quality`,
  `provider-gemini-oauth` (pure helpers via a test seam: message conversion, PKCE,
  metadata, catalog). +43 tests.
- **Doc honesty** (openstarry_doc): isolation banners added to 5 un-banner'd
  silent-fiction docs (Arch 04 plugin-registry, Arch 07 supporting-engines,
  openclaw UI adapters, DeepDive 09 observability stack, ProjectStructure 09 CLI);
  Plan60 binding stamped SHIPPED; plugins.md discloses 3 no-op library-wrapper
  plugins (api-runtime/mesh/vasana-engine); count/cross-ref fixes.

## [v0.59.6-alpha] — 2026-06-16 — partial→landed: build the buildable, honest-mark the rest

A corpus-wide doc-vs-code classification (198 active docs: 64 landed / 27 partial /
33 quarantined / 9 future-marked / 53 process-meta / 12 flagged drift, 11 confirmed)
drove a build pass on the genuinely-buildable partials and an honesty pass on the rest.
Verified: **302 test files / 3211 passed / 0 failed / 4 skipped**; build clean;
purity PASS; cold smoke PASS.

### New features (partial → landed by building)
- **MessageRouter replay defense** (Doc 54, AT-1b/AT-5a): CommMessage id-dedup +
  timestamp freshness window (`MAX_MESSAGE_AGE_MS` / `MAX_CLOCK_SKEW_MS`); fail-closed
  reject of stale / future-dated / replayed messages (broadcasts too). +8 tests.
- **Loop integrity self-check** (Doc 20 §4): `checkLoopIntegrity` wired non-fatally into
  `agent-core.start()` — warns on vegetable (input, no cognition) / brain-in-vat
  (cognition, no input). Paralysis case honestly deferred (no manifest requiredConfig).
  +8 tests.
- **CompositeChannel** (Doc 53 §11): `ICommChannel` reference impl composing children
  under fallback / broadcast / pipeline; capability intersection, max depth 3. +16 tests.

### Honest-marked (NOT built — would have been dead code)
- **7-step crash recovery** (Deep Dive 07): detection + isolation are real; DLQ + restart/
  hydration need architectural prerequisites (no production message buffer; PipelineChannel
  not prod-instantiated; real child-process supervision) — marked, not stubbed-in.

### Docs (openstarry_doc) — 11 confirmed drifts + 14 doc-stale reconciled
- Stale/fictional API docs (18, Deep Dive 16, examples, etc.) → honest-correction banners
  citing the real factory→PluginHooks + IProvider.chat + Zod ITool contract.
- Plan57/58/59 bindings flipped "pending Ratification" → BINDING + SHIPPED (plugins exist,
  20/23/42 tests); plugin counts, runner-deps claims, wiener-module amputation corrected.

## [v0.59.5-alpha] — 2026-06-16 — post-release drift-audit consistency patch

Follows the v0.59.4 doc-vs-code gap closure with a post-release drift audit
(8 dimensions, 18 confirmed doc-vs-code drifts adversarially verified against
code; 1 false-positive rejected). Mostly documentation honesty fixes; one
trivial code change. Verified: **300 test files / 3179 passed / 0 failed /
4 skipped**; build clean; purity PASS; cold smoke PASS.

### Code
- **`start --resume` now listed in `--help`** (apps/runner/bin.ts): the flag shipped
  in v0.59.4 but the runner's help text omitted it. One-line fix; no behavior change.

### Docs (openstarry_doc) — honest-marking, no capability claims added
- **doc 56 (B-Modified Delta)**: QUARANTINE banner — the entire spec describes code
  that was never built (no `packages/core/src/confidence/`, 0 symbol hits); status
  PASS → NOT IMPLEMENTED. (Missed by the earlier Tech-Specs-only quarantine sweep.)
- **doc 57 (Registry Bridge)**: correction banner — the bridge IS real, but §4/§7
  describe a fictional fork()/PID model; the shipped model is daemon-attested-event
  (AT-7a Ghost / AT-7b Shadow / AT-7c Identity-Split), 22 tests in registry-bridge.test.ts.
- **doc 55 (Distributed Alaya)**: fixed 3 line citations that pointed past EOF;
  honest-scope marker on §5/§7.1 (same-host IPC, N=2 bounded, NOT self-activating).
- **doc 45 §3.5 / doc 37 §4**: klesha wiring went live at v0.58 (zeros are now only a
  cold-start fallback); `getConfidenceThreshold` → `computeThreshold` (real name);
  design-only banner on the Beta/correlation-matrix bundle (runtime bundle is flat).
- **Ledger / README / GETTING_STARTED**: plugin count 43→44 loadable; CLI persistence
  marked shipped; Implementation Reference 12+12 → honest 11+12; GETTING_STARTED
  stamped v0.59.5, documents `--resume`, adds agent-spawn, corrects the init file list.

## [v0.59.4-alpha] — 2026-06-16 — doc-vs-code gap closure: wire dead code + close ledger boundaries

A 49-item doc-vs-code gap audit (9 implement / 14 drift / 18 keep-quarantined / 8 future)
turned into 9 shipped closures. Verified: **300 test files / 3179 passed / 0 failed / 4 skipped**;
build clean; cold smoke PASS.

### Wired previously-dead code (had tests, zero production callers)
- **Spawn permission lattice + cascadeTermination** (daemon-entry): `validateSpawnConstraints`
  now enforces process-tree depth on spawn (was never called despite the "non-bypassable"
  claim); shutdown reaping runs through the recursive `PermissionLattice.cascadeTermination`.
- **schema-drift audited-mode sink** (observability): `setSchemaDriftAuditSink` wired to the
  structured-log writer — `SCHEMA_DRIFT_MODE=audited` previously dropped events into a no-op.
- **DualRateLimiter** (daemon `agent.input`): per-agent + per-session throttle, fail-closed
  (RATE_LIMITED -32005) — the daemon previously throttled nothing.
- **hmac-cleanup capture-and-zero** (checkpoint signing): full redesign — snapshot-hmac gains a
  byte-identical `SnapshotHmacSigner` abstraction; start.ts captures + zeroes the checkpoint
  HMAC key env and signs via the binding, wiped at shutdown (OWASP ASVS V2.10.1).

### Closed ledger boundaries (new features)
- **CLI conversation persistence + `--resume`** (#9): foreground history was memory-only;
  now saved at shutdown and restorable, via the daemon's session store.
- **`agent.spawnChild` ITool + daemon DAEMON_SPAWN service** (#10): the running agent's loop can
  now spawn child processes (subject to the F-5 lattice + SEC-003); NEW `@openstarry-plugin/agent-spawn`.

### Tests + robustness
- New tests: context-manager-required, schema-drift-audit-wiring, replay-nonce,
  hmac-cleanup-snapshot-wiring, cli-session-persistence, agent-spawn (and SDK SERVICE_KEYS.DAEMON_SPAWN).
- Flake fixes: `plugin install --all` timeout 60→180s; guide-persistent atomic-rename retry on
  transient Windows EPERM/EACCES/EBUSY.

### Docs (openstarry_doc)
- Plugin README ecosystem-size drift (15→45 packages / 1→8 providers / IListener 受→色);
  doc 55/57/58 path drift; ledger #2/#3/#6/#9/#10 boundaries updated to match the wired code.

## [v0.59.3-alpha] — 2026-06-15 — ISeed replay-nonce (FROZEN-interface Spec Addendum) + facade hardening

Master-authorized amendment to a FROZEN SDK interface, plus the distillation/review
follow-through. Verified: **296 test files / 3163 passed / 0 failed / 4 skipped**;
purity PASS.

### Replay defense for cross-process seeds (Tenet #6)
- **`ISeed` gains optional `nonce`** (SDK, FROZEN-interface amendment via Spec Addendum
  2026-06-15). Purely additive; pre-addendum seeds take the legacy path; `SeedPatch`
  keeps nonce immutable. Covered by the HMAC signature automatically (seedCanonical
  hashes every field but `signature`), so a tampered nonce fails verify().
- **Wired the previously-dead `verifyNonce`** (SEC-001 / Plan46 W0 existed but was never
  called): `DistributedAlayaImpl.acceptRemote()` now rejects a replayed/reordered seed
  fail-closed; `plant()` auto-stamps a strictly-increasing per-agent nonce. In-process
  propagation (trusted) is not nonce-checked — defense lives where the threat is.
- Tests: `replay-nonce.test.ts` 6/6 (replay rejected, reorder rejected, tamper breaks
  signature, per-agent independence, backward compat, plant auto-stamp). Ledger #6 updated;
  remaining non-claims: cross-host transport, nonce restart-persistence.
- New `context-manager-required.test.ts` (Tenet #2/#9 negative path: core.start() throws
  with no context-manager plugin) — closes a source-true-but-test-unproven gap.

### Test hygiene — audit-trail residue eliminated
- The shared e2e fixture (`apps/runner/__tests__/e2e/helpers/agent-fixture.ts`) built a real
  AgentCore without an `auditTrail` config, so agent-core's CWD-relative default
  (`./audit-trail-<agentId>.jsonl`) appended 3 hash-chained entries to a tracked repo-root
  file on every full `pnpm test` run — committed as residue in v0.59.0/v0.59.1/v0.59.2. The
  fixture now writes to a per-run `os.tmpdir()` dir (fresh hash chain each run, removed in
  `cleanup()`); the three tracked residue files are deleted and `audit-trail-*.jsonl` is
  gitignored. No runtime code changed.

### Documentation (openstarry_doc)
- Distillation wave-1: guided-reading front README, 158 process-residue files moved to
  `archive/`, quarantine banners, dead-link/license/canonical-drift fixes.
- LETTER_TO_THE_FUTURE finalized; RETROSPECTIVE finalized; DISTILLATION_LIST; Zenodo runbook
  + live `.zenodo.json`/`CITATION.cff` (CC-BY-4.0, author Yang Yulin / SecludedCorner).
- Licenses landed: code repos Apache-2.0, doc corpus CC-BY-4.0.
- Adversarial 4-lens review (buddhism/philosophy/CS/editorial) + ledger-vs-code verification
  (every cited test re-run): 2 ledger overclaims tightened, no fabrication found.

## [v0.59.2-alpha] — 2026-06-12 — On-prem provider hardening + the time-capsule documents

The last code ticket of the closing track plus the document layer the project
was retired into. Verified: **294 test files / 3155 passed / 0 failed / 4
skipped**; purity PASS; cold smoke PASS.

### On-prem providers to claude-cli grade (openstarry_plugin)
- **provider-lmstudio (0 → 36 tests)**: pure stream-mappers extracted
  (`parseSseLine` / `mapOpenAiChunk` / `buildPayload`); wire behavior
  bit-identical; two pre-existing quirks pinned by tests as documented
  future-hardening candidates (missing-delta TypeError path; no final-buffer
  flush on unterminated SSE line).
- **provider-local-llama (3 smoke → 39 tests + 1 gated e2e)**: pure mappers
  extracted with finish-dedup state (`mapOllamaChunk(chunk, state)`); the
  three near-duplicate finish-yield sites consolidated into one mapper path.
- **NEW real-Ollama e2e smoke**, `skipIf`-gated on 127.0.0.1:11434 — honest
  marker: this machine has no Ollama, so the e2e has NEVER executed here;
  it runs only on hosts with Ollama + ≥1 model installed.
- **Fossils flushed**: buffer-remnant finish path dropped usage/tool_calls
  on a non-newline-terminated final NDJSON line (defensive path only — real
  Ollama always newline-terminates); dead write-only `toolCallMap` removed.

### Time-capsule document layer (openstarry_doc)
- **LETTER_TO_THE_FUTURE.md**: the charter — rationale layer (doc 50/41/DD14)
  wrapped around the fulfillment ledger plus the honest process data (87.5%
  spec-vs-merged gap, 96% closure inflation). Adversarially fact-checked by a
  3-lens workflow before commit; 11 blocking + 8 minor findings fixed.
- **RETROSPECTIVE.md** (draft): audited numbers with per-row provenance and
  the mechanism analysis of inflation as a structural end-state.
- **DISTILLATION_LIST.md**: all 353 canonical docs classified (51 blueprint /
  95 fix / 29 quarantine / 133 archive) by a 16-agent sweep.
- **ZENODO_DEPOSIT_RUNBOOK.md**: deposit prep complete; three Master-only
  decision points marked (attribution, license, account action).
- TENETS_FULFILLMENT: unfinished-list item 4 (on-prem providers) cleared
  with honest scope.

## [v0.59.1-alpha] — 2026-06-11 — Gap fill: the cheap-and-honest remainders closed

Master:「OK，並且補缺口」. Three gaps from the fulfillment ledger closed same
day. Verified: **292 test files / 3083 passed / 0 failed / 3 skipped**;
purity PASS.

- **VedanaEmergency wired (T1b, Tenet #8 last thorn)**: createManoAggregator
  params 4+5 (vedanaFn + emergency config) had been `undefined` since
  Plan28 R1 — the sustained-dukkha thresholdBoost path was dead and
  `config.vedanaEmergency` was computed-but-unconsumed. Now wired from the
  factory-scope vedana stream; test proves sustained dukkha (3 ticks ≥0.8)
  blocks an otherwise-passing arbiter for one route, then cooldown restores.
- **Daemon process tree made real (T3b, Tenet #10 attestation)**: the root
  agent now self-registers at startup (agent.processTree returned [] on
  every real daemon before this; agent.childAgents was always empty), and
  parent shutdown cascades SIGTERM to spawned children — the first orphan-
  reap path (gracefulStopAgent had zero call sites and never signalled the
  child PID despite its doc comment). E2E: real daemon-entry, spawnChild,
  tree edges, SEC-003 out-of-scope denial, parent-kill→child-reaped.
- **Fractal depth=3 (Tenet #10 upgrade)**: one external call traverses THREE
  agent processes — parent spawns middle at boot, middle spawns grandchild
  at ITS boot, each layer the identical mechanism (agent-ask + mcp-server +
  mcp-client) — and returns `PARENT-FINAL:MID-FINAL:CHILD-ANSWER:<pid>` in
  <2s. The recursion is the tenet:「由一而生萬物」.
- Ledger updated: 8 tenets fully proven; #6 at N=2 (explicit bounds);
  #10 at depth=3 (mechanism-isomorphic, inductively credible).

## [v0.59.0-alpha] — 2026-06-11 — Tenet Completion: the three unfulfilled tenets made factually true

Master directive:「完成宣言」. Three engineering proofs landed in one session,
each scoped to its SMALLEST HONEST VERSION — the minimal change that makes the
tenet's sentence factually true, with explicit non-claims documented.
Verification: clean rebuild; **289 test files / 3076 passed / 0 failed / 3
skipped**; purity PASS; smoke PASS.

### Tenet #8 — control loop CLOSED (Doc 37, T1)
- `IAgentConfig.kleshaModulation` (opt-in by presence): agent-core constructs
  KleshaModulatedDispatcher and wires `createKleshaThresholdFn` into
  createManoAggregator's `baseThresholdFn` slot — the purpose-built dynamic-θ
  hook that had been passed `undefined` since Plan29. Each route() samples the
  ONE shared klesha signal stream; θ(t) = clamp(θ₀ + w·μ) participates in the
  strict confidence gate; `klesha:modulation` event emitted per modulation.
- N=2 closed-loop proof (mano-aggregator-klesha.test.ts): the SAME arbiter
  (confidence 0.55) is rejected under a neutral vedana history (θ≈0.57 →
  gear 2) and accepted after sustained sukha (θ≈0.45 → gear 1) — the agent's
  felt experience changes its own dispatch decision. Absent the config block,
  behavior is byte-for-byte pre-v0.59 (the 3044-test baseline doubled as the
  compat gate). Example config: `configs/klesha-modulated-agent.json`.
- Honest notes: dispatcher's perceiveAll() remains runtime-unused (pure
  computeThreshold half wired; signals come from the shared fn); Sneha's 0.10
  floor means enabled-idle agents run at θ≈base−0.015 (attachment never
  reaches zero — Doc 37 semantics; the reason this is opt-in).

### Tenet #6 — alaya distributed IN FACT (T2)
- NEW `distributed-alaya/src/remote-peer.ts`: IpcRemotePeer speaks the
  daemon's line-delimited JSON-RPC over the peer's named pipe / UDS
  (plugin-internal framing; sdk-only deps preserved). Impl-level
  registerRemotePeer + acceptRemote (FROZEN SDK interfaces untouched);
  propagate() now routes to remote peers when no in-process target matches.
- Daemon: `OPENSTARRY_HMAC_KEY` read moved BEFORE plugin loading and injected
  into the distributed-alaya plugin ref — DaemonKeyProvider's
  "daemon-distributed cluster key" is true for the first time. New RPC
  surface: `alaya.acceptSeed` (receiver-side INDEPENDENT HMAC verification
  with the local key copy before the store is touched) + plant/propagate/
  query control plane; fail-closed when the plugin is absent.
- Two-process e2e (alaya-two-process.e2e.test.ts, real daemon-entry): seed
  planted on agent A crosses the OS process boundary and is served by agent
  B with ownership + signature intact; NEGATIVE proof — B with a different
  cluster key rejects the seed and both daemons survive (verification is
  genuine, not tautological); plugin-absent daemon fails closed.
- Honest scope (documented, not implied away): cross-process on ONE host,
  trusted-parent key distribution, no replay nonce (ISeed is FROZEN);
  exchangeSeeds/snapshot/subscribe remain in-process.

### Tenet #10 — fractal composition PROVEN (T3)
- NEW plugin `@openstarry-plugin/agent-ask` (44th): exposes the agent's OWN
  COGNITION LOOP as the `agent.ask` tool (isolated session, session-scoped
  event correlation, timeout, full cleanup). The load-bearing piece: until
  now, composing agents over MCP composed tool registries — a child reached
  over MCP was a tool server, not a sub-Agent.
- E2E proof (fractal-composition.e2e.test.ts, 2 OS processes, depth 2): the
  parent agent spawns the child at its own boot via mcp-client stdio,
  delegates the user's task to the child's cognition through the bridged
  `child-agent/agent.ask`, and answers out ONE unified MCP HTTP endpoint
  (round-trip marker `PARENT-FINAL:CHILD-ANSWER:<childPid>:...`, distinct
  PIDs, child reaped on parent kill). Routing is MCP — MessageRouter /
  apps-channel / comm-pipeline are validation-only or unwired and are
  neither used nor claimed.
- Fixed en route (both latent since delivery, flushed out by the e2e):
  **mcp-server stdio transport was deaf** — readline lines were appended to a
  buffer and re-split on a newline the buffer could never contain, so the
  dispatch loop never ran; **mcp-client on win32 spawned with shell:true**,
  breaking any command path containing spaces ("C:\Program Files\nodejs\
  node.exe" — the default install); shell now only for .cmd/.bat shims.

### Fulfillment ledger
- NEW canonical doc `TENETS_FULFILLMENT.md` (openstarry_doc): per-tenet
  honest status — proven / partial / explicit non-claims with evidence
  pointers — doubling as the core of the letter-to-the-future.

## [v0.58.0-alpha] — 2026-06-11 — Repair Sprint ("final v2"): honest reconciliation of every abandoned tail plan

One-session repair sprint executed post-retirement under Master direction.
Governing criterion: **every subsystem either WORKS or is HONESTLY MARKED —
nothing half-wired may masquerade as live.** A 21-plan autopsy (Plan40-Plan60)
identified five never-wired orphan libraries, one false delivery claim, one
unloadable plugin, and a fiction layer in the doc corpus. All resolved.
Verification: clean rebuild; **283 test files / 3044 passed / 0 failed / 3
skipped**; microkernel purity PASS; cold-user smoke run PASS (by-name plugin
loading, single-rendering output, zero-API-key claude-cli path).

### Fixed (live-behavior bugs)
- **stdio double-render**: claude CLI >=2.1.14x emits BOTH stream deltas AND a
  full-message `assistant` line; both mapped to `text_delta`, so every response
  rendered twice. Per-stream dedup state added to `mapStreamEvent`
  (provider-claude-cli). Verified live: "PINEAPPLE" now renders once.
- **provider-by-name resolution**: plugins not in the runner's package.json
  could not be loaded by name (users had to discover the undocumented per-plugin
  `path` field by reading resolver source). The monorepo sibling
  `../openstarry_plugin/` is now a built-in search path — zero-config by-name
  loading in the documented two-repo layout.
- **mesh plugin unloadable since delivery (Plan58)**: factory passed raw
  `ctx.config` into `createMeshBroker`, whose required `manifests`/`delivery`
  fields then hit `undefined.map` — loading from any JSON agent config crashed
  the runner. Factory now defaults to an empty routing table + no-op delivery
  sink. Caught by the new `configs/phase6-agent.json` smoke boot.
- **rate_limit_event log noise**: CLI >=2.1.170 emits it on every call; now in
  KNOWN_SILENT_TYPES (resolves DT-42-B sub-task B, previously DEFERRED).
- **README version drift**: claimed v0.42.0-alpha while package.json said
  v0.57.10-alpha.

### Added (closing documented gaps)
- **workflow-engine `loop` step (DT-MG-α)**: foreach (`over`) and `while`
  modes, mandatory `maxIterations` hard cap (throws on overflow — no silent
  truncation), `{{loop.item}}`/`{{loop.index}}` interpolation context, nested
  loops supported. Closes the "single sequential for-loop, zero control-flow
  constructs" MVP gap.
- **workflow-engine execution-state persistence (DT-MG-β)**: opt-in via
  `OPENSTARRY_WORKFLOW_STATE_DIR`; every result (success AND failure) persists
  to `<dir>/<executionId>.json`; `getStatus()` falls back to disk — execution
  state survives the process. Closes the "state vanishes with the process" gap.
- **Plan48 observability wire-in**: `apps/runner/src/observability.ts` connects
  structured-log (`OPENSTARRY_LOG_PATH`, lifecycle JSONL) and audit-sink
  (`OPENSTARRY_AUDIT=1`, journals `capability_denied` from the live Plan46
  tool-filter producer) into the start command, with the ordered shutdown-flush
  cascade (200→300). Until now these modules had zero production imports and
  the C48-M2a claim "subscribes at runner startup" was true only in unit tests.
- **Live klesha signals**: `getKleshaSignals` was hardcoded to neutral zeros at
  the volition-deps layer since Plan28, so Doc 37's gain-scheduling machinery
  never modulated anything. New `createKleshaSignalFn` (agent-core) runs the
  four Plan26 perceivers over sampled vedana history + `tool:executing` action
  history, consuming the previously-unused `resolvedKleshaFilterConfig`.
- **`configs/phase6-agent.json`**: provable activation path for the Phase 6
  plugin-form deliveries (vasana-engine, mesh, api-runtime).

### Removed (amputation of never-wired orphan libraries — ~1.7k LOC)
Delivered with tests, ZERO production imports across their entire life,
counted toward Phase 6 "functional landings". Design specs retained with
honest `LIBRARY REMOVED` status markers:
- **Plan54 agent-composition** (705 LOC + SDK types): runtime could never
  spawn through it; carried MAX_SPAWN_DEPTH=4 conflicting with the live
  daemon's COMPOSITE_AGENT_MAX_DEPTH=3 (conflict resolved in favor of live).
- **Plan56 multi-ivolition** (442 LOC + SDK types): dispatch/queue never fed
  the execution loop.
- **Plan51 zod-gate** (429 LOC runner + 105 LOC transport-websocket local):
  validation gates that never enforced anything at any runtime boundary.
- **Plan49 wiener thresholds** (79 LOC): "centralization" was architecturally
  impossible (its consumer spc-monitor is a separate package that cannot import
  runner internals); event-contract ownership moved to its emitter.

### Honest status markers (code kept, claims corrected)
- **hmac-cleanup (Plan48 C48-M3)**: LIBRARY ONLY — NOT WIRED (integration
  requires refactoring the checkpoint HMAC path; explicitly future work).
- **Tech Spec 18**: the claim "Plan48 將 writer 引入 runner bootstrap、
  plugin-install flow 及 SIGTERM cascade" was FALSE at delivery; corrected
  with the actual v0.58.0-alpha wire-in status.
- **Doc 37 (klesha)**: "已實作" downgraded to library-then-wired-at-v0.58
  honest history; dispatcher gear-modulation remains future work.

### Documentation (canonical openstarry_doc)
- **Quarantine banners on Technical_Specifications 01-07**: they describe a
  PRE-IMPLEMENTATION design that was never built (17-claim fidelity audit:
  10 contradictions); authoritative contracts = SDK type files + test suite.
- **Doc 21**: "Status: CURRENT" stamp corrected; it endorsed quarantined Tech
  Spec 03 as the authoritative API reference.
- **GETTING_STARTED.md rewritten** against the real CLI (`--config` not
  `--agent`; from-source install; the four mandatory config elements; actual
  resolution order; claude-cli zero-key quickstart). Previous guide failed a
  cold user at least 3 separate times (verified by smoke run).
- **User_Scenario guide** marked vision-not-manual; **doc 12** workflow drift
  marked; **Implementation_Reference** plugin count (15→43) and IListener
  skandha mapping (受→色) corrected against SDK annotations.
- Stale plan headers fixed: Plan45 IN_PROGRESS→COMPLETE, Plan52
  CANDIDATE→BINDING+SHIPPED (ratified cycle 03-20, never written back).

## [v0.57.4-alpha] — 2026-05-11 — Cycle 03-27 Hygiene-Only Fix (provider-claude-cli M3 P3 LOW 5 items)

Cycle 03-27 — independent hygiene-only fix cycle (per Master directive
2026-05-09 §3.1 PASS path; pure fix; no audit; no R3 vote). 5 LOW-tier P3
items deferred from cycle 03-25 R3 §4 closed in this delivery.
Delivery report: `share/engineering_delivery/cycle03-27_v0.57.4-alpha-hygiene-fix/delivery_report.md`.

ε-surface invariance Δ=0 PRESERVED — **7-cycle preservation streak**
(cycle 03-21 ~ 03-27 inclusive). No manifest field changes, no
provider-id change, no model-list change, no `ChatRequest` /
`ProviderStreamEvent` schema change, no HMAC participation status change.

### M3 P3 LOW — 5 hygiene items (all in `provider-claude-cli/src/index.ts`)

- **F-CY25-§4-R1-02** stderr disclosure redaction: new exported
  `redactStderrForError(snippet)` strips known-sensitive substrings
  (Anthropic-style `sk-*`, `Bearer *` tokens, `ANTHROPIC_API_KEY=` /
  `ANTHROPIC_AUTH_TOKEN=` env-style assignments) before stderr is
  forwarded into upstream `Error.message`. Truncation cap tightened
  500 → 200 chars (exported `STDERR_REDACT_MAX_LEN`).
- **F-CY25-§4-R1-04** subprocess cwd codification: new exported
  `getSubprocessCwd()` returns `tmpdir()`. Was already enforced since
  v0.57.2-alpha P2-03 spawn block; this fix codifies the invariant as
  a testable export and updates the spawn site to call the getter.
- **F-CY25-§4-R1-05** per-PID mcp-empty cleanup: new exported
  `cleanupEmptyMcpConfigPath()` unlinks `openstarry-claude-cli-mcp-empty-${pid}.json`
  and resets the cached path. Registered as one-shot `process.on("exit")`
  handler at file creation; previously stale per-PID files accumulated
  in tmpdir across process generations.
- **F-CY25-§4-R2-03** dispose() cache reset: plugin `dispose()` now
  invokes `cleanupEmptyMcpConfigPath()` so a runtime reload after dispose
  triggers a fresh write rather than reusing a possibly-removed-by-exit
  path. Pairs with R1-05.
- **F-CY25-§4-R2-05** resolveClaudeBinary memoization: module-level
  `Map<string,string|null>` cache (`_resolveBinaryCache`) so concurrent
  adapter inits sharing the same `cliPath` resolve once. Caps PATH-shadow
  re-evaluation fan-out at 1 per unique input string (vs N-fold under
  parallel subagent dispatch). Test-only reset via
  `__resetResolveClaudeBinaryCacheForTests()`.

### Tests

- NEW `__tests__/p3-hygiene-fix.test.ts` (~190 LOC; **19 tests** across the
  5 P3 items + ε-surface invariance attestation)
- Existing `m3-security-fix.test.ts` (20 tests) and `index.test.ts` (26 tests)
  preserved verbatim.

| Test scope | v0.57.2 baseline | v0.57.4 |
|------------|------------------|---------|
| provider-claude-cli isolated | 46/46 | **65/65** PASS |
| Full suite | 284 files / 3057 passed | **286 files / 3092 passed** (1 pre-existing `guide-persistent` Windows EPERM flake unchanged) |
| Purity check | PASS | **PASS** |

### §75.X Quality Gates (Dev: 18th consecutive)

| Gate | Result |
|------|--------|
| `pnpm install --frozen-lockfile` | (existing lockfile reused; no dep change) |
| `pnpm build` | exit 0; all plugins + apps/runner built |
| `pnpm vitest run` (full) | 286 files / 3092 passed / 1 pre-existing flake (`guide-persistent`) / 3 skipped |
| provider-claude-cli isolated suite | **65/65 PASS** |
| `pnpm test:purity` | **PASS** |

Counter-discrepancy carry-forward (5th flagging): Dev-side running count is
**18th consecutive** §75.X-gated tag (v0.55.3 → v0.55.4 → v0.55.5 → v0.56.0 →
v0.57.0 → v0.57.1 → v0.57.2 + v0.57.4 = 18). Spec called this "19th-enforced"
in dispatch §3.2; Master directive called this "18th-enforced" in task #182
description. Likely counting-basis difference (Plan-level vs hotfix). Carried
into this delivery's §5.1 for reconciliation.

---

## [v0.57.2-alpha] — 2026-05-07 — Cycle 03-25 M3 P1+P2+P4 9-Finding Security Fix (provider-claude-cli)

Cycle 03-25 — Master Ratification **Batch 22** 14/14 APPROVED 2026-05-07 +
Master directive 2026-05-07 SCOPE CHANGE (M3 + M5 audit fix THIS round, not
cycle 03-26+). M5 fix (4 NEW sibling status update docs + 8 files) completed
by Coordinator; M3 P1+P2+P4 = 9 findings fixed by Dev this delivery.
Delivery report: `share/engineering_delivery/cycle03-25_v0.57.2-alpha-m3-security-fix/delivery_report.md`.

**v0.57.2-alpha is NOT source byte-identical with v0.57.1-alpha** (real code
changes in `provider-claude-cli/src/index.ts` + tests + READMEs per M3 fix
scope). v0.57.1 endpoint achievement marker remains the ceremonial release;
v0.57.2 is the security follow-up.

### ε-surface invariance Δ=0 hard constraint (per O3 §6)

Preserved verbatim across the M3 fix:
- NO manifest field changes (name / version / description / skandha unchanged)
- NO provider-id change (`"claude-cli"`)
- NO model-list change (sonnet / opus / haiku)
- NO `ChatRequest` / `ProviderStreamEvent` schema change
- NO HMAC participation status change (leaf provider — see README §HMAC Posture)
- Internal behaviour fixes only

### M3 P1 — Critical defenses (2 findings)

- **F-CY25-§4-R1-07** Claude CLI major-version pin (defense-in-depth):
  new exported `AUDITED_CLI_MAJORS` constant (`["1", "2"]`) + `parseClaudeMajorVersion(out)` helper. Subprocess CLI major versions outside the audited set warn-log a re-audit-required event (operator-aware; not hard block). Existing `--disallowedTools` 9-tool list remains as second layer.
- **F-CY25-§4-R1-08** unknown stream-event line types are no longer silently dropped: `mapStreamEvent` now accepts an optional `onUnknown(lineType)` callback. Production caller (`streamClaudeCli`) warn-logs unknown types via the adapter's logger. Stream stays alive (defensive — novel CLI versions don't break inference). Backward compatibility preserved: callers without the callback continue to get `null` for unknown types.

### M3 P2 — Important defenses (3 findings)

- **F-CY25-§4-R1-01** PATH-shadowing safe binary resolution: new `resolveClaudeBinary(cliPath)` (PATH-walk + `realpathSync`). Adapter init resolves `cliPath` to an absolute filesystem path; subprocess never sees a relative path that PATH-shadowing could reroute. Init falls back gracefully (warn-log + raw path) when binary not located, so test scenarios still work.
- **F-CY25-§4-R1-03** subprocess env is now an explicit ALLOWLIST: new exported `ALLOWED_ENV_KEYS` + `buildAllowlistedEnv(source)` helper. Subprocess `env` is filtered down to only env vars `claude` provably needs (HOME / PATH / locale / OAuth dirs / TMPDIR / Windows essentials / explicit Anthropic auth). Agent-side application secrets in `process.env` cannot leak to subprocess.
- **F-CY25-§4-R2-04** multi-turn forward-gap guard: adapter init warn-logs when `cfg.maxTurns > 1` is configured (subprocess agentic loop runs internally; OpenStarry agent loop cannot inspect intermediate state — re-audit required).

### M3 P4 — Documentation (4 findings; README EN + TW updates)

- **F-CY25-§4-R1-06**: prompt-channel design (`-p` single positional + transcript serialization) documented
- **F-CY25-§4-R1-09**: HMAC posture as leaf-provider non-participant documented
- **F-CY25-§4-R2-02**: role-prefix injection vector + caller-trust contract documented
- **F-CY25-§4-R2-06**: empty-MCP-config file `mode 0o600` invariant documented

README EN + TW updated same-PR per Rule #78 §78.5 BINDING-tier reflexive.

### Other small details

- subprocess `cwd: tmpdir()` set explicitly (detach from agent CWD; previously inherited)
- `node:fs` imports extended (existsSync / realpathSync / statSync) for binary resolution

### Tests + Quality Gates (§75.X 17th consecutive Dev / 12th-enforced spec)

- **284 files / 3057 passed / 3 skipped** (excl 5 pre-existing flakies; +20 new M3 tests vs v0.57.0 / v0.57.1 baseline)
- provider-claude-cli isolated suite: **46/46 PASS** (was 26 in v0.57.0; +20 net = 7 P1-08 unknown-callback + 4 P2-01 binary-resolution + 6 P2-03 env-allowlist + 3 P1-07 version-pin)
- Microkernel purity: PASS (MR-6 baseline preserved; plugin layer only)
- 50 workspace projects (unchanged)

### Compliance

| Constraint | Status | Note |
|------------|:------:|------|
| MR-12 forward-only | PASS | M3 fixes are forward; original v0.57.1-alpha source preserved at `release/cycle03-24_v0.57.1-alpha/` |
| ε-surface invariance Δ=0 | PASS | per O3 §6 hard constraint; manifest / provider-id / model list / schema / HMAC posture all unchanged |
| Rule #75 §75.X 12th-enforced (Dev: 17th consecutive) | PASS | counting discrepancy carried 4 cycles; flagged again in delivery_report |
| Rule #62 / Rule #74 L1' / Rule #76 §76.6+§76.7 / Rule #77 / Rule #78 §78.5 | PASS | TW sibling same-PR |
| MR-5 / MR-6 鐵律 / MR-9 / MR-11 / MR-13 standby | PASS |  |
| ZT-1/2/3 | PASS | hotfix→Plan→Doc-only→Security-fix boundary; no signature/scope/binding shift |
| Tenet #10 10/0/0★ COMPLIANT FINAL | PRESERVED | (achieved cycle 03-24 v0.57.1) |
| ENG-FAB v1.8 = 48 canonical | PASS |  |
| F-13/F-14/F-15 v3 reflexive | PASS |  |
| F-16 / FORBIDDEN-phrasings / chair-rule | RETIRED |  |
| Phase 6 strict 7-list anchor | 7/7 ✅ 完工 (preserved from cycle 03-23) |  |

## [v0.57.0-alpha] — 2026-05-05 — Plan60 Blackboard-Alaya (Phase 6 7/7 完工 ✅; existing-plugin-spec-upgrade)

Cycle 03-23 — Master Ratification Batch 20 12/12 APPROVED 2026-05-05 — Plan60
BINDING implementation (per `openstarry_doc/Technical_Specifications/Plan60_Blackboard_Alaya_Binding.md`).
**Phase 6 trajectory: 6/7 → 7/7 ✅ 完工 final functional landing.**
Form-pattern matrix 第四範例 candidate: existing-plugin-spec-upgrade
(R-elevation cycle 03-21 + provider-claude-cli G-greenfield cycle 03-21 +
api-runtime G-greenfield-upfront cycle 03-22 + **Plan60 reuse-spec-upgrade
this cycle**).
Delivery report: `share/engineering_delivery/cycle03-23_plan60-blackboard-alaya/delivery_report.md`.

### Plugin: `@openstarry-plugin/distributed-alaya` (Option A reuse + Plan60 forward addendum)

Existing 722-LOC production plugin (BijaStore + seed-signature + vector
clock + SEC-002 + late-joiner snapshot) reused per Plan60 §2 D-§1-A 22/1
super-majority. Spec name "Plan60 Blackboard-Alaya" aligns with Phase 6
strict 7-list anchor while plugin filename remains "distributed-alaya"
per D-§1-Clarif C2 23/0 naming reconciliation.

**Forward addendum per MR-12 既有不破壞** (additive only — zero
modification of existing 4 source files / 6 test files):

- NEW `src/plan60-addendum.ts` (149 LOC): `createAlayaSeedAttestor`
  factory + `loadAlayaHmacKey` (refuse-to-start on key < 32 bytes / non-hex)
  + `buildAlayaCanonical` helper + `REPLAY_CACHE_TOPOLOGY_N7` frozen
  7-row constant
- NEW `src/__tests__/plan60-addendum.test.ts` (230 LOC; **22 tests**)
- `src/index.ts` extended with 6 additive exports (5 helpers + 2 types);
  existing exports unchanged

### Five Aggregates

識蘊 第八識 (阿賴耶識; ālaya; 一切種子 / 記憶 / 習氣 / 業報 storage layer).
Existing manifest already declares `skandha: ['samskara', 'vijnana']` —
unchanged.

### Replay cache 7-contributor `aly:` prefix (Plan60 §4) — Phase 6 完工 final N=7

`psh:` (Plan52) + `ac9:` (Plan54) + `mvq:` (Plan56) + `vsn:` (Plan57 plugin
form) + `msh:` (Plan58) + `apr:` (Plan59 API Runtime) + **`aly:` (Plan60
Blackboard-Alaya)**.

`aly:` per ASANGA Sanskrit ālaya transliteration; 3-char-lowercase + colon-
suffix (matches stricter `^[a-z]{3}:$` per spec §4 GUARDIAN attestation).
`ac9:` lowercase+digit grandfathered as legacy.

R2-C 5-item AND-condition all PASS:
1. prefix structure verbatim (`aly:` matches strict 3-char-lowercase form;
   N=7 topology fits `^[a-z][a-z0-9]{2}:$` shape)
2. nonce length verbatim (N≥8 hex per DSS-CY21-§1-B + DSS-CY22-§1-B +
   DSS-CY23 KERNEL preferred)
3. contributor-table 7-row in source comments (`REPLAY_CACHE_TOPOLOGY_N7`
   frozen list + head-comment)
4. cross-prefix collision-audit test (probe each of 6 existing prefixes
   under same nonce — all free; only `aly:<n>` is occupied)
5. F-13/14/15 v3 schema lint reflexive PASS

**GUARDIAN Hamming-distance attestation** (Plan60 §6 vector-5): `aly:` vs
each of the 6 existing prefixes ≥ 2 — verified by unit test.

### Plan60 §6 5-vector defence-in-depth coverage

| Vector | Coverage |
|--------|----------|
| 1. Alaya seed pollution | HMAC-SHA256 + N≥8 hex nonce + `aly:` replay attestation + `loadAlayaHmacKey` key-derivation audit + payload_hash regex pins SHA-256 64 hex (size limit) |
| 2. Blackboard race | (existing distributed-alaya vector clock; unchanged) |
| 3. Seed retrieval consistency | (existing append-only seed log + monotonic order; unchanged) |
| 4. Key derivation reuse audit | Option A reuse: existing path unchanged + new addendum `loadAlayaHmacKey` independent |
| 5. Replay cache prefix-collision | `aly:` Hamming distance ≥ 2 vs all 6 existing prefixes (test-asserted) |

### Boundary invariant (Plan60 §5; KERNEL R2 sub-check #7)

Static-analysis grep over `plan60-addendum.ts` for forbidden tokens
`{parent_agent_id, capability_holdings, parentAgentId, capabilityHoldings}`:
0 hits. Canonical signing input is exactly `seed_id|payload_hash|nonce|ts_utc`
(strict 4-field tuple; verified by unit test).

### Tests + Quality Gates (§75.X 15th consecutive)

- **283 files / 3037 passed / 3 skipped** (excl 5 pre-existing flakies; +22 new
  Plan60 addendum tests on top of v0.56.0)
- distributed-alaya isolated suite: **81/81 PASS** (was 59 pre-Plan60; +22 net;
  ALL existing tests preserved per MR-12 既有不破壞)
- Microkernel purity: PASS (MR-6 baseline preserved; SDK additions are
  type-only Zod schemas + frozen constants)
- 50 workspace projects (unchanged from v0.56.0; Plan60 reuses existing plugin)

### LOC (Option A reuse — addendum delta only per MR-12)

| Component | LOC | vs §7.1 band 400-700 prod / 300-500 test |
|-----------|-----|-------------------------------------------|
| `plan60-addendum.ts` | 149 | additive |
| `blackboard-alaya.ts` (SDK) | 68 | additive |
| `plan60-addendum.test.ts` | 230 | additive |
| **Addendum total prod** | **217** | UNDER §7.1 indicative (SICP minimality consistent with Plan56=440, Plan57=380, Plan59=526) |
| **Addendum total test** | **230** | within band (under §7.1 indicative ~400 — consistent SICP precedent) |

### /simplify standard workflow (9th organic apply post-graduation)

3 findings: 2 substantive adopted same-session (file-level separation
addendum-as-dedicated-module vs editing existing files preserves MR-12
既有不破壞 verbatim; `REPLAY_CACHE_TOPOLOGY_N7` exported as frozen constant
rather than inlined per Plan60 §4 R2-C #4 audit-script anchor pattern) +
1 trivial. substantive_rate=0.67; adoption_rate=0.67; verdict Branch A.

### Compliance

| Constraint | Status |
|------------|:------:|
| Rule #62 / Rule #74 L1' code+doc sync | PASS |
| Rule #75 §75.X (15th consecutive enforcement; spec called this 10th-enforced — counting discrepancy carryover from v0.56.0 §6.1; flagged for Coordinator/Master) | PASS |
| Rule #76 §76.6 + §76.7 / Rule #77 / Rule #78 §78.5 | PASS |
| MR-5 hard / MR-6 鐵律 / MR-9 / MR-11 / **MR-12 既有不破壞 (additive-only addendum)** | PASS |
| ZT-1/2/3 | PASS |
| ENG-FAB v1.8 = 48 canonical | PASS |
| F-13/F-14/F-15 v3 reflexive | PASS |
| F-16 / FORBIDDEN-phrasings / chair-rule | RETIRED (cycle 03-21 binary final; cycle 03-22+ confirmed) |
| **Phase 6 strict 7-list anchor** | **7/7 ✅ 完工** (Plan60 = 第七棒; final functional landing) |
| Master directive 2026-05-01 4 防線 fifth enforce | PASS |
| Master directive cycle 03-23 §6.4 SPC backfill Option α | PASS |
| Master directive 2026-05-03 5-point isolation v2 third sustained | PASS (provider-claude-cli unchanged this cycle) |
| Tenet #10 9/0/1★ ACTIVE → 10/0/0★ COMPLIANT | unblock conditions met by Phase 6 7/7 完工; cycle 03-24 endpoint ratification |

### Phase 6 trajectory: 6/7 → 7/7 ✅ 完工 final functional landing

- 1/7 Plan52 pushInput (cycle 03-14)
- 2/7 Plan54 AC-9 (cycle 03-17)
- 3/7 Plan56 D-30-4 (cycle 03-18)
- 4/7 Plan57 D-30-5 (cycle 03-19; plugin amendment cycle 03-21)
- 5/7 Plan58 Mesh (cycle 03-21)
- 6/7 Plan59 API Runtime (cycle 03-22)
- **7/7 Plan60 Blackboard-Alaya (this cycle) ✅ 完工**

Cycle 03-24 endpoint 10/0/0★ ratification + Tenet #10 升 COMPLIANT 條件齊備.
Cycle 03-25 Phase 7 R-input formal opening: Plan52/54/56/58 整批 elevate
candidate per Plan60 §8 forward.

## [v0.56.0-alpha] — 2026-05-04 — Plan59 API Runtime (Phase 6 第六棒; plugin form upfront)

Cycle 03-22 — Master Ratification Batch 19 12/12 APPROVED — Plan59 BINDING
implementation (per `openstarry_doc/Technical_Specifications/Plan59_API_Runtime_Binding.md`).
**Phase 6 trajectory: 5/7 → 6/7 FUNCTIONAL.** Phase 7 elevation 先驅範例 第三例
(after VasanaEngine R-elevation cycle 03-21 + provider-claude-cli G-greenfield
edge plugin cycle 03-21): Plan59 = G-greenfield 核心 observability primitive.
Delivery report: `share/engineering_delivery/cycle03-22_plan59-api-runtime/delivery_report.md`.

### NEW plugin: `@openstarry-plugin/api-runtime`

Plan59 §2 plugin form upfront (G-only instance per R3 D-§1-A 23/0 UNANIMOUS) —
**NOT in `apps/runner/`**; lives at `openstarry_plugin/api-runtime/` from cycle 1.

- **Five Aggregates**: 識蘊 (Vijnana; 「了別」 discriminating awareness)
- **Two-path model** (Plan59 §6.1 file-level separation R3 D-§1-R2-D 23/0):
  - `src/observe.ts` — read-only introspection (idempotent; no replay cache)
  - `src/invoke.ts` — bounded mutating intervention (HMAC + `apr:` replay cache)
- **Bounded intervention 4-tuple** (Plan59 §6.3 R3 D-§1-Clarif C3 23/0): log_level
  (info|warn|error|debug) / debug_flag / soft_tracing / **anything else REJECTED**
  at Zod parse (defence in depth: explicit `intervention_kind_out_of_scope`
  reason reserved for future widening that bypasses schema parsing)
- **LOC actual**: 418 plugin prod + 108 SDK type prod = 526 prod (UNDER §7.1 indicative-low ~700 / band 600-900; same SICP-canonical pattern as Plan56=440 / Plan57=380); 463 test (within band 400-600)

### Plan52/54/56/57(plugin)/58/59 isomorph (10-dimension)

ε-surface delta vs Plan52 baseline = **0 fields, 0 const** (strict equality;
MR-6 鐵律 verified). Plugin-internal namespace (`PluginRuntimeStateView` /
`PluginRuntimeRecord` / `IRuntime`) lives ENTIRELY inside the api-runtime plugin
schema; ε-surface envelope schema (pushInput Plan52 envelope) does NOT expose
any plugin-internal type.

### Replay cache 6-contributor `apr:` prefix (Plan59 §4)

`psh:` (Plan52) + `ac9:` (Plan54) + `mvq:` (Plan56) + `vsn:` (Plan57 plugin
form) + `msh:` (Plan58) + **`apr:` (Plan59 API Runtime)**. R2-C 5-item
AND-condition same-PR honoured: prefix structure verbatim (3-char-lowercase +
colon-suffix); nonce N≥8 hex per DSS-CY21-§1-B + DSS-CY22-§1-B KERNEL preferred;
contributor-table extended in source comments (test-asserted); collision-audit
test included (`apr:` collides with itself, NOT with msh:/psh:).

### Boundary invariant (Plan59 §6.2 R3 D-§1-R2-E 23/0)

`IRuntime.*` method signatures do NOT reference pushInput envelope's
agent-identity / capability-set fields. Static-analysis grep test
(`plugin.test.ts § Plan59 §6.2 boundary invariant`) confirms zero
forbidden-token occurrences across `runtime.ts`, `observe.ts`, `state.ts`,
`invoke.ts`. KERNEL R2 sub-check #7 set-disjointness predicate decidable
Yes/No PASS.

### Tests + Quality Gates (§75.X 14th consecutive)

- **282 files / 3015 passed / 3 skipped** (excl 5 pre-existing flakies; +44 new
  api-runtime tests across 4 files: 7 state + 8 observe + 16 invoke + 13 plugin/boundary)
- api-runtime isolated suite: **44/44 PASS**
- Microkernel purity: PASS (MR-6 baseline preserved; new plugin lives
  entirely in `openstarry_plugin/`; SDK additions are type-only Zod schemas
  + frozen constants — zero behavioural Core surface)
- 50 workspace projects (+1 api-runtime)
- §75.X gate sequence: `pnpm install --frozen-lockfile && pnpm build && pnpm test (excl 5 flakies) && pnpm test:purity` all exit 0

### /simplify standard workflow (8th organic apply)

4 findings: 2 substantive adopted same-session (file-level separation
observe.ts vs invoke.ts per R3 D-§1-R2-D mandate; defensive-copy snapshot
in `state.ts`) + 1 borderline escalated (whether `register()` should be on
`IRuntime` vs hidden — kept exposed as the plugin host needs to mount
plugins post-boot; no R2-D / spec violation) + 1 trivial. substantive_rate=0.50;
adoption_rate=0.50; verdict Branch A.

### Compliance

| Constraint | Status |
|------------|:------:|
| Rule #62 / Rule #74 L1' code+doc sync | PASS |
| Rule #75 §75.X (14th consecutive enforcement; spec called this 9th-enforced — discrepancy noted in delivery_report §6) | PASS |
| Rule #76 §76.6 + §76.7 / Rule #77 / Rule #78 §78.5 | PASS |
| MR-5 hard / MR-6 鐵律 / MR-9 / MR-11 / MR-12 | PASS |
| ZT-1/2/3; Tenet #10 9/0/1★ ACTIVE preserved | PASS |
| ENG-FAB v1.8 = 48 canonical | PASS |
| F-13/F-14/F-15 v3 reflexive | PASS |
| F-16 / FORBIDDEN-phrasings / chair-rule | ALL RETIRED (per cycle 03-21 binary final terminal; cycle 03-22 D-§4 confirmed) |
| Phase 6 strict 7-list anchor | **6/7** (Plan59 = 第六棒) |

### Phase 6 trajectory: 5/7 → 6/7 FUNCTIONAL

- 1/7 Plan52 pushInput (cycle 03-14)
- 2/7 Plan54 AC-9 (cycle 03-17)
- 3/7 Plan56 D-30-4 (cycle 03-18)
- 4/7 Plan57 D-30-5 (cycle 03-19; plugin amendment cycle 03-21)
- 5/7 Plan58 Mesh (cycle 03-21)
- **6/7 Plan59 API Runtime (this cycle)**
- 7/7 Plan60 Blackboard-Alaya (cycle 03-23 candidate per Phase 6 strict 7-list anchor; Tenet #10 9/0/1★ → 10/0/0★ unblock path)

## [v0.55.5-alpha] — 2026-05-03 — HOTFIX v5 provider-claude-cli: parseStreamLine schema fix

Cycle 03-21 in-flight HOTFIX v5 per Master directive 2026-05-03; W2-R26
**7th BLOCKER recovery**. v0.55.4-alpha unblocked the OAuth incompatibility
at the argv level (subprocess actually responds) but `mapStreamEvent`
parsed the wrong stream-json schema, so every text-delta yielded null and
every successful `result` line was misclassified as an error.
Delivery report: `share/engineering_delivery/cycle03-21_v0.55.5-alpha-hotfix-v5/delivery_report.md`.

**Subprocess argv unblock confirmed by Master** — this hotfix is the final
JSON-parsing layer; subprocess + auth + isolation flag set are all proven
working.

### Bug (v0.55.4-alpha residual)

`mapStreamEvent` assumed:
- `stream_event` text was at `line.delta.text` (real shape: `line.event.delta.text`).
- `result` carried `{success: bool}` / `{error: string}` (real shape:
  top-level `subtype: "success" | "error_*"` + `is_error: bool`; `result`
  field is the aggregated TEXT STRING).

Net effect on Master's first live run: every text delta dropped (null);
every successful inference returned the error branch (`"claude-cli reported failure"`).

### Fix — schema corrected per Hermes SKILL.md line 149-163

```typescript
// stream_event:
if (line.type === "stream_event") {
  const delta = line.event?.delta;
  if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
    return { type: "text_delta", text: delta.text };
  }
  return null;
}

// result:
if (line.type === "result") {
  if (line.subtype === "success" && line.is_error === false) {
    return { type: "finish", stopReason: "end_turn" };
  }
  const reason = line.subtype ?? line.error ?? "claude-cli reported failure";
  return { type: "error", error: new Error(`Claude CLI error: ${reason}`) };
}
```

`ClaudeStreamLine` interface updated:
- removed `delta: { text }` and `result: { success, error }` (wrong shapes)
- added `event?: { delta?: { type?, text? } }`
- added `result?: string` + `is_error?: boolean`

Defensive `assistant` legacy-shape branch preserved for older CLI versions.

### Fixtures + tests

New `__tests__/fixtures/` with two real ndjson samples:
- `stream-json-success.txt` — `system` init + 4 `stream_event` deltas + `api_retry` + final `result subtype:success` line. Replay test reconstructs the full text `"Hello, world!"` from deltas + verifies exactly one `finish` event.
- `stream-json-error.txt` — partial `stream_event` + `result subtype:error_max_turns is_error:true`. Replay test verifies the error event message contains `"error_max_turns"`.

provider-claude-cli isolated suite: **26/26 PASS** (was 22 in v0.55.4):
- buildArgv 11 (unchanged)
- ensureEmptyMcpConfigPath 4 (unchanged)
- mapStreamEvent 9 (was 7; +2 for new shape coverage and tool_use rejection; assertions rewritten for real schema)
- fixture replay 2 (NEW)

### 5-Point Process-Level Isolation Guarantees (UNCHANGED)

All 5 guarantees from v0.55.4 preserved verbatim. This hotfix is parsing-layer-only;
no argv / no subprocess-spawn / no settings-file / no auth-mode change.

### Tests + Quality Gates

- **278 files / 2971 passed / 3 skipped** (excl 5 pre-existing flakies; +4 new tests vs v0.55.4)
- Microkernel purity: PASS (MR-6 baseline preserved; pure-function change in plugin layer)
- 49 workspaces (unchanged)

### Compliance

- Rule #62 Tier 1 Bug-fix-ratification (W2-R26 7th unblock; third-step retrospective: capability-flag interaction matrix lesson now extends to capability-output-schema interaction — same blind-spot family)
- MR-6 plugin-only strict (0 Core surface; verified by `pnpm test:purity`)
- Rule #74 L1' code+doc sync (README EN + TW BINDING-tier same-PR-strict per Rule #78 §78.5)
- Rule #75 §75.X **13th consecutive** enforcement (all gates exit 0)
- F-16 SHOULD initial FINAL preserved
- ZT-1/2/3 PASS; Tenet #10 9/0/1★ ACTIVE preserved
- Phase 6 trajectory UNCHANGED at 5/7 FUNCTIONAL (hotfix; no advancement)

## [v0.55.4-alpha] — 2026-05-03 — HOTFIX v4 provider-claude-cli: drop --bare (OAuth incompatible)

Cycle 03-21 in-flight HOTFIX v4 per Master directive 2026-05-03; W2-R26
6th BLOCKER recovery. v0.55.3-alpha (NEW plugin) shipped with `--bare`
enforced for guarantee #2 — but per Hermes SKILL.md line 228, `--bare`
requires `ANTHROPIC_API_KEY` and is incompatible with the Pro/Max OAuth
session inherited from `claude auth login`. v3 was DOA on Master's machine.
Delivery report: `share/engineering_delivery/cycle03-21_v0.55.4-alpha-hotfix-v4/delivery_report.md`.

### Bug (v0.55.3-alpha residual)

`buildArgv` emitted `--bare` unconditionally. The Claude CLI rejected the
inherited OAuth session under `--bare`, demanding an API key Master does
not possess. Every `chat()` call returned an auth error before any
inference could occur.

### Fix — OAuth-compatible isolation triple

`--bare` REMOVED. Replaced with three flags that achieve equivalent
isolation against CLAUDE.md / MCP / skills inheritance without requiring
an API key:

1. `--system-prompt <minimal>` — overrides any `CLAUDE.md` / user-prompt
   context with `"You are an inference engine. Do not invoke tools. Reply concisely."`
2. `--strict-mcp-config --mcp-config <empty.json>` — points the
   subprocess at `<os.tmpdir()>/openstarry-claude-cli-mcp-empty-<pid>.json`
   containing `{"mcpServers": {}}`, skipping MCP discovery.
3. `--disable-slash-commands` — skills cannot be invoked.

Empty MCP config file is created lazily once per process via the new
exported `ensureEmptyMcpConfigPath()` helper; lives at OS tmpdir with
PID embedded in the filename for parallel-process safety. Plugin still
NEVER touches `~/.claude/*` or `.claude/*` (guarantee #5 preserved).

### 5-Point Process-Level Isolation Guarantees (UPDATED #2)

Tier-0 critical bug if any guarantee violated:

1. **Fresh subprocess per call** — every `chat()` invocation spawns a brand-new
   `claude` process; no state carry across calls. *(unchanged)*
2. **OAuth-compatible isolation triple enforced** *(REPLACED `--bare` v4)*:
   `--system-prompt` + `--strict-mcp-config --mcp-config <empty.json>` +
   `--disable-slash-commands`.
3. **`--disallowedTools` enforced** — Bash/Read/Edit/Write/WebSearch/WebFetch/
   Grep/Glob/NotebookEdit all disabled. *(unchanged)*
4. **`--no-session-persistence` enforced** — no session log written to disk. *(unchanged)*
5. **No settings-file mutation** — plugin NEVER touches `~/.claude/*`,
   `.claude/*`. Empty MCP file lives at OS tmpdir per-PID. *(unchanged scope; clarified location)*

→ Master coordinator session and parallel `claude` CLI sessions remain
unaffected by this plugin's subprocesses.

### Tests + Quality Gates

- **278 files / 2967 passed / 3 skipped** (excl 5 pre-existing flakies; +7 new tests vs v0.55.3)
- provider-claude-cli isolated suite: 22/22 PASS (was 15; +1 NOT-bare, +3 new flag tests, +4 ensureEmptyMcpConfigPath tests; -1 bare assertion)
- Microkernel purity: PASS (MR-6 baseline preserved; plugin layer only)
- 48 workspaces (unchanged)

### Compliance

- Rule #62 Tier 1 Bug-fix-ratification (W2-R26 6th unblock; second-step retrospective lesson: capability-flag interaction matrix unchecked → release shipped → caught at first Master-side run)
- MR-6 plugin-only strict (0 Core surface; verified by `pnpm test:purity`)
- Rule #74 L1' code+doc sync (README EN + TW BINDING-tier same-PR-strict per Rule #78 §78.5)
- Rule #75 §75.X 12th consecutive enforcement (all gates exit 0)
- F-16 SHOULD initial FINAL preserved
- ZT-1/2/3 PASS; Tenet #10 9/0/1★ ACTIVE preserved
- Phase 6 trajectory UNCHANGED at 5/7 FUNCTIONAL (hotfix; no advancement)

## [v0.55.3-alpha] — 2026-05-03 — NEW plugin provider-claude-cli (HOTFIX v3; W2-R26 5th unblock + Phase 7 範本)

Cycle 03-21 in-flight HOTFIX v3 / NEW plugin per Master directive 2026-05-03;
W2-R26 5th unblock attempt after 4 prior provider plugins all failed
(chatgpt-oauth Codex limit / gemini-oauth scope+endpoint+billing 結構性 bug /
gemini API key 不可得 / claude API key 不可得).
Delivery report: `share/engineering_delivery/cycle03-21_v0.55.3-alpha-claude-cli/delivery_report.md`.

### NEW plugin: `@openstarry-plugin/provider-claude-cli`

Wraps Anthropic Claude Code CLI via `claude -p` print mode subprocess. Inherits
Master's existing OAuth/Pro session — **no auth setup required**, **no key
material handled** by the plugin.

- **Path**: `openstarry_plugin/provider-claude-cli/` (new workspace)
- **Five Aggregates**: `IProvider (samjna 想蘊)` — cognitive processing
- **Models**: `sonnet` / `opus` / `haiku` aliases (or full ids)
- **Function calling**: NOT supported (text-only inference; sufficient for W2-R26)
- **LOC actual**: 332 prod (src/index.ts) + 110 test + 105 README + 95 README_TW

### 5-Point Process-Level Isolation Guarantees (CRITICAL; per Master directive 2026-05-03)

Tier-0 critical bug if any guarantee violated:

1. **Fresh subprocess per call** — every `chat()` invocation spawns a brand-new
   `claude` process; no state carry across calls.
2. **`--bare` enforced** — subprocess skips user/project settings, `CLAUDE.md`
   memory, hooks, MCP server discovery.
3. **`--disallowedTools` enforced** — Bash/Read/Edit/Write/WebSearch/WebFetch/
   Grep/Glob/NotebookEdit all disabled. OpenStarry agent loop manages tools.
4. **`--no-session-persistence` enforced** — no session log written to disk.
5. **No settings-file mutation** — plugin NEVER touches `~/.claude/*`,
   `.claude/*`. Communication strictly `argv` + `stdin/stdout` + inherited env.

→ **Master coordinator session and parallel `claude` CLI sessions remain
unaffected** by this plugin's subprocesses.

### Phase 7 Elevation 範本 (second concrete instance)

Per cycle 03-21 §零 R/S/C/G template:
- **R (Refactor)**: NEW plugin (greenfield form; pure plugin layer)
- **S (Spec)**: README EN + TW + manifest
- **C (Compliance)**: MR-6 plugin-only strict; 五蘊 IProvider 想蘊 alignment
- **G (G4-folder-3)**: 4 防線 third enforce period; Rule #78 §78.5 BINDING-tier reflexive TW sibling honoured same-PR-strict

### Tests + Quality Gates

- **278 files / 2960 passed / 3 skipped** (excl 5 pre-existing flakies; +15 new plugin tests)
- provider-claude-cli isolated suite: 15/15 PASS (8 buildArgv + 7 mapStreamEvent; pure-function unit coverage of all 5 isolation guarantees)
- Microkernel purity: PASS (MR-6 baseline preserved; new plugin lives entirely in `openstarry_plugin/`)
- 48 workspaces (+1 provider-claude-cli)

### Compliance

- Rule #62 Tier 1 Bug-fix-ratification (W2-R26 5th unblock; in-flight cycle hotfix)
- MR-6 plugin-only strict (0 Core surface; verified by `pnpm test:purity`)
- Rule #74 L1' code+doc sync (README EN + TW siblings BINDING-tier same-PR-strict per Rule #78 §78.5)
- Rule #75 §75.X 11th consecutive enforcement (all gates exit 0)
- F-16 SHOULD initial FINAL preserved
- ZT-1/2/3 PASS; Tenet #10 9/0/1★ ACTIVE preserved
- Phase 6 trajectory UNCHANGED at 5/7 FUNCTIONAL (hotfix; no advancement)

## [v0.55.2-alpha] — 2026-05-03 — HOTFIX v2: X-Goog-User-Project header (Tier 1 Bug-fix-ratification; second-step)

Cycle 03-21 in-flight hotfix v2 per Master directive 2026-05-03; W2-R26
4th BLOCKER recovery; v0.55.1-alpha hotfix corrected scope but did NOT
catch the missing-header root cause.
Delivery report: `share/engineering_delivery/cycle03-21_v0.55.2-alpha-hotfix-v2/delivery_report.md`.

### Bug (residual after v0.55.1-alpha)

After scope fix to `cloud-platform`, Gemini API still returned 403 on every
inference call. Root cause: `provider-gemini-oauth/src/index.ts callGeminiStream`
omitted the `X-Goog-User-Project` header.

**Google API rule** (cited https://cloud.google.com/apis/docs/system-parameters):
OAuth-authenticated calls to `generativelanguage.googleapis.com` (and most
GCP APIs) MUST include `X-Goog-User-Project: <PROJECT_ID>` header to specify
which GCP project quota is billed against. Without it, Google rejects with
various 403 errors (in this context: `ACCESS_TOKEN_SCOPE_INSUFFICIENT`).

The plugin had `ensureProjectId()` machinery (line 323-355) but
`callGeminiStream` did not consume it. Architectural bug; not exercised by
prior CI tests because the OAuth flow + inference path was never end-to-end
exercised pre-W2-R26.

### Fix (3 site changes within `src/index.ts`)

1. `callGeminiStream` signature gains `projectId: string` parameter; emits
   `X-Goog-User-Project: ${projectId}` header alongside Authorization +
   Content-Type.
2. `chat()` adapter calls `oauthManager.ensureProjectId()` before invoking
   `callGeminiStream`; fails fast with operator-actionable error when null.
3. `chat()` passes `projectId` through to `callGeminiStream`.

### Changes (scope-strict; 3 files in `provider-gemini-oauth/` only)
- `src/index.ts` — X-Goog-User-Project header + ensureProjectId() call site + fail-fast error + 25-line inline comment
- `README.md` — `projectId` config requirement + 3-tier resolution order (env > config > managed-project)
- `README_TW.md` — TW sibling parity update per Rule #78 §78.5

### Migration (Master action — NO re-OAuth-login required this time)

Existing v0.55.1-alpha tokens (cloud-platform scope) work as-is. Master must
configure GCP project ID via ONE of:

1. **env var** (overrides config): `OPENSTARRY_GEMINI_PROJECT_ID=openstarry-491612`
2. **agent.json plugin config**: add `"config": { "projectId": "openstarry-491612" }` to the gemini-oauth plugin entry
3. **Managed-project provisioning**: auto-discovered if `/provider login gemini-oauth` previously provisioned a project

If none resolves, `chat()` emits an operator-actionable error explaining all 3 paths.

### Two-step Hotfix Retrospective (per Rule #62 root-cause discipline)

v0.55.1-alpha addressed an OBSERVABLE root cause (the misconfigured scope
literal) but did not catch the LATENT root cause (the missing header). Both
were necessary; neither was sufficient alone. Lesson: Tier 1 hotfix scope-strict
discipline is correct (small commits, fast turnaround), but root-cause
verification should include "would scope fix alone restore inference?" check
when changes touch authentication paths. Future hotfix workflow may add a
"can the user reproduce the working flow with the fix?" step before tag.

### Hotfix Compliance
- **Rule #62 Tier 1 Bug-fix-ratification** (per cycle 03-13 W2-R9 hotfix precedent; second-step)
- **MR-12 functional preservation**: API surface unchanged; only auth header added + projectId required
- **Rule #74 L1' code+doc sync**: README EN + TW siblings updated
- **Rule #75 §75.X 10th consecutive enforcement**: all gates exit 0
- **Test count unchanged**: 277 files / 2945 passed / 3 skipped (excl 5 pre-existing flakies)

## [v0.55.1-alpha] — 2026-05-03 — HOTFIX provider-gemini-oauth scope (Tier 1 Bug-fix-ratification)

Cycle 03-21 in-flight hotfix per Master directive 2026-05-03; W2-R26 BLOCKER3.
Delivery report: `share/engineering_delivery/cycle03-21_v0.55.1-alpha-hotfix/delivery_report.md`.

### Bug
`provider-gemini-oauth/src/index.ts:34-39` requested OAuth scope
`https://www.googleapis.com/auth/generative-language.tuning` which only
permits **fine-tuning** (training calls), NOT **inference**
(`generateContent` / `streamGenerateContent`). All Gemini OAuth inference
calls failed with HTTP 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT`. Test team
W2-R26 verification blocked.

### Fix
Replaced scope with `https://www.googleapis.com/auth/cloud-platform` (broad;
official Google AI quickstart recommendation; covers `generativelanguage.*`
inference endpoints + future Gemini API expansions).

### Changes (scope-strict; 3 files in `provider-gemini-oauth/` only)
- `provider-gemini-oauth/src/index.ts` — scope replaced + inline comment block
- `provider-gemini-oauth/README.md` — added `## OAuth Scopes` section + migration note
- `provider-gemini-oauth/README_TW.md` — **NEW** TW sibling per Rule #78 §78.5

### Migration (Master action required)
1. Delete cached token: `rm ~/.openstarry/plugins/gemini-oauth/oauth_token.json`
2. Verify Google Cloud Console OAuth client (828092589605-...) whitelist
   includes `cloud-platform`; if not, re-register + rebake `oauth-client.enc.json`
3. Re-run `/provider login gemini-oauth`

### Hotfix Compliance
- **Rule #62 Tier 1 Bug-fix-ratification**
- **MR-12 functional preservation**: API surface unchanged; only OAuth scope corrected
- **Rule #74 L1' code+doc sync**: README EN + TW siblings updated
- **Rule #75 §75.X 9th consecutive enforcement**: all gates exit 0
- **Test count unchanged**: 277 files / 2945 passed / 3 skipped (excl 5 pre-existing flakies)

## [v0.55.0-alpha] — 2026-05-02 — VasanaEngine refactor → plugin form + Mesh Plan58 (Phase 6 第五棒; 雙模組)

Cycle 03-21 Dev FULL delivery on Master Ratification Batch 18 (10/10 APPROVED).
Delivery report: `share/engineering_delivery/cycle03-21_vasana-refactor-mesh-plan58/delivery_report.md`.

### Plan57 amendment — VasanaEngine refactor → plugin form (Phase 7 elevation 先驅範例)

**Form change only** (per cycle 03-21 R3 D-§0 23/0 UNANIMOUS 6 items):
- **Moved**: `apps/runner/src/vasana-engine/` → `openstarry_plugin/vasana-engine/`
- **Function preserved**: 4-method API surface unchanged (`deposit / verify_chain / count / latest_hash`); SICP-canonical Black-box invariant
- **Plugin factory**: `createVasanaEnginePlugin()` per OpenStarry plugin convention; `skandha: 'samskara'` (行蘊)
- **D-§0-B AMEND-3**: plugin-loader onBoot fail-fast (no soft-fail; reject-on-startup via `loadHmacKey` + `verifyChain` at construction)
- **D-§0-B AMEND-1**: dual-barrier disambiguation (outer 4-method consumer surface vs inner container-plugin lifecycle protocol)
- **MR-12 既有不破壞 strict**: HMAC-SHA256 / Boot-time refuse-to-start / 4-contributor → 5-contributor extension / ε-surface 0-delta / existing deposit log entries — all preserved

### Plan58 Mesh — Phase 6 第五棒 implementation

**Architecture (per Plan58 §2 Option B Centralized Hub)**:
- In-process publisher-subscriber broker; routing-table compiled at boot from plugin manifest declarations
- Cycle detection via Kahn's topological sort (D-§1-R2-B)
- Manifest integrity SHA-256 attestation (Plan58 §2.4 verification 7; D-§1-R2-D)
- HMAC-SHA256 verify + nonce cache replay defense (`msh:` prefix; 5th contributor)
- **Forward constraints**: fan-out only this cycle (aggregation deferred to Phase 7; DSS-CY21-§1-D LEIBNIZ aggregation-now preserved); in-process single-host (cross-process Phase 7 forward-binding)

- **SDK additions** `packages/sdk/src/types/mesh.ts` (~50 LOC): `MeshRoutingRuleSchema` + `MeshMessageSchema` + `MeshPublishResultSchema` Zod; `MESH_REPLAY_CACHE_PREFIX='msh:'`; 6-constant failure taxonomy.
- **Plugin layer** `openstarry_plugin/mesh/`:
  - `routing.ts` — `compileRoutingTable` (Kahn's topological sort cycle detection) + `computeManifestIntegrityHash` (SHA-256 canonical serialization)
  - `broker.ts` — `createMeshBroker` (HMAC verify + nonce cache + fan-out delivery; rejects self-cycle deliveries)
  - `plugin.ts` — `createMeshPlugin` factory (`skandha: 'rupa'`; 色蘊 communication channel substrate)
  - `index.ts` — barrel.

### Replay cache 5-contributor structured prefix table

`psh:` (Plan52) + `ac9:` (Plan54) + `mvq:` (Plan56) + `vsn:` (Plan57 plugin form) + **`msh:` (Plan58 Mesh)**.

### Tests + Quality Gates

- **277 files / 2945 passed / 3 skipped** (excluding 5 pre-existing flakies via vitest `--exclude` flags). +23 new tests since v0.54.1-alpha (12 routing + 11 broker; vasana-engine 20 tests preserved through refactor).
- vasana-engine + mesh isolated suite: 43/43 PASS.
- Microkernel purity: PASS (MR-6 baseline preserved).

### Compliance

- VasanaEngine refactor preserves MR-6 Core 零 (relocated within plugin layer; not Core-touched).
- Plan58 Mesh plugin layer at `openstarry_plugin/mesh/`; 0 Core surface; MR-6 PASS.
- ZT-1/2/3 PASS; Tenet #10 status unchanged (MR-5 hard).
- F-16 SHOULD initial **FINAL** preserved (per Batch 18 Item #4; not "advancing", just declaring the carry-forward terminal state).
- Phase 6 trajectory: **4/7 FUNCTIONAL → 5/7 FUNCTIONAL** (this cycle ships Plan58 Mesh).

## [v0.54.1-alpha] — 2026-05-02 — Cycle 03-20 doc-only patch (canonical 265 → 277)

Cycle 03-20 is a **governance/spec patch cycle** per Master directive 2026-04-28
"不實現也要 release". **0 line of code changed**; release contents are
byte-identical to v0.54.0-alpha for `openstarry/` + `openstarry_plugin/`.
Patch increment marks doc-only semantic.

Master Ratification Batch 17 7/7 APPROVED. Delivery report:
`share/engineering_delivery/cycle03-20_doc-only-patch/delivery_report.md`.

### Canonical doc delta (265 → 277, +12 docs)

- 9 TW siblings backfilled per Batch 17 ratified list (cycle 03-20 R-team
  task #136); paired Rule #78 §78.5 BINDING-tier same-PR-strict honoured at
  ratification time.
- Reference/16 amendment doc (cycle 03-20 governance addition).
- Redaction schema v2 candidate doc (cycle 03-20 spec addition).
- CHANGELOG_RESEARCH_TEAM.md cycle 03-20 entry.

### Non-changes (byte-identical to v0.54.0-alpha)

- `agent_dev/openstarry/` source tree: unchanged (verified by `diff -rq`).
- `agent_dev/openstarry_plugin/` plugin tree: unchanged (verified by `diff -rq`).
- All 46 workspace projects: same lockfile, same dependencies.
- Phase 6 trajectory unchanged: **4/7 FUNCTIONAL preserved** (no advancement;
  doc-only patch).

### Tests + Quality Gates (re-verified)

- 275 files / **2922 passed** / 3 skipped (excluding 5 pre-existing flakies;
  identical to v0.54.0-alpha — no code change → no test delta).
- Microkernel purity: PASS.
- `pnpm install --frozen-lockfile && pnpm build && pnpm test && pnpm test:purity`:
  all exit 0 (Rule #75 §75.X 7th consecutive enforcement).

### Canonical openstarry_doc → agent_dev mirror updated

`agent_dev/openstarry/docs/canonical/` re-synced to 277 files byte-identical
to `share/openstarry_doc/`. Existing Dev `docs/EN/` (12) + `docs/TW/` (12)
operational docs preserved untouched as siblings.

## [v0.54.0-alpha] — 2026-05-01 — Plan57 D-30-5 VasanaEngine + γ retrofit canonical helper (Phase 6 第四棒)

Cycle 03-19 Dev FULL delivery on Master Ratification Batch 16 (pending; R3 ratified).
Delivery report: `share/engineering_delivery/cycle03-19_plan57-d305_gamma-retrofit/delivery_report.md`.

### Plan57 D-30-5 VasanaEngine (Phase 6 第四棒; Plan52/Plan54/Plan56 isomorph)

**ε-surface delta vs Plan52 baseline = 0 fields, 0 const** (strict equality;
MR-6 鐵律 verified by `pnpm test:purity` PASS).

Architecture per Plan57 spec §2 — Option C dual-track passive-observer deposit log:
- **Track 1 (THIS cycle IN-SCOPE)**: append-only `vasana_log[]` per agent;
  HMAC-chain integrity (each entry's `prev_hash` = SHA-256 of prior entry);
  boot-time + runtime re-verification; refuse-to-start on chain corruption.
- **Track 2 (DEFERRED to Plan60)**: read-API not implemented this cycle.

5 Yogācāra discipline foreclosure modes preserved: no central registry / no
vasanā-as-entity / no retroactive modification / no current-emit coupling /
no ε-surface extension.

- **SDK additions** (`packages/sdk/src/types/vasana-engine.ts`):
  `VASANA_CATEGORIES` 7-constant enum (intent/preference/aversion HIGH +
  action-trace/observation MED + timestamp/source-ref LOW); `VASANA_SENSITIVITY`
  category-aware map; `VasanaDepositRequestSchema` + `VasanaDepositEntrySchema` Zod;
  4-constant failure taxonomy.
- **Plugin layer** at `apps/runner/src/vasana-engine/`:
  - `hash-chain.ts` — SHA-256 entry hash + HMAC-SHA256 signature + linear
    chain-verify (cycle/tamper detection per §2.2).
  - `engine.ts` — `createVasanaEngine({...})` with 4-method SICP-canonical API:
    `deposit / verify_chain / count / latest_hash` (Track 2 deferred).
  - `index.ts` — barrel.

### γ Retrofit Canonical Redaction Helper (cycle 03-19 R3 D-§4 23/0)

- **SDK additions** (`packages/sdk/src/utils/redaction.ts`): `redactPayload(s, kind)`
  + `isRedactedFormat` predicate; format `<redacted-{volition-payload|vasana-deposit|plugin-payload}> len:NN first4:abcd>`;
  N=4 alphanumeric ceiling; category-aware sensitivity applied at call site.
- **Retrofit register reality** (per `Calibration_Reports/redaction_security_debt.md`):
  Audit confirms current plugin codebase contains 0 user-content-payload log
  emissions outside the Plan56 multi-ivolition module (which already uses
  the canonical format); existing plugin retrofit reduces to **SDK helper deployment**
  for forward-only use. No plugin logic modified per scope-strict R2-08 23/0.
- **DSS-CY18-02 + DSS-CY19-§1-C** (KERNEL N=8 hex preference) preserved per
  MR-11 UNCONDITIONAL.

### Replay Cache 4-Contributor Topology

`vsn:` prefix for Plan57 deposits (per §5 4-contributor structured prefix table:
`psh:` Plan52 + `ac9:` Plan54 + `mvq:` Plan56 + `vsn:` Plan57). Refuse-to-start
on prefix collision; multi-process opt-in inherits cycle 03-17 §5.2 protocol.

### Canonical openstarry_doc Mirror to agent_dev

Per CLAUDE.md "防下輪 stale" convention: 265-file canonical openstarry_doc
mirrored to `agent_dev/openstarry/docs/canonical/` (byte-identical;
preserves existing 12 EN + 12 TW Dev operational docs as siblings).

### Tests + Quality Gates

- **275 files / 2922 passed / 3 skipped** (excluding 5 pre-existing flakies via
  vitest `--exclude` flags). +28 new tests (8 hash-chain + 12 engine + 8 redaction).
- Plan57 + redaction isolated suite: 28/28 PASS.
- Microkernel purity: PASS (MR-6 baseline preserved post-Plan57).
- 5 pre-existing flakies (plugin-installer + guide-persistent timing-sensitive)
  unchanged this cycle.

### Compliance

- Plan57 plugin layer at `apps/runner/src/vasana-engine/`; 0 Core surface;
  MR-6 PASS via `pnpm test:purity`.
- ZT-1/2/3 PASS; Tenet #10 status unchanged (MR-5 hard).
- F-16 SHOULD initial preserved (MR-9; FORBIDDEN-phrasings 6 patterns absent
  per cycle 03-19 R3 OPT-B extend binding).
- Phase 6 trajectory: **3/7 FUNCTIONAL → 4/7 FUNCTIONAL** (this cycle ships code).

## [v0.53.0-alpha] — 2026-04-30 — D-30-4 Plan56 Multi-IVolition (Phase 6 第三棒)

Cycle 03-18 Dev FULL delivery on Master Ratification Batch 15 (12 items).
Delivery report: `share/engineering_delivery/cycle03-18_plan56-d304/delivery_report.md`.

### Plan56 D-30-4 Multi-IVolition (Phase 6 第三棒; Plan52/Plan54 isomorph; Option A)

**ε-surface delta vs Plan52 baseline = 0 fields, 0 const** (strict equality;
MR-6 鐵律 verified by `pnpm test:purity` PASS; ε-surface 7-sub-check inheritance).

Architecture per Master doctrinal annotation 2026-04-29: 產生層（並行 multi-volition
candidates）→ 輸出層（序列 single-stream queue convergence）；no external
arbitrator — convergence by internal dynamics (priority/intensity/context).

- **SDK additions** (`packages/sdk/src/types/multi-ivolition.ts`):
  `VOLITION_CATEGORIES` 4-constant enum (retrieve / verify / track-context /
  surface-failure); `VolitionRequestSchema` + `VolitionEmitResultSchema` Zod;
  9-constant failure taxonomy.
- **Plugin layer** at `apps/runner/src/multi-ivolition/`:
  - `config.ts` — `MAX_VOLITION_QUEUE_DEFAULT=16` (≥8/≤64 safety band);
    `OPENSTARRY_MAX_VOLITION_QUEUE` env override (Item #6 A8); tamper-evident
    HMAC audit log inheriting cycle 03-17 §5.3 pattern.
  - `redaction.ts` — `<redacted-volition-payload len:NN first4:abcd>` codified
    format (Item #3; R3 A4 22/1; N=4 alphanumeric ceiling; category-aware).
  - `queue.ts` — SICP queue-as-stream FIFO; per-cognitive-moment init+drain+discard
    (kṣaṇika emission; no persistent cross-moment state).
  - `dispatch.ts` — `createMultiIVolitionDispatcher({...})` factory; HMAC verify
    reusing Plan52 SDK helpers; Plan54 boot-time refuse-to-start inheritance;
    per-emission parent quota consumption (Item #6 A9; R3 A9 23/0).
  - `index.ts` — barrel.

### 6 BINDING governance/security items (Batch 15 Items #2-#6)

- **#2 Replay cache topology three-contributor**: declared in delivery_report §6
  (Plan52 + Plan54 + Plan56 share via `sharedNonceCache` config; multi-process
  refuse-to-start preserved per cycle 03-17 §5.2 inheritance).
- **#3 Volition-payload redaction format**: implemented in `redaction.ts`;
  forward-only at this delivery (existing plugin retrofit cycle 03-19 scope).
- **#4 Lexical-token re-attestation at v0.52→v0.53 boundary**: 13-token sweep
  PASS; new Plan56 vocabulary (volition/multiIVolition/cetana) lives outside
  `packages/core/src/**` per ε-surface 7-sub-check sub-check 5.
- **#5 Plan52 invariants 3 → 6**: declared in delivery_report §10 (no new
  InputEvent fields / no new sourceContext path / no new event type +
  3 NEW: no new sourceContext metadata field outside `Record<string, unknown>` /
  no new InputEvent timestamp tolerance contract / no new emit-recipient-set semantics).
- **#6 Spec clarification compound (A7+A8+A9)**:
  - A7 Volition replay HMAC nonce keyed → reuses Plan52 `NonceCache` verbatim.
  - A8 `OPENSTARRY_MAX_VOLITION_QUEUE` env override + audit → `config.ts`.
  - A9 Per-emission parent quota consumption → `dispatch.ts processVolitions()`.

### Tests + Quality Gates

- **272 files / 2894 passed / 3 skipped** (excluding 5 pre-existing flaky tests
  via vitest `--exclude` flags). +36 new Plan56 tests (8 config + 9 redaction +
  5 queue + 14 dispatch). Plan56 isolated suite: 36/36 PASS.
- Microkernel purity: PASS (MR-6 baseline preserved post-Plan56).
- 5 pre-existing flakies (plugin-installer + guide-persistent timing-sensitive)
  documented in cycle 03-17 delivery §9.1; unchanged this cycle.

### Compliance

- Plan56 plugin layer at `apps/runner/src/multi-ivolition/`; 0 Core surface;
  MR-6 PASS via `pnpm test:purity`.
- ZT-1/2/3 PASS; Tenet #10 status unchanged (MR-5 hard).
- F-16 SHOULD initial preserved (MR-9; FORBIDDEN-phrasings 6 patterns absent
  per cycle 03-19 R3 binding carry-forward).
- Phase 6 trajectory: **3/7 SPEC → 3/7 FUNCTIONAL** (this cycle ships code).

## [v0.52.0-alpha] — 2026-04-29 — AC-9 Plan54 (Phase 6 第二棒 implementation)

Cycle 03-17 Dev FULL delivery on Master Ratification Batch 14 (12 items;
Master directive 2026-04-29 strict 7-list (i) implementation slot 2/7).
Delivery report: `share/engineering_delivery/cycle03-17_plan54-ac9/delivery_report.md`.

### Plan54 — AC-9 Sub-Agent Composition Candidate A (Phase 6 第二棒; Plan52 isomorph)

**ε-surface delta vs Plan52 baseline = 0 fields, 0 const** (strict equality;
MR-6 鐵律 verified by `pnpm test:purity` PASS).

- **SDK additions** (`packages/sdk/src/types/agent-composition.ts`):
  `LIFECYCLE_STATES` closed enum (5 states); `LIFECYCLE_HOOK_EVENTS` (5 hooks);
  `SpawnChildRequestSchema` + `SpawnChildResponseSchema` Zod-validated; failure
  taxonomy 9-constant enum.
- **`RecommendedSourceContextKeys`** extended forward-only (MR-12) with
  `spawnDepth` + `spawnId` (parentAgentId already present from Plan52).
- **Plugin layer** at `apps/runner/src/agent-composition/`:
  - `config.ts` — `MAX_SPAWN_DEPTH_DEFAULT=4` (R3 D-04 ratified 17/6) + override
    precedence (per-spawn > config > env > default; range 1..16); tamper-evident
    audit trail (Batch 14 Item #6 — HMAC-SHA256 over canonical fields).
  - `quota.ts` — global cap (default 64; env 1..1024) / per-parent cap 8 /
    30s orphan grace window (Plan54 §8).
  - `boundary.ts` — `isDepthAdmissible`, `isCapabilityContained`, `walkLineage`
    with cycle detection.
  - `lifecycle.ts` — state machine `spawned → active → {completed, aborted, orphaned}`
    + handler dispatch (F-13 hook dispatch verifiability extended to AC-9).
  - `spawn.ts` — `createAgentComposer({...})` factory; HMAC-SHA256 verifier
    reusing Plan52 SDK helpers verbatim (CV-§5-04 isomorph).
- **Boot-time refuse-to-start** (Batch 14 Item #3): HMAC key MUST be ≥ 32
  bytes hex (CSPRNG provenance); construction throws on shorter / non-hex.

### 6 BINDING governance/security items (Batch 14 #1-#6)

- **#1 Tri-party MR-6 sign-off**: 4-column GPG-signed attestation table in
  delivery_report §5.
- **#2 ε-surface 5→7 sub-check**: codified in delivery_report §6; all 7 PASS.
- **#3 HMAC+CSPRNG provenance**: implemented in `spawn.ts loadHmacKey()`.
- **#4 Replay cache topology**: declared in delivery_report §7.
- **#5 Lexical-token sweep 13 + frozen baseline**: declared in delivery_report §8.
- **#6 MAX_SPAWN_DEPTH override audit log tamper-evident**: implemented in
  `config.ts buildAudit()` + `verifySpawnDepthAudit()`.

### Tests + Quality Gates

- **270 files / 2871 passed / 3 skipped / 4 pre-existing flaky** (+51 new AC-9
  tests across 5 files: 12 config + 7 quota + 10 lifecycle + 8 boundary + 14 spawn).
- AC-9 isolated suite: 55/55 pass.
- Microkernel purity: PASS (MR-6 baseline preserved post-AC-9).
- 4 flaky tests are pre-existing plugin-installer/guide-persistent timing-sensitive
  cases — pass in isolation; not Plan54-introduced regressions.

### Compliance

- Plan54 plugin layer at `apps/runner/src/agent-composition/`; 0 Core surface;
  MR-6 PASS via `pnpm test:purity`.
- `RecommendedSourceContextKeys` SDK extension is forward-only (MR-12 PASS).
- ZT-1/2/3 PASS; Tenet #10 status unchanged (MR-5 hard).
- F-16 SHOULD initial preserved (MR-9; FORBIDDEN-phrasings 6 patterns absent).
- Phase 6 trajectory: **2/7 SPEC → 2/7 FUNCTIONAL** (this cycle ships actual code).

## [v0.51.1-alpha] — 2026-04-28 — Cycle 03-16 doc-only release (canonical 258 spec snapshot)

Cycle 03-16 is a **governance/spec cycle** per Master directive 2026-04-28
"不實現也要 release". **0 line of code changed**; release contents are
byte-identical to v0.51.0-alpha for `openstarry/` + `openstarry_plugin/`.
Patch increment marks doc-only semantic.

Delivery report: `share/engineering_delivery/cycle03-16_doc_only_release/delivery_report.md`.

### Canonical doc delta (252 → 258, +6 docs ratified Batch 13)

- `Reference/11_Rule_78_TW_Translation.tw.md` — TW sibling for Rule #78 (per §78.8 reflexive application).
- `Reference/13_Plugin_Loader_Cycle03_17_Evaluation_Criteria.md` — explicit re-evaluation criteria for plugin-loader DEFERRED trail (per Plan51 §3.2 coordinator G5 obligation).
- `Reference/14_Chair_Rule_Retrofit_Codification.md` — chair-rule retrofit precedent codification.
- `Research_Methodology/16_F_15_v3_Third_Tier_Amendment.tw.md` — TW sibling for F-15 v3.
- `Technical_Specifications/Plan54_AC9_Binding.md` — AC-9 Authorization Composition spec (Phase 6 trajectory: 1/7 → 2/7 SPEC; implementation cycle 03-17).
- `Technical_Specifications/Plan54_AC9_Binding.tw.md` — TW sibling for Plan54.
- `CHANGELOG_RESEARCH_TEAM.md` cycle 03-16 entry.

### Non-changes (byte-identical to v0.51.0-alpha)

- `agent_dev/openstarry/` source tree: unchanged (verified by `diff -rq`).
- `agent_dev/openstarry_plugin/` plugin tree: unchanged (verified by `diff -rq`).
- All 46 workspace projects: same lockfile, same dependencies.

### Tests + Quality Gates (re-verified)

- 265 files / **2820 passed** / 3 skipped / 0 fail (identical to v0.51.0-alpha).
- Microkernel purity: PASS.
- `pnpm install --frozen-lockfile && pnpm build && pnpm test && pnpm test:purity`: all exit 0 (Rule #75 §75.X re-attested).

### Forward direction

- Plan54 AC-9 implementation lands in **cycle 03-17 v0.52.0-alpha** (Phase 6 functional 2/7).
- plugin-loader DEFERRED trail re-evaluated cycle 03-17+ per Reference/13.

## [v0.51.0-alpha] — 2026-04-27 — Plan51 4-of-5 modules + Rule #78 + F-15 v3 + cycle 03-15 cluster

Cycle 03-15 Dev delivery on Master Ratification Batch 12 (12 items decisioned 2026-04-27).
Delivery report: `share/engineering_delivery/cycle03-15_plan51-rule78/delivery_report.md`.

### Plan51 — Zod Gate × 4-of-5 Modules (GUARDIAN-priority rollout)

- **Shared utility** `apps/runner/src/zod-gate/middleware.ts` — `validateInbound` /
  `assertOutbound` integrating Plan49 `resolveSchemaDriftMode()` dispatcher
  (single-process-global per D-12 UNANIMOUS).
- **Module #1 WebSocket** `openstarry_plugin/transport-websocket/src/zod-gate.ts` —
  `WebSocketInbound` discriminated union (user_input / ping) + `WebSocketOutbound`
  (connected / agent_event / pong / error / auth_rejected). Plan52 opaque
  sourceContext invariant honoured (CV-§5-04 UNANIMOUS): `auth` field nested in
  payload typed as `z.unknown()`; `agent_event.payload` typed as `z.unknown()`.
- **Module #2 checkpoint-store** `apps/runner/src/zod-gate/checkpoint-schemas.ts` —
  Discriminated union over v0.42 / v0.45 / v0.48 / v0.50 + `migrateToV050`
  matrix (D-§5-G cross-version-skew helpers MUST). Read-path graceful
  degradation; distinguishable `checkpoint_schema_violation` vs
  `checkpoint_migration_applied` audit emissions.
- **Module #3 event-bus** `apps/runner/src/zod-gate/event-bus-schemas.ts` —
  `EventEnvelope<T>` + `EventBusSchemaRegistry` + Plan50 σ-emission schema with
  `sigma_regime: z.enum([...])` field (CV-§5-05 invariant). Reflexive-case
  fixture: `event_bus_schema_violation` event itself validates cleanly under
  strict mode.
- **Module #4 hook-registry** `apps/runner/src/zod-gate/hook-registry-schemas.ts` —
  D-§5-E DARWIN Strategy/Registry pattern: `HookRegistration` (Registry,
  STRICT-from-start) + `hookContract<I, O>` (Strategy, audited dispatch).
- **plugin-loader DEFERRED** to cycle 03-17+ post-AC-9 per D-§5-A 9/11/3 (no
  super-majority). Soft sunset anchor cycle 03-21.

### Rule #78 — TW Translation Parity (cycle 03-15 + Sibling-Naming)

- `tools/sibling-naming-check.mjs` — Dev-side `<basename>.<lang>.md` sibling
  presence + structural-fidelity check (heading-count + code-fence count parity).
  Default informational; `--strict` exits non-zero on HIGH/MED. Current Dev
  corpus (12 EN ↔ 12 TW): HIGH=0 MED=0 LOW=0.
- F-15 v3 L3 operational mechanism (`tools/f15_check.py` extension ~130-230 LOC)
  is research-team scope; this delivery contributes the Dev-side narrower check.
- Forward-only per §78.5 + MR-12. Existing pre-cycle-03-15 docs grandfathered
  EN-only.

### Tests

- 265 files / **2820 passed** / 3 skipped / 0 fail.
- New tests: 42 (8 checkpoint + 12 event-bus + 12 hook-registry + 10 WebSocket).
- Microkernel purity: PASS (MR-6 baseline preserved).

### Trial 3/3 Final Extension

Per Master Confirmation §3.2 — dedicated /simplify pass executed (separate from
Plan51 coding). Cumulative-signal schema all fields populated in delivery_report
§9. Forward-only on F-16 SHOULD initial; observation continues.

### Compliance

- Plan51 4 modules sit on `apps/runner/src/zod-gate/` + WS plugin peripheral;
  0 Core surface; MR-6 PASS.
- Cross-version-skew migration helpers MUST (D-§5-G) PRESENT; MR-12 PASS.
- ZT-1/2/3 PASS; Tenet #10 status unchanged (MR-5 hard).
- Rule #75 §75.X §pnpm_build_evidence in delivery_report.

## [v0.50.0-alpha] — 2026-04-26 — Plan50 + Plan52 (4 phases) + cycle 03-14 cluster

Cycle 03-14 Dev FULL delivery on Master Ratification Batch 11 (12 items).
Delivery report: `share/engineering_delivery/cycle03-14_plan50-plan52/delivery_report.md`.

### Plan50 — σ_regime In-Place Annotation

- `packages/sdk/src/types/sigma-regime.ts` — closed enum `SigmaRegime` =
  `'composition_index' | 'llm_variance' | 'mixed'` + `SigmaObservation` (Path-C
  21-field) + `InputSource` declarative attestation contract.
- `openstarry_plugin/spc-monitor/src/sigma-regime.ts` — Hypothesis A inference
  helper, FR-2 AND-conjunct (Rule #77 §77.3), Rule #76 §76.7 caveat trigger
  (verbatim text), atomic-rename migration, runtime serializer-boundary assertion.
- 21 unit tests verify R10/R11/R12 = 0.023753 / R13 = 0.023993 / R14 = 0.023873
  byte-identical preservation. FR-2 dormant under composition_index by construction.

### Plan52 — pushInput Candidate B (Phase 6 first-functional)

- **Phase A SDK (ε-surface + helpers)**: `InputEvent.sourceContext?: Record<string, unknown>`
  added to SDK; `packages/sdk/src/utils/pushinput-helpers.ts` exposes
  `RecommendedSourceContextKeys`, `deepFreeze`, `NonceCache`, `KeyResolver`,
  `computeCapabilityHash`, `buildCanonicalInput`, `formatTokenSig`, `parseTokenSig`.
- **Phase B (transport-http)**: HMAC-SHA256 verifier + `https.createServer` with
  optional mTLS material; per-request `sourceContext` build; F-16 error emission.
- **Phase C (transport-websocket)**: per-message `auth` envelope verification.
- **Phase D (transport-local-cli, NEW plugin)**: UID + GID + PID + ts attestation
  per R3 D-§1-09 (tokenSig MAY-omit at process boundary).
- 33 new tests (Phase A 18 + Phase B 17 + Phase C 8 + Phase D 8 - dedupe);
  NEG-1..NEG-7 adversarial coverage; deepFreeze CP-4 immutability verified.

### F-16 StructuredError (ENG-FAB v1.9 candidate, SHOULD initial)

- `packages/sdk/src/errors/structured-error.ts` — 10-constant closed enum
  + 6-field schema + `verified:` / `inferred:` / `speculation:` prefix-discipline
  + Madhyamaka graceful-degradation parser + builder with field validation.
- 16 unit tests; SHOULD-applied at all Plan52 Phase B/C/D auth-error sites.

### Rule #75 §75.X — pnpm build at release tag (FIRST ENFORCEMENT)

- v0.50.0-alpha is the first §75.X-gated tag (existing v0.20-v0.49.1 exempt per MR-12).
- Pre-tag verification chain `pnpm install --frozen-lockfile && pnpm build && pnpm test && pnpm test:purity`
  PASS; evidence in delivery_report §13.9.

### Cross-OS CI matrix (D-§1-08 UNANIMOUS)

- `.github/workflows/cross-os-ci.yml` — Linux (ubuntu-latest) + Windows
  (windows-latest) matrix; release-tag-gate job emits artefact SHA-256.

### Dev tooling

- `tools/verify-package-deps.mjs` — zero-dep static dependency declaration
  auditor (companion to Rule #75 §75.X). HIGH=4 MED=1 LOW=176 (all HIGH/MED
  pre-existing vitest-hoisting); Phase B/C/D introduced 0 new HIGH/MED.

### F-15 governance front-matter

- Applied to `share/engineering_delivery/cycle03-14_plan50-plan52/delivery_report.md`
  (cycle 03-14 R-stage outputs already adopt the schema per F-15 spec §6).

### Tests

- 261 files / **2778 passed** / 3 skipped / 0 fail.
- Microkernel purity: PASS (MR-6 baseline preserved).

## [v0.49.1-alpha] — 2026-04-24 — Plan49 hotfix (build gate)

### Fixed

- **`apps/runner/package.json`** — missing `zod` dependency declaration.
  `apps/runner/src/schema-drift-policy/index.ts` (Plan49 Follow-on A)
  imports `ZodType` from `zod`, but `apps/runner` did not declare zod as
  a direct dep — the package was only a transitive dep via
  `@openstarry/shared`. `pnpm test` passed (vitest/esbuild module
  resolution bypasses strict TS path resolution), but `pnpm build`
  failed with `TS2307: Cannot find module 'zod'`.
- **`schema-drift-policy/index.ts` line 143** — explicit `ZodIssue`
  annotation on the `.map` callback. Without it, TS inferred `any` for
  the parameter and reported `TS7006: Parameter 'i' implicitly has an
  'any' type` under the runner's strict tsconfig.

### Quality gate gap (root cause)

Dev Plan49 delivery pipeline ran `pnpm test` + `pnpm test:purity` +
`pnpm test:flake-gate` (all green) but **did not run `pnpm build`**
before release. vitest resolution is lenient; TypeScript's `tsc -b`
is not. This blind spot produced a ship-broken release.

### Prevention (Rule #62 follow-up)

Proposed for next-cycle Plan delivery checklist: `pnpm build` becomes
MUST alongside `pnpm test` + `pnpm test:purity` before release tag. A
more durable fix is ENG-FAB v1.8+ elevation (a research-side proposal
in next-cycle R-round). Plan49 delivery_report §Post-Delivery captures
the incident classification.

## [v0.49.0-alpha] — 2026-04-24 — Plan49 W0 + partial W1/W2 + Follow-on A (W1 C49-M3)

### Plan49 Follow-on A (W1 C49-M3 schema-drift central module + call-site migration)

- **schema-drift-policy** (`apps/runner/src/schema-drift-policy/`) — centralised
  3-mode (`tolerant` / `strict` / `audited`) policy for Zod `safeParse`
  boundaries. `resolveSchemaDriftMode()` reads `SCHEMA_DRIFT_MODE` env var
  exactly once at first call (C49-M3g process-global uniformity).
  Audited-mode sink wiring via `setSchemaDriftAuditSink()` for Plan48
  structured-log integration when desired. `SchemaDriftError` thrown only
  in strict mode.
- **Call-site migrations** (3 effective sites in apps/runner):
  - `config-validator.ts` `validateConfig` → IAgentConfig parse now routes
    through the policy (per-issue `path` reporting preserved via
    `SchemaDriftResult.issues`).
  - `permission-validator.ts` `validatePermissionsFile` → ProjectPermissions
    parse migrated.
  - `permission-validator.ts` `validatePluginsFile` → ProjectPlugins parse
    migrated.
- **Retained intentionally**:
  - `permission-validator.ts` `validateConfigFile` ProjectConfig parse —
    kept as-is; has deliberate strict-with-unknown-keys-tolerate hybrid
    semantics that are incompatible with uniform policy. Documented in
    `docs/EN+TW/schema-drift-policy.md` §4.
  - `packages/shared/src/utils/validation.ts` generic `validateInput` —
    kept as-is; `shared` is more foundational than `apps/runner` so
    inverting the dependency direction would violate the architectural
    graph.
- **Spec vs reality** (documented): Plan49 spec enumerated an aspirational
  8-site target (event-bus ×3, checkpoint-store ×2, IAgentConfig ×1,
  WebSocket ×1, hook-registry ×1). Those spec-listed modules do not
  currently invoke Zod `safeParse`; the 8-site enumeration is
  forward-looking. 3 effective migrated sites for v0.49.0-alpha.
- **Tests**: `apps/runner/__tests__/schema-drift-policy/index.test.ts`
  (11 tests PASS — 3-mode + C49-M3g process-global uniformity).
- **Docs**: `docs/EN+TW/schema-drift-policy.md` (Rule #74 L1' 5 sub-checks).
- **MR-6** Follow-on A verdict: **PASS** (zero Core touches; module lives
  under `apps/runner/`; grep confirms zero matches in `packages/core/`).

### Plan49 Follow-on B (C49-M4 purity audit + C49-M1d CI gate + C49-M5b producer telemetry)

- **C49-M4 purity-flag disposition — Path (iii) applied** (not Path (i) / (ii)).
  Root cause: `scripts/check-purity.sh` matched any `@openstarry-plugin` /
  `apps/` substring, producing false-positive flags on error-message strings
  (`agent-core.ts:477`) and documentation comments (`index.ts:85`). Fix is
  outside Core (`scripts/check-purity.sh`) — MR-6 Gate 1 verdict:
  **net-negative (removes false positives), ALLOWED**. Updated script now
  requires real `from "..."` / `import "..."` / `require("...")` clauses to
  register as a violation. `pnpm test:purity` post-fix: **PASS**.
- **C49-M1d CI flake-history gate — delivered as reusable script**.
  `scripts/flake-gate.sh` + `pnpm test:flake-gate` — default 50 iterations of
  the plugin-install test pair, zero tolerance, bails with tail-30 diagnostics
  on first failure. Any CI pipeline can invoke it. Smoke 2/2 iter PASS locally.
- **C49-M5b producer-side WIENER telemetry — wired in spc-monitor**.
  `openstarry_plugin/spc-monitor/src/index.ts` escalation subscriber now
  emits `wiener_threshold_hit` alongside the existing `audit:spc_escalation`
  when a category transitions into `watch` / `warning` / `critical`. Payload
  discriminates `threshold: "L2" | "L3"` (L3 = critical; L2 = watch/warning).
  No threshold VALUE changes (C49-M5e binding preserved). 2 new tests in
  `spc-monitor.test.ts` — positive (emits) + negative (no emission when no
  escalation).
- **Docs updated**: `docs/EN+TW/plugin-install-reliability.md` §5 now
  references `pnpm test:flake-gate`.
- **MR-6 Follow-on B audit**: `grep -rn "schema-drift-policy\|wiener/thresholds\|flake-gate\|check-purity" packages/core/` → 0 matches. Zero Core policy / import edges added.
- **Tests**: 255 files / 2691 passed / 3 skipped (+2 tests vs Follow-on A).

### Plan49 Follow-on C (audit_calc.py + F-15 linter + /simplify trial + release closure)

- **audit_calc.py MVP** (`tools/audit_calc.py` + `audit_calc_core.py` + `audit_calc.lark`): Plan49 §八 F-12 tooling. Implements EBNF v1.1 (3-layer precedence; right-associative `^`), sympy AST-node-by-node evaluation (no string-eval per NFR-6a), tolerance classes per D-23 (sensitivity / probability / proportion), triple-hash tier-invariance per MRB-10, `@tautology` marker per D-25, NFC normalisation + ASCII identifier enforcement per NFR-6c, wall-clock + recursion-depth limits per NFR-6d, NFR-6b file-read gate in `_safe_read` (extension whitelist, symlink defense, size limit). CLI: `verify` + `self-check` subcommands with contract exit codes 0/1/2. Plan49 ships the tool; Plan50+ enables F-12 enforcement.
- **audit_calc conformance tests** (`tools/tests/test_audit_calc.py`): 19 pytest cases covering parse, evaluate (including `10^-4` negative-exponent regression), whitelisted-function dispatch, tolerance class table, zero-expected fallback, non-finite rejection, hash determinism, `@tautology` marker detection, and NFR-6a source-grep enforcement (no forbidden `sympy.sympify` / `eval` / `parse_expr` in source). All 19 PASS.
- **F-15 linter** (`tools/f15_check.py`): scans markdown for `<!-- F-15 front-matter :: claim-id=X -->…<!-- /F-15 -->` blocks and verifies presence of Code-read / Author-intent / Alt-hypothesis-1 / Alt-hypothesis-2 / Second-reviewer / GN.2-ref per Plan49 §1.8 + D-15 + D-17. Handles `Claim: N/A` vacated-block pattern. Verified against Plan49 `delivery_report.md` — all blocks complete.
- **/simplify trial (Option B, Master 2026-04-24)**: run against 11 Plan49-authored files (apps/runner + openstarry_plugin + scripts + tools; Core + test files HARD-EXCLUDED). 3 parallel review agents (reuse / quality / efficiency). 7 high-value findings applied: removed dead `parseZodErrors` in config-validator; replaced hand-rolled `formatIssueList` with `formatZodError` from `@openstarry/shared`; lookup-table for level→threshold in spc-monitor (removed stringly-typed OR + ternary); extracted `resolveInstallPaths()` helper in plugin-installer (de-duplicated 3x option resolution); swapped manual `process.pid`-tmpdir for Node's built-in `mkdtemp(prefix)`; removed unused `os` import in audit_calc.py + audit_calc_core.py; static-imported `readdirSync` (was dynamic). 4-criteria verdict: **4/4 PASS** (0 regression, ≥50% non-trivial adopted, zero Core touches, review <1h).
- **Release snapshot**: `release/cycle03-13_v0.49.0-alpha/` generated via `scripts/create-release-v0.49.0-alpha.mjs` — 3-folder source-only mirror (openstarry + openstarry_plugin + openstarry_doc), no `node_modules` / `dist` / `tsbuildinfo` / `pnpm-lock.yaml` / `__pycache__`.
- **Final test status**: 255 files / 2691 passed / 3 skipped (pnpm); 19 passed (pytest); purity PASS.
- **MR-6 final**: `grep -rn "schema-drift-policy\|wiener/thresholds\|flake-gate\|check-purity\|audit_calc\|f15_check\|plugin-install-reliability" packages/core/src/` → **0 matches**. Cumulative Plan49 Core-import-surface delta: **0**.

### Cumulative v0.49.0-alpha scope

Plan49 Cycle 03-13 scope is 36 sub-items across 3 Waves. This release ships
**W0 fully** (C49-M1 plugin-install flaky + C49-M6 Plan48 runtime
confirmation) plus **selected W1/W2 items** (C49-M5 WIENER thresholds
preparation + C49-M7 audit:completed doc artefact). See
`share/engineering_delivery/cycle03-13_plan49/delivery_report.md` for the
full DONE / PARTIAL / DEFERRED breakdown.

### Added

- **wiener/thresholds** (`apps/runner/src/wiener/`) — centralised
  `L2_THRESHOLD`, `L3_THRESHOLD`, `MIN_N_FOR_RECAL`, and
  `WIENER_THRESHOLD_HIT_EVENT` with HYPOTHESIS-status comment block
  (C49-M5a, C49-M5e, C49-M5f). MR-6 Gate 2 verdict ALLOWED
  (refactor-internal to `apps/runner/`, no new Core import edge).
  Sub-items: C49-M5a (module), C49-M5c (docs EN+TW), C49-M5e (no value
  tuning), C49-M5f (MR-6 audit), C49-M5g (σ-deterministic transparency
  disclaimer — MUST-unconditional per D-13 20/3).
- **plugin-install reliability** — root-cause analysis + fix for Windows
  intermittent plugin-install races (C49-M1). `InstallOptions.installedDir`
  + `OPENSTARRY_INSTALL_DIR` / `OPENSTARRY_LOCK_PATH` env-var fallbacks
  isolate per-test install targets; collision-proof npm-pack tmpdir
  naming. Sub-items: C49-M1a (root cause), C49-M1b (fix; 5-iter ×
  17-test smoke PASS), C49-M1c (regression test), C49-M1e (docs EN+TW).
- **plugin-gear-arbiters doc** (`docs/EN/plugin-gear-arbiters.md`) —
  canonical Architecture artefact clarifying `gear-arbiter-dynamic` by-design
  null-output contract (`riskCategory === undefined` is intended; NOT a
  silent failure). O4 from D-11 UNANIMOUS O3+O4 composite. Sub-item:
  C49-M7e.

### Changed

- `apps/runner/src/utils/plugin-installer.ts` gained `installedDir` option
  on `InstallOptions`; `DEFAULT_INSTALLED_DIR` exported as the backward-
  compatible default. `installPlugin` / `uninstallPlugin` / `installAll`
  resolve install dir + lock path via `option → env var → module default`
  precedence so parallel test files no longer race on
  `~/.openstarry/plugins/installed/` (C49-M1b root-cause fix).
- npm-pack fallback tempdir naming: `openstarry-install-${pid}-${ms}-${rand6}`
  (was `openstarry-install-${ms}`) to eliminate intra-process same-millisecond
  collisions.

### Deferred

- **W1 C49-M2 StateTracker fate**: 3-channel audit finding recorded
  (`getCategoryCounts()` plural form does not exist in baseline; `StateTracker`
  lives in `openstarry_plugin/gear-arbiter-dynamic/` and is actively used).
  No deprecation or deletion warranted; documented as no-op (see
  delivery_report §5).
- **W1 C49-M3 schema-drift central module + 8-site migration** — not
  started this delivery; the largest single W1 item (100-150 prod + 50-80
  test LOC). Scope held for a Plan49 follow-on task.
- **W1 C49-M7a** `riskCategory` field on `audit:completed` — field already
  exists since Plan32 Wave 5 P0 (`ConfidenceAuditEntry.riskCategory`,
  `GearEvaluation.riskCategory`); no +8 LOC code change applied in this
  delivery. Consumer forward-compat audit (C49-M7f) reported in
  delivery_report §7.
- **W2 C49-M4 purity-flag trajectory audit + disposition** — not started
  this delivery. Held for follow-on.
- **W2 C49-M8 F-15 tooling scaffold (contingency option v)** — not
  implemented in code; delivery_report carries the F-15 front-matter
  blocks manually (§5).
- **audit_calc.py (§八 F-12 tooling)** — 300-500 LOC Python tool not
  delivered this release. Held for follow-on task.
- **/simplify trial** — not run in this delivery. Delivery_report records
  the "not-run" status in §11.

### Binding references

- `share/research_team_suggestion/cycle03-13/deliver/O2_plan49_engineering_spec.md` (1033 LOC full spec)
- `share/research_team_suggestion/cycle03-13/todo/Plan49_dev_spec.md` (323 LOC Dev-facing)
- `share/research_team_suggestion/cycle03-13/openstarry_doc/Technical_Specifications/Plan49_MR6_Conditional_Gates.md`
- R3 decisions: D-01(20/3) · D-10(18/5) · D-11(UNANIMOUS) · D-12(UNANIMOUS) · D-13(20/3) · D-14(UNANIMOUS) · D-17(20/3)
- MR-6 · MR-9 · MR-11 · MR-12 · F-15 (immediate)

## [v0.48.0-alpha] — 2026-04-23 — Plan48 δ-closure

Plan48 MUST-only scope (δ audit-channel closure + E-5 MUST elevation via
D-14c dual-track). 25 atomic acceptance criteria binding per MRB-11.

### Added

- **structured-log** (`apps/runner/src/structured-log/`) — self-built,
  zero-external-dep JSON-line writer with ring-buffer back-pressure,
  level filter (`LOG_LEVEL`), and SIGTERM/SIGINT sync flush.
  Sub-items: C48-M1a / M1b / M1c / M1d / M1e.
  Docs: `docs/EN/structured-log.md` + `docs/TW/structured-log.md`
  (Doc 78 candidate).
- **audit-sink** (`apps/runner/src/audit-sink/`) — runner-side
  subscriber for `capability_denied` + `ws_connection_denied` events,
  (timestamp, event_hash) dedup, JSONL journal at `AUDIT_SINK_PATH`
  (default `<data_dir>/audit-trail.jsonl`).
  Sub-items: C48-M2a / M2b / M2c / M2d / M2e / M2f / M2g.
- **hmac-cleanup** (`apps/runner/src/hmac-cleanup/`) — E-5 MUST
  closure pattern + env-var zeroing + ephemeral key-source policy
  (within-process scope per D-12b). Shutdown hook at
  `SHUTDOWN_ORDER.HMAC_CLEAR_AND_SIGN` (400).
  Sub-items: C48-M3a / M3b.
  Docs: `docs/EN/hmac-compliance.md` + `docs/TW/hmac-compliance.md`
  (C48-M3c) + `docs/EN/hmac-key-rotation-architecture.md` +
  `docs/TW/hmac-key-rotation-architecture.md` (§4 design-spec only
  per D-17a).
- **audit-infra** (`apps/runner/src/audit-infra/`) — W0 shared
  utilities: `BufferedWriter`, `isoTimestamp()`, `envInt`/`envString`,
  `createShutdownHookRegistry()` with `SHUTDOWN_ORDER` constants.

### Changed

- None (Plan47 interfaces frozen; Plan48 is strictly additive).

### Deferred

- HMAC key rotation runtime (per D-17a; design spec only in Plan48).
- Non-MUST items carried to Plan49 SHOULD spec.

### Binding references

- `share/research_team_suggestion/cycle03-12/deliver/O5_Plan48_scope_and_engineering_spec.md`
- `share/research_team_suggestion/cycle03-12/openstarry_doc/Calibration_Reports/17_Plan48_25_SubItems_Binding.md`
- R3 decisions: D-01(c) · D-12(b) · D-14(c) · D-15(b+c) · D-17(a) · D-18(a)
- MR-5 / MR-6 / MR-10 / MR-12 · ZT-1 / ZT-2

## [v0.47.0-alpha] — 2026-04-19 — Plan47 K-3 wire-in

See `share/engineering_delivery/cycle03-11_plan47/delivery_report.md`.
