# Scope and Horizon

Use this assessment before choosing an architectural pattern. “Small” and “large” describe the flow's operational demands, not the repository's line count or team size.

## Evidence inventory

Inspect evidence in this order:

1. Current production paths, tests, scenes, and persisted data.
2. User-stated approved requirements and repository artifacts for scheduled work.
3. Concrete but not yet connected consumers, adapters, or scene lifecycles.
4. Comments or ideas with no approved caller or lifecycle.

Classify each requirement:

- **Current:** exists in the active path and must work now.
- **Committed:** explicitly approved, scheduled, or represented by concrete code/contracts. Include it in the target architecture even if wiring is incomplete.
- **Speculative:** plausible but unsupported by a concrete consumer or decision. Do not implement it. Record a migration trigger if it would materially change the design.

Do not downgrade user-stated committed work to speculation. Do not upgrade a TODO, generic extensibility wish, or imagined multiplayer/replay/mod requirement without evidence.

## Decision dimensions

Assess these dimensions together:

| Dimension | Questions |
|---|---|
| Ownership scope | Does the state belong to one object, scene, feature, match/run, career/session, or application? |
| Lifetime | Are producer, owner, and consumers created and destroyed together? Does state survive scene replacement? |
| Topology | Is the flow one-to-one, fan-in, fan-out, or many-to-many? Are participants dynamic? |
| Consistency | Which mutations must commit atomically? Can observers tolerate eventual refresh? |
| Ordering | Is order part of domain logic, or should reactions be independent? |
| Change pressure | Which concrete consumers or variants are committed next? How often does topology change? |
| Traceability | Can a maintainer find the writer, event source, and connection owner with repository search? |
| Frequency | Is this an occasional domain event or per-frame/high-volume data? |
| Boundary | Does it cross scene, feature, save, platform, thread, or network boundaries? |

No single count decides the pattern. Ten stable children under one scene owner may remain local. Two consumers with independent application lifetimes may justify an application channel.

## Design levels

### Local

Prefer local design when ownership is obvious, participants share lifetime, topology is stable, and a common owner can wire the relationship.

Typical choices:

- members or scene-local Resources;
- direct commands and local signals;
- compute-on-read derived values;
- bool/enum for genuinely simple transitions;
- scene-level tests.

### Feature

Prefer feature scope when the data and events form a bounded capability, participants vary within that capability, or committed fan-out makes local point-to-point wiring hard to maintain.

Typical choices:

- `MatchState`, `CareerState`, or another feature owner;
- feature root or coordinator;
- feature-scoped event hub;
- typed commands/events/results;
- owned projections for repeated or expensive derived reads;
- explicit FSM when transitions and guards are substantial;
- feature integration tests.

### Application

Use application scope only for responsibilities whose meaning and required lifetime are application-wide.

Typical choices:

- session- or save-lifetime authoritative owners;
- application event channels or bridges between bounded features;
- persistence repositories and platform adapters;
- system-flow tests.

Application scope increases the search space for failures. Global reachability is not evidence of global responsibility.

## Applying the assessment to design techniques

### Event topology

Escalate from local wiring to a feature hub when committed fan-out, dynamic membership, or lifetime differences make owner-managed connections materially complex. Escalate to an application bus only when the event itself crosses feature and scene lifetimes.

### State machines

Use bools or enums while transitions are few and invariants remain obvious. Introduce an FSM when committed states, guarded transitions, entry/exit behavior, or invalid-transition prevention make the transition graph a real responsibility. Use hierarchy only when shared behavior or nested transitions are concrete.

### Coordinators and transactions

Keep a mutation in the owner while it changes one aggregate. Introduce a coordinator or process manager when one committed use case must order changes across multiple authoritative owners. Do not use observer order as orchestration.

### Projections and caches

Compute derived values when cheap and local. Own a projection when multiple readers require the same expensive or differently lived view. Name its source event and rebuild strategy. A cache is not a second authority.

### Contracts

Use typed parameters for small cohesive calls. Introduce a typed command, event, result, or value object when fields share invariants/lifetime, cross a boundary, or are already expanding across committed callers. Do not replace a fixed-schema Dictionary with another weak bag.

### Persistence

Keep transient state out of saves. Add snapshot/repository boundaries when state must survive its in-memory owner. Restoration must rebuild derived state or projections deterministically rather than replaying UI callbacks.

## Migration trigger

A trigger must be observable and architecture-relevant:

```text
Reassess local goal wiring when a committed consumer has an independent
lifetime or when goal facts must cross the Match feature boundary.
```

Avoid vague triggers such as “when the project grows.” State which dimension changes: ownership scope, lifetime, topology, consistency, frequency, or boundary.

## Decision record

```text
Current evidence:
Committed horizon:
Speculative ideas:
Relevant dimensions:
Selected level:
Why it covers the horizon:
Why a smaller level fails:
Why a larger level is premature:
Migration trigger:
```
