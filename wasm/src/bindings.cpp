/**
 * Emscripten绑定 - 将C++ BFF算法导出到JavaScript
 */

#include <emscripten/bind.h>
#include <emscripten/val.h>
#include "bff_flattener.h"

using namespace emscripten;

// 全局flattener实例
static bff::BFFFlattener* g_flattener = nullptr;

// 初始化
void init() {
    if (g_flattener) {
        delete g_flattener;
    }
    g_flattener = new bff::BFFFlattener();
}

// 清理
void cleanup() {
    if (g_flattener) {
        delete g_flattener;
        g_flattener = nullptr;
    }
}

// 设置网格数据
void setMesh(val vertices, val faces) {
    if (!g_flattener) {
        init();
    }
    
    // 获取数组长度
    int numVertices = vertices["length"].as<int>() / 3;
    int numFaces = faces["length"].as<int>() / 3;
    
    // 复制顶点数据
    std::vector<double> verts(numVertices * 3);
    for (int i = 0; i < numVertices * 3; i++) {
        verts[i] = vertices[i].as<double>();
    }
    
    // 复制面数据
    std::vector<int> faceData(numFaces * 3);
    for (int i = 0; i < numFaces * 3; i++) {
        faceData[i] = faces[i].as<int>();
    }
    
    g_flattener->setMesh(verts.data(), numVertices, faceData.data(), numFaces);
}

// 添加缝线边
void addSeamEdge(int v1, int v2) {
    if (g_flattener) {
        g_flattener->addSeamEdge(v1, v2);
    }
}

// 清除缝线
void clearSeams() {
    if (g_flattener) {
        g_flattener->clearSeams();
    }
}

// 执行展开
bool flatten() {
    if (!g_flattener) return false;
    return g_flattener->flatten();
}

// 获取UV结果
val getUVCoords() {
    if (!g_flattener) {
        return val::null();
    }
    
    const std::vector<double>& uvs = g_flattener->getUVCoords();
    
    // 创建Float64Array返回
    val result = val::global("Float64Array").new_(uvs.size());
    for (size_t i = 0; i < uvs.size(); i++) {
        result.set(i, uvs[i]);
    }
    
    return result;
}

// 获取UV数量
int getUVCount() {
    if (!g_flattener) return 0;
    return g_flattener->getUVCount();
}

// 获取错误信息
std::string getError() {
    if (!g_flattener) return "Not initialized";
    return g_flattener->getError();
}

// 导出到JavaScript
EMSCRIPTEN_BINDINGS(bff_module) {
    function("init", &init);
    function("cleanup", &cleanup);
    function("setMesh", &setMesh);
    function("addSeamEdge", &addSeamEdge);
    function("clearSeams", &clearSeams);
    function("flatten", &flatten);
    function("getUVCoords", &getUVCoords);
    function("getUVCount", &getUVCount);
    function("getError", &getError);
}

