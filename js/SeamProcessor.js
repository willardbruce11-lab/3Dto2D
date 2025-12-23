/**
 * 缝线处理器
 * 处理和验证JSON格式的缝线数据
 */

export class SeamProcessor {
    constructor() {
        this.seams = [];
        this.seamEdges = new Set();
        this.cutEdges = new Set();
    }
    
    /**
     * 验证缝线数据
     * @param {Object} seamData - 缝线JSON数据
     * @param {Object} meshData - 网格数据
     * @returns {Array} 验证后的缝线数组
     */
    validateSeams(seamData, meshData) {
        this.seams = [];
        this.seamEdges.clear();
        this.cutEdges.clear();
        
        // 支持多种JSON格式
        let seams = seamData.seams || seamData.cuts || seamData;
        
        if (!Array.isArray(seams)) {
            seams = [seams];
        }
        
        const validatedSeams = [];
        
        seams.forEach((seam, index) => {
            const validatedSeam = this.validateSingleSeam(seam, meshData, index);
            if (validatedSeam) {
                validatedSeams.push(validatedSeam);
                
                // 记录缝线边
                validatedSeam.edgeKeys.forEach(key => {
                    this.seamEdges.add(key);
                    if (validatedSeam.isCut) {
                        this.cutEdges.add(key);
                    }
                });
            }
        });
        
        this.seams = validatedSeams;
        return validatedSeams;
    }
    
    /**
     * 验证单条缝线
     */
    validateSingleSeam(seam, meshData, index) {
        const result = {
            id: seam.id || `seam_${index}`,
            name: seam.name || `缝线 ${index + 1}`,
            type: seam.type || 'cut', // cut: 切割边, sew: 缝合边
            isCut: seam.type !== 'sew',
            edges: [],
            vertices: [],
            edgeKeys: new Set()
        };
        
        // 处理不同格式的缝线数据
        if (seam.edges && Array.isArray(seam.edges)) {
            // 边列表格式 [{start: v1, end: v2}, ...] 或 [[v1, v2], ...]
            seam.edges.forEach(edge => {
                let v1, v2;
                
                if (Array.isArray(edge)) {
                    [v1, v2] = edge;
                } else if (typeof edge === 'object') {
                    v1 = edge.start !== undefined ? edge.start : edge.v1;
                    v2 = edge.end !== undefined ? edge.end : edge.v2;
                }
                
                if (this.isValidEdge(v1, v2, meshData)) {
                    result.edges.push([v1, v2]);
                    result.edgeKeys.add(this.getEdgeKey(v1, v2));
                    if (!result.vertices.includes(v1)) result.vertices.push(v1);
                    if (!result.vertices.includes(v2)) result.vertices.push(v2);
                }
            });
        } else if (seam.vertices && Array.isArray(seam.vertices)) {
            // 顶点列表格式 [v1, v2, v3, ...] - 连续的顶点路径
            for (let i = 0; i < seam.vertices.length - 1; i++) {
                const v1 = seam.vertices[i];
                const v2 = seam.vertices[i + 1];
                
                if (this.isValidEdge(v1, v2, meshData)) {
                    result.edges.push([v1, v2]);
                    result.edgeKeys.add(this.getEdgeKey(v1, v2));
                }
            }
            result.vertices = [...seam.vertices];
        } else if (seam.path && Array.isArray(seam.path)) {
            // 路径格式
            for (let i = 0; i < seam.path.length - 1; i++) {
                const v1 = seam.path[i];
                const v2 = seam.path[i + 1];
                
                if (this.isValidEdge(v1, v2, meshData)) {
                    result.edges.push([v1, v2]);
                    result.edgeKeys.add(this.getEdgeKey(v1, v2));
                }
            }
            result.vertices = [...seam.path];
        }
        
        // 如果有配对信息（用于缝合）
        if (seam.pair) {
            result.pair = seam.pair;
        }
        
        return result.edges.length > 0 ? result : null;
    }
    
    /**
     * 验证边是否有效
     */
    isValidEdge(v1, v2, meshData) {
        if (v1 === undefined || v2 === undefined) return false;
        if (v1 === v2) return false;
        if (!meshData || !meshData.vertices) return true;
        
        return v1 >= 0 && v1 < meshData.vertices.length &&
               v2 >= 0 && v2 < meshData.vertices.length;
    }
    
    /**
     * 获取边的唯一键
     */
    getEdgeKey(v1, v2) {
        return v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
    }
    
    /**
     * 检查边是否为缝线边
     */
    isSeamEdge(v1, v2) {
        return this.seamEdges.has(this.getEdgeKey(v1, v2));
    }
    
    /**
     * 检查边是否为切割边
     */
    isCutEdge(v1, v2) {
        return this.cutEdges.has(this.getEdgeKey(v1, v2));
    }
    
    /**
     * 根据缝线将网格分割成多个片段
     * @param {Object} meshData - 网格数据
     * @returns {Array} 片段数组
     */
    splitMeshBySeams(meshData) {
        const pieces = [];
        const visitedFaces = new Set();
        
        // 为每个面找到所属的片段
        for (let faceIndex = 0; faceIndex < meshData.faces.length; faceIndex++) {
            if (visitedFaces.has(faceIndex)) continue;
            
            const piece = this.floodFillPiece(meshData, faceIndex, visitedFaces);
            if (piece.faces.length > 0) {
                pieces.push(piece);
            }
        }
        
        return pieces;
    }
    
    /**
     * 使用泛洪填充找到一个连通片段
     */
    floodFillPiece(meshData, startFace, visitedFaces) {
        const piece = {
            faces: [],
            vertices: new Set(),
            boundaryEdges: []
        };
        
        const queue = [startFace];
        
        while (queue.length > 0) {
            const faceIndex = queue.shift();
            
            if (visitedFaces.has(faceIndex)) continue;
            visitedFaces.add(faceIndex);
            
            const face = meshData.faces[faceIndex];
            piece.faces.push(faceIndex);
            
            // 添加顶点
            face.forEach(v => piece.vertices.add(v));
            
            // 检查相邻面
            if (meshData.adjacency && meshData.adjacency.faceToFaces) {
                const neighbors = meshData.adjacency.faceToFaces.get(faceIndex);
                if (neighbors) {
                    neighbors.forEach(neighborIndex => {
                        if (visitedFaces.has(neighborIndex)) return;
                        
                        // 检查共享边是否为缝线
                        const sharedEdge = this.getSharedEdge(
                            meshData.faces[faceIndex],
                            meshData.faces[neighborIndex]
                        );
                        
                        if (sharedEdge && !this.isCutEdge(sharedEdge[0], sharedEdge[1])) {
                            queue.push(neighborIndex);
                        }
                    });
                }
            }
        }
        
        return piece;
    }
    
    /**
     * 获取两个面的共享边
     */
    getSharedEdge(face1, face2) {
        for (let i = 0; i < face1.length; i++) {
            const v1 = face1[i];
            const v2 = face1[(i + 1) % face1.length];
            
            for (let j = 0; j < face2.length; j++) {
                const u1 = face2[j];
                const u2 = face2[(j + 1) % face2.length];
                
                if ((v1 === u1 && v2 === u2) || (v1 === u2 && v2 === u1)) {
                    return [v1, v2];
                }
            }
        }
        
        return null;
    }
    
    /**
     * 获取片段的边界顶点（按顺序）
     */
    getBoundaryVertices(piece, meshData) {
        const edgeCount = new Map();
        
        // 统计每条边出现的次数
        piece.faces.forEach(faceIndex => {
            const face = meshData.faces[faceIndex];
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const key = this.getEdgeKey(v1, v2);
                
                edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
            }
        });
        
        // 找出边界边（只出现一次的边）
        const boundaryEdges = [];
        edgeCount.forEach((count, key) => {
            if (count === 1) {
                const [v1, v2] = key.split('_').map(Number);
                boundaryEdges.push([v1, v2]);
            }
        });
        
        // 将边界边排序成连续路径
        if (boundaryEdges.length === 0) return [];
        
        const orderedVertices = [];
        const used = new Set();
        
        let currentEdge = boundaryEdges[0];
        orderedVertices.push(currentEdge[0], currentEdge[1]);
        used.add(this.getEdgeKey(currentEdge[0], currentEdge[1]));
        
        while (orderedVertices.length < boundaryEdges.length + 1) {
            const lastVertex = orderedVertices[orderedVertices.length - 1];
            let found = false;
            
            for (const edge of boundaryEdges) {
                const key = this.getEdgeKey(edge[0], edge[1]);
                if (used.has(key)) continue;
                
                if (edge[0] === lastVertex) {
                    orderedVertices.push(edge[1]);
                    used.add(key);
                    found = true;
                    break;
                } else if (edge[1] === lastVertex) {
                    orderedVertices.push(edge[0]);
                    used.add(key);
                    found = true;
                    break;
                }
            }
            
            if (!found) break;
        }
        
        return orderedVertices;
    }
    
    /**
     * 计算缝线长度
     */
    calculateSeamLength(seam, meshData) {
        let totalLength = 0;
        
        seam.edges.forEach(([v1, v2]) => {
            const p1 = meshData.vertices[v1];
            const p2 = meshData.vertices[v2];
            
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dz = p2.z - p1.z;
            
            totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
        });
        
        return totalLength;
    }
}

