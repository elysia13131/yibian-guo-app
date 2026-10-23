package com.learning.platform

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "NekoRealtime")
class NekoRealtimePlugin : Plugin() {

    private var client: NekoRealtimeClient? = null
    private var micOn = false

    @PluginMethod
    fun startRealtime(call: PluginCall) {
        val apiKey = call.getString("apiKey") ?: run { call.reject("Missing apiKey"); return }
        val baseUrl = call.getString("baseUrl", "wss://dashscope.aliyuncs.com/api-ws/v1/realtime")
        val model = call.getString("model", "qwen3-omni-flash-realtime")
        val voice = call.getString("voice", "cherry")
        val instructions = call.getString("instructions", "")
        val tools = call.getString("tools", "[]")

        client = NekoRealtimeClient(apiKey, baseUrl, model).apply {
            if (tools != "[]") setToolDefinitions(tools)
            onStateChanged = { state ->
                val ret = JSObject()
                ret.put("state", state)
                notifyListeners("stateChanged", ret)
            }
            onTranscript = { text ->
                val ret = JSObject()
                ret.put("text", text)
                notifyListeners("transcript", ret)
            }
            onTextDelta = { delta ->
                val ret = JSObject()
                ret.put("delta", delta)
                notifyListeners("textDelta", ret)
            }
            onAudioDelta = { level ->
                val ret = JSObject()
                ret.put("level", level.toDouble())
                notifyListeners("audioDelta", ret)
            }
            onSpeechStarted = {
                notifyListeners("speechStarted", JSObject())
            }
            onSpeechStopped = {
                notifyListeners("speechStopped", JSObject())
            }
            onInputTranscript = { text ->
                val ret = JSObject()
                ret.put("text", text)
                notifyListeners("inputTranscript", ret)
            }
            onToolCall = { callId, name, args ->
                val ret = JSObject()
                ret.put("callId", callId)
                ret.put("name", name)
                ret.put("arguments", args)
                notifyListeners("toolCall", ret)
            }
            onError = { error ->
                val ret = JSObject()
                ret.put("message", error)
                notifyListeners("error", ret)
            }
            connect(instructions, voice)
        }
        call.resolve()
    }

    @PluginMethod
    fun startMic(call: PluginCall) {
        client?.startRecording()
        micOn = true
        call.resolve()
    }

    @PluginMethod
    fun stopMic(call: PluginCall) {
        client?.stopRecording()
        micOn = false
        call.resolve()
    }

    @PluginMethod
    fun muteMic(call: PluginCall) {
        client?.muteMic()
        call.resolve()
    }

    @PluginMethod
    fun unmuteMic(call: PluginCall) {
        client?.unmuteMic()
        call.resolve()
    }

    @PluginMethod
    fun stopRealtime(call: PluginCall) {
        client?.disconnect()
        client = null
        micOn = false
        call.resolve()
    }

    @PluginMethod
    fun sendText(call: PluginCall) {
        val text = call.getString("text", "")
        client?.sendText(text)
        call.resolve()
    }

    @PluginMethod
    fun sendImage(call: PluginCall) {
        val image = call.getString("image", "")
        client?.sendImage(image)
        call.resolve()
    }

    @PluginMethod
    fun sendToolResult(call: PluginCall) {
        val callId = call.getString("callId", "")
        val output = call.getString("output", "")
        client?.sendToolResult(callId, output)
        call.resolve()
    }

    @PluginMethod
    fun sendOutputEvents(call: PluginCall) {
        val events = call.getString("events", "[]")
        client?.sendOutputEvents(events)
        call.resolve()
    }

    @PluginMethod
    fun sendImageFrame(call: PluginCall) {
        val image = call.getString("image", "")
        client?.sendImageFrame(image)
        call.resolve()
    }

    override fun handleOnDestroy() {
        client?.disconnect()
        client = null
        super.handleOnDestroy()
    }
}
