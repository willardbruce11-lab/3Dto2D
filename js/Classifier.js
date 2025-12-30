/**
 * 部件分类器
 * 根据部件内部是否包含裁线，决定展开策略
 */
export class Classifier {
    /**
     * 对子网格进行分类
     * @param {Array} subMeshes 
     * @returns {Object} 分类后的结果
     */
    static classify(subMeshes) {
        const withInternalSeams = [];
        const withoutInternalSeams = [];

        for (const subMesh of subMeshes) {
            // 如果内部红点数量超过一定阈值（排除噪声），则认为含有内部裁线
            if (subMesh.internalRedVertices && subMesh.internalRedVertices.size > 5) {
                subMesh.strategy = 'INTERNAL_SEAMS';
                withInternalSeams.push(subMesh);
            } else {
                subMesh.strategy = 'NO_INTERNAL_SEAMS';
                withoutInternalSeams.push(subMesh);
            }
        }

        console.log(`分类完成: ${withInternalSeams.length} 个含内部裁线部件, ${withoutInternalSeams.length} 个无内部裁线部件`);
        return { withInternalSeams, withoutInternalSeams };
    }
}
