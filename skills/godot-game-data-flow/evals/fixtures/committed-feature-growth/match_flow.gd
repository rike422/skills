class_name MatchFlow
extends Node

signal goal_scored(team_id: int, score: int)

var scores: Dictionary[int, int] = {0: 0, 1: 0}

func record_goal(team_id: int) -> void:
	scores[team_id] += 1
	goal_scored.emit(team_id, scores[team_id])
