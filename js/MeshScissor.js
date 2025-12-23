/**
 * 网格剪刀 - 物理切割模块
 * 
 * 实现伪代码:
 * split_mesh = cut_mesh_along_edges(mesh, red_seam_edges)
 * sub_meshes = split_into_connected_components(split_mesh)
 * 
 * 核心功能：
 * 1. 沿红线边进行顶点分裂 (Vertex Duplication)
 * 2. 分离成独立的连通分量
 * 3. 检查每块是否是拓扑圆盘
 */

export class MeshScissor {
    constructor() {
        this.originalVertices = [];
        this.originalFaces = [];
        this.cutEdges = new Set();
    }
    
    /**
     * 检查原始模型的连通分量数量（在任何切割之前）
     * @param {Object} mesh - 原始网格 {vertices, faces}
     * @param {boolean} filterSmall - 是否过滤小碎片
     * @param {number} minFaces - 最小面数阈值
     * @returns {Object} 连通性信息
     */
    static checkOriginalConnectivity(mesh, filterSmall = false, minFaces = 100) {
        console.log('========================================');
        console.log('=== 检查原始模型连通性（切割前）===');
        console.log('========================================');
        
        const { vertices, faces } = mesh;
        
        // 构建面邻接图（通过共享边）
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
                edgeToFaces.get(edgeKey).push(faceIdx);
            }
        }
        
        // 建立面邻接
        const faceNeighbors = new Map();
        for (let i = 0; i < faces.length; i++) {
            faceNeighbors.set(i, new Set());
        }
        
        for (const [edgeKey, faceList] of edgeToFaces) {
            if (faceList.length === 2) {
                faceNeighbors.get(faceList[0]).add(faceList[1]);
                faceNeighbors.get(faceList[1]).add(faceList[0]);
            }
        }
        
        // BFS找连通分量
        const visited = new Set();
        let components = [];
        
        for (let faceIdx = 0; faceIdx < faces.length; faceIdx++) {
            if (visited.has(faceIdx)) continue;
            
            const component = [];
            const queue = [faceIdx];
            visited.add(faceIdx);
            
            while (queue.length > 0) {
                const current = queue.shift();
                component.push(current);
                
                const neighbors = faceNeighbors.get(current);
                for (const neighbor of neighbors) {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        queue.push(neighbor);
                    }
                }
            }
            
            components.push(component);
        }
        
        console.log(`🔍 惊爆点：原始模型（不切）本身就有 ${components.length} 个部件！`);
        
        if (components.length > 1) {
            console.log('📊 各部件面数分布:');
            // 按面数排序
            components.sort((a, b) => b.length - a.length);
            components.forEach((comp, i) => {
                const marker = comp.length < minFaces ? ' ⚠️ 碎片' : '';
                console.log(`   部件 #${i + 1}: ${comp.length} 面${marker}`);
            });
            
            // 过滤小碎片
            if (filterSmall) {
                const originalCount = components.length;
                const smallComponents = components.filter(c => c.length < minFaces);
                components = components.filter(c => c.length >= minFaces);
                
                if (smallComponents.length > 0) {
                    console.log(`🗑️ 过滤掉 ${smallComponents.length} 个小碎片（面数<${minFaces}）`);
                    console.log(`   剩余 ${components.length} 个有效部件`);
                }
            }
            
            if (components.length > 1) {
                console.warn('⚠️ 模型本身不是一个整体，需要先焊接顶点！');
            }
        } else {
            console.log('✅ 模型是一个整体，连通性正常');
        }
        
        return {
            componentCount: components.length,
            components: components,
            isConnected: components.length === 1,
            mainComponent: components.length > 0 ? components[0] : null
        };
    }
    
    /**
     * 过滤小碎片，只保留主模型
     * @param {Object} mesh - 网格
     * @param {number} minFaces - 最小面数阈值
     * @returns {Object} 过滤后的网格
     */
    static filterSmallFragments(mesh, minFaces = 100) {
        console.log('=== 过滤小碎片 ===');
        
        const connectivity = MeshScissor.checkOriginalConnectivity(mesh, true, minFaces);
        
        if (connectivity.componentCount === 1) {
            console.log('模型只有一个部件，无需过滤');
            return mesh;
        }
        
        // 只保留最大的部件
        const mainComponent = connectivity.mainComponent;
        if (!mainComponent) {
            console.warn('没有找到主部件');
            return mesh;
        }
        
        // 收集主部件使用的顶点
        const usedVertices = new Set();
        const mainFaceSet = new Set(mainComponent);
        
        for (const faceIdx of mainComponent) {
            const face = mesh.faces[faceIdx];
            for (const v of face) {
                usedVertices.add(v);
            }
        }
        
        // 重建顶点和面
        const vertexMap = new Map();
        const newVertices = [];
        let newIdx = 0;
        
        for (const oldIdx of usedVertices) {
            vertexMap.set(oldIdx, newIdx);
            newVertices.push({ ...mesh.vertices[oldIdx] });
            newIdx++;
        }
        
        const newFaces = mainComponent.map(faceIdx => {
            const oldFace = mesh.faces[faceIdx];
            return oldFace.map(v => vertexMap.get(v));
        });
        
        console.log(`过滤完成: ${mesh.faces.length} -> ${newFaces.length} 面`);
        console.log(`顶点: ${mesh.vertices.length} -> ${newVertices.length}`);
        
        return {
            vertices: newVertices,
            faces: newFaces,
            vertexMap: vertexMap
        };
    }
    
    /**
     * 焊接顶点 - 合并位置相同的顶点
     * @param {Object} mesh - 原始网格 {vertices, faces}
     * @param {number} tolerance - 距离容差
     * @returns {Object} 焊接后的网格
     */
    static mergeVertices(mesh, tolerance = 1e-6) {
        console.log('=== 开始焊接顶点 ===');
        
        const { vertices, faces } = mesh;
        const n = vertices.length;
        
        // 使用空间哈希加速查找
        const cellSize = tolerance * 10;
        const spatialHash = new Map();
        
        const getHashKey = (v) => {
            const x = Math.floor(v.x / cellSize);
            const y = Math.floor(v.y / cellSize);
            const z = Math.floor(v.z / cellSize);
            return `${x}_${y}_${z}`;
        };
        
        // 顶点映射：旧索引 -> 新索引
        const vertexMap = new Map();
        const newVertices = [];
        
        for (let i = 0; i < n; i++) {
            const v = vertices[i];
            const hashKey = getHashKey(v);
            
            // 检查附近的单元格
            let merged = false;
            const checkKeys = [];
            const cx = Math.floor(v.x / cellSize);
            const cy = Math.floor(v.y / cellSize);
            const cz = Math.floor(v.z / cellSize);
            
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        checkKeys.push(`${cx + dx}_${cy + dy}_${cz + dz}`);
                    }
                }
            }
            
            for (const key of checkKeys) {
                if (!spatialHash.has(key)) continue;
                
                for (const existingIdx of spatialHash.get(key)) {
                    const existing = newVertices[existingIdx];
                    const dist = Math.sqrt(
                        Math.pow(v.x - existing.x, 2) +
                        Math.pow(v.y - existing.y, 2) +
                        Math.pow(v.z - existing.z, 2)
                    );
                    
                    if (dist <= tolerance) {
                        // 合并到已有顶点
                        vertexMap.set(i, existingIdx);
                        merged = true;
                        break;
                    }
                }
                if (merged) break;
            }
            
            if (!merged) {
                // 创建新顶点
                const newIdx = newVertices.length;
                newVertices.push({ ...v });
                vertexMap.set(i, newIdx);
                
                if (!spatialHash.has(hashKey)) {
                    spatialHash.set(hashKey, []);
                }
                spatialHash.get(hashKey).push(newIdx);
            }
        }
        
        // 更新面的顶点索引
        const newFaces = faces.map(face => 
            face.map(v => vertexMap.get(v))
        );
        
        // 移除退化面（所有顶点相同的面）
        const validFaces = newFaces.filter(face => {
            const uniqueVerts = new Set(face);
            return uniqueVerts.size >= 3;
        });
        
        const mergedCount = n - newVertices.length;
        console.log(`焊接完成: ${n} -> ${newVertices.length} 顶点（合并了 ${mergedCount} 个重复顶点）`);
        console.log(`面数: ${faces.length} -> ${validFaces.length}`);
        
        return {
            vertices: newVertices,
            faces: validFaces,
            vertexMap: vertexMap,
            mergedCount: mergedCount
        };
    }
    
    /**
     * 静态方法：沿边切割网格（不分离组件）
     * 用于内部红线切割，只做顶点分裂，不分离成多个子网格
     * 
     * @param {Object} mesh - 原始网格 {vertices, faces}
     * @param {Set} seamEdges - 切割边集合
     * @returns {Object} 切割后的网格（单个网格，但在切割处有裂缝）
     */
    static cutAlongEdges(mesh, seamEdges) {
        console.log(`=== cutAlongEdges: 内部切割 (${seamEdges.size} 条边) ===`);
        
        if (!seamEdges || seamEdges.size === 0) {
            return mesh;
        }
        
        const { vertices, faces } = mesh;
        
        // 构建边到面的映射
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
                edgeToFaces.get(edgeKey).push(faceIdx);
            }
        }
        
        // 找出切割边上的所有顶点
        const cutVertices = new Set();
        for (const edgeKey of seamEdges) {
            const [v1, v2] = edgeKey.split('_').map(Number);
            cutVertices.add(v1);
            cutVertices.add(v2);
        }
        
        // 为每个面分配组ID（flood fill，切割边不传播）
        const faceNeighbors = new Map();
        for (let i = 0; i < faces.length; i++) {
            faceNeighbors.set(i, new Set());
        }
        
        for (const [edgeKey, faceList] of edgeToFaces) {
            if (!seamEdges.has(edgeKey) && faceList.length === 2) {
                faceNeighbors.get(faceList[0]).add(faceList[1]);
                faceNeighbors.get(faceList[1]).add(faceList[0]);
            }
        }
        
        const faceToGroup = new Map();
        let groupId = 0;
        
        for (let faceIdx = 0; faceIdx < faces.length; faceIdx++) {
            if (faceToGroup.has(faceIdx)) continue;
            
            const queue = [faceIdx];
            faceToGroup.set(faceIdx, groupId);
            
            while (queue.length > 0) {
                const current = queue.shift();
                for (const neighbor of faceNeighbors.get(current) || []) {
                    if (!faceToGroup.has(neighbor)) {
                        faceToGroup.set(neighbor, groupId);
                        queue.push(neighbor);
                    }
                }
            }
            groupId++;
        }
        
        // 为切割顶点在不同组创建副本
        const vertexToGroupMap = new Map(); // vertex -> Map<groupId, newVertexIndex>
        const newVertices = [...vertices.map(v => ({ ...v }))];
        
        for (const vIdx of cutVertices) {
            vertexToGroupMap.set(vIdx, new Map());
        }
        
        // 遍历所有面，为切割顶点分配正确的副本
        const newFaces = [];
        for (let faceIdx = 0; faceIdx < faces.length; faceIdx++) {
            const face = faces[faceIdx];
            const gId = faceToGroup.get(faceIdx);
            const newFace = [];
            
            for (const vIdx of face) {
                if (cutVertices.has(vIdx)) {
                    const groupMap = vertexToGroupMap.get(vIdx);
                    
                    if (!groupMap.has(gId)) {
                        // 第一次遇到这个组，使用原始顶点或创建副本
                        if (groupMap.size === 0) {
                            // 第一个组使用原始顶点
                            groupMap.set(gId, vIdx);
                        } else {
                            // 后续组创建副本
                            const newIdx = newVertices.length;
                            newVertices.push({ ...vertices[vIdx] });
                            groupMap.set(gId, newIdx);
                        }
                    }
                    newFace.push(groupMap.get(gId));
                } else {
                    newFace.push(vIdx);
                }
            }
            newFaces.push(newFace);
        }
        
        console.log(`  顶点: ${vertices.length} -> ${newVertices.length} (分裂了 ${newVertices.length - vertices.length} 个)`);
        
        // 保留原始映射信息
        const localToGlobal = mesh.localToGlobal ? [...mesh.localToGlobal] : Array.from({ length: vertices.length }, (_, i) => i);
        
        // 扩展 localToGlobal 以包含新顶点
        for (let i = vertices.length; i < newVertices.length; i++) {
            // 找到这个新顶点对应的原始顶点
            for (const [origVIdx, groupMap] of vertexToGroupMap) {
                for (const [gId, newVIdx] of groupMap) {
                    if (newVIdx === i) {
                        localToGlobal.push(mesh.localToGlobal ? mesh.localToGlobal[origVIdx] : origVIdx);
                    }
                }
            }
        }
        
        return {
            vertices: newVertices,
            faces: newFaces,
            localToGlobal: localToGlobal,
            globalToLocal: mesh.globalToLocal,
            originalFaceIndices: mesh.originalFaceIndices
        };
    }
    
    /**
     * 主函数：物理切割网格
     * @param {Object} mesh - 原始网格 {vertices, faces}
     * @param {Set|Array} seamEdges - 红线边集合，格式为 "v1_v2" 的字符串
     * @returns {Array} 切割后的独立子网格列表
     */
    cut(mesh, seamEdges) {
        console.log('=== MeshScissor: 开始物理切割 ===');
        console.log(`输入: ${mesh.vertices.length} 顶点, ${mesh.faces.length} 面, ${seamEdges.size || seamEdges.length} 条切割边`);
        
        this.originalVertices = mesh.vertices;
        this.originalFaces = mesh.faces;
        this.cutEdges = seamEdges instanceof Set ? seamEdges : new Set(seamEdges);
        
        // Step 1: 顶点分裂 - 沿切割边分裂顶点
        const splitResult = this.splitVerticesAlongCuts();
        
        // Step 2: 分离连通分量
        const subMeshes = this.splitIntoConnectedComponents(splitResult);
        
        console.log(`输出: ${subMeshes.length} 个独立子网格`);
        
        return subMeshes;
    }
    
    /**
     * Step 1: 顶点分裂
     * 让切割边两侧的面使用不同的顶点副本
     */
    splitVerticesAlongCuts() {
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
                edgeToFaces.get(edgeKey).push(faceIdx);
            }
        }
        
        // 找出切割边上的所有顶点
        const cutVertices = new Set();
        for (const edgeKey of this.cutEdges) {
            const [v1, v2] = edgeKey.split('_').map(Number);
            cutVertices.add(v1);
            cutVertices.add(v2);
        }
        
        console.log(`切割顶点数量: ${cutVertices.size}`);
        
        // 为每个面分配"侧面"标识
        // 使用flood fill，切割边不传播
        const faceToComponent = new Map();
        let componentId = 0;
        
        // 建立面邻接（不通过切割边）
        const faceNeighbors = new Map();
        for (let i = 0; i < this.originalFaces.length; i++) {
            faceNeighbors.set(i, new Set());
        }
        
        for (const [edgeKey, faces] of edgeToFaces) {
            if (!this.cutEdges.has(edgeKey) && faces.length === 2) {
                faceNeighbors.get(faces[0]).add(faces[1]);
                faceNeighbors.get(faces[1]).add(faces[0]);
            }
        }
        
        // Flood fill分配component
        for (let faceIdx = 0; faceIdx < this.originalFaces.length; faceIdx++) {
            if (faceToComponent.has(faceIdx)) continue;
            
            const queue = [faceIdx];
            faceToComponent.set(faceIdx, componentId);
            
            while (queue.length > 0) {
                const current = queue.shift();
                const neighbors = faceNeighbors.get(current);
                
                for (const neighbor of neighbors) {
                    if (!faceToComponent.has(neighbor)) {
                        faceToComponent.set(neighbor, componentId);
                        queue.push(neighbor);
                    }
                }
            }
            
            componentId++;
        }
        
        console.log(`初步分离为 ${componentId} 个分量`);
        
        // 为每个分量的切割顶点创建副本
        // vertexMap: Map<componentId, Map<originalVertexId, newVertexId>>
        const newVertices = [...this.originalVertices.map(v => ({...v}))];
        const componentVertexMap = new Map();
        
        for (let comp = 0; comp < componentId; comp++) {
            componentVertexMap.set(comp, new Map());
        }
        
        // 对于每个切割顶点，除了第一个分量外，其他分量都创建新顶点
        for (const cutV of cutVertices) {
            let firstComp = null;
            
            for (let faceIdx = 0; faceIdx < this.originalFaces.length; faceIdx++) {
                const face = this.originalFaces[faceIdx];
                if (face.includes(cutV)) {
                    const comp = faceToComponent.get(faceIdx);
                    
                    if (firstComp === null) {
                        firstComp = comp;
                        componentVertexMap.get(comp).set(cutV, cutV);  // 第一个分量用原顶点
                    } else if (comp !== firstComp && !componentVertexMap.get(comp).has(cutV)) {
                        // 创建新顶点
                        const newIdx = newVertices.length;
                        newVertices.push({...this.originalVertices[cutV]});
                        componentVertexMap.get(comp).set(cutV, newIdx);
                    }
                }
            }
        }
        
        // 更新面的顶点索引
        const newFaces = this.originalFaces.map((face, faceIdx) => {
            const comp = faceToComponent.get(faceIdx);
            const vertMap = componentVertexMap.get(comp);
            
            return face.map(v => {
                if (cutVertices.has(v) && vertMap.has(v)) {
                    return vertMap.get(v);
                }
                return v;
            });
        });
        
        console.log(`顶点分裂完成: ${this.originalVertices.length} -> ${newVertices.length}`);
        
        return {
            vertices: newVertices,
            faces: newFaces,
            faceToComponent: faceToComponent,
            numComponents: componentId
        };
    }
    
    /**
     * Step 2: 分离成独立的连通分量子网格
     */
    splitIntoConnectedComponents(splitResult) {
        const { vertices, faces, numComponents } = splitResult;
        
        // 重新计算连通分量（基于新的顶点索引）
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
                edgeToFaces.get(edgeKey).push(faceIdx);
            }
        }
        
        // 面邻接
        const faceNeighbors = new Map();
        for (let i = 0; i < faces.length; i++) {
            faceNeighbors.set(i, new Set());
        }
        
        for (const [edgeKey, faceList] of edgeToFaces) {
            if (faceList.length === 2) {
                faceNeighbors.get(faceList[0]).add(faceList[1]);
                faceNeighbors.get(faceList[1]).add(faceList[0]);
            }
        }
        
        // BFS找连通分量
        const visited = new Set();
        const subMeshes = [];
        
        for (let faceIdx = 0; faceIdx < faces.length; faceIdx++) {
            if (visited.has(faceIdx)) continue;
            
            const component = {
                originalFaceIndices: [],
                globalVertices: new Set(),
                faces: []
            };
            
            const queue = [faceIdx];
            visited.add(faceIdx);
            
            while (queue.length > 0) {
                const current = queue.shift();
                component.originalFaceIndices.push(current);
                component.faces.push(faces[current]);
                
                for (const v of faces[current]) {
                    component.globalVertices.add(v);
                }
                
                const neighbors = faceNeighbors.get(current);
                for (const neighbor of neighbors) {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        queue.push(neighbor);
                    }
                }
            }
            
            // 创建局部索引的子网格
            const subMesh = this.createLocalMesh(component, vertices);
            subMeshes.push(subMesh);
        }
        
        return subMeshes;
    }
    
    /**
     * 创建局部索引的子网格
     */
    createLocalMesh(component, globalVertices) {
        const globalToLocal = new Map();
        const localVertices = [];
        const localToGlobal = [];
        
        let localIdx = 0;
        for (const globalV of component.globalVertices) {
            globalToLocal.set(globalV, localIdx);
            localVertices.push({...globalVertices[globalV]});
            localToGlobal.push(globalV);
            localIdx++;
        }
        
        const localFaces = component.faces.map(face => 
            face.map(v => globalToLocal.get(v))
        );
        
        return {
            vertices: localVertices,
            faces: localFaces,
            globalToLocal: globalToLocal,
            localToGlobal: localToGlobal,
            originalFaceIndices: component.originalFaceIndices
        };
    }
    
    /**
     * 检查子网格是否是拓扑圆盘
     * 对于带边界的圆盘: V - E + F = 1
     */
    static isTopologicalDisk(subMesh) {
        const V = subMesh.vertices.length;
        const F = subMesh.faces.length;
        
        // 计算边数
        const edges = new Set();
        for (const face of subMesh.faces) {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                edges.add(edgeKey);
            }
        }
        const E = edges.size;
        
        // 欧拉示性数
        const euler = V - E + F;
        
        // 检查边界
        const edgeCount = new Map();
        for (const face of subMesh.faces) {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                edgeCount.set(edgeKey, (edgeCount.get(edgeKey) || 0) + 1);
            }
        }
        
        let boundaryEdgeCount = 0;
        for (const count of edgeCount.values()) {
            if (count === 1) boundaryEdgeCount++;
        }
        
        const hasBoundary = boundaryEdgeCount > 0;
        
        // 对于带边界的圆盘，χ = 1
        // 对于闭合球面，χ = 2
        // 对于圆环/圆筒，χ = 0
        const isDisk = (euler === 1 && hasBoundary);
        
        return {
            isValid: isDisk,
            euler: euler,
            vertices: V,
            edges: E,
            faces: F,
            boundaryEdges: boundaryEdgeCount,
            diagnosis: isDisk ? 'OK (拓扑圆盘)' : 
                      (euler === 0 ? '需要补刀 (圆筒/圆环)' : 
                       (euler === 2 ? '闭合曲面' : '复杂拓扑'))
        };
    }
}

