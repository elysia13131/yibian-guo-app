package com.learning.platform;

import android.util.Log;

public class NativeLlamaBridge {
    private static final String TAG = "NativeLlama";
    private static boolean nativeLoaded = false;

    static {
        try {
            System.loadLibrary("llama_bridge");
            nativeLoaded = true;
            Log.i(TAG, "llama_bridge native library loaded");
        } catch (UnsatisfiedLinkError e) {
            Log.w(TAG, "llama_bridge native library not found: " + e.getMessage());
        }
    }

    public static boolean isNativeAvailable() {
        return nativeLoaded;
    }

    private long modelPtr = 0;
    private OnTokenCallback tokenCallback;

    public interface OnTokenCallback {
        void onToken(String token);
        void onComplete(String fullContent);
        void onError(String message);
    }

    public boolean loadModel(String modelPath, int nCtx, int nGpuLayers) {
        if (!nativeLoaded) return false;
        modelPtr = nativeLoadModel(modelPath, nCtx, nGpuLayers);
        return modelPtr != 0;
    }

    public void chat(String prompt, int maxTokens, float temperature, OnTokenCallback callback) {
        if (!nativeLoaded || modelPtr == 0) {
            callback.onError("模型未加载");
            return;
        }
        this.tokenCallback = callback;
        nativeChat(modelPtr, prompt, maxTokens, temperature);
    }

    public void abort() {
        if (modelPtr != 0) {
            nativeAbort(modelPtr);
        }
    }

    public void unload() {
        if (modelPtr != 0) {
            nativeUnloadModel(modelPtr);
            modelPtr = 0;
        }
    }

    public boolean isLoaded() {
        return modelPtr != 0;
    }

    public void onNativeToken(String token) {
        if (tokenCallback != null) {
            tokenCallback.onToken(token);
        }
    }

    public void onNativeComplete(String content) {
        if (tokenCallback != null) {
            tokenCallback.onComplete(content);
            tokenCallback = null;
        }
    }

    public void onNativeError(String message) {
        if (tokenCallback != null) {
            tokenCallback.onError(message);
            tokenCallback = null;
        }
    }

    private native long nativeLoadModel(String modelPath, int nCtx, int nGpuLayers);
    private native void nativeChat(long modelPtr, String prompt, int maxTokens, float temperature);
    private native void nativeAbort(long modelPtr);
    private native void nativeUnloadModel(long modelPtr);
}