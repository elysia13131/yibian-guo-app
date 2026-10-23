package com.automation.agent;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import android.util.Log;

import androidx.annotation.NonNull;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "AutomationAgent")
public class AutomationAgentPlugin extends Plugin {

    private static final String TAG = "AutoAgent";
    private static final int REQUEST_MEDIA_PROJECTION = 1001;
    private static final int REQUEST_ACCESSIBILITY_SETTINGS = 1002;

    private AutomationState state;
    private ActionExecutor actionExecutor;
    private ScreenCaptureManager screenCaptureManager;
    private AccessibilityBridge accessibilityBridge;
    private boolean isMediaProjectionRequested = false;

    @Override
    public void load() {
        super.load();
        state = new AutomationState();
        actionExecutor = new ActionExecutor(getContext());
        screenCaptureManager = new ScreenCaptureManager(getContext());
        accessibilityBridge = new AccessibilityBridge(getContext());

        // Try to bind to the accessibility service if it's running
        accessibilityBridge.tryBind();
        Log.d(TAG, "Automation Agent Plugin loaded");
    }

    @PluginMethod
    public void setup(PluginCall call) {
        String targetPackage = call.getString("targetPackage", "");
        String serverUrl = call.getString("serverUrl", "");

        state.setTargetPackage(targetPackage);
        state.setServerUrl(serverUrl);

        // Check if Accessibility Service is enabled
        boolean accessibilityEnabled = isAccessibilityServiceEnabled();
        if (!accessibilityEnabled) {
            call.reject("Accessibility Service is not enabled. Please enable it in Settings > Accessibility > AutomationAgent");
            return;
        }

        // Check if we can capture screen (we'll request on demand)
        JSObject result = new JSObject();
        result.put("success", true);
        result.put("message", "Automation Agent initialized" +
                (targetPackage.isEmpty() ? "" : " for package: " + targetPackage));
        call.resolve(result);
    }

    @PluginMethod
    public void checkStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("accessibilityConnected", accessibilityBridge.isConnected());
        result.put("canCaptureScreen", screenCaptureManager.hasPermission());
        result.put("isAutomating", state.isAutomating());
        call.resolve(result);
    }

    @PluginMethod
    public void captureScreen(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available");
            return;
        }

        if (!screenCaptureManager.hasPermission()) {
            // Request MediaProjection permission
            isMediaProjectionRequested = true;
            saveCall(call);
            screenCaptureManager.requestPermission(activity, REQUEST_MEDIA_PROJECTION);
            return;
        }

        screenCaptureManager.captureScreen(activity, new ScreenCaptureManager.CaptureCallback() {
            @Override
            public void onSuccess(String base64, int width, int height) {
                JSObject result = new JSObject();
                result.put("base64", base64);
                result.put("width", width);
                result.put("height", height);
                call.resolve(result);
            }

            @Override
            public void onError(String error) {
                call.reject("Screen capture failed: " + error);
            }
        });
    }

    @PluginMethod
    public void getLayoutTree(PluginCall call) {
        if (!accessibilityBridge.isConnected()) {
            call.reject("Accessibility Service not connected");
            return;
        }

        try {
            JSONObject tree = accessibilityBridge.getLayoutTree();
            JSObject result = new JSObject();
            result.put("tree", new JSObject(tree.toString()));
            result.put("timestamp", System.currentTimeMillis());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to get layout tree: " + e.getMessage());
        }
    }

    @PluginMethod
    public void executeAction(PluginCall call) {
        JSObject actionObj = call.getObject("action", new JSObject());
        ActionExecutor.AutomationAction action = parseAction(actionObj);
        if (action == null) {
            call.reject("Invalid action");
            return;
        }

        actionExecutor.execute(action, accessibilityBridge, new ActionExecutor.ActionCallback() {
            @Override
            public void onSuccess() {
                JSObject result = new JSObject();
                result.put("success", true);
                result.put("action", actionObj);
                call.resolve(result);
            }

            @Override
            public void onError(String error) {
                JSObject result = new JSObject();
                result.put("success", false);
                result.put("action", actionObj);
                result.put("error", error);
                call.resolve(result);
            }
        });
    }

    @PluginMethod
    public void executeActions(PluginCall call) {
        JSArray actionsArray = call.getArray("actions", new JSArray());
        List<ActionExecutor.AutomationAction> actions = new ArrayList<>();

        for (int i = 0; i < actionsArray.length(); i++) {
            try {
                JSObject obj = actionsArray.getJSObject(i);
                ActionExecutor.AutomationAction action = parseAction(obj);
                if (action != null) {
                    actions.add(action);
                }
            } catch (JSONException e) {
                Log.e(TAG, "Failed to parse action at index " + i, e);
            }
        }

        if (actions.isEmpty()) {
            call.reject("No valid actions provided");
            return;
        }

        actionExecutor.executeBatch(actions, accessibilityBridge, new ActionExecutor.BatchCallback() {
            @Override
            public void onComplete(List<JSObject> results) {
                JSArray resultArray = new JSArray();
                for (JSObject r : results) {
                    resultArray.put(r);
                }
                JSObject result = new JSObject();
                result.put("results", resultArray);
                call.resolve(result);
            }

            @Override
            public void onError(int index, String error) {
                call.reject("Action " + index + " failed: " + error);
            }
        });
    }

    @PluginMethod
    public void startAutomation(PluginCall call) {
        String task = call.getString("task", "");
        int maxSteps = call.getInt("maxSteps", 30);

        if (task.isEmpty()) {
            call.reject("Task description is required");
            return;
        }

        state.setTask(task);
        state.setMaxSteps(maxSteps);
        state.setAutomating(true);
        state.clearLogs();
        state.setSessionId("session_" + System.currentTimeMillis());

        JSObject result = new JSObject();
        result.put("sessionId", state.getSessionId());
        call.resolve(result);
    }

    @PluginMethod
    public void stopAutomation(PluginCall call) {
        state.setAutomating(false);
        call.resolve();
    }

    @PluginMethod
    public void getSessionLog(PluginCall call) {
        JSObject result = new JSObject();
        result.put("logs", state.getLogsAsJSArray());
        result.put("status", state.getStatusString());
        call.resolve(result);
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);

        if (requestCode == REQUEST_MEDIA_PROJECTION && isMediaProjectionRequested) {
            isMediaProjectionRequested = false;
            if (resultCode == Activity.RESULT_OK && data != null) {
                screenCaptureManager.onPermissionGranted(data);
                PluginCall savedCall = getSavedCall();
                if (savedCall != null) {
                    captureScreen(savedCall);
                }
            } else {
                PluginCall savedCall = getSavedCall();
                if (savedCall != null) {
                    savedCall.reject("Screen capture permission denied");
                }
            }
        }
    }

    private boolean isAccessibilityServiceEnabled() {
        Context context = getContext();
        String service = context.getPackageName() + "/.AutomationAccessibilityService";
        try {
            String enabledServices = Settings.Secure.getString(
                    context.getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            );
            return enabledServices != null && enabledServices.contains(service);
        } catch (Exception e) {
            Log.e(TAG, "Failed to check accessibility service", e);
            return false;
        }
    }

    private ActionExecutor.AutomationAction parseAction(JSObject obj) {
        if (obj == null) return null;

        ActionExecutor.AutomationAction action = new ActionExecutor.AutomationAction();
        action.type = obj.optString("type", "tap");
        action.x = obj.optInt("x", -1);
        action.y = obj.optInt("y", -1);
        action.endX = obj.optInt("endX", -1);
        action.endY = obj.optInt("endY", -1);
        action.text = obj.optString("text", "");
        action.duration = obj.optInt("duration", 500);
        action.packageName = obj.optString("packageName", "");
        action.targetText = obj.optString("targetText", "");
        action.targetDescription = obj.optString("targetDescription", "");
        action.reasoning = obj.optString("reasoning", "");
        return action;
    }

    // Simple saved call handling for MediaProjection callback
    private PluginCall savedCall = null;

    private void saveCall(PluginCall call) {
        this.savedCall = call;
    }

    private PluginCall getSavedCall() {
        PluginCall call = this.savedCall;
        this.savedCall = null;
        return call;
    }
}