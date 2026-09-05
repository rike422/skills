# Audit and Migration

Use this workflow when state updates already span managers, UI, signals, Autoloads, Resources, or scene callbacks.

## 1. Bound one state slice

Choose one responsibility such as match score, match phase, lineup, stamina, currency, or season completion. Do not begin by replacing every manager or introducing a project-wide store.

Record the user-visible behavior and invariants that must survive. Note whether adjacent flows must change to complete the migration; if that exceeds approved scope, present the required boundary before editing.

## 2. Trace the current graph

Search scripts and scenes for:

- field assignments, setters, collection mutation, and returned mutable collections;
- command-like methods and their callers;
- signal declarations, emissions, connections, and editor connections in `.tscn` files;
- re-emitted/bubbled signals;
- Autoload and EventBus access;
- duplicated UI, cache, Resource, and save representations;
- scene construction, teardown, reconnect, and restoration paths;
- tests and fixtures that encode update order.

Produce a compact graph:

```text
producer -> request -> writer -> changed data -> notification -> consumer
```

Mark every hidden edge: scene-tree lookup, global access, shared mutable container, callback side effect, or implicit ready/process ordering.

## 3. Build the ownership matrix

| Datum | Current writers | Readers | Invariants | Lifetime | Proposed owner |
|---|---|---|---|---|---|

If several candidates exist, choose the one that naturally enforces invariants and survives for the required lifetime. Do not choose a coordinator merely because it already sees all objects; coordination and ownership are different responsibilities.

## 4. Separate intent, commit, and reaction

For the target path, specify:

- **Intent:** what the input/UI/AI requests.
- **Command:** which owner API validates the request.
- **Commit:** which fields and derived values become consistent together.
- **Event:** what fact is published afterward.
- **Queries:** how readers initialize or refresh.

If standings must update before rewards, either one owner commits both or an explicit coordinator calls authoritative operations in order and publishes only after the combined use case succeeds. Never fix this by rearranging signal connections.

## 5. Assess scope and horizon

List current and committed consumers, their lifetimes, and boundaries. Choose local, feature, or application topology from evidence. Record speculative ideas separately and write a concrete migration trigger.

This step prevents both failure modes:

- preserving a tiny point-to-point path despite known near-term fan-out;
- building global infrastructure for imagined consumers.

## 6. Migrate one production path

Prefer this sequence:

1. Add or clarify the authoritative owner API and invariant tests.
2. Route every in-scope writer through it.
3. Commit derived domain state within the authoritative sequence.
4. Emit typed facts after commit.
5. Initialize readers from queries/snapshots, then subscribe for later facts.
6. Move UI, audio, commentary, logging, and persistence scheduling to reactions.
7. Remove old writer methods, writable collection exposure, duplicate truth, compatibility buses, and ordering-dependent callbacks.
8. Verify scene recreation, load/restore, absent observers, and reordered listeners.

Do not leave two mutation paths “temporarily” unless a real external compatibility constraint requires it. If compatibility is required, name its callers, owner, removal condition, and deadline.

## 7. Review the diff

Check every changed file and confirm:

- exactly one authoritative writer remains;
- the owner, not an adapter or UI, validates domain rules;
- all events are true when observed;
- domain results are identical with observers removed or reordered;
- the selected topology covers committed consumers;
- no unrelated refactor entered the change;
- duplicate state and superseded paths were removed;
- tests cover invalid commands, committed updates, event timing, and reconstruction.

## Audit report template

```text
Scope:
Observed failure:

Current ownership matrix:
Current mutation graph:
Hidden dependencies and ordering hazards:

Current requirements:
Committed horizon:
Speculative ideas:

Target owner and invariants:
Command / commit / event / query contracts:
Selected topology:
Rejected alternatives:
Migration trigger:

Migration slices:
Verification:
Out-of-scope follow-up:
```
