package com.learning.platform

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.view.accessibility.AccessibilityNodeInfo
import androidx.annotation.RequiresApi
import org.json.JSONArray
import org.json.JSONObject

class NekoAccessibilityService : AccessibilityService() {

    companion object {
        var instance: NekoAccessibilityService? = null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: android.view.accessibility.AccessibilityEvent?) {}

    override fun onInterrupt() {}

    fun getUIHierarchy(): String? {
        val root = rootInActiveWindow ?: return null
        return try {
            buildNodeJSON(root).toString()
        } finally {
            root.recycle()
        }
    }

    private fun buildNodeJSON(node: AccessibilityNodeInfo): JSONObject {
        val obj = JSONObject()
        obj.put("viewId", node.viewIdResourceName ?: "")
        obj.put("text", node.text?.toString() ?: "")
        obj.put("className", node.className?.toString() ?: "")
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        val boundsObj = JSONObject()
        boundsObj.put("left", bounds.left)
        boundsObj.put("top", bounds.top)
        boundsObj.put("right", bounds.right)
        boundsObj.put("bottom", bounds.bottom)
        obj.put("bounds", boundsObj)
        obj.put("clickable", node.isClickable)
        val children = JSONArray()
        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            if (child != null) {
                children.put(buildNodeJSON(child))
                child.recycle()
            }
        }
        obj.put("children", children)
        return obj
    }

    private fun buildGesture(clickX: Float, clickY: Float, duration: Long): GestureDescription {
        val path = Path()
        path.moveTo(clickX, clickY)
        return GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, duration))
            .build()
    }

    fun click(x: Int, y: Int) {
        val gesture = buildGesture(x.toFloat(), y.toFloat(), 100L)
        dispatchGesture(gesture, null, null)
    }

    fun longClick(x: Int, y: Int) {
        val gesture = buildGesture(x.toFloat(), y.toFloat(), 600L)
        dispatchGesture(gesture, null, null)
    }

    fun scroll(sx: Int, sy: Int, ex: Int, ey: Int) {
        val path = Path()
        path.moveTo(sx.toFloat(), sy.toFloat())
        path.lineTo(ex.toFloat(), ey.toFloat())
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 300L))
            .build()
        dispatchGesture(gesture, null, null)
    }

    fun inputText(text: String) {
        val root = rootInActiveWindow ?: return
        try {
            val focused = findFocusedNode(root)
            if (focused != null) {
                val args = android.os.Bundle()
                args.putString(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
                focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            }
        } finally {
            root.recycle()
        }
    }

    private fun findFocusedNode(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isFocused) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            if (child != null) {
                val found = findFocusedNode(child)
                if (found != null) return found
                child.recycle()
            }
        }
        return null
    }

    fun goBack(): Boolean {
        return performGlobalAction(GLOBAL_ACTION_BACK)
    }

    fun goHome(): Boolean {
        return performGlobalAction(GLOBAL_ACTION_HOME)
    }

    @RequiresApi(Build.VERSION_CODES.LOLLIPOP)
    fun openRecentApps(): Boolean {
        return performGlobalAction(GLOBAL_ACTION_RECENTS)
    }

    fun waitForUI(intervalMs: Long = 500, timeoutMs: Long = 10000): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (rootInActiveWindow != null) return true
            try {
                Thread.sleep(intervalMs)
            } catch (_: InterruptedException) {
                return false
            }
        }
        return false
    }
}
