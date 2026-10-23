package com.learning.platform

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

class NekoLive2DFloatingService : Service() {

    companion object {
        const val CHANNEL_ID = "neko_live2d_floating"
        const val NOTIFICATION_ID = 4242
        const val ACTION_LOAD = "com.learning.platform.ACTION_LOAD_MODEL"
        const val ACTION_STOP = "com.learning.platform.ACTION_STOP"
        const val EXTRA_MODEL_NAME = "model_name"

        @Volatile var instance: NekoLive2DFloatingService? = null
            private set
        @Volatile var webView: WebView? = null
            private set
    }

    private var windowManager: WindowManager? = null
    private var floatingView: FrameLayout? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_LOAD -> {
                val modelName = intent.getStringExtra(EXTRA_MODEL_NAME) ?: "yinlang"
                showFloatingWindow(modelName)
            }
            ACTION_STOP -> {
                hideFloatingWindow()
                stopSelf()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        hideFloatingWindow()
        instance = null
        super.onDestroy()
    }

    private fun showFloatingWindow(modelName: String) {
        if (floatingView != null) return

        val params = WindowManager.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            x = 0
            y = 0
        }

        floatingView = FrameLayout(this)

        webView = WebView(this).apply {
            setBackgroundColor(0x00000000)
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
                    allowFileAccessFromFileURLs = true
                    allowUniversalAccessFromFileURLs = true
                }
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_NO_CACHE
            }
            isFocusable = false
            isClickable = false
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    view?.evaluateJavascript("Live2DBridge.load('$modelName')", null)
                }
            }
            webChromeClient = WebChromeClient()
        }

        floatingView?.addView(webView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))

        windowManager?.addView(floatingView, params)

        val htmlPath = "file:///android_asset/public/live2d-overlay/overlay.html"
        webView?.loadUrl(htmlPath)
    }

    private fun hideFloatingWindow() {
        webView?.let {
            it.evaluateJavascript("Live2DBridge.unload()", null)
            floatingView?.removeView(it)
            it.destroy()
        }
        webView = null
        floatingView?.let {
            windowManager?.removeView(it)
        }
        floatingView = null
    }

    fun evalJs(js: String) {
        webView?.post { webView?.evaluateJavascript(js, null) }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "灵枢 Live2D",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "灵枢 Live2D 悬浮窗"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("灵枢")
                .setContentText("Live2D 悬浮窗运行中")
                .setSmallIcon(android.R.drawable.ic_menu_gallery)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build()
        } else {
            Notification.Builder(this)
                .setContentTitle("灵枢")
                .setContentText("Live2D 悬浮窗运行中")
                .setSmallIcon(android.R.drawable.ic_menu_gallery)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(Notification.PRIORITY_LOW)
                .build()
        }
    }
}
