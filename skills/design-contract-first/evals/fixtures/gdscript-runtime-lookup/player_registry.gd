class_name PlayerRegistry
extends RefCounted


class Player:
	extends RefCounted
	var player_id: int
	var display_name: String


var players_by_id: Dictionary = {}


func register(player: Player) -> void:
	pass


func find(player_id: int) -> Player:
	return null


func unregister(player_id: int) -> void:
	pass
