class_name CareerState
extends Node

var lineup: Dictionary[int, int] = {0: 10, 1: 11, 2: 12}

func get_lineup() -> Dictionary[int, int]:
	return lineup
