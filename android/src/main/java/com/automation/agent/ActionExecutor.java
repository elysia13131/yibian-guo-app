package com.automation.agent;

import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Executes automation actions on the Android device.
 * Uses a combination of AccessibilityService and shell commands for actions.
 */
public class ActionExecutor {

    private static final String TAG = "AutoAgent_Executor";
    private final Context context;
    private Handler mainHandler;

    public ActionExecutor(Context context) {
        this.context = context;
        this.mainHandler = new Handler(Looper.getMainLooper());
    }

    /**
     * Execute a single action.
     */
    public void execute(AutomationAction action, AccessibilityBridge bridge, ActionCallback callback) {
        mainHandler.post(() -> {
            try {
                boolean success = executeInternal(action, bridge);

                if (!success) {
                    // Fall back to shell-based approach for some actions
                    success = executeViaShell(action);
                }

                if (success) {
                    callback.onSuccess();
                } else {
                    callback.onError("Failed to execute: " + action.type);
                }
            } catch (Exception e) {
                Log.e(TAG, "Execution error", e);
                callback.onError(e.getMessage());
            }
        });
    }

    /**
     * Execute a batch of actions sequentially.
     */
    public void executeBatch(List<AutomationAction> actions, AccessibilityBridge bridge,
                             BatchCallback callback) {
        List<JSONObject> results = new ArrayList<>();

        mainHandler.post(() -> {
            for (int i = 0; i < actions.size(); i++) {
                try {
                    AutomationAction action = actions.get(i);
                    boolean success = executeInternal(action, bridge);
                    if (!success) {
                        success = executeViaShell(action);
                    }

                    JSONObject result = new JSONObject();
                    result.put("index", i);
                    result.put("success", success);
                    result.put("action", action.type);
                    results.add(result);

                    // Wait between actions
                    Thread.sleep(500);
                } catch (Exception e) {
                    callback.onError(i, e.getMessage());
                    return;
                }
            }

            // Convert results to JSObject list
            List<JSObject> jsResults = new ArrayList<>();
            for (JSONObject json : results) {
                jsResults.add(new JSObject(json.toString()));
            }
            callback.onComplete(jsResults);
        });
    }

    private boolean executeInternal(AutomationAction action, AccessibilityBridge bridge) {
        AutomationAccessibilityService service = AutomationAccessibilityService.getInstance();

        switch (action.type) {
            case "tap":
                return performTap(action.x, action.y);

            case "long_press":
                return performLongPress(action.x, action.y, action.duration);

            case "swipe":
                return performSwipe(action.x, action.y, action.endX, action.endY, action.duration);

            case "type":
                return performType(action.text);

            case "back":
                if (service != null) {
                    return service.performGlobalBack();
                }
                return executeViaShell(new AutomationAction("back"));

            case "home":
                if (service != null) {
                    return service.performGlobalHome();
                }
                return executeViaShell(new AutomationAction("home"));

            case "recents":
                if (service != null) {
                    return service.performGlobalRecents();
                }
                return false;

            case "scroll_down":
                return performScroll(action.x, action.y, true);

            case "scroll_up":
                return performScroll(action.x, action.y, false);

            case "wait":
                try {
                    Thread.sleep(action.duration);
                    return true;
                } catch (InterruptedException e) {
                    return true; // wait success even if interrupted
                }

            case "find_and_tap":
                if (service != null) {
                    AccessibilityNodeInfo node = null;
                    if (action.targetText != null && !action.targetText.isEmpty()) {
                        node = service.findNodeByText(action.targetText);
                    }
                    if (node != null) {
                        boolean result = service.performClick(node);
                        return result;
                    }
                }
                // Fallback: tap center of screen
                return performTap(action.x >= 0 ? action.x : 540, action.y >= 0 ? action.y : 960);

            default:
                return false;
        }
    }

    /**
     * Perform a tap at the specified coordinates using shell command.
     */
    private boolean performTap(int x, int y) {
        if (x < 0 || y < 0) return false;
        try {
            String cmd = String.format("input tap %d %d", x, y);
            Runtime.getRuntime().exec(new String[]{"su", "-c", cmd});
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Tap failed", e);
            return false;
        }
    }

    /**
     * Perform a long press using shell command.
     */
    private boolean performLongPress(int x, int y, int duration) {
        if (x < 0 || y < 0) return false;
        try {
            String cmd = String.format("input swipe %d %d %d %d %d", x, y, x, y, duration);
            Runtime.getRuntime().exec(new String[]{"su", "-c", cmd});
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Long press failed", e);
            return false;
        }
    }

    /**
     * Perform a swipe gesture.
     */
    private boolean performSwipe(int x1, int y1, int x2, int y2, int duration) {
        if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0) return false;
        try {
            String cmd = String.format("input swipe %d %d %d %d %d", x1, y1, x2, y2, duration);
            Runtime.getRuntime().exec(new String[]{"su", "-c", cmd});
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Swipe failed", e);
            return false;
        }
    }

    /**
     * Type text using shell command.
     */
    private boolean performType(String text) {
        if (text == null || text.isEmpty()) return false;
        try {
            // Escape special characters for shell
            String escaped = text
                    .replace(" ", "%s")
                    .replace("'", "\\'")
                    .replace("\"", "\\\"")
                    .replace("&", "\\\\&");
            String cmd = String.format("input text '%s'", escaped);
            Runtime.getRuntime().exec(new String[]{"su", "-c", cmd});
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Type failed", e);
            return false;
        }
    }

    /**
     * Perform scroll via accessibility service.
     */
    private boolean performScroll(int x, int y, boolean forward) {
        AutomationAccessibilityService service = AutomationAccessibilityService.getInstance();
        if (service == null) return false;

        AccessibilityNodeInfo root = service.getRootInActiveWindow();
        if (root == null) return false;

        // Find scrollable ancestor
        AccessibilityNodeInfo scrollable = findScrollableAncestor(root);
        if (scrollable != null) {
            boolean result = service.performScroll(scrollable, forward);
            return result;
        }
        // Fallback: swipe gesture
        if (x >= 0 && y >= 0) {
            int endY = forward ? y - 500 : y + 500;
            return performSwipe(x, y, x, endY, 300);
        }
        return false;
    }

    private AccessibilityNodeInfo findScrollableAncestor(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isScrollable()) return node;
        AccessibilityNodeInfo parent = node.getParent();
        if (parent != null) {
            AccessibilityNodeInfo result = findScrollableAncestor(parent);
            if (result != null) return result;
        }
        return null;
    }

    /**
     * Execute an action via shell command (su).
     */
    private boolean executeViaShell(AutomationAction action) {
        try {
            String cmd;
            switch (action.type) {
                case "back":
                    cmd = "input keyevent KEYCODE_BACK";
                    break;
                case "home":
                    cmd = "input keyevent KEYCODE_HOME";
                    break;
                case "tap":
                    cmd = String.format("input tap %d %d", action.x, action.y);
                    break;
                case "swipe":
                    cmd = String.format("input swipe %d %d %d %d %d",
                            action.x, action.y, action.endX, action.endY, action.duration);
                    break;
                case "type":
                    cmd = String.format("input text '%s'", action.text);
                    break;
                default:
                    return false;
            }
            Runtime.getRuntime().exec(new String[]{"sh", "-c", cmd});
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Shell exec failed", e);
            return false;
        }
    }

    /**
     * Automation action data class.
     */
    public static class AutomationAction {
        public String type;
        public int x = -1;
        public int y = -1;
        public int endX = -1;
        public int endY = -1;
        public String text = "";
        public int duration = 500;
        public String packageName = "";
        public String targetText = "";
        public String targetDescription = "";
        public String reasoning = "";

        public AutomationAction() {}

        public AutomationAction(String type) {
            this.type = type;
        }
    }

    public interface ActionCallback {
        void onSuccess();
        void onError(String error);
    }

    public interface BatchCallback {
        void onComplete(List<JSObject> results);
        void onError(int index, String error);
    }
}

// Helper class needed for the plugin
import android.content.Context;
import com.getcapacitor.JSObject;
import android.os.Bundle;