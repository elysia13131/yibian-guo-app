package com.learning.platform

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlin.math.sqrt
import org.json.JSONArray
import org.json.JSONObject

class NekoMemoryDB(context: Context) : SQLiteOpenHelper(
    context, "neko_memory.db", null, 1
) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE recent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                embedding TEXT
            )
        """.trimIndent())
        db.execSQL("CREATE INDEX idx_recent_messages_timestamp ON recent_messages(timestamp)")

        db.execSQL("""
            CREATE TABLE user_facts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fact_key TEXT NOT NULL,
                fact_value TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'general',
                confidence REAL NOT NULL DEFAULT 1.0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                embedding TEXT
            )
        """.trimIndent())
        db.execSQL("CREATE INDEX idx_user_facts_category ON user_facts(category)")
        db.execSQL("CREATE INDEX idx_user_facts_fact_key ON user_facts(fact_key)")

        db.execSQL("""
            CREATE TABLE reflections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                source_message_ids TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
        """.trimIndent())
        db.execSQL("CREATE INDEX idx_reflections_created_at ON reflections(created_at)")

        db.execSQL("""
            CREATE TABLE persona (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trait_key TEXT NOT NULL,
                trait_value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )
        """.trimIndent())
        db.execSQL("CREATE INDEX idx_persona_trait_key ON persona(trait_key)")

        db.execSQL("""
            CREATE TABLE user_profile (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dimension TEXT NOT NULL,
                profile_json TEXT NOT NULL,
                confidence REAL NOT NULL DEFAULT 1.0,
                updated_at INTEGER NOT NULL
            )
        """.trimIndent())
        db.execSQL("CREATE INDEX idx_user_profile_dimension ON user_profile(dimension)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS recent_messages")
        db.execSQL("DROP TABLE IF EXISTS user_facts")
        db.execSQL("DROP TABLE IF EXISTS reflections")
        db.execSQL("DROP TABLE IF EXISTS persona")
        db.execSQL("DROP TABLE IF EXISTS user_profile")
        onCreate(db)
    }

    fun addRecentMessage(message: RecentMessage): Long {
        val db = writableDatabase
        val values = ContentValues().apply {
            put("role", message.role)
            put("content", message.content)
            put("timestamp", message.timestamp)
            message.embedding?.let { put("embedding", it) }
        }
        return db.insert("recent_messages", null, values)
    }

    fun getRecentMessages(limit: Int = 50): List<RecentMessage> {
        val db = readableDatabase
        val cursor = db.rawQuery(
            "SELECT id, role, content, timestamp, embedding FROM recent_messages ORDER BY timestamp DESC LIMIT ?",
            arrayOf(limit.toString())
        )
        val messages = mutableListOf<RecentMessage>()
        while (cursor.moveToNext()) {
            messages.add(
                RecentMessage(
                    id = cursor.getLong(0),
                    role = cursor.getString(1),
                    content = cursor.getString(2),
                    timestamp = cursor.getLong(3),
                    embedding = if (cursor.isNull(4)) null else cursor.getString(4)
                )
            )
        }
        cursor.close()
        return messages
    }

    fun saveFact(fact: UserFact): Long {
        val db = writableDatabase
        val values = ContentValues().apply {
            put("fact_key", fact.factKey)
            put("fact_value", fact.factValue)
            put("category", fact.category)
            put("confidence", fact.confidence)
            put("created_at", fact.createdAt)
            put("updated_at", fact.updatedAt)
            fact.embedding?.let { put("embedding", it) }
        }
        return db.insertWithOnConflict("user_facts", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun getAllFacts(): List<UserFact> {
        val db = readableDatabase
        val cursor = db.rawQuery(
            "SELECT id, fact_key, fact_value, category, confidence, created_at, updated_at, embedding FROM user_facts ORDER BY updated_at DESC",
            null
        )
        val facts = mutableListOf<UserFact>()
        while (cursor.moveToNext()) {
            facts.add(
                UserFact(
                    id = cursor.getLong(0),
                    factKey = cursor.getString(1),
                    factValue = cursor.getString(2),
                    category = cursor.getString(3),
                    confidence = cursor.getFloat(4),
                    createdAt = cursor.getLong(5),
                    updatedAt = cursor.getLong(6),
                    embedding = if (cursor.isNull(7)) null else cursor.getString(7)
                )
            )
        }
        cursor.close()
        return facts
    }

    fun searchFactsByEmbedding(queryVector: FloatArray, threshold: Float = 0.7f, limit: Int = 10): List<RecentMessage> {
        val allFacts = getAllFacts()
        val scored = allFacts.mapNotNull { fact ->
            val factEmbedding = fact.embedding?.let { parseEmbedding(it) } ?: return@mapNotNull null
            val similarity = cosineSimilarity(queryVector, factEmbedding)
            if (similarity >= threshold) {
                RecentMessage(role = "fact", content = "${fact.factKey}: ${fact.factValue}", timestamp = fact.updatedAt) to similarity
            } else null
        }
        return scored.sortedByDescending { it.second }.take(limit).map { it.first }
    }

    fun searchMessagesByEmbedding(queryVector: FloatArray, threshold: Float = 0.6f, limit: Int = 10): List<RecentMessage> {
        val messages = getRecentMessages(200)
        val scored = messages.mapNotNull { msg ->
            val msgEmbedding = msg.embedding?.let { parseEmbedding(it) } ?: return@mapNotNull null
            val similarity = cosineSimilarity(queryVector, msgEmbedding)
            if (similarity >= threshold) msg to similarity else null
        }
        return scored.sortedByDescending { it.second }.take(limit).map { it.first }
    }

    fun addReflection(reflection: Reflection): Long {
        val db = writableDatabase
        val values = ContentValues().apply {
            put("content", reflection.content)
            put("source_message_ids", reflection.sourceMessageIds)
            put("created_at", reflection.createdAt)
        }
        return db.insert("reflections", null, values)
    }

    fun getRecentReflections(limit: Int = 10): List<Reflection> {
        val db = readableDatabase
        val cursor = db.rawQuery(
            "SELECT id, content, source_message_ids, created_at FROM reflections ORDER BY created_at DESC LIMIT ?",
            arrayOf(limit.toString())
        )
        val reflections = mutableListOf<Reflection>()
        while (cursor.moveToNext()) {
            reflections.add(
                Reflection(
                    id = cursor.getLong(0),
                    content = cursor.getString(1),
                    sourceMessageIds = cursor.getString(2),
                    createdAt = cursor.getLong(3)
                )
            )
        }
        cursor.close()
        return reflections
    }

    fun savePersona(persona: PersonaEntry): Long {
        val db = writableDatabase
        val values = ContentValues().apply {
            put("trait_key", persona.traitKey)
            put("trait_value", persona.traitValue)
            put("updated_at", persona.updatedAt)
        }
        return db.insertWithOnConflict("persona", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun getAllPersona(): List<PersonaEntry> {
        val db = readableDatabase
        val cursor = db.rawQuery(
            "SELECT id, trait_key, trait_value, updated_at FROM persona ORDER BY updated_at DESC",
            null
        )
        val entries = mutableListOf<PersonaEntry>()
        while (cursor.moveToNext()) {
            entries.add(
                PersonaEntry(
                    id = cursor.getLong(0),
                    traitKey = cursor.getString(1),
                    traitValue = cursor.getString(2),
                    updatedAt = cursor.getLong(3)
                )
            )
        }
        cursor.close()
        return entries
    }

    fun saveUserProfile(profile: UserProfileEntry): Long {
        val db = writableDatabase
        val values = ContentValues().apply {
            put("dimension", profile.dimension)
            put("profile_json", profile.profileJson)
            put("confidence", profile.confidence)
            put("updated_at", profile.updatedAt)
        }
        return db.insertWithOnConflict("user_profile", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun getUserProfile(dimension: String): UserProfileEntry? {
        val db = readableDatabase
        val cursor = db.rawQuery(
            "SELECT id, dimension, profile_json, confidence, updated_at FROM user_profile WHERE dimension = ?",
            arrayOf(dimension)
        )
        val result = if (cursor.moveToFirst()) {
            UserProfileEntry(
                id = cursor.getLong(0),
                dimension = cursor.getString(1),
                profileJson = cursor.getString(2),
                confidence = cursor.getFloat(3),
                updatedAt = cursor.getLong(4)
            )
        } else null
        cursor.close()
        return result
    }

    fun getUserProfile(): String? {
        val db = readableDatabase
        val cursor = db.rawQuery(
            "SELECT profile_json FROM user_profile ORDER BY updated_at DESC LIMIT 1",
            null
        )
        val result = if (cursor.moveToFirst()) cursor.getString(0) else null
        cursor.close()
        return result
    }

    fun getProfileSnapshotForExtraction(): String {
        val db = readableDatabase
        val messageCursor = db.rawQuery(
            "SELECT id, role, content, timestamp FROM recent_messages ORDER BY timestamp DESC LIMIT 30",
            null
        )
        val messages = JSONArray()
        while (messageCursor.moveToNext()) {
            val obj = JSONObject()
            obj.put("id", "mem_" + messageCursor.getLong(0))
            obj.put("role", messageCursor.getString(1))
            obj.put("content", messageCursor.getString(2))
            obj.put("timestamp", messageCursor.getLong(3))
            messages.put(obj)
        }
        messageCursor.close()

        val factCursor = db.rawQuery(
            "SELECT fact_key, fact_value FROM user_facts ORDER BY updated_at DESC",
            null
        )
        val facts = JSONArray()
        while (factCursor.moveToNext()) {
            val obj = JSONObject()
            obj.put("key", factCursor.getString(0))
            obj.put("value", factCursor.getString(1))
            facts.put(obj)
        }
        factCursor.close()

        val result = JSONObject()
        result.put("recentMessages", messages)
        result.put("facts", facts)
        result.put("reflections", JSONArray())
        return result.toString()
    }

    fun clearAll() {
        val db = writableDatabase
        db.execSQL("DELETE FROM recent_messages")
        db.execSQL("DELETE FROM user_facts")
        db.execSQL("DELETE FROM reflections")
        db.execSQL("DELETE FROM persona")
        db.execSQL("DELETE FROM user_profile")
    }

    private fun parseEmbedding(embedding: String): FloatArray? {
        return try {
            embedding.split(",").map { it.trim().toFloat() }.toFloatArray()
        } catch (e: NumberFormatException) {
            null
        }
    }

    private fun cosineSimilarity(a: FloatArray, b: FloatArray): Float {
        val length = maxOf(a.size, b.size)
        var dotProduct = 0f
        var normA = 0f
        var normB = 0f
        for (i in 0 until length) {
            val va = if (i < a.size) a[i] else 0f
            val vb = if (i < b.size) b[i] else 0f
            dotProduct += va * vb
            normA += va * va
            normB += vb * vb
        }
        val denominator = sqrt(normA) * sqrt(normB)
        return if (denominator == 0f) 0f else dotProduct / denominator
    }
}
