package com.automation.agent;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;

/**
 * Bridge between the Capacitor plugin and the Accessibility Service.
 * Handles connection state management.
 */
public class AccessibilityBridge {

    private static final String TAG = "AutoAgent_Bridge";
    private Context context;

    public AccessibilityBridge(Context context) {
        this.context = context;
    }

    /**
     * Try to bind to an already running accessibility service.
     */
    public void tryBind() {
        AutomationAccessibilityService service = AutomationAccessibilityService.getInstance();
        if (service != null) {
            Log.d(TAG, "Accessibility service is already running");
        } else {
            Log.d(TAG, "Accessibility service not yet connected");
        }
    }

    /**
     * Check if the accessibility service is connected.
     */
    public boolean isConnected() {
        return AutomationAccessibilityService.getInstance() != null;
    }

    /**
     * Get the current layout tree via the accessibility service.
     */
    public org.json.JSONObject getLayoutTree() {
        AutomationAccessibilityService service = AutomationAccessibilityService.getInstance();
        if (service != null) {
            return service.getLayoutTree();
        }
        return new org.json.JSONObject();
    }

    /**
     * Find a UI element by text.
     */
    public AccessibilityNodeInfo findNodeByText(String text) {
        AutomationAccessibilityService service = AutomationAccessibilityService.getInstance();
        if (service != null) {
            return service.findNodeByText(text);
        }
        return null;
    }

    /**
     * Perform a global back action.
     */
    public boolean performBack() {
        AutomationAccessibilityService service = AutomationAccessibilityService.getInstance();
        return service != null && service.performGlobalBack();
    }

    /**
     * Perform a global home action.
     */
    public boolean performHome() {
        AutomationAccessibilityService service = AutomationAccessibilityService.getInstance();
        return service != null && service.performGlobalHome();
    }
}

import android.view.accessibility.AccessibilityNodeInfo;