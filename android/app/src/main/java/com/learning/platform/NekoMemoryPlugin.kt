package com.learning.platform

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject

@CapacitorPlugin(name = "NekoMemory")
class NekoMemoryPlugin : Plugin() {

    private lateinit var db: NekoMemoryDB
    private lateinit var embeddingEngine: NekoEmbeddingEngine

    override fun load() {
        super.load()
        val ctx = bridge?.context ?: return
        db = NekoMemoryDB(ctx)
        embeddingEngine = NekoEmbeddingEngine(ctx)
    }

    @PluginMethod
    fun saveRecentMessage(call: PluginCall) {
        val role = call.getString("role") ?: return
        val content = call.getString("content") ?: return
        val now = System.currentTimeMillis()
        val embeddingVec = embeddingEngine.getEmbedding(content)
        val embeddingStr = embeddingVec.joinToString(",")
        db.addRecentMessage(RecentMessage(role = role, content = content, timestamp = now, embedding = embeddingStr))
        call.resolve(JSObject().apply { put("success", true) })
    }

    @PluginMethod
    fun getRecentMessages(call: PluginCall) {
        val limit = call.getInt("limit", 50)
        val messages = db.getRecentMessages(limit)
        val arr = JSONArray()
        messages.forEach { m ->
            arr.put(JSONObject().apply {
                put("id", "mem_" + m.id)
                put("role", m.role)
                put("content", m.content)
                put("timestamp", m.timestamp)
            })
        }
        call.resolve(JSObject().apply { put("messages", arr) })
    }

    @PluginMethod
    fun saveFact(call: PluginCall) {
        val key = call.getString("key") ?: return
        val value = call.getString("value") ?: return
        val category = call.getString("category", "general")
        val now = System.currentTimeMillis()
        val embeddingVec = embeddingEngine.getEmbedding("$key: $value")
        val embeddingStr = embeddingVec.joinToString(",")
        db.saveFact(UserFact(factKey = key, factValue = value, category = category, createdAt = now, updatedAt = now, embedding = embeddingStr))
        call.resolve(JSObject().apply { put("success", true) })
    }

    @PluginMethod
    fun getAllFacts(call: PluginCall) {
        val facts = db.getAllFacts()
        val arr = JSONArray()
        facts.forEach { f ->
            arr.put(JSONObject().apply {
                put("key", f.factKey)
                put("value", f.factValue)
                put("category", f.category)
            })
        }
        call.resolve(JSObject().apply { put("facts", arr) })
    }

    @PluginMethod
    fun addReflection(call: PluginCall) {
        val content = call.getString("content") ?: return
        val now = System.currentTimeMillis()
        db.addReflection(Reflection(content = content, sourceMessageIds = "", createdAt = now))
        call.resolve(JSObject().apply { put("success", true) })
    }

    @PluginMethod
    fun getRecentReflections(call: PluginCall) {
        val limit = call.getInt("limit", 10)
        val reflections = db.getRecentReflections(limit)
        val arr = JSONArray()
        reflections.forEach { r ->
            arr.put(JSONObject().apply {
                put("id", "ref_" + r.id)
                put("content", r.content)
                put("createdAt", r.createdAt)
                put("relatedFacts", JSONArray())
            })
        }
        call.resolve(JSObject().apply { put("reflections", arr) })
    }

    @PluginMethod
    fun savePersona(call: PluginCall) {
        val name = call.getString("name") ?: return
        val description = call.getString("description", "")
        db.savePersona(PersonaEntry(traitKey = name, traitValue = description))
        call.resolve(JSObject().apply { put("success", true) })
    }

    @PluginMethod
    fun getAllPersona(call: PluginCall) {
        val entries = db.getAllPersona()
        val arr = JSONArray()
        entries.forEach { e ->
            arr.put(JSONObject().apply {
                put("name", e.traitKey)
                put("description", e.traitValue)
                put("isActive", false)
                put("createdAt", e.updatedAt)
            })
        }
        call.resolve(JSObject().apply { put("personas", arr) })
    }

    @PluginMethod
    fun saveUserProfile(call: PluginCall) {
        val profileJson = call.getString("profileJson") ?: return
        db.saveUserProfile(UserProfileEntry(dimension = "profile", profileJson = profileJson))
        call.resolve(JSObject().apply { put("success", true) })
    }

    @PluginMethod
    fun getUserProfile(call: PluginCall) {
        val profile = db.getUserProfile()
        val result = JSObject()
        if (profile != null) {
            try {
                result.put("profile", org.json.JSONObject(profile))
            } catch (_: org.json.JSONException) {
                result.put("profile", profile)
            }
        } else {
            result.put("profile", org.json.JSONObject.NULL)
        }
        call.resolve(result)
    }

    @PluginMethod
    fun getProfileSnapshotForExtraction(call: PluginCall) {
        val snapshot = db.getProfileSnapshotForExtraction()
        val result = JSObject()
        try {
            result.put("snapshot", org.json.JSONObject(snapshot))
        } catch (_: org.json.JSONException) {
            result.put("snapshot", snapshot)
        }
        call.resolve(result)
    }

    @PluginMethod
    fun searchSimilarMemories(call: PluginCall) {
        val query = call.getString("query") ?: return
        val topK = call.getInt("topK", 5)
        val queryVec = embeddingEngine.getEmbedding(query)

        val factResults = db.searchFactsByEmbedding(queryVec, limit = topK)
        val messageResults = db.searchMessagesByEmbedding(queryVec, limit = topK)

        val combined = (factResults + messageResults)
            .distinctBy { it.content }
            .take(topK)

        val arr = JSONArray()
        combined.forEach { r ->
            arr.put(JSONObject().apply {
                put("id", "mem_0")
                put("role", r.role)
                put("content", r.content)
                put("timestamp", r.timestamp)
            })
        }
        call.resolve(JSObject().apply { put("results", arr) })
    }

    @PluginMethod
    fun clearAll(call: PluginCall) {
        db.clearAll()
        call.resolve(JSObject().apply { put("success", true) })
    }
}
