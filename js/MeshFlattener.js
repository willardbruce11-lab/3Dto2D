/**
 * 网格展开器
 * 实现基于缝线的3D曲面展开到2D平面算法
 */

import { SeamProcessor } from './SeamProcessor.js';

export class MeshFlattener {
    constructor(options = {}) {
        this.method = options.method || 'angle-based';
        this.iterations = options.iterations || 30; // 减少默认迭代次数
        this.preserveRatio = options.preserveRatio !== false;
        this.onProgress = options.onProgress || (() => {});
        
        this.seamProcessor = new SeamProcessor();
    }
    
    /**
     * 执行展开
     * @param {Object} meshData - 网格数据
     * @param {Object} seamData - 缝线数据
     * @returns {Object} 展开后的2D数据
     */
    async flatten(meshData, seamData) {
        // 验证缝线
        this.seamProcessor.validateSeams(seamData, meshData);
        
        // 根据缝线分割网格
        const pieces = this.seamProcessor.splitMeshBySeams(meshData);
        
        if (pieces.length === 0) {
            // 没有缝线或缝线不切割网格，整体展开
            pieces.push({
                faces: meshData.faces.map((_, i) => i),
                vertices: new Set(meshData.vertices.map((_, i) => i))
            });
        }
        
        const flattenedPieces = [];
        let progressStep = 100 / pieces.length;
        
        // 展开每个片段
        for (let i = 0; i < pieces.length; i++) {
            this.onProgress(i * progressStep);
            
            const piece = pieces[i];
            const flattened = await this.flattenPiece(meshData, piece, i);
            flattenedPieces.push(flattened);
        }
        
        // 布局所有片段
        const layoutResult = this.layoutPieces(flattenedPieces);
        
        this.onProgress(100);
        
        return {
            pieces: flattenedPieces,
            bounds: layoutResult.bounds,
            totalArea: layoutResult.totalArea,
            originalMesh: meshData,
            seams: this.seamProcessor.seams
        };
    }
    
    /**
     * 展开单个片段
     */
    async flattenPiece(meshData, piece, pieceIndex) {
        // 创建局部顶点映射
        const vertexMap = new Map();
        const localVertices = [];
        let localIndex = 0;
        
        piece.vertices.forEach(globalIndex => {
            vertexMap.set(globalIndex, localIndex);
            localVertices.push({
                global: globalIndex,
                local: localIndex,
                pos3D: meshData.vertices[globalIndex]
            });
            localIndex++;
        });
        
        // 创建局部面
        const localFaces = piece.faces.map(faceIndex => {
            return meshData.faces[faceIndex].map(v => vertexMap.get(v));
        });
        
        // 初始化2D坐标
        let uv = this.initializeUV(localVertices, localFaces, meshData);
        
        // 根据方法选择优化算法
        switch (this.method) {
            case 'angle-based':
                uv = await this.optimizeABF(uv, localVertices, localFaces, meshData);
                break;
            case 'conformal':
                uv = await this.optimizeConformal(uv, localVertices, localFaces, meshData);
                break;
            case 'lscm':
                uv = await this.optimizeLSCM(uv, localVertices, localFaces, meshData);
                break;
        }
        
        // 计算边界
        const bounds = this.calculateBounds(uv);
        
        // 归一化并居中
        uv = this.normalizeUV(uv, bounds);
        
        return {
            pieceIndex,
            vertexMap,
            localVertices,
            localFaces,
            globalFaces: piece.faces,
            uv,
            bounds: this.calculateBounds(uv)
        };
    }
    
    /**
     * 初始化UV坐标（使用第一个三角形铺展法）
     */
    initializeUV(vertices, faces, meshData) {
        const uv = new Array(vertices.length).fill(null).map(() => ({ u: 0, v: 0 }));
        const placed = new Set();
        
        if (faces.length === 0) return uv;
        
        // 从第一个面开始
        const firstFace = faces[0];
        if (firstFace.length < 3) return uv;
        
        // 放置第一个三角形
        const v0 = vertices[firstFace[0]];
        const v1 = vertices[firstFace[1]];
        const v2 = vertices[firstFace[2]];
        
        // 计算3D边长
        const edge01 = this.distance3D(v0.pos3D, v1.pos3D);
        const edge02 = this.distance3D(v0.pos3D, v2.pos3D);
        const edge12 = this.distance3D(v1.pos3D, v2.pos3D);
        
        // 将第一个顶点放在原点
        uv[firstFace[0]] = { u: 0, v: 0 };
        placed.add(firstFace[0]);
        
        // 将第二个顶点放在x轴正方向
        uv[firstFace[1]] = { u: edge01, v: 0 };
        placed.add(firstFace[1]);
        
        // 使用余弦定理计算第三个顶点位置
        const cosAngle = (edge01 * edge01 + edge02 * edge02 - edge12 * edge12) / (2 * edge01 * edge02);
        const sinAngle = Math.sqrt(1 - cosAngle * cosAngle);
        uv[firstFace[2]] = {
            u: edge02 * cosAngle,
            v: edge02 * sinAngle
        };
        placed.add(firstFace[2]);
        
        // 使用BFS铺展剩余的面
        const faceQueue = [0];
        const processedFaces = new Set([0]);
        
        while (faceQueue.length > 0) {
            const currentFaceIndex = faceQueue.shift();
            
            // 查找相邻面
            for (let i = 0; i < faces.length; i++) {
                if (processedFaces.has(i)) continue;
                
                const face = faces[i];
                
                // 检查是否有共享边（两个已放置的顶点）
                const placedInFace = face.filter(v => placed.has(v));
                
                if (placedInFace.length >= 2) {
                    // 找到共享边
                    const [sharedV1, sharedV2] = placedInFace;
                    const newVertex = face.find(v => !placed.has(v));
                    
                    if (newVertex !== undefined && !placed.has(newVertex)) {
                        // 计算新顶点位置
                        const newUV = this.calculateThirdVertex(
                            vertices, uv, sharedV1, sharedV2, newVertex, meshData
                        );
                        
                        if (newUV) {
                            uv[newVertex] = newUV;
                            placed.add(newVertex);
                        }
                    }
                    
                    processedFaces.add(i);
                    faceQueue.push(i);
                }
            }
        }
        
        // 处理任何未放置的顶点（孤立顶点）
        vertices.forEach((v, i) => {
            if (!placed.has(i)) {
                // 将未放置的顶点放在一个默认位置
                uv[i] = { u: Math.random() * 0.1, v: Math.random() * 0.1 };
            }
        });
        
        return uv;
    }
    
    /**
     * 计算三角形第三个顶点的2D位置
     */
    calculateThirdVertex(vertices, uv, v1, v2, v3, meshData) {
        const p1_3d = vertices[v1].pos3D;
        const p2_3d = vertices[v2].pos3D;
        const p3_3d = vertices[v3].pos3D;
        
        const p1_2d = uv[v1];
        const p2_2d = uv[v2];
        
        // 计算3D边长
        const len_12 = this.distance3D(p1_3d, p2_3d);
        const len_13 = this.distance3D(p1_3d, p3_3d);
        const len_23 = this.distance3D(p2_3d, p3_3d);
        
        if (len_12 < 1e-10) return null;
        
        // 使用余弦定理计算角度
        const cosAngle = (len_12 * len_12 + len_13 * len_13 - len_23 * len_23) / (2 * len_12 * len_13);
        const clampedCos = Math.max(-1, Math.min(1, cosAngle));
        const sinAngle = Math.sqrt(1 - clampedCos * clampedCos);
        
        // 计算2D方向向量
        const dx = p2_2d.u - p1_2d.u;
        const dy = p2_2d.v - p1_2d.v;
        const len_2d = Math.sqrt(dx * dx + dy * dy);
        
        if (len_2d < 1e-10) return null;
        
        // 单位化
        const ux = dx / len_2d;
        const uy = dy / len_2d;
        
        // 垂直方向（选择使三角形保持正向）
        const px = -uy;
        const py = ux;
        
        // 计算新顶点位置
        return {
            u: p1_2d.u + len_13 * (clampedCos * ux + sinAngle * px),
            v: p1_2d.v + len_13 * (clampedCos * uy + sinAngle * py)
        };
    }
    
    /**
     * 基于角度的优化（ABF - Angle Based Flattening）
     */
    async optimizeABF(uv, vertices, faces, meshData) {
        const n = vertices.length;
        
        // 预计算每个面的目标角度（3D角度）
        const targetAngles = this.computeTargetAngles(vertices, faces, meshData);
        
        // 预计算顶点邻接关系（避免每次迭代重复计算）
        const vertexAdjacency = new Array(n);
        for (let vIdx = 0; vIdx < n; vIdx++) {
            vertexAdjacency[vIdx] = [];
        }
        faces.forEach((face, faceIdx) => {
            face.forEach((vIdx, localIdx) => {
                vertexAdjacency[vIdx].push({ faceIdx, localIdx });
            });
        });
        
        // 优化迭代
        const alpha = 0.5; // 增加平滑因子以加快收敛
        
        for (let iter = 0; iter < this.iterations; iter++) {
            // 使用局部优化调整顶点位置
            const newUV = uv.map(p => ({ ...p }));
            
            for (let vIdx = 0; vIdx < n; vIdx++) {
                const adjacentFaces = vertexAdjacency[vIdx];
                if (adjacentFaces.length < 2) continue;
                
                // 计算理想位置
                let sumU = 0, sumV = 0;
                let weight = 0;
                
                for (const { faceIdx, localIdx } of adjacentFaces) {
                    const face = faces[faceIdx];
                    const prevIdx = face[(localIdx + face.length - 1) % face.length];
                    const nextIdx = face[(localIdx + 1) % face.length];
                    
                    const prev = uv[prevIdx];
                    const next = uv[nextIdx];
                    
                    sumU += (prev.u + next.u) / 2;
                    sumV += (prev.v + next.v) / 2;
                    weight += 1;
                }
                
                if (weight > 0) {
                    newUV[vIdx] = {
                        u: uv[vIdx].u * (1 - alpha) + (sumU / weight) * alpha,
                        v: uv[vIdx].v * (1 - alpha) + (sumV / weight) * alpha
                    };
                }
            }
            
            // 更新UV
            uv = newUV;
            
            // 只在关键点更新进度，减少异步等待
            if (iter % Math.max(1, Math.floor(this.iterations / 5)) === 0) {
                this.onProgress((iter / this.iterations) * 100);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        return uv;
    }
    
    /**
     * 共形映射优化
     */
    async optimizeConformal(uv, vertices, faces, meshData) {
        // 类似ABF，但使用共形能量
        return this.optimizeABF(uv, vertices, faces, meshData);
    }
    
    /**
     * 最小二乘共形映射（LSCM）
     */
    async optimizeLSCM(uv, vertices, faces, meshData) {
        // 简化版LSCM，使用边长保持约束
        const n = vertices.length;
        
        for (let iter = 0; iter < this.iterations; iter++) {
            const gradient = new Array(n).fill(null).map(() => ({ u: 0, v: 0 }));
            
            // 对每条边计算梯度
            faces.forEach(face => {
                for (let i = 0; i < face.length; i++) {
                    const v1 = face[i];
                    const v2 = face[(i + 1) % face.length];
                    
                    // 3D边长
                    const len3D = this.distance3D(
                        vertices[v1].pos3D,
                        vertices[v2].pos3D
                    );
                    
                    // 2D边长
                    const du = uv[v2].u - uv[v1].u;
                    const dv = uv[v2].v - uv[v1].v;
                    const len2D = Math.sqrt(du * du + dv * dv);
                    
                    if (len2D < 1e-10) return;
                    
                    // 边长误差
                    const error = len2D - len3D;
                    const scale = error / len2D;
                    
                    // 梯度
                    gradient[v1].u += du * scale;
                    gradient[v1].v += dv * scale;
                    gradient[v2].u -= du * scale;
                    gradient[v2].v -= dv * scale;
                }
            });
            
            // 应用梯度
            const stepSize = 0.15;
            for (let i = 0; i < n; i++) {
                uv[i].u -= gradient[i].u * stepSize;
                uv[i].v -= gradient[i].v * stepSize;
            }
            
            // 只在关键点更新进度
            if (iter % Math.max(1, Math.floor(this.iterations / 5)) === 0) {
                this.onProgress((iter / this.iterations) * 100);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        return uv;
    }
    
    /**
     * 计算目标角度（3D空间中的角度）
     */
    computeTargetAngles(vertices, faces, meshData) {
        return faces.map(face => {
            const angles = [];
            for (let i = 0; i < face.length; i++) {
                const prev = face[(i + face.length - 1) % face.length];
                const curr = face[i];
                const next = face[(i + 1) % face.length];
                
                const p0 = vertices[prev].pos3D;
                const p1 = vertices[curr].pos3D;
                const p2 = vertices[next].pos3D;
                
                angles.push(this.angle3D(p0, p1, p2));
            }
            return angles;
        });
    }
    
    /**
     * 计算当前角度（2D空间中的角度）
     */
    computeCurrentAngles(uv, faces) {
        return faces.map(face => {
            const angles = [];
            for (let i = 0; i < face.length; i++) {
                const prev = face[(i + face.length - 1) % face.length];
                const curr = face[i];
                const next = face[(i + 1) % face.length];
                
                const p0 = uv[prev];
                const p1 = uv[curr];
                const p2 = uv[next];
                
                angles.push(this.angle2D(p0, p1, p2));
            }
            return angles;
        });
    }
    
    /**
     * 计算3D角度
     */
    angle3D(p0, p1, p2) {
        const v1 = {
            x: p0.x - p1.x,
            y: p0.y - p1.y,
            z: p0.z - p1.z
        };
        const v2 = {
            x: p2.x - p1.x,
            y: p2.y - p1.y,
            z: p2.z - p1.z
        };
        
        const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
        const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
        const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
        
        if (len1 < 1e-10 || len2 < 1e-10) return 0;
        
        const cosAngle = Math.max(-1, Math.min(1, dot / (len1 * len2)));
        return Math.acos(cosAngle);
    }
    
    /**
     * 计算2D角度
     */
    angle2D(p0, p1, p2) {
        const v1 = { u: p0.u - p1.u, v: p0.v - p1.v };
        const v2 = { u: p2.u - p1.u, v: p2.v - p1.v };
        
        const dot = v1.u * v2.u + v1.v * v2.v;
        const len1 = Math.sqrt(v1.u * v1.u + v1.v * v1.v);
        const len2 = Math.sqrt(v2.u * v2.u + v2.v * v2.v);
        
        if (len1 < 1e-10 || len2 < 1e-10) return 0;
        
        const cosAngle = Math.max(-1, Math.min(1, dot / (len1 * len2)));
        return Math.acos(cosAngle);
    }
    
    /**
     * 计算3D距离
     */
    distance3D(p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dz = p2.z - p1.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    
    /**
     * 计算UV边界
     */
    calculateBounds(uv) {
        let minU = Infinity, maxU = -Infinity;
        let minV = Infinity, maxV = -Infinity;
        
        uv.forEach(p => {
            if (p.u < minU) minU = p.u;
            if (p.u > maxU) maxU = p.u;
            if (p.v < minV) minV = p.v;
            if (p.v > maxV) maxV = p.v;
        });
        
        return { minU, maxU, minV, maxV };
    }
    
    /**
     * 归一化UV坐标
     */
    normalizeUV(uv, bounds) {
        const width = bounds.maxU - bounds.minU;
        const height = bounds.maxV - bounds.minV;
        const scale = Math.max(width, height);
        
        if (scale < 1e-10) return uv;
        
        return uv.map(p => ({
            u: (p.u - bounds.minU) / scale,
            v: (p.v - bounds.minV) / scale
        }));
    }
    
    /**
     * 布局多个片段
     */
    layoutPieces(pieces) {
        if (pieces.length === 0) {
            return { bounds: { minU: 0, maxU: 1, minV: 0, maxV: 1 }, totalArea: 0 };
        }
        
        // 计算每个片段的大小
        const pieceSizes = pieces.map(piece => {
            const b = piece.bounds;
            return {
                width: b.maxU - b.minU,
                height: b.maxV - b.minV,
                area: (b.maxU - b.minU) * (b.maxV - b.minV)
            };
        });
        
        // 简单的行布局
        let currentX = 0;
        let currentY = 0;
        let rowHeight = 0;
        const padding = 0.1;
        const maxRowWidth = 2; // 最大行宽
        
        pieces.forEach((piece, i) => {
            const size = pieceSizes[i];
            
            if (currentX + size.width > maxRowWidth && currentX > 0) {
                // 换行
                currentX = 0;
                currentY += rowHeight + padding;
                rowHeight = 0;
            }
            
            // 偏移UV坐标
            const offsetU = currentX - piece.bounds.minU;
            const offsetV = currentY - piece.bounds.minV;
            
            piece.uv = piece.uv.map(p => ({
                u: p.u + offsetU,
                v: p.v + offsetV
            }));
            
            // 更新边界
            piece.bounds = this.calculateBounds(piece.uv);
            
            currentX += size.width + padding;
            rowHeight = Math.max(rowHeight, size.height);
        });
        
        // 计算总边界
        let minU = Infinity, maxU = -Infinity;
        let minV = Infinity, maxV = -Infinity;
        let totalArea = 0;
        
        pieces.forEach(piece => {
            const b = piece.bounds;
            if (b.minU < minU) minU = b.minU;
            if (b.maxU > maxU) maxU = b.maxU;
            if (b.minV < minV) minV = b.minV;
            if (b.maxV > maxV) maxV = b.maxV;
            totalArea += (b.maxU - b.minU) * (b.maxV - b.minV);
        });
        
        return {
            bounds: { minU, maxU, minV, maxV },
            totalArea
        };
    }
}

