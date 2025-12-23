# BFF Flattener WASM 编译配置
# 需要安装 Emscripten SDK

# 编译器
CXX = em++

# 源文件
SOURCES = src/bff_flattener.cpp src/bindings.cpp

# 输出文件
OUTPUT = ../js/bff_wasm.js

# 编译选项
CXXFLAGS = -O3 \
           -std=c++17 \
           -s WASM=1 \
           -s MODULARIZE=1 \
           -s EXPORT_NAME="BFFModule" \
           -s ALLOW_MEMORY_GROWTH=1 \
           -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
           --bind \
           -s ENVIRONMENT='web,worker' \
           -s SINGLE_FILE=1

# 调试编译选项
DEBUG_FLAGS = -g -s ASSERTIONS=1

.PHONY: all clean debug

all: $(OUTPUT)

$(OUTPUT): $(SOURCES)
	@echo "编译 BFF WASM 模块..."
	$(CXX) $(CXXFLAGS) $(SOURCES) -o $(OUTPUT)
	@echo "编译完成: $(OUTPUT)"

debug: CXXFLAGS += $(DEBUG_FLAGS)
debug: $(OUTPUT)

clean:
	rm -f $(OUTPUT)
	rm -f ../js/bff_wasm.wasm
	@echo "清理完成"

# 帮助信息
help:
	@echo "BFF Flattener WASM 编译工具"
	@echo ""
	@echo "使用方法:"
	@echo "  make        - 编译发布版本"
	@echo "  make debug  - 编译调试版本"
	@echo "  make clean  - 清理编译文件"
	@echo ""
	@echo "前置条件:"
	@echo "  1. 安装 Emscripten SDK"
	@echo "  2. 运行 'source emsdk_env.sh' 激活环境"

