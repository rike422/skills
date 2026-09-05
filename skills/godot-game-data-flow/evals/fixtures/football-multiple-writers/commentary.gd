extends Node

var lines: Array[String] = []

func bind_match(match_state: MatchState) -> void:
	match_state.goal_scored.connect(func(team_id: int) -> void:
		lines.append("Goal for team %d" % team_id)
	)
