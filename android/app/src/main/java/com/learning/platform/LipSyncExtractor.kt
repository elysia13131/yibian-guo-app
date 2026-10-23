package com.learning.platform

import android.media.audiofx.Visualizer

class LipSyncExtractor {

    private var visualizer: Visualizer? = null
    private var isRunning = false

    var onLevelUpdate: ((Float) -> Unit)? = null

    fun start(audioSessionId: Int = 0) {
        if (isRunning) return

        try {
            visualizer = Visualizer(audioSessionId).apply {
                enabled = false
                captureSize = Visualizer.getCaptureSizeRange()[0]

                setDataCaptureListener(
                    object : Visualizer.OnDataCaptureListener {
                        override fun onWaveFormDataCapture(
                            visualizer: Visualizer?,
                            waveform: ByteArray?,
                            samplingRate: Int
                        ) {
                            if (waveform != null) {
                                val level = calculateLevel(waveform)
                                onLevelUpdate?.invoke(level)
                            }
                        }

                        override fun onFftDataCapture(
                            visualizer: Visualizer?,
                            fft: ByteArray?,
                            samplingRate: Int
                        ) {
                        }
                    },
                    Visualizer.getMaxCaptureRate() / 2,
                    true,
                    false
                )

                enabled = true
                isRunning = true
            }
        } catch (e: Exception) {
            visualizer = null
            isRunning = false
        }
    }

    fun stop() {
        if (!isRunning) return

        try {
            visualizer?.enabled = false
            visualizer?.release()
        } catch (e: Exception) {
        }

        visualizer = null
        isRunning = false
    }

    private fun calculateLevel(waveform: ByteArray): Float {
        var sum = 0f
        for (sample in waveform) {
            sum += abs(sample.toInt())
        }
        val average = sum / waveform.size
        return (average / 128f).coerceIn(0f, 1f)
    }

    private fun abs(value: Int): Int = if (value < 0) -value else value
}
