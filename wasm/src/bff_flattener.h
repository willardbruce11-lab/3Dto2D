/**
 * BFF (Boundary First Flattening) UV展开算法
 * 高性能C++实现，编译为WebAssembly
 */

#ifndef BFF_FLATTENER_H
#define BFF_FLATTENER_H

#include <vector>
#include <cmath>
#include <map>
#include <set>
#include <algorithm>

namespace bff {

// 2D向量
struct Vec2 {
    double x, y;
    Vec2() : x(0), y(0) {}
    Vec2(double x_, double y_) : x(x_), y(y_) {}
    Vec2 operator+(const Vec2& v) const { return Vec2(x + v.x, y + v.y); }
    Vec2 operator-(const Vec2& v) const { return Vec2(x - v.x, y - v.y); }
    Vec2 operator*(double s) const { return Vec2(x * s, y * s); }
    double dot(const Vec2& v) const { return x * v.x + y * v.y; }
    double length() const { return std::sqrt(x * x + y * y); }
    Vec2 normalize() const {
        double len = length();
        return len > 1e-10 ? Vec2(x / len, y / len) : Vec2(0, 0);
    }
};

// 3D向量
struct Vec3 {
    double x, y, z;
    Vec3() : x(0), y(0), z(0) {}
    Vec3(double x_, double y_, double z_) : x(x_), y(y_), z(z_) {}
    Vec3 operator+(const Vec3& v) const { return Vec3(x + v.x, y + v.y, z + v.z); }
    Vec3 operator-(const Vec3& v) const { return Vec3(x - v.x, y - v.y, z - v.z); }
    Vec3 operator*(double s) const { return Vec3(x * s, y * s, z * s); }
    double dot(const Vec3& v) const { return x * v.x + y * v.y + z * v.z; }
    Vec3 cross(const Vec3& v) const {
        return Vec3(y * v.z - z * v.y, z * v.x - x * v.z, x * v.y - y * v.x);
    }
    double length() const { return std::sqrt(x * x + y * y + z * z); }
    Vec3 normalize() const {
        double len = length();
        return len > 1e-10 ? Vec3(x / len, y / len, z / len) : Vec3(0, 0, 0);
    }
};

// 半边数据结构
struct HalfEdge {
    int vertex;      // 目标顶点
    int face;        // 所属面
    int next;        // 同一面中的下一条半边
    int twin;        // 对偶半边
    int prev;        // 同一面中的上一条半边
    bool isBoundary; // 是否为边界边
    bool isSeam;     // 是否为缝线边
};

// 网格数据
struct Mesh {
    std::vector<Vec3> vertices;
    std::vector<std::vector<int>> faces;
    std::vector<HalfEdge> halfEdges;
    std::vector<int> vertexHalfEdge;  // 每个顶点关联的一条半边
    std::vector<bool> isBoundaryVertex;
    std::vector<std::set<int>> seamEdges; // 缝线边集合
    
    int numVertices() const { return vertices.size(); }
    int numFaces() const { return faces.size(); }
};

// 展开结果
struct FlattenResult {
    std::vector<Vec2> uvCoords;
    std::vector<std::vector<int>> pieces;  // 每个片段包含的面索引
    bool success;
    std::string errorMessage;
};

/**
 * BFF展开器类
 */
class BFFFlattener {
public:
    BFFFlattener();
    ~BFFFlattener();
    
    /**
     * 设置网格数据
     * @param vertices 顶点数组 [x0,y0,z0, x1,y1,z1, ...]
     * @param numVertices 顶点数量
     * @param faces 面索引数组（三角形）[v0,v1,v2, v3,v4,v5, ...]
     * @param numFaces 面数量
     */
    void setMesh(const double* vertices, int numVertices,
                 const int* faces, int numFaces);
    
    /**
     * 添加缝线边
     * @param v1 顶点1索引
     * @param v2 顶点2索引
     */
    void addSeamEdge(int v1, int v2);
    
    /**
     * 清除所有缝线
     */
    void clearSeams();
    
    /**
     * 执行展开
     * @return 是否成功
     */
    bool flatten();
    
    /**
     * 获取UV坐标
     * @return UV坐标数组 [u0,v0, u1,v1, ...]
     */
    const std::vector<double>& getUVCoords() const { return uvResult; }
    
    /**
     * 获取UV坐标数量
     */
    int getUVCount() const { return uvResult.size() / 2; }
    
    /**
     * 获取错误信息
     */
    const char* getError() const { return errorMsg.c_str(); }

private:
    Mesh mesh;
    std::vector<double> uvResult;
    std::string errorMsg;
    
    // 内部方法
    void buildHalfEdgeStructure();
    void identifyBoundaries();
    void splitBySeams();
    
    // 基于角度的展开（简化版BFF）
    bool flattenPiece(const std::vector<int>& faceIndices, 
                      std::vector<Vec2>& uvs,
                      std::map<int, int>& vertexMap);
    
    // 三角形铺展
    bool unfoldTriangle(int faceIdx, 
                        const std::map<int, int>& vertexMap,
                        std::vector<Vec2>& uvs,
                        std::set<int>& placedVertices);
    
    // 计算角度
    double computeAngle(const Vec3& a, const Vec3& b, const Vec3& c);
    
    // 计算边长
    double edgeLength(int v1, int v2);
    
    // 共形映射优化
    void optimizeConformal(std::vector<Vec2>& uvs, 
                          const std::vector<int>& faceIndices,
                          const std::map<int, int>& vertexMap,
                          int iterations);
    
    // 获取边的key
    std::pair<int, int> edgeKey(int v1, int v2) {
        return v1 < v2 ? std::make_pair(v1, v2) : std::make_pair(v2, v1);
    }
};

} // namespace bff

#endif // BFF_FLATTENER_H

