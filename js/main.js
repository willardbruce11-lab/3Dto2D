/**
 * 3D Cloth Flattener - Main Application
 * Web-based 3D editor for flattening cloth meshes with seam data
 */

console.log('main.js 开始加载...');

import * as THREE from 'three';
console.log('Three.js 加载成功');

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
console.log('Three.js 插件加载成功');

import { OBJParser } from './OBJParser.js';
import { SeamProcessor } from './SeamProcessor.js';
import { MeshFlattener } from './MeshFlattener.js';
import { BFFFlattener } from './BFFFlattener.js';
import { LSCMFlattener } from './LSCMFlattener.js';
import { SeamExtractor } from './SeamExtractor.js';
import { MeshScissor } from './MeshScissor.js';
import { ARAPFlattener } from './ARAPFlattener.js';
import { TopologyRepair } from './TopologyRepair.js';
import { FloodSegmenter } from './FloodSegmenter.js';  // 泛洪分割模块
import { Renderer2D } from './Renderer2D.js';
import { TubeUnroller, tubeUnroller } from './TubeUnroller.js';  // 滚筒展开模块
import { PhysicsFlattener, physicsFlattener } from './PhysicsFlattener.js';  // 物理弹簧松弛模块
import { BFSUnfolder, bfsUnfolder } from './BFSUnfolder.js';  // BFS辐射展开模块
console.log('本地模块加载成功 (含 V9.0 新模块: BFS辐射展开 + 两阶段物理烫平)');

class ClothFlattenerApp {
    constructor() {
        // 场景元素
        this.scene3D = null;
        this.camera3D = null;
        this.renderer3D = null;
        this.controls3D = null;
        
        // 2D渲染器
        this.renderer2D = null;
        
        // 展开器
        this.bffFlattener = null;
        this.lscmFlattener = null;
        this.arapFlattener = null;  // ARAP展开器
        
        // 缝线提取器和网格切割器
        this.seamExtractor = null;
        this.meshScissor = null;  // 物理切割模块
        
        // 切割后的数据
        this.cutMeshData = null;
        this.subMeshes = [];  // 切割后的独立子网格
        
        // V5.0 流程状态
        this.segmentedParts = [];     // 分割后的部件
        this.segmentMeshes3D = [];    // 3D可视化的彩色部件网格
        this.weldedMesh = null;       // 焊接后的网格
        this.redVerticesSet = null;   // 红点集合
        this.barrierEdges = null;     // 泛洪围墙边
        this.pipelineStage = 0;       // 当前流程阶段: 0=未开始, 1=已分割, 2=已展开
        
        // 模型数据
        this.mesh3D = null;
        this.meshData = null;
        this.seamData = null;
        this.flattenedData = null;
        this.redVertices = [];  // 红色顶点
        
        // 辅助对象
        this.seamLines = [];
        this.redVertexMarkers = [];  // 红色顶点标记
        this.highlightMesh = null;   // UV岛高亮网格
        this.segmentMeshes = [];     // 分割可视化网格
        this.gridHelper = null;
        this.axesHelper = null;
        
        // 设置
        this.settings = {
            showWireframe: true,
            showSeams: true,
            showRedVertices: true,  // 显示红色顶点
            seamColor: '#ff3366',
            showGrid: true,
            flattenMethod: 'lscm', // 默认使用LSCM算法
            autoExtractSeams: true,  // 自动从红色顶点提取缝线
            iterations: 50,  // ARAP迭代次数（增加到50以获得更好效果）
            preserveRatio: true
        };
        
        // 初始化（使用Promise处理异步）
        this.init().catch(err => {
            console.error('初始化失败:', err);
        });
    }
    
    async init() {
        console.log('=== init 开始 ===');
        try {
            // 先初始化3D场景（同步操作）
            console.log('调用 setup3DScene...');
            this.setup3DScene();
            console.log('setup3DScene 完成, scene3D:', this.scene3D);
            
            console.log('调用 setup2DScene...');
            this.setup2DScene();
            console.log('setup2DScene 完成');
            
            console.log('调用 setupEventListeners...');
            this.setupEventListeners();
            console.log('setupEventListeners 完成');
            
            console.log('启动动画循环...');
            this.animate();
            console.log('动画循环已启动');
            
            // 初始化展开器和切割器
            console.log('初始化展开器...');
            this.bffFlattener = new BFFFlattener();
            this.lscmFlattener = new LSCMFlattener();
            this.arapFlattener = new ARAPFlattener();  // ARAP展开器
            this.seamExtractor = new SeamExtractor();
            this.meshScissor = new MeshScissor();  // 物理切割模块
            
            await this.bffFlattener.init();
            console.log('展开器初始化完成');
            
            this.updateStatus('就绪 - 加载带红色标记的OBJ模型，按红线物理切割并展开');
            console.log('=== 应用初始化完成 ===');
        } catch (err) {
            console.error('初始化错误:', err);
            console.error('错误堆栈:', err.stack);
            this.updateStatus('初始化完成（部分模块加载失败，使用备选算法）');
        }
    }
    
    /**
     * 设置3D场景
     */
    setup3DScene() {
        const container = document.getElementById('canvas-3d');
        console.log('3D容器:', container);
        const rect = container.getBoundingClientRect();
        console.log('3D容器尺寸:', rect.width, 'x', rect.height);
        
        // 场景
        this.scene3D = new THREE.Scene();
        this.scene3D.background = new THREE.Color(0x0a0e14);
        
        // 相机
        this.camera3D = new THREE.PerspectiveCamera(
            45,
            rect.width / rect.height,
            0.1,
            1000
        );
        this.camera3D.position.set(5, 5, 5);
        
        // 渲染器
        this.renderer3D = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });
        this.renderer3D.setSize(rect.width, rect.height);
        this.renderer3D.setPixelRatio(window.devicePixelRatio);
        
        // 确保 canvas 可以接收鼠标事件
        this.renderer3D.domElement.style.pointerEvents = 'auto';
        this.renderer3D.domElement.style.touchAction = 'none';
        this.renderer3D.domElement.style.outline = 'none';
        this.renderer3D.domElement.tabIndex = 0;  // 使 canvas 可获得焦点
        
        container.appendChild(this.renderer3D.domElement);
        
        // 控制器 - 确保所有功能都启用
        this.controls3D = new OrbitControls(this.camera3D, this.renderer3D.domElement);
        this.controls3D.enableDamping = true;
        this.controls3D.dampingFactor = 0.05;
        this.controls3D.rotateSpeed = 0.8;
        this.controls3D.enableZoom = true;      // 确保缩放启用
        this.controls3D.enablePan = true;       // 确保平移启用
        this.controls3D.enableRotate = true;    // 确保旋转启用
        this.controls3D.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN
        };
        
        // 灯光
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene3D.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 7);
        this.scene3D.add(directionalLight);
        
        const backLight = new THREE.DirectionalLight(0x4488ff, 0.3);
        backLight.position.set(-5, -5, -5);
        this.scene3D.add(backLight);
        
        // 网格
        this.gridHelper = new THREE.GridHelper(20, 40, 0x1a2233, 0x101620);
        this.scene3D.add(this.gridHelper);
        
        // 坐标轴
        this.axesHelper = new THREE.AxesHelper(2);
        this.scene3D.add(this.axesHelper);
        
        // 响应窗口大小变化
        window.addEventListener('resize', () => this.onWindowResize());
    }
    
    /**
     * 设置2D场景
     */
    setup2DScene() {
        const container = document.getElementById('canvas-2d');
        this.renderer2D = new Renderer2D(container);
        
        // 设置UV岛选中回调
        this.renderer2D.setIslandSelectedCallback((islandIndex) => {
            this.onIslandSelected(islandIndex);
        });
    }
    
    /**
     * UV岛被选中时的处理
     */
    onIslandSelected(islandIndex) {
        console.log(`选中UV岛: ${islandIndex}`);
        
        if (islandIndex < 0) {
            // 取消选择，恢复原始材质
            this.clearIslandHighlight();
            this.updateStatus('取消选择');
            return;
        }
        
        if (!this.flattenedData || !this.flattenedData.pieces) return;
        
        const piece = this.flattenedData.pieces[islandIndex];
        if (!piece) return;
        
        // 高亮3D视图中对应的面
        this.highlightIslandIn3D(piece, islandIndex);
        
        // 更新状态
        const faceCount = piece.localFaces ? piece.localFaces.length : 0;
        const vertexCount = piece.localVertices ? piece.localVertices.length : 
                           (piece.vertexMap ? piece.vertexMap.size : 0);
        this.updateStatus(`选中UV岛 #${islandIndex + 1}: ${vertexCount} 顶点, ${faceCount} 面`);
    }
    
    /**
     * 在3D视图中高亮UV岛
     */
    highlightIslandIn3D(piece, islandIndex) {
        if (!this.mesh3D) return;
        
        // 清除之前的高亮
        this.clearIslandHighlight();
        
        // 获取该岛对应的全局面索引
        const globalFaces = piece.globalFaces || [];
        
        if (globalFaces.length === 0) return;
        
        // 创建高亮几何体
        const highlightGeometry = new THREE.BufferGeometry();
        const positions = [];
        const vertices = this.meshData.vertices;
        
        for (const faceIdx of globalFaces) {
            const face = this.meshData.faces[faceIdx];
            if (!face) continue;
            
            // 三角形
            if (face.length >= 3) {
                const v0 = vertices[face[0]];
                const v1 = vertices[face[1]];
                const v2 = vertices[face[2]];
                
                positions.push(v0.x, v0.y, v0.z);
                positions.push(v1.x, v1.y, v1.z);
                positions.push(v2.x, v2.y, v2.z);
            }
            
            // 四边形的第二个三角形
            if (face.length >= 4) {
                const v0 = vertices[face[0]];
                const v2 = vertices[face[2]];
                const v3 = vertices[face[3]];
                
                positions.push(v0.x, v0.y, v0.z);
                positions.push(v2.x, v2.y, v2.z);
                positions.push(v3.x, v3.y, v3.z);
            }
        }
        
        highlightGeometry.setAttribute('position', 
            new THREE.Float32BufferAttribute(positions, 3));
        highlightGeometry.computeVertexNormals();
        
        // 高亮材质
        const hue = (islandIndex * 37) % 360;
        const highlightMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(`hsl(${hue}, 90%, 60%)`),
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.6,
            depthTest: true, // 开启深度测试
            polygonOffset: true, // 开启多边形偏移，解决 Z-fighting
            polygonOffsetFactor: -1.0, // 偏移量，使其在原始模型之上
            polygonOffsetUnits: -1.0
        });
        
        this.highlightMesh = new THREE.Mesh(highlightGeometry, highlightMaterial);
        this.highlightMesh.renderOrder = 999;
        this.mesh3D.add(this.highlightMesh);
        
        console.log(`高亮了 ${globalFaces.length} 个面`);
    }
    
    /**
     * 清除UV岛高亮
     */
    clearIslandHighlight() {
        if (this.highlightMesh) {
            if (this.highlightMesh.parent) {
                this.highlightMesh.parent.remove(this.highlightMesh);
            }
            if (this.highlightMesh.geometry) {
                this.highlightMesh.geometry.dispose();
            }
            if (this.highlightMesh.material) {
                this.highlightMesh.material.dispose();
            }
            this.highlightMesh = null;
        }
    }
    
    /**
     * 设置事件监听
     */
    setupEventListeners() {
        // 注意：文件加载按钮的点击事件由 index.html 中的脚本处理
        // 这里不再重复绑定，避免双击问题
        console.log('setupEventListeners: 文件按钮由 index.html 处理，此处跳过');
        
        // 文件输入元素的 change 事件作为备用（如果 index.html 没处理）
        const objInput = document.getElementById('obj-input');
        const jsonInput = document.getElementById('json-input');
        
        // 只在没有绑定过的情况下绑定（检查自定义属性）
        if (objInput && !objInput._mainJsBound) {
            objInput._mainJsBound = true;
            objInput.addEventListener('change', (e) => {
                console.log('main.js: OBJ文件选择:', e.target.files);
                if (e.target.files && e.target.files[0]) {
                    this.loadOBJFile(e.target.files[0]);
                }
                e.target.value = '';
            });
        }
        
        if (jsonInput && !jsonInput._mainJsBound) {
            jsonInput._mainJsBound = true;
            jsonInput.addEventListener('change', (e) => {
                console.log('main.js: JSON文件选择:', e.target.files);
                if (e.target.files && e.target.files[0]) {
                    this.loadSeamJSON(e.target.files[0]);
                }
                e.target.value = '';
            });
        }
        
        // 操作按钮
        document.getElementById('segment-btn').addEventListener('click', () => {
            this.segmentParts();
        });
        
        document.getElementById('flatten-btn').addEventListener('click', () => {
            this.flattenMesh();
        });
        
        document.getElementById('reset-btn').addEventListener('click', () => {
            this.resetScene();
        });
        
        // 视图控制
        document.querySelectorAll('.view-btn[data-view]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setViewAngle(e.target.dataset.view);
                document.querySelectorAll('.view-btn[data-view]').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
            });
        });
        
        // 设置面板
        document.getElementById('show-wireframe').addEventListener('change', (e) => {
            this.settings.showWireframe = e.target.checked;
            this.updateMeshDisplay();
        });
        
        document.getElementById('show-seams').addEventListener('change', (e) => {
            this.settings.showSeams = e.target.checked;
            this.updateSeamDisplay();
        });
        
        document.getElementById('seam-color').addEventListener('input', (e) => {
            this.settings.seamColor = e.target.value;
            this.updateSeamColors();
        });
        
        document.getElementById('show-grid').addEventListener('change', (e) => {
            this.settings.showGrid = e.target.checked;
            if (this.gridHelper) {
                this.gridHelper.visible = e.target.checked;
            }
        });
        
        document.getElementById('flatten-method').addEventListener('change', (e) => {
            this.settings.flattenMethod = e.target.value;
        });
        
        document.getElementById('iterations').addEventListener('input', (e) => {
            this.settings.iterations = parseInt(e.target.value);
            document.getElementById('iterations-value').textContent = e.target.value;
        });
        
        document.getElementById('preserve-ratio').addEventListener('change', (e) => {
            this.settings.preserveRatio = e.target.checked;
        });
        
        // 2D视图控制
        document.getElementById('fit-view-btn').addEventListener('click', () => {
            if (this.renderer2D) {
                this.renderer2D.fitToView();
            }
        });
        
        document.getElementById('export-svg-btn').addEventListener('click', () => {
            this.exportSVG();
        });
        
        // 面板折叠
        document.getElementById('panel-toggle').addEventListener('click', () => {
            document.getElementById('side-panel').classList.toggle('collapsed');
        });
    }
    
    /**
     * 加载OBJ文件
     */
    async loadOBJFile(file) {
        console.log('=== loadOBJFile 开始 ===');
        console.log('文件信息:', file ? file.name : 'null');
        console.log('this.scene3D:', this.scene3D);
        console.log('this.renderer3D:', this.renderer3D);
        
        if (!file) {
            console.log('文件为空，返回');
            return;
        }
        
        if (!this.scene3D) {
            console.error('scene3D 未初始化！');
            this.updateStatus('错误: 3D场景未初始化');
            return;
        }
        
        this.showLoading('加载模型中...');
        
        try {
            console.log('开始读取文件内容...');
            const text = await file.text();
            console.log('文件内容长度:', text.length);
            console.log('文件前100字符:', text.substring(0, 100));
            
            const parser = new OBJParser();
            this.meshData = parser.parse(text);
            console.log('解析结果:', this.meshData.vertices.length, '顶点,', this.meshData.faces.length, '面');
            
            // 创建Three.js几何体
            console.log('创建几何体...');
            const geometry = this.createGeometryFromMeshData(this.meshData);
            console.log('几何体创建完成，顶点数:', geometry.attributes.position.count);
            
            // 移除旧模型
            if (this.mesh3D) {
                console.log('移除旧模型');
                this.scene3D.remove(this.mesh3D);
                this.mesh3D.geometry.dispose();
                this.mesh3D.material.dispose();
            }
            
            // 创建材质
            console.log('创建材质...');
            const material = new THREE.MeshPhongMaterial({
                color: 0x00d4ff,
                side: THREE.DoubleSide,
                flatShading: false,
                wireframe: false,
                transparent: true,
                opacity: 0.9
            });
            
            // 创建网格
            console.log('创建网格并添加到场景...');
            this.mesh3D = new THREE.Mesh(geometry, material);
            this.scene3D.add(this.mesh3D);
            console.log('模型已添加到场景, scene3D children:', this.scene3D.children.length);
            
            // 添加线框
            if (this.settings.showWireframe) {
                const wireframeMaterial = new THREE.LineBasicMaterial({
                    color: 0x2a3548,
                    linewidth: 1
                });
                const wireframe = new THREE.WireframeGeometry(geometry);
                const wireframeMesh = new THREE.LineSegments(wireframe, wireframeMaterial);
                this.mesh3D.add(wireframeMesh);
            }
            
            // 居中并缩放模型
            console.log('居中和缩放模型...');
            this.centerAndScaleModel();
            
            // 强制渲染一帧
            console.log('强制渲染...');
            this.renderer3D.render(this.scene3D, this.camera3D);
            
            // 检测红色顶点（自动提取缝线并可视化）
            if (this.meshData.hasVertexColors && this.settings.autoExtractSeams) {
                console.log('检测到顶点颜色，开始提取红色顶点并连线...');
                await this.extractRedVerticesAndSeams();
                // 立即显示缝线
                this.settings.showSeams = true;
                this.updateSeamDisplay();
            }
            
            // 更新UI
            this.updateModelInfo();
            this.checkFlattenReady();
            
            let msg = `模型加载成功: ${this.meshData.vertices.length} 顶点, ${this.meshData.faces.length} 面`;
            if (this.redVertices.length > 0) {
                msg += ` | 检测到 ${this.redVertices.length} 个红色标记点`;
            }
            console.log('=== ' + msg + ' ===');
            this.updateStatus(msg);
            
        } catch (error) {
            console.error('加载OBJ失败:', error);
            console.error('错误堆栈:', error.stack);
            this.updateStatus('加载模型失败: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * 加载缝线JSON文件
     */
    async loadSeamJSON(file) {
        console.log('loadSeamJSON 被调用:', file);
        if (!file) {
            console.log('文件为空，返回');
            return;
        }
        
        this.showLoading('加载缝线数据...');
        
        try {
            console.log('开始读取JSON文件...');
            const text = await file.text();
            console.log('JSON内容长度:', text.length);
            this.seamData = JSON.parse(text);
            console.log('解析的缝线数据:', this.seamData);
            
            // 验证缝线数据
            const processor = new SeamProcessor();
            const validatedSeams = processor.validateSeams(this.seamData, this.meshData);
            
            // 更新缝线显示
            this.updateSeamDisplay();
            this.updateSeamList();
            
            // 更新UI
            document.getElementById('seams-count').textContent = `缝线: ${validatedSeams.length}`;
            this.checkFlattenReady();
            this.updateStatus(`缝线数据加载成功: ${validatedSeams.length} 条缝线`);
            
        } catch (error) {
            console.error('加载缝线JSON失败:', error);
            this.updateStatus('加载缝线数据失败: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * 从红色顶点提取缝线
     */
    async extractRedVerticesAndSeams() {
        if (!this.meshData) return;
        
        this.showLoading('提取红色标记点...');
        
        try {
            // 设置网格数据
            this.seamExtractor.setMesh(this.meshData);
            
            // 提取红色顶点
            this.redVertices = this.seamExtractor.extractRedVertices({
                redThreshold: 0.7,
                greenMaxThreshold: 0.4,
                blueMaxThreshold: 0.4
            });
            
            console.log(`提取到 ${this.redVertices.length} 个红色顶点`);
            
            if (this.redVertices.length > 0) {
                // 显示红色顶点标记
                this.displayRedVertices();
                
                // 连接红色顶点生成缝线（使用宽松的 eps）
                this.showLoading('连接缝线路径...');
                await this.seamExtractor.connectRedVertices({
                    onProgress: (progress) => this.showProgress(progress),
                    eps: 0.02  // 宽松的 epsilon，让更多点连在一起
                });
                
                // 获取缝线数据
                this.seamData = this.seamExtractor.getSeamData();
                console.log('生成的缝线数据:', this.seamData);
                
                // 更新缝线显示
                this.updateSeamDisplay();
                this.updateSeamList();
                
                // 更新UI
                document.getElementById('seams-count').textContent = 
                    `缝线: ${this.seamData.seams.length} | 红点: ${this.redVertices.length}`;
                
                this.updateStatus(`自动提取缝线完成: ${this.seamData.seams.length} 条缝线，${this.redVertices.length} 个标记点`);
            } else {
                this.updateStatus('未检测到红色标记点，请手动加载缝线JSON或使用带颜色标记的OBJ文件');
            }
            
        } catch (error) {
            console.error('提取红色顶点失败:', error);
            this.updateStatus('提取缝线失败: ' + error.message);
        } finally {
            this.hideLoading();
            this.hideProgress();
        }
    }
    
    /**
     * 显示红色顶点标记
     */
    displayRedVertices() {
        // 清除旧标记
        this.redVertexMarkers.forEach(marker => {
            if (marker.parent) {
                marker.parent.remove(marker);
            }
            if (marker.geometry) marker.geometry.dispose();
            if (marker.material) marker.material.dispose();
        });
        this.redVertexMarkers = [];
        
        // 显示红色标记球
        if (!this.settings.showRedVertices || !this.mesh3D) return; 
        
        const vertices = this.meshData.vertices;
        
        // 计算模型尺寸，自适应球体大小
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (const v of vertices) {
            minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
            minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
            minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
        }
        const modelSize = Math.sqrt((maxX-minX)**2 + (maxY-minY)**2 + (maxZ-minZ)**2);
        const sphereRadius = modelSize * 0.0015; // 模型大小的0.15% (更细的标记)
        
        const sphereGeometry = new THREE.SphereGeometry(sphereRadius, 4, 4);  // 减少细分以提高性能
        const sphereMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            depthTest: false,
            transparent: true,
            opacity: 0.7
        });
        
        for (const idx of this.redVertices) {
            const v = vertices[idx];
            const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
            sphere.position.set(v.x, v.y, v.z);
            sphere.renderOrder = 1000;
            this.mesh3D.add(sphere);
            this.redVertexMarkers.push(sphere);
        }
        
        console.log(`显示了 ${this.redVertexMarkers.length} 个红色顶点标记 (球半径: ${sphereRadius.toFixed(4)})`);
    }
    
    /**
     * 从网格数据创建Three.js几何体
     */
    createGeometryFromMeshData(meshData) {
        console.log('createGeometryFromMeshData 开始');
        console.log('顶点数:', meshData.vertices.length);
        console.log('面数:', meshData.faces.length);
        console.log('第一个顶点:', meshData.vertices[0]);
        console.log('第一个面:', meshData.faces[0]);
        
        const geometry = new THREE.BufferGeometry();
        
        const positions = [];
        const indices = [];
        
        // 添加顶点
        meshData.vertices.forEach(v => {
            positions.push(v.x, v.y, v.z);
        });
        console.log('positions 数组长度:', positions.length);
        
        // 添加面索引
        meshData.faces.forEach((face, i) => {
            if (i === 0) console.log('处理第一个面:', face, '类型:', typeof face, '是数组:', Array.isArray(face));
            if (Array.isArray(face)) {
                if (face.length >= 3) {
                    indices.push(face[0], face[1], face[2]);
                }
                if (face.length >= 4) {
                    // 四边形转为两个三角形
                    indices.push(face[0], face[2], face[3]);
                }
            }
        });
        console.log('indices 数组长度:', indices.length);
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        
        console.log('几何体创建完成');
        return geometry;
    }
    
    /**
     * 居中并缩放模型
     */
    centerAndScaleModel() {
        if (!this.mesh3D) return;
        
        const box = new THREE.Box3().setFromObject(this.mesh3D);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        // 居中
        this.mesh3D.position.sub(center);
        
        // 缩放到合适大小
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 4 / maxDim;
        this.mesh3D.scale.setScalar(scale);
        
        // 调整相机
        this.camera3D.position.set(5, 5, 5);
        this.camera3D.lookAt(0, 0, 0);
        this.controls3D.target.set(0, 0, 0);
    }
    
    /**
     * 更新缝线显示
     * 显示红点之间的真实网格边 + 路径连接线
     */
    updateSeamDisplay() {
        // 移除旧缝线
        this.seamLines.forEach(obj => {
            if (obj.parent) {
                obj.parent.remove(obj);
            } else {
                this.scene3D.remove(obj);
            }
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });
        this.seamLines = [];
        
        if (!this.settings.showSeams || !this.meshData) return;
        
        const seamColor = new THREE.Color(this.settings.seamColor);
        
        // 获取缝线边集合（红点之间的真实网格边）
        const seamEdges = this.seamExtractor ? this.seamExtractor.getSeamEdgeSet() : new Set();
        
        // 获取路径数据（用于显示连接顺序）
        const seamData = this.seamExtractor ? this.seamExtractor.getSeamData() : null;
        
        const linePositions = [];
        
        // 方式1：显示网格边（实线）
        for (const edgeKey of seamEdges) {
            const [idx1, idx2] = edgeKey.split('_').map(Number);
            
            if (idx1 >= this.meshData.vertices.length || idx2 >= this.meshData.vertices.length) continue;
            
            const v1 = this.meshData.vertices[idx1];
            const v2 = this.meshData.vertices[idx2];
            
            if (!v1 || !v2) continue;
            
            linePositions.push(v1.x, v1.y, v1.z);
            linePositions.push(v2.x, v2.y, v2.z);
        }
        
        // 方式2：如果网格边太少，也显示路径连接（最近邻顺序）
        if (seamData && seamData.seams && linePositions.length < 10) {
            for (const seam of seamData.seams) {
                if (!seam.vertices || seam.vertices.length < 2) continue;
                
                for (let i = 0; i < seam.vertices.length - 1; i++) {
                    const idx1 = seam.vertices[i];
                    const idx2 = seam.vertices[i + 1];
                    
                    if (idx1 >= this.meshData.vertices.length || idx2 >= this.meshData.vertices.length) continue;
                    
                    const v1 = this.meshData.vertices[idx1];
                    const v2 = this.meshData.vertices[idx2];
                    
                    if (!v1 || !v2) continue;
                    
                    linePositions.push(v1.x, v1.y, v1.z);
                    linePositions.push(v2.x, v2.y, v2.z);
                }
            }
        }

        if (linePositions.length > 0) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
            
            const material = new THREE.LineBasicMaterial({
                color: seamColor,
                linewidth: 1,  // 细线
                depthTest: true,
                transparent: true,
                opacity: 0.8
            });
            
            const lineSegments = new THREE.LineSegments(geometry, material);
            lineSegments.renderOrder = 100;
            
            if (this.mesh3D) {
                this.mesh3D.add(lineSegments);
            } else {
                this.scene3D.add(lineSegments);
            }
            this.seamLines.push(lineSegments);
            
            console.log(`显示 ${linePositions.length / 6} 条缝线段`);
        } else {
            console.log('没有缝线可显示');
        }
    }
    
    /**
     * 更新缝线颜色
     */
    updateSeamColors() {
        const color = new THREE.Color(this.settings.seamColor);
        this.seamLines.forEach(line => {
            line.material.color = color;
        });
        
        if (this.renderer2D && this.flattenedData) {
            this.renderer2D.setSeamColor(this.settings.seamColor);
            this.renderer2D.render(this.flattenedData, this.seamData);
        }
    }
    
    /**
     * 更新缝线列表UI
     */
    updateSeamList() {
        const listContainer = document.getElementById('seam-list');
        
        if (!this.seamData) {
            listContainer.innerHTML = '<div class="empty-state">加载模型后显示缝线</div>';
            return;
        }
        
        // 获取缝线数组（兼容多种格式）
        let seams = this.seamData.seams || this.seamData.cuts || this.seamData;
        if (!Array.isArray(seams)) {
            seams = [seams];
        }
        
        if (seams.length === 0) {
            listContainer.innerHTML = '<div class="empty-state">无缝线数据</div>';
            return;
        }
        
        listContainer.innerHTML = seams.map((seam, index) => {
            const name = seam.name || `缝线 ${index + 1}`;
            const edges = seam.edges || seam.vertices || [];
            return `
                <div class="seam-item" data-index="${index}">
                    <span class="seam-color" style="background: ${this.settings.seamColor}"></span>
                    <span class="seam-name">${name}</span>
                    <span class="seam-edges">${edges.length} 边</span>
                </div>
            `;
        }).join('');
        
        // 添加点击事件
        listContainer.querySelectorAll('.seam-item').forEach(item => {
            item.addEventListener('click', () => {
                listContainer.querySelectorAll('.seam-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                this.highlightSeam(parseInt(item.dataset.index));
            });
        });
    }
    
    /**
     * 高亮显示指定缝线
     */
    highlightSeam(index) {
        this.seamLines.forEach((line, i) => {
            if (i === index) {
                line.material.color = new THREE.Color(0xffff00);
                line.material.linewidth = 5;
            } else {
                line.material.color = new THREE.Color(this.settings.seamColor);
                line.material.linewidth = 3;
            }
        });
    }
    
    // ================================================
    // V5.0 三阶段流水线
    // ================================================
    
    /**
     * 【阶段一】部件分割 - 面片泛洪 + 可视化
     * 将模型按红线分割成大块（前片、后片、袖子等）
     */
    async segmentParts() {
        if (!this.meshData) {
            this.updateStatus('请先加载模型');
            return;
        }
        
        if (!this.meshData.vertexColors || this.meshData.vertexColors.length === 0) {
            this.updateStatus('错误：没有找到顶点颜色数据');
            return;
        }
        
        this.showLoading('阶段一：部件分割...');
        this.showProgress(0);
        
        try {
            const startTime = Date.now();
            
            console.log('================================================');
            console.log('=== V5.0 阶段一：部件分割与可视化 ===');
            console.log('================================================');
            
            // Step 1: 焊接顶点
            this.updateStatus('步骤1: 焊接顶点...');
            this.showProgress(5);
            
            let mesh = {
                vertices: this.meshData.vertices,
                faces: this.meshData.faces
            };
            
            const originalColors = this.meshData.vertexColors || [];
            console.log(`原始模型: ${mesh.vertices.length} 顶点, ${mesh.faces.length} 面`);
            
            let vertexMap = null;
            const mergedResult = MeshScissor.mergeVertices(mesh, 1e-5);
            
            if (mergedResult.mergedCount > 0) {
                console.log(`✅ 焊接了 ${mergedResult.mergedCount} 个重复顶点`);
                mesh = {
                    vertices: mergedResult.vertices,
                    faces: mergedResult.faces
                };
                vertexMap = mergedResult.vertexMap;
            }
            
            // 重新映射颜色
            const newColors = this.remapColorsToWeldedMesh(originalColors, vertexMap, mesh.vertices.length);
            mesh.vertexColors = newColors;
            mesh.hasVertexColors = true;
            mesh.adjacency = this.buildAdjacency(mesh.faces, mesh.vertices.length);
            
            this.weldedMesh = mesh;  // 保存焊接后的网格
            this.showProgress(15);
            
            // Step 2: 提取红色顶点 + 智能连线
            this.updateStatus('步骤2: 红线识别 (DBSCAN)...');
            console.log('=== 提取红色顶点并智能连线 ===');
            
            this.seamExtractor.setMesh(mesh);
            const redVertices = this.seamExtractor.extractRedVertices({
                redThreshold: 0.7,
                greenMaxThreshold: 0.4,
                blueMaxThreshold: 0.4
            });
            this.redVertices = redVertices;
            this.redVerticesSet = new Set(redVertices);
            
            console.log(`检测到 ${redVertices.length} 个红色顶点`);
            
            if (redVertices.length < 2) {
                this.updateStatus('警告：红色顶点太少，将整体展开');
            }

            await this.seamExtractor.connectRedVertices({
                onProgress: (p) => this.showProgress(15 + p * 0.2),
                eps: 0.02
            });

            this.seamData = this.seamExtractor.getSeamData();
            this.barrierEdges = this.seamExtractor.getSeamEdgeSet();
            this.updateSeamDisplay();
            this.updateSeamList();
            
            this.showProgress(40);
            
            // Step 3: 泛洪分割
            this.updateStatus('步骤3: 面片泛洪分割...');
            console.log('=== 面片泛洪分割 ===');

            const subMeshes = FloodSegmenter.segmentWithSeams(
                mesh,
                this.barrierEdges,
                {
                    minFaces: FloodSegmenter.MIN_FACES,
                    assignBoundaryFaces: true,
                    redVertices: this.redVerticesSet
                }
            );
            this.segmentedParts = subMeshes;
            console.log(`泛洪分割完成: ${subMeshes.length} 个部件`);
            this.showProgress(70);
            
            // Step 4: 可视化分割结果（彩色部件）
            this.updateStatus('步骤4: 部件可视化...');
            console.log('=== 部件可视化 ===');
            
            this.visualizeSegmentation(subMeshes);
            
            this.pipelineStage = 1;  // 标记为已分割
            this.showProgress(100);
            
            const elapsed = Date.now() - startTime;
            const msg = `✅ 部件分割完成: ${subMeshes.length} 个部件 (${elapsed}ms) - 点击"展开"继续`;
            console.log(msg);
            this.updateStatus(msg);
            
            document.getElementById('seams-count').textContent = 
                `部件: ${subMeshes.length} | 红点: ${this.redVertices.length}`;
            
        } catch (error) {
            console.error('部件分割失败:', error);
            this.updateStatus('分割失败: ' + error.message);
        } finally {
            this.hideLoading();
            this.hideProgress();
            
            // 确保分割后鼠标控制可用
            this.ensureControlsEnabled();
        }
    }
    
    /**
     * 确保 OrbitControls 处于启用状态
     */
    ensureControlsEnabled() {
        if (this.controls3D) {
            this.controls3D.enabled = true;
            this.controls3D.enableZoom = true;
            this.controls3D.enablePan = true;
            this.controls3D.enableRotate = true;
            this.controls3D.update();
        }
        
        // 确保渲染器 DOM 元素可以接收鼠标事件
        if (this.renderer3D && this.renderer3D.domElement) {
            this.renderer3D.domElement.style.pointerEvents = 'auto';
            this.renderer3D.domElement.style.touchAction = 'none';
        }
        
        // 确保 canvas 容器没有阻挡
        const container = document.getElementById('canvas-3d');
        if (container) {
            container.style.pointerEvents = 'auto';
        }
        
        console.log('✅ OrbitControls 已确认启用');
    }
    
    /**
     * 【可视化】给分割后的部件染上不同颜色
     */
    visualizeSegmentation(subMeshes) {
        console.log("=== 正在可视化部件分割结果 ===");
        
        // 清除旧的分割可视化
        this.clearSegmentVisualization();
        
        // 隐藏原始模型（或设置透明）
        if (this.mesh3D) {
            this.mesh3D.visible = false;
        }
        
        // 为每个部件创建彩色网格
        subMeshes.forEach((subMesh, index) => {
            // 生成鲜艳颜色（黄金角度分布，颜色差异最大化）
            const hue = (index * 137.5) % 360;
            const color = new THREE.Color(`hsl(${hue}, 70%, 55%)`);
            
            // 创建几何体
            const geometry = new THREE.BufferGeometry();
            const positions = [];
            const indices = [];
            
            // 添加顶点
            subMesh.vertices.forEach(v => {
                positions.push(v.x, v.y, v.z);
            });
            
            // 添加面
            subMesh.faces.forEach(face => {
                if (face.length === 3) {
                    indices.push(face[0], face[1], face[2]);
                } else if (face.length === 4) {
                    indices.push(face[0], face[1], face[2]);
                    indices.push(face[0], face[2], face[3]);
                }
            });
            
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geometry.setIndex(indices);
            geometry.computeVertexNormals();
            
            // 创建材质（带 polygonOffset 防止 Z-fighting）
            const material = new THREE.MeshPhongMaterial({
                color: color,
                side: THREE.DoubleSide,
                flatShading: false,
                polygonOffset: true,
                polygonOffsetFactor: -1.0,
                polygonOffsetUnits: -1.0,
                transparent: true,
                opacity: 0.95
            });
            
            const mesh3D = new THREE.Mesh(geometry, material);
            mesh3D.name = `Segment_${index}`;
            mesh3D.userData = { 
                segmentIndex: index, 
                faceCount: subMesh.faces.length,
                vertexCount: subMesh.vertices.length
            };
            
            this.scene3D.add(mesh3D);
            this.segmentMeshes.push(mesh3D);
            
            console.log(`  部件 #${index}: ${subMesh.faces.length} 面, 颜色 hsl(${hue.toFixed(0)}, 70%, 55%)`);
        });
        
        // 强制确保 OrbitControls 完全启用
        if (this.controls3D) {
            this.controls3D.enabled = true;
            this.controls3D.enableZoom = true;
            this.controls3D.enablePan = true;
            this.controls3D.enableRotate = true;
            this.controls3D.update();
            console.log('OrbitControls 状态:', {
                enabled: this.controls3D.enabled,
                enableZoom: this.controls3D.enableZoom,
                enablePan: this.controls3D.enablePan,
                enableRotate: this.controls3D.enableRotate
            });
        }
        
        // 确保渲染器 DOM 元素可以接收事件
        if (this.renderer3D && this.renderer3D.domElement) {
            this.renderer3D.domElement.style.pointerEvents = 'auto';
        }
        
        console.log(`✅ 已渲染 ${subMeshes.length} 个彩色部件 (鼠标控制已确认启用)`);
    }
    
    /**
     * 清除分割可视化
     */
    clearSegmentVisualization() {
        this.segmentMeshes.forEach(mesh => {
            if (mesh.parent) {
                mesh.parent.remove(mesh);
            }
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        });
        this.segmentMeshes = [];
        
        // 恢复原始模型显示
        if (this.mesh3D) {
            this.mesh3D.visible = true;
        }
    }
    
    /**
     * 清除3D模型上的红色线段和红点标记
     * 在2D展开完成后调用
     */
    clearRedLinesAndMarkers() {
        // 清除红色缝线
        this.seamLines.forEach(line => {
            if (line.parent) {
                line.parent.remove(line);
            }
            if (line.geometry) line.geometry.dispose();
            if (line.material) line.material.dispose();
        });
        this.seamLines = [];
        
        // 清除红色顶点标记球
        this.redVertexMarkers.forEach(marker => {
            if (marker.parent) {
                marker.parent.remove(marker);
            }
            if (marker.geometry) marker.geometry.dispose();
            if (marker.material) marker.material.dispose();
        });
        this.redVertexMarkers = [];
        
        console.log('✅ 已清除3D模型上的红色线段和标记');
    }
    
    /**
     * 【V10.0 核心处理管线】
     * 最终裁片 = (拓扑切割 + 初始舒展) + 物理差异化松弛
     * 
     * Phase 1: 拓扑手术 (Topological Surgery)
     *   - 内部红线切割 (Vertex Splitting)
     *   - 圆筒智能补刀 (Geodesic Shortest Path)
     * 
     * Phase 2: 初始舒展 (Initial Unfolding)
     *   - LSCM 通用首选
     *   - 滚筒展开 (圆筒特供)
     *   - BFS 辐射展开 (保底)
     * 
     * Phase 3: 物理差异化松弛 (Steel & Rubber Strategy)
     *   - 边界边：高刚度 k=50 (钢丝)
     *   - 内部边：低刚度 k=0.2 (橡皮筋)
     *   - 边界不钉死：允许形成自然弧度
     */
    async flattenMesh() {
        // 如果还没分割，先执行分割
        if (this.pipelineStage < 1 || !this.segmentedParts || this.segmentedParts.length === 0) {
            await this.segmentParts();
            if (this.pipelineStage < 1) return;
        }
        
        this.showLoading('V10.0：核心展开流程...');
        this.showProgress(0);
        
        try {
            const startTime = Date.now();
            const subMeshes = this.segmentedParts;
            
            console.log('╔══════════════════════════════════════════════╗');
            console.log('║     V10.0 核心处理管线                       ║');
            console.log('║  最终裁片 = 拓扑切割 + 初始舒展 + 物理松弛   ║');
            console.log('╚══════════════════════════════════════════════╝');
            console.log(`待处理部件数: ${subMeshes.length}`);
            
            const finalPatterns = [];
            
            for (let i = 0; i < subMeshes.length; i++) {
                let subMesh = subMeshes[i];
                
                console.log(`\n╔═══════════ 处理部件 #${i} ═══════════╗`);
                console.log(`║ 输入: ${subMesh.vertices.length} 顶点, ${subMesh.faces.length} 面`);
                
                // ═══════════════════════════════════════════════════════════
                // Phase 1: 拓扑手术 (Topological Surgery)
                // ═══════════════════════════════════════════════════════════
                this.updateStatus(`部件 ${i+1}/${subMeshes.length}: 🔪拓扑手术...`);
                console.log('║');
                console.log('║ ▶ Phase 1: 拓扑手术');
                
                // 1.1 内部红线切割
                const hasInternalSeams = this.hasInternalRedSeams(subMesh, i);
                if (hasInternalSeams) {
                    console.log('║   1.1 内部红线切割 (Vertex Splitting)...');
                    subMesh = this.processInternalSeams(subMesh, i);
                } else {
                    console.log('║   1.1 内部无红线，跳过');
                }
                
                // 1.2 圆筒智能补刀
                let wasCylinder = false;
                const topo = TopologyRepair.computeEuler(subMesh);
                console.log(`║   1.2 拓扑检测: χ=${topo.euler}, 边界环=${topo.boundaryLoopCount}`);
                
                if (topo.euler !== 1) {
                    if (topo.euler === 0 && topo.boundaryLoopCount >= 2) {
                        console.log('║   ⚠️ 检测到圆筒(χ=0)，执行最短测地线切割...');
                        wasCylinder = true;
                        const fixed = TopologyRepair.repairCylinder(subMesh, topo);
                        if (fixed && fixed.length > 0) {
                            subMesh = fixed[0];
                            console.log('║   ✅ 圆筒→圆盘转换成功');
                        }
                    } else {
                        console.log(`║   ⚠️ 异常拓扑(χ=${topo.euler})，继续处理`);
                    }
                } else {
                    console.log('║   ✅ 拓扑正常 (圆盘)');
                }
                
                // ═══════════════════════════════════════════════════════════
                // Phase 2: 初始舒展 (Initial Unfolding)
                // ═══════════════════════════════════════════════════════════
                this.updateStatus(`部件 ${i+1}/${subMeshes.length}: 📄初始舒展...`);
                console.log('║');
                console.log('║ ▶ Phase 2: 初始舒展 (无重叠最大投影)');
                
                let initialUV = null;
                const isTubeLike = this.isElongated(subMesh);
                
                // 方案判断：圆筒用滚筒展开，其他用LSCM
                if (wasCylinder || isTubeLike) {
                    // 圆筒特供：滚筒展开 (Tube Unrolling)
                    console.log('║   策略: 滚筒展开 (TubeUnroller)');
                    try {
                        initialUV = tubeUnroller.computeUnrolledUV(subMesh, this.redVerticesSet);
                        if (initialUV && initialUV.length === subMesh.vertices.length) {
                            console.log('║   ✅ 滚筒展开成功 (矩形铺满)');
                        } else {
                            throw new Error('滚筒展开结果无效');
                        }
                    } catch (e) {
                        console.warn(`║   ⚠️ 滚筒展开失败: ${e.message}`);
                        initialUV = null;
                    }
                }
                
                // 通用首选：LSCM 保角映射
                if (!initialUV) {
                    console.log('║   策略: LSCM 保角映射');
                    try {
                        initialUV = this.computeInitialUV(subMesh);
                        if (initialUV && initialUV.length === subMesh.vertices.length) {
                            console.log('║   ✅ LSCM 舒展成功');
                        } else {
                            throw new Error('LSCM结果无效');
                        }
                    } catch (e) {
                        console.warn(`║   ⚠️ LSCM 失败: ${e.message}`);
                        initialUV = null;
                    }
                }
                
                // 保底方案：BFS 辐射展开
                if (!initialUV) {
                    console.log('║   策略: BFS 辐射展开 (保底)');
                    try {
                        initialUV = bfsUnfolder.compute(subMesh);
                        if (initialUV && initialUV.length === subMesh.vertices.length) {
                            console.log('║   ✅ BFS 辐射展开成功');
                        } else {
                            throw new Error('BFS结果无效');
                        }
                    } catch (e) {
                        console.warn(`║   ⚠️ BFS 也失败: ${e.message}`);
                        initialUV = physicsFlattener.computePlanarProjection(subMesh);
                        console.log('║   ⚡ 使用平面投影作为最后保底');
                    }
                }
                
                // 最终验证
                if (!initialUV || initialUV.length !== subMesh.vertices.length) {
                    initialUV = this.projectPlanarUV(subMesh);
                }
                
                // ═══════════════════════════════════════════════════════════
                // Phase 3: 物理差异化松弛 (Steel & Rubber Strategy)
                // ═══════════════════════════════════════════════════════════
                this.updateStatus(`部件 ${i+1}/${subMeshes.length}: ⚡物理松弛...`);
                console.log('║');
                console.log('║ ▶ Phase 3: 物理差异化松弛 (外刚内柔)');
                console.log('║   边界边刚度 k=50.0 (钢丝)');
                console.log('║   内部边刚度 k=0.2 (橡皮筋)');
                console.log('║   边界自由度: 不钉死 → 允许弧度');
                
                let uvs = null;
                
                try {
                    uvs = await physicsFlattener.relaxDifferentiated(subMesh, initialUV, {
                        iterations: 200,
                        boundaryStiffness: 50.0,   // 边界：钢丝 (保持边长)
                        internalStiffness: 0.2,    // 内部：橡皮筋 (允许形变)
                        pinBoundary: false,        // 边界不钉死 → 允许形成弧度
                        damping: 0.995
                    });
                    
                    if (uvs && uvs.length === subMesh.vertices.length) {
                        console.log('║   ✅ 物理差异化松弛完成');
                    } else {
                        throw new Error('松弛结果无效');
                    }
                } catch (err) {
                    console.warn(`║   ⚠️ 物理松弛失败 (${err.message})，使用初始UV`);
                    uvs = initialUV;
                }
                
                // 最终验证
                if (!uvs || uvs.length !== subMesh.vertices.length) {
                    console.warn('║   ⚠️ UV结果无效，使用平面投影');
                    uvs = this.projectPlanarUV(subMesh);
                }
                
                const pattern = this.createPatternFromSubMesh(subMesh, uvs, i, false);
                finalPatterns.push(pattern);
                
                console.log('║');
                console.log(`╚═══════════ 部件 #${i} 完成 ═══════════╝`);
                
                const progress = ((i + 1) / subMeshes.length) * 90;
                this.showProgress(progress);
            }
            
            this.showProgress(90);
            
            // 排列UV岛
            this.updateStatus('排列UV岛...');
            this.arrangePatterns(finalPatterns);
            this.showProgress(95);
            
            // 构建最终结果
            const flattenedData = this.buildFlattenedData(finalPatterns);
            this.flattenedData = flattenedData;
            
            // 清除分割可视化，恢复原始模型
            this.clearSegmentVisualization();
            
            // 清除3D模型上的红色线段和红点标记
            this.clearRedLinesAndMarkers();
            
            this.pipelineStage = 2;  // 标记为已展开
            
            const elapsed = Date.now() - startTime;
            console.log('\n╔══════════════════════════════════════════════╗');
            console.log(`║ ✅ V10.0 展开完成！耗时: ${elapsed}ms`);
            console.log(`║   输入: ${subMeshes.length} 个部件`);
            console.log(`║   输出: ${finalPatterns.length} 个裁片`);
            console.log('║');
            console.log('║ 预期效果:');
            console.log('║   • 袖子: 直筒→扇形，边缘圆润弧线');
            console.log('║   • 胸/臀片: 内部收缩，消除鼓包');
            console.log('║   • 红线边界: 严格对应3D长度');
            console.log('╚══════════════════════════════════════════════╝');
            
            // 渲染2D结果
            this.renderer2D.render(this.flattenedData, this.seamData);
            this.renderer2D.setSeamColor(this.settings.seamColor);
            
            // 设置UV岛选择回调
            this.renderer2D.onIslandSelected = (islandIndex) => {
                if (islandIndex >= 0 && islandIndex < finalPatterns.length) {
                    const piece = finalPatterns[islandIndex];
                    this.highlightIslandIn3D(piece, islandIndex);
                } else {
                    this.clearIslandHighlight();
                }
            };
            
            // 更新状态
            this.updateStatus(`✅ V10.0展开完成 - ${finalPatterns.length} 个裁片 (${elapsed}ms)`);
            document.getElementById('seams-count').textContent = 
                `裁片: ${finalPatterns.length} | 部件: ${subMeshes.length}`;
            
        } catch (error) {
            console.error('展开失败:', error);
            this.updateStatus('展开失败: ' + error.message);
        } finally {
            this.hideLoading();
            this.hideProgress();
        }
    }
    
    /**
     * 【辅助】判断部件是否为细长形状（管状物）
     * 如果最长边是第二长边的1.8倍以上，认为是管状
     */
    isElongated(subMesh) {
        const vertices = subMesh.vertices;
        if (!vertices || vertices.length < 3) return false;
        
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
        
        const sizeX = maxX - minX;
        const sizeY = maxY - minY;
        const sizeZ = maxZ - minZ;
        
        // 排序找最大两个轴
        const sorted = [sizeX, sizeY, sizeZ].sort((a, b) => b - a);
        
        // 如果最长边是第二长边的 1.8 倍以上，大概率是管状物
        if (sorted[1] < 0.001) return false;  // 防止除零
        return (sorted[0] / sorted[1]) > 1.8;
    }
    
    /**
     * 【辅助】检查部件是否有内部红线
     */
    hasInternalRedSeams(subMesh, partIndex) {
        if (!this.redVerticesSet || !subMesh.localToGlobal) {
            return false;
        }
        
        // 计算落在这个 SubMesh 上的红点数量
        let redCount = 0;
        for (let localIdx = 0; localIdx < subMesh.localToGlobal.length; localIdx++) {
            const globalIdx = subMesh.localToGlobal[localIdx];
            if (this.redVerticesSet.has(globalIdx)) {
                redCount++;
            }
        }
        
        return redCount >= 2;
    }
    
    /**
     * 【模块1】内部红线切割 (Topology Cut)
     * 如果部件内部有红线，执行物理顶点分裂
     */
    processInternalSeams(subMesh, partIndex) {
        if (!this.redVerticesSet || !subMesh.localToGlobal) {
            return subMesh;
        }
        
        // 找出落在这个 SubMesh 上的红点（本地索引）
        const localRedIndices = [];
        for (let localIdx = 0; localIdx < subMesh.localToGlobal.length; localIdx++) {
            const globalIdx = subMesh.localToGlobal[localIdx];
            if (this.redVerticesSet.has(globalIdx)) {
                localRedIndices.push(localIdx);
            }
        }
        
        if (localRedIndices.length < 2) {
            console.log(`  部件 #${partIndex}: 内部无红点，跳过内部切割`);
            return subMesh;
        }
        
        console.log(`  部件 #${partIndex}: 内部发现 ${localRedIndices.length} 个红点`);
        
        // 提取内部红边
        const localRedSet = new Set(localRedIndices);
        const internalSeamEdges = new Set();
        
        for (const face of subMesh.faces) {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                if (localRedSet.has(v1) && localRedSet.has(v2)) {
                    const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                    internalSeamEdges.add(key);
                }
            }
        }
        
        if (internalSeamEdges.size === 0) {
            console.log(`  部件 #${partIndex}: 无内部红边，跳过`);
            return subMesh;
        }
        
        console.log(`  🔪 部件 #${partIndex}: 执行内部切割 (${internalSeamEdges.size} 条红边)...`);
        
        // 执行物理切割：沿红线将顶点一分为二
        const cutResult = MeshScissor.cutAlongEdges(subMesh, internalSeamEdges);
        
        if (cutResult) {
            console.log(`  ✅ 内部切割完成: ${subMesh.vertices.length} -> ${cutResult.vertices.length} 顶点`);
            return cutResult;
        }
        
        // 切割失败，标记红边供ARAP使用
        subMesh.internalSeamEdges = internalSeamEdges;
        return subMesh;
    }
    
    /**
     * 【模块2】LSCM初始展开 - 获取最佳初始2D状态
     * LSCM保角映射：自动寻找让网格"摊得最平"的状态
     * 【已加固】多层降级保护
     */
    computeInitialUV(subMesh) {
        // 安全检查
        if (!subMesh || !subMesh.vertices || subMesh.vertices.length < 3) {
            console.warn(`  computeInitialUV: 网格无效，使用平面投影`);
            return this.projectPlanarUV(subMesh || { vertices: [] });
        }
        
        // 方案1: 尝试LSCM
        if (this.lscmFlattener) {
            try {
                this.lscmFlattener.setMesh(subMesh.vertices, subMesh.faces);
                const result = this.lscmFlattener.flatten();
                
                // 检查LSCM结果
                if (result && result.uvs && result.uvs.length === subMesh.vertices.length) {
                    console.log(`  ✅ LSCM初始化成功`);
                    return result.uvs;
                }
            } catch (e) {
                console.warn(`  LSCM失败: ${e.message}`);
            }
        }
        
        // 方案2: 尝试PCA投影
        try {
            const pcaUV = this.computePCAProjection(subMesh);
            if (pcaUV && pcaUV.length === subMesh.vertices.length) {
                console.log(`  ✅ PCA投影成功`);
                return pcaUV;
            }
        } catch (e) {
            console.warn(`  PCA投影失败: ${e.message}`);
        }
        
        // 方案3: 最后降级 - 平面投影
        console.log(`  使用平面投影降级`);
        return this.projectPlanarUV(subMesh);
    }
    
    /**
     * PCA投影 - 沿最大方差方向投影
     * 【已加固】防御性检查
     */
    computePCAProjection(subMesh) {
        const vertices = subMesh.vertices;
        
        // 安全检查
        if (!vertices || vertices.length < 3) {
            return this.projectPlanarUV(subMesh);
        }
        
        // 过滤无效顶点
        const validVertices = vertices.filter(v => v && typeof v.x === 'number');
        if (validVertices.length < 3) {
            return this.projectPlanarUV(subMesh);
        }
        
        // 计算质心
        const centroid = { x: 0, y: 0, z: 0 };
        for (const v of validVertices) {
            centroid.x += v.x;
            centroid.y += v.y;
            centroid.z += v.z;
        }
        centroid.x /= validVertices.length;
        centroid.y /= validVertices.length;
        centroid.z /= validVertices.length;
        
        // 计算协方差矩阵
        let cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (const v of validVertices) {
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
        
        // 幂迭代求主轴
        let v1 = { x: 1, y: 0, z: 0 };
        for (let i = 0; i < 20; i++) {
            const newV = {
                x: cov[0][0] * v1.x + cov[0][1] * v1.y + cov[0][2] * v1.z,
                y: cov[1][0] * v1.x + cov[1][1] * v1.y + cov[1][2] * v1.z,
                z: cov[2][0] * v1.x + cov[2][1] * v1.y + cov[2][2] * v1.z
            };
            const len = Math.sqrt(newV.x ** 2 + newV.y ** 2 + newV.z ** 2);
            if (len > 1e-10) {
                v1 = { x: newV.x / len, y: newV.y / len, z: newV.z / len };
            }
        }
        
        // 正交化第二轴
        let v2 = { x: 0, y: 1, z: 0 };
        const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
        v2 = { x: v2.x - dot * v1.x, y: v2.y - dot * v1.y, z: v2.z - dot * v1.z };
        let len2 = Math.sqrt(v2.x ** 2 + v2.y ** 2 + v2.z ** 2);
        
        if (len2 < 0.001) {
            // 如果y轴和v1平行，尝试z轴
            v2 = { x: 0, y: 0, z: 1 };
            const dot2 = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
            v2 = { x: v2.x - dot2 * v1.x, y: v2.y - dot2 * v1.y, z: v2.z - dot2 * v1.z };
            len2 = Math.sqrt(v2.x ** 2 + v2.y ** 2 + v2.z ** 2);
        }
        
        if (len2 > 1e-10) {
            v2 = { x: v2.x / len2, y: v2.y / len2, z: v2.z / len2 };
        } else {
            v2 = { x: 0, y: 1, z: 0 };
        }
        
        // 投影到2D
        return vertices.map(v => {
            if (!v || typeof v.x !== 'number') {
                return { u: 0, v: 0 };
            }
            const dx = v.x - centroid.x;
            const dy = v.y - centroid.y;
            const dz = v.z - centroid.z;
            return {
                u: dx * v1.x + dy * v1.y + dz * v1.z,
                v: dx * v2.x + dy * v2.y + dz * v2.z
            };
        });
    }
    
    /**
     * 【模块3】加权ARAP弹性优化
     * 边界边：高刚性，保持3D边长
     * 内部边：低刚性，允许收缩/膨胀
     */
    async flattenWithElastic(subMesh, initialUV, options = {}) {
        const {
            iterations = 50,
            boundaryStiffness = 50.0,  // 边界刚性权重
            internalStiffness = 1.0    // 内部弹性权重
        } = options;
        
        this.arapFlattener.setMesh(subMesh.vertices, subMesh.faces);
        
        const uvs = this.arapFlattener.flatten(iterations, {
            boundaryConstraints: true,
            boundaryStiffness: boundaryStiffness,
            internalStiffness: internalStiffness,
            initialUV: initialUV,
            smoothBoundary: true,
            smoothIterations: 3
        });
        
        return uvs;
    }
    
    /**
     * 【降级方案】平面投影 (Planar Projection)
     * 当LSCM/ARAP失败时，使用简单的XY投影作为保底
     */
    projectPlanarUV(subMesh) {
        const vertices = subMesh.vertices;
        const n = vertices.length;
        
        if (n === 0) {
            return [];
        }
        
        // 计算包围盒
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        for (const v of vertices) {
            if (!v) continue;
            minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
            minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
            minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
        }
        
        // 选择方差最大的两个轴作为UV
        const rangeX = maxX - minX;
        const rangeY = maxY - minY;
        const rangeZ = maxZ - minZ;
        
        // 找出最大的两个轴
        let axis1, axis2;
        if (rangeX >= rangeY && rangeX >= rangeZ) {
            axis1 = 'x';
            axis2 = rangeY >= rangeZ ? 'y' : 'z';
        } else if (rangeY >= rangeX && rangeY >= rangeZ) {
            axis1 = 'y';
            axis2 = rangeX >= rangeZ ? 'x' : 'z';
        } else {
            axis1 = 'z';
            axis2 = rangeX >= rangeY ? 'x' : 'y';
        }
        
        const uvs = [];
        for (const v of vertices) {
            if (!v) {
                uvs.push({ u: 0, v: 0 });
                continue;
            }
            uvs.push({
                u: v[axis1] || 0,
                v: v[axis2] || 0
            });
        }
        
        console.log(`    平面投影: 使用 ${axis1.toUpperCase()}-${axis2.toUpperCase()} 轴`);
        
        return uvs;
    }
    
    /**
     * 计算边数
     */
    countEdges(faces) {
        const edgeSet = new Set();
        for (const face of faces) {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                edgeSet.add(key);
            }
        }
        return edgeSet.size;
    }
    
    /**
     * 计算欧拉示性数 χ = V - E + F
     * χ = 1: 圆盘 (可展开)
     * χ = 0: 圆筒 (需要补刀)
     * χ = 2: 闭合球体 (需要两刀)
     */
    calculateEuler(mesh) {
        const V = mesh.vertices.length;
        const F = mesh.faces.length;
        
        // 计算边数（每条边被两个面共享）
        const edgeSet = new Set();
        for (const face of mesh.faces) {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                edgeSet.add(key);
            }
        }
        const E = edgeSet.size;
        
        return V - E + F;
    }
    
    /**
     * 圆筒弹性补刀
     * 找到两个边界圈之间的最短路径，切一刀
     */
    cutCylinderElastic(mesh) {
        // 1. 找到所有边界边
        const edgeFaceCount = new Map();
        
        for (let faceIdx = 0; faceIdx < mesh.faces.length; faceIdx++) {
            const face = mesh.faces[faceIdx];
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                edgeFaceCount.set(key, (edgeFaceCount.get(key) || 0) + 1);
            }
        }
        
        // 边界边：只被一个面使用
        const boundaryEdges = [];
        for (const [key, count] of edgeFaceCount) {
            if (count === 1) {
                const [v1, v2] = key.split('_').map(Number);
                boundaryEdges.push([v1, v2]);
            }
        }
        
        if (boundaryEdges.length === 0) {
            console.warn('    没有边界边，无法补刀');
            return null;
        }
        
        // 2. 将边界边分离成独立的圈
        const loops = this.separateBoundaryLoops(boundaryEdges);
        
        if (loops.length < 2) {
            console.warn(`    只有 ${loops.length} 个边界圈，不是圆筒`);
            return null;
        }
        
        console.log(`    检测到 ${loops.length} 个边界圈`);
        
        // 3. 找两个圈之间最近的两个点
        const loopA = loops[0];
        const loopB = loops[1];
        
        let minDist = Infinity;
        let startV = loopA[0];
        let endV = loopB[0];
        
        // 采样找最近点对
        const sampleA = loopA.length > 20 ? loopA.filter((_, i) => i % Math.ceil(loopA.length / 20) === 0) : loopA;
        const sampleB = loopB.length > 20 ? loopB.filter((_, i) => i % Math.ceil(loopB.length / 20) === 0) : loopB;
        
        for (const va of sampleA) {
            const pa = mesh.vertices[va];
            for (const vb of sampleB) {
                const pb = mesh.vertices[vb];
                const dx = pb.x - pa.x;
                const dy = pb.y - pa.y;
                const dz = pb.z - pa.z;
                const dist = dx * dx + dy * dy + dz * dz;
                if (dist < minDist) {
                    minDist = dist;
                    startV = va;
                    endV = vb;
                }
            }
        }
        
        console.log(`    桥梁: ${startV} → ${endV} (距离: ${Math.sqrt(minDist).toFixed(4)})`);
        
        // 4. BFS找最短路径
        const path = this.bfsPath(mesh, startV, endV);
        
        if (!path || path.length < 2) {
            console.warn('    找不到连接路径');
            return null;
        }
        
        console.log(`    切割路径: ${path.length} 个顶点`);
        
        // 5. 沿路径切割
        const cutEdges = new Set();
        for (let i = 0; i < path.length - 1; i++) {
            const v1 = path[i];
            const v2 = path[i + 1];
            const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
            cutEdges.add(key);
        }
        
        // 使用 MeshScissor 切割
        const result = this.meshScissor.cut(mesh, cutEdges);
        
        console.log(`    ✅ 切割完成: ${result.length} 个新裁片`);
        
        return result;
    }
    
    /**
     * 将边界边分离成独立的圈
     */
    separateBoundaryLoops(edges) {
        const vertexToEdges = new Map();
        
        for (const [v1, v2] of edges) {
            if (!vertexToEdges.has(v1)) vertexToEdges.set(v1, []);
            if (!vertexToEdges.has(v2)) vertexToEdges.set(v2, []);
            vertexToEdges.get(v1).push(v2);
            vertexToEdges.get(v2).push(v1);
        }
        
        const visited = new Set();
        const loops = [];
        
        for (const startV of vertexToEdges.keys()) {
            if (visited.has(startV)) continue;
            
            const loop = [];
            let current = startV;
            let prev = -1;
            
            while (!visited.has(current)) {
                visited.add(current);
                loop.push(current);
                
                const neighbors = vertexToEdges.get(current);
                let next = neighbors.find(n => n !== prev);
                
                if (next === undefined) break;
                
                prev = current;
                current = next;
            }
            
            if (loop.length > 2) {
                loops.push(loop);
            }
        }
        
        return loops;
    }
    
    /**
     * BFS寻找最短路径
     */
    bfsPath(mesh, start, end) {
        // 构建邻接表
        const adj = new Map();
        for (const face of mesh.faces) {
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                if (!adj.has(v1)) adj.set(v1, []);
                if (!adj.has(v2)) adj.set(v2, []);
                adj.get(v1).push(v2);
                adj.get(v2).push(v1);
            }
        }
        
        // BFS
        const queue = [start];
        const parent = new Map();
        parent.set(start, -1);
        
        while (queue.length > 0) {
            const current = queue.shift();
            
            if (current === end) {
                // 重建路径
                const path = [];
                let node = end;
                while (node !== -1) {
                    path.push(node);
                    node = parent.get(node);
                }
                return path.reverse();
            }
            
            const neighbors = adj.get(current) || [];
            for (const neighbor of neighbors) {
                if (!parent.has(neighbor)) {
                    parent.set(neighbor, current);
                    queue.push(neighbor);
                }
            }
        }
        
        return null;
    }
    
    /**
     * 从红色顶点构建切割边
     * 使用Dijkstra连接散落的红点
     */
    /**
     * 将颜色数组重新映射到焊接后的网格
     * @param {Array} originalColors - 原始颜色数组
     * @param {Map} vertexMap - 旧索引 -> 新索引的映射
     * @param {number} newVertexCount - 新网格的顶点数量
     * @returns {Array} 重新映射后的颜色数组
     */
    remapColorsToWeldedMesh(originalColors, vertexMap, newVertexCount) {
        if (!originalColors || originalColors.length === 0) {
            return [];
        }
        
        // 如果没有映射，说明没有焊接，直接返回原数组
        if (!vertexMap) {
            return originalColors;
        }
        
        // 创建新的颜色数组
        const newColors = new Array(newVertexCount).fill(null).map(() => ({ r: 0, g: 0, b: 0 }));
        
        // 映射颜色到新索引
        // 如果多个旧顶点映射到同一个新顶点，保留红色值最高的
        for (let oldIdx = 0; oldIdx < originalColors.length; oldIdx++) {
            const newIdx = vertexMap.get(oldIdx);
            if (newIdx !== undefined && newIdx < newVertexCount) {
                const oldColor = originalColors[oldIdx];
                if (oldColor) {
                    // 如果新位置还没有颜色，或者旧颜色更红，使用旧颜色
                    if (!newColors[newIdx] || (oldColor.r > newColors[newIdx].r)) {
                        newColors[newIdx] = { ...oldColor };
                    }
                }
            }
        }
        
        console.log(`颜色重映射: ${originalColors.length} -> ${newVertexCount} 顶点`);
        return newColors;
    }
    
    /**
     * 从颜色数组中提取红色顶点
     * @param {Array} colors - 颜色数组
     * @returns {Array} 红色顶点索引数组
     */
    extractRedVerticesFromColors(colors) {
        if (!colors || colors.length === 0) {
            return [];
        }
        
        const redVertices = [];
        const redThreshold = 0.7;      // 红色阈值
        const otherMaxThreshold = 0.4; // 绿色和蓝色的最大阈值
        
        for (let i = 0; i < colors.length; i++) {
            const color = colors[i];
            if (!color) continue;
            
            // 检测红色顶点：高红色值，低绿色和蓝色值
            if (color.r > redThreshold && 
                color.g < otherMaxThreshold && 
                color.b < otherMaxThreshold) {
                redVertices.push(i);
            }
        }
        
        return redVertices;
    }
    
    /**
     * 构建邻接表
     * @param {Array} faces - 面数组
     * @param {number} vertexCount - 顶点数量
     * @returns {Object} 邻接表
     */
    buildAdjacency(faces, vertexCount) {
        const vertexToVertices = new Map();
        const vertexToFaces = new Map();
        
        // 初始化
        for (let i = 0; i < vertexCount; i++) {
            vertexToVertices.set(i, new Set());
            vertexToFaces.set(i, new Set());
        }
        
        // 构建邻接关系
        for (let faceIdx = 0; faceIdx < faces.length; faceIdx++) {
            const face = faces[faceIdx];
            
            for (let i = 0; i < face.length; i++) {
                const v1 = face[i];
                const v2 = face[(i + 1) % face.length];
                
                if (vertexToVertices.has(v1)) {
                    vertexToVertices.get(v1).add(v2);
                }
                if (vertexToVertices.has(v2)) {
                    vertexToVertices.get(v2).add(v1);
                }
                if (vertexToFaces.has(v1)) {
                    vertexToFaces.get(v1).add(faceIdx);
                }
            }
        }
        
        return {
            vertexToVertices,
            vertexToFaces
        };
    }
    
    /**
     * @deprecated 使用新的流程，不再需要此方法
     */
    async buildCutEdgesFromRedVertices() {
        console.warn('buildCutEdgesFromRedVertices 已弃用，请使用新的焊接-提取流程');
        return new Set();
    }
    
    /**
     * 从子网格和UV创建展开图案
     */
    createPatternFromSubMesh(subMesh, uvs, index, hasTopologyError) {
        // 计算边界
        let minU = Infinity, maxU = -Infinity;
        let minV = Infinity, maxV = -Infinity;
        
        for (const uv of uvs) {
            if (uv.u < minU) minU = uv.u;
            if (uv.u > maxU) maxU = uv.u;
            if (uv.v < minV) minV = uv.v;
            if (uv.v > maxV) maxV = uv.v;
        }
        
        // 构建局部顶点信息
        const localVertices = subMesh.vertices.map((v, i) => ({
            global: subMesh.localToGlobal[i],
            local: i,
            pos3D: v
        }));
        
        return {
            pieceIndex: index,
            vertexMap: subMesh.globalToLocal,
            localVertices: localVertices,
            localFaces: subMesh.faces,
            globalFaces: subMesh.originalFaceIndices,
            uv: uvs,
            bounds: { minU, maxU, minV, maxV },
            hasTopologyError: hasTopologyError  // 标记拓扑问题
        };
    }
    
    /**
     * 排列UV图案避免重叠 (简单行排列)
     */
    arrangePatterns(patterns) {
        if (patterns.length === 0) return;
        
        const padding = 0.02;  // 间距
        let currentX = 0;
        let currentY = 0;
        let rowHeight = 0;
        const maxWidth = 4.0;  // 最大行宽
        
        for (const pattern of patterns) {
            const width = pattern.bounds.maxU - pattern.bounds.minU;
            const height = pattern.bounds.maxV - pattern.bounds.minV;
            
            // 如果超出行宽，换行
            if (currentX + width > maxWidth && currentX > 0) {
                currentX = 0;
                currentY += rowHeight + padding;
                rowHeight = 0;
            }
            
            // 平移UV坐标
            const offsetU = currentX - pattern.bounds.minU;
            const offsetV = currentY - pattern.bounds.minV;
            
            for (const uv of pattern.uv) {
                uv.u += offsetU;
                uv.v += offsetV;
            }
            
            // 更新边界
            pattern.bounds.minU += offsetU;
            pattern.bounds.maxU += offsetU;
            pattern.bounds.minV += offsetV;
            pattern.bounds.maxV += offsetV;
            
            // 更新位置
            currentX += width + padding;
            rowHeight = Math.max(rowHeight, height);
        }
    }
    
    /**
     * 构建最终的展开数据
     */
    buildFlattenedData(patterns) {
        let totalMinU = Infinity, totalMaxU = -Infinity;
        let totalMinV = Infinity, totalMaxV = -Infinity;
        let totalArea = 0;
        
        for (const pattern of patterns) {
            const b = pattern.bounds;
            if (b.minU < totalMinU) totalMinU = b.minU;
            if (b.maxU > totalMaxU) totalMaxU = b.maxU;
            if (b.minV < totalMinV) totalMinV = b.minV;
            if (b.maxV > totalMaxV) totalMaxV = b.maxV;
            totalArea += (b.maxU - b.minU) * (b.maxV - b.minV);
        }
        
        return {
            pieces: patterns,
            bounds: { 
                minU: totalMinU, 
                maxU: totalMaxU, 
                minV: totalMinV, 
                maxV: totalMaxV 
            },
            totalArea: totalArea,
            originalMesh: this.meshData,
            seams: this.seamData?.seams || []
        };
    }
    
    /**
     * 从缝线数据获取缝线边集合
     */
    getSeamEdgesFromData() {
        const seamEdges = new Set();
        
        if (!this.seamData) return seamEdges;
        
        const seams = this.seamData.seams || this.seamData.cuts || this.seamData;
        const seamArray = Array.isArray(seams) ? seams : [seams];
        
        for (const seam of seamArray) {
            const edges = seam.edges || seam.vertices;
            if (edges) {
                if (Array.isArray(edges[0])) {
                    // 边数组格式: [[v1, v2], [v2, v3], ...]
                    edges.forEach(([v1, v2]) => {
                        const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                        seamEdges.add(edgeKey);
                    });
                } else {
                    // 顶点序列格式: [v1, v2, v3, ...]
                    for (let i = 0; i < edges.length - 1; i++) {
                        const v1 = edges[i];
                        const v2 = edges[i + 1];
                        const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                        seamEdges.add(edgeKey);
                    }
                }
            }
        }
        
        return seamEdges;
    }
    
    /**
     * 转换LSCM展开结果为标准格式
     */
    convertLSCMResult(lscmResult) {
        return this.convertBFFResult(lscmResult); // 格式相同
    }
    
    /**
     * 转换切割后的展开结果为标准格式
     */
    convertCutResult(lscmResult, cutResult) {
        const uvs = lscmResult.uvs;
        const islands = lscmResult.islands || [];
        const subMeshes = cutResult.subMeshes;
        
        const pieces = [];
        
        // 为每个子网格创建片段
        for (let i = 0; i < subMeshes.length; i++) {
            const subMesh = subMeshes[i];
            const island = islands[i] || { vertices: subMesh.vertices, faces: subMesh.faceIndices || [] };
            
            const vertexArray = Array.from(subMesh.vertices);
            
            // 创建顶点映射
            const vertexMap = new Map();
            const localVertices = [];
            let localIdx = 0;
            
            for (const v of vertexArray) {
                vertexMap.set(v, localIdx);
                localVertices.push({
                    global: v,
                    local: localIdx,
                    pos3D: cutResult.vertices[v] || this.meshData.vertices[v] || { x: 0, y: 0, z: 0 }
                });
                localIdx++;
            }
            
            // 创建局部面
            const localFaces = subMesh.faces.map(face => {
                return face.map(v => vertexMap.get(v) ?? v);
            });
            
            // 创建局部UV
            const localUVs = [];
            for (const v of vertexArray) {
                localUVs.push(uvs[v] || { u: 0, v: 0 });
            }
            
            // 计算边界
            let minU = Infinity, maxU = -Infinity;
            let minV = Infinity, maxV = -Infinity;
            for (const uv of localUVs) {
                if (uv.u < minU) minU = uv.u;
                if (uv.u > maxU) maxU = uv.u;
                if (uv.v < minV) minV = uv.v;
                if (uv.v > maxV) maxV = uv.v;
            }
            
            const piece = {
                pieceIndex: i,
                vertexMap: vertexMap,
                localVertices: localVertices,
                localFaces: localFaces,
                globalFaces: subMesh.faceIndices || [],
                uv: localUVs,
                bounds: { minU, maxU, minV, maxV }
            };
            
            pieces.push(piece);
        }
        
        // 计算总边界
        let totalMinU = Infinity, totalMaxU = -Infinity;
        let totalMinV = Infinity, totalMaxV = -Infinity;
        let totalArea = 0;
        
        pieces.forEach(piece => {
            const b = piece.bounds;
            if (b.minU < totalMinU) totalMinU = b.minU;
            if (b.maxU > totalMaxU) totalMaxU = b.maxU;
            if (b.minV < totalMinV) totalMinV = b.minV;
            if (b.maxV > totalMaxV) totalMaxV = b.maxV;
            totalArea += (b.maxU - b.minU) * (b.maxV - b.minV);
        });
        
        console.log(`convertCutResult: ${pieces.length} 个UV岛`);
        
        return {
            pieces: pieces,
            bounds: { minU: totalMinU, maxU: totalMaxU, minV: totalMinV, maxV: totalMaxV },
            totalArea: totalArea,
            originalMesh: this.meshData,
            seams: this.seamData?.seams || []
        };
    }
    
    /**
     * 转换BFF展开结果为标准格式
     */
    convertBFFResult(bffResult) {
        const uvs = bffResult.uvs;
        const islands = bffResult.islands || [];
        
        // 获取缝线信息
        const seamProcessor = new SeamProcessor();
        const validatedSeams = seamProcessor.validateSeams(this.seamData, this.meshData);
        
        const pieces = [];
        
        if (islands.length > 0) {
            // 为每个UV岛创建单独的片段
            islands.forEach((island, islandIndex) => {
                // 将顶点Set转换为数组
                const vertexArray = island.vertices instanceof Set 
                    ? Array.from(island.vertices) 
                    : island.vertices;
                
                // 创建该岛的顶点映射
                const vertexMap = new Map();
                const localVertices = [];
                let localIdx = 0;
                
                for (const v of vertexArray) {
                    vertexMap.set(v, localIdx);
                    localVertices.push({
                        global: v,
                        local: localIdx,
                        pos3D: this.meshData.vertices[v]
                    });
                    localIdx++;
                }
                
                // 创建该岛的局部面（使用局部索引）
                const localFaces = island.faces.map(faceIdx => {
                    const globalFace = this.meshData.faces[faceIdx];
                    return globalFace.map(v => vertexMap.get(v));
                });
                
                // 创建该岛的UV数组（只包含该岛的顶点）
                const localUVs = [];
                for (const v of vertexArray) {
                    localUVs.push(uvs[v] || { u: 0, v: 0 });
                }
                
                const piece = {
                    pieceIndex: islandIndex,
                    vertexMap: vertexMap,
                    localVertices: localVertices,
                    localFaces: localFaces,
                    globalFaces: island.faces,
                    uv: localUVs,
                    bounds: this.calculateBoundsForIsland(uvs, vertexArray)
                };
                
                pieces.push(piece);
            });
        } else {
            // 没有岛信息，创建单个片段
            const vertexMap = new Map();
            for (let i = 0; i < this.meshData.vertices.length; i++) {
                vertexMap.set(i, i);
            }
            
            const localVertices = this.meshData.vertices.map((v, i) => ({
                global: i,
                local: i,
                pos3D: v
            }));
            
            const localFaces = this.meshData.faces.map(face => [...face]);
            
            const piece = {
                pieceIndex: 0,
                vertexMap: vertexMap,
                localVertices: localVertices,
                localFaces: localFaces,
                globalFaces: this.meshData.faces.map((_, i) => i),
                uv: uvs,
                bounds: this.calculateBounds(uvs)
            };
            
            pieces.push(piece);
        }
        
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
        
        console.log(`转换完成: ${pieces.length} 个UV岛`);
        
        return {
            pieces: pieces,
            bounds: { minU, maxU, minV, maxV },
            totalArea: totalArea,
            originalMesh: this.meshData,
            seams: validatedSeams
        };
    }
    
    /**
     * 计算指定顶点集合的UV边界
     */
    calculateBoundsForIsland(uvs, vertices) {
        let minU = Infinity, maxU = -Infinity;
        let minV = Infinity, maxV = -Infinity;
        
        // 确保vertices是可迭代的
        const vertexArray = vertices instanceof Set ? Array.from(vertices) : vertices;
        
        for (const v of vertexArray) {
            const uv = uvs[v];
            if (uv) {
                if (uv.u < minU) minU = uv.u;
                if (uv.u > maxU) maxU = uv.u;
                if (uv.v < minV) minV = uv.v;
                if (uv.v > maxV) maxV = uv.v;
            }
        }
        
        // 处理空边界的情况
        if (minU === Infinity) {
            minU = 0; maxU = 1; minV = 0; maxV = 1;
        }
        
        return { minU, maxU, minV, maxV };
    }
    
    /**
     * 计算UV边界
     */
    calculateBounds(uvs) {
        let minU = Infinity, maxU = -Infinity;
        let minV = Infinity, maxV = -Infinity;
        
        uvs.forEach(p => {
            if (p.u < minU) minU = p.u;
            if (p.u > maxU) maxU = p.u;
            if (p.v < minV) minV = p.v;
            if (p.v > maxV) maxV = p.v;
        });
        
        return { minU, maxU, minV, maxV };
    }
    
    /**
     * 导出SVG
     */
    exportSVG() {
        if (!this.flattenedData) {
            this.updateStatus('请先展开模型');
            return;
        }
        
        const svg = this.renderer2D.exportSVG(this.flattenedData, this.seamData);
        
        // 创建下载链接
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'flattened-pattern.svg';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.updateStatus('SVG已导出');
    }
    
    /**
     * 重置场景
     */
    resetScene() {
        // 移除3D模型
        if (this.mesh3D) {
            this.scene3D.remove(this.mesh3D);
            this.mesh3D.geometry.dispose();
            this.mesh3D.material.dispose();
            this.mesh3D = null;
        }
        
        // 移除缝线
        this.seamLines.forEach(line => {
            this.scene3D.remove(line);
            line.geometry.dispose();
            line.material.dispose();
        });
        this.seamLines = [];
        
        // 清空数据
        this.meshData = null;
        this.seamData = null;
        this.flattenedData = null;
        
        // 清空2D视图
        if (this.renderer2D) {
            this.renderer2D.clear();
        }
        
        // 重置UI
        document.getElementById('vertices-count').textContent = '顶点: 0';
        document.getElementById('faces-count').textContent = '面: 0';
        document.getElementById('seams-count').textContent = '缝线: 0';
        document.getElementById('model-info').textContent = '未加载模型';
        document.getElementById('seam-list').innerHTML = '<div class="empty-state">加载模型后显示缝线</div>';
        document.getElementById('segment-btn').disabled = true;
        document.getElementById('flatten-btn').disabled = true;
        
        // 重置流程状态
        this.pipelineStage = 0;
        this.segmentedParts = [];
        this.clearSegmentVisualization();
        
        // 重置相机
        this.camera3D.position.set(5, 5, 5);
        this.camera3D.lookAt(0, 0, 0);
        this.controls3D.target.set(0, 0, 0);
        
        this.updateStatus('已重置');
    }
    
    /**
     * 设置视角
     */
    setViewAngle(view) {
        const distance = 8;
        
        switch (view) {
            case 'front':
                this.camera3D.position.set(0, 0, distance);
                break;
            case 'top':
                this.camera3D.position.set(0, distance, 0);
                break;
            case 'side':
                this.camera3D.position.set(distance, 0, 0);
                break;
            case 'perspective':
                this.camera3D.position.set(5, 5, 5);
                break;
        }
        
        this.camera3D.lookAt(0, 0, 0);
        this.controls3D.target.set(0, 0, 0);
    }
    
    /**
     * 更新网格显示
     */
    updateMeshDisplay() {
        if (!this.mesh3D) return;
        
        // 查找并更新线框显示
        this.mesh3D.children.forEach(child => {
            if (child instanceof THREE.LineSegments) {
                child.visible = this.settings.showWireframe;
            }
        });
    }
    
    /**
     * 更新模型信息
     */
    updateModelInfo() {
        if (!this.meshData) {
            document.getElementById('model-info').textContent = '未加载模型';
            document.getElementById('vertices-count').textContent = '顶点: 0';
            document.getElementById('faces-count').textContent = '面: 0';
            return;
        }
        
        document.getElementById('vertices-count').textContent = `顶点: ${this.meshData.vertices.length}`;
        document.getElementById('faces-count').textContent = `面: ${this.meshData.faces.length}`;
        document.getElementById('model-info').textContent = `已加载: ${this.meshData.vertices.length}V / ${this.meshData.faces.length}F`;
    }
    
    /**
     * 检查是否可以执行展开
     * 检查是否可以进行分割/展开
     */
    checkFlattenReady() {
        const hasModel = !!this.meshData;
        const hasSeams = hasModel && (this.seamData || (this.meshData.hasVertexColors && this.redVertices.length > 0));
        
        // 分割按钮：只要有模型和红点/缝线就可以
        const segmentBtn = document.getElementById('segment-btn');
        if (segmentBtn) {
            segmentBtn.disabled = !hasSeams;
        }
        
        // 展开按钮：有模型即可（会自动先分割）
        const flattenBtn = document.getElementById('flatten-btn');
        if (flattenBtn) {
            flattenBtn.disabled = !hasSeams;
        }
    }
    
    /**
     * 窗口大小改变处理
     */
    onWindowResize() {
        // 更新3D视图
        const container3D = document.getElementById('canvas-3d');
        const rect3D = container3D.getBoundingClientRect();
        
        this.camera3D.aspect = rect3D.width / rect3D.height;
        this.camera3D.updateProjectionMatrix();
        this.renderer3D.setSize(rect3D.width, rect3D.height);
        
        // 更新2D视图
        if (this.renderer2D) {
            this.renderer2D.resize();
        }
    }
    
    /**
     * 动画循环
     */
    animate() {
        requestAnimationFrame(() => this.animate());
        
        if (this.controls3D) {
            this.controls3D.update();
        }
        this.renderer3D.render(this.scene3D, this.camera3D);
    }
    
    /**
     * 调试方法：检查控制器状态
     * 在控制台输入 window.app.debugControls() 查看
     */
    debugControls() {
        console.log('=== 控制器调试信息 ===');
        console.log('controls3D 存在:', !!this.controls3D);
        
        if (this.controls3D) {
            console.log('enabled:', this.controls3D.enabled);
            console.log('enableZoom:', this.controls3D.enableZoom);
            console.log('enablePan:', this.controls3D.enablePan);
            console.log('enableRotate:', this.controls3D.enableRotate);
            console.log('domElement:', this.controls3D.domElement);
        }
        
        console.log('renderer3D.domElement:', this.renderer3D?.domElement);
        
        const canvas = this.renderer3D?.domElement;
        if (canvas) {
            console.log('canvas.style.pointerEvents:', canvas.style.pointerEvents);
            const computedStyle = window.getComputedStyle(canvas);
            console.log('canvas computed pointerEvents:', computedStyle.pointerEvents);
        }
        
        const container = document.getElementById('canvas-3d');
        if (container) {
            const computedStyle = window.getComputedStyle(container);
            console.log('container computed pointerEvents:', computedStyle.pointerEvents);
            
            // 检查是否有元素覆盖在 canvas 上面
            const rect = container.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const topElement = document.elementFromPoint(centerX, centerY);
            console.log('canvas 中心位置的最上层元素:', topElement);
        }
        
        // 手动修复控制器
        console.log('尝试修复控制器...');
        this.ensureControlsEnabled();
        console.log('=== 调试完成 ===');
        
        return '请检查上面的输出';
    }
    
    // UI辅助方法
    updateStatus(message) {
        document.getElementById('status-message').textContent = message;
    }
    
    showLoading(text = '处理中...') {
        const overlay = document.getElementById('loading-overlay');
        overlay.querySelector('.loading-text').textContent = text;
        overlay.classList.add('active');
    }
    
    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        overlay.classList.remove('active');
        console.log('hideLoading: 已隐藏加载遮罩');
    }
    
    showProgress(percent) {
        const progress = document.getElementById('flatten-progress');
        progress.style.display = 'flex';
        progress.querySelector('.progress-fill').style.width = `${percent}%`;
        progress.querySelector('.progress-text').textContent = `${Math.round(percent)}%`;
    }
    
    hideProgress() {
        document.getElementById('flatten-progress').style.display = 'none';
    }
}

// 初始化应用
console.log('准备绑定DOMContentLoaded事件...');
window.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded触发，开始初始化应用...');
    try {
        window.app = new ClothFlattenerApp();
        console.log('应用实例创建成功');
    } catch (err) {
        console.error('应用创建失败:', err);
    }
});

