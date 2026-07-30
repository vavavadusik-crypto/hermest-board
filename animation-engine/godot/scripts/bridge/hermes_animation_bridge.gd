extends Node

const PROTOCOL_VERSION := "0.1.0"
const DEFAULT_PORT := 37645
const MAX_MESSAGE_BYTES := 1024 * 1024

const ALL_METHODS := [
	"engine.ping",
	"engine.getCapabilities",
	"engine.getVersion",
	"engine.getDiagnostics",
	"project.create",
	"project.open",
	"project.save",
	"project.close",
	"project.validate",
	"scene.list",
	"scene.create",
	"scene.load",
	"scene.save",
	"scene.serialize",
	"scene.validate",
	"node.list",
	"node.create",
	"node.remove",
	"node.getProperties",
	"node.setProperties",
	"asset.import",
	"asset.list",
	"asset.validate",
	"asset.getMetadata",
	"timeline.get",
	"timeline.seek",
	"timeline.play",
	"timeline.pause",
	"timeline.stop",
	"timeline.setLoop",
	"timeline.addKeyframe",
	"timeline.removeKeyframe",
	"camera.list",
	"camera.setActive",
	"camera.orbit",
	"camera.preview",
	"render.preview",
	"render.start",
	"render.cancel",
	"render.getStatus",
	"render.getResult",
	"test.run",
	"test.getReport"
]

const IMPLEMENTED_METHODS := [
	"engine.ping",
	"engine.getCapabilities",
	"engine.getVersion",
	"engine.getDiagnostics"
]

var _server := TCPServer.new()
var _clients: Array[Dictionary] = []
var _port := DEFAULT_PORT

func _ready() -> void:
	_port = _resolve_port()
	var error := _server.listen(_port, "127.0.0.1")
	if error != OK:
		push_error("Hermes animation bridge could not listen on 127.0.0.1:%d (error %d)" % [_port, error])
		get_tree().quit(2)
		return
	print(JSON.stringify({
		"event": "engine.ready",
		"protocolVersion": PROTOCOL_VERSION,
		"transport": "websocket-jsonrpc",
		"host": "127.0.0.1",
		"port": _port,
		"pid": OS.get_process_id()
	}))

func _process(_delta: float) -> void:
	_accept_pending_connections()
	_poll_clients()

func _exit_tree() -> void:
	_server.stop()
	_clients.clear()

func _accept_pending_connections() -> void:
	while _server.is_connection_available():
		var stream := _server.take_connection()
		if stream == null:
			return
		var peer := WebSocketPeer.new()
		var error := peer.accept_stream(stream)
		if error != OK:
			stream.disconnect_from_host()
			continue
		_clients.append({"peer": peer, "announced": false})

func _poll_clients() -> void:
	for index in range(_clients.size() - 1, -1, -1):
		var client := _clients[index]
		var peer: WebSocketPeer = client["peer"]
		peer.poll()
		var state := peer.get_ready_state()
		if state == WebSocketPeer.STATE_OPEN:
			if client["announced"] == false:
				_send_notification(peer, "engine.ready", {
					"protocolVersion": PROTOCOL_VERSION,
					"runtime": "godot",
					"runtimeVersion": _runtime_version(),
					"port": _port
				})
				client["announced"] = true
				_clients[index] = client
			while peer.get_available_packet_count() > 0:
				var packet := peer.get_packet()
				if packet.size() > MAX_MESSAGE_BYTES:
					_send_error(peer, null, -32001, "message_too_large", {
						"maxBytes": MAX_MESSAGE_BYTES,
						"actualBytes": packet.size()
					})
					continue
				_handle_message(peer, packet.get_string_from_utf8())
		elif state == WebSocketPeer.STATE_CLOSED:
			_clients.remove_at(index)

func _handle_message(peer: WebSocketPeer, text: String) -> void:
	var json := JSON.new()
	var parse_error := json.parse(text)
	if parse_error != OK:
		_send_error(peer, null, -32700, "parse_error")
		return
	if typeof(json.data) != TYPE_DICTIONARY:
		_send_error(peer, null, -32600, "invalid_request")
		return

	var request: Dictionary = json.data
	var request_id = request.get("id", null)
	if request.get("jsonrpc", null) != "2.0":
		_send_error(peer, request_id, -32600, "jsonrpc_must_equal_2_0")
		return
	if typeof(request_id) != TYPE_STRING and typeof(request_id) != TYPE_INT:
		_send_error(peer, null, -32600, "request_id_must_be_string_or_integer")
		return
	if request.get("protocolVersion", null) != PROTOCOL_VERSION:
		_send_error(peer, request_id, -32002, "protocol_version_unsupported", {
			"expected": PROTOCOL_VERSION,
			"received": request.get("protocolVersion", null)
		})
		return

	var method = request.get("method", null)
	if typeof(method) != TYPE_STRING or method not in ALL_METHODS:
		_send_error(peer, request_id, -32601, "method_not_found", {"method": method})
		return
	if method not in IMPLEMENTED_METHODS:
		_send_error(peer, request_id, -32601, "method_not_implemented", {"method": method})
		return

	var params = request.get("params", {})
	if typeof(params) != TYPE_DICTIONARY and typeof(params) != TYPE_ARRAY:
		_send_error(peer, request_id, -32602, "params_must_be_object_or_array")
		return

	match method:
		"engine.ping":
			_send_result(peer, request_id, {
				"ok": true,
				"nonce": params.get("nonce", null) if typeof(params) == TYPE_DICTIONARY else null,
				"runtime": "godot",
				"runtimeVersion": _runtime_version(),
				"pid": OS.get_process_id()
			})
		"engine.getCapabilities":
			_send_result(peer, request_id, _capabilities())
		"engine.getVersion":
			_send_result(peer, request_id, {
				"protocolVersion": PROTOCOL_VERSION,
				"runtime": "godot",
				"runtimeVersion": _runtime_version()
			})
		"engine.getDiagnostics":
			_send_result(peer, request_id, {
				"connectedClients": _clients.size(),
				"host": "127.0.0.1",
				"port": _port,
				"projectPath": ProjectSettings.globalize_path("res://"),
				"displayServer": DisplayServer.get_name(),
				"pid": OS.get_process_id()
			})

func _capabilities() -> Dictionary:
	var methods: Array[Dictionary] = []
	for method in ALL_METHODS:
		methods.append({
			"method": method,
			"status": "implemented" if method in IMPLEMENTED_METHODS else "planned"
		})
	return {
		"protocolVersion": PROTOCOL_VERSION,
		"runtime": "godot",
		"runtimeVersion": _runtime_version(),
		"transport": "websocket-jsonrpc",
		"methods": methods
	}

func _send_result(peer: WebSocketPeer, request_id, result) -> void:
	peer.send_text(JSON.stringify({
		"jsonrpc": "2.0",
		"id": request_id,
		"result": result,
		"protocolVersion": PROTOCOL_VERSION
	}))

func _send_error(peer: WebSocketPeer, request_id, code: int, message: String, data = null) -> void:
	var error_payload := {"code": code, "message": message}
	if data != null:
		error_payload["data"] = data
	peer.send_text(JSON.stringify({
		"jsonrpc": "2.0",
		"id": request_id,
		"error": error_payload,
		"protocolVersion": PROTOCOL_VERSION
	}))

func _send_notification(peer: WebSocketPeer, method: String, params: Dictionary) -> void:
	peer.send_text(JSON.stringify({
		"jsonrpc": "2.0",
		"method": method,
		"params": params,
		"protocolVersion": PROTOCOL_VERSION
	}))

func _runtime_version() -> String:
	var info := Engine.get_version_info()
	return String(info.get("string", "unknown"))

func _resolve_port() -> int:
	var env_port := OS.get_environment("HERMEST_ANIMATION_PORT")
	var parsed := _valid_port(env_port)
	if parsed != -1:
		return parsed
	for argument in OS.get_cmdline_user_args():
		var value := String(argument)
		if value.begins_with("--hermes-animation-port="):
			parsed = _valid_port(value.trim_prefix("--hermes-animation-port="))
			if parsed != -1:
				return parsed
	return DEFAULT_PORT

func _valid_port(value: String) -> int:
	if not value.is_valid_int():
		return -1
	var parsed := value.to_int()
	return parsed if parsed >= 1024 and parsed <= 65535 else -1
