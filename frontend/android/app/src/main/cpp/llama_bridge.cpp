#include "llama_bridge.h"
#include <jni.h>
#include <string>
#include <vector>
#include <cstring>
#include <atomic>
#include <mutex>

#include "llama.h"

// ============================================================
// 全局状态
// ============================================================
static JavaVM* g_jvm = nullptr;
static std::atomic<bool> g_aborted{false};
static std::mutex g_model_mutex;
static llama_model* g_model = nullptr;
static llama_context* g_ctx = nullptr;
static jobject g_bridgeObj = nullptr;

// ============================================================
// JNI OnLoad
// ============================================================
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* reserved) {
    g_jvm = vm;
    return JNI_VERSION_1_6;
}

// ============================================================
// 工具函数
// ============================================================
static void callJavaVoid(JNIEnv* env, jobject obj, const char* method, const char* sig, jstring arg) {
    jclass clazz = env->GetObjectClass(obj);
    if (!clazz) return;
    jmethodID mid = env->GetMethodID(clazz, method, sig);
    if (mid) {
        env->CallVoidMethod(obj, mid, arg);
    }
    env->DeleteLocalRef(clazz);
}

static void sendToken(JNIEnv* env, jobject obj, const std::string& token) {
    jstring jstr = env->NewStringUTF(token.c_str());
    callJavaVoid(env, obj, "onNativeToken", "(Ljava/lang/String;)V", jstr);
    env->DeleteLocalRef(jstr);
}

static void sendComplete(JNIEnv* env, jobject obj, const std::string& content) {
    jstring jstr = env->NewStringUTF(content.c_str());
    callJavaVoid(env, obj, "onNativeComplete", "(Ljava/lang/String;)V", jstr);
    env->DeleteLocalRef(jstr);
}

static void sendError(JNIEnv* env, jobject obj, const std::string& msg) {
    jstring jstr = env->NewStringUTF(msg.c_str());
    callJavaVoid(env, obj, "onNativeError", "(Ljava/lang/String;)V", jstr);
    env->DeleteLocalRef(jstr);
}

// ============================================================
// 初始化采样器链
// ============================================================
static llama_sampler* initSampler(float temperature) {
    auto* chain = llama_sampler_chain_init(llama_sampler_chain_default_params());
    if (temperature > 0.0f) {
        llama_sampler_chain_add(chain, llama_sampler_init_temp(temperature));
    }
    llama_sampler_chain_add(chain, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
    return chain;
}

// ============================================================
// JNI: 加载模型
// ============================================================
extern "C" {

JNIEXPORT jlong JNICALL
Java_com_learning_platform_NativeLlamaBridge_nativeLoadModel(
    JNIEnv* env, jobject thiz, jstring jModelPath, jint nCtx, jint nGpuLayers) {

    std::lock_guard<std::mutex> lock(g_model_mutex);

    if (g_ctx) { llama_free(g_ctx); g_ctx = nullptr; }
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }
    if (g_bridgeObj) { env->DeleteGlobalRef(g_bridgeObj); g_bridgeObj = nullptr; }

    const char* modelPath = env->GetStringUTFChars(jModelPath, nullptr);
    if (!modelPath) return 0;

    g_aborted.store(false);

    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = nGpuLayers;

    g_model = llama_model_load_from_file(modelPath, model_params);
    env->ReleaseStringUTFChars(jModelPath, modelPath);

    if (!g_model) {
        return 0;
    }

    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = nCtx;
    ctx_params.n_batch = nCtx;

    g_ctx = llama_init_from_model(g_model, ctx_params);
    if (!g_ctx) {
        llama_model_free(g_model);
        g_model = nullptr;
        return 0;
    }

    g_bridgeObj = env->NewGlobalRef(thiz);

    return reinterpret_cast<jlong>(g_model);
}

JNIEXPORT void JNICALL
Java_com_learning_platform_NativeLlamaBridge_nativeChat(
    JNIEnv* env, jobject thiz, jlong modelPtr, jstring jPrompt, jint maxTokens, jfloat temperature) {

    if (!g_ctx || !g_model) {
        sendError(env, thiz, "model not loaded");
        return;
    }

    std::lock_guard<std::mutex> lock(g_model_mutex);

    const char* promptStr = env->GetStringUTFChars(jPrompt, nullptr);
    if (!promptStr) return;

    std::string prompt(promptStr);
    env->ReleaseStringUTFChars(jPrompt, promptStr);

    const auto* vocab = llama_model_get_vocab(g_model);

    int n_tokens = llama_tokenize(vocab, prompt.c_str(), prompt.size(), nullptr, 0, true, false);
    if (n_tokens < 0) {
        sendError(env, thiz, "tokenization failed");
        return;
    }

    std::vector<llama_token> tokens(n_tokens);
    llama_tokenize(vocab, prompt.c_str(), prompt.size(), tokens.data(), n_tokens, true, false);

    llama_sampler* smpl = initSampler(temperature);

    llama_batch batch = llama_batch_get_one(tokens.data(), tokens.size());
    if (llama_decode(g_ctx, batch) != 0) {
        sendError(env, thiz, "prefill failed");
        llama_sampler_free(smpl);
        return;
    }

    std::string fullContent;
    for (int i = 0; i < maxTokens && !g_aborted.load(); i++) {
        llama_token new_token = llama_sampler_sample(smpl, g_ctx, -1);

        if (llama_vocab_is_eog(vocab, new_token)) break;

        char buf[128];
        int len = llama_token_to_piece(vocab, new_token, buf, sizeof(buf), 0, false);
        if (len > 0) {
            std::string piece(buf, len);
            fullContent += piece;
            sendToken(env, thiz, piece);
        }

        llama_batch next_batch = llama_batch_get_one(&new_token, 1);
        if (llama_decode(g_ctx, next_batch) != 0) break;
    }

    llama_sampler_free(smpl);
    sendComplete(env, thiz, fullContent);
}

JNIEXPORT void JNICALL
Java_com_learning_platform_NativeLlamaBridge_nativeAbort(
    JNIEnv* env, jobject thiz, jlong modelPtr) {
    g_aborted.store(true);
}

JNIEXPORT void JNICALL
Java_com_learning_platform_NativeLlamaBridge_nativeUnloadModel(
    JNIEnv* env, jobject thiz, jlong modelPtr) {
    std::lock_guard<std::mutex> lock(g_model_mutex);
    g_aborted.store(true);

    if (g_ctx) { llama_free(g_ctx); g_ctx = nullptr; }
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }
    if (g_bridgeObj) { env->DeleteGlobalRef(g_bridgeObj); g_bridgeObj = nullptr; }
}

} // extern "C"