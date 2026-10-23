package com.learning.platform

import android.content.Context
import java.io.File
import kotlin.math.sqrt

class NekoEmbeddingEngine(private val context: Context) {

    private val embeddingDim = 384
    private var ortSession: Any? = null
    private var modelLoaded = false

    fun getEmbedding(text: String): FloatArray {
        if (modelLoaded && ortSession != null) {
            try {
                return runOnnxInference(text)
            } catch (_: Exception) {}
        }
        return hashSeedEmbedding(text)
    }

    fun isAvailable(): Boolean {
        if (modelLoaded) return true
        try {
            val modelFile = File(context.filesDir, "models/all-MiniLM-L6-v2.onnx")
            if (modelFile.exists()) {
                loadOnnxModel(modelFile.absolutePath)
                return true
            }
        } catch (_: Exception) {}
        return false
    }

    private fun loadOnnxModel(modelPath: String) {
        // TODO: 加载 ONNX Runtime 会话
        // val ortEnv = OrtEnvironment.getEnvironment()
        // val sessionOptions = OrtSession.SessionOptions()
        // ortSession = ortEnv.createSession(modelPath, sessionOptions)
        // modelLoaded = true
    }

    private fun runOnnxInference(text: String): FloatArray {
        // TODO: 执行 ONNX 推理
        // 1. 将文本 tokenize
        // 2. 构建 input_ids / attention_mask 张量
        // 3. ortSession.run()
        // 4. 从输出张量提取 last_hidden_state 平均池化
        return hashSeedEmbedding(text)
    }

    private fun hashSeedEmbedding(text: String): FloatArray {
        val seed = text.hashCode().toLong()
        val random = java.util.Random(seed)
        val vector = FloatArray(embeddingDim) { random.nextFloat() }
        val norm = sqrt(vector.sumOf { (it * it).toDouble() }).toFloat()
        for (i in vector.indices) {
            vector[i] /= norm
        }
        return vector
    }
}
