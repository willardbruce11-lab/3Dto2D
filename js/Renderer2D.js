/**
 * 2D渲染器
 * 在Canvas上渲染展开后的2D网格
 */

export class Renderer2D {
    constructor(container) {
        this.container = container;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.container.appendChild(this.canvas);
        
        // 视图参数
        this.viewTransform = {
            offsetX: 0,
            offsetY: 0,
            scale: 1
        };
        
        // 样式
        this.styles = {
            backgroundColor: '#0a0e14',
            meshFillColor: 'rgba(0, 212, 255, 0.15)',
            meshStrokeColor: '#2a3548',
            seamColor: '#ff3366',
            gridColor: '#1a2233',
            gridSubColor: '#101620'
        };
        
        // 数据
        this.flattenedData = null;
        this.seamData = null;
        
        // 选中的UV岛
        this.selectedIsland = -1;
        this.onIslandSelected = null;  // 选中回调
        
        // 初始化
        this.resize();
        this.setupEventListeners();
        this.drawGrid();
    }
    
    /**
     * 设置UV岛选中回调
     */
    setIslandSelectedCallback(callback) {
        this.onIslandSelected = callback;
    }
    
    /**
     * 查找指定屏幕坐标处的UV岛
     */
    findIslandAtPoint(screenX, screenY) {
        if (!this.flattenedData || !this.flattenedData.pieces) return -1;
        
        const { offsetX, offsetY, scale } = this.viewTransform;
        
        // 转换为UV坐标
        const uvX = (screenX - offsetX) / (scale * 200);
        const uvY = -(screenY - offsetY) / (scale * 200);
        
        // 检查每个UV岛的边界框
        for (let i = 0; i < this.flattenedData.pieces.length; i++) {
            const piece = this.flattenedData.pieces[i];
            const bounds = piece.bounds;
            
            if (bounds && 
                uvX >= bounds.minU && uvX <= bounds.maxU &&
                uvY >= bounds.minV && uvY <= bounds.maxV) {
                return i;
            }
        }
        
        return -1;
    }
    
    /**
     * 选择指定的UV岛
     */
    selectIsland(index) {
        this.selectedIsland = index;
        this.redraw();
    }
    
    /**
     * 设置事件监听
     */
    setupEventListeners() {
        // 缩放
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // 以鼠标位置为中心缩放
            const worldX = (mouseX - this.viewTransform.offsetX) / this.viewTransform.scale;
            const worldY = (mouseY - this.viewTransform.offsetY) / this.viewTransform.scale;
            
            this.viewTransform.scale *= delta;
            this.viewTransform.scale = Math.max(0.1, Math.min(10, this.viewTransform.scale));
            
            this.viewTransform.offsetX = mouseX - worldX * this.viewTransform.scale;
            this.viewTransform.offsetY = mouseY - worldY * this.viewTransform.scale;
            
            this.redraw();
            this.updateScaleIndicator();
        });
        
        // 平移
        let isDragging = false;
        let lastX = 0, lastY = 0;
        
        this.canvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            this.canvas.style.cursor = 'grabbing';
        });
        
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const dx = e.clientX - lastX;
            const dy = e.clientY - lastY;
            
            this.viewTransform.offsetX += dx;
            this.viewTransform.offsetY += dy;
            
            lastX = e.clientX;
            lastY = e.clientY;
            
            this.redraw();
        });
        
        window.addEventListener('mouseup', () => {
            isDragging = false;
            this.canvas.style.cursor = 'grab';
        });
        
        // 点击选择UV岛
        this.canvas.addEventListener('click', (e) => {
            if (isDragging) return;
            
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const clickedIsland = this.findIslandAtPoint(mouseX, mouseY);
            
            if (clickedIsland !== this.selectedIsland) {
                this.selectedIsland = clickedIsland;
                this.redraw();
                
                if (this.onIslandSelected) {
                    this.onIslandSelected(clickedIsland);
                }
            }
        });
        
        // 调整大小
        window.addEventListener('resize', () => this.resize());
    }
    
    /**
     * 调整画布大小
     */
    resize() {
        const rect = this.container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        
        this.ctx.scale(dpr, dpr);
        
        this.width = rect.width;
        this.height = rect.height;
        
        this.redraw();
    }
    
    /**
     * 渲染展开后的数据
     */
    render(flattenedData, seamData) {
        console.log('Renderer2D.render 被调用');
        console.log('flattenedData:', flattenedData ? {
            pieces: flattenedData.pieces?.length,
            bounds: flattenedData.bounds
        } : null);
        
        this.flattenedData = flattenedData;
        this.seamData = seamData;
        
        // 自动适配视图
        this.fitToView();
        
        console.log('Renderer2D.render 完成');
    }
    
    /**
     * 重绘
     */
    redraw() {
        this.ctx.save();
        
        // 清空画布
        this.ctx.fillStyle = this.styles.backgroundColor;
        this.ctx.fillRect(0, 0, this.width, this.height);
        
        // 绘制网格
        this.drawGrid();
        
        // 如果有数据，绘制展开的网格
        if (this.flattenedData) {
            this.drawFlattenedMesh();
        }
        
        this.ctx.restore();
    }
    
    /**
     * 绘制背景网格
     */
    drawGrid() {
        const gridSize = 50 * this.viewTransform.scale;
        const subGridSize = gridSize / 5;
        
        // 子网格
        this.ctx.strokeStyle = this.styles.gridSubColor;
        this.ctx.lineWidth = 0.5;
        this.ctx.beginPath();
        
        const startX = this.viewTransform.offsetX % subGridSize;
        const startY = this.viewTransform.offsetY % subGridSize;
        
        for (let x = startX; x < this.width; x += subGridSize) {
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.height);
        }
        for (let y = startY; y < this.height; y += subGridSize) {
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.width, y);
        }
        this.ctx.stroke();
        
        // 主网格
        this.ctx.strokeStyle = this.styles.gridColor;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        
        const mainStartX = this.viewTransform.offsetX % gridSize;
        const mainStartY = this.viewTransform.offsetY % gridSize;
        
        for (let x = mainStartX; x < this.width; x += gridSize) {
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.height);
        }
        for (let y = mainStartY; y < this.height; y += gridSize) {
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.width, y);
        }
        this.ctx.stroke();
        
        // 原点坐标轴
        const originX = this.viewTransform.offsetX;
        const originY = this.viewTransform.offsetY;
        
        // X轴
        this.ctx.strokeStyle = '#ff4757';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(originX, originY);
        this.ctx.lineTo(originX + 60, originY);
        this.ctx.stroke();
        
        // Y轴
        this.ctx.strokeStyle = '#2ed573';
        this.ctx.beginPath();
        this.ctx.moveTo(originX, originY);
        this.ctx.lineTo(originX, originY - 60);
        this.ctx.stroke();
    }
    
    /**
     * 绘制展开的网格
     */
    drawFlattenedMesh() {
        if (!this.flattenedData || !this.flattenedData.pieces) {
            console.log('Renderer2D: 没有展开数据或pieces');
            return;
        }
        
        const { offsetX, offsetY, scale } = this.viewTransform;
        const pieces = this.flattenedData.pieces;
        
        console.log(`Renderer2D: 绘制 ${pieces.length} 个UV岛, scale=${scale}, offset=(${offsetX}, ${offsetY})`);
        
        // 绘制每个片段
        pieces.forEach((piece, pieceIndex) => {
            const { uv, localFaces, hasTopologyError } = piece;
            
            if (!uv || !localFaces) {
                console.warn(`Renderer2D: piece ${pieceIndex} 缺少uv或localFaces`);
                return;
            }
            
            // 检查是否被选中
            const isSelected = this.selectedIsland === pieceIndex;
            
            // 绘制面（对于大模型，只绘制边界或简化）
            const maxFacesToDraw = 10000; // 限制绘制的面数
            const facesToDraw = localFaces.length > maxFacesToDraw 
                ? localFaces.filter((_, i) => i % Math.ceil(localFaces.length / maxFacesToDraw) === 0)
                : localFaces;
            
            facesToDraw.forEach(face => {
                if (!face || face.length < 3) return;
                
                const firstPoint = uv[face[0]];
                if (!firstPoint) return;
                
                this.ctx.beginPath();
                
                const screenX = offsetX + firstPoint.u * scale * 200;
                const screenY = offsetY - firstPoint.v * scale * 200;
                this.ctx.moveTo(screenX, screenY);
                
                for (let i = 1; i < face.length; i++) {
                    const point = uv[face[i]];
                    if (!point) continue;
                    const sx = offsetX + point.u * scale * 200;
                    const sy = offsetY - point.v * scale * 200;
                    this.ctx.lineTo(sx, sy);
                }
                
                this.ctx.closePath();
                
                // 填充颜色 - 每个岛不同颜色
                // 拓扑错误的用红色系，正常的用蓝绿色系
                let fillColor, strokeColor;
                
                if (hasTopologyError) {
                    // 拓扑错误 - 红色/橙色，提示需要补刀
                    if (isSelected) {
                        fillColor = 'rgba(255, 60, 60, 0.6)';
                        strokeColor = '#ff0000';
                    } else {
                        fillColor = 'rgba(255, 100, 50, 0.35)';
                        strokeColor = '#ff6633';
                    }
                } else {
                    // 正常拓扑 - 蓝绿色系
                    const hue = (pieceIndex * 37) % 360;
                    if (isSelected) {
                        fillColor = `hsla(${hue}, 90%, 60%, 0.5)`;
                        strokeColor = '#ffffff';
                    } else {
                        fillColor = `hsla(${hue}, 70%, 50%, 0.25)`;
                        strokeColor = this.styles.meshStrokeColor;
                    }
                }
                
                this.ctx.fillStyle = fillColor;
                this.ctx.fill();
                
                this.ctx.strokeStyle = strokeColor;
                this.ctx.lineWidth = isSelected ? 1.5 : 0.5;
                this.ctx.stroke();
            });
            
            // 绘制UV岛标签
            this.drawIslandLabel(piece, pieceIndex, isSelected, hasTopologyError);
        });
        
        // 绘制缝线
        this.drawSeams();
    }
    
    /**
     * 绘制UV岛标签
     */
    drawIslandLabel(piece, index, isSelected, hasTopologyError = false) {
        const { offsetX, offsetY, scale } = this.viewTransform;
        const bounds = piece.bounds;
        
        if (!bounds) return;
        
        const centerU = (bounds.minU + bounds.maxU) / 2;
        const centerV = (bounds.minV + bounds.maxV) / 2;
        const screenX = offsetX + centerU * scale * 200;
        const screenY = offsetY - centerV * scale * 200;
        
        // 绘制标签背景
        let label = `#${index + 1}`;
        if (hasTopologyError) {
            label += ' ⚠️';  // 添加警告图标
        }
        
        this.ctx.font = '12px Arial';
        const textWidth = this.ctx.measureText(label).width;
        
        // 拓扑错误用红色背景
        if (hasTopologyError) {
            this.ctx.fillStyle = isSelected ? 'rgba(255,100,100,0.95)' : 'rgba(255,50,50,0.8)';
        } else {
            this.ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.7)';
        }
        this.ctx.fillRect(screenX - textWidth/2 - 4, screenY - 8, textWidth + 8, 16);
        
        // 绘制标签文字
        this.ctx.fillStyle = (isSelected && !hasTopologyError) ? '#000' : '#fff';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(label, screenX, screenY);
    }
    
    /**
     * 绘制缝线
     */
    drawSeams() {
        if (!this.flattenedData || !this.flattenedData.seams) return;
        
        const { offsetX, offsetY, scale } = this.viewTransform;
        
        this.ctx.strokeStyle = this.styles.seamColor;
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        
        this.flattenedData.seams.forEach(seam => {
            if (!seam.edges) return;
            
            seam.edges.forEach(([v1, v2]) => {
                // 在每个片段中查找这条边
                this.flattenedData.pieces.forEach(piece => {
                    const localV1 = piece.vertexMap.get(v1);
                    const localV2 = piece.vertexMap.get(v2);
                    
                    if (localV1 !== undefined && localV2 !== undefined) {
                        const p1 = piece.uv[localV1];
                        const p2 = piece.uv[localV2];
                        
                        if (p1 && p2) {
                            const sx1 = offsetX + p1.u * scale * 200;
                            const sy1 = offsetY - p1.v * scale * 200;
                            const sx2 = offsetX + p2.u * scale * 200;
                            const sy2 = offsetY - p2.v * scale * 200;
                            
                            this.ctx.beginPath();
                            this.ctx.moveTo(sx1, sy1);
                            this.ctx.lineTo(sx2, sy2);
                            this.ctx.stroke();
                        }
                    }
                });
            });
        });
        
        this.ctx.setLineDash([]);
    }
    
    /**
     * 适配视图
     */
    fitToView() {
        if (!this.flattenedData) {
            console.log('fitToView: 没有数据');
            return;
        }
        
        const bounds = this.flattenedData.bounds;
        console.log('fitToView bounds:', bounds);
        
        if (!bounds || bounds.minU === undefined || bounds.maxU === undefined ||
            bounds.minU === Infinity || bounds.maxU === -Infinity) {
            console.warn('fitToView: bounds 无效，使用默认值');
            this.viewTransform.scale = 1;
            this.viewTransform.offsetX = this.width / 2;
            this.viewTransform.offsetY = this.height / 2;
            this.redraw();
            return;
        }
        
        const padding = 50;
        
        const dataWidth = Math.max((bounds.maxU - bounds.minU) * 200, 1);
        const dataHeight = Math.max((bounds.maxV - bounds.minV) * 200, 1);
        
        console.log('fitToView: dataWidth=', dataWidth, 'dataHeight=', dataHeight);
        
        const scaleX = (this.width - padding * 2) / dataWidth;
        const scaleY = (this.height - padding * 2) / dataHeight;
        
        this.viewTransform.scale = Math.min(scaleX, scaleY, 2);
        
        // 确保scale有效
        if (!isFinite(this.viewTransform.scale) || this.viewTransform.scale <= 0) {
            this.viewTransform.scale = 1;
        }
        
        console.log('fitToView: scale=', this.viewTransform.scale);
        
        // 居中
        const scaledWidth = dataWidth * this.viewTransform.scale;
        const scaledHeight = dataHeight * this.viewTransform.scale;
        
        this.viewTransform.offsetX = (this.width - scaledWidth) / 2 - bounds.minU * 200 * this.viewTransform.scale;
        this.viewTransform.offsetY = this.height - (this.height - scaledHeight) / 2 + bounds.minV * 200 * this.viewTransform.scale;
        
        this.redraw();
        this.updateScaleIndicator();
    }
    
    /**
     * 更新缩放指示器
     */
    updateScaleIndicator() {
        const indicator = document.getElementById('scale-2d');
        if (indicator) {
            const scalePercent = Math.round(this.viewTransform.scale * 100);
            indicator.textContent = `${scalePercent}%`;
        }
    }
    
    /**
     * 设置缝线颜色
     */
    setSeamColor(color) {
        this.styles.seamColor = color;
        this.redraw();
    }
    
    /**
     * 清空画布
     */
    clear() {
        this.flattenedData = null;
        this.seamData = null;
        this.viewTransform = { offsetX: 0, offsetY: 0, scale: 1 };
        this.redraw();
    }
    
    /**
     * 导出为SVG
     */
    exportSVG(flattenedData, seamData) {
        if (!flattenedData) return '';
        
        const bounds = flattenedData.bounds;
        const padding = 20;
        const scale = 200;
        
        const width = (bounds.maxU - bounds.minU) * scale + padding * 2;
        const height = (bounds.maxV - bounds.minV) * scale + padding * 2;
        
        let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .mesh-face { fill: rgba(0, 212, 255, 0.15); stroke: #2a3548; stroke-width: 1; }
    .seam { stroke: ${this.styles.seamColor}; stroke-width: 2; stroke-dasharray: 5,5; fill: none; }
  </style>
  <rect width="100%" height="100%" fill="#0a0e14"/>
`;
        
        // 绘制面
        flattenedData.pieces.forEach((piece, pieceIndex) => {
            const { uv, localFaces } = piece;
            const hue = (pieceIndex * 60) % 360;
            
            localFaces.forEach(face => {
                const points = face.map(vIdx => {
                    const p = uv[vIdx];
                    const x = padding + (p.u - bounds.minU) * scale;
                    const y = padding + (bounds.maxV - p.v) * scale;
                    return `${x.toFixed(2)},${y.toFixed(2)}`;
                }).join(' ');
                
                svg += `  <polygon points="${points}" class="mesh-face" style="fill: hsla(${hue}, 70%, 50%, 0.15);"/>\n`;
            });
        });
        
        // 绘制缝线
        if (flattenedData.seams) {
            flattenedData.seams.forEach(seam => {
                if (!seam.edges) return;
                
                seam.edges.forEach(([v1, v2]) => {
                    flattenedData.pieces.forEach(piece => {
                        const localV1 = piece.vertexMap.get(v1);
                        const localV2 = piece.vertexMap.get(v2);
                        
                        if (localV1 !== undefined && localV2 !== undefined) {
                            const p1 = piece.uv[localV1];
                            const p2 = piece.uv[localV2];
                            
                            if (p1 && p2) {
                                const x1 = padding + (p1.u - bounds.minU) * scale;
                                const y1 = padding + (bounds.maxV - p1.v) * scale;
                                const x2 = padding + (p2.u - bounds.minU) * scale;
                                const y2 = padding + (bounds.maxV - p2.v) * scale;
                                
                                svg += `  <line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="seam"/>\n`;
                            }
                        }
                    });
                });
            });
        }
        
        svg += '</svg>';
        return svg;
    }
}

