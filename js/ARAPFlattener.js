/**
 * ARAP (As-Rigid-As-Possible) 展开算法
 * 
 * 特点：
 * 1. 尽可能保持局部刚性（边长和面积不变）
 * 2. 不会在内部产生撕裂或额外切割
 * 3. 适合已经物理切开的独立子网格
 * 
 * 输入：一个已经是拓扑圆盘的独立子网格
 * 输出：该子网格的2D UV坐标
 */

export class ARAPFlattener {
    constructor() {
        this.vertices = [];    // 3D顶点 [{x,y,z}, ...]
        this.faces = [];       // 面 [[v0,v1,v2], ...]
        this.uvs = [];         // 2D坐标 [{u,v}, ...]
        this.edges = [];       // 边列表
        this.iterations = 10;
        this.boundaryEdges = new Set();
        this.boundaryVertices = new Set();
        this.boundaryConstraints = true;
    }
    
    /**
     * 设置子网格数据
     */
    setMesh(vertices, faces) {
        this.vertices = vertices;
        this.faces = faces;
        this.uvs = [];
        this.edges = this.buildEdges();
        this.collectBoundaryInfo();
    }
    
    /**
     * 构建边列表
     */
    buildEdges() {
        const edgeSet = new Map();
        
        for (let faceIdx = 0; faceIdx < this.faces.length; faceIdx++) {
            const face = this.faces[faceIdx];
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                
                if (!edgeSet.has(key)) {
                    edgeSet.set(key, {
                        v1: Math.min(v1, v2),
                        v2: Math.max(v1, v2),
                        length3D: this.distance3D(this.vertices[v1], this.vertices[v2])
                    });
                }
            }
        }
        
        return Array.from(edgeSet.values());
    }
    
    /**
     * 主展开函数
     * @param {number} iterations - ARAP迭代次数
     * @param {Object} options - 配置
     * @param {boolean} options.boundaryConstraints - 是否加强边界约束
     * @param {boolean} options.smoothBoundary - 是否对边界进行拉普拉斯平滑
     * @param {number} options.smoothIterations - 边界平滑迭代次数
     * @param {number} options.boundaryStiffness - 边界刚性权重 (默认10)
     * @param {number} options.internalStiffness - 内部弹性权重 (默认1)
     * @param {Array} options.initialUV - 可选的初始UV（来自LSCM）
     * @returns {Array} UV坐标数组
     */
    flatten(iterations = 10, options = {}) {
        this.iterations = iterations;
        this.boundaryConstraints = options.boundaryConstraints !== false;
        const smoothBoundary = options.smoothBoundary !== false;
        const smoothIterations = options.smoothIterations || 5;
        
        // 边界刚性 vs 内部弹性
        this.boundaryStiffness = options.boundaryStiffness || 10.0;
        this.internalStiffness = options.internalStiffness || 1.0;
        
        console.log(`ARAP展开开始: ${this.vertices.length} 顶点, ${this.faces.length} 面`);
        console.log(`  边界刚性: ${this.boundaryStiffness}, 内部弹性: ${this.internalStiffness}`);
        const startTime = Date.now();
        
        // Step 0: 边界拉普拉斯平滑 (消除锯齿)
        if (smoothBoundary && this.boundaryVertices.size > 0) {
            this.smoothBoundaryVertices(smoothIterations);
        }
        
        // Step 1: 使用LSCM/PCA获取初始UV (初始猜测)
        // 如果提供了外部初始UV，使用它
        if (options.initialUV && options.initialUV.length === this.vertices.length) {
            this.uvs = options.initialUV.map(uv => ({ u: uv.u, v: uv.v }));
            console.log(`  使用外部初始UV`);
        } else {
            this.initializeUV();
        }
        
        // Step 2: 加权ARAP迭代优化
        for (let iter = 0; iter < this.iterations; iter++) {
            this.arapIterationWeighted();
        }
        
        // Step 3: 归一化UV到[0,1]范围
        this.normalizeUV();
        
        console.log(`ARAP展开完成，耗时: ${Date.now() - startTime}ms`);
        
        return this.uvs;
    }
    
    /**
     * 加权ARAP迭代 - 边界刚性，内部弹性
     */
    arapIterationWeighted() {
        // Local step: 为每个面计算最优旋转矩阵
        const rotations = this.computeLocalRotations();
        
        // Global step: 使用加权优化顶点位置
        this.optimizePositionsWeighted(rotations);
    }
    
    /**
     * 加权Global step: 边界边高权重，内部边低权重
     */
    optimizePositionsWeighted(rotations) {
        const newUVs = this.uvs.map(() => ({ u: 0, v: 0 }));
        const weights = new Array(this.vertices.length).fill(0);
        
        // 对每条边施加约束
        for (let faceIdx = 0; faceIdx < this.faces.length; faceIdx++) {
            const face = this.faces[faceIdx];
            
            for (let i = 0; i < face.length; i++) {
                const vi = face[i];
                const vj = face[(i + 1) % face.length];
                
                // 3D边向量和长度
                const e3d = {
                    x: this.vertices[vj].x - this.vertices[vi].x,
                    y: this.vertices[vj].y - this.vertices[vi].y,
                    z: this.vertices[vj].z - this.vertices[vi].z
                };
                const len3d = Math.sqrt(e3d.x ** 2 + e3d.y ** 2 + e3d.z ** 2);
                
                // 当前2D边向量和长度
                const e2d = {
                    u: this.uvs[vj].u - this.uvs[vi].u,
                    v: this.uvs[vj].v - this.uvs[vi].v
                };
                const len2d = Math.sqrt(e2d.u ** 2 + e2d.v ** 2);

                // 判断是否为边界边
                const edgeKey = vi < vj ? `${vi}_${vj}` : `${vj}_${vi}`;
                const isBoundaryEdge = this.boundaryEdges.has(edgeKey);
                
                // 🔑 核心：边界边用高权重(刚性)，内部边用低权重(弹性)
                const edgeWeight = isBoundaryEdge ? this.boundaryStiffness : this.internalStiffness;
                
                // 目标：让2D边长等于3D边长
                if (len2d > 0.0001) {
                    const scale = len3d / len2d;
                    const targetU = this.uvs[vi].u + e2d.u * scale;
                    const targetV = this.uvs[vi].v + e2d.v * scale;
                    
                    newUVs[vj].u += targetU * edgeWeight;
                    newUVs[vj].v += targetV * edgeWeight;
                    weights[vj] += edgeWeight;
                }
            }
        }
        
        // 更新UV位置（加权平均）
        for (let i = 0; i < this.vertices.length; i++) {
            if (weights[i] > 0) {
                this.uvs[i].u = newUVs[i].u / weights[i];
                this.uvs[i].v = newUVs[i].v / weights[i];
            }
        }
    }
    
    /**
     * 边界拉普拉斯平滑 - 消除锯齿边缘
     * 【改进】使用自适应平滑因子，对锯齿严重的地方加大力度
     * @param {number} iterations - 平滑迭代次数
     */
    smoothBoundaryVertices(iterations = 5) {
        if (this.boundaryVertices.size === 0) return;
        
        // 构建顶点邻接表
        const vertexNeighbors = new Map();
        for (const face of this.faces) {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                
                if (!vertexNeighbors.has(v1)) vertexNeighbors.set(v1, new Set());
                if (!vertexNeighbors.has(v2)) vertexNeighbors.set(v2, new Set());
                
                vertexNeighbors.get(v1).add(v2);
                vertexNeighbors.get(v2).add(v1);
            }
        }
        
        // 识别边界顶点的边界邻居（只平滑边界上的邻居关系）
        const boundaryArray = Array.from(this.boundaryVertices);
        const boundarySet = this.boundaryVertices;
        
        // 计算每个边界顶点的"锯齿程度"（曲率）
        const computeCurvature = (vIdx) => {
            const neighbors = vertexNeighbors.get(vIdx);
            if (!neighbors || neighbors.size < 2) return 0;
            
            const current = this.vertices[vIdx];
            const boundaryNeighbors = Array.from(neighbors).filter(n => boundarySet.has(n));
            
            if (boundaryNeighbors.length < 2) return 0;
            
            // 计算相邻边界顶点的方向变化
            let avgX = 0, avgY = 0, avgZ = 0;
            for (const nIdx of boundaryNeighbors) {
                const n = this.vertices[nIdx];
                avgX += n.x;
                avgY += n.y;
                avgZ += n.z;
            }
            avgX /= boundaryNeighbors.length;
            avgY /= boundaryNeighbors.length;
            avgZ /= boundaryNeighbors.length;
            
            // 曲率 = 当前点到邻居中心的距离
            const dx = current.x - avgX;
            const dy = current.y - avgY;
            const dz = current.z - avgZ;
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        };
        
        for (let iter = 0; iter < iterations; iter++) {
            const newPositions = new Map();
            
            for (const vIdx of boundaryArray) {
                const neighbors = vertexNeighbors.get(vIdx);
                if (!neighbors || neighbors.size === 0) continue;
                
                // 只使用边界邻居进行平滑（保持边界形状）
                const boundaryNeighbors = Array.from(neighbors).filter(n => boundarySet.has(n));
                
                if (boundaryNeighbors.length === 0) continue;
                
                // 计算邻居的平均位置
                let avgX = 0, avgY = 0, avgZ = 0;
                
                for (const nIdx of boundaryNeighbors) {
                    const neighbor = this.vertices[nIdx];
                    avgX += neighbor.x;
                    avgY += neighbor.y;
                    avgZ += neighbor.z;
                }
                
                avgX /= boundaryNeighbors.length;
                avgY /= boundaryNeighbors.length;
                avgZ /= boundaryNeighbors.length;
                
                // 自适应平滑因子：锯齿越大，平滑越强
                const curvature = computeCurvature(vIdx);
                const baseFactor = 0.3;
                const smoothFactor = Math.min(0.6, baseFactor + curvature * 2);
                
                const current = this.vertices[vIdx];
                
                newPositions.set(vIdx, {
                    x: current.x + (avgX - current.x) * smoothFactor,
                    y: current.y + (avgY - current.y) * smoothFactor,
                    z: current.z + (avgZ - current.z) * smoothFactor
                });
            }
            
            // 应用新位置
            for (const [vIdx, pos] of newPositions) {
                this.vertices[vIdx].x = pos.x;
                this.vertices[vIdx].y = pos.y;
                this.vertices[vIdx].z = pos.z;
            }
        }
        
        // 平滑后需要重新计算边长
        this.edges = this.buildEdges();
        
        console.log(`  边界平滑完成: ${boundaryArray.length} 个边界顶点, ${iterations} 轮迭代`);
    }
    
    /**
     * 初始化UV - 使用Tutte嵌入或PCA投影
     */
    initializeUV() {
        // 方法1: PCA投影 (快速，适合大多数形状)
        const centroid = { x: 0, y: 0, z: 0 };
        for (const v of this.vertices) {
            centroid.x += v.x;
            centroid.y += v.y;
            centroid.z += v.z;
        }
        centroid.x /= this.vertices.length;
        centroid.y /= this.vertices.length;
        centroid.z /= this.vertices.length;
        
        // 计算协方差矩阵
        let cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (const v of this.vertices) {
            const dx = v.x - centroid.x;
            const dy = v.y - centroid.y;
            const dz = v.z - centroid.z;
            cov[0][0] += dx * dx;
            cov[0][1] += dx * dy;
            cov[0][2] += dx * dz;
            cov[1][1] += dy * dy;
            cov[1][2] += dy * dz;
            cov[2][2] += dz * dz;
        }
        cov[1][0] = cov[0][1];
        cov[2][0] = cov[0][2];
        cov[2][1] = cov[1][2];
        
        // 简化的主成分分析：使用最大方差方向
        const { axis1, axis2 } = this.computePrincipalAxes(cov);
        
        // 投影到2D
        this.uvs = this.vertices.map(v => {
            const dx = v.x - centroid.x;
            const dy = v.y - centroid.y;
            const dz = v.z - centroid.z;
            
            const u = dx * axis1.x + dy * axis1.y + dz * axis1.z;
            const vv = dx * axis2.x + dy * axis2.y + dz * axis2.z;
            
            return { u, v: vv };
        });
    }
    
    /**
     * 计算主轴
     */
    computePrincipalAxes(cov) {
        // 简化的特征值分解 - 使用幂迭代法
        let v1 = { x: 1, y: 0, z: 0 };
        
        // 幂迭代找最大特征向量
        for (let i = 0; i < 20; i++) {
            const newV = {
                x: cov[0][0] * v1.x + cov[0][1] * v1.y + cov[0][2] * v1.z,
                y: cov[1][0] * v1.x + cov[1][1] * v1.y + cov[1][2] * v1.z,
                z: cov[2][0] * v1.x + cov[2][1] * v1.y + cov[2][2] * v1.z
            };
            const len = Math.sqrt(newV.x * newV.x + newV.y * newV.y + newV.z * newV.z);
            if (len > 0) {
                v1 = { x: newV.x / len, y: newV.y / len, z: newV.z / len };
            }
        }
        
        // 第二主轴：正交化
        let v2 = { x: 0, y: 1, z: 0 };
        const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
        v2 = {
            x: v2.x - dot * v1.x,
            y: v2.y - dot * v1.y,
            z: v2.z - dot * v1.z
        };
        const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
        if (len2 > 0.001) {
            v2 = { x: v2.x / len2, y: v2.y / len2, z: v2.z / len2 };
        } else {
            // 如果y轴平行于v1，用z轴
            v2 = { x: 0, y: 0, z: 1 };
            const dot2 = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
            v2 = {
                x: v2.x - dot2 * v1.x,
                y: v2.y - dot2 * v1.y,
                z: v2.z - dot2 * v1.z
            };
            const len3 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
            if (len3 > 0) {
                v2 = { x: v2.x / len3, y: v2.y / len3, z: v2.z / len3 };
            }
        }
        
        return { axis1: v1, axis2: v2 };
    }
    
    /**
     * ARAP迭代 - Local-Global方法
     */
    arapIteration() {
        // Local step: 为每个面计算最优旋转矩阵
        const rotations = this.computeLocalRotations();
        
        // Global step: 固定旋转，优化顶点位置
        this.optimizePositions(rotations);
    }
    
    /**
     * Local step: 计算每个面的最优旋转
     */
    computeLocalRotations() {
        const rotations = [];
        
        for (const face of this.faces) {
            // 获取3D和2D三角形
            const p3d = face.map(vi => this.vertices[vi]);
            const p2d = face.map(vi => this.uvs[vi]);
            
            // 计算3D边向量
            const e3d = [
                { x: p3d[1].x - p3d[0].x, y: p3d[1].y - p3d[0].y, z: p3d[1].z - p3d[0].z },
                { x: p3d[2].x - p3d[0].x, y: p3d[2].y - p3d[0].y, z: p3d[2].z - p3d[0].z }
            ];
            
            // 计算2D边向量
            const e2d = [
                { u: p2d[1].u - p2d[0].u, v: p2d[1].v - p2d[0].v },
                { u: p2d[2].u - p2d[0].u, v: p2d[2].v - p2d[0].v }
            ];
            
            // 计算最优旋转 (使用极分解)
            const R = this.computeOptimalRotation(e3d, e2d);
            rotations.push(R);
        }
        
        return rotations;
    }
    
    /**
     * 计算最优旋转矩阵
     */
    computeOptimalRotation(e3d, e2d) {
        // 将3D边投影到面的局部坐标系
        // 简化：直接使用3D边长来缩放2D
        const len3d_0 = Math.sqrt(e3d[0].x ** 2 + e3d[0].y ** 2 + e3d[0].z ** 2);
        const len3d_1 = Math.sqrt(e3d[1].x ** 2 + e3d[1].y ** 2 + e3d[1].z ** 2);
        const len2d_0 = Math.sqrt(e2d[0].u ** 2 + e2d[0].v ** 2);
        const len2d_1 = Math.sqrt(e2d[1].u ** 2 + e2d[1].v ** 2);
        
        // 计算旋转角度
        const angle3d = Math.atan2(
            e3d[0].x * e3d[1].y - e3d[0].y * e3d[1].x,
            e3d[0].x * e3d[1].x + e3d[0].y * e3d[1].y
        );
        const angle2d = Math.atan2(
            e2d[0].u * e2d[1].v - e2d[0].v * e2d[1].u,
            e2d[0].u * e2d[1].u + e2d[0].v * e2d[1].v
        );
        
        const theta = angle3d - angle2d;
        
        return {
            cos: Math.cos(theta),
            sin: Math.sin(theta),
            scale: (len3d_0 + len3d_1) / Math.max(len2d_0 + len2d_1, 0.0001)
        };
    }
    
    /**
     * Global step: 优化顶点位置
     */
    optimizePositions(rotations) {
        const newUVs = this.uvs.map(uv => ({ u: 0, v: 0 }));
        const weights = new Array(this.vertices.length).fill(0);
        
        // 对每条边施加约束
        for (let faceIdx = 0; faceIdx < this.faces.length; faceIdx++) {
            const face = this.faces[faceIdx];
            const R = rotations[faceIdx];
            
            for (let i = 0; i < face.length; i++) {
                const vi = face[i];
                const vj = face[(i + 1) % face.length];
                
                // 3D边向量
                const e3d = {
                    x: this.vertices[vj].x - this.vertices[vi].x,
                    y: this.vertices[vj].y - this.vertices[vi].y,
                    z: this.vertices[vj].z - this.vertices[vi].z
                };
                const len3d = Math.sqrt(e3d.x ** 2 + e3d.y ** 2 + e3d.z ** 2);
                
                // 当前2D边向量
                const e2d = {
                    u: this.uvs[vj].u - this.uvs[vi].u,
                    v: this.uvs[vj].v - this.uvs[vi].v
                };
                const len2d = Math.sqrt(e2d.u ** 2 + e2d.v ** 2);

                const edgeKey = vi < vj ? `${vi}_${vj}` : `${vj}_${vi}`;
                const isBoundaryEdge = this.boundaryConstraints && this.boundaryEdges.has(edgeKey);
                const weight = isBoundaryEdge ? 3 : 1;
                
                // 目标：让2D边长等于3D边长
                if (len2d > 0.0001) {
                    const scale = len3d / len2d;
                    const targetU = this.uvs[vi].u + e2d.u * scale;
                    const targetV = this.uvs[vi].v + e2d.v * scale;
                    
                    newUVs[vj].u += targetU * weight;
                    newUVs[vj].v += targetV * weight;
                    weights[vj] += weight;
                }
            }
        }
        
        // 更新UV位置（加权平均）
        for (let i = 0; i < this.vertices.length; i++) {
            if (weights[i] > 0) {
                this.uvs[i].u = newUVs[i].u / weights[i];
                this.uvs[i].v = newUVs[i].v / weights[i];
            }
        }
    }
    
    /**
     * 归一化UV到[0,1]范围
     */
    normalizeUV() {
        if (this.uvs.length === 0) return;
        
        let minU = Infinity, maxU = -Infinity;
        let minV = Infinity, maxV = -Infinity;
        
        for (const uv of this.uvs) {
            minU = Math.min(minU, uv.u);
            maxU = Math.max(maxU, uv.u);
            minV = Math.min(minV, uv.v);
            maxV = Math.max(maxV, uv.v);
        }
        
        const rangeU = maxU - minU || 1;
        const rangeV = maxV - minV || 1;
        const scale = Math.max(rangeU, rangeV);
        
        for (const uv of this.uvs) {
            uv.u = (uv.u - minU) / scale;
            uv.v = (uv.v - minV) / scale;
        }
    }
    
    /**
     * 3D距离
     */
    distance3D(v1, v2) {
        const dx = v2.x - v1.x;
        const dy = v2.y - v1.y;
        const dz = v2.z - v1.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * 收集边界边/顶点
     */
    collectBoundaryInfo() {
        this.boundaryEdges = new Set();
        this.boundaryVertices = new Set();

        const edgeCount = new Map();
        this.faces.forEach(face => {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
            }
        });

        for (const [key, count] of edgeCount) {
            if (count === 1) {
                this.boundaryEdges.add(key);
                const [v1, v2] = key.split('_').map(Number);
                this.boundaryVertices.add(v1);
                this.boundaryVertices.add(v2);
            }
        }
    }
}

