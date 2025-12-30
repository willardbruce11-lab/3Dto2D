/**
 * 泛洪分割器
 * 
 * 核心思路：不是"切割"，而是"聚合"
 * - 只有红线形成的"闭合围墙"才能阻止扩散
 * - 孤立的红点、红线段会被BFS直接漫过去
 * - 碎片自动消失
 * 
 * 【新增】激光切缝(Kerf)概念：
 * - 红色顶点/面片被视为切割废料，直接丢弃
 * - 裁片边缘会自动内缩一圈，保证绝对干净
 */

export class FloodSegmenter {
    
    // 最小面数阈值 - 小于此值的区域会被丢弃
    static MIN_FACES = 500;

    /**
     * 兼容旧签名：基于红顶点的围墙分割
     */
    static segment(mesh, redVertices) {
        const redSet = redVertices instanceof Set ? redVertices : new Set(redVertices);
        const seamEdges = new Set();

        // 将双红色端点的边视为墙
        for (const face of mesh.faces) {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                if (redSet.has(v1) && redSet.has(v2)) {
                    const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                    seamEdges.add(key);
                }
            }
        }

        return this.segmentWithSeams(mesh, seamEdges, { redVertices: redSet });
    }

    /**
     * 基于缝线边的泛洪分割
     * @param {Object} mesh - {vertices, faces}
     * @param {Set} seamEdges - 规范化的边 key 集合 (v1_v2)
     * @param {Object} options
     * @param {number} options.minFaces - 保留的最小面数
     * @param {boolean} options.assignBoundaryFaces - 是否把缝线邻近的面分配回最近Patch
     * @param {Set} options.redVertices - 红色顶点集合，用于激光切缝剔除
     */
    static segmentWithSeams(mesh, seamEdges, options = {}) {
        const {
            minFaces = this.MIN_FACES,
            assignBoundaryFaces = true,
            redVertices = null
        } = options;

        console.log('========================================');
        console.log('=== 泛洪分割 (Seam Barrier + Kerf) ===');
        console.log('========================================');

        const startTime = Date.now();
        const wallSet = seamEdges instanceof Set ? seamEdges : new Set(seamEdges || []);
        const redSet = redVertices instanceof Set ? redVertices : new Set(redVertices || []);
        console.log(`输入: ${mesh.faces.length} 面, 墙边: ${wallSet.size} 条, 红点: ${redSet.size}`);

        // 1. 识别边界面（包含缝线边的面）
        const boundaryFaces = this.collectBoundaryFaces(mesh, wallSet);
        console.log(`检测到 ${boundaryFaces.size} 个边界面片（红线面）`);

        // 2. 构建面邻接图
        const adjacency = this.buildFaceAdjacency(mesh);

        // 3. 核心：泛洪聚类（仅限非红线区域）
        // 只有不包含缝线边的面参与第一轮扩张，缝线边视为物理屏障
        const islands = this.floodFillExcludingBoundary(mesh, adjacency, wallSet, boundaryFaces);
        console.log(`第一轮聚类完成: 发现 ${islands.length} 个基础Patch`);

        // 4. 【关键优化】将红线区域分配给最近的基础Patch
        if (assignBoundaryFaces && islands.length > 0) {
            this.assignBoundaryFacesByAdjacency(adjacency, islands, boundaryFaces);
        }

        // 5. 过滤掉仍然孤立的极小碎屑（主要是那些无法归属到大区域的红线面）
        const validIslands = islands.filter(island => island.length >= minFaces);
        const filteredCount = islands.length - validIslands.length;
        console.log(`过滤 ${filteredCount} 个碎片 (面数<${minFaces})，最终保留 ${validIslands.length} 个大裁片`);

        // 6. 构建最终子网格（应用激光切缝剔除）
        const subMeshes = [];
        for (let idx = 0; idx < validIslands.length; idx++) {
            const faceIndices = validIslands[idx];
            
            // 在剔除红边前，先记录该区域包含的红点（用于后续分类）
            const internalRedVertices = new Set();
            for (const fIdx of faceIndices) {
                for (const vIdx of mesh.faces[fIdx]) {
                    if (redSet.has(vIdx)) internalRedVertices.add(vIdx);
                }
            }

            const subMesh = this.buildSubMeshWithKerf(mesh, faceIndices, redSet);
            if (subMesh && subMesh.faces.length >= minFaces) {
                subMesh.internalRedVertices = internalRedVertices; // 附加红点信息
                console.log(`  裁片 #${idx}: ${subMesh.faces.length} 面, ${subMesh.vertices.length} 顶点, 包含 ${internalRedVertices.size} 个红点`);
                subMeshes.push(subMesh);
            }
        }

        console.log(`总耗时: ${Date.now() - startTime}ms`);
        return subMeshes;
    }

    /**
     * 构建面邻接图
     * adjacency[faceIdx] = [{neighborFaceIdx, sharedEdge: [v1, v2]}, ...]
     */
    static buildFaceAdjacency(mesh) {
        const { faces } = mesh;
        
        // 边到面的映射
        const edgeToFaces = new Map();
        
        for (let faceIdx = 0; faceIdx < faces.length; faceIdx++) {
            const face = faces[faceIdx];
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                
                if (!edgeToFaces.has(edgeKey)) {
                    edgeToFaces.set(edgeKey, []);
                }
                edgeToFaces.get(edgeKey).push({ faceIdx, v1, v2 });
            }
        }
        
        // 构建邻接图
        const adjacency = new Array(faces.length).fill(null).map(() => []);
        
        for (const [edgeKey, faceInfos] of edgeToFaces) {
            if (faceInfos.length === 2) {
                const [f1, f2] = faceInfos;
                const [v1, v2] = edgeKey.split('_').map(Number);
                
                adjacency[f1.faceIdx].push({
                    neighborIdx: f2.faceIdx,
                    sharedEdge: [v1, v2]
                });
                adjacency[f2.faceIdx].push({
                    neighborIdx: f1.faceIdx,
                    sharedEdge: [v1, v2]
                });
            }
        }
        
        return adjacency;
    }

    /**
     * 泛洪填充（排除边界面，且被边墙阻断）
     */
    static floodFillExcludingBoundary(mesh, adjacency, seamEdges, boundaryFaces) {
        const faceCount = mesh.faces.length;
        const visited = new Uint8Array(faceCount); // 0=未访问, 1=已访问, 2=边界面
        const islands = [];

        // 标记边界面，第一轮不扩张
        for (const bf of boundaryFaces) {
            visited[bf] = 2;
        }
        
        for (let startFace = 0; startFace < faceCount; startFace++) {
            if (visited[startFace] !== 0) continue;
            
            const currentIsland = [];
            const queue = [startFace];
            visited[startFace] = 1;
            
            while (queue.length > 0) {
                const faceIdx = queue.pop();
                currentIsland.push(faceIdx);
                
                for (const neighbor of adjacency[faceIdx]) {
                    const { neighborIdx, sharedEdge } = neighbor;
                    
                    if (visited[neighborIdx] !== 0) continue;
                    
                    // 边墙阻断
                    const [v1, v2] = sharedEdge;
                    const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                    if (seamEdges.has(edgeKey)) continue;
                    
                    visited[neighborIdx] = 1;
                    queue.push(neighborIdx);
                }
            }
            if (currentIsland.length > 0) {
                islands.push(currentIsland);
            }
        }
        
        islands.sort((a, b) => b.length - a.length);
        return islands;
    }

    /**
     * 【优化逻辑】通过邻接关系将红线面片"归顺"给邻居 Patch
     */
    static assignBoundaryFacesByAdjacency(adjacency, islands, boundaryFaces) {
        // 创建面到 Patch ID 的映射
        const faceToPatch = new Map();
        islands.forEach((island, patchId) => {
            for (const faceIdx of island) {
                faceToPatch.set(faceIdx, patchId);
            }
        });

        // 多轮迭代，直到所有红面都被分配，或者无法继续分配
        let remaining = new Set(boundaryFaces);
        let changed = true;
        let iter = 0;

        while (changed && remaining.size > 0 && iter < 5) {
            changed = false;
            const toAdd = [];

            for (const faceIdx of remaining) {
                const patchVotes = new Map(); // 记录邻居 Patch 的票数
                
                for (const neighbor of adjacency[faceIdx]) {
                    const patchId = faceToPatch.get(neighbor.neighborIdx);
                    if (patchId !== undefined) {
                        patchVotes.set(patchId, (patchVotes.get(patchId) || 0) + 1);
                    }
                }

                // 找票数最多的 Patch
                let bestPatchId = -1;
                let maxVotes = 0;
                for (const [pid, votes] of patchVotes) {
                    if (votes > maxVotes) {
                        maxVotes = votes;
                        bestPatchId = pid;
                    }
                }

                if (bestPatchId !== -1) {
                    toAdd.push({ faceIdx, bestPatchId });
                }
            }

            // 执行分配
            for (const item of toAdd) {
                islands[item.bestPatchId].push(item.faceIdx);
                faceToPatch.set(item.faceIdx, item.bestPatchId);
                remaining.delete(item.faceIdx);
                changed = true;
            }
            iter++;
        }

        console.log(`红线分配完成: ${boundaryFaces.size - remaining.size} 个面已归顺, ${remaining.size} 个面被丢弃`);
    }

    /**
     * 【激光切缝】构建子网格，剔除任何包含红色顶点的面
     * 这相当于把红色定义为有宽度的切缝，直接切除
     * 
     * @param {Object} mesh - 原始网格
     * @param {Array} faceIndices - 该裁片包含的面索引
     * @param {Set} redVerticesSet - 红色顶点索引集合
     */
    static buildSubMeshWithKerf(mesh, faceIndices, redVerticesSet) {
        // Step 1: 过滤 - 如果面的任意一个顶点是红色的，就丢弃这个面
        const cleanFaceIndices = [];
        let removedCount = 0;
        
        for (const faceIdx of faceIndices) {
            const face = mesh.faces[faceIdx];
            
            // 严格模式：只要沾一点红，就认为是边缘废料，剔除
            let hasRedVertex = false;
            for (const vIdx of face) {
                if (redVerticesSet.has(vIdx)) {
                    hasRedVertex = true;
                    break;
                }
            }
            
            if (!hasRedVertex) {
                cleanFaceIndices.push(faceIdx);
            } else {
                removedCount++;
            }
        }
        
        if (removedCount > 0) {
            console.log(`    激光切缝: 剔除 ${removedCount} 个红边面片`);
        }
        
        // Step 2: 如果剔除后没了，直接返回 null
        if (cleanFaceIndices.length === 0) {
            return null;
        }
        
        // Step 3: 收集使用的顶点
        const usedVertices = new Set();
        for (const faceIdx of cleanFaceIndices) {
            for (const v of mesh.faces[faceIdx]) {
                usedVertices.add(v);
            }
        }
        
        // Step 4: 创建顶点映射
        const globalToLocal = new Map();
        const localToGlobal = [];
        const newVertices = [];
        
        let localIdx = 0;
        for (const globalIdx of usedVertices) {
            globalToLocal.set(globalIdx, localIdx);
            localToGlobal.push(globalIdx);
            // 复制顶点，确保颜色干净（白色）
            const v = mesh.vertices[globalIdx];
            newVertices.push({ 
                x: v.x, 
                y: v.y, 
                z: v.z,
                // 强制白色，避免残留红色
                r: 1.0, 
                g: 1.0, 
                b: 1.0 
            });
            localIdx++;
        }
        
        // Step 5: 创建新面
        const newFaces = cleanFaceIndices.map(faceIdx => 
            mesh.faces[faceIdx].map(v => globalToLocal.get(v))
        );
        
        return {
            vertices: newVertices,
            faces: newFaces,
            globalToLocal,
            localToGlobal,
            originalFaceIndices: cleanFaceIndices
        };
    }

    /**
     * 根据面索引构建子网格 (旧版，保留兼容)
     */
    static buildSubMesh(mesh, faceIndices) {
        // 使用新的切缝版本，但不传红点集合（不剔除）
        return this.buildSubMeshWithKerf(mesh, faceIndices, new Set());
    }
    
    /**
     * 合并小碎片到最近的大区域
     * @param {Array} islands - 所有岛屿（面索引数组）
     * @param {Object} mesh - 原始网格
     * @param {number} minFaces - 最小面数
     */
    static mergeSmallIslands(islands, mesh, minFaces = 500) {
        const largeIslands = [];
        const smallIslands = [];
        
        for (const island of islands) {
            if (island.length >= minFaces) {
                largeIslands.push(island);
            } else {
                smallIslands.push(island);
            }
        }
        
        // 如果没有小碎片，直接返回大岛屿
        if (smallIslands.length === 0) {
            return largeIslands;
        }
        
        // 尝试将小碎片合并到最近的大岛屿
        for (const smallIsland of smallIslands) {
            // 计算小岛的中心
            const center = this.computeIslandCenter(smallIsland, mesh);
            
            // 找最近的大岛
            let nearestIdx = 0;
            let minDist = Infinity;
            
            for (let i = 0; i < largeIslands.length; i++) {
                const largeCenter = this.computeIslandCenter(largeIslands[i], mesh);
                const dist = this.distance(center, largeCenter);
                if (dist < minDist) {
                    minDist = dist;
                    nearestIdx = i;
                }
            }
            
            // 合并
            if (largeIslands.length > 0) {
                largeIslands[nearestIdx].push(...smallIsland);
            }
        }
        
        return largeIslands;
    }
    
    /**
     * 计算岛屿中心
     */
    static computeIslandCenter(faceIndices, mesh) {
        let cx = 0, cy = 0, cz = 0;
        let count = 0;
        
        for (const faceIdx of faceIndices) {
            const face = mesh.faces[faceIdx];
            for (const v of face) {
                const vertex = mesh.vertices[v];
                cx += vertex.x;
                cy += vertex.y;
                cz += vertex.z;
                count++;
            }
        }
        
        return {
            x: cx / count,
            y: cy / count,
            z: cz / count
        };
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

    /**
     * 收集包含缝线边的面
     */
    static collectBoundaryFaces(mesh, seamEdges) {
        const boundaryFaces = new Set();
        mesh.faces.forEach((face, faceIdx) => {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                if (seamEdges.has(key)) {
                    boundaryFaces.add(faceIdx);
                    break;
                }
            }
        });
        return boundaryFaces;
    }
}
