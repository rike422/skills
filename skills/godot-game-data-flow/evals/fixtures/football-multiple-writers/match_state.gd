class_name MatchState
extends Node

signal goal_scored(team_id: int)

var scores: Dictionary[int, int] = {0: 0, 1: 0}
var winner_id: int = -1

func _ready() -> void:
	goal_scored.connect(_update_score)
	goal_scored.connect(_update_winner)

func report_goal(team_id: int) -> void:
	goal_scored.emit(team_id)

func _update_score(team_id: int) -> void:
	scores[team_id] += 1

func _update_winner(team_id: int) -> void:
	if scores[team_id] > scores[1 - team_id]:
		winner_id = team_id
