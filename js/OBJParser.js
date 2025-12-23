/**
 * OBJ文件解析器
 * 解析OBJ格式的3D模型文件
 * 支持带顶点颜色的OBJ格式：v x y z r g b
 */

export class OBJParser {
    constructor() {
        this.vertices = [];
        this.vertexColors = [];  // 顶点颜色数组
        this.normals = [];
        this.uvs = [];
        this.faces = [];
        this.edges = new Map();
        this.hasVertexColors = false;  // 标记是否有顶点颜色
    }
    
    /**
     * 解析OBJ文件内容
     * @param {string} text - OBJ文件文本内容
     * @returns {Object} 解析后的网格数据
     */
    parse(text) {
        this.vertices = [];
        this.vertexColors = [];
        this.normals = [];
        this.uvs = [];
        this.faces = [];
        this.edges = new Map();
        this.hasVertexColors = false;
        
        const lines = text.split('\n');
        
        for (let line of lines) {
            line = line.trim();
            if (line === '' || line.startsWith('#')) continue;
            
            const parts = line.split(/\s+/);
            const type = parts[0];
            
            switch (type) {
                case 'v':
                    this.parseVertex(parts);
                    break;
                case 'vn':
                    this.parseNormal(parts);
                    break;
                case 'vt':
                    this.parseUV(parts);
                    break;
                case 'f':
                    this.parseFace(parts);
                    break;
            }
        }
        
        // 构建边数据
        this.buildEdges();
        
        // 计算邻接关系
        const adjacency = this.buildAdjacency();
        
        return {
            vertices: this.vertices,
            vertexColors: this.vertexColors,
            hasVertexColors: this.hasVertexColors,
            normals: this.normals,
            uvs: this.uvs,
            faces: this.faces,
            edges: Array.from(this.edges.values()),
            adjacency: adjacency
        };
    }
    
    /**
     * 解析顶点行
     * 支持格式: v x y z 或 v x y z r g b
     */
    parseVertex(parts) {
        const vertex = {
            x: parseFloat(parts[1]) || 0,
            y: parseFloat(parts[2]) || 0,
            z: parseFloat(parts[3]) || 0
        };
        this.vertices.push(vertex);
        
        // 检查是否有顶点颜色 (格式: v x y z r g b)
        if (parts.length >= 7) {
            const r = parseFloat(parts[4]) || 0;
            const g = parseFloat(parts[5]) || 0;
            const b = parseFloat(parts[6]) || 0;
            this.vertexColors.push({ r, g, b });
            this.hasVertexColors = true;
        } else {
            // 默认白色
            this.vertexColors.push({ r: 1, g: 1, b: 1 });
        }
    }
    
    /**
     * 解析法线行
     */
    parseNormal(parts) {
        this.normals.push({
            x: parseFloat(parts[1]) || 0,
            y: parseFloat(parts[2]) || 0,
            z: parseFloat(parts[3]) || 0
        });
    }
    
    /**
     * 解析UV坐标行
     */
    parseUV(parts) {
        this.uvs.push({
            u: parseFloat(parts[1]) || 0,
            v: parseFloat(parts[2]) || 0
        });
    }
    
    /**
     * 解析面行
     */
    parseFace(parts) {
        const face = [];
        const faceNormals = [];
        const faceUVs = [];
        
        for (let i = 1; i < parts.length; i++) {
            const indices = parts[i].split('/');
            
            // 顶点索引（OBJ索引从1开始）
            const vertexIndex = parseInt(indices[0]) - 1;
            face.push(vertexIndex);
            
            // UV索引
            if (indices.length > 1 && indices[1]) {
                faceUVs.push(parseInt(indices[1]) - 1);
            }
            
            // 法线索引
            if (indices.length > 2 && indices[2]) {
                faceNormals.push(parseInt(indices[2]) - 1);
            }
        }
        
        this.faces.push(face);
    }
    
    /**
     * 构建边数据
     */
    buildEdges() {
        this.edges.clear();
        
        this.faces.forEach((face, faceIndex) => {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                
                // 使用排序后的索引作为边的唯一标识
                const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                
                if (!this.edges.has(edgeKey)) {
                    this.edges.set(edgeKey, {
                        vertices: [v1, v2],
                        faces: [faceIndex],
                        key: edgeKey
                    });
                } else {
                    this.edges.get(edgeKey).faces.push(faceIndex);
                }
            }
        });
    }
    
    /**
     * 构建邻接关系
     */
    buildAdjacency() {
        const adjacency = {
            vertexToFaces: new Map(),
            vertexToVertices: new Map(),
            faceToFaces: new Map()
        };
        
        // 顶点到面的映射
        this.faces.forEach((face, faceIndex) => {
            face.forEach(vertexIndex => {
                if (!adjacency.vertexToFaces.has(vertexIndex)) {
                    adjacency.vertexToFaces.set(vertexIndex, []);
                }
                adjacency.vertexToFaces.get(vertexIndex).push(faceIndex);
            });
        });
        
        // 顶点到顶点的映射（邻居）
        this.faces.forEach(face => {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                
                if (!adjacency.vertexToVertices.has(v1)) {
                    adjacency.vertexToVertices.set(v1, new Set());
                }
                if (!adjacency.vertexToVertices.has(v2)) {
                    adjacency.vertexToVertices.set(v2, new Set());
                }
                
                adjacency.vertexToVertices.get(v1).add(v2);
                adjacency.vertexToVertices.get(v2).add(v1);
            }
        });
        
        // 面到面的映射（通过共享边）
        this.edges.forEach(edge => {
            if (edge.faces.length === 2) {
                const f1 = edge.faces[0];
                const f2 = edge.faces[1];
                
                if (!adjacency.faceToFaces.has(f1)) {
                    adjacency.faceToFaces.set(f1, new Set());
                }
                if (!adjacency.faceToFaces.has(f2)) {
                    adjacency.faceToFaces.set(f2, new Set());
                }
                
                adjacency.faceToFaces.get(f1).add(f2);
                adjacency.faceToFaces.get(f2).add(f1);
            }
        });
        
        return adjacency;
    }
    
    /**
     * 计算边的长度
     */
    calculateEdgeLength(v1Index, v2Index) {
        const v1 = this.vertices[v1Index];
        const v2 = this.vertices[v2Index];
        
        const dx = v2.x - v1.x;
        const dy = v2.y - v1.y;
        const dz = v2.z - v1.z;
        
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    
    /**
     * 计算三角形面积
     */
    calculateTriangleArea(face) {
        if (face.length < 3) return 0;
        
        const v0 = this.vertices[face[0]];
        const v1 = this.vertices[face[1]];
        const v2 = this.vertices[face[2]];
        
        // 使用叉积计算面积
        const ax = v1.x - v0.x;
        const ay = v1.y - v0.y;
        const az = v1.z - v0.z;
        
        const bx = v2.x - v0.x;
        const by = v2.y - v0.y;
        const bz = v2.z - v0.z;
        
        const cx = ay * bz - az * by;
        const cy = az * bx - ax * bz;
        const cz = ax * by - ay * bx;
        
        return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    }
    
    /**
     * 获取边界边（只属于一个面的边）
     */
    getBoundaryEdges() {
        const boundaryEdges = [];
        
        this.edges.forEach(edge => {
            if (edge.faces.length === 1) {
                boundaryEdges.push(edge);
            }
        });
        
        return boundaryEdges;
    }
}

