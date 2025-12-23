/**
 * 拓扑手术模块
 * 实现严格的网格切割：沿红线进行顶点分裂，确保数据结构层面完全断开
 * 
 * 核心原理：
 * 1. 拓扑手术 - 顶点分裂，让红线两侧的面使用不同的顶点
 * 2. 拓扑检查 - 验证每块是否是拓扑圆盘 (V-E+F=1)
 * 3. 独立分治 - 每块子网格完全独立，展开算法无法"加戏"
 */

export class TopologicalSurgery {
    constructor() {
        this.originalVertices = [];
        this.originalFaces = [];
        this.adjacency = null;
        
        // 红色顶点和切割边
        this.redVertices = new Set();
        this.cutEdges = new Set();        // 边的key: "v1_v2"
        this.cutVertices = new Set();     // 切割线上的所有顶点
        
        // 切割后的数据
        this.newVertices = [];
        this.newFaces = [];
        this.subMeshes = [];
    }
    
    /**
     * 设置原始网格数据
     */
    setMesh(meshData) {
        this.originalVertices = meshData.vertices;
        this.originalFaces = meshData.faces;
        this.adjacency = meshData.adjacency;
        
        // 重置
        this.redVertices.clear();
        this.cutEdges.clear();
        this.cutVertices.clear();
        this.newVertices = [];
        this.newFaces = [];
        this.subMeshes = [];
    }
    
    /**
     * 设置红色顶点
     */
    setRedVertices(redVertices) {
        this.redVertices = new Set(redVertices);
        console.log(`TopologicalSurgery: 设置 ${this.redVertices.size} 个红色顶点`);
    }
    
    /**
     * 第一步：连接红色顶点，生成切割边
     * 将散落的红点连成连续的切割线
     */
    buildCutPath(onProgress) {
        console.log('=== 第一步：构建切割路径 ===');
        
        if (this.redVertices.size < 2) {
            console.warn('红色顶点不足2个');
            return false;
        }
        
        const redArray = Array.from(this.redVertices);
        
        // 按空间距离排序红色顶点（贪心TSP）
        const orderedRed = this.orderVerticesByDistance(redArray);
        console.log(`排序后的红色顶点: ${orderedRed.length} 个`);
        
        // Dijkstra连接相邻红点
        for (let i = 0; i < orderedRed.length - 1; i++) {
            const start = orderedRed[i];
            const end = orderedRed[i + 1];
            
            const path = this.dijkstraPath(start, end);
            
            if (path && path.length > 1) {
                // 记录路径上的所有顶点和边
                for (let j = 0; j < path.length; j++) {
                    this.cutVertices.add(path[j]);
                    
                    if (j < path.length - 1) {
                        const v1 = path[j];
                        const v2 = path[j + 1];
                        const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                        this.cutEdges.add(edgeKey);
                    }
                }
            }
            
            if (onProgress) {
                onProgress((i / orderedRed.length) * 20);
            }
        }
        
        console.log(`切割边数量: ${this.cutEdges.size}`);
        console.log(`切割顶点数量: ${this.cutVertices.size}`);
        
        return true;
    }
    
    /**
     * 第二步：拓扑手术 - 顶点分裂
     * 关键操作：让切割边两侧的面使用不同的顶点副本
     */
    performSurgery(onProgress) {
        console.log('=== 第二步：拓扑手术（顶点分裂）===');
        
        if (this.cutEdges.size === 0) {
            console.warn('没有切割边，跳过手术');
            return false;
        }
        
        // 复制所有顶点
        this.newVertices = this.originalVertices.map(v => ({ ...v }));
        this.newFaces = this.originalFaces.map(f => [...f]);
        
        // 构建边到面的映射
        const edgeToFaces = new Map();
        for (let faceIdx = 0; faceIdx < this.originalFaces.length; faceIdx++) {
            const face = this.originalFaces[faceIdx];
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                
                if (!edgeToFaces.has(edgeKey)) {
                    edgeToFaces.set(edgeKey, []);
                }
                edgeToFaces.get(edgeKey).push({ faceIdx, edgeVertices: [v1, v2] });
            }
        }
        
        // 对于每条切割边，分裂顶点
        // 策略：将切割边一侧的所有面的顶点替换为新顶点
        const vertexDuplicateMap = new Map(); // 原顶点 -> 新顶点索引
        
        // 首先，找出切割边将网格分成的两侧
        // 使用flood fill从每条切割边的两侧开始
        const faceToSide = new Map(); // 面索引 -> 侧面标识 (0 或 1)
        
        // 标记所有切割边两侧的面
        for (const edgeKey of this.cutEdges) {
            const facesOnEdge = edgeToFaces.get(edgeKey);
            if (!facesOnEdge || facesOnEdge.length !== 2) continue;
            
            // 这两个面在切割边的两侧
            faceToSide.set(facesOnEdge[0].faceIdx, 0);
            faceToSide.set(facesOnEdge[1].faceIdx, 1);
        }
        
        // Flood fill传播侧面标识
        this.propagateSides(faceToSide, edgeToFaces);
        
        if (onProgress) onProgress(40);
        
        // 对于侧面1的所有面，将切割顶点替换为新顶点
        for (const cutVertex of this.cutVertices) {
            // 创建新顶点
            const newVertexIdx = this.newVertices.length;
            this.newVertices.push({ ...this.originalVertices[cutVertex] });
            vertexDuplicateMap.set(cutVertex, newVertexIdx);
        }
        
        // 更新侧面1的面索引
        for (let faceIdx = 0; faceIdx < this.newFaces.length; faceIdx++) {
            if (faceToSide.get(faceIdx) === 1) {
                const face = this.newFaces[faceIdx];
                for (let i = 0; i < face.length; i++) {
                    if (this.cutVertices.has(face[i])) {
                        const newIdx = vertexDuplicateMap.get(face[i]);
                        if (newIdx !== undefined) {
                            face[i] = newIdx;
                        }
                    }
                }
            }
        }
        
        console.log(`顶点分裂完成: ${this.originalVertices.length} -> ${this.newVertices.length} 顶点`);
        console.log(`分裂了 ${vertexDuplicateMap.size} 个顶点`);
        
        if (onProgress) onProgress(60);
        
        return true;
    }
    
    /**
     * Flood fill传播侧面标识
     */
    propagateSides(faceToSide, edgeToFaces) {
        // 构建面邻接（不通过切割边）
        const faceAdjacency = new Map();
        
        for (let faceIdx = 0; faceIdx < this.originalFaces.length; faceIdx++) {
            faceAdjacency.set(faceIdx, new Set());
        }
        
        for (const [edgeKey, facesOnEdge] of edgeToFaces) {
            // 如果不是切割边，建立邻接
            if (!this.cutEdges.has(edgeKey) && facesOnEdge.length === 2) {
                faceAdjacency.get(facesOnEdge[0].faceIdx).add(facesOnEdge[1].faceIdx);
                faceAdjacency.get(facesOnEdge[1].faceIdx).add(facesOnEdge[0].faceIdx);
            }
        }
        
        // BFS传播
        const queue = Array.from(faceToSide.keys());
        
        while (queue.length > 0) {
            const currentFace = queue.shift();
            const currentSide = faceToSide.get(currentFace);
            
            const neighbors = faceAdjacency.get(currentFace);
            if (!neighbors) continue;
            
            for (const neighbor of neighbors) {
                if (!faceToSide.has(neighbor)) {
                    faceToSide.set(neighbor, currentSide);
                    queue.push(neighbor);
                }
            }
        }
    }
    
    /**
     * 第三步：分离连通分量，生成独立子网格
     */
    separateComponents(onProgress) {
        console.log('=== 第三步：分离连通分量 ===');
        
        // 重建邻接关系（基于新的顶点和面）
        const edgeToFaces = new Map();
        
        for (let faceIdx = 0; faceIdx < this.newFaces.length; faceIdx++) {
            const face = this.newFaces[faceIdx];
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                
                if (!edgeToFaces.has(edgeKey)) {
                    edgeToFaces.set(edgeKey, []);
                }
                edgeToFaces.get(edgeKey).push(faceIdx);
            }
        }
        
        // 建立面邻接
        const faceAdjacency = new Map();
        for (let faceIdx = 0; faceIdx < this.newFaces.length; faceIdx++) {
            faceAdjacency.set(faceIdx, new Set());
        }
        
        for (const [edgeKey, faces] of edgeToFaces) {
            if (faces.length === 2) {
                faceAdjacency.get(faces[0]).add(faces[1]);
                faceAdjacency.get(faces[1]).add(faces[0]);
            }
        }
        
        // BFS找连通分量
        const visited = new Set();
        this.subMeshes = [];
        
        for (let faceIdx = 0; faceIdx < this.newFaces.length; faceIdx++) {
            if (visited.has(faceIdx)) continue;
            
            const component = {
                faceIndices: [],
                faces: [],
                vertices: new Set(),
                vertexMap: new Map(),  // 全局索引 -> 局部索引
                localVertices: [],
                localFaces: []
            };
            
            const queue = [faceIdx];
            visited.add(faceIdx);
            
            while (queue.length > 0) {
                const current = queue.shift();
                component.faceIndices.push(current);
                component.faces.push(this.newFaces[current]);
                
                for (const v of this.newFaces[current]) {
                    component.vertices.add(v);
                }
                
                const neighbors = faceAdjacency.get(current);
                if (neighbors) {
                    for (const neighbor of neighbors) {
                        if (!visited.has(neighbor)) {
                            visited.add(neighbor);
                            queue.push(neighbor);
                        }
                    }
                }
            }
            
            // 创建局部顶点和面（重新索引）
            let localIdx = 0;
            for (const globalV of component.vertices) {
                component.vertexMap.set(globalV, localIdx);
                component.localVertices.push(this.newVertices[globalV]);
                localIdx++;
            }
            
            for (const face of component.faces) {
                const localFace = face.map(v => component.vertexMap.get(v));
                component.localFaces.push(localFace);
            }
            
            this.subMeshes.push(component);
        }
        
        console.log(`分离出 ${this.subMeshes.length} 个独立子网格`);
        
        if (onProgress) onProgress(80);
        
        return true;
    }
    
    /**
     * 第四步：拓扑合规性检查
     * 验证每个子网格是否是拓扑圆盘 (V - E + F = 1)
     */
    validateTopology() {
        console.log('=== 第四步：拓扑合规性检查 ===');
        
        const results = [];
        
        for (let i = 0; i < this.subMeshes.length; i++) {
            const mesh = this.subMeshes[i];
            
            // 计算欧拉示性数
            const V = mesh.localVertices.length;
            const F = mesh.localFaces.length;
            
            // 计算边数
            const edges = new Set();
            for (const face of mesh.localFaces) {
                for (let j = 0; j < face.length; j++) {
                    const v1 = face[j];
                    const v2 = face[(j + 1) % face.length];
                    const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                    edges.add(edgeKey);
                }
            }
            const E = edges.size;
            
            // 欧拉示性数
            const euler = V - E + F;
            
            // 对于带边界的圆盘，应该是1
            // 对于闭合曲面（球），应该是2
            // 对于圆环，应该是0
            const isValidDisk = (euler === 1);
            
            // 检查边界数量
            const boundaryEdges = [];
            const edgeCount = new Map();
            for (const face of mesh.localFaces) {
                for (let j = 0; j < face.length; j++) {
                    const v1 = face[j];
                    const v2 = face[(j + 1) % face.length];
                    const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                    edgeCount.set(edgeKey, (edgeCount.get(edgeKey) || 0) + 1);
                }
            }
            for (const [key, count] of edgeCount) {
                if (count === 1) {
                    boundaryEdges.push(key);
                }
            }
            
            const result = {
                index: i,
                vertices: V,
                edges: E,
                faces: F,
                euler: euler,
                isValidDisk: isValidDisk,
                boundaryEdges: boundaryEdges.length,
                status: isValidDisk ? 'OK' : (euler === 0 ? 'CYLINDER' : (euler === 2 ? 'CLOSED' : 'COMPLEX'))
            };
            
            results.push(result);
            
            if (!isValidDisk) {
                console.warn(`子网格 #${i}: V=${V}, E=${E}, F=${F}, χ=${euler} - ${result.status}`);
                if (result.status === 'CYLINDER') {
                    console.warn(`  -> 这是一个圆筒/圆环，需要额外切一刀才能展平`);
                }
            }
        }
        
        const validCount = results.filter(r => r.isValidDisk).length;
        console.log(`拓扑检查完成: ${validCount}/${results.length} 个是有效的拓扑圆盘`);
        
        return results;
    }
    
    /**
     * 执行完整的拓扑手术流程
     */
    async execute(onProgress) {
        const startTime = Date.now();
        
        // 第一步：构建切割路径
        this.buildCutPath((p) => onProgress && onProgress(p));
        
        // 第二步：拓扑手术
        this.performSurgery((p) => onProgress && onProgress(p));
        
        // 第三步：分离连通分量
        this.separateComponents((p) => onProgress && onProgress(p));
        
        // 第四步：拓扑检查
        const topologyResults = this.validateTopology();
        
        if (onProgress) onProgress(100);
        
        console.log(`拓扑手术完成，耗时: ${Date.now() - startTime}ms`);
        
        return {
            vertices: this.newVertices,
            faces: this.newFaces,
            subMeshes: this.subMeshes,
            cutEdges: this.cutEdges,
            cutVertices: this.cutVertices,
            topologyResults: topologyResults
        };
    }
    
    // ============ 辅助方法 ============
    
    /**
     * 按距离排序顶点（贪心TSP）
     */
    orderVerticesByDistance(vertexIndices) {
        if (vertexIndices.length <= 2) return [...vertexIndices];
        
        const remaining = new Set(vertexIndices);
        const ordered = [];
        
        let current = vertexIndices[0];
        ordered.push(current);
        remaining.delete(current);
        
        while (remaining.size > 0) {
            let nearest = null;
            let minDist = Infinity;
            
            for (const v of remaining) {
                const dist = this.distance(this.originalVertices[current], this.originalVertices[v]);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = v;
                }
            }
            
            if (nearest !== null) {
                ordered.push(nearest);
                remaining.delete(nearest);
                current = nearest;
            } else {
                break;
            }
        }
        
        return ordered;
    }
    
    /**
     * Dijkstra最短路径
     */
    dijkstraPath(start, end) {
        const dist = new Map();
        const prev = new Map();
        const visited = new Set();
        const pq = [];
        
        dist.set(start, 0);
        pq.push({ vertex: start, distance: 0 });
        
        while (pq.length > 0) {
            pq.sort((a, b) => a.distance - b.distance);
            const { vertex: current } = pq.shift();
            
            if (visited.has(current)) continue;
            visited.add(current);
            
            if (current === end) {
                const path = [];
                let node = end;
                while (node !== undefined) {
                    path.unshift(node);
                    node = prev.get(node);
                }
                return path;
            }
            
            const neighbors = this.adjacency.vertexToVertices.get(current);
            if (!neighbors) continue;
            
            for (const neighbor of neighbors) {
                if (visited.has(neighbor)) continue;
                
                const edgeLen = this.distance(this.originalVertices[current], this.originalVertices[neighbor]);
                const newDist = dist.get(current) + edgeLen;
                
                if (!dist.has(neighbor) || newDist < dist.get(neighbor)) {
                    dist.set(neighbor, newDist);
                    prev.set(neighbor, current);
                    pq.push({ vertex: neighbor, distance: newDist });
                }
            }
        }
        
        return [start, end];
    }
    
    /**
     * 计算两点距离
     */
    distance(v1, v2) {
        const dx = v2.x - v1.x;
        const dy = v2.y - v1.y;
        const dz = v2.z - v1.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
}

