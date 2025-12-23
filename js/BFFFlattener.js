/**
 * BFF展开器 - JavaScript接口
 * 
 * 支持两种模式：
 * 1. WASM模式：使用C++编译的WebAssembly，性能更高
 * 2. 纯JS模式：WASM不可用时的备选方案
 */

export class BFFFlattener {
    constructor() {
        this.wasmModule = null;
        this.isWasmReady = false;
        this.useWasm = false;
        
        // 纯JS备选数据
        this.vertices = [];
        this.faces = [];
        this.seamEdges = new Set();
        this.uvResult = null;
    }
    
    /**
     * 初始化（尝试加载WASM模块）
     */
    async init() {
        try {
            // 尝试动态导入WASM模块
            if (typeof BFFModule !== 'undefined') {
                this.wasmModule = await BFFModule();
                this.wasmModule.init();
                this.isWasmReady = true;
                this.useWasm = true;
                console.log('BFF: 使用WASM加速模式');
                return true;
            }
        } catch (e) {
            console.warn('BFF: WASM模块加载失败，使用纯JavaScript模式', e);
        }
        
        console.log('BFF: 使用纯JavaScript模式');
        this.useWasm = false;
        return true;
    }
    
    /**
     * 设置网格数据
     * @param {Array} vertices - 顶点数组 [{x, y, z}, ...]
     * @param {Array} faces - 面数组 [[v0, v1, v2], ...]
     */
    setMesh(vertices, faces) {
        if (this.useWasm && this.wasmModule) {
            // 转换为扁平数组
            const flatVerts = new Float64Array(vertices.length * 3);
            for (let i = 0; i < vertices.length; i++) {
                flatVerts[i * 3] = vertices[i].x;
                flatVerts[i * 3 + 1] = vertices[i].y;
                flatVerts[i * 3 + 2] = vertices[i].z;
            }
            
            const flatFaces = new Int32Array(faces.length * 3);
            for (let i = 0; i < faces.length; i++) {
                flatFaces[i * 3] = faces[i][0];
                flatFaces[i * 3 + 1] = faces[i][1];
                flatFaces[i * 3 + 2] = faces[i][2];
            }
            
            this.wasmModule.setMesh(flatVerts, flatFaces);
        } else {
            this.vertices = vertices;
            this.faces = faces;
        }
    }
    
    /**
     * 添加缝线边
     * @param {number} v1 - 顶点1索引
     * @param {number} v2 - 顶点2索引
     */
    addSeamEdge(v1, v2) {
        if (this.useWasm && this.wasmModule) {
            this.wasmModule.addSeamEdge(v1, v2);
        } else {
            const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
            this.seamEdges.add(key);
        }
    }
    
    /**
     * 清除缝线
     */
    clearSeams() {
        if (this.useWasm && this.wasmModule) {
            this.wasmModule.clearSeams();
        } else {
            this.seamEdges.clear();
        }
    }
    
    /**
     * 执行展开
     * @param {Function} onProgress - 进度回调
     * @returns {Promise<Object>} 展开结果
     */
    async flatten(onProgress = null) {
        if (this.useWasm && this.wasmModule) {
            return this.flattenWasm(onProgress);
        } else {
            return this.flattenJS(onProgress);
        }
    }
    
    /**
     * WASM展开
     */
    async flattenWasm(onProgress) {
        if (onProgress) onProgress(10);
        
        const success = this.wasmModule.flatten();
        
        if (!success) {
            throw new Error(this.wasmModule.getError());
        }
        
        if (onProgress) onProgress(90);
        
        const uvArray = this.wasmModule.getUVCoords();
        const uvCount = this.wasmModule.getUVCount();
        
        // 转换为UV对象数组
        const uvs = [];
        for (let i = 0; i < uvCount; i++) {
            uvs.push({
                u: uvArray[i * 2],
                v: uvArray[i * 2 + 1]
            });
        }
        
        if (onProgress) onProgress(100);
        
        return {
            uvs: uvs,
            success: true
        };
    }
    
    /**
     * 纯JavaScript展开（优化版）
     */
    async flattenJS(onProgress) {
        if (this.vertices.length === 0 || this.faces.length === 0) {
            throw new Error('Empty mesh');
        }
        
        const uvs = new Array(this.vertices.length).fill(null).map(() => ({ u: 0, v: 0 }));
        const placed = new Set();
        
        if (onProgress) onProgress(5);
        
        // 预计算边到面的映射
        const edgeToFaces = new Map();
        for (let fIdx = 0; fIdx < this.faces.length; fIdx++) {
            const face = this.faces[fIdx];
            for (let i = 0; i < 3; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % 3];
                const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                if (!edgeToFaces.has(key)) {
                    edgeToFaces.set(key, []);
                }
                edgeToFaces.get(key).push(fIdx);
            }
        }
        
        if (onProgress) onProgress(10);
        
        // 放置第一个三角形
        const firstFace = this.faces[0];
        const v0 = this.vertices[firstFace[0]];
        const v1 = this.vertices[firstFace[1]];
        const v2 = this.vertices[firstFace[2]];
        
        const e01 = this.distance(v0, v1);
        const e02 = this.distance(v0, v2);
        const e12 = this.distance(v1, v2);
        
        uvs[firstFace[0]] = { u: 0, v: 0 };
        placed.add(firstFace[0]);
        
        uvs[firstFace[1]] = { u: e01, v: 0 };
        placed.add(firstFace[1]);
        
        const cosA = Math.max(-1, Math.min(1, (e01 * e01 + e02 * e02 - e12 * e12) / (2 * e01 * e02)));
        const sinA = Math.sqrt(1 - cosA * cosA);
        uvs[firstFace[2]] = { u: e02 * cosA, v: e02 * sinA };
        placed.add(firstFace[2]);
        
        // BFS展开
        const processedFaces = new Set([0]);
        const queue = [0];
        let processCount = 0;
        const totalFaces = this.faces.length;
        
        while (queue.length > 0) {
            const currentFaceIdx = queue.shift();
            const currentFace = this.faces[currentFaceIdx];
            
            processCount++;
            if (onProgress && processCount % 100 === 0) {
                onProgress(10 + (processCount / totalFaces) * 70);
                await new Promise(r => setTimeout(r, 0)); // 让UI响应
            }
            
            // 检查每条边的相邻面
            for (let i = 0; i < 3; i++) {
                const ev1 = currentFace[i];
                const ev2 = currentFace[(i + 1) % 3];
                const key = ev1 < ev2 ? `${ev1}_${ev2}` : `${ev2}_${ev1}`;
                
                const neighborFaces = edgeToFaces.get(key) || [];
                
                for (const neighborFaceIdx of neighborFaces) {
                    if (processedFaces.has(neighborFaceIdx)) continue;
                    
                    const neighborFace = this.faces[neighborFaceIdx];
                    
                    // 找共享顶点和新顶点
                    let sharedV1 = -1, sharedV2 = -1, newV = -1;
                    for (const v of neighborFace) {
                        if (placed.has(v)) {
                            if (sharedV1 === -1) sharedV1 = v;
                            else sharedV2 = v;
                        } else {
                            newV = v;
                        }
                    }
                    
                    if (sharedV1 === -1 || sharedV2 === -1 || newV === -1) continue;
                    
                    // 计算新顶点UV
                    const p1 = uvs[sharedV1];
                    const p2 = uvs[sharedV2];
                    
                    const len12 = this.distance(this.vertices[sharedV1], this.vertices[sharedV2]);
                    const len1n = this.distance(this.vertices[sharedV1], this.vertices[newV]);
                    const len2n = this.distance(this.vertices[sharedV2], this.vertices[newV]);
                    
                    if (len12 < 1e-10) continue;
                    
                    const cosAngle = Math.max(-1, Math.min(1, 
                        (len12 * len12 + len1n * len1n - len2n * len2n) / (2 * len12 * len1n)));
                    const sinAngle = Math.sqrt(1 - cosAngle * cosAngle);
                    
                    // 计算方向
                    const dx = p2.u - p1.u;
                    const dy = p2.v - p1.v;
                    const len2d = Math.sqrt(dx * dx + dy * dy);
                    
                    if (len2d < 1e-10) continue;
                    
                    const dirX = dx / len2d;
                    const dirY = dy / len2d;
                    const perpX = -dirY;
                    const perpY = dirX;
                    
                    // 新位置 (newVertexIdx 是顶点索引，newUVu/newUVv 是UV坐标)
                    const newVertexIdx = newV; // 保存顶点索引
                    let newUVu = p1.u + dirX * len1n * cosAngle + perpX * len1n * sinAngle;
                    let newUVv = p1.v + dirY * len1n * cosAngle + perpY * len1n * sinAngle;
                    
                    // 检查朝向
                    const cross = (p2.u - p1.u) * (newUVv - p1.v) - (p2.v - p1.v) * (newUVu - p1.u);
                    if (cross < 0) {
                        newUVu = p1.u + dirX * len1n * cosAngle - perpX * len1n * sinAngle;
                        newUVv = p1.v + dirY * len1n * cosAngle - perpY * len1n * sinAngle;
                    }
                    
                    uvs[newVertexIdx] = { u: newUVu, v: newUVv };
                    placed.add(newVertexIdx);
                    processedFaces.add(neighborFaceIdx);
                    queue.push(neighborFaceIdx);
                }
            }
        }
        
        if (onProgress) onProgress(70);
        
        // 简单的平滑优化
        await this.optimizeUVs(uvs, 15, onProgress);
        
        if (onProgress) onProgress(85);
        
        // 检测UV岛并分离排列
        const islands = this.detectUVIslands(uvs);
        console.log(`检测到 ${islands.length} 个UV岛`);
        
        if (onProgress) onProgress(90);
        
        // 排列UV岛，确保不重叠
        this.arrangeUVIslands(uvs, islands);
        
        if (onProgress) onProgress(95);
        
        // 最终归一化
        this.normalizeUVs(uvs);
        
        if (onProgress) onProgress(100);
        
        this.uvResult = uvs;
        
        return {
            uvs: uvs,
            islands: islands,
            success: true
        };
    }
    
    /**
     * 检测UV岛 - 找出不连通的UV区域
     * @returns {Array} 每个UV岛包含的面索引数组
     */
    detectUVIslands(uvs) {
        const islands = [];
        const visitedFaces = new Set();
        
        // 构建面到面的邻接关系（通过共享边）
        const faceAdjacency = new Map();
        const edgeToFaces = new Map();
        
        for (let faceIdx = 0; faceIdx < this.faces.length; faceIdx++) {
            const face = this.faces[faceIdx];
            faceAdjacency.set(faceIdx, new Set());
            
            // 记录每条边属于哪些面
            for (let i = 0; i < 3; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % 3];
                const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                
                // 检查这条边是否是缝线（被切断）
                const isSeamEdge = this.seamEdges.has(edgeKey);
                
                if (!isSeamEdge) {
                    if (!edgeToFaces.has(edgeKey)) {
                        edgeToFaces.set(edgeKey, []);
                    }
                    edgeToFaces.get(edgeKey).push(faceIdx);
                }
            }
        }
        
        // 建立面邻接关系（排除缝线边）
        for (const [edgeKey, faces] of edgeToFaces) {
            if (faces.length === 2) {
                faceAdjacency.get(faces[0]).add(faces[1]);
                faceAdjacency.get(faces[1]).add(faces[0]);
            }
        }
        
        // BFS找出所有连通的UV岛
        for (let faceIdx = 0; faceIdx < this.faces.length; faceIdx++) {
            if (visitedFaces.has(faceIdx)) continue;
            
            const island = {
                faces: [],
                vertices: new Set()
            };
            
            const queue = [faceIdx];
            visitedFaces.add(faceIdx);
            
            while (queue.length > 0) {
                const currentFace = queue.shift();
                island.faces.push(currentFace);
                
                // 添加该面的顶点
                for (const v of this.faces[currentFace]) {
                    island.vertices.add(v);
                }
                
                // 遍历相邻面
                const neighbors = faceAdjacency.get(currentFace);
                if (neighbors) {
                    for (const neighbor of neighbors) {
                        if (!visitedFaces.has(neighbor)) {
                            visitedFaces.add(neighbor);
                            queue.push(neighbor);
                        }
                    }
                }
            }
            
            islands.push(island);
        }
        
        return islands;
    }
    
    /**
     * 排列UV岛，确保它们不重叠
     */
    arrangeUVIslands(uvs, islands) {
        if (islands.length <= 1) return;
        
        // 计算每个岛的边界框
        const islandBounds = islands.map(island => {
            let minU = Infinity, maxU = -Infinity;
            let minV = Infinity, maxV = -Infinity;
            
            for (const v of island.vertices) {
                if (uvs[v]) {
                    minU = Math.min(minU, uvs[v].u);
                    maxU = Math.max(maxU, uvs[v].u);
                    minV = Math.min(minV, uvs[v].v);
                    maxV = Math.max(maxV, uvs[v].v);
                }
            }
            
            return {
                minU, maxU, minV, maxV,
                width: maxU - minU,
                height: maxV - minV,
                area: (maxU - minU) * (maxV - minV)
            };
        });
        
        // 按面积从大到小排序岛
        const sortedIndices = islands.map((_, i) => i)
            .sort((a, b) => islandBounds[b].area - islandBounds[a].area);
        
        // 使用简单的行排列算法
        const padding = 0.05; // 岛之间的间距
        let currentX = 0;
        let currentY = 0;
        let rowHeight = 0;
        const maxRowWidth = 2.0; // 最大行宽
        
        for (const islandIdx of sortedIndices) {
            const island = islands[islandIdx];
            const bounds = islandBounds[islandIdx];
            
            // 检查是否需要换行
            if (currentX + bounds.width > maxRowWidth && currentX > 0) {
                currentX = 0;
                currentY += rowHeight + padding;
                rowHeight = 0;
            }
            
            // 计算偏移量，将岛移动到新位置
            const offsetU = currentX - bounds.minU;
            const offsetV = currentY - bounds.minV;
            
            // 应用偏移
            for (const v of island.vertices) {
                if (uvs[v]) {
                    uvs[v].u += offsetU;
                    uvs[v].v += offsetV;
                }
            }
            
            // 更新位置
            currentX += bounds.width + padding;
            rowHeight = Math.max(rowHeight, bounds.height);
        }
    }
    
    /**
     * UV优化（拉普拉斯平滑）
     */
    async optimizeUVs(uvs, iterations, onProgress) {
        // 构建顶点邻接
        const neighbors = new Map();
        for (const face of this.faces) {
            for (let i = 0; i < 3; i++) {
                const v = face[i];
                if (!neighbors.has(v)) neighbors.set(v, new Set());
                neighbors.get(v).add(face[(i + 1) % 3]);
                neighbors.get(v).add(face[(i + 2) % 3]);
            }
        }
        
        const alpha = 0.5;
        
        for (let iter = 0; iter < iterations; iter++) {
            const newUVs = uvs.map(uv => ({ ...uv }));
            
            for (const [v, nbs] of neighbors) {
                if (nbs.size < 2) continue;
                
                let sumU = 0, sumV = 0;
                for (const n of nbs) {
                    sumU += uvs[n].u;
                    sumV += uvs[n].v;
                }
                
                newUVs[v].u = uvs[v].u * (1 - alpha) + (sumU / nbs.size) * alpha;
                newUVs[v].v = uvs[v].v * (1 - alpha) + (sumV / nbs.size) * alpha;
            }
            
            for (let i = 0; i < uvs.length; i++) {
                uvs[i] = newUVs[i];
            }
            
            if (onProgress && iter % 5 === 0) {
                onProgress(85 + (iter / iterations) * 10);
                await new Promise(r => setTimeout(r, 0));
            }
        }
    }
    
    /**
     * 归一化UV坐标到 [0, 1]
     */
    normalizeUVs(uvs) {
        let minU = Infinity, maxU = -Infinity;
        let minV = Infinity, maxV = -Infinity;
        
        for (const uv of uvs) {
            if (uv.u < minU) minU = uv.u;
            if (uv.u > maxU) maxU = uv.u;
            if (uv.v < minV) minV = uv.v;
            if (uv.v > maxV) maxV = uv.v;
        }
        
        const scale = Math.max(maxU - minU, maxV - minV);
        if (scale < 1e-10) return;
        
        for (const uv of uvs) {
            uv.u = (uv.u - minU) / scale;
            uv.v = (uv.v - minV) / scale;
        }
    }
    
    /**
     * 计算3D距离
     */
    distance(v1, v2) {
        const dx = v2.x - v1.x;
        const dy = v2.y - v1.y;
        const dz = v2.z - v1.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    
    /**
     * 清理资源
     */
    dispose() {
        if (this.wasmModule) {
            this.wasmModule.cleanup();
            this.wasmModule = null;
        }
        this.vertices = [];
        this.faces = [];
        this.seamEdges.clear();
        this.uvResult = null;
    }
}

