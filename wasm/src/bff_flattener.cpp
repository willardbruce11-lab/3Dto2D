/**
 * BFF (Boundary First Flattening) UV展开算法实现
 */

#include "bff_flattener.h"
#include <queue>
#include <cstring>
#include <limits>

namespace bff {

BFFFlattener::BFFFlattener() {
}

BFFFlattener::~BFFFlattener() {
}

void BFFFlattener::setMesh(const double* vertices, int numVertices,
                           const int* faces, int numFaces) {
    mesh.vertices.clear();
    mesh.faces.clear();
    mesh.halfEdges.clear();
    mesh.vertexHalfEdge.clear();
    mesh.isBoundaryVertex.clear();
    mesh.seamEdges.clear();
    uvResult.clear();
    
    // 复制顶点
    mesh.vertices.resize(numVertices);
    for (int i = 0; i < numVertices; i++) {
        mesh.vertices[i] = Vec3(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]);
    }
    
    // 复制面（三角形）
    mesh.faces.resize(numFaces);
    for (int i = 0; i < numFaces; i++) {
        mesh.faces[i] = {faces[i * 3], faces[i * 3 + 1], faces[i * 3 + 2]};
    }
    
    mesh.vertexHalfEdge.resize(numVertices, -1);
    mesh.isBoundaryVertex.resize(numVertices, false);
    
    // 构建半边结构
    buildHalfEdgeStructure();
    identifyBoundaries();
}

void BFFFlattener::addSeamEdge(int v1, int v2) {
    auto key = edgeKey(v1, v2);
    if (mesh.seamEdges.empty()) {
        mesh.seamEdges.resize(1);
    }
    mesh.seamEdges[0].insert(key.first * 1000000 + key.second);
}

void BFFFlattener::clearSeams() {
    mesh.seamEdges.clear();
}

void BFFFlattener::buildHalfEdgeStructure() {
    mesh.halfEdges.clear();
    
    std::map<std::pair<int, int>, int> edgeToHalfEdge;
    
    for (int faceIdx = 0; faceIdx < (int)mesh.faces.size(); faceIdx++) {
        const auto& face = mesh.faces[faceIdx];
        int numVerts = face.size();
        int firstHE = mesh.halfEdges.size();
        
        for (int i = 0; i < numVerts; i++) {
            HalfEdge he;
            he.vertex = face[(i + 1) % numVerts];
            he.face = faceIdx;
            he.next = firstHE + (i + 1) % numVerts;
            he.prev = firstHE + (i + numVerts - 1) % numVerts;
            he.twin = -1;
            he.isBoundary = false;
            he.isSeam = false;
            
            int heIdx = mesh.halfEdges.size();
            mesh.halfEdges.push_back(he);
            
            // 记录边到半边的映射
            int v1 = face[i];
            int v2 = face[(i + 1) % numVerts];
            edgeToHalfEdge[edgeKey(v1, v2)] = heIdx;
            
            // 设置顶点的半边引用
            if (mesh.vertexHalfEdge[v1] == -1) {
                mesh.vertexHalfEdge[v1] = heIdx;
            }
        }
    }
    
    // 设置twin半边
    for (int heIdx = 0; heIdx < (int)mesh.halfEdges.size(); heIdx++) {
        HalfEdge& he = mesh.halfEdges[heIdx];
        int v1 = mesh.faces[he.face][heIdx % 3];
        int v2 = he.vertex;
        
        auto twinKey = edgeKey(v2, v1);
        auto it = edgeToHalfEdge.find(twinKey);
        
        // 需要找到反向的边
        for (int otherHeIdx = 0; otherHeIdx < (int)mesh.halfEdges.size(); otherHeIdx++) {
            if (otherHeIdx == heIdx) continue;
            HalfEdge& otherHe = mesh.halfEdges[otherHeIdx];
            
            int ov1 = mesh.faces[otherHe.face][otherHeIdx % 3];
            int ov2 = otherHe.vertex;
            
            if (ov1 == v2 && ov2 == v1) {
                he.twin = otherHeIdx;
                break;
            }
        }
    }
}

void BFFFlattener::identifyBoundaries() {
    for (int heIdx = 0; heIdx < (int)mesh.halfEdges.size(); heIdx++) {
        if (mesh.halfEdges[heIdx].twin == -1) {
            mesh.halfEdges[heIdx].isBoundary = true;
            
            int v1 = mesh.faces[mesh.halfEdges[heIdx].face][heIdx % 3];
            int v2 = mesh.halfEdges[heIdx].vertex;
            
            mesh.isBoundaryVertex[v1] = true;
            mesh.isBoundaryVertex[v2] = true;
        }
    }
}

bool BFFFlattener::flatten() {
    if (mesh.vertices.empty() || mesh.faces.empty()) {
        errorMsg = "Empty mesh";
        return false;
    }
    
    uvResult.clear();
    uvResult.resize(mesh.vertices.size() * 2, 0.0);
    
    // 对于简单情况，直接展开整个网格
    std::vector<int> allFaces;
    for (int i = 0; i < (int)mesh.faces.size(); i++) {
        allFaces.push_back(i);
    }
    
    std::vector<Vec2> uvs(mesh.vertices.size());
    std::map<int, int> identityMap;
    for (int i = 0; i < (int)mesh.vertices.size(); i++) {
        identityMap[i] = i;
    }
    
    if (!flattenPiece(allFaces, uvs, identityMap)) {
        return false;
    }
    
    // 复制结果
    for (int i = 0; i < (int)uvs.size(); i++) {
        uvResult[i * 2] = uvs[i].x;
        uvResult[i * 2 + 1] = uvs[i].y;
    }
    
    return true;
}

bool BFFFlattener::flattenPiece(const std::vector<int>& faceIndices,
                                 std::vector<Vec2>& uvs,
                                 std::map<int, int>& vertexMap) {
    if (faceIndices.empty()) return true;
    
    std::set<int> placedVertices;
    std::set<int> processedFaces;
    std::queue<int> faceQueue;
    
    // 从第一个面开始
    int firstFace = faceIndices[0];
    const auto& face = mesh.faces[firstFace];
    
    // 放置第一个三角形
    const Vec3& v0 = mesh.vertices[face[0]];
    const Vec3& v1 = mesh.vertices[face[1]];
    const Vec3& v2 = mesh.vertices[face[2]];
    
    double e01 = edgeLength(face[0], face[1]);
    double e02 = edgeLength(face[0], face[2]);
    double e12 = edgeLength(face[1], face[2]);
    
    // 第一个顶点在原点
    uvs[face[0]] = Vec2(0, 0);
    placedVertices.insert(face[0]);
    
    // 第二个顶点在x轴上
    uvs[face[1]] = Vec2(e01, 0);
    placedVertices.insert(face[1]);
    
    // 第三个顶点用余弦定理计算
    double cosA = (e01 * e01 + e02 * e02 - e12 * e12) / (2.0 * e01 * e02);
    cosA = std::max(-1.0, std::min(1.0, cosA));
    double sinA = std::sqrt(1.0 - cosA * cosA);
    uvs[face[2]] = Vec2(e02 * cosA, e02 * sinA);
    placedVertices.insert(face[2]);
    
    processedFaces.insert(firstFace);
    faceQueue.push(firstFace);
    
    // 构建面邻接关系
    std::map<std::pair<int, int>, std::vector<int>> edgeToFaces;
    for (int fIdx : faceIndices) {
        const auto& f = mesh.faces[fIdx];
        for (int i = 0; i < 3; i++) {
            int v1 = f[i];
            int v2 = f[(i + 1) % 3];
            edgeToFaces[edgeKey(v1, v2)].push_back(fIdx);
        }
    }
    
    // BFS展开
    while (!faceQueue.empty()) {
        int currentFace = faceQueue.front();
        faceQueue.pop();
        
        const auto& cf = mesh.faces[currentFace];
        
        // 检查相邻面
        for (int i = 0; i < 3; i++) {
            int ev1 = cf[i];
            int ev2 = cf[(i + 1) % 3];
            auto key = edgeKey(ev1, ev2);
            
            for (int neighborFace : edgeToFaces[key]) {
                if (processedFaces.count(neighborFace)) continue;
                
                const auto& nf = mesh.faces[neighborFace];
                
                // 找到共享边和新顶点
                int sharedV1 = -1, sharedV2 = -1, newV = -1;
                for (int v : nf) {
                    if (placedVertices.count(v)) {
                        if (sharedV1 == -1) sharedV1 = v;
                        else sharedV2 = v;
                    } else {
                        newV = v;
                    }
                }
                
                if (sharedV1 == -1 || sharedV2 == -1 || newV == -1) continue;
                
                // 计算新顶点位置
                const Vec2& p1 = uvs[sharedV1];
                const Vec2& p2 = uvs[sharedV2];
                
                double len12 = edgeLength(sharedV1, sharedV2);
                double len1n = edgeLength(sharedV1, newV);
                double len2n = edgeLength(sharedV2, newV);
                
                if (len12 < 1e-10) continue;
                
                // 使用余弦定理
                double cosAngle = (len12 * len12 + len1n * len1n - len2n * len2n) / (2.0 * len12 * len1n);
                cosAngle = std::max(-1.0, std::min(1.0, cosAngle));
                double sinAngle = std::sqrt(1.0 - cosAngle * cosAngle);
                
                // 计算方向
                Vec2 dir = (p2 - p1).normalize();
                Vec2 perp(-dir.y, dir.x);
                
                // 新顶点位置（选择使三角形朝向正确的方向）
                Vec2 newPos = p1 + dir * (len1n * cosAngle) + perp * (len1n * sinAngle);
                
                // 检查三角形朝向
                Vec2 e1 = p2 - p1;
                Vec2 e2 = newPos - p1;
                double cross = e1.x * e2.y - e1.y * e2.x;
                
                if (cross < 0) {
                    // 翻转
                    newPos = p1 + dir * (len1n * cosAngle) - perp * (len1n * sinAngle);
                }
                
                uvs[newV] = newPos;
                placedVertices.insert(newV);
                processedFaces.insert(neighborFace);
                faceQueue.push(neighborFace);
            }
        }
    }
    
    // 处理未放置的顶点
    for (int fIdx : faceIndices) {
        for (int v : mesh.faces[fIdx]) {
            if (!placedVertices.count(v)) {
                uvs[v] = Vec2(0, 0);
                placedVertices.insert(v);
            }
        }
    }
    
    // 共形优化
    optimizeConformal(uvs, faceIndices, vertexMap, 20);
    
    // 归一化UV坐标
    double minU = std::numeric_limits<double>::max();
    double maxU = std::numeric_limits<double>::lowest();
    double minV = std::numeric_limits<double>::max();
    double maxV = std::numeric_limits<double>::lowest();
    
    for (int fIdx : faceIndices) {
        for (int v : mesh.faces[fIdx]) {
            minU = std::min(minU, uvs[v].x);
            maxU = std::max(maxU, uvs[v].x);
            minV = std::min(minV, uvs[v].y);
            maxV = std::max(maxV, uvs[v].y);
        }
    }
    
    double scale = std::max(maxU - minU, maxV - minV);
    if (scale > 1e-10) {
        for (int fIdx : faceIndices) {
            for (int v : mesh.faces[fIdx]) {
                uvs[v].x = (uvs[v].x - minU) / scale;
                uvs[v].y = (uvs[v].y - minV) / scale;
            }
        }
    }
    
    return true;
}

void BFFFlattener::optimizeConformal(std::vector<Vec2>& uvs,
                                      const std::vector<int>& faceIndices,
                                      const std::map<int, int>& vertexMap,
                                      int iterations) {
    // 构建顶点邻接关系
    std::map<int, std::vector<int>> vertexNeighbors;
    for (int fIdx : faceIndices) {
        const auto& f = mesh.faces[fIdx];
        for (int i = 0; i < 3; i++) {
            int v = f[i];
            int vn = f[(i + 1) % 3];
            int vp = f[(i + 2) % 3];
            vertexNeighbors[v].push_back(vn);
            vertexNeighbors[v].push_back(vp);
        }
    }
    
    // 去重
    for (auto& pair : vertexNeighbors) {
        std::sort(pair.second.begin(), pair.second.end());
        pair.second.erase(std::unique(pair.second.begin(), pair.second.end()), pair.second.end());
    }
    
    // 迭代优化（拉普拉斯平滑 + 边长保持）
    double alpha = 0.5;
    
    for (int iter = 0; iter < iterations; iter++) {
        std::vector<Vec2> newUVs = uvs;
        
        for (auto& pair : vertexNeighbors) {
            int v = pair.first;
            const auto& neighbors = pair.second;
            
            if (neighbors.size() < 2) continue;
            
            // 计算邻居的平均位置
            Vec2 avg(0, 0);
            for (int n : neighbors) {
                avg = avg + uvs[n];
            }
            avg = avg * (1.0 / neighbors.size());
            
            // 拉普拉斯平滑
            newUVs[v] = uvs[v] * (1.0 - alpha) + avg * alpha;
        }
        
        uvs = newUVs;
    }
}

double BFFFlattener::computeAngle(const Vec3& a, const Vec3& b, const Vec3& c) {
    Vec3 ba = a - b;
    Vec3 bc = c - b;
    
    double dot = ba.dot(bc);
    double lenA = ba.length();
    double lenC = bc.length();
    
    if (lenA < 1e-10 || lenC < 1e-10) return 0;
    
    double cosAngle = dot / (lenA * lenC);
    cosAngle = std::max(-1.0, std::min(1.0, cosAngle));
    
    return std::acos(cosAngle);
}

double BFFFlattener::edgeLength(int v1, int v2) {
    return (mesh.vertices[v2] - mesh.vertices[v1]).length();
}

} // namespace bff

