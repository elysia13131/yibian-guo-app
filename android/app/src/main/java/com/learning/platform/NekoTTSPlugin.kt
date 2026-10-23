package com.learning.platform

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "NekoTTS")
class NekoTTSPlugin : Plugin() {

    private var ttsManager: NekoTTSManager? = null

    @PluginMethod
    fun initialize(call: PluginCall) {
        val context = getContext()
        ttsManager = NekoTTSManager(context).apply {
            onReady = {
                call.resolve()
            }
            onStart = { utteranceId ->
                val ret = JSObject()
                ret.put("utteranceId", utteranceId)
                notifyListeners("speechStart", ret)
            }
            onDone = { utteranceId ->
                val ret = JSObject()
                ret.put("utteranceId", utteranceId)
                notifyListeners("speechEnd", ret)
            }
            onError = { error ->
                val ret = JSObject()
                ret.put("message", error)
                notifyListeners("speechError", ret)
                call.reject(error)
            }
            initialize()
        }
    }

    @PluginMethod
    fun speak(call: PluginCall) {
        val text = call.getString("text", "")
        if (text.isEmpty()) {
            call.reject("Text is empty")
            return
        }
        val utteranceId = call.getString("utteranceId", "tts_" + System.currentTimeMillis())
        val success = ttsManager?.speak(text, utteranceId) ?: false
        if (success) {
            call.resolve()
        } else {
            call.reject("TTS not initialized")
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        ttsManager?.stop()
        call.resolve()
    }

    @PluginMethod
    fun isSpeaking(call: PluginCall) {
        val result = JSObject()
        result.put("value", ttsManager?.isSpeaking() ?: false)
        call.resolve(result)
    }

    override fun handleOnDestroy() {
        ttsManager?.shutdown()
        ttsManager = null
        super.handleOnDestroy()
    }
}
