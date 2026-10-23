package com.automation.agent;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.WindowManager;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Manages screen capture via MediaProjection API.
 */
public class ScreenCaptureManager {

    private static final String TAG = "AutoAgent_ScreenCapture";
    private static final int VIRTUAL_DISPLAY_FLAGS = DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY
            | DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC;

    private Context context;
    private MediaProjectionManager projectionManager;
    private MediaProjection mediaProjection;
    private ImageReader imageReader;
    private VirtualDisplay virtualDisplay;
    private boolean hasPermission = false;
    private int screenWidth;
    private int screenHeight;
    private int screenDensity;

    public ScreenCaptureManager(Context context) {
        this.context = context;
        this.projectionManager = (MediaProjectionManager)
                context.getSystemService(Context.MEDIA_PROJECTION_SERVICE);

        // Get screen dimensions
        WindowManager wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        DisplayMetrics metrics = new DisplayMetrics();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            context.getDisplay().getRealMetrics(metrics);
        } else {
            wm.getDefaultDisplay().getRealMetrics(metrics);
        }
        this.screenWidth = metrics.widthPixels;
        this.screenHeight = metrics.heightPixels;
        this.screenDensity = metrics.densityDpi;
    }

    /**
     * Request MediaProjection permission from the user.
     */
    public void requestPermission(Activity activity, int requestCode) {
        Intent intent = projectionManager.createScreenCaptureIntent();
        activity.startActivityForResult(intent, requestCode);
    }

    /**
     * Call this when the permission result is received.
     */
    public void onPermissionGranted(Intent data) {
        mediaProjection = projectionManager.getMediaProjection(Activity.RESULT_OK, data);
        hasPermission = true;
        Log.d(TAG, "MediaProjection permission granted");
    }

    /**
     * Check if we have screen capture permission.
     */
    public boolean hasPermission() {
        return hasPermission;
    }

    /**
     * Capture the current screen and return as base64.
     */
    public void captureScreen(Activity activity, CaptureCallback callback) {
        if (!hasPermission || mediaProjection == null) {
            callback.onError("No MediaProjection permission");
            return;
        }

        try {
            // Create ImageReader
            int format = PixelFormat.RGBA_8888;
            imageReader = ImageReader.newInstance(screenWidth, screenHeight, format, 2);

            // Create VirtualDisplay
            virtualDisplay = mediaProjection.createVirtualDisplay(
                    "AutomationCapture",
                    screenWidth, screenHeight, screenDensity,
                    VIRTUAL_DISPLAY_FLAGS,
                    imageReader.getSurface(),
                    null,
                    null
            );

            // Capture after a short delay to ensure the display is ready
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    Image image = imageReader.acquireLatestImage();
                    if (image != null) {
                        Bitmap bitmap = imageToBitmap(image);
                        image.close();

                        // Convert to base64
                        ByteArrayOutputStream baos = new ByteArrayOutputStream();
                        bitmap.compress(Bitmap.CompressFormat.PNG, 90, baos);
                        byte[] imageBytes = baos.toByteArray();
                        String base64 = android.util.Base64.encodeToString(imageBytes, android.util.Base64.NO_WRAP);

                        bitmap.recycle();
                        cleanup();

                        callback.onSuccess("data:image/png;base64," + base64, screenWidth, screenHeight);
                    } else {
                        cleanup();
                        callback.onError("Failed to acquire image");
                    }
                } catch (Exception e) {
                    cleanup();
                    callback.onError("Capture error: " + e.getMessage());
                }
            }, 200);

        } catch (Exception e) {
            cleanup();
            callback.onError("Setup error: " + e.getMessage());
        }
    }

    private Bitmap imageToBitmap(Image image) {
        Image.Plane[] planes = image.getPlanes();
        ByteBuffer buffer = planes[0].getBuffer();
        int pixelStride = planes[0].getPixelStride();
        int rowStride = planes[0].getRowStride();
        int rowPadding = rowStride - pixelStride * screenWidth;

        Bitmap bitmap = Bitmap.createBitmap(
                screenWidth + rowPadding / pixelStride,
                screenHeight,
                Bitmap.Config.ARGB_8888
        );
        bitmap.copyPixelsFromBuffer(buffer);
        return Bitmap.createBitmap(bitmap, 0, 0, screenWidth, screenHeight);
    }

    private void cleanup() {
        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }
        if (imageReader != null) {
            imageReader.close();
            imageReader = null;
        }
    }

    /**
     * Release all resources.
     */
    public void release() {
        cleanup();
        if (mediaProjection != null) {
            mediaProjection.stop();
            mediaProjection = null;
        }
        hasPermission = false;
    }

    public interface CaptureCallback {
        void onSuccess(String base64, int width, int height);
        void onError(String error);
    }
}