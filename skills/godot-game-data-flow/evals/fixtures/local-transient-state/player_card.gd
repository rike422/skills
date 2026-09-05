extends Control

var hover_progress: float = 0.0
var is_hovered: bool = false

func _process(delta: float) -> void:
	if is_hovered:
		hover_progress = minf(1.0, hover_progress + delta * 4.0)

func _on_mouse_entered() -> void:
	is_hovered = true

func _on_mouse_exited() -> void:
	is_hovered = false
