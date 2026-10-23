package com.learning.platform

data class RecentMessage(
    val id: Long = 0,
    val role: String,
    val content: String,
    val timestamp: Long = System.currentTimeMillis(),
    val embedding: String? = null
)

data class UserFact(
    val id: Long = 0,
    val factKey: String,
    val factValue: String,
    val category: String = "general",
    val confidence: Float = 1f,
    val createdAt: Long,
    val updatedAt: Long,
    val embedding: String? = null
)

data class Reflection(
    val id: Long = 0,
    val content: String,
    val sourceMessageIds: String,
    val createdAt: Long = System.currentTimeMillis()
)

data class PersonaEntry(
    val id: Long = 0,
    val traitKey: String,
    val traitValue: String,
    val updatedAt: Long = System.currentTimeMillis()
)

data class UserProfileEntry(
    val id: Long = 0,
    val dimension: String,
    val profileJson: String,
    val confidence: Float = 1f,
    val updatedAt: Long = System.currentTimeMillis()
)
