// 知识库分组与文件映射
const KNOWLEDGE_FILE_MAP = {
  "其他": "kg_part_1.js",
  "第三篇 QC七大手法": "kg_part_2.js",
  "第五篇 SPC统计过程控制深入（含全部计算）": "kg_part_3.js",
  "第七篇 质量工具进阶与拓展": "kg_part_4.js",
  "第八篇 质量管理基础方法与现场工具补充": "kg_part_5.js",
  "第十三篇 体系文件编制方法与要点": "kg_part_6.js",
  "第十四篇 体系认证规则详解与落地": "kg_part_7.js",
  "第十五篇 QC080000有害物质过程管理体系": "kg_part_8.js",
  "第十七篇 检验标准与规范编制方法": "kg_part_9.js",
  "第十九篇 行业体系与专项管理补充": "kg_part_10.js",
  "第二十篇 产品全生命周期质量管理": "kg_part_11.js",
  "第二十一篇 可靠性工程体系建设——从0到1建可靠性管理": "kg_part_12.js",
  "第二十二篇 企业合规与社会责任": "kg_part_13.js",
  "第二十三篇 产品结构、包装与电商合规": "kg_part_14.js",
  "第二十四篇 从0到1搭建企业合规体系": "kg_part_15.js",
  "第二十五篇 环保合规实操——环评/排污许可/排污登记一步一步": "kg_part_16.js",
  "第二十六篇 质量岗位手册——检验员/质量工程师/质量经理": "kg_part_17.js",
  "第二十七篇 落地案例与操作手册": "kg_part_18.js",
  "第二十八篇 质量管理知识补充（30个核心知识点）": "kg_part_19.js",
  "第二十九篇 质量管理知识再补充（精益+检验+可靠性+管理30讲）": "kg_part_20.js"
};

// 已加载的分组内容缓存
const knowledgeContentCache = {};

// 加载指定分组的内容
function loadKnowledgeGroup(group, callback) {
  if (knowledgeContentCache[group]) {
    if (callback) callback(knowledgeContentCache[group]);
    return;
  }
  const filename = KNOWLEDGE_FILE_MAP[group];
  if (!filename) {
    if (callback) callback({});
    return;
  }
  const script = document.createElement('script');
  script.src = filename;
  script.onload = function() {
    // 从全局变量中获取内容
    const partNum = filename.match(/kg_part_(\d+)\.js/)[1];
    const varName = 'KNOWLEDGE_PART_' + partNum;
    knowledgeContentCache[group] = window[varName] || {};
    if (callback) callback(knowledgeContentCache[group]);
  };
  script.onerror = function() {
    if (callback) callback({});
  };
  document.head.appendChild(script);
}

// 获取知识点内容
function getKnowledgeContent(title, callback) {
  const group = getKnowledgeGroup(title);
  if (!group) {
    if (callback) callback('未找到该知识点');
    return;
  }
  loadKnowledgeGroup(group, function(contents) {
    if (callback) callback(contents[title] || '内容加载失败');
  });
}
