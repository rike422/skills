class_name CareerState
extends Node

var completed_seasons: Array[Dictionary] = []

func complete_season(result: Dictionary) -> void:
	completed_seasons.append(result)
