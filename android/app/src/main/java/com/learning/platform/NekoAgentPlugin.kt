package com.learning.platform

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

@CapacitorPlugin(name = "NekoAgent")
class NekoAgentPlugin : Plugin() {

    private var screenCapture: NekoScreenCapture? = null

    @PluginMethod
    fun checkAccessibilityPermission(call: PluginCall) {
        val result = JSObject()
        result.put("enabled", isAccessibilityServiceEnabled())
        call.resolve(result)
    }

    @PluginMethod
    fun requestAccessibilityPermission(call: PluginCall) {
        val activity = getActivity() ?: run {
            call.reject("No activity available")
            return
        }
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        activity.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun getUIHierarchy(call: PluginCall) {
        val service = NekoAccessibilityService.instance
        if (service == null) {
            call.reject("Accessibility service not connected")
            return
        }
        val hierarchy = service.getUIHierarchy()
        if (hierarchy == null) {
            call.reject("Unable to get UI hierarchy")
            return
        }
        val result = JSObject()
        result.put("hierarchy", hierarchy)
        call.resolve(result)
    }

    @PluginMethod
    fun click(call: PluginCall) {
        val x = call.getInt("x", 0)
        val y = call.getInt("y", 0)
        NekoAccessibilityService.instance?.click(x, y)
        call.resolve()
    }

    @PluginMethod
    fun longClick(call: PluginCall) {
        val x = call.getInt("x", 0)
        val y = call.getInt("y", 0)
        NekoAccessibilityService.instance?.longClick(x, y)
        call.resolve()
    }

    @PluginMethod
    fun scroll(call: PluginCall) {
        val startX = call.getInt("startX", 0)
        val startY = call.getInt("startY", 0)
        val endX = call.getInt("endX", 0)
        val endY = call.getInt("endY", 0)
        NekoAccessibilityService.instance?.scroll(startX, startY, endX, endY)
        call.resolve()
    }

    @PluginMethod
    fun inputText(call: PluginCall) {
        val text = call.getString("text", "")
        if (text.isEmpty()) {
            call.reject("Text is empty")
            return
        }
        NekoAccessibilityService.instance?.inputText(text)
        call.resolve()
    }

    @PluginMethod
    fun goBack(call: PluginCall) {
        NekoAccessibilityService.instance?.goBack()
        call.resolve()
    }

    @PluginMethod
    fun goHome(call: PluginCall) {
        NekoAccessibilityService.instance?.goHome()
        call.resolve()
    }

    @PluginMethod
    fun openApp(call: PluginCall) {
        val packageName = call.getString("packageName", "")
        if (packageName.isEmpty()) {
            call.reject("Package name is empty")
            return
        }
        val intent = getContext().packageManager.getLaunchIntentForPackage(packageName)
        if (intent != null) {
            getContext().startActivity(intent)
            call.resolve()
        } else {
            call.reject("App not found: $packageName")
        }
    }

    @PluginMethod
    fun waitForUI(call: PluginCall) {
        val intervalMs = call.getLong("intervalMs", 500L)
        val timeoutMs = call.getLong("timeoutMs", 10000L)
        val success = NekoAccessibilityService.instance?.waitForUI(intervalMs, timeoutMs) ?: false
        val result = JSObject()
        result.put("success", success)
        call.resolve(result)
    }

    @PluginMethod
    fun requestScreenCapture(call: PluginCall) {
        val activity = getActivity() ?: run {
            call.reject("No activity available")
            return
        }
        val projectionManager = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(call, projectionManager.createScreenCaptureIntent(), "captureCallback")
    }

    @ActivityCallback
    private fun captureCallback(call: PluginCall, result: com.getcapacitor.ActivityResult) {
        if (result.resultCode == Activity.RESULT_OK) {
            val ctx = getContext()
            screenCapture = NekoScreenCapture(ctx)
            screenCapture?.setProjectionData(result.resultCode, result.data!!)
            call.resolve()
        } else {
            call.reject("Screen capture permission denied")
        }
    }

    @PluginMethod
    fun captureScreen(call: PluginCall) {
        // Hide Live2D before capture, restore after
        val live2DView = NekoLive2DPlugin.currentView
        val activity = getActivity()

        if (live2DView != null && activity != null) {
            activity.runOnUiThread {
                live2DView.visibility = android.view.View.GONE
                live2DView.isHidden = true
            }
        }

        try {
            Thread.sleep(50)
        } catch (_: InterruptedException) {}

        val capture = screenCapture?.captureScreen()

        if (live2DView != null && activity != null) {
            activity.runOnUiThread {
                live2DView.visibility = android.view.View.VISIBLE
                live2DView.isHidden = false
            }
        }

        if (capture == null) {
            call.reject("Screen capture failed")
            return
        }
        val result = JSObject()
        result.put("screenshot", capture)
        call.resolve(result)
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val ctx = getContext()
        val service = "${ctx.packageName}/${NekoAccessibilityService::class.java.canonicalName}"
        val enabledServices = Settings.Secure.getString(
            ctx.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        return enabledServices.split(':').any { it.equals(service, ignoreCase = true) }
    }

    private fun Map<String, Any?>.toJSObject(): JSONObject {
        val obj = JSONObject()
        for ((key, value) in this) {
            obj.put(key, value)
        }
        return obj
    }
}
