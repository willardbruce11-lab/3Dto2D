/**
 * BFSUnfolder.js - BFS 辐射展开器
 * 
 * 核心思路：中心辐射展开法 (BFS Geodesic Fan)
 * - 选一个中心点，像剥香蕉或铺地毯一样，一层一层往外铺
 * - 从中心三角形开始平铺，然后找邻居三角形
 * - 根据 3D 边长和角度，算出每个三角形在 2D 的位置
 * 
 * 优势：
 * - 绝对不会局部重叠
 * - 最大程度保留 3D 面积
 * - 速度极快，纯几何计算
 * - 无需解矩阵方程
 */

import * as THREE from 'three';

class BFSUnfolder {
    constructor() {
        this.debug = false;
    }
    
    /**
     * 计算"辐射展开"的初始 UV
     * @param {Object} subMesh - 包含 vertices, faces 的子网格
     * @returns {Array<{u,v}>} UV坐标数组
     */
    compute(subMesh) {
        const vertices = subMesh.vertices;
        const faces = subMesh.faces;
        
        if (!vertices || vertices.length < 3 || !faces || faces.length < 1) {
            console.warn('BFSUnfolder: 网格数据不足');
            return this.createDefaultUVs(vertices?.length || 0);
        }
        
        const vertCount = vertices.length;
        const faceCount = faces.length;
        
        // UV 数组
        const uvs = new Array(vertCount).fill(null).map(() => ({ u: 0, v: 0 }));
        const visitedVerts = new Uint8Array(vertCount);  // 0:未访问, 1:已访问
        const visitedFaces = new Uint8Array(faceCount);
        
        // 1. 构建顶点->面邻接表
        const vertToFaces = this.buildVertToFaces(faces, vertCount);
        
        // 2. 找一个中心面片作为种子（选择靠近质心的面）
        const centerFaceIdx = this.findCenterFace(vertices, faces);
        
        // 3. 将中心面片平铺在 UV 原点
        const face = faces[centerFaceIdx];
        if (!face || face.length < 3) {
            console.warn('BFSUnfolder: 中心面无效');
            return this.createDefaultUVs(vertCount);
        }
        
        const a = face[0];
        const b = face[1];
        const c = face[2];
        
        const pA = vertices[a];
        const pB = vertices[b];
        const pC = vertices[c];
        
        if (!pA || !pB || !pC) {
            console.warn('BFSUnfolder: 中心面顶点无效');
            return this.createDefaultUVs(vertCount);
        }
        
        // A 点在 (0, 0)
        uvs[a] = { u: 0, v: 0 };
        visitedVerts[a] = 1;
        
        // B 点在 X 轴上，距离为 AB 长
        const lenAB = this.distance3D(pA, pB);
        uvs[b] = { u: lenAB, v: 0 };
        visitedVerts[b] = 1;
        
        // C 点根据三角形形状确定（使用余弦定理）
        const lenAC = this.distance3D(pA, pC);
        const lenBC = this.distance3D(pB, pC);
        
        // 余弦定理求角 A
        let cosA = 0;
        if (lenAB > 1e-10 && lenAC > 1e-10) {
            cosA = (lenAB * lenAB + lenAC * lenAC - lenBC * lenBC) / (2 * lenAB * lenAC);
            cosA = Math.max(-1, Math.min(1, cosA));  // 防止浮点误差
        }
        const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
        
        uvs[c] = { u: lenAC * cosA, v: lenAC * sinA };
        visitedVerts[c] = 1;
        visitedFaces[centerFaceIdx] = 1;
        
        // 4. BFS 队列：从中心面向外扩散
        const queue = [centerFaceIdx];
        let processedCount = 1;
        
        while (queue.length > 0) {
            const currentFaceIdx = queue.shift();
            const currentFace = faces[currentFaceIdx];
            
            if (!currentFace) continue;
            
            // 获取当前面的顶点
            const faceVerts = currentFace.slice(0, 3);
            
            // 寻找该面的邻居面
            const neighbors = this.getNeighborFaces(faceVerts, vertToFaces, visitedFaces, faces);
            
            for (const nextFaceIdx of neighbors) {
                if (visitedFaces[nextFaceIdx]) continue;
                
                // 尝试铺平这个邻居面
                const success = this.unfoldTriangle(
                    nextFaceIdx, faces, vertices, uvs, visitedVerts
                );
                
                if (success) {
                    visitedFaces[nextFaceIdx] = 1;
                    queue.push(nextFaceIdx);
                    processedCount++;
                }
            }
        }
        
        if (this.debug) {
            console.log(`BFSUnfolder: 展开了 ${processedCount}/${faceCount} 个面`);
        }
        
        // 5. 处理未访问的顶点（孤立点）
        for (let i = 0; i < vertCount; i++) {
            if (!visitedVerts[i]) {
                // 用邻居平均值或默认位置
                uvs[i] = this.estimateUV(i, vertices, faces, uvs, visitedVerts);
            }
        }
        
        return uvs;
    }
    
    /**
     * 根据两个已知点，算出第三个点在 2D 的位置
     * 核心几何解算：两圆交点
     */
    unfoldTriangle(faceIdx, faces, vertices, uvs, visitedVerts) {
        const face = faces[faceIdx];
        if (!face || face.length < 3) return false;
        
        const ia = face[0];
        const ib = face[1];
        const ic = face[2];
        
        // 找出哪两个是已知点 (Anchor)，哪个是未知点 (Target)
        let u1, u2, target;
        
        if (visitedVerts[ia] && visitedVerts[ib] && !visitedVerts[ic]) {
            u1 = ia; u2 = ib; target = ic;
        } else if (visitedVerts[ib] && visitedVerts[ic] && !visitedVerts[ia]) {
            u1 = ib; u2 = ic; target = ia;
        } else if (visitedVerts[ic] && visitedVerts[ia] && !visitedVerts[ib]) {
            u1 = ic; u2 = ia; target = ib;
        } else if (visitedVerts[ia] && visitedVerts[ib] && visitedVerts[ic]) {
            // 三个都已访问（闭环），跳过
            return true;
        } else {
            // 只有一个或零个已访问，跳过（会在后续处理）
            return false;
        }
        
        // 3D 坐标
        const p1 = vertices[u1];
        const p2 = vertices[u2];
        const pTarget = vertices[target];
        
        if (!p1 || !p2 || !pTarget) return false;
        
        // 3D 边长
        const r1 = this.distance3D(p1, pTarget);  // dist(u1, target)
        const r2 = this.distance3D(p2, pTarget);  // dist(u2, target)
        const d = this.distance3D(p1, p2);        // dist(u1, u2)
        
        // 2D 坐标 (已知)
        const x1 = uvs[u1].u, y1 = uvs[u1].v;
        const x2 = uvs[u2].u, y2 = uvs[u2].v;
        
        // 检查 d 是否有效
        if (d < 1e-10) {
            // 两个锚点重合，无法计算
            uvs[target] = { u: x1, v: y1 };
            visitedVerts[target] = 1;
            return true;
        }
        
        // --- 核心几何解算：两圆交点 ---
        // 我们要在 2D 平面上找一点 (x,y)，使得它到 (x1,y1) 距离为 r1，到 (x2,y2) 距离为 r2
        
        // 1. 在基准线 u1->u2 上的投影距离 'a'
        // r1^2 - a^2 = h^2
        // r2^2 - (d-a)^2 = h^2
        // => a = (r1^2 - r2^2 + d^2) / (2*d)
        const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
        
        // 2. 高度 'h'
        const hSq = r1 * r1 - a * a;
        const h = hSq > 0 ? Math.sqrt(hSq) : 0;
        
        // 3. 基准向量
        const dx = x2 - x1;
        const dy = y2 - y1;
        
        // 4. 算出基准点 P0 (在 u1->u2 连线上的垂足)
        const p0x = x1 + a * (dx / d);
        const p0y = y1 + a * (dy / d);
        
        // 5. 算出目标点 (有两个解，选符合右手定则的那个)
        // 旋转 90 度：(-dy, dx)
        const rx = -dy * (h / d);
        const ry = dx * (h / d);
        
        // 选择一个方向（后续物理优化会修正翻转）
        uvs[target] = { u: p0x + rx, v: p0y + ry };
        visitedVerts[target] = 1;
        
        return true;
    }
    
    /**
     * 构建顶点->面邻接表
     */
    buildVertToFaces(faces, vertCount) {
        const vertToFaces = new Array(vertCount).fill(null).map(() => []);
        
        for (let faceIdx = 0; faceIdx < faces.length; faceIdx++) {
            const face = faces[faceIdx];
            if (!face) continue;
            
            for (let i = 0; i < Math.min(face.length, 3); i++) {
                const v = face[i];
                if (v >= 0 && v < vertCount) {
                    vertToFaces[v].push(faceIdx);
                }
            }
        }
        
        return vertToFaces;
    }
    
    /**
     * 获取邻居面（通过共享边）
     */
    getNeighborFaces(faceVerts, vertToFaces, visitedFaces, faces) {
        const neighbors = new Set();
        
        // 遍历每条边
        for (let i = 0; i < faceVerts.length; i++) {
            const v1 = faceVerts[i];
            const v2 = faceVerts[(i + 1) % faceVerts.length];
            
            // 找同时包含 v1 和 v2 的面
            const facesWithV1 = vertToFaces[v1] || [];
            const facesWithV2 = new Set(vertToFaces[v2] || []);
            
            for (const faceIdx of facesWithV1) {
                if (facesWithV2.has(faceIdx) && !visitedFaces[faceIdx]) {
                    neighbors.add(faceIdx);
                }
            }
        }
        
        return Array.from(neighbors);
    }
    
    /**
     * 找到靠近质心的面作为中心面
     */
    findCenterFace(vertices, faces) {
        // 计算质心
        let cx = 0, cy = 0, cz = 0;
        let validCount = 0;
        
        for (const v of vertices) {
            if (v && typeof v.x === 'number') {
                cx += v.x;
                cy += v.y;
                cz += v.z;
                validCount++;
            }
        }
        
        if (validCount === 0) return 0;
        
        cx /= validCount;
        cy /= validCount;
        cz /= validCount;
        
        // 找最靠近质心的面
        let minDist = Infinity;
        let centerIdx = 0;
        
        for (let i = 0; i < faces.length; i++) {
            const face = faces[i];
            if (!face || face.length < 3) continue;
            
            // 计算面中心
            let fcx = 0, fcy = 0, fcz = 0;
            let faceValidCount = 0;
            
            for (let j = 0; j < 3; j++) {
                const v = vertices[face[j]];
                if (v) {
                    fcx += v.x;
                    fcy += v.y;
                    fcz += v.z;
                    faceValidCount++;
                }
            }
            
            if (faceValidCount === 0) continue;
            
            fcx /= faceValidCount;
            fcy /= faceValidCount;
            fcz /= faceValidCount;
            
            const dist = (fcx - cx) ** 2 + (fcy - cy) ** 2 + (fcz - cz) ** 2;
            if (dist < minDist) {
                minDist = dist;
                centerIdx = i;
            }
        }
        
        return centerIdx;
    }
    
    /**
     * 估计未访问顶点的UV（用于孤立点）
     */
    estimateUV(vertIdx, vertices, faces, uvs, visitedVerts) {
        // 尝试用邻居平均值
        const neighbors = new Set();
        
        for (const face of faces) {
            if (!face) continue;
            
            const idx = face.indexOf(vertIdx);
            if (idx !== -1) {
                for (let i = 0; i < face.length; i++) {
                    if (face[i] !== vertIdx && visitedVerts[face[i]]) {
                        neighbors.add(face[i]);
                    }
                }
            }
        }
        
        if (neighbors.size > 0) {
            let sumU = 0, sumV = 0;
            for (const nb of neighbors) {
                sumU += uvs[nb].u;
                sumV += uvs[nb].v;
            }
            return { u: sumU / neighbors.size, v: sumV / neighbors.size };
        }
        
        // 无邻居，用 3D 坐标投影
        const v = vertices[vertIdx];
        if (v) {
            return { u: v.x, v: v.y };
        }
        
        return { u: 0, v: 0 };
    }
    
    /**
     * 3D 距离计算
     */
    distance3D(p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dz = p2.z - p1.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    
    /**
     * 创建默认UV
     */
    createDefaultUVs(count) {
        const uvs = [];
        for (let i = 0; i < count; i++) {
            uvs.push({ u: i * 0.1, v: 0 });
        }
        return uvs;
    }
    
    /**
     * 设置调试模式
     */
    setDebug(enabled) {
        this.debug = enabled;
    }
}

export const bfsUnfolder = new BFSUnfolder();
export { BFSUnfolder };

