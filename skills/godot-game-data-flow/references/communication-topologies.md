# Communication Topologies

Choose topology after ownership, lifetime, consistency, and horizon are known.

## Selection table

| Situation | Prefer | Avoid |
|---|---|---|
| Owner starts behavior in an owned child | Direct typed method call | Command-shaped signal sent downward |
| Reusable child reports a fact | Child signal connected by owner | Child discovering ancestors with `get_parent()` chains |
| Stable one-to-one collaborators | Explicit reference or dependency injection | Global lookup for convenience |
| Siblings under a common owner | Owner mediates/connects | Sibling path traversal |
| Dynamic set of similar Nodes | Group, registry, or owner-managed collection | One hard-coded path per instance |
| Bounded feature with committed fan-out | Feature mediator or scoped event hub | Application-wide catch-all bus |
| Cross-scene fact with independent consumers | Application event bus or explicit feature bridge | Re-emitting through many scene layers |
| Ordered multi-owner domain operation | Coordinator/process manager | Depending on signal callback order |
| High-frequency runtime data | Local read/call/buffer | Global signal stream every frame |

## Local calls and signals

Godot scenes are most reusable when they do not assume an external tree shape. The owning context may call owned children, inject dependencies, and connect child facts to interested peers. The important direction is ownership, not a literal rule that every child must signal every parent.

Signal names normally describe events that occurred. A request signal from UI can express observed intent (`lineup_change_requested`), but it is not the authoritative mutation. Route it to the owner command boundary.

## Groups and registries

Groups are useful for dynamic sets and cross-cutting discovery. They are tags, not state owners. Use a typed registry or feature owner when membership itself has domain meaning, ordering, or invariants.

## Feature-scoped event hub

A feature hub is owned and named by a bounded gameplay capability:

```text
MatchFlow
  - MatchState
  - MatchEvents
  - HUD adapter
  - Commentary adapter
  - Replay adapter
```

It is justified when current or committed consumers have meaningful fan-out or different creation times, but the events remain inside the feature. It may be a child Node, injected object, or feature-owned service; it need not be an Autoload.

Prefer domain names such as `MatchEvents` or `CareerEvents`. Define who may publish each event. If every participant can publish everything, authority remains ambiguous even with typed signals.

## Application EventBus

An application EventBus is a long-lived channel for facts whose meaning and audience cross scene or feature lifetimes. In Godot it is commonly an Autoload because it must remain reachable across scene changes.

Use it when the evidence shows several of these conditions:

- no stable common scene owner exists;
- consumers appear and disappear independently;
- the event crosses bounded feature or scene lifetime;
- multiple unrelated adapters must react without becoming dependencies of the domain owner;
- passing and rebroadcasting a reference through several layers would obscure the source.

### EventBus contract

- The authoritative owner commits state before publishing.
- The bus declares typed fact events and transports them.
- The bus does not own mutable domain state, validation, or business transitions.
- Each event has a named publishing authority or bridge.
- Consumers may be absent; their absence cannot invalidate the committed domain state.
- Consumer order cannot determine domain results.
- Late consumers initialize through a query or snapshot, not presumed replay of old signals.
- Connections follow the participants' lifecycle and are testable/searchable.
- High-volume per-frame data stays off the global bus unless measured requirements prove otherwise.

### Split and bridge

Avoid one `Events` node containing unrelated match, career, UI, platform, and save concerns. Prefer bounded channels and explicit bridges:

```text
MatchEvents.match_completed
    -> CareerCoordinator commits CareerState
    -> ApplicationEvents.season_progressed
```

The bridge translates between contracts; it does not let downstream observers mutate upstream state.

### EventBus is not a Store

A store answers current-state queries and owns mutation policy. A bus announces facts. Combining them can be valid only when one explicitly designed object truly owns both responsibilities; global convenience alone is not cohesion. Default to separate names and APIs so callers cannot mistake broadcast access for write authority.

## Autoload decision

Autoload supplies application lifetime and global reachability. It does not prove that a responsibility should be global. Use a regular Node, Resource, static function, or injected object when scene/feature ownership is sufficient.

An object needing `_process()` or child Nodes does not automatically need to be an Autoload. First decide required lifetime and owner, then place it at that scope.

## Escalation and de-escalation triggers

Move local wiring toward a feature hub when a committed consumer gains an independent lifecycle, connection ownership becomes multi-step and hard to trace, or fan-out is a stable feature requirement.

Move a feature event toward an application bridge/bus when its meaning crosses the feature boundary and concrete independent consumers exist.

Split or reduce a bus when unrelated contracts accumulate, publishers become ambiguous, event volume obscures debugging, or consumers use events as mutable state synchronization.

## Sources

- [Godot: Scene organization](https://docs.godotengine.org/en/stable/tutorials/best_practices/scene_organization.html) — scene independence, dependency injection, and owner-managed relationships.
- [KidsCanCode: Node communication](https://kidscancode.org/godot_recipes/4.x/basics/node_communication/index.html) — local call/signal direction, common-parent wiring, and groups.
- [GDQuest: Signal best practices](https://www.gdquest.com/library/signals_good_practices/) — avoid deep bubbling and multi-step connection mazes.
- [GDQuest: Events bus singleton](https://www.gdquest.com/tutorial/godot/design-patterns/event-bus-singleton/) — global bus benefits, costs, and preference for simpler local alternatives when sufficient.
- [Godot: Autoloads versus regular nodes](https://docs.godotengine.org/en/stable/tutorials/best_practices/autoloads_versus_regular_nodes.html) — global access costs and local ownership alternatives.
