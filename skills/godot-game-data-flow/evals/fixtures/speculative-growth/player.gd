class_name Player
extends Node

signal stamina_changed(value: float)

var stamina: float = 100.0

func spend_stamina(amount: float) -> void:
	stamina = maxf(0.0, stamina - amount)
	stamina_changed.emit(stamina)
