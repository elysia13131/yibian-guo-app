package com.learning.platform

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.util.Base64
import android.util.Log
import okhttp3.*
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

class NekoRealtimeClient(
    private val apiKey: String,
    private val baseUrl: String,
    private val model: String = "qwen3-omni-flash-realtime"
) {
    companion object {
        private const val TAG = "NekoRealtime"
        private const val INPUT_SAMPLE_RATE = 16000
        private const val OUTPUT_SAMPLE_RATE = 24000
        private const val CHANNELS = 1
        private const val PCM_ENCODING = AudioFormat.ENCODING_PCM_16BIT
        private const val CHUNK_MS = 20
        private const val CHUNK_SIZE = INPUT_SAMPLE_RATE * 2 * CHUNK_MS / 1000
        private const val IMAGE_MIN_INTERVAL_MS = 1500L
        private const val IMAGE_IDLE_MULTIPLIER = 5L
        private const val TOOL_FLOOD_WINDOW_MS = 30000L
        private const val TOOL_FLOOD_MAX_CALLS = 6
    }

    private var webSocket: WebSocket? = null
    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null
    private var recordingThread: Thread? = null
    private val isRunning = AtomicBoolean(false)
    private val isMicMuted = AtomicBoolean(false)
    private val isConnected = AtomicBoolean(false)
    private val audioPlaybackQueue = ConcurrentLinkedQueue<ByteArray>()

    var onStateChanged: ((String) -> Unit)? = null
    var onTranscript: ((String) -> Unit)? = null
    var onTextDelta: ((String) -> Unit)? = null
    var onAudioDelta: ((Float) -> Unit)? = null
    var onInputTranscript: ((String) -> Unit)? = null
    var onSpeechStarted: (() -> Unit)? = null
    var onSpeechStopped: (() -> Unit)? = null
    var onToolCall: ((String, String, String) -> Unit)? = null
    var onError: ((String) -> Unit)? = null

    private var silenceTimer: java.util.Timer? = null
    private val silenceTimeoutMs = 90000L

    private var toolDefinitionsJson: String = ""
    private val lastImageSentMs = AtomicLong(0)
    private val lastSpeechMs = AtomicLong(0)
    private val recentToolCallMs = mutableListOf<Long>()
    private val micSilentFrames = AtomicInteger(0)
    private val maxSilentFrames = 100

    fun setToolDefinitions(jsonArrayStr: String) {
        toolDefinitionsJson = jsonArrayStr
    }

    fun connect(instructions: String, voice: String = "cherry") {
        if (isConnected.get()) return

        val client = OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()

        val wsUrl = "$baseUrl?model=$model"
        val request = Request.Builder()
            .url(wsUrl)
            .addHeader("Authorization", "Bearer $apiKey")
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "WebSocket connected")
                isConnected.set(true)
                onStateChanged?.invoke("connected")

                val sessionConfig = JSONObject().apply {
                    put("type", "session.update")
                    put("session", JSONObject().apply {
                        put("modalities", org.json.JSONArray().apply {
                            put("text")
                            put("audio")
                        })
                        put("instructions", instructions)
                        put("voice", voice)
                        put("input_audio_format", "pcm16")
                        put("output_audio_format", "pcm16")
                        put("turn_detection", JSONObject().apply {
                            put("type", "server_vad")
                            put("threshold", 0.5)
                            put("prefix_padding_ms", 300)
                            put("silence_duration_ms", 500)
                        })
                        if (toolDefinitionsJson.isNotEmpty() && toolDefinitionsJson != "[]") {
                            try {
                                put("tools", org.json.JSONArray(toolDefinitionsJson))
                            } catch (_: org.json.JSONException) {}
                        }
                    })
                }
                ws.send(sessionConfig.toString())
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleMessage(text)
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                isConnected.set(false)
                onStateChanged?.invoke("disconnected")
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket error: ${t.message}")
                isConnected.set(false)
                onError?.invoke(t.message ?: "连接失败")
                onStateChanged?.invoke("error")
            }
        })
    }

    fun disconnect() {
        isRunning.set(false)
        silenceTimer?.cancel()
        silenceTimer = null
        recordingThread?.interrupt()
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null
        audioTrack?.stop()
        audioTrack?.release()
        audioTrack = null
        audioPlaybackQueue.clear()
        webSocket?.close(1000, "user disconnect")
        webSocket = null
        isConnected.set(false)
        recentToolCallMs.clear()
    }

    fun muteMic() { isMicMuted.set(true) }
    fun unmuteMic() { isMicMuted.set(false) }

    fun sendText(text: String) {
        if (!isConnected.get()) return
        val msg = JSONObject().apply {
            put("type", "conversation.item.create")
            put("item", JSONObject().apply {
                put("type", "message")
                put("role", "user")
                put("content", JSONArray().apply {
                    put(JSONObject().apply {
                        put("type", "input_text")
                        put("text", text)
                    })
                })
            })
        }
        webSocket?.send(msg.toString())
        webSocket?.send(JSONObject().apply { put("type", "response.create") }.toString())
    }

    fun sendImage(b64Jpeg: String): Boolean {
        if (!isConnected.get()) return false

        val now = System.currentTimeMillis()
        val last = lastImageSentMs.get()
        val idleMs = now - lastSpeechMs.get()
        val minInterval = if (idleMs > 5000) IMAGE_MIN_INTERVAL_MS * IMAGE_IDLE_MULTIPLIER else IMAGE_MIN_INTERVAL_MS
        if (now - last < minInterval) return false
        lastImageSentMs.set(now)

        val msg = JSONObject().apply {
            put("type", "conversation.item.create")
            put("item", JSONObject().apply {
                put("type", "message")
                put("role", "user")
                put("content", JSONArray().apply {
                    put(JSONObject().apply {
                        put("type", "input_image")
                        put("image_url", "data:image/jpeg;base64,$b64Jpeg")
                    })
                })
            })
        }
        webSocket?.send(msg.toString())
        webSocket?.send(JSONObject().apply { put("type", "response.create") }.toString())
        return true
    }

    fun sendToolResult(callId: String, output: String) {
        if (!isConnected.get()) return
        val msg = JSONObject().apply {
            put("type", "conversation.item.create")
            put("item", JSONObject().apply {
                put("type", "function_call_output")
                put("call_id", callId)
                put("output", output)
            })
        }
        webSocket?.send(msg.toString())
        webSocket?.send(JSONObject().apply { put("type", "response.create") }.toString())
    }

    fun sendOutputEvents(eventsJson: String) {
        if (!isConnected.get()) return
        try {
            val events = JSONArray(eventsJson)
            for (i in 0 until events.length()) {
                webSocket?.send(events.getJSONObject(i).toString())
            }
            webSocket?.send(JSONObject().apply { put("type", "response.create") }.toString())
        } catch (e: Exception) {
            onError?.invoke("sendOutputEvents: ${e.message}")
        }
    }

    fun sendImageFrame(b64Jpeg: String) {
        if (!isConnected.get()) return
        val msg = JSONObject().apply {
            put("type", "input_image_buffer.append")
            put("image", b64Jpeg)
        }
        webSocket?.send(msg.toString())
    }

    private fun checkToolFlood(): Boolean {
        val now = System.currentTimeMillis()
        recentToolCallMs.removeAll { now - it > TOOL_FLOOD_WINDOW_MS }
        if (recentToolCallMs.size >= TOOL_FLOOD_MAX_CALLS) {
            return true
        }
        recentToolCallMs.add(now)
        return false
    }

    private fun sendServerMessage(text: String) {
        webSocket?.send(JSONObject().apply {
            put("type", "conversation.item.create")
            put("item", JSONObject().apply {
                put("type", "message")
                put("role", "user")
                put("content", JSONArray().apply {
                    put(JSONObject().apply {
                        put("type", "input_text")
                        put("text", text)
                    })
                })
            })
        }.toString())
        webSocket?.send(JSONObject().apply { put("type", "response.create") }.toString())
    }

    fun startRecording() {
        if (isRunning.get()) return
        isRunning.set(true)

        val minBufSize = AudioRecord.getMinBufferSize(INPUT_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, PCM_ENCODING)
        val bufSize = maxOf(minBufSize, CHUNK_SIZE * 2)

        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                INPUT_SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                PCM_ENCODING,
                bufSize
            )
            audioRecord?.startRecording()
        } catch (e: SecurityException) {
            onError?.invoke("麦克风权限未授予")
            isRunning.set(false)
            return
        }

        recordingThread = Thread {
            val byteBuffer = ByteArray(CHUNK_SIZE)
            val outputBuffer = ByteArray(CHUNK_SIZE)
            var paused = false
            var zeroCount = 0

            while (isRunning.get() && !Thread.interrupted()) {
                if (isMicMuted.get()) {
                    if (!paused) {
                        Log.d(TAG, "Mic muted — sending silent audio as keep-alive")
                        paused = true
                    }
                    byteBuffer.fill(0)
                    zeroCount++
                } else {
                    if (paused) {
                        Log.d(TAG, "Mic unmuted")
                        paused = false
                        zeroCount = 0
                    }
                    val read = audioRecord?.read(byteBuffer, 0, CHUNK_SIZE) ?: 0
                    if (read <= 0) continue
                    lastSpeechMs.set(System.currentTimeMillis())
                    micSilentFrames.set(0)
                }

                val isSilent = byteBuffer.all { it.toInt() == 0 }
                if (isSilent) {
                    val frames = micSilentFrames.incrementAndGet()
                    if (frames == maxSilentFrames) {
                        webSocket?.send(JSONObject().apply { put("type", "input_audio_buffer.clear") }.toString())
                        Log.d(TAG, "Audio buffer cleared after $maxSilentFrames silent frames")
                    }
                }

                if (byteBuffer.size % 2 != 0) {
                    System.arraycopy(byteBuffer, 0, outputBuffer, 0, byteBuffer.size - 1)
                    outputBuffer[byteBuffer.size - 1] = 0
                } else {
                    System.arraycopy(byteBuffer, 0, outputBuffer, 0, byteBuffer.size)
                }
                val bytesToSend = if (byteBuffer.size % 2 != 0) byteBuffer.size - 1 else byteBuffer.size
                val b64 = Base64.encodeToString(outputBuffer, 0, bytesToSend, Base64.NO_WRAP)
                val msg = JSONObject().apply {
                    put("type", "input_audio_buffer.append")
                    put("audio", b64)
                }
                webSocket?.send(msg.toString())
                try { Thread.sleep(CHUNK_MS.toLong()) } catch (_: InterruptedException) { break }
            }
        }.apply {
            name = "AudioRecording"
            start()
        }
    }

    fun stopRecording() {
        isRunning.set(false)
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null
        webSocket?.send(JSONObject().apply { put("type", "input_audio_buffer.commit") }.toString())
    }

    private fun initAudioTrack() {
        if (audioTrack != null && audioTrack?.playState == AudioTrack.PLAYSTATE_PLAYING) return
        val bufSize = AudioTrack.getMinBufferSize(OUTPUT_SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, PCM_ENCODING)
        audioTrack = AudioTrack.Builder()
            .setAudioAttributes(android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                .build())
            .setAudioFormat(android.media.AudioFormat.Builder()
                .setEncoding(PCM_ENCODING)
                .setSampleRate(OUTPUT_SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build())
            .setBufferSizeInBytes(bufSize)
            .build()
        audioTrack?.play()
    }

    private fun enqueueAudioPlayback(base64Audio: String) {
        try {
            val pcmBytes = Base64.decode(base64Audio, Base64.DEFAULT)
            audioPlaybackQueue.add(pcmBytes)
            schedulePlayback()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decode audio", e)
        }
    }

    private var playbackScheduled = AtomicBoolean(false)

    private fun schedulePlayback() {
        if (!playbackScheduled.compareAndSet(false, true)) return
        Thread {
            initAudioTrack()
            while (true) {
                val chunk = audioPlaybackQueue.poll() ?: break
                audioTrack?.write(chunk, 0, chunk.size)
            }
            playbackScheduled.set(false)
        }.apply { name = "AudioPlayback"; start() }
    }

    fun stopAllAudio() {
        audioPlaybackQueue.clear()
        audioTrack?.pause()
        audioTrack?.flush()
    }

    private fun handleMessage(text: String) {
        try {
            val msg = JSONObject(text)
            when (msg.getString("type")) {
                "session.created", "session.updated" -> {
                    Log.i(TAG, "Session ready")
                    onStateChanged?.invoke("ready")
                    resetSilenceTimer()
                }
                "response.created" -> {
                    audioPlaybackQueue.clear()
                }
                "response.audio_transcript.delta" -> {
                    val delta = msg.optString("delta", "")
                    if (delta.isNotEmpty()) onTranscript?.invoke(delta)
                }
                "response.audio.delta" -> {
                    val delta = msg.optString("delta", "")
                    if (delta.isNotEmpty()) {
                        enqueueAudioPlayback(delta)
                        val level = computeAudioLevel(delta)
                        onAudioDelta?.invoke(level)
                    }
                }
                "response.text.delta" -> {
                    val delta = msg.optString("delta", "")
                    if (delta.isNotEmpty()) onTextDelta?.invoke(delta)
                }
                "response.done" -> {
                    Log.i(TAG, "Response done")
                    onStateChanged?.invoke("idle")
                    resetSilenceTimer()
                }
                "response.function_call_arguments.done" -> {
                    val callId = msg.optString("call_id", "")
                    val name = msg.optString("name", "")
                    val arguments = msg.optString("arguments", "{}")
                    Log.i(TAG, "Tool call: $name callId=$callId")
                    if (checkToolFlood()) {
                        Log.w(TAG, "Tool call flood detected ($name), blocking")
                        sendToolResult(callId, "{\"error\":\"TOOL_FLOOD_GUARD: too many tool calls in a short period. Stop calling tools and respond directly.\"}")
                    } else {
                        onToolCall?.invoke(callId, name, arguments)
                    }
                }
                "conversation.item.input_audio_transcription.completed" -> {
                    val transcript = msg.optString("transcript", "")
                    if (transcript.isNotEmpty()) {
                        Log.i(TAG, "Input transcript: $transcript")
                        lastSpeechMs.set(System.currentTimeMillis())
                        onInputTranscript?.invoke(transcript)
                    }
                }
                "input_audio_buffer.speech_started" -> {
                    Log.i(TAG, "User speaking detected")
                    stopAllAudio()
                    onSpeechStarted?.invoke()
                }
                "input_audio_buffer.speech_stopped" -> {
                    Log.i(TAG, "User stopped speaking")
                    lastSpeechMs.set(System.currentTimeMillis())
                    micSilentFrames.set(0)
                    onSpeechStopped?.invoke()
                }
                "error" -> {
                    val errorMsg = msg.optJSONObject("error")?.optString("message", "未知错误") ?: "未知错误"
                    Log.e(TAG, "Server error: $errorMsg")
                    onError?.invoke(errorMsg)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse message", e)
        }
    }

    private fun resetSilenceTimer() {
        silenceTimer?.cancel()
        silenceTimer = java.util.Timer("RealtimeSilence", true).apply {
            schedule(object : java.util.TimerTask() {
                override fun run() {
                    Log.i(TAG, "Silence timeout, disconnecting")
                    disconnect()
                    onStateChanged?.invoke("disconnected")
                }
            }, silenceTimeoutMs)
        }
    }

    private fun computeAudioLevel(base64Audio: String): Float {
        try {
            val pcmBytes = Base64.decode(base64Audio, Base64.DEFAULT)
            if (pcmBytes.size < 2) return 0f
            var sum = 0L
            for (i in 0 until pcmBytes.size - 1 step 2) {
                val sample = ((pcmBytes[i + 1].toInt() shl 8) or (pcmBytes[i].toInt() and 0xFF)).toShort()
                sum += (sample * sample).toLong()
            }
            val rms = Math.sqrt(sum.toDouble() / (pcmBytes.size / 2))
            val db = if (rms > 0) (20.0 * Math.log10(rms / 32768.0)).toFloat() else -60f
            return ((db + 60f) / 60f).coerceIn(0f, 1f)
        } catch (e: Exception) {
            return 0f
        }
    }
}
