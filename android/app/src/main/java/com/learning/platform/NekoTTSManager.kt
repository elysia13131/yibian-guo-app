package com.learning.platform

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

class NekoTTSManager(private val context: Context) {

    private var tts: TextToSpeech? = null
    private var isInitialized = false

    var onReady: (() -> Unit)? = null
    var onStart: ((String) -> Unit)? = null
    var onDone: ((String) -> Unit)? = null
    var onError: ((String) -> Unit)? = null

    fun initialize() {
        tts = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) {
                isInitialized = true
                tts?.language = Locale.getDefault()
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String) {
                        this@NekoTTSManager.onStart?.invoke(utteranceId)
                    }

                    override fun onDone(utteranceId: String) {
                        this@NekoTTSManager.onDone?.invoke(utteranceId)
                    }

                    override fun onError(utteranceId: String) {
                        this@NekoTTSManager.onError?.invoke(utteranceId)
                    }

                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String, errorCode: Int) {
                        this@NekoTTSManager.onError?.invoke(utteranceId)
                    }
                })
                onReady?.invoke()
            } else {
                onError?.invoke("TTS initialization failed with status: $status")
            }
        }
    }

    fun speak(text: String, utteranceId: String = "tts_" + System.currentTimeMillis()): Boolean {
        if (!isInitialized || tts == null) return false
        val result = tts!!.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
        return result == TextToSpeech.SUCCESS
    }

    fun isSpeaking(): Boolean {
        return tts?.isSpeaking ?: false
    }

    fun stop() {
        tts?.stop()
    }

    fun shutdown() {
        tts?.stop()
        tts?.shutdown()
        tts = null
        isInitialized = false
    }
}
