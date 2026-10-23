package com.learning.platform;

import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "LlamaPlugin")
public class LlamaPlugin extends Plugin {

    private static final String TAG = "LlamaPlugin";
    private final NativeLlamaBridge bridge = new NativeLlamaBridge();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean isRunning = new AtomicBoolean(false);
    private volatile String modelDir = "";

    @PluginMethod
    public void loadModel(PluginCall call) {
        String dir = call.getString("modelDir", "");
        int nCtx = call.getInt("nCtx", 2048);
        int nGpuLayers = call.getInt("nGpuLayers", 99);

        if (dir.isEmpty()) {
            call.reject("modelDir 不能为空");
            return;
        }

        if (!NativeLlamaBridge.isNativeAvailable()) {
            call.reject("llama.cpp 原生库未加载，请确认已编译并打包");
            return;
        }

        executor.execute(() -> {
            try {
                String modelPath = dir + "/model.gguf";
                Log.i(TAG, "加载模型: " + modelPath);
                boolean ok = bridge.loadModel(modelPath, nCtx, nGpuLayers);
                if (ok) {
                    modelDir = dir;
                    call.resolve();
                } else {
                    call.reject("模型加载失败: " + modelPath);
                }
            } catch (Exception e) {
                Log.e(TAG, "加载模型异常", e);
                call.reject("模型加载异常: " + e.getMessage());
            }
        });
    }

    private String formatChatML(JSArray messages) throws JSONException {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < messages.length(); i++) {
            JSONObject msg = messages.getJSONObject(i);
            String role = msg.getString("role");
            String content = msg.getString("content");
            sb.append("<|im_start|>").append(role).append("\n").append(content).append("<|im_end|>\n");
        }
        sb.append("<|im_start|>assistant\n");
        return sb.toString();
    }

    @PluginMethod
    public void startChat(PluginCall call) {
        if (!bridge.isLoaded()) {
            call.reject("模型未加载，请先调用 loadModel");
            return;
        }

        JSArray jsMessages = call.getArray("messages");
        int maxTokens = call.getInt("maxTokens", 2048);
        double temperature = call.getDouble("temperature", 0.7);

        if (jsMessages == null) {
            call.reject("messages 不能为空");
            return;
        }

        call.resolve();
        isRunning.set(true);

        executor.execute(() -> {
            try {
                String prompt = formatChatML(jsMessages);
                bridge.chat(prompt, maxTokens, (float) temperature,
                    new NativeLlamaBridge.OnTokenCallback() {
                        @Override
                        public void onToken(String token) {
                            if (!isRunning.get()) return;
                            JSObject data = new JSObject();
                            data.put("token", token);
                            notifyListeners("chatToken", data);
                        }

                        @Override
                        public void onComplete(String fullContent) {
                            isRunning.set(false);
                            JSObject data = new JSObject();
                            data.put("content", fullContent);
                            notifyListeners("chatDone", data);
                        }

                        @Override
                        public void onError(String message) {
                            isRunning.set(false);
                            JSObject data = new JSObject();
                            data.put("message", message);
                            notifyListeners("chatError", data);
                        }
                    });
            } catch (Exception e) {
                isRunning.set(false);
                Log.e(TAG, "推理异常", e);
                JSObject data = new JSObject();
                data.put("message", "推理异常: " + e.getMessage());
                notifyListeners("chatError", data);
            }
        });
    }

    @PluginMethod
    public void abortChat(PluginCall call) {
        isRunning.set(false);
        bridge.abort();
        call.resolve();
    }

    @PluginMethod
    public void unloadModel(PluginCall call) {
        isRunning.set(false);
        bridge.unload();
        modelDir = "";
        call.resolve();
    }

    @PluginMethod
    public void getModelStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("loaded", bridge.isLoaded());
        result.put("modelId", modelDir.isEmpty() ? "" : modelDir);
        call.resolve(result);
    }
}