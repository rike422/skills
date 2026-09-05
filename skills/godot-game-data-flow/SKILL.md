---
name: godot-game-data-flow
description: Design, audit, and refactor Godot game-state and data flows when ownership, mutation paths, update order, managers, signals, UI synchronization, or cross-scene communication are unclear. Establish authoritative state, commands, events, queries, lifecycle, expected scale, and migration triggers before choosing local calls, signals, feature buses, Autoloads, state machines, or stores. Excludes isolated signal-syntax changes with no ownership question.
---

# Godot Game Data Flow

Make gameplay state changes traceable from intent through commit to observation. Decide who owns data and how long it lives before selecting a Godot communication mechanism.

## Core model

Use this default direction:

```text
Input / UI / AI
    -> intent or command
Authoritative owner
    -> validate
State mutation and required derived updates
    -> commit invariants
Domain event
    -> presentation, audio, logging, persistence scheduling, integrations
```

- Give each authoritative datum one owner and one mutation boundary.
- Let callers request change through command-style methods. Do not expose writable canonical collections.
- Publish fact-style events only after the owner has committed every invariant needed by observers.
- Do not make domain correctness depend on signal connection order, deferred timing, or which observer exists.
- Treat queries as reads from the owner, a read-only snapshot, or an explicitly owned projection.
- Keep presentation, animation, input-buffer, and per-frame physics state local unless their required lifetime proves otherwise.
- A bus transports events. It does not become the source of truth merely because it is globally reachable.

## Required workflow

1. Inventory the flow before changing it. Find assignments, mutating methods, setters, signal emissions and connections, bus calls, Autoload access, scene ownership, Resources, tests, and persisted forms for the state in scope.
2. Classify each datum as authoritative domain state, derived domain state, presentation state, transient runtime state, configuration, or persisted/external representation.
3. Identify its current writers, readers, invariants, update phase, and lifetime. If more than one object appears authoritative, resolve that conflict before adding another path.
4. Assess current scope and evidenced future demand using [scope-and-horizon.md](references/scope-and-horizon.md). Design for current and committed requirements; record a migration trigger for speculative growth.
5. Define commands, the atomic commit boundary, events, and queries using [state-ownership-and-flow.md](references/state-ownership-and-flow.md).
6. Select local wiring, explicit injection, groups, a feature-scoped event hub, or an application event bus using [communication-topologies.md](references/communication-topologies.md). Select communication last, not first.
7. For an existing tangled flow, migrate one coherent state slice using [audit-and-migration.md](references/audit-and-migration.md). Remove superseded writers and duplicated truth in the same approved change.
8. Verify owner invariants, event timing, lifecycle cleanup, reconstruction after scene changes, and behavior with observers absent or reordered.

For a review or design request, stop after reporting the model, risks, and migration plan. Do not mutate code unless implementation was requested.

## Scale is evidence, not project size

Choose the smallest design that covers both:

- **Current:** behavior and consumers present now.
- **Committed:** approved or otherwise concrete near-term consumers, lifetimes, integrations, or requirements represented by repository evidence or the user.

Do not build infrastructure for merely **speculative** possibilities. Record the observable condition that would justify migration instead. Conversely, do not ignore committed fan-out or independent lifetimes just because only one consumer is wired today.

Apply the same scope assessment to more than EventBus selection:

- local member vs feature model vs session-wide owner;
- boolean/enum vs explicit state machine;
- direct mutation method vs command handler/coordinator;
- compute-on-read vs owned projection/cache;
- immediate update vs explicit transaction/batch;
- scene snapshot vs save repository;
- primitive parameters vs a cohesive typed command/event/value contract.

Scale alone never mandates a larger pattern. Consistency, lifetime, topology, change pressure, traceability, and update frequency decide together.

## Communication levels

### Local ownership

Use owner-managed direct calls and signals when participants share a stable owner and compatible lifetime. The owner calls owned objects and connects their emitted facts. This is the default for reusable scenes.

### Feature scope

Use a feature root, mediator, or feature-scoped event hub such as `MatchEvents` when committed fan-out, dynamic participants, or differing lifetimes make point-to-point wiring costly, but the events still belong to one bounded gameplay feature.

### Application scope

Use an application event bus when an event has application-wide meaning, crosses scene boundaries, has independently lived consumers, and has no suitable common feature owner. Prefer domain-specific channels or bridges over an unbounded `Events` dumping ground.

EventBus is a first-class option, not an automatic fallback and not an automatic upgrade. See [communication-topologies.md](references/communication-topologies.md) for its contract and failure modes.

## Required design record

For each nontrivial flow, establish enough of this record to make the decision reviewable. Keep the user-facing form proportional to the task.

```text
Responsibility:
Authoritative owner:
Allowed writers:
Readers:
Invariants and commit boundary:
Lifetime and update phase:

Current requirements:
Committed requirements:
Speculative possibilities:

Selected design level and mechanism:
Rejected alternatives:
Events and queries after commit:
Migration trigger:
Verification:
```

For an audit, also provide a state-ownership matrix, the current and target mutation flow, ordering or lifecycle hazards, and an incremental migration sequence.

## Non-negotiable failure checks

- Multiple independent writers for one authoritative datum.
- UI, animation, audio, logging, or analytics mutating domain truth.
- An event emitted before the state it describes is internally consistent.
- Domain mutations distributed across unordered signal callbacks.
- A bus that stores mutable domain state or serves as an implicit service locator.
- A monolithic global bus mixing unrelated feature contracts.
- Duplicated state with no named synchronization owner.
- Deep upward or sibling scene-tree traversal used as an architectural dependency.
- Transient per-frame state promoted globally without a lifetime requirement.
- A minimal local design that ignores concrete committed consumers.
- Infrastructure justified only by hypothetical future requirements.

## Related skills

Use related skills only when available and when the selected design reaches their concern:

- `godot-signal-architecture` for typed signal declarations, connection mechanics, flags, and listener cleanup after topology is chosen.
- `godot-state-machine-advanced` when transition structure, rather than state ownership alone, warrants an FSM or HSM.
- `godot-autoload-architecture` when an owner or bus genuinely needs application/session lifetime.
- `godot-resource-data-patterns` for Resource-based models and typed shared data.
- `godot-save-load-systems` for persistence boundaries and restoration.
- `design-contract-first` when fixed-schema Dictionaries, overlapping DTOs, commands, events, or context objects obscure the canonical contract.

The absence of a related skill must not block this workflow; keep the ownership and flow decision self-contained.

## Sources

- [Godot: Scene organization](https://docs.godotengine.org/en/stable/tutorials/best_practices/scene_organization.html)
- [Godot: Using signals](https://docs.godotengine.org/en/stable/getting_started/step_by_step/signals.html)
- [Godot: Autoloads versus regular nodes](https://docs.godotengine.org/en/stable/tutorials/best_practices/autoloads_versus_regular_nodes.html)
- [KidsCanCode: Node communication](https://kidscancode.org/godot_recipes/4.x/basics/node_communication/index.html)
- [Game Dev Artisan: Call Down and Signal Up](https://gamedevartisan.com/tips/call-down-signal-up)
- [GDQuest: Signal best practices](https://www.gdquest.com/library/signals_good_practices/)
- [GDQuest: Events bus singleton](https://www.gdquest.com/tutorial/godot/design-patterns/event-bus-singleton/)
