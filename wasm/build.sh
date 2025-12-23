#!/bin/bash

# BFF WASM 编译脚本

echo "=========================================="
echo "BFF Flattener WASM 编译脚本"
echo "=========================================="

# 检查 emcc 是否可用
if ! command -v emcc &> /dev/null; then
    echo ""
    echo "错误: 未找到 Emscripten 编译器 (emcc)"
    echo ""
    echo "请先安装 Emscripten SDK:"
    echo "  1. git clone https://github.com/emscripten-core/emsdk.git"
    echo "  2. cd emsdk"
    echo "  3. ./emsdk install latest"
    echo "  4. ./emsdk activate latest"
    echo "  5. source ./emsdk_env.sh"
    echo ""
    exit 1
fi

echo "使用 Emscripten 版本: $(emcc --version | head -n 1)"
echo ""

# 创建输出目录
mkdir -p ../js

# 编译
echo "编译中..."
make all

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "编译成功!"
    echo "输出文件: js/bff_wasm.js"
    echo "=========================================="
else
    echo ""
    echo "编译失败，请检查错误信息"
    exit 1
fi

