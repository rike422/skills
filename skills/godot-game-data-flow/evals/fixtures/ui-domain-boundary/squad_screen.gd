extends Control

var career_state: CareerState

func move_player(from_slot: int, to_slot: int) -> void:
	var lineup := career_state.get_lineup()
	var player_id := lineup[from_slot]
	lineup[from_slot] = lineup[to_slot]
	lineup[to_slot] = player_id
