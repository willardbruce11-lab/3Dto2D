/**
 * 网格切割器
 * 实现三步切割流程：
 * 1. 连点成线 - 将红色顶点连接成连续路径
 * 2. 拓扑切割 - 顶点分裂，真正切开网格
 * 3. 生成独立子网格
 */

export class MeshCutter {
    constructor() {
        this.vertices = [];
        this.faces = [];
        this.adjacency = null;
        
        // 红色顶点
        this.redVertices = new Set();
        
        // 切割边列表
        this.cutEdges = new Set();
        
        // 切割后的子网格
        this.subMeshes = [];
    }
    
    /**
     * 设置网格数据
     */
    setMesh(meshData) {
        this.vertices = meshData.vertices;
        this.faces = meshData.faces;
        this.adjacency = meshData.adjacency;
        this.redVertices.clear();
        this.cutEdges.clear();
        this.subMeshes = [];
    }
    
    /**
     * 设置红色顶点
     */
    setRedVertices(redVertices) {
        this.redVertices = new Set(redVertices);
        console.log(`MeshCutter: 设置了 ${this.redVertices.size} 个红色顶点`);
    }
    
    /**
     * 第一步：连点成线
     * 将散落的红色顶点通过Dijkstra连接成连续路径
     */
    connectRedVertices(onProgress) {
        console.log('MeshCutter 第一步: 连点成线');
        
        if (this.redVertices.size < 2) {
            console.warn('红色顶点不足2个');
            return [];
        }
        
        const redArray = Array.from(this.redVertices);
        
        // 按空间位置排序红色顶点（使用贪心TSP）
        const orderedRed = this.orderVerticesByDistance(redArray);
        console.log(`排序后的红色顶点序列: ${orderedRed.length} 个`);
        
        // 连接相邻的红色顶点
        const allPathVertices = new Set(this.redVertices);
        const pathEdges = [];
        
        for (let i = 0; i < orderedRed.length - 1; i++) {
            const start = orderedRed[i];
            const end = orderedRed[i + 1];
            
            // Dijkstra找最短路径
            const path = this.dijkstraPath(start, end);
            
            if (path && path.length > 1) {
                // 将路径上的所有顶点加入
                for (const v of path) {
                    allPathVertices.add(v);
                }
                
                // 记录路径边
                for (let j = 0; j < path.length - 1; j++) {
                    const v1 = path[j];
                    const v2 = path[j + 1];
                    const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                    pathEdges.push([v1, v2]);
                    this.cutEdges.add(edgeKey);
                }
            }
            
            if (onProgress) {
                onProgress(10 + (i / orderedRed.length) * 30);
            }
        }
        
        console.log(`MeshCutter: 生成 ${this.cutEdges.size} 条切割边`);
        return Array.from(this.cutEdges);
    }
    
    /**
     * 按距离排序顶点（贪心TSP）
     */
    orderVerticesByDistance(vertexIndices) {
        if (vertexIndices.length <= 2) return [...vertexIndices];
        
        const remaining = new Set(vertexIndices);
        const ordered = [];
        
        // 从第一个点开始
        let current = vertexIndices[0];
        ordered.push(current);
        remaining.delete(current);
        
        while (remaining.size > 0) {
            let nearest = null;
            let minDist = Infinity;
            
            for (const v of remaining) {
                const dist = this.distance(this.vertices[current], this.vertices[v]);
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
                // 重建路径
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
                
                const edgeLen = this.distance(this.vertices[current], this.vertices[neighbor]);
                const newDist = dist.get(current) + edgeLen;
                
                if (!dist.has(neighbor) || newDist < dist.get(neighbor)) {
                    dist.set(neighbor, newDist);
                    prev.set(neighbor, current);
                    pq.push({ vertex: neighbor, distance: newDist });
                }
            }
        }
        
        // 没找到路径，直接返回起点终点
        return [start, end];
    }
    
    /**
     * 第二步：拓扑切割（顶点分裂）
     * 复制切割边上的顶点，真正切开网格
     */
    performTopologicalCut(onProgress) {
        console.log('MeshCutter 第二步: 拓扑切割');
        
        if (this.cutEdges.size === 0) {
            console.warn('没有切割边');
            return;
        }
        
        // 找出切割边两侧的面
        const edgeToFaces = new Map();
        
        for (let faceIdx = 0; faceIdx < this.faces.length; faceIdx++) {
            const face = this.faces[faceIdx];
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
        
        // 复制顶点
        const newVertices = [...this.vertices];
        const newFaces = this.faces.map(f => [...f]);
        
        // 对于每条切割边，将一侧的面使用新顶点
        const vertexDuplicates = new Map(); // 原顶点 -> 新顶点
        
        for (const edgeKey of this.cutEdges) {
            const facesOnEdge = edgeToFaces.get(edgeKey);
            if (!facesOnEdge || facesOnEdge.length !== 2) continue;
            
            const [v1, v2] = edgeKey.split('_').map(Number);
            
            // 只处理第二个面，将其顶点替换为新顶点
            const faceToModify = facesOnEdge[1];
            
            for (const vOld of [v1, v2]) {
                if (!vertexDuplicates.has(vOld)) {
                    // 复制顶点
                    const newIdx = newVertices.length;
                    newVertices.push({ ...this.vertices[vOld] });
                    vertexDuplicates.set(vOld, newIdx);
                }
                
                // 替换面中的顶点
                const newIdx = vertexDuplicates.get(vOld);
                const faceToUpdate = newFaces[faceToModify];
                for (let i = 0; i < faceToUpdate.length; i++) {
                    if (faceToUpdate[i] === vOld) {
                        faceToUpdate[i] = newIdx;
                    }
                }
            }
        }
        
        console.log(`MeshCutter: 复制了 ${vertexDuplicates.size} 个顶点，总顶点数 ${newVertices.length}`);
        
        if (onProgress) onProgress(60);
        
        // 更新数据
        this.vertices = newVertices;
        this.faces = newFaces;
        
        return { vertices: newVertices, faces: newFaces };
    }
    
    /**
     * 第三步：分离子网格
     * 找出所有独立的连通分量
     */
    separateSubMeshes(onProgress) {
        console.log('MeshCutter 第三步: 分离子网格');
        
        // 重建邻接关系
        const faceAdjacency = new Map();
        const edgeToFaces = new Map();
        
        for (let faceIdx = 0; faceIdx < this.faces.length; faceIdx++) {
            const face = this.faces[faceIdx];
            faceAdjacency.set(faceIdx, new Set());
            
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
        for (const [edgeKey, faces] of edgeToFaces) {
            if (faces.length === 2) {
                faceAdjacency.get(faces[0]).add(faces[1]);
                faceAdjacency.get(faces[1]).add(faces[0]);
            }
        }
        
        // BFS找连通分量
        const visited = new Set();
        this.subMeshes = [];
        
        for (let faceIdx = 0; faceIdx < this.faces.length; faceIdx++) {
            if (visited.has(faceIdx)) continue;
            
            const subMesh = {
                faces: [],
                vertices: new Set(),
                faceIndices: []
            };
            
            const queue = [faceIdx];
            visited.add(faceIdx);
            
            while (queue.length > 0) {
                const current = queue.shift();
                subMesh.faceIndices.push(current);
                subMesh.faces.push(this.faces[current]);
                
                for (const v of this.faces[current]) {
                    subMesh.vertices.add(v);
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
            
            this.subMeshes.push(subMesh);
        }
        
        console.log(`MeshCutter: 分离出 ${this.subMeshes.length} 个子网格`);
        
        if (onProgress) onProgress(80);
        
        return this.subMeshes;
    }
    
    /**
     * 执行完整的切割流程
     */
    async cut(onProgress) {
        const startTime = Date.now();
        
        // 第一步：连点成线
        if (onProgress) onProgress(5);
        this.connectRedVertices((p) => onProgress && onProgress(p));
        
        // 第二步：拓扑切割
        if (onProgress) onProgress(45);
        this.performTopologicalCut((p) => onProgress && onProgress(p));
        
        // 第三步：分离子网格
        if (onProgress) onProgress(70);
        this.separateSubMeshes((p) => onProgress && onProgress(p));
        
        if (onProgress) onProgress(100);
        
        console.log(`MeshCutter: 切割完成，耗时 ${Date.now() - startTime}ms`);
        
        return {
            vertices: this.vertices,
            faces: this.faces,
            subMeshes: this.subMeshes,
            cutEdges: this.cutEdges
        };
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

