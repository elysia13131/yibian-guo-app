cmake_minimum_required(VERSION 3.18)
project("llama_bridge" C CXX)

set(LLAMA_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp")

# ============================================================
# 使用 llama.cpp 自身的 CMake 构建系统
# 这会自动编译 llava/llama/ggml 库
# ============================================================
if(EXISTS "${LLAMA_CPP_DIR}/CMakeLists.txt")
    add_subdirectory(${LLAMA_CPP_DIR} llama.cpp)

    # Fix: Android NDK 缺少 POSIX_MADV_* 定义
    if(ANDROID)
        target_compile_definitions(llama PRIVATE
            POSIX_MADV_WILLNEED=3
            POSIX_MADV_RANDOM=1
        )
    endif()
else()
    message(FATAL_ERROR "llama.cpp not found at ${LLAMA_CPP_DIR}")
endif()

# ============================================================
# llama_bridge JNI 库
# ============================================================
set(CPP_SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")

add_library(llama_bridge SHARED
    "${CPP_SRC_DIR}/llama_bridge.cpp"
)

target_include_directories(llama_bridge PRIVATE
    "${CPP_SRC_DIR}"
    "${LLAMA_CPP_DIR}/include"
    "${LLAMA_CPP_DIR}/ggml/include"
)

target_link_libraries(llama_bridge PRIVATE
    android
    log
    llama
    ${CMAKE_DL_LIBS}
)