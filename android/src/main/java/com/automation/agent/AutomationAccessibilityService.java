package com.automation.agent;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Accessibility Service for inspecting the UI and performing actions.
 * Must be enabled in Settings > Accessibility.
 */
public class AutomationAccessibilityService extends AccessibilityService {

    private static final String TAG = "AutoAgent_Accessibility";
    private static AutomationAccessibilityService instance = null;
    private AccessibilityNodeInfo cachedRootNode = null;

    public static AutomationAccessibilityService getInstance() {
        return instance;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Cache the root node when windows change
        if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                || event.getEventType() == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            AccessibilityNodeInfo oldRoot = cachedRootNode;
            cachedRootNode = getRootInActiveWindow();
            if (oldRoot != null) {
                oldRoot.recycle();
            }
        }
    }

    @Override
    public void onInterrupt() {
        Log.d(TAG, "Accessibility service interrupted");
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;

        AccessibilityServiceInfo info = new AccessibilityServiceInfo();
        info.eventTypes = AccessibilityEvent.TYPES_ALL_MASK;
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
        info.flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
                | AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
                | AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;
        info.notificationTimeout = 100;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            info.flags |= AccessibilityServiceInfo.FLAG_INPUT_METHOD_EDITOR;
        }

        setServiceInfo(info);
        Log.d(TAG, "Accessibility Service created");
    }

    @Override
    public void onDestroy() {
        if (cachedRootNode != null) {
            cachedRootNode.recycle();
            cachedRootNode = null;
        }
        instance = null;
        super.onDestroy();
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        Log.d(TAG, "Accessibility Service connected");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    /**
     * Get the current UI layout tree as a JSON object.
     */
    public JSONObject getLayoutTree() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            root = cachedRootNode;
        }
        if (root == null) {
            return new JSONObject();
        }

        JSONObject tree = convertNodeToJson(root);
        root.recycle();
        return tree;
    }

    /**
     * Convert an AccessibilityNodeInfo to a simplified JSON representation.
     */
    private JSONObject convertNodeToJson(AccessibilityNodeInfo node) {
        JSONObject obj = new JSONObject();
        try {
            if (node.getViewIdResourceName() != null) {
                obj.put("resourceId", node.getViewIdResourceName());
            }
            obj.put("className", node.getClassName() != null ? node.getClassName().toString() : "");
            obj.put("text", node.getText() != null ? node.getText().toString() : "");
            obj.put("contentDescription", node.getContentDescription() != null
                    ? node.getContentDescription().toString() : "");
            obj.put("clickable", node.isClickable());
            obj.put("scrollable", node.isScrollable());
            obj.put("checkable", node.isCheckable());
            obj.put("checked", node.isChecked());
            obj.put("enabled", node.isEnabled());
            obj.put("focusable", node.isFocusable());
            obj.put("focused", node.isFocused());
            obj.put("longClickable", node.isLongClickable());
            obj.put("password", node.isPassword());
            obj.put("selected", node.isSelected());
            obj.put("visibleToUser", node.isVisibleToUser());

            // Bounds
            android.graphics.Rect bounds = new android.graphics.Rect();
            node.getBoundsInScreen(bounds);
            JSONObject boundsObj = new JSONObject();
            boundsObj.put("left", bounds.left);
            boundsObj.put("top", bounds.top);
            boundsObj.put("right", bounds.right);
            boundsObj.put("bottom", bounds.bottom);
            obj.put("bounds", boundsObj);

            obj.put("centerX", bounds.centerX());
            obj.put("centerY", bounds.centerY());

            // Children (recursively)
            JSONArray children = new JSONArray();
            for (int i = 0; i < node.getChildCount(); i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) {
                    children.put(convertNodeToJson(child));
                    child.recycle();
                }
            }
            obj.put("children", children);

            // Window info
            if (node.getWindow() != null) {
                obj.put("windowId", node.getWindow().getId());
            }

        } catch (Exception e) {
            Log.e(TAG, "Error converting node to JSON", e);
        }
        return obj;
    }

    /**
     * Find a node by text content.
     */
    public AccessibilityNodeInfo findNodeByText(String text) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) root = cachedRootNode;
        if (root == null) return null;

        Deque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.push(root);

        while (!queue.isEmpty()) {
            AccessibilityNodeInfo current = queue.poll();
            if (current == null) continue;

            CharSequence nodeText = current.getText();
            CharSequence nodeDesc = current.getContentDescription();

            if ((nodeText != null && nodeText.toString().toLowerCase().contains(text.toLowerCase()))
                    || (nodeDesc != null && nodeDesc.toString().toLowerCase().contains(text.toLowerCase()))) {
                // Keep root, recycle others
                if (current != root) {
                    root.recycle();
                }
                return current;
            }

            for (int i = 0; i < current.getChildCount(); i++) {
                AccessibilityNodeInfo child = current.getChild(i);
                if (child != null) {
                    queue.add(child);
                }
            }
        }

        root.recycle();
        return null;
    }

    /**
     * Perform a click on a specific node.
     */
    public boolean performClick(AccessibilityNodeInfo node) {
        if (node == null) return false;
        return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
    }

    /**
     * Perform a long click on a specific node.
     */
    public boolean performLongClick(AccessibilityNodeInfo node) {
        if (node == null) return false;
        return node.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK);
    }

    /**
     * Focus and type text into an input field.
     */
    public boolean performSetText(AccessibilityNodeInfo node, String text) {
        if (node == null) return false;
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
    }

    /**
     * Perform a scroll action.
     */
    public boolean performScroll(AccessibilityNodeInfo node, boolean forward) {
        if (node == null) return false;
        int action = forward ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;
        return node.performAction(action);
    }

    /**
     * Press the back button.
     */
    public boolean performGlobalBack() {
        return performGlobalAction(GLOBAL_ACTION_BACK);
    }

    /**
     * Press the home button.
     */
    public boolean performGlobalHome() {
        return performGlobalAction(GLOBAL_ACTION_HOME);
    }

    /**
     * Open recent apps.
     */
    public boolean performGlobalRecents() {
        return performGlobalAction(GLOBAL_ACTION_RECENTS);
    }

    /**
     * Check if the service is connected.
     */
    public boolean isConnected() {
        return instance != null;
    }
}