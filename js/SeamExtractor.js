/**
 * 缝线提取器 (简化版)
 * 
 * 核心逻辑：
 * 1. DBSCAN 聚类：距离超过 epsilon 的点绝对禁止连接
 * 2. 组内连线：只在每个 Group 内部使用最近邻连接
 * 3. 直接使用网格边：红点之间如果有网格边，直接作为缝线
 */

export class SeamExtractor {
    constructor() {
        this.meshData = null;
        this.redVertices = [];      // 红色顶点索引
        this.seamPaths = [];        // 连接后的缝线路径
        this.seamEdges = new Set(); // 缝线边集合（只包含真实网格边）
        this.modelSize = 1.0;
    }
    
    /**
     * 设置网格数据
     */
    setMesh(meshData) {
        this.meshData = meshData;
        if (!this.meshData.adjacency) {
            this.meshData.adjacency = this.buildAdjacency(
                meshData.faces,
                meshData.vertices.length
            );
        }
        this.redVertices = [];
        this.seamPaths = [];
        this.seamEdges.clear();
    }
    
    /**
     * 从顶点颜色中提取红色顶点
     */
    extractRedVertices(options = {}) {
        const {
            redThreshold = 0.8,
            greenMaxThreshold = 0.3,
            blueMaxThreshold = 0.3
        } = options;
        
        if (!this.meshData || !this.meshData.hasVertexColors) {
            console.warn('SeamExtractor: 网格数据没有顶点颜色信息');
            return [];
        }
        
        this.redVertices = [];
        const colors = this.meshData.vertexColors;
        
        for (let i = 0; i < colors.length; i++) {
            const color = colors[i];
            if (color.r > redThreshold && 
                color.g < greenMaxThreshold && 
                color.b < blueMaxThreshold) {
                this.redVertices.push(i);
            }
        }
        
        console.log(`SeamExtractor: 检测到 ${this.redVertices.length} 个红色顶点`);
        return this.redVertices;
    }
    
    /**
     * 连接红色顶点 - 简化版
     * 1. DBSCAN 聚类
     * 2. 提取红点之间的网格边作为缝线
     */
    async connectRedVertices(options = {}) {
        const { onProgress = null, eps = 0.01 } = options;

        if (this.redVertices.length < 2) {
            console.warn('SeamExtractor: 红色顶点不足');
            return [];
        }
        
        console.log('========================================');
        console.log('=== 红线提取 (DBSCAN + 网格边) ===');
        console.log('========================================');
        console.log(`红色顶点数量: ${this.redVertices.length}`);
        
        this.seamPaths = [];
        this.seamEdges.clear();

        // Step 1: 计算模型尺寸，确定自适应 epsilon
        const adaptiveEps = this.computeAdaptiveEps(eps);
        console.log(`自适应 epsilon: ${adaptiveEps.toFixed(4)}`);
        
        if (onProgress) onProgress(10);

        // Step 2: DBSCAN 聚类
        const clusters = this.dbscanCluster(adaptiveEps);
        console.log(`DBSCAN 聚类完成: ${clusters.length} 个组`);
        
        if (onProgress) onProgress(30);

        // Step 3: 提取红点之间的网格边
        const redSet = new Set(this.redVertices);
        this.extractRedEdges(redSet);
        console.log(`提取红边完成: ${this.seamEdges.size} 条网格边`);
        
        if (onProgress) onProgress(60);

        // Step 4: 为每个簇构建路径（用于可视化）
        for (let i = 0; i < clusters.length; i++) {
            const cluster = clusters[i];
            if (cluster.length < 2) continue;
            
            // 简单排序：按最近邻顺序
            const orderedPath = this.orderByNearestNeighbor(cluster);
            
            this.seamPaths.push({
                id: `group_${i}`,
                vertices: orderedPath,
                waypointIndices: cluster,
                isClosed: false
            });
            
            if (onProgress) onProgress(60 + (i / clusters.length) * 30);
        }
        
        if (onProgress) onProgress(95);

        console.log(`生成 ${this.seamPaths.length} 条缝线路径，${this.seamEdges.size} 条有效边`);
        return this.seamPaths;
    }
    
    /**
     * 计算自适应 epsilon（宽松版本）
     */
    computeAdaptiveEps(baseEps) {
        const vertices = this.meshData.vertices;
        
        // 计算整个模型的包围盒
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        for (const v of vertices) {
            minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
            minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
            minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
        }
        
        this.modelSize = Math.sqrt(
            (maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2
        );
        
        // 宽松的自适应 eps = 模型大小的 5%，允许更远的点也连在一起
        // 这样同一条红线上的点更容易被归为一组
        return Math.max(baseEps, this.modelSize * 0.05);
    }
    
    /**
     * DBSCAN 聚类
     */
    dbscanCluster(eps) {
        const vertices = this.meshData.vertices;
        const visited = new Set();
        const clusters = [];
        
        for (const idx of this.redVertices) {
            if (visited.has(idx)) continue;
            
            // 找到所有邻居
            const cluster = [];
            const queue = [idx];
            
            while (queue.length > 0) {
                const current = queue.pop();
                if (visited.has(current)) continue;
                visited.add(current);
                cluster.push(current);
                
                // 找 epsilon 范围内的红点
                const currentPos = vertices[current];
                for (const other of this.redVertices) {
                    if (visited.has(other)) continue;
                    const dist = this.distance(currentPos, vertices[other]);
                    if (dist <= eps) {
                        queue.push(other);
                    }
                }
            }
            
            if (cluster.length >= 2) {
                clusters.push(cluster);
            }
        }
        
        // 按大小排序
        clusters.sort((a, b) => b.length - a.length);
        return clusters;
    }
    
    /**
     * 提取红点之间的网格边
     * 关键：只有当一条边的两个端点都是红色时，才算缝线边
     */
    extractRedEdges(redSet) {
        const faces = this.meshData.faces;
        
        for (const face of faces) {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                
                // 两端都是红点 -> 这是一条缝线边
                if (redSet.has(v1) && redSet.has(v2)) {
                    const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                    this.seamEdges.add(edgeKey);
                }
            }
        }
    }
    
    /**
     * 最近邻排序
     */
    orderByNearestNeighbor(vertexIndices) {
        if (vertexIndices.length <= 2) return [...vertexIndices];
        
        const vertices = this.meshData.vertices;
        const remaining = new Set(vertexIndices);
        const result = [];
        
        // 从第一个点开始
        let current = vertexIndices[0];
        result.push(current);
        remaining.delete(current);
        
        while (remaining.size > 0) {
            const currentPos = vertices[current];
            let nearest = null;
            let nearestDist = Infinity;
            
            for (const candidate of remaining) {
                const dist = this.distance(currentPos, vertices[candidate]);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearest = candidate;
                }
            }
            
            if (nearest !== null) {
                result.push(nearest);
                remaining.delete(nearest);
                current = nearest;
            } else {
                break;
            }
        }
        
        return result;
    }
    
    /**
     * 计算欧氏距离
     */
    distance(v1, v2) {
        const dx = v2.x - v1.x;
        const dy = v2.y - v1.y;
        const dz = v2.z - v1.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    
    /**
     * 检查路径是否闭合
     */
    checkIfClosed(path, eps) {
        if (path.length < 3) return false;
        const vStart = this.meshData.vertices[path[0]];
        const vEnd = this.meshData.vertices[path[path.length - 1]];
        return this.distance(vStart, vEnd) < eps;
    }

    /**
     * 获取缝线数据
     */
    getSeamData() {
        const eps = this.modelSize * 0.01;
        return {
            seams: this.seamPaths.map((path, index) => {
                const isClosed = this.checkIfClosed(path.vertices, eps);
                return {
                    id: `seam_${index}`,
                    type: 'cut',
                    vertices: path.vertices,
                    edges: this.pathToEdges(path.vertices),
                    isClosed: isClosed,
                    waypointCount: path.waypointIndices.length
                };
            }),
            totalSeams: this.seamPaths.length,
            totalEdges: this.seamEdges.size,
            redVertexCount: this.redVertices.length
        };
    }
    
    /**
     * 路径转边
     */
    pathToEdges(path) {
        const edges = [];
        for (let i = 0; i < path.length - 1; i++) {
            edges.push([path[i], path[i + 1]]);
        }
        return edges;
    }
    
    /**
     * 获取红点位置
     */
    getRedVertexPositions() {
        if (!this.meshData) return [];
        return this.redVertices.map(idx => ({
            index: idx,
            position: this.meshData.vertices[idx]
        }));
    }
    
    /**
     * 获取缝线边集合（用于泛洪分割）
     */
    getSeamEdgeSet() {
        return this.seamEdges;
    }

    /**
     * 构建邻接表
     */
    buildAdjacency(faces, vertexCount) {
        const vertexToVertices = new Map();
        const vertexToFaces = new Map();

        for (let i = 0; i < vertexCount; i++) {
            vertexToVertices.set(i, new Set());
            vertexToFaces.set(i, new Set());
        }

        faces.forEach((face, faceIdx) => {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                vertexToVertices.get(v1)?.add(v2);
                vertexToVertices.get(v2)?.add(v1);
                vertexToFaces.get(v1)?.add(faceIdx);
            }
        });

        return { vertexToVertices, vertexToFaces };
    }
}
