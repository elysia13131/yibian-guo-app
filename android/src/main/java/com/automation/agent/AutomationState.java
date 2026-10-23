package com.automation.agent;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Manages the state of the automation agent.
 * Tracks current task, session log, and automation status.
 */
public class AutomationState {

    private static final String TAG = "AutoAgent_State";

    private String targetPackage = "";
    private String serverUrl = "";
    private String task = "";
    private int maxSteps = 30;
    private boolean isAutomating = false;
    private String sessionId = "";
    private List<SessionLogEntry> logs = new ArrayList<>();

    public String getTargetPackage() { return targetPackage; }
    public void setTargetPackage(String pkg) { this.targetPackage = pkg; }

    public String getServerUrl() { return serverUrl; }
    public void setServerUrl(String url) { this.serverUrl = url; }

    public String getTask() { return task; }
    public void setTask(String task) { this.task = task; }

    public int getMaxSteps() { return maxSteps; }
    public void setMaxSteps(int steps) { this.maxSteps = steps; }

    public boolean isAutomating() { return isAutomating; }
    public void setAutomating(boolean automating) { this.isAutomating = automating; }

    public String getSessionId() { return sessionId; }
    public void setSessionId(String id) { this.sessionId = id; }

    public void addLog(SessionLogEntry entry) {
        logs.add(entry);
        Log.d(TAG, "Step " + entry.step + ": " + entry.actionType);
    }

    public void clearLogs() { logs.clear(); }

    public JSONArray getLogsAsJSArray() {
        JSONArray array = new JSONArray();
        for (SessionLogEntry entry : logs) {
            try {
                JSONObject obj = new JSONObject();
                obj.put("step", entry.step);
                obj.put("timestamp", entry.timestamp);
                obj.put("action", entry.actionType);
                obj.put("success", entry.success);
                obj.put("llmResponse", entry.llmResponse);
                array.put(obj);
            } catch (Exception e) {
                Log.e(TAG, "Failed to serialize log", e);
            }
        }
        return array;
    }

    public String getStatusString() {
        if (!isAutomating) return "idle";
        return logs.isEmpty() ? "running" : "running";
    }

    public static class SessionLogEntry {
        public int step;
        public String timestamp;
        public String actionType;
        public boolean success;
        public String llmResponse;
        public String error;

        public SessionLogEntry(int step, String actionType, boolean success, String llmResponse) {
            this.step = step;
            this.timestamp = String.valueOf(System.currentTimeMillis());
            this.actionType = actionType;
            this.success = success;
            this.llmResponse = llmResponse;
        }
    }
}