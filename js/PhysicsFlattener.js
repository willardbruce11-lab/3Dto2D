/**
 * PhysicsFlattener.js - V10.0 物理差异化松弛展开器
 * 
 * 核心策略："外刚内柔" (Steel & Rubber Strategy)
 * 
 * 边界边 (Boundary Edges):
 *   - 高刚度 (k ≈ 50.0) - 像钢丝
 *   - 强迫 2D 轮廓线长度 = 3D 原始长度
 *   - 效果：边界保持不变
 * 
 * 内部边 (Internal Edges):
 *   - 低刚度 (k ≈ 0.1~0.5) - 像橡皮筋
 *   - 允许内部网格自动收缩/膨胀
 *   - 效果：消除鼓包，面积自然分布
 * 
 * 边界自由度:
 *   - 不固定边界点（只钉中心一点防漂移）
 *   - 效果：直硬的切口线会自动弯曲形成物理弧度
 */

import * as THREE from 'three';

class PhysicsFlattener {
    constructor() {
        this.iterations = 200;
        this.debug = false;
    }
    
    /**
     * V10.0 差异化物理松弛
     * @param {Object} subMesh - 包含 vertices, faces 的子网格
     * @param {Array<{u,v}>} initialUV - 初始UV坐标
     * @param {Object} options - 配置选项
     * @returns {Array<{u,v}>} 优化后的UV
     */
    async relaxDifferentiated(subMesh, initialUV, options = {}) {
        const {
            iterations = 200,
            boundaryStiffness = 50.0,   // 边界刚度：钢丝
            internalStiffness = 0.2,    // 内部刚度：橡皮筋
            pinBoundary = false,        // 不钉死边界 -> 允许形成弧度
            damping = 0.995             // 阻尼系数
        } = options;
        
        const vertices = subMesh.vertices;
        const faces = subMesh.faces;
        const vertexCount = vertices.length;
        
        if (vertexCount < 3 || !initialUV || initialUV.length !== vertexCount) {
            console.warn("PhysicsFlattener: 输入无效");
            return initialUV || this.createFallbackUVs(vertexCount);
        }
        
        // 转换初始UV为Float32Array
        const currentUVs = new Float32Array(vertexCount * 2);
        for (let i = 0; i < vertexCount; i++) {
            currentUVs[i * 2] = initialUV[i]?.u || 0;
            currentUVs[i * 2 + 1] = initialUV[i]?.v || 0;
        }
        
        // 识别边界顶点和边界边
        const { boundaryVerts, boundaryEdges } = this.identifyBoundary(faces, vertexCount);
        
        // 构建差异化弹簧约束
        const constraints = this.buildDifferentiatedConstraints(
            vertices, faces, boundaryEdges, boundaryStiffness, internalStiffness
        );
        
        console.log(`  PhysicsFlattener V10.0: ${constraints.length} 条弹簧`);
        console.log(`    边界边: ${boundaryEdges.size} 条 (k=${boundaryStiffness})`);
        console.log(`    内部边: ${constraints.length - boundaryEdges.size} 条 (k=${internalStiffness})`);
        
        // 记录初始质心（用于防漂移）
        let initialCenterU = 0, initialCenterV = 0;
        for (let i = 0; i < vertexCount; i++) {
            initialCenterU += currentUVs[i * 2];
            initialCenterV += currentUVs[i * 2 + 1];
        }
        initialCenterU /= vertexCount;
        initialCenterV /= vertexCount;
        
        // 速度数组（用于动量）
        const velocities = new Float32Array(vertexCount * 2);
        
        // 物理迭代
        const startTime = Date.now();
        let currentDamping = 1.0;
        
        for (let iter = 0; iter < iterations; iter++) {
            // 计算弹簧力并更新位置
            this.physicsStep(currentUVs, velocities, constraints, boundaryVerts, pinBoundary, currentDamping);
            
            // 质心锚定：防止整体漂移
            if (!pinBoundary) {
                let newCenterU = 0, newCenterV = 0;
                for (let i = 0; i < vertexCount; i++) {
                    newCenterU += currentUVs[i * 2];
                    newCenterV += currentUVs[i * 2 + 1];
                }
                newCenterU /= vertexCount;
                newCenterV /= vertexCount;
                
                const driftU = initialCenterU - newCenterU;
                const driftV = initialCenterV - newCenterV;
                for (let i = 0; i < vertexCount; i++) {
                    currentUVs[i * 2] += driftU;
                    currentUVs[i * 2 + 1] += driftV;
                }
            }
            
            // 逐步增加阻尼（模拟退火）
            if (iter > iterations * 0.6) {
                currentDamping *= damping;
            }
        }
        
        const elapsed = Date.now() - startTime;
        console.log(`  PhysicsFlattener V10.0: 完成 (${elapsed}ms)`);
        
        // 转换输出格式
        const uvs = [];
        for (let i = 0; i < vertexCount; i++) {
            uvs.push({
                u: currentUVs[i * 2],
                v: currentUVs[i * 2 + 1]
            });
        }
        
        return uvs;
    }
    
    /**
     * 识别边界顶点和边界边
     */
    identifyBoundary(faces, vertexCount) {
        const edgeCount = new Map();
        
        for (const face of faces) {
            if (!face) continue;
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
            }
        }
        
        const boundaryVerts = new Set();
        const boundaryEdges = new Set();
        
        for (const [key, count] of edgeCount) {
            if (count === 1) {  // 边界边只出现一次
                boundaryEdges.add(key);
                const [v1, v2] = key.split('_').map(Number);
                boundaryVerts.add(v1);
                boundaryVerts.add(v2);
            }
        }
        
        return { boundaryVerts, boundaryEdges };
    }
    
    /**
     * 构建差异化刚度的弹簧约束
     */
    buildDifferentiatedConstraints(vertices, faces, boundaryEdges, boundaryK, internalK) {
        const constraints = [];
        const edgeCheck = new Set();
        
        for (const face of faces) {
            if (!face) continue;
            
            for (let j = 0; j < face.length; j++) {
                const u = face[j];
                const v = face[(j + 1) % face.length];
                
                const key = u < v ? `${u}_${v}` : `${v}_${u}`;
                if (edgeCheck.has(key)) continue;
                edgeCheck.add(key);
                
                const vU = vertices[u];
                const vV = vertices[v];
                if (!vU || !vV) continue;
                
                // 计算3D原始长度
                const dx = vV.x - vU.x;
                const dy = vV.y - vU.y;
                const dz = vV.z - vU.z;
                const restLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
                
                if (restLength < 1e-10) continue;
                
                // 差异化刚度：边界边用高刚度，内部边用低刚度
                const isBoundary = boundaryEdges.has(key);
                const stiffness = isBoundary ? boundaryK : internalK;
                
                constraints.push({
                    u, v,
                    restLength,
                    stiffness,
                    isBoundary
                });
            }
        }
        
        return constraints;
    }
    
    /**
     * 物理步进：计算弹簧力并更新位置
     */
    physicsStep(currentUVs, velocities, constraints, boundaryVerts, pinBoundary, damping) {
        const forces = new Float32Array(currentUVs.length);
        
        // 计算弹簧力
        for (const { u, v, restLength, stiffness } of constraints) {
            const u_x = currentUVs[u * 2];
            const u_y = currentUVs[u * 2 + 1];
            const v_x = currentUVs[v * 2];
            const v_y = currentUVs[v * 2 + 1];
            
            const dx = v_x - u_x;
            const dy = v_y - u_y;
            const currentLen = Math.sqrt(dx * dx + dy * dy);
            
            if (currentLen < 1e-10) continue;
            
            // 弹簧力: F = k * (L_current - L_rest) * dir
            const stretch = currentLen - restLength;
            const forceMag = stiffness * stretch / currentLen;
            
            const fx = dx * forceMag;
            const fy = dy * forceMag;
            
            // 作用力与反作用力
            forces[u * 2] += fx;
            forces[u * 2 + 1] += fy;
            forces[v * 2] -= fx;
            forces[v * 2 + 1] -= fy;
        }
        
        // 更新速度和位置
        const dt = 0.016;  // 时间步长
        const mass = 1.0;
        
        for (let i = 0; i < currentUVs.length / 2; i++) {
            // 如果钉死边界，边界点不动
            if (pinBoundary && boundaryVerts.has(i)) {
                velocities[i * 2] = 0;
                velocities[i * 2 + 1] = 0;
                continue;
            }
            
            // 更新速度
            velocities[i * 2] = (velocities[i * 2] + forces[i * 2] * dt / mass) * damping;
            velocities[i * 2 + 1] = (velocities[i * 2 + 1] + forces[i * 2 + 1] * dt / mass) * damping;
            
            // 更新位置
            currentUVs[i * 2] += velocities[i * 2] * dt;
            currentUVs[i * 2 + 1] += velocities[i * 2 + 1] * dt;
        }
    }
    
    /**
     * 兼容旧接口的 relax 方法
     */
    async relax(subMesh, initialUV, options = {}) {
        // 转换旧参数到新接口
        const newOptions = {
            iterations: options.iterations || 200,
            boundaryStiffness: options.boundaryStiffness || (options.stiffness ? options.stiffness * 50 : 50.0),
            internalStiffness: options.internalStiffness || (options.stiffness ? options.stiffness * 0.3 : 0.2),
            pinBoundary: options.pinBoundary !== undefined ? options.pinBoundary : !options.pinCenter,
            damping: options.damping || 0.995
        };
        
        return this.relaxDifferentiated(subMesh, initialUV, newOptions);
    }
    
    /**
     * 计算最佳投影平面的基底
     */
    computeProjectionBasis(vertices, faces) {
        const avgNormal = new THREE.Vector3(0, 0, 0);
        const pA = new THREE.Vector3();
        const pB = new THREE.Vector3();
        const pC = new THREE.Vector3();
        const cb = new THREE.Vector3();
        const ab = new THREE.Vector3();
        
        for (const face of faces) {
            if (!face || face.length < 3) continue;
            
            const vA = vertices[face[0]];
            const vB = vertices[face[1]];
            const vC = vertices[face[2]];
            
            if (!vA || !vB || !vC) continue;
            
            pA.set(vA.x, vA.y, vA.z);
            pB.set(vB.x, vB.y, vB.z);
            pC.set(vC.x, vC.y, vC.z);
            
            cb.subVectors(pC, pB);
            ab.subVectors(pA, pB);
            cb.cross(ab);
            
            avgNormal.add(cb);
        }
        
        if (avgNormal.length() < 1e-10) {
            avgNormal.set(0, 0, 1);
        } else {
            avgNormal.normalize();
        }
        
        let up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(avgNormal.y) > 0.9) {
            up.set(1, 0, 0);
        }
        
        const axisX = new THREE.Vector3().crossVectors(up, avgNormal).normalize();
        const axisY = new THREE.Vector3().crossVectors(avgNormal, axisX).normalize();
        
        return { axisX, axisY, avgNormal };
    }
    
    /**
     * 计算平面投影
     */
    computePlanarProjection(subMesh) {
        const vertices = subMesh.vertices;
        const faces = subMesh.faces;
        const vertexCount = vertices.length;
        
        if (vertexCount < 3) {
            return this.createFallbackUVs(vertexCount);
        }
        
        const { axisX, axisY } = this.computeProjectionBasis(vertices, faces);
        
        const uvs = [];
        for (let i = 0; i < vertexCount; i++) {
            const v = vertices[i];
            if (!v || typeof v.x !== 'number') {
                uvs.push({ u: 0, v: 0 });
                continue;
            }
            
            const tempVec = new THREE.Vector3(v.x, v.y, v.z);
            uvs.push({
                u: tempVec.dot(axisX),
                v: tempVec.dot(axisY)
            });
        }
        
        return uvs;
    }
    
    /**
     * 创建降级UV
     */
    createFallbackUVs(count) {
        const uvs = [];
        for (let i = 0; i < count; i++) {
            uvs.push({ u: i * 0.1, v: 0 });
        }
        return uvs;
    }
    
    setDebug(enabled) {
        this.debug = enabled;
    }
}

export const physicsFlattener = new PhysicsFlattener();
export { PhysicsFlattener };
