class_name MatchFinalizer
extends Node

signal full_time(result: Dictionary)

var standings: Dictionary[int, int] = {}
var rewards: Dictionary[int, int] = {}

func _ready() -> void:
	full_time.connect(_calculate_rewards)
	full_time.connect(_update_standings)

func finish_match(result: Dictionary) -> void:
	full_time.emit(result)

func _update_standings(result: Dictionary) -> void:
	standings[result.team_id] = standings.get(result.team_id, 0) + result.points

func _calculate_rewards(result: Dictionary) -> void:
	rewards[result.team_id] = standings.get(result.team_id, 0) * 100
