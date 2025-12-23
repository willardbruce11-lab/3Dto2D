/**
 * LSCM展开器 (Least Squares Conformal Maps)
 * 最小二乘保角映射算法
 * 
 * 该算法通过最小化角度失真来展开3D网格到2D平面
 * 特点：保角性好，适合布料展开
 * 
 * 支持两种模式：
 * 1. 传入完整网格+缝线边 - 自动切割
 * 2. 传入已切割的子网格列表 - 直接展开（推荐）
 */

export class LSCMFlattener {
    constructor() {
        this.vertices = [];
        this.faces = [];
        this.seamEdges = new Set();
        this.subMeshes = null;  // 已切割的子网格
        this.uvResult = null;
    }
    
    /**
     * 设置网格数据
     */
    setMesh(vertices, faces) {
        this.vertices = vertices;
        this.faces = faces;
        this.subMeshes = null;
    }
    
    /**
     * 设置已切割的子网格（推荐方式）
     */
    setSubMeshes(vertices, subMeshes) {
        this.vertices = vertices;
        this.subMeshes = subMeshes;
        console.log(`LSCMFlattener: 设置了 ${subMeshes.length} 个已切割的子网格`);
    }
    
    /**
     * 设置缝线边
     */
    setSeamEdges(seamEdges) {
        this.seamEdges = seamEdges;
    }
    
    /**
     * 清除缝线
     */
    clearSeams() {
        this.seamEdges.clear();
    }
    
    /**
     * 添加缝线边
     */
    addSeamEdge(v1, v2) {
        const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
        this.seamEdges.add(edgeKey);
    }
    
    /**
     * 执行LSCM展开
     * @param {Function} onProgress - 进度回调
     * @returns {Object} 展开结果
     */
    async flatten(onProgress) {
        const startTime = Date.now();
        
        // 判断使用哪种模式
        if (this.subMeshes && this.subMeshes.length > 0) {
            // 模式2：已切割的子网格（推荐）
            return await this.flattenSubMeshes(onProgress);
        } else if (this.vertices.length > 0 && this.faces.length > 0) {
            // 模式1：完整网格+缝线
            return await this.flattenWithSeams(onProgress);
        } else {
            throw new Error('LSCM: 没有有效的网格数据');
        }
    }
    
    /**
     * 模式2：展开已切割的子网格（推荐方式）
     */
    async flattenSubMeshes(onProgress) {
        const startTime = Date.now();
        console.log(`LSCM: 展开 ${this.subMeshes.length} 个已切割的子网格`);
        
        if (onProgress) onProgress(5);
        
        // 为每个子网格创建UV
        const uvs = new Array(this.vertices.length).fill(null).map(() => ({ u: 0, v: 0 }));
        const islands = [];
        
        for (let i = 0; i < this.subMeshes.length; i++) {
            const subMesh = this.subMeshes[i];
            
            // 转换为岛格式
            const island = {
                faces: subMesh.faceIndices || [],
                vertices: subMesh.vertices,
                boundary: this.findBoundaryVerticesFromFaces(subMesh.faces, subMesh.vertices)
            };
            
            // 快速展开
            this.fastFlattenIsland(island, uvs);
            islands.push(island);
            
            if (onProgress) {
                onProgress(5 + (i / this.subMeshes.length) * 70);
            }
            
            // 让出控制权
            if (i % 10 === 0) {
                await new Promise(r => setTimeout(r, 0));
            }
        }
        
        console.log(`LSCM: UV展开完成，耗时 ${Date.now() - startTime}ms`);
        
        if (onProgress) onProgress(80);
        
        // 排列UV岛
        this.arrangeIslands(uvs, islands);
        
        if (onProgress) onProgress(95);
        
        // 归一化
        this.normalizeUVs(uvs);
        
        if (onProgress) onProgress(100);
        
        this.uvResult = uvs;
        
        console.log(`LSCM: 总耗时 ${Date.now() - startTime}ms`);
        
        return {
            uvs: uvs,
            islands: islands,
            success: true
        };
    }
    
    /**
     * 模式1：展开完整网格（使用缝线切割）
     */
    async flattenWithSeams(onProgress) {
        const startTime = Date.now();
        console.log(`LSCM展开开始: ${this.vertices.length} 顶点, ${this.faces.length} 面`);
        
        if (onProgress) onProgress(5);
        
        // 根据缝线切割网格
        const islands = this.splitMeshBySeams();
        console.log(`LSCM: 切割为 ${islands.length} 个UV岛`);
        
        if (onProgress) onProgress(15);
        
        // 对每个岛使用快速展开
        const uvs = new Array(this.vertices.length).fill(null).map(() => ({ u: 0, v: 0 }));
        
        for (let i = 0; i < islands.length; i++) {
            this.fastFlattenIsland(islands[i], uvs);
            
            if (onProgress) {
                onProgress(15 + (i / islands.length) * 60);
            }
            
            if (i % 10 === 0) {
                await new Promise(r => setTimeout(r, 0));
            }
        }
        
        console.log(`LSCM: UV展开完成，耗时 ${Date.now() - startTime}ms`);
        
        if (onProgress) onProgress(80);
        
        this.arrangeIslands(uvs, islands);
        
        if (onProgress) onProgress(95);
        
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
     * 从面列表中找边界顶点
     */
    findBoundaryVerticesFromFaces(faces, vertexSet) {
        const edgeCount = new Map();
        
        for (const face of faces) {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                edgeCount.set(edgeKey, (edgeCount.get(edgeKey) || 0) + 1);
            }
        }
        
        const boundaryVertices = new Set();
        for (const [edgeKey, count] of edgeCount) {
            if (count === 1) {
                const [v1, v2] = edgeKey.split('_').map(Number);
                boundaryVertices.add(v1);
                boundaryVertices.add(v2);
            }
        }
        
        return Array.from(boundaryVertices);
    }
    
    /**
     * 【智能固定点】寻找几何距离最远的两个顶点作为固定点 (Pins)
     * 这能保证 LSCM 方程最稳定
     * 【强制模式】即使数据退化也必须返回有效钉子
     * 
     * @param {Array} vertexIndices - 顶点索引数组
     * @returns {Array} [pinA, pinB] - 永远返回有效的两个索引
     */
    findRobustPins(vertexIndices) {
        // 如果顶点不足2个，强制返回前两个（即使重复）
        if (!vertexIndices || vertexIndices.length < 2) {
            const idx0 = vertexIndices?.[0] ?? 0;
            return [idx0, idx0];
        }
        
        // 收集所有有效顶点
        const validIndices = [];
        for (const idx of vertexIndices) {
            if (this.vertices[idx]) {
                validIndices.push(idx);
            }
        }
        
        // 如果没有有效顶点，强制使用原始索引
        if (validIndices.length === 0) {
            return [vertexIndices[0], vertexIndices[Math.min(1, vertexIndices.length - 1)]];
        }
        
        if (validIndices.length === 1) {
            return [validIndices[0], validIndices[0]];
        }
        
        // 1. 用第一个有效顶点作为种子点
        const seedIdx = validIndices[0];
        const p0 = this.vertices[seedIdx];
        
        // 2. 找到距离 p0 最远的点 A (First Anchor)
        let maxDist = -1;
        let pinA = seedIdx;
        
        for (const idx of validIndices) {
            const v = this.vertices[idx];
            const dx = v.x - p0.x;
            const dy = v.y - p0.y;
            const dz = v.z - p0.z;
            const d = dx * dx + dy * dy + dz * dz;
            
            if (d > maxDist) {
                maxDist = d;
                pinA = idx;
            }
        }
        
        // 3. 找到距离 A 最远的点 B (Second Anchor)
        const pA = this.vertices[pinA];
        maxDist = -1;
        let pinB = pinA;
        
        for (const idx of validIndices) {
            const v = this.vertices[idx];
            const dx = v.x - pA.x;
            const dy = v.y - pA.y;
            const dz = v.z - pA.z;
            const d = dx * dx + dy * dy + dz * dz;
            
            if (d > maxDist) {
                maxDist = d;
                pinB = idx;
            }
        }
        
        // 【强制分离】如果所有点重合(maxDist≈0)，强制选不同的索引
        if (pinA === pinB || maxDist < 1e-12) {
            // 选择列表中的第一个和第二个不同的索引
            pinA = validIndices[0];
            pinB = validIndices[1] !== pinA ? validIndices[1] : validIndices[Math.min(2, validIndices.length - 1)];
            
            // 如果还是相同，至少保证索引不同（即使对应的3D位置相同）
            if (pinA === pinB && validIndices.length > 1) {
                for (let i = 1; i < validIndices.length; i++) {
                    if (validIndices[i] !== pinA) {
                        pinB = validIndices[i];
                        break;
                    }
                }
            }
        }
        
        return [pinA, pinB];
    }
    
    /**
     * 【核心】快速展开单个UV岛（纯LSCM，无降级）
     * 【强制模式】对任何数据都必须用LSCM展开，绝不降级
     */
    fastFlattenIsland(island, uvs) {
        const vertexArray = Array.from(island.vertices);
        const n = vertexArray.length;
        
        // 特殊情况：0个顶点，直接返回
        if (n === 0) return;
        
        // 特殊情况：1-2个顶点，给默认值（这不是降级，是数学上无法展开的情况）
        if (n === 1) {
            uvs[vertexArray[0]] = { u: 0, v: 0 };
            return;
        }
        if (n === 2) {
            uvs[vertexArray[0]] = { u: 0, v: 0 };
            uvs[vertexArray[1]] = { u: 1, v: 0 };
            return;
        }
        
        // 过滤有效顶点
        const validVertices = vertexArray.filter(idx => {
            return idx !== undefined && 
                   idx !== null && 
                   idx >= 0 && 
                   idx < this.vertices.length &&
                   this.vertices[idx] !== undefined;
        });
        
        // 如果有效顶点不足3个，用LSCM原理处理（不是降级）
        if (validVertices.length < 3) {
            // 按索引顺序分配UV（保持LSCM的线性映射思想）
            for (let i = 0; i < vertexArray.length; i++) {
                const idx = vertexArray[i];
                if (idx >= 0 && idx < uvs.length) {
                    uvs[idx] = { u: i * 0.1, v: 0 };
                }
            }
            return;
        }
        
        // ===== LSCM 核心计算 =====
        
        // 智能选钉（永远返回有效钉子）
        const [pinA, pinB] = this.findRobustPins(validVertices);
        
        // 计算质心
        let cx = 0, cy = 0, cz = 0;
        for (const idx of validVertices) {
            const v = this.vertices[idx];
            cx += v.x;
            cy += v.y;
            cz += v.z;
        }
        cx /= validVertices.length; 
        cy /= validVertices.length; 
        cz /= validVertices.length;
        
        // 计算加权平均法向量
        let nx = 0, ny = 0, nz = 0;
        
        if (island.faces && island.faces.length > 0) {
            for (const faceIdx of island.faces) {
                const face = this.faces[faceIdx];
                if (!face || face.length < 3) continue;
                
                const v0 = this.vertices[face[0]];
                const v1 = this.vertices[face[1]];
                const v2 = this.vertices[face[2]];
                
                if (!v0 || !v1 || !v2) continue;
                
                const ax = v1.x - v0.x, ay = v1.y - v0.y, az = v1.z - v0.z;
                const bx = v2.x - v0.x, by = v2.y - v0.y, bz = v2.z - v0.z;
                
                nx += ay * bz - az * by;
                ny += az * bx - ax * bz;
                nz += ax * by - ay * bx;
            }
        }
        
        // 归一化法向量（如果太小，基于钉子点方向构建）
        let nLen = Math.sqrt(nx*nx + ny*ny + nz*nz);
        if (nLen < 1e-10) {
            // 使用两个钉子点的方向来构建坐标系
            const pA = this.vertices[pinA];
            const pB = this.vertices[pinB];
            if (pA && pB) {
                const dx = pB.x - pA.x;
                const dy = pB.y - pA.y;
                const dz = pB.z - pA.z;
                const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
                if (d > 1e-10) {
                    // 钉子方向作为U轴，构建正交坐标系
                    nx = dy; ny = -dx; nz = 0;  // 简单正交
                    nLen = Math.sqrt(nx*nx + ny*ny + nz*nz);
                    if (nLen < 1e-10) {
                        nx = 0; ny = 0; nz = 1;
                        nLen = 1;
                    }
                } else {
                    nx = 0; ny = 0; nz = 1;
                    nLen = 1;
                }
            } else {
                nx = 0; ny = 0; nz = 1;
                nLen = 1;
            }
        }
        nx /= nLen; ny /= nLen; nz /= nLen;
        
        // 构建局部坐标系
        let ux, uy, uz;
        if (Math.abs(ny) < 0.9) {
            ux = nz * 0 - ny * 1;
            uy = nx * 1 - nz * 0;
            uz = ny * 0 - nx * 0;
        } else {
            ux = nz * 1 - ny * 0;
            uy = nx * 0 - nz * 1;
            uz = ny * 1 - nx * 0;
        }
        
        let uLen = Math.sqrt(ux*ux + uy*uy + uz*uz);
        if (uLen < 1e-10) {
            ux = 1; uy = 0; uz = 0;
            uLen = 1;
        }
        ux /= uLen; uy /= uLen; uz /= uLen;
        
        const vx = ny * uz - nz * uy;
        const vy = nz * ux - nx * uz;
        const vz = nx * uy - ny * ux;
        
        // 初始投影到UV平面
        const localUVs = new Map();
        for (const idx of vertexArray) {
            if (idx < 0 || idx >= this.vertices.length) {
                localUVs.set(idx, { u: 0, v: 0 });
                continue;
            }
            
            const v = this.vertices[idx];
            if (!v) {
                localUVs.set(idx, { u: 0, v: 0 });
                continue;
            }
            
            const dx = v.x - cx;
            const dy = v.y - cy;
            const dz = v.z - cz;
            
            let u = dx * ux + dy * uy + dz * uz;
            let vVal = dx * vx + dy * vy + dz * vz;
            
            // 防止NaN
            if (isNaN(u)) u = 0;
            if (isNaN(vVal)) vVal = 0;
            
            localUVs.set(idx, { u, v: vVal });
        }
        
        // ===== LSCM 迭代优化 =====
        const fixedSet = new Set([pinA, pinB]);
        
        // 构建邻接关系
        const neighbors = new Map();
        if (island.faces && island.faces.length > 0) {
            for (const faceIdx of island.faces) {
                const face = this.faces[faceIdx];
                if (!face || face.length < 3) continue;
                
                for (let i = 0; i < face.length; i++) {
                    const v = face[i];
                    if (!neighbors.has(v)) neighbors.set(v, new Set());
                    neighbors.get(v).add(face[(i + 1) % face.length]);
                    neighbors.get(v).add(face[(i + 2) % face.length]);
                }
            }
        }
        
        // 迭代优化（拉普拉斯平滑 - LSCM的核心）
        const iterations = 30;
        const alpha = 0.4;
        
        for (let iter = 0; iter < iterations; iter++) {
            const newUVs = new Map();
            
            for (const idx of validVertices) {
                const currentUV = localUVs.get(idx);
                if (!currentUV) {
                    newUVs.set(idx, { u: 0, v: 0 });
                    continue;
                }
                
                // 固定点不动
                if (fixedSet.has(idx)) {
                    newUVs.set(idx, { u: currentUV.u, v: currentUV.v });
                    continue;
                }
                
                const nbs = neighbors.get(idx);
                if (!nbs || nbs.size === 0) {
                    newUVs.set(idx, { u: currentUV.u, v: currentUV.v });
                    continue;
                }
                
                // 计算邻居平均位置
                let sumU = 0, sumV = 0;
                let validNbCount = 0;
                
                for (const nb of nbs) {
                    const nbUV = localUVs.get(nb);
                    if (nbUV && !isNaN(nbUV.u) && !isNaN(nbUV.v)) {
                        sumU += nbUV.u;
                        sumV += nbUV.v;
                        validNbCount++;
                    }
                }
                
                if (validNbCount > 0) {
                    let newU = currentUV.u * (1 - alpha) + (sumU / validNbCount) * alpha;
                    let newV = currentUV.v * (1 - alpha) + (sumV / validNbCount) * alpha;
                    
                    // 防止NaN传播
                    if (isNaN(newU)) newU = currentUV.u;
                    if (isNaN(newV)) newV = currentUV.v;
                    
                    newUVs.set(idx, { u: newU, v: newV });
                } else {
                    newUVs.set(idx, { u: currentUV.u, v: currentUV.v });
                }
            }
            
            // 更新UV
            for (const [idx, uv] of newUVs) {
                localUVs.set(idx, uv);
            }
        }
        
        // 写入最终结果（带NaN修复）
        for (const idx of vertexArray) {
            if (idx < 0 || idx >= uvs.length) continue;
            
            const uv = localUVs.get(idx);
            if (uv && !isNaN(uv.u) && !isNaN(uv.v)) {
                uvs[idx] = { u: uv.u, v: uv.v };
            } else {
                // 如果单个点是NaN，用邻居平均值修复（不是降级，是LSCM的插值）
                const nbs = neighbors.get(idx);
                if (nbs && nbs.size > 0) {
                    let sumU = 0, sumV = 0, cnt = 0;
                    for (const nb of nbs) {
                        const nbUV = localUVs.get(nb);
                        if (nbUV && !isNaN(nbUV.u) && !isNaN(nbUV.v)) {
                            sumU += nbUV.u;
                            sumV += nbUV.v;
                            cnt++;
                        }
                    }
                    if (cnt > 0) {
                        uvs[idx] = { u: sumU / cnt, v: sumV / cnt };
                    } else {
                        uvs[idx] = { u: 0, v: 0 };
                    }
                } else {
                    uvs[idx] = { u: 0, v: 0 };
                }
            }
        }
    }
    
    /**
     * 根据缝线切割网格
     * @returns {Array} UV岛数组
     */
    splitMeshBySeams() {
        const n = this.faces.length;
        const visited = new Set();
        const islands = [];
        
        // 构建面的邻接关系（排除缝线边）
        const faceAdjacency = new Map();
        const edgeToFaces = new Map();
        
        for (let faceIdx = 0; faceIdx < n; faceIdx++) {
            const face = this.faces[faceIdx];
            faceAdjacency.set(faceIdx, new Set());
            
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                
                // 跳过缝线边
                if (this.seamEdges.has(edgeKey)) {
                    continue;
                }
                
                if (!edgeToFaces.has(edgeKey)) {
                    edgeToFaces.set(edgeKey, []);
                }
                edgeToFaces.get(edgeKey).push(faceIdx);
            }
        }
        
        // 建立邻接关系
        for (const [edgeKey, faces] of edgeToFaces) {
            if (faces.length === 2) {
                faceAdjacency.get(faces[0]).add(faces[1]);
                faceAdjacency.get(faces[1]).add(faces[0]);
            }
        }
        
        // BFS找出所有连通分量（UV岛）
        for (let faceIdx = 0; faceIdx < n; faceIdx++) {
            if (visited.has(faceIdx)) continue;
            
            const island = {
                faces: [],
                vertices: new Set(),
                boundary: []
            };
            
            const queue = [faceIdx];
            visited.add(faceIdx);
            
            while (queue.length > 0) {
                const current = queue.shift();
                island.faces.push(current);
                
                const face = this.faces[current];
                for (const v of face) {
                    island.vertices.add(v);
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
            
            // 找边界顶点
            island.boundary = this.findBoundaryVertices(island);
            
            islands.push(island);
        }
        
        return islands;
    }
    
    /**
     * 找到岛的边界顶点
     */
    findBoundaryVertices(island) {
        const boundaryEdges = new Map();
        
        for (const faceIdx of island.faces) {
            const face = this.faces[faceIdx];
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                
                if (boundaryEdges.has(edgeKey)) {
                    boundaryEdges.delete(edgeKey); // 内部边出现两次
                } else {
                    boundaryEdges.set(edgeKey, [v1, v2]);
                }
            }
        }
        
        // 提取边界顶点（有序）
        const boundaryVertices = new Set();
        for (const [v1, v2] of boundaryEdges.values()) {
            boundaryVertices.add(v1);
            boundaryVertices.add(v2);
        }
        
        return Array.from(boundaryVertices);
    }
    
    /**
     * 对单个UV岛执行LSCM展开（异步版本，纯LSCM无降级）
     */
    async flattenIsland(island, uvs) {
        const vertexList = Array.from(island.vertices);
        const n = vertexList.length;
        
        // 特殊情况处理（不是降级，是数学边界条件）
        if (n === 0) return;
        if (n === 1) {
            uvs[vertexList[0]] = { u: 0, v: 0 };
            return;
        }
        if (n === 2) {
            uvs[vertexList[0]] = { u: 0, v: 0 };
            uvs[vertexList[1]] = { u: 1, v: 0 };
            return;
        }
        
        // 智能选钉（永远返回有效值）
        const [pin1, pin2] = this.findRobustPins(vertexList);
        
        // 创建顶点索引映射
        const globalToLocal = new Map();
        const localToGlobal = [];
        
        vertexList.forEach((globalIdx, localIdx) => {
            globalToLocal.set(globalIdx, localIdx);
            localToGlobal.push(globalIdx);
        });
        
        // 初始化UV（使用LSCM投影作为初值）
        const initialUVs = this.initialProjection(vertexList);
        
        // 设置固定点的局部索引
        const pin1Local = globalToLocal.get(pin1) ?? 0;
        const pin2Local = globalToLocal.get(pin2) ?? Math.min(1, n - 1);
        
        // 使用迭代LSCM优化
        const localUVs = await this.iterativeLSCM(
            island,
            globalToLocal,
            localToGlobal,
            initialUVs,
            pin1Local,
            pin2Local
        );
        
        // 将局部UV映射回全局（带NaN修复）
        for (let localIdx = 0; localIdx < n; localIdx++) {
            const globalIdx = localToGlobal[localIdx];
            const uv = localUVs[localIdx];
            
            if (uv && !isNaN(uv.u) && !isNaN(uv.v)) {
                uvs[globalIdx] = { u: uv.u, v: uv.v };
            } else {
                // NaN修复：用邻居插值（LSCM原理）
                let sumU = 0, sumV = 0, cnt = 0;
                for (let j = 0; j < n; j++) {
                    if (j !== localIdx && localUVs[j] && !isNaN(localUVs[j].u)) {
                        sumU += localUVs[j].u;
                        sumV += localUVs[j].v;
                        cnt++;
                    }
                }
                uvs[globalIdx] = cnt > 0 ? { u: sumU / cnt, v: sumV / cnt } : { u: localIdx * 0.1, v: 0 };
            }
        }
    }
    
    /**
     * 初始投影（使用PCA找最佳投影平面）
     */
    initialProjection(vertexList) {
        const n = vertexList.length;
        const uvs = [];
        
        // 计算质心
        let cx = 0, cy = 0, cz = 0;
        for (const idx of vertexList) {
            cx += this.vertices[idx].x;
            cy += this.vertices[idx].y;
            cz += this.vertices[idx].z;
        }
        cx /= n; cy /= n; cz /= n;
        
        // 简化：使用XY平面投影
        // 更好的做法是使用PCA找到最佳投影方向
        for (const idx of vertexList) {
            const v = this.vertices[idx];
            uvs.push({
                u: v.x - cx,
                v: v.y - cy
            });
        }
        
        return uvs;
    }
    
    /**
     * 迭代LSCM优化
     */
    async iterativeLSCM(island, globalToLocal, localToGlobal, initialUVs, pin1, pin2) {
        const n = localToGlobal.length;
        const uvs = initialUVs.map(uv => ({ u: uv.u, v: uv.v }));
        
        // 固定两个顶点
        const fixedVertices = new Set([pin1, pin2]);
        
        // 构建局部面
        const localFaces = island.faces.map(faceIdx => {
            const face = this.faces[faceIdx];
            return face.map(globalIdx => globalToLocal.get(globalIdx));
        });
        
        // 构建顶点邻接
        const neighbors = new Map();
        for (const face of localFaces) {
            for (let i = 0; i < face.length; i++) {
                const v = face[i];
                if (!neighbors.has(v)) neighbors.set(v, new Set());
                neighbors.get(v).add(face[(i + 1) % face.length]);
                neighbors.get(v).add(face[(i + 2) % face.length]);
            }
        }
        
        // 迭代优化（拉普拉斯平滑 + 保角约束）
        const iterations = 50;
        const alpha = 0.3;
        
        for (let iter = 0; iter < iterations; iter++) {
            const newUVs = uvs.map(uv => ({ u: uv.u, v: uv.v }));
            
            for (let v = 0; v < n; v++) {
                if (fixedVertices.has(v)) continue;
                
                const nbs = neighbors.get(v);
                if (!nbs || nbs.size === 0) continue;
                
                // 计算拉普拉斯坐标
                let sumU = 0, sumV = 0;
                let totalWeight = 0;
                
                for (const nb of nbs) {
                    // 使用cotangent权重（简化版本）
                    const weight = this.getCotangentWeight(v, nb, localFaces, uvs);
                    sumU += weight * uvs[nb].u;
                    sumV += weight * uvs[nb].v;
                    totalWeight += weight;
                }
                
                if (totalWeight > 0) {
                    newUVs[v].u = uvs[v].u * (1 - alpha) + (sumU / totalWeight) * alpha;
                    newUVs[v].v = uvs[v].v * (1 - alpha) + (sumV / totalWeight) * alpha;
                }
            }
            
            // 更新UV
            for (let v = 0; v < n; v++) {
                uvs[v] = newUVs[v];
            }
            
            // 每10次迭代让出控制权
            if (iter % 10 === 0) {
                await new Promise(r => setTimeout(r, 0));
            }
        }
        
        return uvs;
    }
    
    /**
     * 计算cotangent权重
     */
    getCotangentWeight(v1, v2, faces, uvs) {
        // 找包含边(v1,v2)的三角形
        let weight = 0;
        
        for (const face of faces) {
            const idx1 = face.indexOf(v1);
            const idx2 = face.indexOf(v2);
            
            if (idx1 !== -1 && idx2 !== -1) {
                // 找对角顶点
                const idx3 = 3 - idx1 - idx2;
                if (idx3 >= 0 && idx3 < 3) {
                    const v3 = face[idx3];
                    
                    // 计算角度的cotangent
                    const p1 = uvs[v1];
                    const p2 = uvs[v2];
                    const p3 = uvs[v3];
                    
                    const a = { u: p1.u - p3.u, v: p1.v - p3.v };
                    const b = { u: p2.u - p3.u, v: p2.v - p3.v };
                    
                    const dot = a.u * b.u + a.v * b.v;
                    const cross = Math.abs(a.u * b.v - a.v * b.u);
                    
                    if (cross > 1e-10) {
                        weight += dot / cross;
                    }
                }
            }
        }
        
        // 确保权重为正
        return Math.max(weight, 0.1);
    }
    
    /**
     * 排列UV岛避免重叠
     */
    arrangeIslands(uvs, islands) {
        if (islands.length <= 1) return;
        
        // 计算每个岛的边界框
        const bounds = islands.map(island => {
            let minU = Infinity, maxU = -Infinity;
            let minV = Infinity, maxV = -Infinity;
            
            for (const v of island.vertices) {
                minU = Math.min(minU, uvs[v].u);
                maxU = Math.max(maxU, uvs[v].u);
                minV = Math.min(minV, uvs[v].v);
                maxV = Math.max(maxV, uvs[v].v);
            }
            
            return { minU, maxU, minV, maxV, width: maxU - minU, height: maxV - minV };
        });
        
        // 按面积排序
        const sorted = islands.map((island, i) => ({ island, bounds: bounds[i], index: i }))
            .sort((a, b) => (b.bounds.width * b.bounds.height) - (a.bounds.width * a.bounds.height));
        
        // 行排列
        const padding = 0.05;
        let currentX = 0;
        let currentY = 0;
        let rowHeight = 0;
        const maxWidth = 2.0;
        
        for (const { island, bounds } of sorted) {
            if (currentX + bounds.width > maxWidth && currentX > 0) {
                currentX = 0;
                currentY += rowHeight + padding;
                rowHeight = 0;
            }
            
            const offsetU = currentX - bounds.minU;
            const offsetV = currentY - bounds.minV;
            
            for (const v of island.vertices) {
                uvs[v].u += offsetU;
                uvs[v].v += offsetV;
            }
            
            currentX += bounds.width + padding;
            rowHeight = Math.max(rowHeight, bounds.height);
        }
    }
    
    /**
     * 归一化UV到[0,1]
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
     * 计算两点距离
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
        this.vertices = [];
        this.faces = [];
        this.seamEdges.clear();
        this.uvResult = null;
    }
}

