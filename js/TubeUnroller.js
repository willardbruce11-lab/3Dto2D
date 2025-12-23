/**
 * TubeUnroller.js - 滚筒展开工具类
 * 专门处理切开的管状物体（袖子、裤腿等）的圆柱展开
 * 
 * 核心思路：
 * 1. 识别边界（红线切出的左岸和右岸）
 * 2. 计算圆筒主轴（PCA / 包围盒最长轴）
 * 3. 使用角度+高度参数化 (θ, h) → (u, v)
 * 4. 确保展开后无重叠，面积投影最大
 */

import * as THREE from 'three';

class TubeUnroller {
    constructor() {
        this.debug = false;  // 调试模式
    }
    
    /**
     * 计算圆筒展开的初始UV
     * @param {Object} subMesh - 包含 vertices, faces, localToGlobal 的子网格
     * @param {Set} redIndicesSet - 原始网格中的红点索引集合（可选）
     * @returns {Array<{u,v}>} UV坐标数组，与顶点一一对应
     */
    computeUnrolledUV(subMesh, redIndicesSet = null) {
        const vertices = subMesh.vertices;
        const faces = subMesh.faces;
        const count = vertices.length;
        
        if (count < 3) {
            console.warn("TubeUnroller: 顶点太少，无法展开");
            return this.createFallbackUVs(count);
        }
        
        // 1. 检测边界环 (Boundary Loops)
        const boundaryEdges = this.getBoundaryEdges(subMesh);
        const loops = this.findBoundaryLoops(boundaryEdges, count);
        
        if (this.debug) {
            console.log(`TubeUnroller: 检测到 ${loops.length} 个边界环`);
            loops.forEach((loop, i) => console.log(`  环 ${i}: ${loop.length} 顶点`));
        }
        
        // 2. 计算圆筒主轴 (即圆筒的中轴线方向)
        const { center, axis, perpAxis1, perpAxis2 } = this.computeCylindricalBasis(vertices);
        
        if (this.debug) {
            console.log(`TubeUnroller: 主轴 = (${axis.x.toFixed(3)}, ${axis.y.toFixed(3)}, ${axis.z.toFixed(3)})`);
            console.log(`TubeUnroller: 中心 = (${center.x.toFixed(3)}, ${center.y.toFixed(3)}, ${center.z.toFixed(3)})`);
        }
        
        // 3. 圆柱展开算法：将 (x,y,z) 转换为 (θ, h) → (u, v)
        const uvs = [];
        const p = new THREE.Vector3();
        const vec = new THREE.Vector3();
        
        // 追踪角度范围以处理角度不连续问题
        let minTheta = Infinity, maxTheta = -Infinity;
        let minH = Infinity, maxH = -Infinity;
        const thetas = [];
        const heights = [];
        
        for (let i = 0; i < count; i++) {
            const v = vertices[i];
            if (!v || typeof v.x !== 'number') {
                thetas.push(0);
                heights.push(0);
                continue;
            }
            
            p.set(v.x, v.y, v.z);
            vec.subVectors(p, center);
            
            // 计算高度 (沿主轴的投影)
            const h = vec.dot(axis);
            
            // 计算角度 (在垂直于主轴的平面上)
            const x = vec.dot(perpAxis1);
            const z = vec.dot(perpAxis2);
            let theta = Math.atan2(z, x);  // -π 到 π
            
            thetas.push(theta);
            heights.push(h);
            
            minTheta = Math.min(minTheta, theta);
            maxTheta = Math.max(maxTheta, theta);
            minH = Math.min(minH, h);
            maxH = Math.max(maxH, h);
        }
        
        // 4. 检测角度跳跃并修正 (处理 -π 到 π 的不连续)
        const thetaRange = maxTheta - minTheta;
        const needsUnwrap = thetaRange > Math.PI * 1.5;  // 如果范围超过3/4圆周，可能需要展开
        
        if (needsUnwrap && this.debug) {
            console.log(`TubeUnroller: 检测到角度不连续，执行角度展开修正`);
        }
        
        // 如果有大的角度跳跃，将负角度转为正角度（连续化）
        const correctedThetas = thetas.map(theta => {
            if (needsUnwrap && theta < 0) {
                return theta + 2 * Math.PI;
            }
            return theta;
        });
        
        // 重新计算角度范围
        let correctedMinTheta = Math.min(...correctedThetas.filter(t => !isNaN(t)));
        let correctedMaxTheta = Math.max(...correctedThetas.filter(t => !isNaN(t)));
        
        // 防止除零
        const thetaSpan = correctedMaxTheta - correctedMinTheta || 1;
        const hSpan = maxH - minH || 1;
        
        // 5. 计算最终UV
        // 使用圆柱半径来估计周长，使U方向的比例接近真实长度
        // 估计半径: 取离中轴最远的点的平均距离
        let avgRadius = 0;
        let radiusCount = 0;
        for (let i = 0; i < count; i++) {
            const v = vertices[i];
            if (!v) continue;
            p.set(v.x, v.y, v.z);
            vec.subVectors(p, center);
            const r = Math.sqrt(
                Math.pow(vec.dot(perpAxis1), 2) + 
                Math.pow(vec.dot(perpAxis2), 2)
            );
            avgRadius += r;
            radiusCount++;
        }
        avgRadius = radiusCount > 0 ? avgRadius / radiusCount : 1;
        
        // 周长 = 2πr × (实际角度范围/2π)
        const arcLength = avgRadius * thetaSpan;
        
        for (let i = 0; i < count; i++) {
            const theta = correctedThetas[i];
            const h = heights[i];
            
            if (isNaN(theta) || isNaN(h)) {
                uvs.push({ u: 0, v: 0 });
                continue;
            }
            
            // U: 角度展开 → 弧长方向
            // 归一化角度到 [0, arcLength]
            const u = ((theta - correctedMinTheta) / thetaSpan) * arcLength;
            
            // V: 高度方向 (保持3D比例)
            const v = h - minH;
            
            uvs.push({ u, v });
        }
        
        if (this.debug) {
            console.log(`TubeUnroller: 展开完成`);
            console.log(`  角度范围: ${(correctedMinTheta * 180 / Math.PI).toFixed(1)}° ~ ${(correctedMaxTheta * 180 / Math.PI).toFixed(1)}°`);
            console.log(`  高度范围: ${minH.toFixed(3)} ~ ${maxH.toFixed(3)}`);
            console.log(`  估计半径: ${avgRadius.toFixed(3)}`);
            console.log(`  展开弧长: ${arcLength.toFixed(3)}`);
        }
        
        return uvs;
    }
    
    /**
     * 计算圆柱坐标系基底
     * 使用包围盒最长轴作为圆筒主轴（简化版PCA）
     */
    computeCylindricalBasis(vertices) {
        // 计算重心
        const center = new THREE.Vector3(0, 0, 0);
        let validCount = 0;
        
        for (const v of vertices) {
            if (v && typeof v.x === 'number') {
                center.x += v.x;
                center.y += v.y;
                center.z += v.z;
                validCount++;
            }
        }
        
        if (validCount > 0) {
            center.divideScalar(validCount);
        }
        
        // 计算包围盒
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        for (const v of vertices) {
            if (!v || typeof v.x !== 'number') continue;
            minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
            minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
            minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
        }
        
        const dx = maxX - minX;
        const dy = maxY - minY;
        const dz = maxZ - minZ;
        
        // 选择最长轴作为圆筒主轴
        let axis = new THREE.Vector3(0, 1, 0);  // 默认Y轴
        
        if (dx >= dy && dx >= dz) {
            axis.set(1, 0, 0);  // X轴最长
        } else if (dy >= dx && dy >= dz) {
            axis.set(0, 1, 0);  // Y轴最长
        } else {
            axis.set(0, 0, 1);  // Z轴最长
        }
        
        // 构造垂直于主轴的两个正交向量
        let perpAxis1 = new THREE.Vector3();
        let perpAxis2 = new THREE.Vector3();
        
        // 找一个不与axis平行的向量
        const tempUp = Math.abs(axis.y) > 0.9 
            ? new THREE.Vector3(1, 0, 0) 
            : new THREE.Vector3(0, 1, 0);
        
        perpAxis1.crossVectors(tempUp, axis).normalize();
        perpAxis2.crossVectors(axis, perpAxis1).normalize();
        
        return { center, axis, perpAxis1, perpAxis2 };
    }
    
    /**
     * 获取网格的边界边
     * 边界边是只被一个面使用的边
     */
    getBoundaryEdges(subMesh) {
        const edgeCount = new Map();  // 边 -> 使用次数
        
        for (const face of subMesh.faces) {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
            }
        }
        
        // 边界边：只出现一次的边
        const boundaryEdges = [];
        for (const [key, count] of edgeCount) {
            if (count === 1) {
                const [v1, v2] = key.split('_').map(Number);
                boundaryEdges.push([v1, v2]);
            }
        }
        
        return boundaryEdges;
    }
    
    /**
     * 将边界边组织成环（Loops）
     */
    findBoundaryLoops(boundaryEdges, vertexCount) {
        if (boundaryEdges.length === 0) {
            return [];
        }
        
        // 构建邻接表
        const adj = new Map();
        for (const [v1, v2] of boundaryEdges) {
            if (!adj.has(v1)) adj.set(v1, []);
            if (!adj.has(v2)) adj.set(v2, []);
            adj.get(v1).push(v2);
            adj.get(v2).push(v1);
        }
        
        const visited = new Set();
        const loops = [];
        
        for (const startVertex of adj.keys()) {
            if (visited.has(startVertex)) continue;
            
            // BFS/DFS 追踪一个环
            const loop = [];
            let current = startVertex;
            let prev = -1;
            
            while (!visited.has(current)) {
                visited.add(current);
                loop.push(current);
                
                const neighbors = adj.get(current) || [];
                let next = -1;
                
                for (const neighbor of neighbors) {
                    if (neighbor !== prev && !visited.has(neighbor)) {
                        next = neighbor;
                        break;
                    }
                }
                
                // 如果没找到下一个，检查是否能回到起点
                if (next === -1) {
                    for (const neighbor of neighbors) {
                        if (neighbor === startVertex && loop.length > 2) {
                            next = neighbor;
                            break;
                        }
                    }
                }
                
                if (next === -1 || next === startVertex) break;
                
                prev = current;
                current = next;
            }
            
            if (loop.length >= 3) {
                loops.push(loop);
            }
        }
        
        // 按环长度排序（最长的在前）
        loops.sort((a, b) => b.length - a.length);
        
        return loops;
    }
    
    /**
     * 创建降级UV（当无法正常展开时使用）
     */
    createFallbackUVs(count) {
        const uvs = [];
        for (let i = 0; i < count; i++) {
            uvs.push({ u: 0, v: 0 });
        }
        return uvs;
    }
    
    /**
     * 开启/关闭调试模式
     */
    setDebug(enabled) {
        this.debug = enabled;
    }
}

export const tubeUnroller = new TubeUnroller();
export { TubeUnroller };

