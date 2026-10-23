package com.learning.platform

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.PorterDuff
import android.graphics.SweepGradient
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View

class NekoLive2DView(context: Context) : SurfaceView(context), SurfaceHolder.Callback {

    private var modelLoaded = false
    private var lipSyncLevel = 0f
    private var renderThread: RenderThread? = null
    @Volatile var isHidden = false

    var settings: NekoLive2DSettings = NekoLive2DSettings()

    init {
        setZOrderOnTop(true)
        holder.setFormat(PixelFormat.TRANSPARENT)
        holder.addCallback(this)
    }

    fun updateSettings(newSettings: NekoLive2DSettings) {
        settings = newSettings
    }

    fun setExpression(expressionId: String) {
    }

    fun setMotion(groupId: String, motionId: String) {
    }

    fun setLipSyncLevel(level: Float) {
        lipSyncLevel = level
    }

    fun setModelLoaded(loaded: Boolean) {
        modelLoaded = loaded
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        renderThread = RenderThread()
        renderThread?.start()
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        renderThread?.stopRendering()
        renderThread?.join(1000)
        renderThread = null
    }

    private inner class RenderThread : Thread() {
        private var running = true
        private var hueShift = 0f

        fun stopRendering() {
            running = false
            interrupt()
        }

        override fun run() {
            while (running) {
                if (isHidden) {
                    try { sleep(16) } catch (_: InterruptedException) { break }
                    continue
                }
                val canvas = holder.lockCanvas()
                if (canvas != null) {
                    try {
                        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)

                        if (modelLoaded) {
                            // TODO: Cubism Native 渲染
                        } else {
                            drawPlaceholderCircle(canvas)
                        }
                    } finally {
                        holder.unlockCanvasAndPost(canvas)
                    }
                }
                try {
                    sleep(16)
                } catch (e: InterruptedException) {
                    break
                }
            }
        }

        private fun drawPlaceholderCircle(canvas: Canvas) {
            val width = canvas.width.toFloat()
            val height = canvas.height.toFloat()
            val cx = width / 2f
            val cy = height / 2f
            val baseRadius = minOf(width, height) * 0.3f
            val scaleFactor = 1f + lipSyncLevel * 0.08f
            val radius = baseRadius * scaleFactor

            hueShift = (hueShift + 0.5f) % 360f
            val startColor = Color.HSVToColor(floatArrayOf(hueShift, 0.8f, 1.0f))
            val endColor = Color.HSVToColor(floatArrayOf((hueShift + 60f) % 360f, 0.8f, 0.6f))

            val gradient = SweepGradient(cx, cy, startColor, endColor)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                shader = gradient
                style = Paint.Style.FILL
            }
            canvas.drawCircle(cx, cy, radius, paint)
        }
    }
}
