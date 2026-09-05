# State Ownership and Flow

## Classify state before moving it

| State kind | Typical owner | Notes |
|---|---|---|
| Authoritative domain state | Domain object, aggregate, or feature owner | Enforces invariants and accepts commands. |
| Derived domain state | Same commit boundary or named projection | Never let callback order determine it. |
| Presentation state | Control/view/presenter | Hover, focus, expanded rows, animation progress. |
| Transient simulation state | Physics/gameplay object | Velocity, contact cache, frame-local intent. Keep near the update loop. |
| Configuration | Resource or typed immutable-like value | Shared configuration is not mutable runtime truth. |
| Persisted representation | Save boundary/repository | Convert to/from the runtime owner; do not let serialized Dictionaries become the domain API. |

The best owner is the object that can enforce the datum's invariants for the required lifetime. It is not necessarily the closest Node, current UI, most global manager, or easiest object to access.

## Commands, events, and queries

### Command

A command requests behavior from a known authority. Name it imperatively and allow rejection.

```gdscript
var result: LineupChangeResult = career_state.move_player(from_slot, to_slot)
```

The command boundary validates inputs and owns the mutation sequence. A signal such as `move_player_requested` may carry UI intent to a controller, but it must still resolve to one authoritative command handler.

### Event

An event reports a fact after commit. Name it as something that occurred.

```gdscript
signal player_moved(player_id: int, from_slot: int, to_slot: int)
```

Observers may update presentation, logs, projections, save scheduling, or external integrations. They must not complete invariants that should already be true when the event is observed.

### Query

A query returns current state without granting mutation authority. Prefer typed values, read-only views, or defensive copies at boundaries. In GDScript, returning a mutable `Dictionary` or `Array` can expose the original collection, so make ownership semantics explicit.

An event does not guarantee that a late subscriber knows current state. On connection or scene reconstruction, initialize from a query/snapshot and then observe subsequent events.

## Commit sequence

Use an explicit sequence for each domain mutation:

```text
validate command
    -> mutate canonical fields
    -> update required derived fields
    -> assert invariants
    -> commit/revision increment if used
    -> emit fact event
```

If updates span multiple authoritative owners, use an explicit coordinator or transaction-like process. Do not distribute the ordered steps among signal subscribers.

Persistence commonly reacts after commit, but distinguish “save requested/scheduled” from “save completed.” A failed external write must not retroactively make an already committed domain event false unless the domain explicitly requires transactional persistence.

## Derived state

Choose one of three forms:

1. Compute on read when cheap and needed by few readers.
2. Update inside the same owner and commit boundary when it is part of the aggregate invariant.
3. Maintain a named projection when it serves another lifetime or read model and can be rebuilt from authoritative state.

Do not maintain the same score, lineup, balance, or match phase independently in UI, commentary, save data, and domain objects. UI may cache rendered text or selection state; it must refresh from an authoritative value or projection.

## Update phases and frequency

- Keep physics truth in the appropriate physics owner and `_physics_process()` phase.
- Keep visual interpolation and animation progress in presentation owners unless gameplay rules explicitly consume them.
- Avoid high-frequency global signals for per-frame vectors, transforms, or animation progress. Prefer local reads, direct calls, shared buffers, or lower-frequency committed facts.
- If a deferred call is required for engine safety, do not confuse deferred execution with a domain ordering guarantee.

## Typed contracts

Use typed signals and method signatures. When a command or event gains several cohesive fields, crosses a feature/persistence/network boundary, or must carry validation/version semantics, introduce a typed `RefCounted`, `Resource`, or other project-standard value type.

Keep payloads sufficient but not authority-bearing:

- An event may contain identifiers and committed values needed for a reaction.
- An event should not expose a mutable canonical collection.
- A consumer needing broader current state should query its owner rather than treating old event payloads as the database.

## Invariants to test

- Only the authoritative path changes the datum.
- Invalid commands leave all canonical and derived state unchanged.
- Events observe fully committed state.
- Reordering or removing observers cannot change domain results.
- Recreated scenes initialize correctly without needing historical events.
- Save/load reconstructs the same authoritative and derived values.
- UI actions cannot bypass domain validation.
