package com.learning.platform

import android.view.View
import android.view.ViewGroup
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "NekoLive2D")
class NekoLive2DPlugin : Plugin() {

    private var live2DView: NekoLive2DView? = null

    companion object {
        var currentView: NekoLive2DView? = null
    }

    @PluginMethod
    fun loadModel(call: PluginCall) {
        val activity = getActivity() ?: run {
            call.reject("No activity available")
            return
        }
        val modelPath = call.getString("modelName", "")

        val view = NekoLive2DView(activity)
        view.updateSettings(NekoLive2DSettings(modelPath = modelPath))

        activity.runOnUiThread {
            val contentView = activity.findViewById<ViewGroup>(android.R.id.content)
            contentView.addView(view)
        }

        live2DView = view
        currentView = view
        call.resolve()
    }

    @PluginMethod
    fun setExpression(call: PluginCall) {
        val expressionId = call.getString("expressionId", "")
        live2DView?.setExpression(expressionId)
        call.resolve()
    }

    @PluginMethod
    fun startMotion(call: PluginCall) {
        val groupId = call.getString("groupId", "")
        val motionId = call.getString("motionId", "")
        live2DView?.setMotion(groupId, motionId)
        call.resolve()
    }

    @PluginMethod
    fun setLipSyncLevel(call: PluginCall) {
        val level = call.getFloat("level", 0f)
        live2DView?.setLipSyncLevel(level)
        call.resolve()
    }

    @PluginMethod
    fun setPosition(call: PluginCall) {
        val x = call.getFloat("x", 0f)
        val y = call.getFloat("y", 0f)
        val scale = call.getFloat("scale", 1.0f)
        live2DView?.let { view ->
            view.updateSettings(view.settings.copy(positionX = x, positionY = y, scale = scale))
        }
        call.resolve()
    }

    @PluginMethod
    fun setOpacity(call: PluginCall) {
        val opacity = call.getFloat("opacity", 1.0f)
        val activity = getActivity()
        live2DView?.let { view ->
            activity?.runOnUiThread {
                if (opacity == 0f) {
                    view.visibility = View.GONE
                    view.isHidden = true
                } else {
                    view.visibility = View.VISIBLE
                    view.isHidden = false
                }
            }
        }
        call.resolve()
    }

    @PluginMethod
    fun unload(call: PluginCall) {
        val activity = getActivity()
        live2DView?.let { view ->
            activity?.runOnUiThread {
                val contentView = activity.findViewById<ViewGroup>(android.R.id.content)
                contentView.removeView(view)
            }
        }
        live2DView = null
        currentView = null
        call.resolve()
    }

    override fun handleOnDestroy() {
        live2DView = null
        currentView = null
        super.handleOnDestroy()
    }
}
