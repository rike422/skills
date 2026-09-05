extends Control

var displayed_scores: Dictionary[int, int] = {0: 0, 1: 0}

func bind_match(match_state: MatchState) -> void:
	match_state.goal_scored.connect(_on_goal_scored)

func _on_goal_scored(team_id: int) -> void:
	displayed_scores[team_id] += 1
