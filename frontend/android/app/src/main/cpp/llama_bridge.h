#ifndef LLAMA_BRIDGE_H
#define LLAMA_BRIDGE_H

#include <jni.h>

#ifdef __cplusplus
extern "C" {
#endif

JNIEXPORT jlong JNICALL
Java_com_learning_platform_NativeLlamaBridge_nativeLoadModel(
    JNIEnv* env, jobject thiz, jstring modelPath, jint nCtx, jint nGpuLayers);

JNIEXPORT void JNICALL
Java_com_learning_platform_NativeLlamaBridge_nativeChat(
    JNIEnv* env, jobject thiz, jlong modelPtr, jstring prompt, jint maxTokens, jfloat temperature);

JNIEXPORT void JNICALL
Java_com_learning_platform_NativeLlamaBridge_nativeAbort(
    JNIEnv* env, jobject thiz, jlong modelPtr);

JNIEXPORT void JNICALL
Java_com_learning_platform_NativeLlamaBridge_nativeUnloadModel(
    JNIEnv* env, jobject thiz, jlong modelPtr);

#ifdef __cplusplus
}
#endif

#endif // LLAMA_BRIDGE_H