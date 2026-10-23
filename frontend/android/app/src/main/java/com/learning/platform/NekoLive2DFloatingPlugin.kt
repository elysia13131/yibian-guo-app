package com.learning.platform

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "NekoLive2DFloating")
class NekoLive2DFloatingPlugin : Plugin() {

    @PluginMethod
    fun show(call: PluginCall) {
        val modelName = call.getString("modelName", "yinlang")
        val activity = getActivity() ?: run {
            call.reject("No activity")
            return
        }
        val intent = Intent(activity, NekoLive2DFloatingService::class.java).apply {
            action = NekoLive2DFloatingService.ACTION_LOAD
            putExtra(NekoLive2DFloatingService.EXTRA_MODEL_NAME, modelName)
        }
        activity.startForegroundService(intent)
        call.resolve()
    }

    @PluginMethod
    fun setExpression(call: PluginCall) {
        val name = call.getString("expression", "neutral")
        val svc = NekoLive2DFloatingService.instance
        if (svc != null) {
            svc.evalJs("Live2DBridge.setExpression('$name')")
            call.resolve()
        } else {
            call.reject("Floating service not running")
        }
    }

    @PluginMethod
    fun startMotion(call: PluginCall) {
        val motionId = call.getInt("motionId", 0)
        val svc = NekoLive2DFloatingService.instance
        if (svc != null) {
            svc.evalJs("Live2DBridge.startMotion(null, $motionId)")
            call.resolve()
        } else {
            call.reject("Floating service not running")
        }
    }

    @PluginMethod
    fun setOpacity(call: PluginCall) {
        val opacity = call.getFloat("opacity", 1.0f)
        val svc = NekoLive2DFloatingService.instance
        if (svc != null) {
            svc.evalJs("document.body.style.opacity = '$opacity'")
            call.resolve()
        } else {
            call.reject("Floating service not running")
        }
    }

    @PluginMethod
    fun hide(call: PluginCall) {
        val activity = getActivity() ?: run {
            call.reject("No activity")
            return
        }
        val intent = Intent(activity, NekoLive2DFloatingService::class.java).apply {
            action = NekoLive2DFloatingService.ACTION_STOP
        }
        activity.startService(intent)
        call.resolve()
    }
}
