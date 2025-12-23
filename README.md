# 3D布料展开编辑器 (Cloth Flattener)

一个Web端3D编辑器，可以将带有JSON格式缝线数据的OBJ 3D模型从3D曲面展开摊平成2D平面。

![Preview](preview.png)

## 功能特性

- 🎨 **3D视图** - 加载和显示OBJ格式的3D模型，支持旋转、缩放、平移
- 📐 **2D展开视图** - 显示展开后的2D平面图案
- ✂️ **缝线数据支持** - 读取JSON格式的缝线定义，按缝线进行切割和展开
- 🚀 **BFF快速展开** - 基于Boundary First Flattening的高性能算法，支持WASM加速
- 🔧 **多种展开算法** - 支持BFF、ABF、共形映射、LSCM等方法
- 📤 **SVG导出** - 将展开结果导出为SVG矢量图
- 🎛️ **可视化设置** - 自定义网格显示、缝线颜色等

## 快速开始

### 方式一：直接打开

直接在浏览器中打开 `index.html` 文件即可使用（需要支持ES Modules的现代浏览器）。

### 方式二：使用本地服务器

```bash
# 使用Python启动服务器
python3 -m http.server 3000

# 或使用Node.js
npx http-server -p 3000 -c-1
```

然后在浏览器中访问 `http://localhost:3000`

## 使用方法

1. **加载OBJ模型** - 点击"加载OBJ"按钮，选择你的3D模型文件
2. **加载缝线数据** - 点击"加载缝线JSON"按钮，选择对应的缝线定义文件
3. **选择展开算法** - 右侧面板选择展开方法（推荐BFF快速展开）
4. **执行展开** - 点击"展开到2D"按钮，系统将根据缝线数据展开模型
5. **查看结果** - 在右侧2D视图中查看展开结果，可以缩放和平移
6. **导出** - 点击导出按钮将结果保存为SVG文件

## 缝线JSON格式

```json
{
  "name": "示例缝线数据",
  "seams": [
    {
      "id": "seam_1",
      "name": "侧边缝线",
      "type": "cut",
      "vertices": [0, 10, 20, 30]
    },
    {
      "id": "seam_2", 
      "name": "底边缝线",
      "type": "sew",
      "edges": [[0, 1], [1, 2], [2, 3]]
    }
  ]
}
```

### 缝线类型

- `cut` - 切割边：沿此线切开网格，展开时会分离
- `sew` - 缝合边：标记需要缝合的边，仅作标记不切开

### 缝线定义方式

支持两种定义方式：

1. **顶点列表** (`vertices`): 连续的顶点索引数组，如 `[0, 1, 2, 3]` 表示 0-1, 1-2, 2-3 三条边
2. **边列表** (`edges`): 明确的边定义数组，如 `[[0,1], [1,2]]` 表示两条边

## 示例文件

在 `examples/` 目录下提供了示例文件：

- `shirt_front.obj` - 衬衫前片3D模型
- `shirt_front_seams.json` - 衬衫前片缝线数据
- `cylinder.obj` - 圆柱体模型
- `cylinder_seams.json` - 圆柱体展开缝线

## 展开算法说明

### BFF 快速展开 (推荐)
基于 **Boundary First Flattening** 算法的高效实现。采用三角形铺展法初始化，配合拉普拉斯平滑优化。支持WebAssembly加速，处理大型网格时性能显著优于传统方法。

### 基于角度 (ABF - Angle Based Flattening)
通过保持展开后的角度与原始3D角度尽可能接近来实现展开，适合大多数服装布料。

### 共形映射 (Conformal)
保持角度不变的映射方法，展开结果保持局部形状不变形。

### 最小二乘共形 (LSCM)
通过最小化边长变形来优化展开结果，适合需要精确尺寸的场景。

## WASM加速（可选）

项目支持使用WebAssembly加速展开计算。如需编译WASM模块：

### 前置条件

安装 [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)：

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

### 编译WASM

```bash
cd wasm
chmod +x build.sh
./build.sh
```

编译成功后会生成 `js/bff_wasm.js`，前端会自动检测并使用WASM加速。

## 项目结构

```
3Dto2D/
├── index.html           # 主页面
├── css/
│   └── style.css        # 样式文件
├── js/
│   ├── main.js          # 主程序
│   ├── OBJParser.js     # OBJ文件解析器
│   ├── SeamProcessor.js # 缝线处理器
│   ├── MeshFlattener.js # 传统展开算法
│   ├── BFFFlattener.js  # BFF展开器（JS/WASM）
│   └── Renderer2D.js    # 2D渲染器
├── wasm/                # WASM源代码
│   ├── src/
│   │   ├── bff_flattener.h
│   │   ├── bff_flattener.cpp
│   │   └── bindings.cpp
│   ├── Makefile
│   └── build.sh
├── examples/            # 示例文件
│   ├── shirt_front.obj
│   ├── shirt_front_seams.json
│   ├── cylinder.obj
│   └── cylinder_seams.json
└── README.md
```

## 技术栈

- **Three.js** - 3D渲染引擎
- **Canvas 2D** - 2D图案渲染
- **WebAssembly** - C++算法加速（可选）
- **原生JavaScript (ES Modules)** - 无框架依赖

## 浏览器支持

- Chrome 89+
- Firefox 89+
- Safari 15+
- Edge 89+

需要支持 ES Modules 和 Import Maps。

## 许可证

MIT License
