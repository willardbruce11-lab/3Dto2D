/**
 * 拓扑修复模块 v2.0
 * 
 * 核心策略：
 * - 圆筒 (χ=0): 单线补全 - 只找一条最短路径连接两个边界，切一刀
 * - 复杂体 (χ<-1): 直接跳过，让ARAP/LSCM强行展开
 * - 闭合球 (χ=2): 报错提示
 */

export class TopologyRepair {
    
    // 配置参数
    static MIN_FACES = 20;           // 最小面数阈值
    static SNAP_DISTANCE_RATIO = 0.02; // 边界吸附距离比例
    
    /**
     * 修复所有子网格
     */
    static repairAll(subMeshes, minFaces = 50) {
        console.log('========================================');
        console.log('=== 拓扑修复 v2.0 (单线补全模式) ===');
        console.log('========================================');
        
        const startTime = Date.now();
        const results = [];
        let stats = { disk: 0, cylinder: 0, complex: 0, filtered: 0, failed: 0 };
        
        for (let i = 0; i < subMeshes.length; i++) {
            const mesh = subMeshes[i];
            
            // 过滤小碎片
            if (mesh.faces.length < minFaces) {
                stats.filtered++;
                continue;
            }
            
            // 计算欧拉示性数
            const topo = this.computeEuler(mesh);
            
            // 根据拓扑类型处理
            if (topo.euler === 1) {
                // ✅ 完美圆盘
                console.log(`  #${i}: ✅ 圆盘 (${mesh.faces.length} 面)`);
                results.push(mesh);
                stats.disk++;
            }
            else if (topo.euler === 0 && topo.boundaryLoopCount >= 2) {
                // 🔧 圆筒 - 执行单线补全
                console.log(`  #${i}: 🔧 圆筒 (${mesh.faces.length} 面) - 单线补全中...`);
                const fixed = this.repairCylinder(mesh, topo);
                if (fixed) {
                    results.push(...fixed);
                    stats.cylinder++;
                } else {
                    results.push(mesh);
                    stats.failed++;
                }
            }
            else if (topo.euler === 2 && topo.boundaryLoopCount === 0) {
                // ❌ 闭合球体
                console.log(`  #${i}: ❌ 闭合球体 - 无法展开，需要至少画一条红线`);
                results.push(mesh);
                stats.failed++;
            }
            else if (topo.euler < -1) {
                // ⏭️ 复杂体 - 跳过修复
                console.log(`  #${i}: ⏭️ 复杂体 (χ=${topo.euler}, ${mesh.faces.length} 面) - 跳过修复`);
                results.push(mesh);
                stats.complex++;
            }
            else {
                // 其他情况尝试简单修复
                console.log(`  #${i}: ⚠️ 其他 (χ=${topo.euler}) - 尝试修复...`);
                const fixed = this.repairGeneric(mesh, topo);
                results.push(...fixed);
            }
        }
        
        console.log('----------------------------------------');
        console.log(`耗时: ${Date.now() - startTime}ms`);
        console.log(`圆盘: ${stats.disk} | 圆筒修复: ${stats.cylinder} | 复杂跳过: ${stats.complex} | 过滤: ${stats.filtered} | 失败: ${stats.failed}`);
        console.log(`输出: ${results.length} 个裁片`);
        
        return results;
    }
    
    /**
     * 计算欧拉示性数和边界信息
     */
    static computeEuler(mesh) {
        const V = mesh.vertices.length;
        const F = mesh.faces.length;
        
        // 统计边和边界
        const edgeCount = new Map();
        
        for (const face of mesh.faces) {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
            }
        }
        
        const E = edgeCount.size;
        const euler = V - E + F;
        
        // 找边界边
        const boundaryEdges = [];
        for (const [key, count] of edgeCount) {
            if (count === 1) {
                const [v1, v2] = key.split('_').map(Number);
                boundaryEdges.push({ v1, v2, key });
            }
        }
        
        // 计算边界环数量
        const boundaryLoopCount = this.countBoundaryLoops(boundaryEdges);
        
        return { euler, V, E, F, boundaryEdges, boundaryLoopCount };
    }
    
    /**
     * 计算边界环数量
     */
    static countBoundaryLoops(boundaryEdges) {
        if (boundaryEdges.length === 0) return 0;
        
        const adj = new Map();
        for (const e of boundaryEdges) {
            if (!adj.has(e.v1)) adj.set(e.v1, []);
            if (!adj.has(e.v2)) adj.set(e.v2, []);
            adj.get(e.v1).push(e.v2);
            adj.get(e.v2).push(e.v1);
        }
        
        const visited = new Set();
        let count = 0;
        
        for (const v of adj.keys()) {
            if (visited.has(v)) continue;
            count++;
            
            const queue = [v];
            visited.add(v);
            while (queue.length > 0) {
                const curr = queue.shift();
                for (const next of adj.get(curr) || []) {
                    if (!visited.has(next)) {
                        visited.add(next);
                        queue.push(next);
                    }
                }
            }
        }
        
        return count;
    }
    
    /**
     * 🔧 修复圆筒 - 单线补全算法
     * 
     * 步骤：
     * 1. 识别两个边界圈 (Loop A, Loop B)
     * 2. 找两圈之间最短路径
     * 3. 只切一刀
     * 4. 停止！不递归
     */
    static repairCylinder(mesh, topo) {
        const { boundaryEdges } = topo;
        
        // Step 1: 分离边界圈
        const loops = this.separateBoundaryLoops(boundaryEdges);
        
        if (loops.length < 2) {
            console.log('    ❌ 无法识别两个边界圈');
            return null;
        }
        
        const loopA = loops[0];
        const loopB = loops[1];
        
        console.log(`    边界圈: A=${loopA.length}点, B=${loopB.length}点`);
        
        // Step 2: 找两圈之间最短的桥梁
        // 从 Loop A 取一点，找到 Loop B 中最近的点
        const bridge = this.findShortestBridge(mesh, loopA, loopB);
        
        if (!bridge) {
            console.log('    ❌ 无法找到桥梁');
            return null;
        }
        
        console.log(`    桥梁: ${bridge.startV} → ${bridge.endV} (距离: ${bridge.distance.toFixed(4)})`);
        
        // Step 3: 计算最短路径 (测地线)
        let path = this.findGeodesicPath(mesh, bridge.startV, bridge.endV);
        
        if (path.length < 2) {
            console.log('    ❌ 无法计算路径');
            return null;
        }
        
        // Step 3.5: 边界吸附 - 确保路径端点在边界上
        path = this.snapPathToBoundary(mesh, path, loopA, loopB);
        
        console.log(`    切割路径: ${path.length} 个顶点`);
        
        // Step 4: 沿路径切开 (只切一刀！)
        const result = this.cutMeshAlongPath(mesh, path);
        
        if (result.length > 0) {
            console.log(`    ✅ 圆筒已展开为 ${result.length} 个裁片`);
        }
        
        return result.length > 0 ? result : null;
    }
    
    /**
     * 分离边界圈
     */
    static separateBoundaryLoops(boundaryEdges) {
        const adj = new Map();
        for (const e of boundaryEdges) {
            if (!adj.has(e.v1)) adj.set(e.v1, []);
            if (!adj.has(e.v2)) adj.set(e.v2, []);
            adj.get(e.v1).push(e.v2);
            adj.get(e.v2).push(e.v1);
        }
        
        const visited = new Set();
        const loops = [];
        
        for (const startV of adj.keys()) {
            if (visited.has(startV)) continue;
            
            const loop = [];
            const queue = [startV];
            visited.add(startV);
            
            while (queue.length > 0) {
                const v = queue.shift();
                loop.push(v);
                
                for (const next of adj.get(v) || []) {
                    if (!visited.has(next)) {
                        visited.add(next);
                        queue.push(next);
                    }
                }
            }
            
            loops.push(loop);
        }
        
        // 按大小排序
        loops.sort((a, b) => b.length - a.length);
        
        return loops;
    }
    
    /**
     * 找两个边界圈之间最短的桥梁
     */
    static findShortestBridge(mesh, loopA, loopB) {
        let bestBridge = null;
        let minDist = Infinity;
        
        // 采样策略：不遍历所有点，只采样部分
        const sampleA = this.sampleLoop(loopA, 20);
        const sampleB = this.sampleLoop(loopB, 20);
        
        for (const vA of sampleA) {
            for (const vB of sampleB) {
                const dist = this.distance(mesh.vertices[vA], mesh.vertices[vB]);
                if (dist < minDist) {
                    minDist = dist;
                    bestBridge = { startV: vA, endV: vB, distance: dist };
                }
            }
        }
        
        return bestBridge;
    }
    
    /**
     * 采样边界圈
     */
    static sampleLoop(loop, maxSamples) {
        if (loop.length <= maxSamples) return loop;
        
        const step = Math.floor(loop.length / maxSamples);
        const samples = [];
        for (let i = 0; i < loop.length; i += step) {
            samples.push(loop[i]);
        }
        return samples;
    }
    
    /**
     * 计算测地线路径 (BFS，快速)
     */
    static findGeodesicPath(mesh, start, end) {
        // 构建邻接表
        const adj = new Map();
        for (let i = 0; i < mesh.vertices.length; i++) {
            adj.set(i, new Set());
        }
        
        for (const face of mesh.faces) {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                adj.get(v1).add(v2);
                adj.get(v2).add(v1);
            }
        }
        
        // BFS
        const visited = new Set([start]);
        const prev = new Map();
        const queue = [start];
        
        while (queue.length > 0) {
            const curr = queue.shift();
            
            if (curr === end) {
                // 重建路径
                const path = [];
                let node = end;
                while (node !== undefined) {
                    path.unshift(node);
                    node = prev.get(node);
                }
                return path;
            }
            
            for (const next of adj.get(curr) || []) {
                if (!visited.has(next)) {
                    visited.add(next);
                    prev.set(next, curr);
                    queue.push(next);
                }
            }
        }
        
        return [start, end];
    }
    
    /**
     * 边界吸附 - 确保路径端点在边界上
     */
    static snapPathToBoundary(mesh, path, loopA, loopB) {
        if (path.length < 2) return path;
        
        const setA = new Set(loopA);
        const setB = new Set(loopB);
        
        const newPath = [...path];
        
        // 检查起点是否在 loopA 上
        if (!setA.has(newPath[0])) {
            // 找 loopA 中最近的点
            const nearest = this.findNearestInSet(mesh, newPath[0], loopA);
            if (nearest !== null) {
                newPath.unshift(nearest);
            }
        }
        
        // 检查终点是否在 loopB 上
        if (!setB.has(newPath[newPath.length - 1])) {
            const nearest = this.findNearestInSet(mesh, newPath[newPath.length - 1], loopB);
            if (nearest !== null) {
                newPath.push(nearest);
            }
        }
        
        return newPath;
    }
    
    /**
     * 找集合中最近的点
     */
    static findNearestInSet(mesh, vertex, targetSet) {
        let nearest = null;
        let minDist = Infinity;
        
        for (const v of targetSet) {
            const dist = this.distance(mesh.vertices[vertex], mesh.vertices[v]);
            if (dist < minDist) {
                minDist = dist;
                nearest = v;
            }
        }
        
        return nearest;
    }
    
    /**
     * 沿路径切开网格
     */
    static cutMeshAlongPath(mesh, path) {
        if (path.length < 2) return [mesh];
        
        // 构建路径边集合
        const pathEdges = new Set();
        for (let i = 0; i < path.length - 1; i++) {
            const v1 = path[i];
            const v2 = path[i + 1];
            const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
            pathEdges.add(key);
        }
        
        // 构建边到面的映射
        const edgeToFaces = new Map();
        for (let faceIdx = 0; faceIdx < mesh.faces.length; faceIdx++) {
            const face = mesh.faces[faceIdx];
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                
                if (!edgeToFaces.has(key)) edgeToFaces.set(key, []);
                edgeToFaces.get(key).push(faceIdx);
            }
        }
        
        // 构建面邻接（不通过切割路径）
        const faceAdj = new Map();
        for (let i = 0; i < mesh.faces.length; i++) {
            faceAdj.set(i, new Set());
        }
        
        for (const [edgeKey, faces] of edgeToFaces) {
            if (!pathEdges.has(edgeKey) && faces.length === 2) {
                faceAdj.get(faces[0]).add(faces[1]);
                faceAdj.get(faces[1]).add(faces[0]);
            }
        }
        
        // BFS分离面
        const visited = new Set();
        const groups = [];
        
        for (let faceIdx = 0; faceIdx < mesh.faces.length; faceIdx++) {
            if (visited.has(faceIdx)) continue;
            
            const group = [];
            const queue = [faceIdx];
            visited.add(faceIdx);
            
            while (queue.length > 0) {
                const curr = queue.shift();
                group.push(curr);
                
                for (const next of faceAdj.get(curr) || []) {
                    if (!visited.has(next)) {
                        visited.add(next);
                        queue.push(next);
                    }
                }
            }
            
            groups.push(group);
        }
        
        // 如果没有分成多组，切割失败
        if (groups.length <= 1) {
            return [];
        }
        
        // 为每组创建新的子网格
        return groups.map(group => this.createSubMesh(mesh, group));
    }
    
    /**
     * 从面组创建子网格
     */
    static createSubMesh(mesh, faceIndices) {
        const usedVertices = new Set();
        for (const faceIdx of faceIndices) {
            for (const v of mesh.faces[faceIdx]) {
                usedVertices.add(v);
            }
        }
        
        const vertexMap = new Map();
        const newVertices = [];
        let newIdx = 0;
        
        for (const oldIdx of usedVertices) {
            vertexMap.set(oldIdx, newIdx);
            newVertices.push({ ...mesh.vertices[oldIdx] });
            newIdx++;
        }
        
        const newFaces = faceIndices.map(faceIdx => 
            mesh.faces[faceIdx].map(v => vertexMap.get(v))
        );
        
        const localToGlobal = Array.from(usedVertices);
        
        return {
            vertices: newVertices,
            faces: newFaces,
            globalToLocal: vertexMap,
            localToGlobal: localToGlobal,
            originalFaceIndices: faceIndices
        };
    }
    
    /**
     * 通用修复 (用于 χ=0 但只有1个边界的情况)
     */
    static repairGeneric(mesh, topo) {
        const { boundaryEdges } = topo;
        
        if (boundaryEdges.length === 0) {
            return [mesh];
        }
        
        // 找边界上两个最远的点
        let maxDist = 0;
        let pointA = boundaryEdges[0].v1;
        let pointB = boundaryEdges[0].v2;
        
        const boundaryVertices = new Set();
        for (const e of boundaryEdges) {
            boundaryVertices.add(e.v1);
            boundaryVertices.add(e.v2);
        }
        
        const boundaryArray = Array.from(boundaryVertices);
        const sampleSize = Math.min(30, boundaryArray.length);
        const step = Math.max(1, Math.floor(boundaryArray.length / sampleSize));
        
        for (let i = 0; i < boundaryArray.length; i += step) {
            for (let j = i + step; j < boundaryArray.length; j += step) {
                const dist = this.distance(mesh.vertices[boundaryArray[i]], mesh.vertices[boundaryArray[j]]);
                if (dist > maxDist) {
                    maxDist = dist;
                    pointA = boundaryArray[i];
                    pointB = boundaryArray[j];
                }
            }
        }
        
        const path = this.findGeodesicPath(mesh, pointA, pointB);
        
        if (path.length < 2) return [mesh];
        
        const result = this.cutMeshAlongPath(mesh, path);
        
        return result.length > 0 ? result : [mesh];
    }
    
    /**
     * 最终安检 - 过滤垃圾碎片
     */
    static finalCleanup(meshes, minFaces = 20) {
        console.log('🧹 最终清理...');
        
        const before = meshes.length;
        const cleaned = meshes.filter(m => m.faces.length >= minFaces);
        const removed = before - cleaned.length;
        
        if (removed > 0) {
            console.log(`   移除 ${removed} 个碎片 (面数<${minFaces})`);
        }
        console.log(`   剩余 ${cleaned.length} 个有效裁片`);
        
        return cleaned;
    }
    
    /**
     * 计算两点距离
     */
    static distance(v1, v2) {
        const dx = v2.x - v1.x;
        const dy = v2.y - v1.y;
        const dz = v2.z - v1.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
}
