class_name CombatResolver
extends RefCounted


class AttackContext:
	extends RefCounted
	var attacker_id: int
	var target_id: int
	var weapon_id: StringName


func resolve_attack(
	attacker_id: int,
	target_id: int,
	weapon_id: StringName,
	base_damage: float,
	critical_chance: float,
	critical_multiplier: float,
	armor: float,
	armor_penetration: float,
	element: StringName,
	element_resistance: float,
	distance: float,
	max_range: float,
	combo_count: int,
	combo_bonus: float,
	stamina: float,
	stamina_cost: float,
	is_backstab: bool,
	backstab_multiplier: float,
	random_roll: float
) -> float:
	var damage := base_damage
	if random_roll < critical_chance:
		damage *= critical_multiplier
	damage += combo_count * combo_bonus
	damage *= backstab_multiplier if is_backstab else 1.0
	damage *= clampf(1.0 - distance / max_range, 0.0, 1.0)
	damage *= clampf(stamina / stamina_cost, 0.0, 1.0)
	damage -= maxf(armor - armor_penetration, 0.0)
	damage *= 1.0 - element_resistance
	return maxf(damage, 0.0)
