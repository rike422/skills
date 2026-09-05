---
name: design-contract-first
description: Consolidate canonical data contracts and overlapping interfaces before extending APIs. Use when designing, refactoring, or migrating excessive parameters, fixed-schema hashes or dictionaries, options, context/request/result/state/event objects, DTOs, parameter objects, data bags, or internal string-keyed contracts, and when overlapping policies, adapters, strategies, or resolvers obscure ownership. Prefer one typed canonical owner and a clean replacement without parallel compatibility paths. Excludes genuine runtime-keyed maps, caches, indexes, and lookup tables.
---

# Design Contract First

Establish one canonical responsibility and explicit contract before changing an interface. Replace obsolete paths in the same change; do not preserve them solely for backward compatibility.

## Default proposal stance

- Unless the user, repository, or external contract explicitly requires compatibility, propose the clean end state first and assume obsolete APIs can be replaced.
- Treat callers, stored data, tests, fixtures, and existing weak fixed-schema maps as migration scope, not as reasons to preserve a weaker interface.
- Separate migration cost and rollout risk from target design. Do not weaken the design merely to reduce the immediate diff.
- If compatibility is required, define its exact consumers, owner, removal condition, and deadline. Do not introduce open-ended compatibility layers.
- If a coherent replacement materially expands the approved scope, stop and report the design, impact, and migration plan rather than adding an adapter or fallback.

## Required workflow

1. Inventory callers, inputs, outputs, state ownership, side effects, and existing state/context/request/value-object contracts.
2. Classify each collection: known fields form a record; keys discovered at runtime form a map.
3. Find overlapping responsibilities and decide the canonical owner before defining a type or method. Verify that it is the true processing owner, not a convenient insertion point.
4. State the resulting contract: owner, required fields and types, inputs, outputs, invariants, lifecycle, and the contract removed or absorbed.
5. Implement one production path. Move or merge behavior into it and delete superseded interfaces, data bags, adapters, fallbacks, and duplicated logic.
6. Update all affected callers, persisted forms, tests, fixtures, telemetry, and documentation to the unified contract.

## Records, maps, and boundaries

If the field set is known at design time, represent it with a typed class, struct, value object, DTO, or enum-backed model. Do not introduce or extend a string-keyed map for fixed-shape state, context, requests, commands, results, responses, events, entities, function returns, or options passed between layers.

Use the language's explicit contract mechanism: for example, GDScript `RefCounted`, `Resource`, or typed class; Ruby class, `Data.define`, or suitable `Struct`; Python dataclass or typed model; Rust struct or enum; and TypeScript explicit types with runtime boundary validation. Inventory and extend the actual canonical owner instead of creating a second context or temporary request type.

The canonical typed object owns, as applicable:

- required fields, types, validation, and defaults;
- construction, restoration, serialization, and deserialization;
- copying, identity semantics, domain predicates, and state transitions.

Callers must not reproduce key strings, defaults, or validation rules.

Maps remain correct for runtime-keyed lookup tables, caches, indexes, sparse coordinate or category maps, user-defined arbitrary keys, and truly opaque metadata. JSON, database rows, configuration, and external APIs may also be map-like at their boundaries. Validate a fixed schema there and immediately convert it to the typed canonical object; do not propagate the boundary map through domain code. When domain logic reads a key from opaque metadata, promote that data to a typed contract.

Debug, telemetry, replay, and fixture schemas follow the same rule. Maintain a typed canonical representation and convert it to a Dictionary, Hash, map, or JSON only at the output boundary. Do not weaken a production API for test convenience.

## Parameters and cohesion

- Default to at most five parameters per function. Above five, inspect responsibility, ownership, lifecycle, and existing context objects before changing the signature.
- Never hide parameter count in a Hash, Dictionary, array, varargs, loose object, or `Record<string, unknown>`.
- Introduce a parameter object only when its fields share responsibility, lifecycle, and invariants; it must be a typed contract with a canonical owner.
- Do not perform a mechanical class-per-dictionary rewrite. If fields do not belong together, split the responsibility instead of wrapping the same oversized data bag in a class.

## Non-negotiable rules

- Do not add an unused, parallel, provisional, or compatibility-only interface.
- Do not add a method or type until its responsibility and production call path are explicit.
- Do not split one responsibility across policy, engine, coordinator, and context types without assigning ownership for every decision.
- Existing fixed-schema maps do not justify adding keys or consumers. Replace them coherently within the requested scope.
- If the canonical owner is uncertain, stop implementation and present the competing owners, callers, and deletion or merge plan for approval.

## Review checklist

- Is there exactly one authoritative owner and interface for the responsibility?
- Is each fixed schema typed, and is each remaining map genuinely runtime-keyed or confined to a boundary?
- Does any function exceed five parameters or merely conceal them in a container?
- Does the typed owner enforce applicable invariants, defaults, construction, and serialization responsibilities?
- Are boundary data, debug output, telemetry, and fixtures converted at the edge rather than leaked into production contracts?
- Does the diff delete the replaced path and update its callers instead of preserving compatibility code?
- Does every new interface have an immediate production caller?
