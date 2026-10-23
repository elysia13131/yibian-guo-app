package com.learning.platform

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.media.ImageReader
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.Display
import androidx.annotation.RequiresApi
import java.io.ByteArrayOutputStream

@RequiresApi(Build.VERSION_CODES.LOLLIPOP)
class NekoScreenCapture(private val context: Context) {

    private var resultCode: Int = Activity.RESULT_CANCELED
    private var data: android.content.Intent? = null
    private var mediaProjection: android.media.projection.MediaProjection? = null
    private var imageReader: ImageReader? = null
    private var virtualDisplay: android.hardware.display.VirtualDisplay? = null

    fun setProjectionData(code: Int, intent: android.content.Intent) {
        resultCode = code
        data = intent
    }

    fun captureScreen(): String? {
        val projectionManager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE)
                as android.media.projection.MediaProjectionManager

        val displayManager = context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        val display = displayManager.getDisplay(Display.DEFAULT_DISPLAY)
        val metrics = android.util.DisplayMetrics()
        display?.getRealMetrics(metrics)

        val width = metrics?.widthPixels ?: return null
        val height = metrics?.heightPixels ?: return null
        val density = metrics?.densityDpi ?: return null

        mediaProjection = projectionManager.getMediaProjection(resultCode, data!!)

        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)

        virtualDisplay = mediaProjection?.createVirtualDisplay(
            "NekoScreenCapture",
            width, height, density!!,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface, null, null
        )

        val image = imageReader?.acquireLatestImage() ?: return null
        val planes = image.planes
        val buffer = planes[0].buffer
        val pixelStride = planes[0].pixelStride
        val rowStride = planes[0].rowStride
        val rowPadding = rowStride - pixelStride * width

        val bitmap = Bitmap.createBitmap(width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888)
        bitmap.copyPixelsFromBuffer(buffer)
        val cropped = Bitmap.createBitmap(bitmap, 0, 0, width, height)

        image.close()

        val output = ByteArrayOutputStream()
        cropped.compress(Bitmap.CompressFormat.PNG, 100, output)
        cropped.recycle()
        bitmap.recycle()

        return Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
    }

    fun cleanup() {
        virtualDisplay?.release()
        imageReader?.close()
        mediaProjection?.stop()
        virtualDisplay = null
        imageReader = null
        mediaProjection = null
    }
}
