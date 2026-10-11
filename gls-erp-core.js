/*! gls-erp-core.js —— 格丽思 ERP 业务子系统（自动合并） */
/*!
 * gls-erp-core.js —— 格丽思质量管理工作台 · ERP 业务子系统
 * 覆盖常规 ERP 主干：基础资料 / 销售 / 采购 / 仓储 / 生产 / 报表
 * 数据存于 appData.erp，随工作台数据一起持久化
 */
(function (global) {

  /* ==================== 通用工具 ==================== */
  function $(id) { return document.getElementById(id); }
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escAttr(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }
  function toast(m, t) { if (typeof global.showToast === 'function') global.showToast(m, t || ''); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function uid(p) { return (p || 'e') + Date.now().toString(36) + Math.random().toString(36).substr(2, 4); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function money(v) { return num(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /* ==================== 实体定义 ==================== */
  var UNITS = ['PCS', '个', '套', '只', 'kg', 'g', 'm', 'L', '箱', '卷'];
  var CATS = ['塑胶件', '五金件', '电子件', '发热件', '包材', '辅料', '半成品', '成品'];
  var GRADES = ['A级', 'B级', 'C级'];
  var FLOW_STATUS = ['待处理', '进行中', '已完成', '已取消'];
  var DOC_STATUS = ['草稿', '待审核', '已审核', '已关闭'];

  var ENTITIES = {
    /* ---------- 基础资料 ---------- */
    material: {
      key: 'material', name: '物料档案', icon: '📦', group: '基础资料', prefix: 'M',
      desc: '料号、规格、适用产品、单位、安全库存、参考单价',
      fields: [
        { k: 'code', label: '物料编码', type: 'text', req: true, auto: true, w: '130px' },
        { k: 'name', label: '物料名称', type: 'text', req: true, w: '120px' },
        { k: 'products', label: '适用产品', type: 'select', dict: '产品', w: '150px' },
        { k: 'spec', label: '规格型号', type: 'text', w: '130px' },
        { k: 'unit', label: '单位', type: 'select', opts: UNITS, def: 'PCS', w: '60px' },
        { k: 'category', label: '类别', type: 'select', opts: CATS, w: '80px' },
        { k: 'location', label: '库位', type: 'select', dict: '库位', dictFrom: 'warehouse.location', w: '110px' },
        { k: 'safeStock', label: '安全库存', type: 'number', w: '85px' },
        { k: 'price', label: '参考单价', type: 'number', w: '80px' },
        { k: 'supplier', label: '默认供应商', type: 'ref', ref: 'supplier', w: '90px' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    customer: {
      key: 'customer', name: '客户档案', icon: '👥', group: '基础资料', prefix: 'C',
      desc: '客户信息、等级、信用额度',
      fields: [
        { k: 'code', label: '客户编码', type: 'text', req: true, auto: true, w: '120px' },
        { k: 'name', label: '客户名称', type: 'text', req: true },
        { k: 'contact', label: '联系人', type: 'text' },
        { k: 'phone', label: '联系电话', type: 'text' },
        { k: 'address', label: '地址', type: 'text' },
        { k: 'level', label: '等级', type: 'select', opts: GRADES },
        { k: 'credit', label: '信用额度', type: 'number' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    supplier: {
      key: 'supplier', name: '供应商档案', icon: '🏭', group: '基础资料', prefix: 'S',
      desc: '供应商基础信息（质量绩效见「供应商管理」）',
      fields: [
        { k: 'code', label: '供应商编码', type: 'text', req: true, auto: true, w: '120px' },
        { k: 'name', label: '供应商名称', type: 'text', req: true },
        { k: 'contact', label: '联系人', type: 'text' },
        { k: 'phone', label: '联系电话', type: 'text' },
        { k: 'address', label: '地址', type: 'text' },
        { k: 'level', label: '等级', type: 'select', opts: GRADES },
        { k: 'supplyCat', label: '供货类别', type: 'select', opts: CATS },
        { k: 'supplyCode', label: '供应产品编码', type: 'text', w: '130px' },
        { k: 'supplyName', label: '供应产品名称', type: 'text' },
        { k: 'supplySpec', label: '产品规格/型号', type: 'text' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    warehouse: {
      key: 'warehouse', name: '仓库设置', icon: '🏬', group: '基础资料', prefix: 'W',
      desc: '仓库、库位、保管员',
      fields: [
        { k: 'code', label: '仓库编码', type: 'text', req: true, auto: true, w: '120px' },
        { k: 'name', label: '仓库名称', type: 'text', req: true },
        { k: 'location', label: '库位', type: 'select', dict: '库位' },
        { k: 'keeper', label: '保管员', type: 'select', dict: '人员' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    bom: {
      key: 'bom', name: 'BOM 清单', icon: '🧩', group: '基础资料', prefix: 'B',
      desc: '产品物料结构：单台用量、损耗率',
      fields: [
        { k: 'code', label: 'BOM编号', type: 'text', req: true, auto: true, w: '120px' },
        { k: 'product', label: '产品', type: 'ref', ref: 'material', req: true },
        { k: 'version', label: '版本', type: 'text', def: 'V1.0' },
        { k: 'items', label: '物料明细', type: 'items', cols: [
          { k: 'code', label: '物料', type: 'ref', ref: 'material', w: '200px' },
          { k: 'qty', label: '单台用量', type: 'number', w: '90px' },
          { k: 'unit', label: '单位', type: 'select', dict: '单位', w: '70px', autoFrom: 'code:unit' },
          { k: 'loss', label: '损耗率%', type: 'number', w: '80px' },
          { k: 'remark', label: '备注', type: 'text' }
        ] },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },

    equip: {
      key: 'equip', name: '检测设备一览表', icon: '🧰', group: '基础资料', prefix: 'EQ',
      desc: '计量器具 / 检测设备台账：规格、量程、检定周期、有效期、校准证书',
      fields: [
        { k: 'code', label: '设备编号', type: 'text', req: true, auto: true, w: '110px' },
        { k: 'name', label: '设备名称', type: 'text', req: true, w: '170px' },
        { k: 'spec', label: '规格型号', type: 'text', w: '140px' },
        { k: 'range', label: '测量范围', type: 'text', w: '120px' },
        { k: 'grade', label: '准确度 / 分度值', type: 'text', w: '130px' },
        { k: 'maker', label: '制造厂', type: 'text', w: '120px' },
        { k: 'sn', label: '出厂编号', type: 'text', w: '110px' },
        { k: 'calibType', label: '校准方式', type: 'select', dict: '校准方式', w: '100px' },
        { k: 'cycle', label: '检定周期(月)', type: 'number', def: '12', w: '95px' },
        { k: 'lastDate', label: '上次检定日期', type: 'date', w: '115px' },
        { k: 'nextDate', label: '下次检定日期', type: 'date', w: '115px' },
        { k: 'org', label: '检定 / 校准机构', type: 'text', w: '150px' },
        { k: 'cert', label: '证书编号', type: 'text', w: '130px' },
        { k: 'result', label: '检定结论', type: 'select', dict: '检定结论', w: '90px' },
        { k: 'status', label: '设备状态', type: 'select', dict: '设备状态', def: '在用', w: '90px' },
        { k: 'location', label: '存放位置', type: 'text', w: '120px' },
        { k: 'owner', label: '使用部门', type: 'select', dict: '部门', w: '100px' },
        { k: 'keeper', label: '责任人', type: 'select', dict: '人员', w: '90px' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },

    /* ---------- 销售 ---------- */
    so: {
      key: 'so', name: '销售订单', icon: '📝', group: '销售管理', prefix: 'SO',
      desc: '客户订单：明细、金额、交期',
      fields: [
        { k: 'code', label: '订单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'customer', label: '客户', type: 'ref', ref: 'customer', req: true },
        { k: 'orderDate', label: '下单日期', type: 'date', def: 'today' },
        { k: 'deliveryDate', label: '交货日期', type: 'date' },
        { k: 'items', label: '订单明细', type: 'items', cols: [
          { k: 'code', label: '物料/产品', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'qty', label: '数量', type: 'number', w: '90px' },
          { k: 'unit', label: '单位', type: 'select', dict: '单位', w: '70px', autoFrom: 'code:unit' },
          { k: 'price', label: '单价', type: 'number', w: '90px' },
          { k: 'amount', label: '金额', type: 'calc', expr: 'qty*price', w: '100px' }
        ] },
        { k: 'amount', label: '订单总额', type: 'calcSum', of: 'items', col: 'amount' },
        { k: 'status', label: '状态', type: 'select', opts: FLOW_STATUS, def: '待处理' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    soShip: {
      key: 'soShip', name: '销售发货', icon: '🚚', group: '销售管理', prefix: 'FH',
      desc: '按订单发货，同步出库',
      fields: [
        { k: 'code', label: '发货单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'soCode', label: '关联订单号', type: 'ref', ref: 'so',
          fill: { from: 'so', items: 'items', map: { customer: 'customer' } },
          tip: '选择订单后自动带出客户与订单明细' },
        { k: 'customer', label: '客户', type: 'ref', ref: 'customer' },
        { k: 'shipDate', label: '发货日期', type: 'date', def: 'today' },
        { k: 'warehouse', label: '发货仓库', type: 'ref', ref: 'warehouse' },
        { k: 'items', label: '发货明细', type: 'items', cols: [
          { k: 'code', label: '物料/产品', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'location', label: '库位', type: 'select', dict: '库位', dictFrom: 'warehouse.location', w: '110px', autoFrom: 'code:location' },
          { k: 'qty', label: '数量', type: 'number', w: '90px' },
          { k: 'unit', label: '单位', type: 'select', dict: '单位', w: '70px', autoFrom: 'code:unit' }
        ] },
        { k: 'status', label: '状态', type: 'select', opts: FLOW_STATUS, def: '待处理' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    soReturn: {
      key: 'soReturn', name: '销售退货', icon: '↩️', group: '销售管理', prefix: 'ST',
      desc: '客户退货，同步退货入库',
      fields: [
        { k: 'code', label: '退货单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'soCode', label: '关联订单号', type: 'ref', ref: 'so',
          fill: { from: 'so', items: 'items', map: { customer: 'customer' } },
          tip: '选择订单后自动带出客户与退货明细' },
        { k: 'customer', label: '客户', type: 'ref', ref: 'customer' },
        { k: 'returnDate', label: '退货日期', type: 'date', def: 'today' },
        { k: 'items', label: '退货明细', type: 'items', cols: [
          { k: 'code', label: '物料/产品', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'location', label: '库位', type: 'select', dict: '库位', dictFrom: 'warehouse.location', w: '110px', autoFrom: 'code:location' },
          { k: 'qty', label: '数量', type: 'number', w: '90px' },
          { k: 'reason', label: '退货原因', type: 'select', dict: '退货原因' }
        ] },
        { k: 'status', label: '状态', type: 'select', opts: FLOW_STATUS, def: '待处理' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },

        afterSale: {
      key: 'afterSale', name: '售后分析', icon: '📊', group: '售后管理', prefix: 'AS',
      desc: '品质部售后分析：故障数据、原因与措施',
      fields: [
        { k: 'code', label: '分析编号', type: 'text', req: true, auto: true, w: '130px' },
        { k: 'rtnCode', label: '关联退货单', type: 'text' },
        { k: 'product', label: '产品', type: 'ref', ref: 'material', req: true },
        { k: 'qty', label: '退货数量', type: 'number' },
        { k: 'fault', label: '故障现象', type: 'text' },
        { k: 'cause', label: '原因分析', type: 'textarea' },
        { k: 'measure', label: '纠正措施', type: 'textarea' },
        { k: 'owner', label: '分析人', type: 'select', dict: '人员' },
        { k: 'date', label: '分析日期', type: 'date', def: 'today' },
        { k: 'status', label: '状态', type: 'select', opts: ['待分析', '已分析', '已完成'], def: '待分析' }
      ]
    },
    renovate: {
      key: 'renovate', name: '售后翻新', icon: '🛠️', group: '售后管理', prefix: 'RN',
      desc: '售后翻新工单：翻新产品、数量与进度',
      fields: [
        { k: 'code', label: '翻新单号', type: 'text', req: true, auto: true, w: '130px' },
        { k: 'rtnCode', label: '关联退货单', type: 'text' },
        { k: 'product', label: '产品', type: 'ref', ref: 'material', req: true },
        { k: 'qty', label: '翻新数量', type: 'number' },
        { k: 'status', label: '状态', type: 'select', opts: ['待翻新', '翻新中', '已完成'] },
        { k: 'owner', label: '负责人', type: 'select', dict: '人员' },
        { k: 'startDate', label: '开始日期', type: 'date', def: 'today' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },

/* ---------- 采购 ---------- */
    pr: {
      key: 'pr', name: '采购申请', icon: '📋', group: '采购管理', prefix: 'PR',
      desc: '需求部门请购',
      fields: [
        { k: 'code', label: '申请单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'moCode', label: '关联生产工单', type: 'ref', ref: 'mo',
          fill: { from: 'mo', items: null },
          tip: '选择生产工单后自动带出申请部门与产品需求' },
        { k: 'dept', label: '申请部门', type: 'select', dict: '部门' },
        { k: 'applicant', label: '申请人', type: 'select', dict: '人员' },
        { k: 'applyDate', label: '申请日期', type: 'date', def: 'today' },
        { k: 'items', label: '申请明细', type: 'items', cols: [
          { k: 'code', label: '物料', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'qty', label: '数量', type: 'number', w: '90px' },
          { k: 'needDate', label: '需求日期', type: 'date', w: '130px' }
        ] },
        { k: 'status', label: '状态', type: 'select', opts: FLOW_STATUS, def: '待处理' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    po: {
      key: 'po', name: '采购订单', icon: '🛒', group: '采购管理', prefix: 'PO',
      desc: '向供应商下单',
      fields: [
        { k: 'code', label: '采购单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'prCode', label: '关联采购申请', type: 'ref', ref: 'pr',
          fill: { from: 'pr', items: 'items' },
          tip: '选择采购申请后自动带出申请明细' },
        { k: 'supplier', label: '供应商', type: 'ref', ref: 'supplier', req: true },
        { k: 'orderDate', label: '下单日期', type: 'date', def: 'today' },
        { k: 'deliveryDate', label: '交货日期', type: 'date' },
        { k: 'items', label: '采购明细', type: 'items', cols: [
          { k: 'code', label: '物料', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'qty', label: '数量', type: 'number', w: '90px' },
          { k: 'unit', label: '单位', type: 'select', dict: '单位', w: '70px', autoFrom: 'code:unit' },
          { k: 'price', label: '单价', type: 'number', w: '90px' },
          { k: 'amount', label: '金额', type: 'calc', expr: 'qty*price', w: '100px' }
        ] },
        { k: 'amount', label: '采购总额', type: 'calcSum', of: 'items', col: 'amount' },
        { k: 'status', label: '状态', type: 'select', opts: FLOW_STATUS, def: '待处理' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    poRecv: {
      key: 'poRecv', name: '采购收货', icon: '📥', group: '采购管理', prefix: 'RC',
      desc: '到货点收，转检验与入库',
      fields: [
        { k: 'code', label: '收货单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'poCode', label: '关联采购单', type: 'ref', ref: 'po',
          fill: { from: 'po', items: 'items', map: { supplier: 'supplier' } },
          tip: '选择采购订单后自动带出供应商与到货明细' },
        { k: 'supplier', label: '供应商', type: 'ref', ref: 'supplier' },
        { k: 'recvDate', label: '收货日期', type: 'date', def: 'today' },
        { k: 'warehouse', label: '收货仓库', type: 'ref', ref: 'warehouse' },
        { k: 'items', label: '收货明细', type: 'items', cols: [
          { k: 'code', label: '物料', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'location', label: '库位', type: 'select', dict: '库位', dictFrom: 'warehouse.location', w: '110px', autoFrom: 'code:location' },
          { k: 'qty', label: '到货数量', type: 'number', w: '100px' },
          { k: 'okQty', label: '合格数量', type: 'number', w: '100px' },
          { k: 'batch', label: '批次号', type: 'text', w: '120px' }
        ] },
        { k: 'status', label: '状态', type: 'select', opts: FLOW_STATUS, def: '待处理' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },

    /* ---------- 仓储 ---------- */
    stockIn: {
      key: 'stockIn', name: '入库单', icon: '⬇️', group: '仓储管理', prefix: 'IN',
      desc: '采购入库 / 生产入库 / 退货入库，直接计入库存',
      fields: [
        { k: 'code', label: '入库单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'srcCode', label: '关联来源单', type: 'text',
          fill: { lookIn: ['poRecv', 'moIn'], items: 'items' },
          tip: '填采购收货单号或完工入库单号，自动带出明细' },
        { k: 'type', label: '入库类型', type: 'select', opts: ['采购入库', '生产入库', '退货入库', '其他入库'], def: '采购入库' },
        { k: 'inDate', label: '入库日期', type: 'date', def: 'today' },
        { k: 'warehouse', label: '仓库', type: 'ref', ref: 'warehouse' },
        { k: 'items', label: '入库明细', type: 'items', cols: [
          { k: 'code', label: '物料', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'location', label: '库位', type: 'select', dict: '库位', dictFrom: 'warehouse.location', w: '110px', autoFrom: 'code:location' },
          { k: 'qty', label: '数量', type: 'number', w: '90px' },
          { k: 'unit', label: '单位', type: 'select', dict: '单位', w: '70px', autoFrom: 'code:unit' },
          { k: 'batch', label: '批次号', type: 'text', w: '120px' }
        ] },
        { k: 'source', label: '来源单号', type: 'text' },
        { k: 'operator', label: '经手人', type: 'select', dict: '人员' },
        { k: 'status', label: '状态', type: 'select', opts: DOC_STATUS, def: '已审核' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    stockOut: {
      key: 'stockOut', name: '出库单', icon: '⬆️', group: '仓储管理', prefix: 'OUT',
      desc: '生产领料 / 销售出库，直接计入库存',
      fields: [
        { k: 'code', label: '出库单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'srcCode', label: '关联来源单', type: 'text',
          fill: { lookIn: ['moPick', 'soShip'], items: 'items' },
          tip: '填生产领料单号或销售发货单号，自动带出明细' },
        { k: 'type', label: '出库类型', type: 'select', opts: ['生产领料', '销售出库', '其他出库'], def: '生产领料' },
        { k: 'outDate', label: '出库日期', type: 'date', def: 'today' },
        { k: 'warehouse', label: '仓库', type: 'ref', ref: 'warehouse' },
        { k: 'items', label: '出库明细', type: 'items', cols: [
          { k: 'code', label: '物料', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'location', label: '库位', type: 'select', dict: '库位', dictFrom: 'warehouse.location', w: '110px', autoFrom: 'code:location' },
          { k: 'qty', label: '数量', type: 'number', w: '90px' },
          { k: 'unit', label: '单位', type: 'select', dict: '单位', w: '70px', autoFrom: 'code:unit' }
        ] },
        { k: 'source', label: '来源单号', type: 'text' },
        { k: 'receiver', label: '领用人', type: 'select', dict: '人员' },
        { k: 'status', label: '状态', type: 'select', opts: DOC_STATUS, def: '已审核' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    stockCheck: {
      key: 'stockCheck', name: '库存盘点', icon: '🔍', group: '仓储管理', prefix: 'CK',
      desc: '账面数与实盘数比对',
      fields: [
        { k: 'code', label: '盘点单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'checkDate', label: '盘点日期', type: 'date', def: 'today' },
        { k: 'warehouse', label: '仓库', type: 'ref', ref: 'warehouse' },
        { k: 'items', label: '盘点明细', type: 'items', cols: [
          { k: 'code', label: '物料', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'location', label: '库位', type: 'select', dict: '库位', dictFrom: 'warehouse.location', w: '110px', autoFrom: 'code:location' },
          { k: 'bookQty', label: '账面数', type: 'number', w: '90px', tip: '选物料后自动带出当前库存', autoFrom: 'code:__stock__' },
          { k: 'realQty', label: '实盘数', type: 'number', w: '90px' },
          { k: 'diff', label: '差异', type: 'calc', expr: 'realQty-bookQty', w: '80px' }
        ] },
        { k: 'checker', label: '盘点人', type: 'select', dict: '人员' },
        { k: 'status', label: '状态', type: 'select', opts: FLOW_STATUS, def: '进行中' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    stock: {
      key: 'stock', name: '库存台账', icon: '📊', group: '仓储管理', view: 'stock',
      desc: '汇总入库与出库自动结存（只读，导出可编辑）'
    },

    /* ---------- 生产 ---------- */
    mo: {
      key: 'mo', name: '生产工单', icon: '🏭', group: '生产管理', prefix: 'MO',
      desc: '工单下达、数量、进度、优先级（黑湖小工单式）',
      fields: [
        { k: 'code', label: '工单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'product', label: '生产产品', type: 'ref', ref: 'material', req: true },
        { k: 'planQty', label: '计划数量', type: 'number', req: true },
        { k: 'doneQty', label: '完成数量', type: 'number' },
        { k: 'curProcess', label: '当前工序', type: 'text', tip: '由报工自动推进，也可手动调整' },
        { k: 'priority', label: '优先级', type: 'select', opts: ['普通', '加急', '已暂停'], def: '普通', w: '90px' },
        { k: 'soCode', label: '关联订单', type: 'ref', ref: 'so' },
        { k: 'startDate', label: '开工日期', type: 'date', def: 'today' },
        { k: 'dueDate', label: '完工日期', type: 'date' },
        { k: 'line', label: '生产线别', type: 'select', dict: '生产线别' },
        { k: 'status', label: '状态', type: 'select', opts: ['待下达', '待料', '待生产', '生产中', '已完工', '已关闭'], def: '待下达' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    process: {
      key: 'process', name: '工序路线', icon: '🧭', group: '生产管理', prefix: 'PC',
      desc: '产品工艺路线：工序顺序、工价（黑湖式：计件/计时）',
      fields: [
        { k: 'code', label: '路线编号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'product', label: '产品', type: 'ref', ref: 'material', req: true, w: '170px' },
        { k: 'seq', label: '工序序号', type: 'number', req: true, w: '70px', tip: '1=第一道，报工按此顺序校验前序完工' },
        { k: 'name', label: '工序名称', type: 'text', req: true, w: '120px' },
        { k: 'line', label: '生产线别', type: 'select', dict: '生产线别', w: '90px' },
        { k: 'stdHours', label: '标准工时(分/件)', type: 'number', w: '100px' },
        { k: 'priceType', label: '工资类型', type: 'select', opts: ['计件', '计时'], def: '计件', w: '80px' },
        { k: 'price', label: '工价/时薪(元)', type: 'number', w: '90px', tip: '计件=每件元；计时=每小时元' },
        { k: 'isInsp', label: '检验工序', type: 'select', opts: ['否', '是'], def: '否', w: '80px' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    dispatch: {
      key: 'dispatch', name: '派工任务', icon: '📋', group: '生产管理', prefix: 'DP',
      desc: '班组长派工：工单+工序+员工+计划数（黑湖式快速派发）',
      fields: [
        { k: 'code', label: '派工单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'moCode', label: '关联工单', type: 'ref', ref: 'mo', req: true,
          fill: { from: 'mo', items: null, map: { product: 'product', planQty: 'planQty', curProcess: 'curProcess' } },
          tip: '选择生产工单后自动带出产品与计划数量' },
        { k: 'process', label: '工序', type: 'text', w: '110px', tip: '手工填或按工序路线' },
        { k: 'worker', label: '派工员工', type: 'select', dict: '人员', req: true },
        { k: 'planQty', label: '派工数量', type: 'number', req: true },
        { k: 'dispatchDate', label: '派工日期', type: 'date', def: 'today' },
        { k: 'status', label: '状态', type: 'select', opts: ['待开工', '进行中', '已完工'], def: '待开工' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    workReport: {
      key: 'workReport', name: '生产报工', icon: '🔨', group: '生产管理', prefix: 'WR', view: 'workreport',
      desc: '黑湖式扫码报工：按工单+工序报工，自动校验前序完工/防超额，联动工单进度与绩效',
      fields: [
        { k: 'code', label: '报工单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'moCode', label: '工单号', type: 'ref', ref: 'mo', req: true },
        { k: 'process', label: '工序', type: 'text', req: true, w: '110px' },
        { k: 'product', label: '产品', type: 'text', w: '140px' },
        { k: 'worker', label: '报工人', type: 'select', dict: '人员', req: true },
        { k: 'rptDate', label: '报工日期', type: 'date', def: 'today' },
        { k: 'okQty', label: '合格数量', type: 'number', req: true, w: '90px' },
        { k: 'badQty', label: '不良数量', type: 'number', w: '90px' },
        { k: 'hours', label: '工时(时)', type: 'number', w: '80px' },
        { k: 'priceType', label: '工资类型', type: 'select', opts: ['计件', '计时'], w: '80px' },
        { k: 'price', label: '工价快照(元)', type: 'number', w: '90px', tip: '提交时自动取自工序路线，留痕不变' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    payroll: {
      key: 'payroll', name: '绩效工资', icon: '💰', group: '生产管理', prefix: 'PY', view: 'payroll',
      desc: '黑湖式绩效工资：按报工数据自动汇总计件/计时工资（只读）'
    },
    moboard: {
      key: 'moboard', name: '生产看板', icon: '🖥️', group: '生产管理', prefix: '', view: 'moboard',
      desc: '黑湖式生产进度看板：泳道展示、交期预警、当前工序'
    },
    moPick: {
      key: 'moPick', name: '生产领料', icon: '📤', group: '生产管理', prefix: 'PK',
      desc: '按工单领料',
      fields: [
        { k: 'code', label: '领料单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'moCode', label: '关联工单', type: 'ref', ref: 'mo',
          tip: '选择生产工单后自动带出产品与计划数量' },
        { k: 'pickDate', label: '领料日期', type: 'date', def: 'today' },
        { k: 'warehouse', label: '领料仓库', type: 'ref', ref: 'warehouse' },
        { k: 'items', label: '领料明细', type: 'items', cols: [
          { k: 'code', label: '物料', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'location', label: '库位', type: 'select', dict: '库位', dictFrom: 'warehouse.location', w: '110px', autoFrom: 'code:location' },
          { k: 'qty', label: '数量', type: 'number', w: '90px' },
          { k: 'unit', label: '单位', type: 'select', dict: '单位', w: '70px', autoFrom: 'code:unit' }
        ] },
        { k: 'picker', label: '领料人', type: 'select', dict: '人员' },
        { k: 'status', label: '状态', type: 'select', opts: FLOW_STATUS, def: '已完成' }
      ]
    },
    moIn: {
      key: 'moIn', name: '完工入库', icon: '📦', group: '生产管理', prefix: 'FI',
      desc: '完工产品入库',
      fields: [
        { k: 'code', label: '入库单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'moCode', label: '关联工单', type: 'ref', ref: 'mo',
          fill: { from: 'mo', items: null, map: { product: 'product', qty: 'planQty' } },
          tip: '选择生产工单后自动带出产品与计划数量' },
        { k: 'product', label: '产品', type: 'ref', ref: 'material' },
        { k: 'qty', label: '入库数量', type: 'number' },
        { k: 'okQty', label: '合格数量', type: 'number' },
        { k: 'inDate', label: '入库日期', type: 'date', def: 'today' },
        { k: 'warehouse', label: '入库仓库', type: 'ref', ref: 'warehouse' },
        { k: 'location', label: '库位', type: 'select', dict: '库位' },
        { k: 'status', label: '状态', type: 'select', opts: FLOW_STATUS, def: '待处理' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },

    /* ---------- 报表 ---------- */
    report: {
      key: 'report', name: '统计报表', icon: '📈', group: '报表中心', view: 'report',
      desc: '库存结存、销售订单、采购到货、生产进度汇总'
    }
  };

  /* ==================== 分组 ==================== */
  var GROUPS = [
    { name: '基础资料', icon: '📚', keys: ['material', 'customer', 'supplier', 'warehouse', 'bom', 'equip'] },
    { name: '销售管理', icon: '📝', keys: ['so', 'soShip', 'soReturn'] },
    { name: '采购管理', icon: '🛒', keys: ['pr', 'po', 'poRecv'] },
    { name: '仓储管理', icon: '🏬', keys: ['stockIn', 'stockOut', 'stockCheck'], extras: ['stock'] },
    { name: '生产管理', icon: '🏭', keys: ['moboard', 'mo', 'process', 'dispatch', 'workReport', 'moPick', 'moIn', 'payroll'] },
    { name: '品质检验', icon: '🔬', custom: [
      { name: '进料检验', desc: 'IQC 来料检验记录', icon: '📥', click: "BIZFLOW_UI.goInsp('IQC')" },
      { name: '首件检验', desc: 'FIRST 首件确认', icon: '✅', click: "BIZFLOW_UI.goInsp('FIRST')" },
      { name: '巡检', desc: 'PATROL 制程巡检', icon: '🔍', click: "BIZFLOW_UI.goInsp('PATROL')" },
      { name: '成品检验', desc: 'OQC 成品出货检验', icon: '🧪', click: "BIZFLOW_UI.goInsp('OQC')" },
      { name: '不合格评审', desc: 'MRB 不合格品评审', icon: '⚠️', click: "BIZFLOW_UI.goMrb()" }
    ] },
    { name: '售后管理', icon: '🔄', keys: ['soReturn', 'afterSale', 'renovate'] },
    { name: '报表中心', icon: '📈', keys: [], extras: ['report'] }
  ];

  global.ERP = {
    ENTITIES: ENTITIES, GROUPS: GROUPS,
    $: $, escHtml: escHtml, escAttr: escAttr, toast: toast, num: num, money: money,
    today: today, uid: uid
  };

})(window);

/* ==================== ERP 引擎 · 界面层 ==================== */
(function (global) {
  var ERP = global.ERP;
  if (!ERP) return;
  var ENTITIES = ERP.ENTITIES, GROUPS = ERP.GROUPS;
  var $ = ERP.$, escHtml = ERP.escHtml, escAttr = ERP.escAttr, toast = ERP.toast;
  var num = ERP.num, money = ERP.money, uid = ERP.uid;
  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  /* 物料档案：按产品筛选/分组的状态（空值 = 全部） */
  if (ERP.prod === undefined) ERP.prod = '';
  if (ERP.groupProd === undefined) ERP.groupProd = false;

  /* ---------- 数据层 ---------- */
  function getData() {
    if (typeof appData === 'undefined' || !appData) return null;
    if (!appData.erp) appData.erp = {};
    var d = appData.erp, k;
    for (k in ENTITIES) if (!d[k]) d[k] = [];
    return d;
  }
  function save() {
    try { if (typeof saveData === 'function') { saveData(); return; } } catch (e) {}
    try {
      if (typeof appData !== 'undefined') localStorage.setItem('gls_quality_data_v2', JSON.stringify(appData));
    } catch (e) {}
  }
  function listOf(key) { var d = getData(); return d ? (d[key] || []) : []; }
  function nextCode(ent) {
    var list = listOf(ent.key), d = new Date();
    var head = ent.prefix + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate());
    var max = 0;
    list.forEach(function (r) {
      var c = String(r.code || '');
      if (c.indexOf(head) === 0) {
        var n = parseInt(c.substr(head.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
    return head + ('00' + (max + 1)).slice(-3);
  }

  /* ---------- 单元格取值 ---------- */
  function cellVal(ent, r, f) {
    if (f.type === 'calcSum') {
      var arr = r[f.of] || [], s = 0;
      arr.forEach(function (x) { s += num(x[f.col]); });
      return s ? money(s) : '';
    }
    if (f.type === 'calc') { return r[f.k]; }
    var v = r[f.k];
    if (f.type === 'number') return (v === '' || v === undefined || v === null) ? '' : String(v);
    return v == null ? '' : String(v);
  }

  /* ---------- 库存计算 ---------- */
  ERP.buildStock = function () {
    var rows = [], map = {};
    function touch(code, name, unit, spec) {
      if (!code) return null;
      if (!map[code]) {
        map[code] = { code: code, name: name || code, unit: unit || '', spec: spec || '', cat: '原材料', aft: false, in: 0, out: 0, aftIn: 0, aftOut: 0, safe: 0, bal: 0, aftBal: 0, adj: 0 };
        rows.push(map[code]);
      }
      if (name && map[code].name === code) map[code].name = name;
      if (unit) map[code].unit = unit;
      return map[code];
    }
    listOf('material').forEach(function (m) {
      var g = touch(m.code, m.name, m.unit, m.spec);
      if (g) { g.safe = num(m.safeStock); g.spec = m.spec || ''; g.cat = (m.category === '半成品' || m.category === '成品') ? m.category : '原材料'; }
    });
    listOf('stockIn').forEach(function (doc) {
      if (doc.status === '草稿' || doc.status === '已取消') return;
      var aftDoc = doc.type === '退货入库' || doc.type === '翻新入库';
      (doc.items || []).forEach(function (it) {
        var g = touch(it.code, it.name, it.unit);
        if (g) { g.in += num(it.qty); if (aftDoc) { g.aft = true; g.aftIn += num(it.qty); } }
      });
    });
    listOf('stockOut').forEach(function (doc) {
      if (doc.status === '草稿' || doc.status === '已取消') return;
      var aftDoc = doc.type === '翻新领料';
      (doc.items || []).forEach(function (it) {
        var g = touch(it.code, it.name, it.unit);
        if (g) { g.out += num(it.qty); if (aftDoc) { g.aft = true; g.aftOut += num(it.qty); } }
      });
    });
    /* 盘点调整：状态为「已完成」的盘点单，盘盈盘亏计入库存台账 */
    listOf('stockCheck').forEach(function (doc) {
      if (doc.status !== '已完成') return;
      (doc.items || []).forEach(function (it) {
        if (!it || !it.code) return;
        var g = touch(it.code, it.name, it.unit);
        if (!g) return;
        var d = num(it.realQty) - num(it.bookQty);
        if (d) { if (g.adj == null) g.adj = 0; g.adj += d; }
      });
    });
    rows.forEach(function (r) {
      if (r.adj == null) r.adj = 0;
      r.bal = r.in - r.out + r.adj;
      r.aftBal = r.aftIn - r.aftOut;
    });
    rows.sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); });
    return rows;
  };

  /* ---------- 侧边栏 ---------- */
  function injectSidebar() {
    var nav = $('sidebarNav');
    if (!nav || nav.querySelector('[data-erp2]')) return;
    var secs = nav.querySelectorAll('.nav-section'), target = null, i;
    for (i = 0; i < secs.length; i++) {
      if ((secs[i].textContent || '').indexOf('质量管理') >= 0) { target = secs[i]; break; }
    }
    var d = getData(), total = 0, k;
    if (d) for (k in ENTITIES) if (!ENTITIES[k].view) total += (d[k] || []).length;
    var html = '<div class="nav-section" data-erp2="1">ERP 业务</div>' +
      '<div class="nav-item" data-erp2="1" onclick="ERP.openHome()">' +
      '<span class="nav-icon">🏢</span><span class="nav-text">ERP 工作台</span>' +
      (total > 0 ? '<span class="nav-badge">' + total + '</span>' : '') + '</div>';
    if (target) target.insertAdjacentHTML('beforebegin', html);
    else nav.insertAdjacentHTML('afterbegin', html);
  }

  /* ---------- 页面切换 ---------- */
  function showEl(id) {
    var all = document.querySelectorAll('.page'), i;
    for (i = 0; i < all.length; i++) all[i].classList.remove('active');
    var el = $(id);
    if (el) el.classList.add('active');
    var items = document.querySelectorAll('.sidebar .nav-item');
    for (i = 0; i < items.length; i++) items[i].classList.remove('active');
  }
  function setTitle(t) { var e = $('pageTitle'); if (e) e.textContent = t; }

  /* 下拉选项变更后：原地重建表单里所有下拉的选项，保留已经选好的值 */
  ERP.refreshDicts = function () {
    var list = document.querySelectorAll('select[data-erpdict]');
    Array.prototype.forEach.call(list, function (sel) {
      var name = sel.getAttribute('data-erpdict');
      if (!name) return;
      var from = sel.getAttribute('data-erpdictfrom') || '';
      var opts = (ERP.dictOptions ? ERP.dictOptions({ dict: name, dictFrom: from }) : []);
      var keep = sel.value || '';
      var all = opts.slice();
      if (keep !== '' && all.map(String).indexOf(keep) < 0) all.unshift(keep);
      var html = '<option value="">— 请选择 —</option>';
      all.forEach(function (x) {
        html += '<option value="' + escAttr(x) + '"' + (String(x) === keep ? ' selected' : '') + '>' + escHtml(x) + '</option>';
      });
      sel.innerHTML = html;
      sel.value = keep;
    });
  };
  /* 供 gls-fields.js 广播调用 */
  ERP.onDictChange = function () { try { ERP.refreshDicts(); } catch (e) {} };

  /* 打开「下拉选项管理」：所有下拉的选项都能在这里增/删/改/排序 */
  ERP.openDictManager = function (dictName) {
    if (window.FIELDS && typeof FIELDS.openDictManager === 'function') {
      try { FIELDS.openDictManager(); } catch (e) { toast('打开失败：' + e.message); return; }
      if (dictName && typeof FIELDS.dictOpen === 'function') {
        try { FIELDS.dictOpen(dictName); } catch (e) {}
      }
    } else {
      toast('下拉选项管理界面未加载，请刷新页面重试');
    }
  };

  ERP.openHome = function () {
    ERP.current = null;
    showEl('page-erp-home');
    setTitle('ERP 业务工作台');
    var f = $('fabAdd'); if (f) f.style.display = 'none';
    var s = $('searchBtn'); if (s) s.style.display = 'none';
    ERP.renderHome();
    window.scrollTo(0, 0);
  };

  ERP.openList = function (key) {
    if (key === '__appr') { ERP.openApprovals(); return; }
    var ent = ENTITIES[key];
    if (!ent) { toast('未找到该功能'); return; }
    ERP.current = key;
    ERP.kw = '';
    showEl('page-erp-list');
    setTitle(ent.name);
    var f = $('fabAdd'); if (f) f.style.display = 'none';
    var s = $('searchBtn'); if (s) s.style.display = 'none';
    ERP.renderList();
    window.scrollTo(0, 0);
  };

  /* ---------- 主页 ---------- */
  function statCard(n, t, cls, key) {
    return '<div class="erp-stat ' + (cls || '') + '"' + (key ? ' onclick="ERP.openList(\'' + key + '\')"' : '') +
      '><div class="n">' + n + '</div><div class="t">' + t + '</div></div>';
  }

  ERP.renderHome = function () {
    var box = $('erpHome');
    if (!box) return;
    var d = getData();
    if (!d) { box.innerHTML = '<div class="erp-empty">数据未就绪，请返回首页后重试</div>'; return; }
    var docs = 0, k;
    for (k in ENTITIES) if (!ENTITIES[k].view) docs += (d[k] || []).length;
    var st = ERP.buildStock();
    var low = 0;
    st.forEach(function (r) { if (r.safe > 0 && r.bal < r.safe) low++; });
    var running = 0;
    listOf('mo').forEach(function (m) { if (m.status === '生产中') running++; });
    var waitSo = 0;
    listOf('so').forEach(function (m) { if (m.status === '待处理') waitSo++; });
    var apprN = 0;
    try {
      if (window.BIZFLOW) {
        BIZFLOW.flows().forEach(function (f) {
          if (f.status !== '待审批') return;
          try { if (BIZFLOW.canApprove(f)) apprN++; } catch (e) {}
        });
      }
    } catch (e) {}

    var html = '<div class="erp-stats">' +
      statCard(st.length, '在管物料', '', 'stock') +
      statCard(docs, '业务单据', '', '') +
      statCard(waitSo, '待处理订单', waitSo ? 'warn' : '', 'so') +
      statCard(apprN, '待我审批', apprN ? 'warn' : '', '__appr') +
      statCard(running, '在产工单', '', 'mo') +
      statCard(low, '低于安全库存', low ? 'danger' : '', 'stock') +
      '</div>';

    var _dn = (ERP.usedDictNames ? ERP.usedDictNames().length : 0);
    html += '<div class="erp-toolbar">' +
      '<span class="erp-tool" onclick="ERP.openDictManager()">⚙ 下拉选项管理</span>' +
      '<span class="erp-tooltip">表单里所有下拉的选项都在这里维护，可增可删；共 ' + _dn + ' 组</span></div>';

    GROUPS.forEach(function (g) {
      var keys = (g.keys || []).concat(g.extras || []);
      if (!keys.length && !(g.custom || []).length) return;
      html += '<div class="erp-group"><div class="erp-group-title">' + g.icon + ' ' + g.name + '</div><div class="erp-cards">';
      keys.forEach(function (key) {
        var e2 = ENTITIES[key];
        if (!e2) return;
        var cnt = e2.view ? '视图' : ((d[key] || []).length + ' 条');
        html += '<div class="erp-card" onclick="ERP.openList(\'' + key + '\')">' +
          '<div class="erp-card-icon">' + e2.icon + '</div>' +
          '<div class="erp-card-main"><div class="erp-card-name">' + e2.name + '</div>' +
          '<div class="erp-card-desc">' + escHtml(e2.desc || '') + '</div></div>' +
          '<div class="erp-card-cnt">' + cnt + '</div></div>';
      });
      (g.custom || []).forEach(function (c) {
        html += '<div class="erp-card" onclick="' + c.click + '">' +
          '<div class="erp-card-icon">' + c.icon + '</div>' +
          '<div class="erp-card-main"><div class="erp-card-name">' + escHtml(c.name) + '</div>' +
          '<div class="erp-card-desc">' + escHtml(c.desc || '') + '</div></div>' +
          '<div class="erp-card-cnt">→</div></div>';
      });
      html += '</div></div>';
    });
    box.innerHTML = html;
  };

  /* ---------- 搜索 ---------- */
  ERP.doSearch = function (v) {
    ERP.kw = v;
    if (ERP._st) clearTimeout(ERP._st);
    ERP._st = setTimeout(function () {
      ERP.renderList();
      var el = $('erpKw');
      if (el) {
        el.focus();
        try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {}
      }
    }, 280);
  };

  /* ---------- 列表 ---------- */
  ERP.renderList = function () {
    var key = ERP.current, ent = ENTITIES[key], box = $('erpListBody');
    if (!box) return;
    if (key === '__appr') { box.innerHTML = ERP.approvalView(); return; }
    if (!ent) { box.innerHTML = '<div class="erp-empty">请从 ERP 工作台进入</div>'; return; }
    if (ent.view === 'stock') { box.innerHTML = barHtml(ent) + ERP.stockView(); return; }
    if (ent.view === 'report') {
      box.innerHTML = barHtml(ent) + ERP.reportView();
      if (window.echarts) setTimeout(function () { ERP.renderCharts(); }, 80);
      return;
    }
    if (ent.view === 'moboard') { box.innerHTML = barHtml(ent) + ERP.moBoardView(); return; }
    if (ent.view === 'workreport') { box.innerHTML = barHtml(ent) + ERP.workReportView(); return; }
    if (ent.view === 'payroll') { box.innerHTML = barHtml(ent) + ERP.payrollView(); return; }

    var rows = listOf(key), kw = (ERP.kw || '').trim();
    if (kw) {
      var low2 = kw.toLowerCase();
      rows = rows.filter(function (r) { return JSON.stringify(r).toLowerCase().indexOf(low2) >= 0; });
    }
    /* 物料档案：按产品筛选 */
    if (key === 'material' && ERP.prod) {
      rows = rows.filter(function (r) {
        var ps = String(r.products || '').trim();
        if (ERP.prod === '__none__') return !ps;
        return ps.indexOf(ERP.prod) >= 0;
      });
    }
    var cols = ent.fields.filter(function (f) { return f.type !== 'items' && f.type !== 'textarea'; });
    var showFlow = (key === 'so' || key === 'soReturn') && rows.some(function (r) { return r.flowStatus; });
    /* 物料档案：按产品分组（一个物料挂多个产品时，在每组都会出现） */
    var seq = rows, _grpCount = 0;
    if (key === 'material' && ERP.groupProd) {
      var buckets = {}, order = [];
      rows.forEach(function (r) {
        var ps = prodArr(r.products);
        if (!ps.length) ps = ['（未归属产品）'];
        ps.forEach(function (p) {
          if (!buckets[p]) { buckets[p] = []; order.push(p); }
          buckets[p].push(r);
        });
      });
      order.sort(function (a, b) {
        var ua = a.indexOf('未归属') >= 0, ub = b.indexOf('未归属') >= 0;
        if (ua !== ub) return ua ? 1 : -1;
        return a.localeCompare(b, 'zh');
      });
      seq = [];
      order.forEach(function (p) {
        seq.push({ __grp: p + '　·　' + buckets[p].length + ' 条' });
        buckets[p].forEach(function (r) { seq.push(r); });
      });
      _grpCount = order.length;
    }
    var html = barHtml(ent);
    var colSpanAll = cols.length + 1 + (showFlow ? 1 : 0);
    html += '<div class="erp-count">共 <b>' + rows.length + '</b> 条' +
      (kw ? ' · 关键词「' + escHtml(kw) + '」' : '') +
      (key === 'material' && ERP.prod ? ' · 产品「' + escHtml(ERP.prod === '__none__' ? '未归属产品' : ERP.prod) + '」' : '') +
      (key === 'material' && ERP.groupProd ? ' · 已按产品分组（' + _grpCount + ' 组）' : '') + '</div>';
    html += '<div class="erp-tablewrap"><table class="erp-table"><thead><tr>';
    cols.forEach(function (f) { html += '<th style="min-width:' + (f.w || '110px') + '">' + f.label + '</th>'; });
    html += (showFlow ? '<th style="min-width:80px">流程</th>' : '') + '<th style="min-width:120px">操作</th></tr></thead><tbody>';
    if (!rows.length) {
      html += '<tr><td colspan="' + colSpanAll + '" class="erp-empty">' +
        (key === 'material' && ERP.prod ? '该产品下暂无物料' : '暂无数据，点「＋ 新增」开始录入') + '</td></tr>';
    } else {
      seq.forEach(function (r) {
        if (r.__grp) {
          html += '<tr><td colspan="' + colSpanAll + '" style="background:#eef6f0;font-weight:700;'
            + 'color:#1f3b2d;padding:8px 12px;border-bottom:1px solid #dbe6df">' + escHtml(r.__grp) + '</td></tr>';
          return;
        }
        html += '<tr>';
        cols.forEach(function (f) {
          var v = cellVal(ent, r, f);
          html += '<td>' + escHtml(v) + '</td>';
        });
        if (showFlow) html += '<td>' + ERP.flowCell(r, key) + '</td>';
        html += '<td class="erp-ops">' +
          ((key === 'so' || key === 'soReturn') && !r.flowStatus ?
            '<span class="erp-op" onclick="ERP.startFlow(\'' + r.id + '\')">发起流程</span>' : '') +
          (key === 'mo' && r.code ?
            '<span class="erp-op" onclick="ERP.printMoQrByCode(\'' + escAttr(r.code) + '\')">🏷 二维码</span>' : '') +
          '<span class="erp-op" onclick="ERP.openForm(\'' + r.id + '\')">编辑</span>' +
          '<span class="erp-op danger" onclick="ERP.delRow(\'' + r.id + '\')">删除</span>' +
          '</td></tr>';
      });
    }
    html += '</tbody></table></div>';
    box.innerHTML = html;
  };

  /* ==================== 黑湖式生产管理：看板 / 报工 / 绩效（与现有 ERP 数据融合） ==================== */
  function today() {
    var d = new Date();
    var p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  /* 工序路线：按产品返回按 seq 排序的工序列表（数据源：工序路线模块，界面可增删改） */
  function routeOf(product) {
    var arr = listOf('process') || [];
    var out = [];
    arr.forEach(function (p) {
      if (String(p.product || '').trim() === String(product || '').trim()) out.push(p);
    });
    out.sort(function (a, b) { return num(a.seq) - num(b.seq); });
    return out;
  }
  /* 某工单某工序累计合格数（以报工记录为唯一事实） */
  function procDone(moCode, procName) {
    var sum = 0;
    (listOf('workReport') || []).forEach(function (r) {
      if (String(r.moCode || '') === String(moCode || '') && String(r.process || '') === String(procName || '')) sum += num(r.okQty);
    });
    return sum;
  }
  function moFind(code) {
    var arr = listOf('mo') || [];
    for (var i = 0; i < arr.length; i++) if (String(arr[i].code || '').toLowerCase() === String(code || '').toLowerCase()) return arr[i];
    return null;
  }
  function matName(code) {
    var arr = listOf('material') || [];
    for (var i = 0; i < arr.length; i++) if (String(arr[i].code || '').toLowerCase() === String(code || '').toLowerCase()) return arr[i].name || code;
    return code;
  }
  function personOpts() {
    var arr = [];
    try { arr = ERP.dictOptions ? ERP.dictOptions({ dict: '人员' }) : []; } catch (e) { arr = []; }
    var h = '<option value="">选择报工人…</option>';
    arr.forEach(function (x) { h += '<option value="' + escAttr(x) + '">' + escHtml(x) + '</option>'; });
    return h;
  }
  /* 按报工记录重算工单：完成数 / 当前工序 / 状态（黑湖式：报工联动进度） */
  ERP.recalcMo = function (moCode) {
    var mo = moFind(moCode);
    if (!mo) return;
    var route = routeOf(mo.product);
    if (!route.length) {
      var s = 0;
      (listOf('workReport') || []).forEach(function (r) { if (String(r.moCode || '') === String(moCode || '')) s += num(r.okQty); });
      mo.doneQty = s;
      if (mo.status !== '已完工' && mo.status !== '已关闭') mo.status = (s >= num(mo.planQty)) ? '已完工' : (s > 0 ? '生产中' : mo.status);
      mo.curProcess = '';
      return;
    }
    var plan = num(mo.planQty);
    mo.doneQty = procDone(moCode, route[route.length - 1].name);
    var next = '';
    route.forEach(function (p) { if (!next && procDone(moCode, p.name) < plan) next = p.name; });
    mo.curProcess = next;
    if (!next) mo.status = '已完工';
    else mo.status = '生产中';
  };
  function dueState(mo) {
    if (!mo || !mo.dueDate) return '';
    if (mo.status === '已完工' || mo.status === '已关闭') return '';
    var diff = Math.ceil((new Date(mo.dueDate) - new Date()) / 86400000);
    if (diff < 0) return 'over';
    if (diff <= 2) return 'soon';
    return '';
  }
  function dueTag(mo) {
    var st = dueState(mo);
    if (st === 'over') return '<span class="erp-tag" style="background:#fee2e2;color:#b91c1c">逾期</span>';
    if (st === 'soon') return '<span class="erp-tag" style="background:#fef3c7;color:#b45309">临期</span>';
    return '';
  }
  function priTag(mo) {
    var p = mo.priority || '普通';
    if (p === '加急') return '<span class="erp-tag" style="background:#ffedd5;color:#c2410c">加急</span>';
    if (p === '已暂停') return '<span class="erp-tag" style="background:#f3f4f6;color:#6b7280">已暂停</span>';
    return '<span class="erp-tag" style="background:#e8f5ec;color:#1f5a38">普通</span>';
  }
  /* 缺料计算：BOM 应领（计划×单台用量）vs 已领（生产领料单累计） */
  function matMiss(mo) {
    var need = {}, picked = {};
    if (!mo) return [];
    var plan = num(mo.planQty);
    (listOf('bom') || []).forEach(function (b) {
      if (String(b.product || '').trim() !== String(mo.product || '').trim()) return;
      (b.items || []).forEach(function (it) {
        if (!it || !it.code) return;
        need[it.code] = (need[it.code] || 0) + num(it.qty) * plan;
      });
    });
    (listOf('moPick') || []).forEach(function (pk) {
      if (String(pk.moCode || '') !== String(mo.code || '')) return;
      (pk.items || []).forEach(function (it) {
        if (!it || !it.code) return;
        picked[it.code] = (picked[it.code] || 0) + num(it.qty);
      });
    });
    var miss = [];
    Object.keys(need).forEach(function (c) {
      var n = need[c], g = picked[c] || 0;
      if (g < n) miss.push({ code: c, name: matName(c), need: n, got: g });
    });
    return miss;
  }
  /* ---------- 生产看板（黑湖式泳道 + 交期预警） ---------- */
  ERP.moBoardView = function () {
    var mos = listOf('mo') || [];
    var lanes = ['待下达', '待料', '待生产', '生产中', '已完工', '已关闭'];
    var doing = 0, over = 0, urgent = 0, reports = 0;
    mos.forEach(function (m) {
      if (m.status && m.status !== '已完工' && m.status !== '已关闭') doing++;
      if ((m.priority || '') === '加急' && m.status !== '已完工' && m.status !== '已关闭') urgent++;
      if (dueState(m) === 'over') over++;
    });
    try { reports = (listOf('workReport') || []).length; } catch (e) {}
    function statCard(label, val, color) {
      return '<div style="flex:1;min-width:130px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px">' +
        '<div style="font-size:12px;color:#6b7280">' + label + '</div>' +
        '<div style="font-size:24px;font-weight:800;color:' + color + '">' + val + '</div></div>';
    }
    var html = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">' +
      statCard('在制工单', doing, '#1d4ed8') +
      statCard('逾期工单', over, '#dc2626') +
      statCard('加急工单', urgent, '#ea580c') +
      statCard('累计报工', reports, '#16a34a') +
      '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">';
    lanes.forEach(function (lane) {
      var inLane = [];
      mos.forEach(function (m) { if (m.status === lane) inLane.push(m); });
      html += '<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<b style="font-size:14px;color:#111827">' + lane + '</b>' +
        '<span style="background:#eef2f7;border-radius:10px;padding:1px 9px;font-size:12px;color:#4b5563">' + inLane.length + '</span></div>';
      if (!inLane.length) html += '<div class="erp-empty" style="padding:14px 0">暂无</div>';
      inLane.forEach(function (m) {
        var plan = num(m.planQty), done = num(m.doneQty);
        var pct = plan ? Math.min(100, Math.round(done / plan * 100)) : 0;
        html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;margin-bottom:8px">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">' +
          '<b style="font-size:13px;color:#111827">' + escHtml(m.code || '') + '</b>' +
          '<span>' + priTag(m) + dueTag(m) + '</span></div>';
        html += '<div style="font-size:12px;color:#374151;margin-top:3px">' + escHtml(matName(m.product)) + '</div>';
        html += '<div style="margin-top:6px;height:6px;background:#eef2f7;border-radius:3px;overflow:hidden">' +
          '<div style="height:100%;width:' + pct + '%;background:' + (pct >= 100 ? '#16a34a' : pct >= 50 ? '#eab308' : '#3b82f6') + '"></div></div>';
        html += '<div style="display:flex;justify-content:space-between;font-size:11.5px;color:#6b7280;margin-top:4px">' +
          '<span>完成 ' + done + ' / ' + plan + '</span><span>' + pct + '%</span></div>';
        html += '<div style="display:flex;justify-content:space-between;font-size:11.5px;color:#6b7280;margin-top:2px">' +
          '<span>当前工序：' + escHtml(m.curProcess || '—') + '</span>' +
          (m.dueDate ? '<span>交期 ' + escHtml(m.dueDate) + '</span>' : '<span></span>') + '</div>';
        html += '<div style="display:flex;gap:6px;margin-top:8px">' +
          '<span class="erp-op" onclick="ERP.printMoQrByCode(\'' + escAttr(m.code) + '\')">🏷 二维码</span>' +
          '<span class="erp-op" onclick="ERP.openMoEdit(\'' + m.id + '\')">编辑</span>' +
          '<span class="erp-op" style="background:#1f5a38;color:#fff" onclick="ERP.openWorkReport(\'' + m.code + '\')">报工</span>' +
          '</div></div>';
      });
      html += '</div>';
    });
    html += '</div>';
    return html;
  };
  ERP.openMoNew = function () { ERP.current = 'mo'; ERP.openForm(); };
  ERP.openMoEdit = function (id) { ERP.current = 'mo'; ERP.openForm(id); };
  ERP.gotoMoList = function () { ERP.openList('mo'); };
  /* ---------- 报工台（黑湖式：选工单→选工序→报工→联动） ---------- */
  ERP.openWorkReport = function (moCode) {
    ERP.current = 'workReport';
    ERP.wrMo = moCode || ERP.wrMo || '';
    ERP.renderList();
  };
  ERP.wrSetMo = function (code) {
    ERP.wrMo = code;
    var mo = moFind(code);
    var pc = $('wrProduct');
    if (pc) pc.value = mo ? (mo.product || '') : '';
    var sel = $('wrProcess');
    if (sel) {
      var h = '<option value="">选择工序…</option>';
      if (mo) {
        routeOf(mo.product).forEach(function (p) {
          h += '<option value="' + escAttr(p.name) + '" data-price="' + escAttr(p.price) + '" data-ptype="' + escAttr(p.priceType) + '">' +
            escHtml(p.name) + '（' + escHtml(p.priceType || '') + ' ' + escHtml(p.price || '') + '元）</option>';
        });
      }
      sel.innerHTML = h;
    }
  };
  ERP.wrSetProcess = function () {
    var sel = $('wrProcess');
    if (!sel || !sel.selectedOptions || !sel.selectedOptions[0]) return;
    var opt = sel.selectedOptions[0];
    var pt = $('wrPriceType'), pv = $('wrPrice');
    var ptype = opt.getAttribute('data-ptype'), price = opt.getAttribute('data-price');
    if (pt) pt.value = ptype || '';
    if (pv) pv.value = price || '';
  };
  ERP.submitWorkReport = function () {
    var moCode = ($('wrMo') || {}).value || '';
    var process = ($('wrProcess') || {}).value || '';
    var worker = ($('wrWorker') || {}).value || '';
    var okQty = num(($('wrOk') || {}).value);
    var badQty = num(($('wrBad') || {}).value);
    var hours = num(($('wrHours') || {}).value);
    var rptDate = ($('wrDate') || {}).value || today();
    var remark = ($('wrRemark') || {}).value || '';
    if (!moCode || !process) { toast('请选择工单和工序', false); return; }
    if (!worker) { toast('请选择报工人', false); return; }
    if (okQty <= 0 && badQty <= 0) { toast('请填写报工数量', false); return; }
    var mo = moFind(moCode);
    if (!mo) { toast('工单不存在', false); return; }
    var route = routeOf(mo.product);
    var p = null;
    route.forEach(function (x) { if (x.name === process) p = x; });
    if (!p) { toast('该产品未配置工序「' + process + '」，请先在「工序路线」里添加', false); return; }
    var plan = num(mo.planQty);
    /* 防超额 */
    var done = procDone(moCode, process);
    if (done + okQty > plan) { toast('报工超量：该工序已完成 ' + done + ' 件，本次最多报 ' + Math.max(0, plan - done), false); return; }
    /* 前序完工校验（黑湖式：前道完工才能报后道） */
    var seq = num(p.seq);
    if (seq > 1) {
      var missPrev = '';
      route.forEach(function (x) {
        if (num(x.seq) < seq && procDone(moCode, x.name) < plan) missPrev = x.name;
      });
      if (missPrev) { toast('前序工序「' + missPrev + '」尚未完工，不能报「' + process + '」', false); return; }
    }
    var d = getData();
    if (!d.workReport) d.workReport = [];
    d.workReport.push({
      id: uid('wr'),
      code: nextCode(ENTITIES.workReport),
      moCode: moCode, process: process, product: mo.product || '',
      worker: worker, rptDate: rptDate,
      okQty: okQty, badQty: badQty, hours: hours,
      priceType: p.priceType || '', price: num(p.price) || '',
      remark: remark
    });
    /* 联动：工单进度 / 当前工序 / 状态 */
    ERP.recalcMo(moCode);
    save();
    var mrbRec = null;
    if (badQty > 0) {
      var lastWr = d.workReport[d.workReport.length - 1];
      if (lastWr) mrbRec = ERP.autoMrbFromWorkReport(lastWr);
    }
    toast('报工成功：' + process + ' +' + okQty + ' 合格' + (mrbRec ? '；不良 ' + badQty + ' 件已生成评审单 ' + mrbRec.no : ''));
    ERP.wrMo = moCode;
    ERP.renderList();
  };
  /* ---------- 报工扫码：扫码枪 / 摄像头 / 二维码 ---------- */
  ERP.wrScanEnter = function (e) {
    if (e.key !== 'Enter') return;
    var v = (($('wrScanCode') || {}).value || '').trim();
    if (!v) return;
    e.preventDefault();
    ERP.pickMoByCode(v);
  };
  ERP.pickMoByCode = function (raw) {
    var code = String(raw || '').trim();
    if (!code) { toast('没有扫到内容', false); return; }
    var mos = listOf('mo') || [];
    var hit = null;
    mos.forEach(function (m) {
      if (m.status === '已完工' || m.status === '已关闭') return;
      if (String(m.code).toUpperCase() === code.toUpperCase()) hit = m;
    });
    if (!hit) {
      mos.forEach(function (m) {
        if (hit || m.status === '已完工' || m.status === '已关闭') return;
        if (String(m.code).toUpperCase().indexOf(code.toUpperCase()) >= 0) hit = m;
      });
    }
    var inp = $('wrScanCode');
    if (inp) inp.value = '';
    if (!hit) { toast('未找到工单 ' + code + '，请确认工单已建档且未完工', false); return; }
    ERP.wrMo = hit.code;
    ERP.renderList();
    toast('已选中工单：' + hit.code + '　' + matName(hit.product));
  };
  ERP.scanMo = function () {
    if (typeof SCAN === 'undefined') { toast('扫码组件未加载', false); return; }
    SCAN._cb = function (res) {
      var row = res && res.row;
      if (row && row.code) ERP.pickMoByCode(row.code);
      else toast('扫到的内容不是有效工单', false);
    };
    SCAN.open();
    toast('扫码后自动选中工单');
  };
  function nowT() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  /* 打印工单二维码（新窗口自动调起打印；按工单号通用，任何入口都可调） */
  ERP.printMoQrByCode = function (code) {
    var mo = moFind(code || '');
    if (!mo) { toast('未找到工单 ' + code, false); return; }
    if (typeof QRCode === 'undefined') { toast('二维码组件未加载', false); return; }
    var holder = document.createElement('div');
    try { new QRCode(holder, { text: mo.code, width: 220, height: 220 }); } catch (e) { toast('二维码生成失败', false); return; }
    var canvas = holder.querySelector('canvas');
    var dataUrl = canvas ? canvas.toDataURL('image/png') : '';
    if (!dataUrl) { toast('二维码生成失败', false); return; }
    var w = window.open('', '_blank');
    if (!w) { toast('浏览器拦截了新窗口，请允许弹出', false); return; }
    var label = escHtml(mo.code) + '　' + escHtml(matName(mo.product)) + '　计划 ' + num(mo.planQty) + ' 件';
    w.document.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>工单二维码 ' + escHtml(mo.code) + '</title>' +
      '<style>body{font-family:"Microsoft YaHei",sans-serif;text-align:center;padding:24px}' +
      'h2{margin:10px 0 4px;font-size:22px;letter-spacing:1px}' +
      '.sub{font-size:15px;color:#555;margin-bottom:14px}' +
      '.qr{border:1px dashed #bbb;display:inline-block;padding:12px;background:#fff}' +
      '.foot{margin-top:14px;font-size:12px;color:#999}' +
      '.pbtn{margin-top:16px;padding:10px 26px;font-size:15px;cursor:pointer}' +
      '@media print{body{padding:8px}.pbtn,.foot{display:none}}' +
      '</style></head><body>' +
      '<div class="qr"><img src="' + dataUrl + '" style="width:190px;height:190px"></div>' +
      '<h2>' + escHtml(mo.code) + '</h2>' +
      '<div class="sub">' + label + '</div>' +
      '<button class="pbtn" onclick="window.print()">🖨 打印</button>' +
      '<div class="foot">GREENIS 格丽思 · 质量工作台自动生成</div>' +
      '</body></html>');
    w.document.close();
    setTimeout(function () { try { w.print(); } catch (e) {} }, 350);
  };
  /* 报工台按钮兼容：打印当前已选工单 */
  ERP.printMoQR = function () { ERP.printMoQrByCode(ERP.wrMo || ''); };
  /* 不良数回写：报工不良自动生成检验不合格记录，进入 MRB 评审 */
  ERP.autoMrbFromWorkReport = function (wr) {
    try {
      if (!window.INSP || !window.DATAHUB) return null;
      var idb = INSP._db();
      if (!idb || !idb.inspections) return null;
      var type = 'PATROL';
      var prefix = type + '-' + today().replace(/-/g, '') + '-';
      var max = 0;
      idb.inspections.forEach(function (r) {
        if (r.no && r.no.indexOf(prefix) === 0) {
          var n = parseInt(r.no.slice(prefix.length), 10);
          if (!isNaN(n) && n > max) max = n;
        }
      });
      var rec = {
        _id: 'in' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        no: prefix + String(max + 1).padStart(3, '0'),
        type: type, date: today(),
        matCode: wr.product || '', matName: matName(wr.product) || wr.product || '',
        supplier: '', batch: String(wr.moCode || ''),
        qty: String(num(wr.badQty)),
        standard: '生产报工不良自动转入', measured: '', result: 'fail',
        inspector: wr.worker || '', status: '待评审', approver: '', approveNote: '', approvedAt: '',
        flowTo: '', flowNote: '报工 ' + (wr.code || '') + ' 不良 ' + num(wr.badQty) + ' 件，自动进入不合格评审',
        flowId: '', flowNo: '', createdAt: nowT(),
        srcWr: wr.id || ''
      };
      var lk = null;
      try { lk = (window.BIZFLOW && BIZFLOW.linkInspSubmit) ? BIZFLOW.linkInspSubmit(rec) : null; } catch (e) { lk = null; }
      if (lk && lk.ok) {
        rec.flowId = lk.flowId; rec.flowNo = lk.flowNo;
        rec.flowNote = '报工 ' + (wr.code || '') + ' 不良 ' + num(wr.badQty) + ' 件，已进入不合格评审；流程单 ' + lk.flowNo + ' 现在 ' + (lk.dest || '');
      }
      idb.inspections.push(rec);
      DATAHUB.set('inspect', idb);
      return rec;
    } catch (e) { return null; }
  };
  ERP.delWorkReport = function (id) {
    var arr = listOf('workReport') || [], idx = -1, moCode = '';
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) { idx = i; moCode = arr[i].moCode || ''; break; }
    if (idx < 0) return;
    if (!confirm('删除该报工记录？工单进度与绩效将按剩余记录自动重算。')) return;
    var d = getData();
    if (d.workReport) d.workReport.splice(idx, 1);
    /* 同步移除该报工自动生成的不合格评审记录（留痕记入检验流转日志） */
    try {
      if (window.INSP) {
        var idb = INSP._db();
        if (idb && idb.inspections) {
          var before = idb.inspections.length;
          idb.inspections = idb.inspections.filter(function (x) { return x.srcWr !== id; });
          if (idb.inspections.length !== before && window.DATAHUB && DATAHUB.set) {
            idb.flowLog = idb.flowLog || [];
            idb.flowLog.push({ at: nowT(), no: moCode || '', act: '报工删除，同步移除自动生成的不合格记录（' + (before - idb.inspections.length) + ' 条）' });
            DATAHUB.set('inspect', idb);
          }
        }
      }
    } catch (e) {}
    if (moCode) ERP.recalcMo(moCode);
    save();
    ERP.renderList();
    toast('已删除并重算工单进度');
  };
  /* ---------- 报工台视图 ---------- */
  ERP.workReportView = function () {
    var mos = listOf('mo') || [];
    var html = '<div style="display:grid;grid-template-columns:minmax(320px,460px) 1fr;gap:16px;align-items:start">';
    html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px">';
    html += '<div style="font-size:15px;font-weight:700;color:#111827">🛠 现场报工</div>';
    html += '<div style="font-size:12px;color:#6b7280;margin:4px 0 12px">选工单 → 选工序 → 填数量提交；自动校验前序完工、防超额，联动工单进度与绩效工资</div>';
    html += '<div style="display:flex;gap:8px;margin-bottom:8px">' +
      '<input id="wrScanCode" placeholder="🔍 扫码枪扫工单号后回车（MO-…）" style="flex:1;min-width:0;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px" autocomplete="off" onkeydown="ERP.wrScanEnter(event)" onfocus="this.select()">' +
      '<span class="erp-btn" style="white-space:nowrap;padding:8px 12px;font-size:12.5px" onclick="ERP.scanMo()">📷 摄像头/扫码</span>' +
      '<span class="erp-btn" style="white-space:nowrap;padding:8px 12px;font-size:12.5px" onclick="ERP.printMoQR()">🏷 工单二维码</span>' +
      '</div>' +
      '<div style="font-size:11.5px;color:#9aa3af;margin-bottom:8px">扫码枪：光标停在输入框直接扫，自动带回工单；摄像头/手动扫到的工单也会自动选中。二维码可打印后贴在工单/流转卡上。</div>' +
      '<label style="font-size:12.5px;color:#374151">工单</label>' +
      '<select id="wrMo" style="width:100%;margin-bottom:8px;padding:7px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px" onchange="ERP.wrSetMo(this.value)">' +
      '<option value="">选择工单…</option>';
    mos.forEach(function (m) {
      if (m.status === '已完工' || m.status === '已关闭') return;
      html += '<option value="' + escAttr(m.code) + '"' + (ERP.wrMo === m.code ? ' selected' : '') + '>' +
        escHtml(m.code) + '　' + escHtml(matName(m.product)) + '（' + escHtml(m.status || '') + '）</option>';
    });
    html += '</select>';
    var preMo = ERP.wrMo ? moFind(ERP.wrMo) : null;
    var preRoute = preMo ? routeOf(preMo.product) : [];
    var preProc = preMo ? (preMo.curProcess || (preRoute.length ? preRoute[0].name : '')) : '';
    var preP = null;
    preRoute.forEach(function (pp) { if (pp.name === preProc) preP = pp; });
    html += '<label style="font-size:12.5px;color:#374151">产品</label>' +
      '<input id="wrProduct" style="width:100%;margin-bottom:8px;padding:7px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px" readonly value="' + escAttr(preMo ? preMo.product : '') + '" placeholder="选择工单后自动带出">';
    html += '<label style="font-size:12.5px;color:#374151">工序（按该产品工序路线，默认当前工序）</label>' +
      '<select id="wrProcess" style="width:100%;margin-bottom:8px;padding:7px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px" onchange="ERP.wrSetProcess()"><option value="">选择工序…</option>';
    preRoute.forEach(function (p) {
      html += '<option value="' + escAttr(p.name) + '" data-price="' + escAttr(p.price) + '" data-ptype="' + escAttr(p.priceType) + '"' +
        (preProc === p.name ? ' selected' : '') + '>' +
        escHtml(p.name) + '（' + escHtml(p.priceType || '') + ' ' + escHtml(p.price || '') + '元）</option>';
    });
    html += '</select>';
    html += '<div style="display:flex;gap:8px;margin-bottom:8px">' +
      '<div style="flex:1"><label style="font-size:12.5px;color:#374151">工资类型</label><input id="wrPriceType" style="width:100%;padding:7px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px" readonly value="' + escAttr(preP ? preP.priceType : '') + '" placeholder="自动"></div>' +
      '<div style="flex:1"><label style="font-size:12.5px;color:#374151">工价/时薪(元)</label><input id="wrPrice" style="width:100%;padding:7px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px" readonly value="' + escAttr(preP ? preP.price : '') + '" placeholder="自动"></div>' +
      '</div>';
    html += '<div style="display:flex;gap:8px;margin-bottom:8px">' +
      '<div style="flex:1"><label style="font-size:12.5px;color:#374151">合格数量</label><input id="wrOk" type="number" style="width:100%;padding:7px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px"></div>' +
      '<div style="flex:1"><label style="font-size:12.5px;color:#374151">不良数量</label><input id="wrBad" type="number" style="width:100%;padding:7px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px"></div>' +
      '</div>';
    html += '<div style="display:flex;gap:8px;margin-bottom:8px">' +
      '<div style="flex:1"><label style="font-size:12.5px;color:#374151">报工人</label><select id="wrWorker" style="width:100%;padding:7px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px">' + personOpts() + '</select></div>' +
      '<div style="flex:1"><label style="font-size:12.5px;color:#374151">工时(时)</label><input id="wrHours" type="number" style="width:100%;padding:7px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px"></div>' +
      '</div>';
    html += '<label style="font-size:12.5px;color:#374151">报工日期</label><input id="wrDate" type="date" style="width:100%;margin-bottom:8px;padding:7px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px" value="' + today() + '">';
    html += '<label style="font-size:12.5px;color:#374151">备注</label><input id="wrRemark" style="width:100%;margin-bottom:12px;padding:7px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px">';
    html += '<div class="erp-btn primary" style="width:100%;text-align:center;justify-content:center" onclick="ERP.submitWorkReport()">✓ 提交报工</div>';
    if (ERP.wrMo) {
      var miss = matMiss(moFind(ERP.wrMo));
      if (miss.length) {
        html += '<div style="margin-top:12px;background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:8px 10px;font-size:12.5px;color:#b91c1c">' +
          '<b>⚠ 物料缺口</b>（BOM 应领 vs 已领）：' +
          miss.map(function (m) { return escHtml(m.name) + ' 差 ' + (m.need - m.got); }).join('；') + '</div>';
      }
    }
    html += '</div>';
    /* 右：报工记录（留痕） */
    html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px">';
    var wr = listOf('workReport') || [];
    html += '<div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:8px">报工记录（' + wr.length + ' 条，留痕可查）</div>';
    html += '<div class="erp-tablewrap"><table class="erp-table"><thead><tr>' +
      '<th style="min-width:110px">单号</th><th>工单</th><th>工序</th><th>产品</th><th>报工人</th><th>日期</th><th>合格</th><th>不良</th><th>工时</th><th>工价</th><th>工资</th><th>操作</th>' +
      '</tr></thead><tbody>';
    if (!wr.length) html += '<tr><td colspan="12" class="erp-empty">暂无报工记录</td></tr>';
    wr.slice().reverse().forEach(function (r) {
      var wage = r.priceType === '计时' ? num(r.hours) * num(r.price) : num(r.okQty) * num(r.price);
      html += '<tr><td>' + escHtml(r.code) + '</td><td>' + escHtml(r.moCode) + '</td><td>' + escHtml(r.process) + '</td>' +
        '<td>' + escHtml(matName(r.product)) + '</td><td>' + escHtml(r.worker) + '</td><td>' + escHtml(r.rptDate) + '</td>' +
        '<td>' + escHtml(r.okQty) + '</td><td>' + escHtml(r.badQty) + '</td><td>' + escHtml(r.hours) + '</td>' +
        '<td>' + escHtml(r.priceType || '') + ' ' + escHtml(r.price || '') + '</td><td>' + money(wage) + '</td>' +
        '<td class="erp-ops"><span class="erp-op danger" onclick="ERP.delWorkReport(\'' + r.id + '\')">删除</span></td></tr>';
    });
    html += '</tbody></table></div></div></div>';
    return html;
  };
  /* ---------- 绩效工资（黑湖式：按报工自动汇总，只读） ---------- */
  ERP.payrollView = function () {
    var wr = listOf('workReport') || [];
    var byWorker = {}, byMo = {}, byProc = {};
    var total = 0, piece = 0, timed = 0;
    wr.forEach(function (r) {
      var wage = r.priceType === '计时' ? num(r.hours) * num(r.price) : num(r.okQty) * num(r.price);
      total += wage;
      if (r.priceType === '计时') timed += wage; else piece += wage;
      var w = byWorker[r.worker] = byWorker[r.worker] || { qty: 0, wage: 0, n: 0 };
      w.qty += num(r.okQty) + num(r.badQty); w.wage += wage; w.n++;
      var m = byMo[r.moCode] = byMo[r.moCode] || { qty: 0, wage: 0, n: 0 };
      m.qty += num(r.okQty); m.wage += wage; m.n++;
      var p = byProc[r.process] = byProc[r.process] || { qty: 0, wage: 0, n: 0 };
      p.qty += num(r.okQty); p.wage += wage; p.n++;
    });
    function stat(label, val, color) {
      return '<div style="flex:1;min-width:140px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px">' +
        '<div style="font-size:12px;color:#6b7280">' + label + '</div>' +
        '<div style="font-size:22px;font-weight:800;color:' + color + '">' + val + '</div></div>';
    }
    var html = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">' +
      stat('应发工资合计(元)', money(total), '#111827') +
      stat('计件工资(元)', money(piece), '#1d4ed8') +
      stat('计时工资(元)', money(timed), '#ea580c') +
      stat('报工记录数', wr.length, '#16a34a') +
      '</div>';
    function aggTable(title, obj, qtyLabel) {
      var keys = Object.keys(obj).sort(function (a, b) { return obj[b].wage - obj[a].wage; });
      var h = '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin-bottom:14px">' +
        '<div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:8px">' + title + '（' + keys.length + '）</div>';
      h += '<div class="erp-tablewrap"><table class="erp-table"><thead><tr><th>' + qtyLabel + '</th><th>完工数量</th><th>报工次数</th><th>工资合计(元)</th></tr></thead><tbody>';
      if (!keys.length) h += '<tr><td colspan="4" class="erp-empty">暂无数据</td></tr>';
      keys.forEach(function (k) {
        var o = obj[k];
        h += '<tr><td>' + escHtml(k) + '</td><td>' + o.qty + '</td><td>' + o.n + '</td><td>' + money(o.wage) + '</td></tr>';
      });
      h += '</tbody></table></div></div>';
      return h;
    }
    html += aggTable('按报工人汇总', byWorker, '报工人');
    html += aggTable('按工单汇总', byMo, '工单号');
    html += aggTable('按工序汇总', byProc, '工序');
    html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px">' +
      '<div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:8px">报工明细（' + wr.length + ' 条，最多显示 200 条）</div>';
    html += '<div class="erp-tablewrap"><table class="erp-table"><thead><tr>' +
      '<th>单号</th><th>工单</th><th>工序</th><th>报工人</th><th>日期</th><th>合格</th><th>不良</th><th>工时</th><th>工价</th><th>工资(元)</th>' +
      '</tr></thead><tbody>';
    var show = wr.slice(-200).reverse();
    if (!show.length) html += '<tr><td colspan="10" class="erp-empty">暂无报工记录</td></tr>';
    show.forEach(function (r) {
      var wage = r.priceType === '计时' ? num(r.hours) * num(r.price) : num(r.okQty) * num(r.price);
      html += '<tr><td>' + escHtml(r.code) + '</td><td>' + escHtml(r.moCode) + '</td><td>' + escHtml(r.process) + '</td>' +
        '<td>' + escHtml(r.worker) + '</td><td>' + escHtml(r.rptDate) + '</td><td>' + escHtml(r.okQty) + '</td>' +
        '<td>' + escHtml(r.badQty) + '</td><td>' + escHtml(r.hours) + '</td>' +
        '<td>' + escHtml(r.priceType || '') + ' ' + escHtml(r.price || '') + '</td><td>' + money(wage) + '</td></tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  };

  /* ---------- 物料档案：产品归集（一个物料可挂在多个产品下） ---------- */
  var PROD_SEP = /[，,、;；\/]/;
  function prodArr(v) {
    return String(v == null ? '' : v).split(PROD_SEP)
      .map(function (x) { return x.trim(); }).filter(Boolean);
  }
  /* BOM 里 product 存的是成品物料编码 → 转成产品名称 */
  ERP.prodName = function (v) {
    var s0 = String(v == null ? '' : v).trim();
    if (!s0) return '';
    var mats = listOf('material');
    for (var i = 0; i < mats.length; i++) {
      if (String(mats[i].code) === s0) return String(mats[i].name || s0).trim();
    }
    return s0;
  };
  /* 产品清单：BOM 的产品 + 成品类物料 + 物料上已填的适用产品（动态汇总，不写死） */
  ERP.productList = function () {
    var out = [], seen = {};
    function add(v) {
      var n = ERP.prodName(v);
      if (!n || seen[n]) return;
      seen[n] = 1; out.push(n);
    }
    listOf('bom').forEach(function (b) { add(b.product); });
    listOf('material').forEach(function (m) {
      if (String(m.category || '').trim() === '成品') add(m.code);
    });
    listOf('material').forEach(function (m) {
      prodArr(m.products).forEach(add);
    });
    out.sort(function (a, b) { return a.localeCompare(b, 'zh'); });
    return out;
  };
  /* 把物料挂到产品下（去重） */
  ERP.attachProduct = function (matCode, prod) {
    var c = String(matCode == null ? '' : matCode).trim();
    var p = String(prod == null ? '' : prod).trim();
    if (!c || !p) return false;
    var mats = listOf('material');
    for (var i = 0; i < mats.length; i++) {
      if (String(mats[i].code) !== c) continue;
      var arr = prodArr(mats[i].products);
      if (arr.indexOf(p) >= 0) return false;
      arr.push(p);
      mats[i].products = arr.join('，');
      return true;
    }
    return false;
  };
  /* 按 BOM 一次性补全「物料 ↔ 产品」归属（对已存在的物料也生效） */
  ERP.fillProductsFromBom = function () {
    var n = 0;
    listOf('bom').forEach(function (b) {
      var pname = ERP.prodName(b.product);
      if (!pname) return;
      if (ERP.attachProduct(b.product, pname)) n++;      /* 成品自身也归到该产品 */
      (b.items || []).forEach(function (it) {
        if (it && it.code && ERP.attachProduct(it.code, pname)) n++;
      });
    });
    if (n) save();
    return n;
  };
  ERP.doFillProducts = function () {
    var n = ERP.fillProductsFromBom();
    toast(n ? '已按 BOM 补全 ' + n + ' 处「物料 ↔ 产品」归属' : '物料归属已是最新，无需补全');
    ERP.renderList();
  };
  ERP.setProd = function (v) { ERP.prod = v || ''; ERP.renderList(); };
  ERP.toggleGroup = function () { ERP.groupProd = !ERP.groupProd; ERP.renderList(); };

  /* ---------- 物料档案：根据 BOM 自动生成 ---------- */
  ERP.fromBom = function () {
    var n = ERP.syncFromBom();
    toast(n ? '已从 BOM 自动生成 ' + n + ' 条物料档案' : 'BOM 中的物料已全部建档，无需生成');
    ERP.renderList();
  };
  ERP.syncFromBom = function () {
    var d = getData(); if (!d) return 0;
    if (!d.bom) d.bom = [];
    var mats = d.material || (d.material = []);
    var byCode = {};
    mats.forEach(function (m) { if (m.code) byCode[String(m.code).toLowerCase()] = 1; });
    var want = [];
    d.bom.forEach(function (b) {
      var pname = ERP.prodName(b.product);
      if (b.product) want.push({ code: b.product, prod: pname, category: '成品' });
      (b.items || []).forEach(function (it) {
        if (it.code) want.push({ code: it.code, name: it.name, unit: it.unit, spec: it.spec, prod: pname });
      });
    });
    var added = 0;
    want.forEach(function (w) {
      var c = String(w.code || '').trim();
      if (!c || byCode[c.toLowerCase()]) return;
      mats.push({ id: uid('r'), code: c, name: w.name || c,
        products: w.prod || '', spec: w.spec || '', unit: w.unit || 'PCS',
        category: w.category || '', safeStock: '', price: '',
        supplier: '', remark: '由 BOM 自动生成，请补充完整' });
      byCode[c.toLowerCase()] = 1;
      added++;
    });
    /* 已有物料也按 BOM 补上产品归属（内部自带 save） */
    ERP.fillProductsFromBom();
    if (added) save();
    return added;
  };

  /* 物料档案专用：产品筛选 + 分组 + 补全归属 */
  function productBar() {
    var list = ERP.productList();
    var h = '<select class="erp-search" style="min-width:200px" onchange="ERP.setProd(this.value)">'
      + '<option value="">按产品：全部</option>';
    list.forEach(function (p) {
      h += '<option value="' + escAttr(p) + '"' + (ERP.prod === p ? ' selected' : '') + '>' + escHtml(p) + '</option>';
    });
    h += '<option value="__none__"' + (ERP.prod === '__none__' ? ' selected' : '') + '>（未归属产品）</option>'
      + '</select>'
      + '<div class="erp-btn" onclick="ERP.toggleGroup()">' + (ERP.groupProd ? '▤ 取消分组' : '▤ 按产品分组') + '</div>'
      + '<div class="erp-btn" onclick="ERP.doFillProducts()">🔗 补全归属</div>';
    return h;
  }

  function barHtml(ent) {
    var kw = escAttr(ERP.kw || '');
    return '<div class="erp-bar">' +
      '<div class="erp-btn back" onclick="ERP.openHome()">← 返回</div>' +
      (ent.view === 'moboard' ? '<div class="erp-btn primary" onclick="ERP.openMoNew()">＋ 新建工单</div>' :
        ent.view === 'workreport' ? '<div class="erp-btn primary" onclick="ERP.openWorkReport()">＋ 新建报工</div>' :
        ent.view === 'payroll' ? '' :
        '<input class="erp-search" id="erpKw" placeholder="搜索本模块…" value="' + kw + '" oninput="ERP.doSearch(this.value)">' +
        '<div class="erp-btn primary" onclick="ERP.openForm()">＋ 新增</div>') +
      '<div class="erp-btn" onclick="ERP.exportCurrent()">⬇ 导出 Excel</div>' +
      '<div class="erp-btn" onclick="ERP.openImport()">📥 导入表格</div>' +
      (ent.key === 'material' ? '<div class="erp-btn" onclick="ERP.fromBom()">🧩 从 BOM 生成</div>' : '') +
      (ent.key === 'material' ? productBar() : '') +
      '</div>';
  }

  /* ---------- 删除 ---------- */
  ERP.submitFlow = function (id) {
    var key = ERP.current, rec = null;
    var arr = listOf(key);
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) { rec = arr[i]; break; }
    if (!rec || !rec.flowId) { toast('该单据尚未发起流程', false); return; }
    try {
      var f = BIZFLOW.getFlow(rec.flowId);
      if (!f) { toast('流程不存在', false); return; }
      BIZFLOW.submit(rec.flowId);
      ERP.renderList();
    } catch (e) { toast('提交失败：' + e.message, false); }
  };
  ERP.flowCell = function (r, key) {
    if (!r || !r.flowStatus) return ERP.flowTag(r);
    var h = ERP.flowTag(r);
    try {
      var f = window.BIZFLOW && BIZFLOW.getFlow(r.flowId);
      if (f) {
        var nd = BIZFLOW.curNode(f);
        if (nd) h += '<div class="erp-flownode">环节：' + escHtml(nd.name) + '（' + escHtml(nd.dept) + '）</div>';
        if (f.status === '流转中') {
          h += '<span class="erp-op" onclick="ERP.submitFlow(\'' + r.id + '\')">提交审批</span>';
        }
        if (f.status === '待审批') {
          var ca = false;
          try { ca = BIZFLOW.canApprove(f); } catch (e) {}
          if (ca) {
            h += '<span class="erp-op" onclick="ERP.approveFlow(\'' + r.id + '\', 1)">✓ 通过</span>' +
              '<span class="erp-op danger" onclick="ERP.approveFlow(\'' + r.id + '\', 0)">驳回</span>';
          }
        }
      }
    } catch (e) {}
    return h;
  };
  ERP.openApprovals = function () {
    ERP.current = '__appr';
    ERP.kw = '';
    showEl('page-erp-list');
    setTitle('我的审批');
    var f = $('fabAdd'); if (f) f.style.display = 'none';
    var s = $('searchBtn'); if (s) s.style.display = 'none';
    ERP.renderList();
    window.scrollTo(0, 0);
  };
  ERP.refName = function (key, code) {
    try {
      var arr = listOf(key) || [];
      for (var i = 0; i < arr.length; i++) {
        if (String(arr[i].code || '').toLowerCase() === String(code || '').toLowerCase()) return arr[i].name || code;
      }
    } catch (e) {}
    return code;
  };
  ERP.approvalDetail = function (f) {
    var d = getData() || {};
    var keys = ['so', 'soReturn', 'mo', 'pr', 'po', 'poRecv', 'stockIn', 'moPick', 'moIn', 'soShip', 'afterSale', 'renovate'];
    var rec = null, rk = '';
    var id = f.srcId || f.soId || '';
    for (var i = 0; i < keys.length; i++) {
      var arr = d[keys[i]] || [];
      for (var j = 0; j < arr.length; j++) if (arr[j].id === id) { rec = arr[j]; rk = keys[i]; break; }
      if (rec) break;
    }
    var nd = null;
    try { nd = BIZFLOW.curNode(f); } catch (e) {}
    var boxes = [];
    boxes.push('审批环节：<b>' + escHtml(nd ? nd.name : '') + '</b>（' + escHtml(nd ? nd.dept : '') + '）');
    if (rec) {
      var ent = ENTITIES[rk];
      boxes.push('单据：<b>' + escHtml(ent ? ent.name : rk) + ' ' + escHtml(rec.code || '') + '</b>');
      var party = rec.customer || rec.supplier || rec.applicant || '';
      if (party) {
        var rk2 = rec.customer ? 'customer' : (rec.supplier ? 'supplier' : '');
        var pname = rk2 ? ERP.refName(rk2, party) : party;
        var plabel = rec.customer ? '客户' : (rec.supplier ? '供应商' : '申请人');
        boxes.push(plabel + '：<b>' + escHtml(pname) + '</b>' + (pname && pname !== party ? '（' + escHtml(party) + '）' : ''));
      }
      if (rec.dept && !rec.customer && !rec.supplier) boxes.push('需求部门：<b>' + escHtml(rec.dept) + '</b>');
      var dt = rec.orderDate || rec.applyDate || rec.date || '';
      if (dt) boxes.push('日期：<b>' + escHtml(dt) + '</b>');
      if (rec.deliveryDate) boxes.push('交货日期：<b>' + escHtml(rec.deliveryDate) + '</b>');
      if (rec.dueDate) boxes.push('要求日期：<b>' + escHtml(rec.dueDate) + '</b>');
      if (rec.product) boxes.push('产品：<b>' + escHtml(rec.product) + (rec.planQty ? ' × ' + escHtml(rec.planQty) : '') + '</b>');
      if (rec.planQty && !rec.product) boxes.push('数量：<b>' + escHtml(rec.planQty) + '</b>');
      if (rec.amount !== '' && rec.amount !== null && rec.amount !== undefined) boxes.push('金额：<b>' + escHtml(rec.amount) + '</b>');
      if (rec.status) boxes.push('单据状态：<b>' + escHtml(rec.status) + '</b>');
    } else {
      boxes.push('未关联到源单据（流程：' + escHtml(f.title || '') + '）');
    }
    var h = '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #e5e7eb;color:#374151;font-size:13px;line-height:2">' +
      boxes.map(function (t) { return '<span style="display:inline-block;margin-right:18px">' + t + '</span>'; }).join('') + '</div>';
    if (rec && (rec.items || []).length) {
      var items = rec.items;
      h += '<div style="margin-top:6px;color:#374151;font-size:13px;line-height:2"><b>明细（' + items.length + ' 项）</b>：' +
        items.map(function (it) {
          return '<span style="display:inline-block;margin-right:14px;background:#f3f4f6;border-radius:4px;padding:1px 8px">' +
            escHtml(it.name || it.code || '') + '（' + escHtml(it.code || '') + '） × ' + escHtml(it.qty != null ? it.qty : '') + escHtml(it.unit || '') +
            (it.remark ? ' · ' + escHtml(it.remark) : '') + '</span>';
        }).join('') + '</div>';
    }
    if (rec && rec.remark) h += '<div style="margin-top:4px;color:#6b7280;font-size:12.5px">备注：' + escHtml(rec.remark) + '</div>';
    if (f.log && f.log.length) {
      var last = f.log.slice(-2);
      h += '<div style="margin-top:6px;color:#6b7280;font-size:12.5px">流转记录：' + last.map(function (t) { return escHtml(t); }).join(' ｜ ') + '</div>';
    }
    return h;
  };
  ERP.approvalView = function () {
    var out = [];
    try {
      if (window.BIZFLOW) {
        BIZFLOW.flows().forEach(function (f) {
          if (f.status !== '待审批') return;
          var ok = false;
          try { ok = BIZFLOW.canApprove(f); } catch (e) {}
          if (ok) out.push(f);
        });
      }
    } catch (e) {}
    var html = '<div class="erp-bar"><span class="erp-back" onclick="ERP.openHome()">← 返回</span>' +
      '<b>待我审批（' + out.length + '）</b></div>';
    if (!out.length) {
      html += '<div class="erp-empty">暂无待我审批的流程</div>';
      return html;
    }
    out.forEach(function (f) {
      var nd = null;
      try { nd = BIZFLOW.curNode(f); } catch (e) {}
      html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:12px">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap">' +
        '<div style="min-width:260px;flex:1">' +
        '<div style="font-size:15px;font-weight:600;color:#111827">' + escHtml(f.no || '') + '　' + escHtml(f.title || '') +
        '<span style="margin-left:8px;background:#fef3c7;color:#b45309;border-radius:4px;padding:1px 8px;font-size:12px">待审批</span></div>' +
        '<div style="color:#6b7280;font-size:12.5px;margin-top:4px">提交人：' + escHtml(f._submitBy || '') + '　提交时间：' + escHtml(f._submitAt || '') +
        '　审批人：' + escHtml(f.approver || '') + '</div>' +
        '</div>' +
        '<div style="white-space:nowrap">' +
        '<span class="erp-op" onclick="ERP.approveFlow(\'' + f.id + '\', 1)">✓ 通过并流转</span>' +
        '<span class="erp-op danger" onclick="ERP.approveFlow(\'' + f.id + '\', 0)">驳回</span>' +
        '</div></div>' +
        ERP.approvalDetail(f) +
        '</div>';
    });
    return html;
  };
  ERP.approveFlow = function (id, pass) {
    try {
      if (!window.BIZFLOW) { toast('流程引擎未就绪', false); return; }
      BIZFLOW.approve(id, !!pass);
      ERP.renderList();
    } catch (e) { toast('审批失败：' + e.message, false); }
  };
  ERP.startFlow = function (id) {
    var key = ERP.current;
    try {
      if (key === 'so' && window.BIZFLOW && BIZFLOW.startFromSo) BIZFLOW.startFromSo(id);
      else if (key === 'soReturn' && window.BIZFLOW && BIZFLOW.startFromRtn) BIZFLOW.startFromRtn(id);
      else { toast('该模块暂不支持自动流转', false); return; }
      ERP.renderList();
    } catch (e) { toast('发起流程失败：' + e.message, false); }
  };
  ERP.flowTag = function (r) {
    if (!r || !r.flowStatus) return '<span class="erp-tag" style="background:#f0f0f0;color:#999">未发起</span>';
    var map = { '流转中': ['流转中', '#1f5a38', '#e8f5ec'], '待审批': ['待审批', '#b45309', '#fef3c7'],
      '待评审': ['待评审', '#b91c1c', '#fee2e2'], '已完成': ['已完成', '#166534', '#dcfce7'],
      '已驳回': ['已驳回', '#b91c1c', '#fee2e2'], '已关闭': ['已关闭', '#6b7280', '#f3f4f6'] };
    var m = map[r.flowStatus] || ['流转中', '#1f5a38', '#e8f5ec'];
    return '<span class="erp-tag" style="background:' + m[2] + ';color:' + m[1] + '">' + m[0] + '</span>';
  };

  ERP.delRow = function (id) {
    var key = ERP.current, ent = ENTITIES[key];
    if (!ent) return;
    var d = getData(), arr = d[key] || [];
    var idx = -1;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) { idx = i; break; }
    if (idx < 0) return;
    var label = arr[idx].name || arr[idx].code || '该记录';
    if (!confirm('确定删除「' + label + '」？删除后不可恢复。')) return;
    arr.splice(idx, 1);
    save();
    ERP.renderList();
    toast('已删除');
  };

  /* ---------- 对外暴露 ---------- */
  ERP._getData = getData;
  ERP._save = save;
  ERP._listOf = listOf;
  ERP._nextCode = nextCode;
  ERP._cellVal = cellVal;
  ERP._injectSidebar = injectSidebar;
  ERP._barHtml = barHtml;

  /* ---------- 启动 ---------- */
  function boot() {
    try {
      var _side = global.renderSidebar;
      if (typeof _side === 'function' && !_side.__erp2) {
        var ns = function () {
          _side.apply(this, arguments);
          try { injectSidebar(); } catch (e) { console.error(e); }
        };
        ns.__erp2 = true;
        global.renderSidebar = ns;
      }
    } catch (e) { console.error(e); }
    try { if (typeof global.renderSidebar === 'function') global.renderSidebar(); } catch (e) {}
    try { if (getData()) save(); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 0);

})(window);

/* ==================== ERP 引擎 · 表单 / 库存视图 / 报表 / 导出 ==================== */
(function (global) {
  var ERP = global.ERP;
  if (!ERP) return;
  var ENTITIES = ERP.ENTITIES;
  var $ = ERP.$, escHtml = ERP.escHtml, escAttr = ERP.escAttr, toast = ERP.toast;
  var num = ERP.num, money = ERP.money, uid = ERP.uid;
  function getData() { return ERP._getData(); }
  function save() { ERP._save(); }
  function listOf(k) { return ERP._listOf(k); }

  function itemField(ent) {
    for (var i = 0; i < ent.fields.length; i++) if (ent.fields[i].type === 'items') return ent.fields[i];
    return null;
  }
  function findRec(refKey, code) {
    var arr = listOf(refKey);
    for (var i = 0; i < arr.length; i++) if (arr[i].code === code) return arr[i];
    return null;
  }
  /* 下拉选项：本地 opts + 全局字典(FIELDS) + 系统里已出现过的值（自动收集，选项永远够用） */
  function dictOptions(f) {
    var out = (f && f.opts) ? f.opts.slice() : [];
    var name = f && f.dict;
    if (name && window.FIELDS && typeof FIELDS.dict === 'function') {
      (FIELDS.dict(name) || []).forEach(function (x) { if (x !== '' && out.indexOf(x) < 0) out.push(x); });
    }
    /* 「人员」：自动收集各单据里已经填过的人名，选过一次就能下拉选 */
    if (name === '人员') {
      [['warehouse', 'keeper'], ['stockIn', 'operator'], ['stockOut', 'receiver'],
       ['stockCheck', 'checker'], ['moPick', 'picker'], ['pr', 'applicant'],
       ['afterSale', 'owner'], ['renovate', 'owner'], ['so', 'salesman'],
       ['po', 'buyer']].forEach(function (p) {
        var arr = [];
        try { arr = listOf(p[0]) || []; } catch (e) { arr = []; }
        arr.forEach(function (r) {
          var val = r && r[p[1]];
          if (val && out.indexOf(String(val)) < 0) out.push(String(val));
        });
      });
    }

    /* dictFrom: 'material.location,warehouse.location' —— 把系统里已有的值也收进来 */
    if (f && f.dictFrom) {
      String(f.dictFrom).split(',').forEach(function (src) {
        var p = String(src).trim().split('.'), key = p[0], col = p[1];
        if (!key || !col) return;
        var arr = [];
        try { arr = listOf(key) || []; } catch (e) { arr = []; }
        arr.forEach(function (r) {
          var val = r && r[col];
          if (val !== undefined && val !== null && String(val) !== '' && out.indexOf(String(val)) < 0) {
            out.push(String(val));
          }
        });
      });
    }
    return out;
  }
  ERP.dictOptions = dictOptions;

  /* 收集全局所有「下拉选项」用到的字典名，供字典管理界面参考 */
  function usedDictNames() {
    var set = [];
    function add(n) { if (n && set.indexOf(n) < 0) set.push(n); }
    Object.keys(ENTITIES).forEach(function (k) {
      (ENTITIES[k].fields || []).forEach(function (f) {
        add(f.dict);
        if (f.type === 'items') (f.cols || []).forEach(function (c) { add(c.dict); });
      });
    });
    return set;
  }
  ERP.usedDictNames = usedDictNames;

  function refOptions(refKey, val) {
    var arr = listOf(refKey), h = '<option value="">— 请选择 —</option>', hit = false;
    arr.forEach(function (r) {
      if (r.code === val) hit = true;
      h += '<option value="' + escAttr(r.code) + '"' + (r.code === val ? ' selected' : '') + '>' +
        escHtml(String(r.code) + (r.name ? ' ' + r.name : '')) + '</option>';
    });
    if (val && !hit) h = '<option value="' + escAttr(val) + '" selected>' + escHtml(String(val)) + '</option>' + h;
    return h;
  }

  /* ---------- 表单：字段控件 ---------- */
  function fieldHtml(f, val, rec) {
    var v = val == null ? '' : val;
    var inp = '';
    /* 该自动的字段：只读展示，不让用户填 */
    var ro = false, hint = '';
    if (f.auto) { ro = true; hint = '系统自动生成'; }
    if (f.k === 'status' && rec && (rec.flowId || rec.flowStatus)) { ro = true; hint = '由业务流转自动更新'; }
    if (ro) {
      return '<div class="erp-f"><label>' + f.label + '</label>' +
        '<input class="erp-in erp-readonly" id="erpf_' + f.k + '" value="' + escAttr(v) + '" readonly>' +
        '<span class="erp-hint">' + hint + '</span></div>';
    }
    if (f.type === 'select') {
      var opts = dictOptions(f);
      var _vv = String(v == null ? '' : v);
      if (_vv !== '' && opts.map(String).indexOf(_vv) < 0) opts.unshift(_vv);
      var _dattr = ' data-erpdict="' + escAttr(f.dict || '') + '"' + (f.dictFrom ? ' data-erpdictfrom="' + escAttr(f.dictFrom) + '"' : '');
      inp = '<select class="erp-in" id="erpf_' + f.k + '"' + _dattr + '>';
      inp += '<option value=""' + (_vv === '' ? ' selected' : '') + '>— 请选择 —</option>';
      opts.forEach(function (o) {
        inp += '<option value="' + escAttr(o) + '"' + (String(o) === _vv ? ' selected' : '') + '>' + escHtml(o) + '</option>';
      });
      inp += '</select>';
    } else if (f.type === 'textarea') {
      inp = '<textarea class="erp-in" id="erpf_' + f.k + '" rows="2">' + escHtml(v) + '</textarea>';
    } else if (f.type === 'ref') {
      inp = '<select class="erp-in" id="erpf_' + f.k + '">' + refOptions(f.ref, v) + '</select>';
    } else if (f.type === 'date') {
      inp = '<input type="date" class="erp-in" id="erpf_' + f.k + '" value="' + escAttr(v) + '">';
    } else if (f.type === 'number') {
      inp = '<input type="number" step="any" class="erp-in" id="erpf_' + f.k + '" value="' + escAttr(v) + '">';
    } else if (f.type === 'calcSum') {
      inp = '<input class="erp-in erp-readonly" id="erpf_' + f.k + '" value="' + escAttr(v) + '" readonly>';
    } else {
      inp = '<input type="text" class="erp-in" id="erpf_' + f.k + '" value="' + escAttr(v) + '">';
    }
    var _gear = f.dict
      ? '<span class="erp-gear" title="管理「' + escAttr(f.dict) + '」的下拉选项" onclick="ERP.openDictManager(\'' + escAttr(f.dict) + '\')">⚙</span>'
      : '';
    return '<div class="erp-f"><label>' + f.label + (f.req ? ' <i>*</i>' : '') + _gear + '</label>' + inp +
      (f.tip ? '<span class="erp-hint">' + f.tip + '</span>' : '') + '</div>';
  }

  /* ---------- 明细行 ---------- */
  function itemCellHtml(c, row, i) {
    var v = row[c.k] == null ? '' : row[c.k];
    if (c.type === 'select') {
      var so = dictOptions(c);
      if (v !== '' && so.indexOf(String(v)) < 0) so.unshift(String(v));
      var _cd = ' data-erpdict="' + escAttr(c.dict || '') + '"' + (c.dictFrom ? ' data-erpdictfrom="' + escAttr(c.dictFrom) + '"' : '');
      var sh = '<select class="erp-in sm"' + _cd + ' onchange="ERP.itemChange(' + i + ',\'' + c.k + '\',this.value,1)">';
      sh += '<option value=""' + (v === '' ? ' selected' : '') + '>— 请选择 —</option>';
      so.forEach(function (op) {
        sh += '<option value="' + escAttr(op) + '"' + (String(v) === String(op) ? ' selected' : '') + '>' + escHtml(op) + '</option>';
      });
      return sh + '</select>';
    }
    if (c.type === 'ref') {
      return '<select class="erp-in sm" onchange="ERP.itemChange(' + i + ',\'' + c.k + '\',this.value,1)">' +
        refOptions(c.ref, v) + '</select>';
    }
    if (c.type === 'number') {
      return '<input type="number" step="any" class="erp-in sm" value="' + escAttr(v) + '" ' +
        'oninput="ERP.itemChange(' + i + ',\'' + c.k + '\',this.value,0)">';
    }
    if (c.type === 'date') {
      return '<input type="date" class="erp-in sm" value="' + escAttr(v) + '" ' +
        'oninput="ERP.itemChange(' + i + ',\'' + c.k + '\',this.value,0)">';
    }
    if (c.type === 'calc') {
      return '<span class="erp-calc" id="erpc_' + i + '_' + c.k + '">' + escHtml(v) + '</span>';
    }
    return '<input type="text" class="erp-in sm" value="' + escAttr(v) + '" ' +
      'oninput="ERP.itemChange(' + i + ',\'' + c.k + '\',this.value,0)">';
  }

  ERP.renderItems = function () {
    var box = $('erpItemsBox');
    if (!box) return;
    var ent = ENTITIES[ERP.current], f = itemField(ent);
    if (!f) return;
    var arr = ERP._items || [];
    var html = '<div class="erp-tablewrap"><table class="erp-table items"><thead><tr>';
    f.cols.forEach(function (c) {
      html += '<th style="min-width:' + (c.w || '100px') + '">' + c.label +
        (c.dict ? ' <span class="erp-gear" title="管理「' + escAttr(c.dict) + '」的下拉选项" onclick="ERP.openDictManager(\'' + escAttr(c.dict) + '\')">⚙</span>' : '') +
        '</th>';
    });
    html += '<th style="min-width:56px">删</th></tr></thead><tbody>';
    if (!arr.length) {
      html += '<tr><td colspan="' + (f.cols.length + 1) + '" class="erp-empty">' +
        (fillFieldOf(ERP.current) ? '从上方「' + fillFieldOf(ERP.current).label + '」自动带出' : '暂无明细') + '</td></tr>';
    } else {
      arr.forEach(function (row, i) {
        html += '<tr>';
        f.cols.forEach(function (c) { html += '<td>' + itemCellHtml(c, row, i) + '</td>'; });
        html += '<td class="erp-ops"><span class="erp-op danger" onclick="ERP.delItemRow(' + i + ')">✕</span></td></tr>';
      });
    }
    html += '</tbody></table></div>';
    html += '<div class="erp-items-foot"><span class="erp-addrow" onclick="ERP.addItemRow()">＋ 增加一行</span>' +
            '<span class="erp-foot-tip">明细可增行、可删行；填满最后一行会自动续一行</span></div>';
    box.innerHTML = html;
    ERP.calcTotals();
  };

  /* 直接在表格末尾续一行并立即显示：不重建整表，所以输入焦点不丢，也不折叠 */
  function appendRowLive() {
    if (!ERP._items) ERP._items = [];
    var ent = ENTITIES[ERP.current], f = itemField(ent);
    if (!f) return;
    var row = {};
    f.cols.forEach(function (c) { row[c.k] = ''; });
    ERP._items.push(row);
    var i = ERP._items.length - 1;
    var tb = document.querySelector('#erpItemsBox table.items tbody');
    if (!tb) { ERP.renderItems(); return; }
    var tr = document.createElement('tr');
    var h = '';
    f.cols.forEach(function (c) { h += '<td>' + itemCellHtml(c, row, i) + '</td>'; });
    h += '<td class="erp-ops"><span class="erp-op danger" onclick="ERP.delItemRow(' + i + ')">✕</span></td>';
    tr.innerHTML = h;
    tb.appendChild(tr);
    ERP.calcTotals();
  }

  ERP.addItemRow = function () {
    if (!ERP._items) ERP._items = [];
    var ent = ENTITIES[ERP.current], f = itemField(ent);
    var row = {};
    f.cols.forEach(function (c) { row[c.k] = ''; });
    ERP._items.push(row);
    ERP.renderItems();
    var box = $('erpItemsBox');
    if (box) box.scrollIntoView({ block: 'nearest' });
  };

  ERP.delItemRow = function (i) {
    if (!ERP._items) return;
    ERP._items.splice(i, 1);
    ERP.renderItems();
  };

  ERP.itemChange = function (i, k, v, rerender) {
    var arr = ERP._items;
    if (!arr || !arr[i]) return;
    arr[i][k] = v;
    var ent = ENTITIES[ERP.current], f = itemField(ent);
    if (f) {
      f.cols.forEach(function (c) {
        if (!c.autoFrom) return;
        var parts = String(c.autoFrom).split(':');
        if (parts[0] !== k) return;
        if (parts[1] === '__stock__') {
          var _bal = 0;
          try {
            (ERP.buildStock() || []).forEach(function (r) { if (String(r.code) === String(v)) _bal = r.bal; });
          } catch (e) { _bal = 0; }
          arr[i][c.k] = _bal;
          return;
        }
        var src = findRec(c.ref || f.cols[0].ref, v);
        if (src) arr[i][c.k] = src[parts[1]] == null ? '' : src[parts[1]];
      });
    }
    /* 一旦填到最后一行，就在下方直接续一行，保证一直有空格可填 */
    if (f && i === arr.length - 1) {
      var _has = false;
      f.cols.forEach(function (c) { if (String(arr[i][c.k] == null ? '' : arr[i][c.k]).trim() !== '') _has = true; });
      if (_has) appendRowLive();
    }
    if (rerender) ERP.renderItems();
    else ERP.calcTotals();
  };

  ERP.calcTotals = function () {
    var ent = ENTITIES[ERP.current];
    if (!ent) return;
    var items = ERP._items || [];
    var sumField = null;
    ent.fields.forEach(function (f) { if (f.type === 'calcSum') sumField = f; });
    var itemCols = itemField(ent) ? itemField(ent).cols : [];
    items.forEach(function (row, i) {
      itemCols.forEach(function (c) {
        if (c.type !== 'calc') return;
        var el = $('erpc_' + i + '_' + c.k);
        if (!el) return;
        var expr = String(c.expr || '').replace(/([a-zA-Z_][a-zA-Z0-9_]*)/g, function (m) {
          return 'num(row["' + m + '"])';
        });
        var v = 0;
        try { v = eval(expr); } catch (e) { v = 0; }
        el.textContent = money(v);
        row[c.k] = v;
      });
    });
    if (sumField) {
      var s = 0;
      items.forEach(function (row) { s += num(row[sumField.col]); });
      var el2 = $('erpf_' + sumField.k);
      if (el2) el2.value = money(s);
    }
  };

  /* ---------- 打开表单 ---------- */
  ERP.openForm = function (id) {
    var key = ERP.current, ent = ENTITIES[key];
    if (!ent || ent.view) return;
    var arr = listOf(key), rec = null, i;
    if (id) for (i = 0; i < arr.length; i++) if (arr[i].id === id) rec = arr[i];
    ERP._isNew = !rec;
    if (!rec) {
      rec = { id: uid('r') };
      ent.fields.forEach(function (f) {
        if (f.type === 'items') rec[f.k] = [];
        else if (f.def === 'today') rec[f.k] = ERP.today();
        else if (f.def !== undefined) rec[f.k] = f.def;
        else rec[f.k] = '';
      });
      if (!rec.code) rec.code = ERP._nextCode(ent);
    }
    ERP._edit = rec;
    ERP._items = itemField(ent) ? (rec[itemField(ent).k] || (rec[itemField(ent).k] = [])) : null;
    /* 新增时直接把明细行铺出来，始终留有空行可填，不需要手动添加 */
    if (ERP._isNew && ERP._items && !ERP._items.length) {
      var _if = itemField(ent), _cols = (_if && _if.cols) || [];
      for (var _r = 0; _r < 8; _r++) {
        var _row = {};
        _cols.forEach(function (c) { _row[c.k] = ''; });
        ERP._items.push(_row);
      }
    }

    var html = '<div class="erp-form">';
    ent.fields.forEach(function (f) {
      if (f.type === 'items') return;
      html += fieldHtml(f, rec[f.k], rec);
    });
    html += '</div>';
    var f2 = itemField(ent);
    if (f2) {
      var _fillField = null;
      ent.fields.forEach(function (x) { if (x.fill) _fillField = x; });
      html += '<div class="erp-items"><div class="erp-items-head"><span>' + f2.label + '</span>' +
        (_fillField ? '<span class="erp-fillhint">选「' + _fillField.label + '」可自动带出明细</span>' : '') +
        '</div>' +
        '<div id="erpItemsBox"></div></div>';
    }
    var _ft = $('erpModal') ? $('erpModal').querySelector('.modal-footer') : null;
    if (_ft) {
      var _qrBtn = (key === 'mo' && !ERP._isNew && rec.code)
        ? '<button class="btn" onclick="ERP.printMoQrByCode(\'' + escAttr(rec.code) + '\')">🏷 二维码</button>'
        : '';
      _ft.innerHTML = _qrBtn + '<button class="btn btn-cancel" onclick="ERP.closeForm()">取消</button>' +
        '<button class="btn btn-save" onclick="ERP.saveForm()">保存</button>';
    }
    var t = $('erpFormTitle');
    if (t) t.textContent = (ERP._isNew ? '新增' : '编辑') + ' · ' + ent.name;
    var b = $('erpFormBody');
    if (b) b.innerHTML = html;
    var m = $('erpModal');
    if (m) m.classList.add('show');
    if (f2) ERP.renderItems();
    else ERP.calcTotals();
    ERP.bindFill();
  };

  /* ==================== 单据联动：选来源单自动带出明细 ==================== */
  function fillFieldOf(key) {
    var ent = ENTITIES[key]; if (!ent) return null;
    var hit = null;
    (ent.fields || []).forEach(function (f) { if (f.fill && !hit) hit = f; });
    return hit;
  }
  ERP.fillFieldOf = fillFieldOf;

  ERP.bindFill = function () {
    var ent = ENTITIES[ERP.current]; if (!ent) return;
    (ent.fields || []).forEach(function (f) {
      if (!f.fill) return;
      var el = $('erpf_' + f.k); if (!el) return;
      el.addEventListener('change', function () { ERP.applyFill(f, el.value, true); });
      if (el.value) ERP.applyFill(f, el.value, false);
    });
  };

  /* code: 来源单号；ask: 是否用户主动选择（需要提示） */
  ERP.applyFill = function (f, code, ask) {
    if (!code) return;
    var cfg = f.fill || {};
    var keys = cfg.lookIn && cfg.lookIn.length ? cfg.lookIn : [cfg.from];
    var src = null, srcKey = '';
    for (var i = 0; i < keys.length && !src; i++) {
      if (!keys[i]) continue;
      var arr = listOf(keys[i]);
      for (var j = 0; j < arr.length; j++) {
        if (String(arr[j].code) === String(code)) { src = arr[j]; srcKey = keys[i]; break; }
      }
    }
    if (!src) { if (ask) toast('没有找到单号 ' + code, false); return; }
    /* 表头联动 */
    if (cfg.map) {
      Object.keys(cfg.map).forEach(function (to) {
        var from = cfg.map[to];
        var val = src[from];
        if (val == null || val === '') return;
        var el = $('erpf_' + to);
        if (el) el.value = val;
      });
    }
    /* 明细联动 */
    var box = cfg.items && src[cfg.items] ? src[cfg.items] : null;
    if (box && box.length) {
      /* 必须就地改写，保持与当前记录 items 的同一数组引用，否则保存会丢明细 */
      var copy = JSON.parse(JSON.stringify(box));
      if (ERP._items) {
        ERP._items.length = 0;
        for (var q = 0; q < copy.length; q++) ERP._items.push(copy[q]);
      } else {
        ERP._items = copy;
      }
      ERP.renderItems();
      if (ask) toast('已从 ' + code + ' 带出 ' + ERP._items.length + ' 行明细，可按实际修改');
    } else if (ask) {
      toast(code + ' 没有明细行，请手工录入', false);
    }
  };

  ERP.closeForm = function () {
    var m = $('erpModal');
    if (m) m.classList.remove('show');
    ERP._edit = null;
    ERP._items = null;
  };

  /* ---------- 保存 ---------- */
  ERP.saveForm = function () {
    var key = ERP.current, ent = ENTITIES[key], rec = ERP._edit;
    if (!ent || !rec) return;
    var miss = [];
    ent.fields.forEach(function (f) {
      if (f.type === 'items' || f.type === 'calcSum') return;
      var el = $('erpf_' + f.k);
      if (!el) return;
      rec[f.k] = el.value;
      if (f.type === 'number') rec[f.k] = (el.value === '' ? '' : el.value);
    });
    ent.fields.forEach(function (f) {
      if (f.type === 'items') return;
      if (f.req && !String(rec[f.k] == null ? '' : rec[f.k]).trim()) miss.push(f.label);
    });
    if (miss.length) { toast('请填写：' + miss.join('、')); return; }
    /* 只保留真正填过的明细行，多铺的空白行不落库 */
    var _if2 = itemField(ent);
    if (_if2 && ERP._items) {
      var _cols2 = _if2.cols || [];
      var _keep = ERP._items.filter(function (r) {
        for (var _j = 0; _j < _cols2.length; _j++) {
          if (String(r[_cols2[_j].k] == null ? '' : r[_cols2[_j].k]).trim() !== '') return true;
        }
        return false;
      });
      ERP._items.length = 0;
      _keep.forEach(function (r) { ERP._items.push(r); });
    }
    var d = getData();
    if (!d[key]) d[key] = [];
    if (ERP._isNew) d[key].push(rec);
    save();
    if (key === 'bom') ERP.syncFromBom();
    try {
      if (ERP._isNew && key === 'so' && window.BIZFLOW && BIZFLOW.startFromSo) BIZFLOW.startFromSo(rec.id);
      if (ERP._isNew && key === 'soReturn' && window.BIZFLOW && BIZFLOW.startFromRtn) BIZFLOW.startFromRtn(rec.id);
    } catch (e) { console.error('自动发起流程失败:', e); }
    ERP.closeForm();
    ERP.renderList();
    toast('已保存 · ' + ent.name);
  };

  /* ---------- 库存台账视图 ---------- */
  ERP.stockView = function () {
    var rows = ERP.buildStock();
    function clsOf(r) { return r.cat; }
    var groups = [
      { key: '原材料', label: '原材料库存', desc: '塑胶 / 五金 / 电子 / 发热 / 包材 / 辅料等' },
      { key: '半成品', label: '半成品库存', desc: '物料档案类别为「半成品」' },
      { key: '成品', label: '成品库存', desc: '生产成品 + 售后翻新成品 合并台账，售后翻新带印记' }
    ];
    function balOf(r, k) { return r.bal; }
    function adjOf(r) { return r.adj || 0; }
    function inOf(r, k) { return r.in; }
    function outOf(r, k) { return r.out; }
    var html = '<div class="erp-count">库存台账按类别分开：原材料 / 半成品 / 成品（售后翻新成品并入成品台账并带印记，共 <b>' + rows.length + '</b> 种物料）· 结存 = 入库 − 出库 + 盘点调整（盘点单状态改为「已完成」后自动计入）</div>';
    groups.forEach(function (g) {
      var rs = rows.filter(function (r) {
        if (g.key === '成品') return r.cat === '成品' || r.aftIn > 0;
        return clsOf(r) === g.key;
      });
      var inSum = 0, outSum = 0, lowN = 0;
      rs.forEach(function (r) { inSum += inOf(r, g.key); outSum += outOf(r, g.key); if (r.safe > 0 && balOf(r, g.key) < r.safe) lowN++; });
      html += '<div class="erp-stock-group"><div class="erp-stock-title"><b>' + g.label + '</b>' +
        '<span class="erp-stock-desc">' + g.desc + '</span>' +
        '<span class="erp-stock-sum">' + rs.length + ' 种 · 入库 ' + inSum + ' · 出库 ' + outSum +
        (lowN ? ' · <span style="color:#dc2626">' + lowN + ' 种低于安全库存</span>' : '') + '</span></div>';
      html += '<div class="erp-tablewrap"><table class="erp-table"><thead><tr>' +
        '<th style="min-width:130px">物料编码</th><th style="min-width:150px">物料名称</th>' +
        '<th style="min-width:120px">规格型号</th><th style="min-width:70px">单位</th>' +
        '<th style="min-width:90px">入库合计</th><th style="min-width:90px">出库合计</th>' +
        '<th style="min-width:90px">盘点调整</th>' +
        '<th style="min-width:90px">结存</th><th style="min-width:90px">安全库存</th>' +
        '<th style="min-width:110px">状态</th></tr></thead><tbody>';
      if (!rs.length) {
        html += '<tr><td colspan="10" class="erp-empty">暂无数据</td></tr>';
      } else {
        rs.forEach(function (r) {
          var bal = balOf(r, g.key), low = r.safe > 0 && bal < r.safe;
          var tag = low ? '<span class="erp-tag danger">低于安全库存</span>'
            : (bal <= 0 ? '<span class="erp-tag">无库存</span>' : '<span class="erp-tag ok">正常</span>');
          var mark = (g.key === '成品' && r.aftIn > 0) ? ' <span class="erp-tag aft" title="含退货/翻新入库 ' + r.aftIn + ' 件">售后翻新</span>' : '';
          html += '<tr><td>' + escHtml(r.code) + '</td><td>' + escHtml(r.name) + mark + '</td><td>' + escHtml(r.spec) + '</td>' +
            '<td>' + escHtml(r.unit) + '</td><td>' + inOf(r, g.key) + '</td><td>' + outOf(r, g.key) + '</td>' +
            '<td>' + (adjOf(r) ? (adjOf(r) > 0 ? '+' + adjOf(r) : adjOf(r)) : '') + '</td>' +
            '<td><b>' + bal + '</b></td><td>' + (r.safe || '') + '</td><td>' + tag + '</td></tr>';
        });
      }
      html += '</tbody></table></div></div>';
    });
    return html;
  };

  /* ---------- 报表视图 ---------- */
  function simpleTable(title, heads, rows, empty) {
    var h = '<div class="erp-rep"><div class="erp-rep-title">' + title + '</div>';
    h += '<div class="erp-tablewrap"><table class="erp-table"><thead><tr>';
    heads.forEach(function (x) { h += '<th style="min-width:' + (x.w || '110px') + '">' + x.t + '</th>'; });
    h += '</tr></thead><tbody>';
    if (!rows.length) h += '<tr><td colspan="' + heads.length + '" class="erp-empty">' + (empty || '暂无数据') + '</td></tr>';
    else rows.forEach(function (r) {
      h += '<tr>';
      r.forEach(function (c) { h += '<td>' + escHtml(c) + '</td>'; });
      h += '</tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  ERP.reportView = function () {
    var html = '';

    /* ===== 图表区 ===== */
    html += '<div class="rp-grid">'
      + rpBox('rpSaleTrend', '销售订单金额趋势（近 12 个月）')
      + rpBox('rpBuySup', '采购金额统计（按供应商）')
      + rpBox('rpStockTop', '库存结存 TOP 10')
      + rpBox('rpMoStatus', '生产工单状态分布')
      + rpBox('rpInspRate', '检验合格率（按类型）')
      + rpBox('rpMrbConcl', '不合格评审结论分布')
      + rpBox('rpAfterFault', '售后故障 TOP')
      + '</div>';

    // 1. 库存结存
    var st = ERP.buildStock();
    var stRows = st.map(function (r) { return [r.code, r.name, r.unit, String(r.in), String(r.out), String(r.bal), (r.safe || '')]; });
    html += simpleTable('库存结存汇总', [
      { t: '物料编码' }, { t: '物料名称' }, { t: '单位', w: '70px' },
      { t: '入库合计', w: '90px' }, { t: '出库合计', w: '90px' },
      { t: '结存', w: '90px' }, { t: '安全库存', w: '90px' }
    ], stRows, '先在物料档案建档并录入出入库单');

    // 2. 销售订单
    var soRows = listOf('so').map(function (s) {
      return [s.code, s.customer, s.orderDate, s.deliveryDate, money(s.amount), s.status];
    });
    html += simpleTable('销售订单汇总', [
      { t: '订单号' }, { t: '客户' }, { t: '下单日期', w: '110px' }, { t: '交货日期', w: '110px' },
      { t: '订单金额', w: '110px' }, { t: '状态', w: '90px' }
    ], soRows);

    // 3. 采购统计
    var buyMap = {};
    listOf('po').forEach(function (p) {
      var k = p.supplier || '(未指定)';
      if (!buyMap[k]) buyMap[k] = { cnt: 0, amt: 0 };
      buyMap[k].cnt++;
      buyMap[k].amt += num(p.amount);
    });
    var buyRows = Object.keys(buyMap).map(function (k) { return [k, String(buyMap[k].cnt), money(buyMap[k].amt)]; });
    html += simpleTable('采购金额统计（按供应商）', [
      { t: '供应商' }, { t: '订单数', w: '100px' }, { t: '采购金额', w: '130px' }
    ], buyRows);

    // 4. 生产进度
    var moRows = listOf('mo').map(function (m) {
      var plan = num(m.planQty), done = num(m.doneQty);
      var pct = plan > 0 ? Math.round(done / plan * 100) + '%' : '-';
      return [m.code, m.product, String(plan), String(done), pct, m.status];
    });
    html += simpleTable('生产工单进度', [
      { t: '工单号' }, { t: '产品' }, { t: '计划数', w: '90px' }, { t: '完成数', w: '90px' },
      { t: '完成率', w: '90px' }, { t: '状态', w: '100px' }
    ], moRows);

    return html;
  };

  /* ---------- 导出 Excel ---------- */
  function tableToRows(ent) {
    var rows = [];
    if (ent.view === 'stock') {
      rows.push(['物料编码', '物料名称', '规格型号', '单位', '入库合计', '出库合计', '结存', '安全库存']);
      ERP.buildStock().forEach(function (r) {
        rows.push([r.code, r.name, r.spec, r.unit, r.in, r.out, r.bal, r.safe]);
      });
      return rows;
    }
    var cols = ent.fields.filter(function (f) { return f.type !== 'textarea'; });
    var head = [];
    cols.forEach(function (f) {
      if (f.type === 'items') { f.cols.forEach(function (c) { head.push(f.label + '-' + c.label); }); }
      else head.push(f.label);
    });
    rows.push(head);
    var arr = listOf(ent.key), kw = (ERP.kw || '').trim().toLowerCase();
    if (kw) arr = arr.filter(function (r) { return JSON.stringify(r).toLowerCase().indexOf(kw) >= 0; });
    arr.forEach(function (r) {
      var items = null;
      cols.forEach(function (f) { if (f.type === 'items') items = r[f.k] || []; });
      var base = [];
      cols.forEach(function (f) {
        if (f.type === 'items') return;
        base.push(ERP._cellVal(ent, r, f));
      });
      if (!items || !items.length) { rows.push(base); return; }
      items.forEach(function (it, idx) {
        var line = base.slice();
        cols.forEach(function (f) {
          if (f.type !== 'items') return;
          f.cols.forEach(function (c) { line.push(it[c.k] == null ? '' : it[c.k]); });
        });
        rows.push(line);
      });
    });
    return rows;
  }

  function csvDownload(rows, filename) {
    var csv = rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? '' : c);
        return '"' + s.replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\r\n');
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 600);
  }


  /* ==================== 表格批量导入（基础资料/业务单据通用） ==================== */
  /* 明细列提示：物料编码@数量@单价…（按实体明细字段动态生成） */
  function itemHint(ent) {
    var f = itemField(ent);
    if (!f || !f.cols) return '物料编码@数量';
    var defs = f.cols.filter(function (c) { return c.k !== 'code' && c.type !== 'calc' && !c.autoFrom; });
    return '物料编码' + defs.map(function (c) { return '@' + c.label; }).join('');
  }

  function _tplHeaders(ent) {
    var hs = [];
    ent.fields.forEach(function (f) {
      if (f.type === 'items' || f.type === 'textarea') return;
      hs.push(f.label);
    });
    if (itemField(ent)) hs.push('物料明细');
    return hs;
  }

  ERP.downloadTpl = function () {
    var key = ERP.current, ent = ENTITIES[key];
    if (!ent || ent.view) return;
    var hs = _tplHeaders(ent);
    var h = '<table border="1"><tr>';
    hs.forEach(function (c) { h += '<th>' + c + '</th>'; });
    h += '</tr><tr>';
    hs.forEach(function (c) {
      var cell = (c === '物料明细') ? itemHint(ent) + '，多组用 ; 分隔' : '';
      h += '<td>' + cell + '</td>';
    });
    h += '</tr></table>';
    try {
      if (typeof global.exportHtmlTableToXlsx === 'function') {
        global.exportHtmlTableToXlsx(h, ent.name + '-导入模板.xlsx', ent.name);
        toast('已下载导入模板');
        return;
      }
    } catch (e) {}
    toast('模板导出模块未就绪，请刷新页面', false);
  };

  ERP._impRows = null;
  ERP.openImport = function () {
    var key = ERP.current, ent = ENTITIES[key];
    if (!ent || ent.view) return;
    ERP._impRows = null;
    var t = $('erpFormTitle'); if (t) t.textContent = '表格导入 · ' + ent.name;
    var b = $('erpFormBody');
    if (!b) return;
    b.innerHTML = ''
      + '<div style="margin-bottom:12px;color:#666;font-size:13px">批量导入 <b>' + escHtml(ent.name) + '</b>：'
      + '可 <b>选择 Excel 文件</b>，或从 Excel 复制表格后 <b>直接粘贴</b> 到下方。'
      + '第一行必须是表头（' + escHtml(_tplHeaders(ent).join(' / ')) + '）。'
      + '编码留空自动编号；已存在的记录自动跳过。</div>'
      + '<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">'
      + '<span class="erp-btn" onclick="ERP.downloadTpl()">⬇ 下载导入模板</span>'
      + '<label class="erp-btn primary" style="cursor:pointer">📄 选择 Excel 文件'
      + '<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="ERP.readFile(this)"></label>'
      + '</div>'
      + '<div style="margin-bottom:6px;color:#888;font-size:12px">或直接粘贴（从 Excel 复制后 Ctrl+V）：</div>'
      + '<textarea id="erpImpText" rows="6" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:12px" placeholder="从 Excel 复制数据后粘贴到这里…"></textarea>'
      + '<div style="margin-top:8px;display:flex;gap:8px;align-items:center">'
      + '<span class="erp-btn" onclick="ERP.parseImport()">解析预览</span>'
      + '<span id="erpImpInfo" style="color:#888;font-size:12px"></span></div>'
      + '<div id="erpImpPreview" style="margin-top:10px"></div>';
    var ft = $('erpModal') ? $('erpModal').querySelector('.modal-footer') : null;
    if (ft) ft.innerHTML = ''
      + '<button class="btn btn-cancel" onclick="ERP.closeImport()">取消</button>'
      + '<button class="btn btn-save" onclick="ERP.doImport()">确认导入</button>';
    var m = $('erpModal');
    if (m) m.classList.add('show');
  };

  ERP.closeImport = function () {
    var m = $('erpModal'); if (m) m.classList.remove('show');
    var ft = $('erpModal') ? $('erpModal').querySelector('.modal-footer') : null;
    if (ft) ft.innerHTML = '<button class="btn btn-cancel" onclick="ERP.closeForm()">取消</button>' +
      '<button class="btn btn-save" onclick="ERP.saveForm()">保存</button>';
    ERP._impRows = null;
  };

  ERP.readFile = function (inp) {
    var f = inp.files && inp.files[0];
    if (!f) return;
    if (typeof XLSX === 'undefined') { toast('Excel 解析组件未加载，请刷新页面', false); return; }
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var data = new Uint8Array(ev.target.result);
        var wb = XLSX.read(data, { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        ERP._impRows = rows;
        ERP.showPreview();
      } catch (e) { toast('文件解析失败：' + e.message, false); }
    };
    reader.readAsArrayBuffer(f);
  };

  ERP.parseImport = function () {
    var txt = $('erpImpText') ? $('erpImpText').value : '';
    if (!txt.trim()) { toast('请先粘贴数据', false); return; }
    var lines = txt.replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); });
    var rows = lines.map(function (l) { return l.split('\t'); });
    ERP._impRows = rows;
    ERP.showPreview();
  };

  ERP.showPreview = function () {
    var key = ERP.current, ent = ENTITIES[key], rows = ERP._impRows;
    var info = $('erpImpInfo'), box = $('erpImpPreview');
    if (!rows || !rows.length) { if (info) info.textContent = '未解析到数据'; return; }
    if (info) info.textContent = '共 ' + (rows.length - 1) + ' 行数据（首行为表头）';
    var hs = _tplHeaders(ent);
    var h = '<div style="max-height:240px;overflow:auto"><table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:12px;width:100%">';
    h += '<tr style="background:#f0f7f3">';
    hs.forEach(function (c) { h += '<th>' + escHtml(c) + '</th>'; });
    h += '</tr>';
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      h += '<tr>';
      hs.forEach(function (c, ci) { h += '<td>' + escHtml(r[ci] == null ? '' : r[ci]) + '</td>'; });
      h += '</tr>';
    }
    h += '</table></div>';
    if (box) box.innerHTML = h;
  };

  ERP.doImport = function () {
    var key = ERP.current, ent = ENTITIES[key];
    if (!ent || ent.view) return;
    var rows = ERP._impRows;
    if (!rows || rows.length < 2) { toast('没有可导入的数据', false); return; }
    var hs = _tplHeaders(ent);
    var header = rows[0].map(function (c) { return String(c == null ? '' : c).trim(); });
    var colIdx = {};
    hs.forEach(function (label) { var idx = header.indexOf(label); if (idx >= 0) colIdx[label] = idx; });
    var miss = hs.filter(function (label) { return colIdx[label] === undefined; });
    if (miss.length === hs.length) { toast('表头无法识别，请先「下载导入模板」填写', false); return; }

    var d = getData();
    if (!d[key]) d[key] = [];
    var exist = {};
    d[key].forEach(function (r) {
      if (r.code) exist[String(r.code).toLowerCase()] = 1;
      if (r.name) exist['n:' + String(r.name).toLowerCase()] = 1;
    });

    var added = 0, skipped = 0, empty = 0, errs = [];
    var itemsField = itemField(ent);
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      var rec = { id: uid('r') };
      var hasVal = false, reqMiss = [];
      ent.fields.forEach(function (f) {
        if (f.type === 'items' || f.type === 'textarea') return;
        var idx = colIdx[f.label];
        var v = idx === undefined ? '' : String(row[idx] == null ? '' : row[idx]).trim();
        if (v) hasVal = true;
        if (f.k === 'code' && !v) return;
        if (f.type === 'number') rec[f.k] = (v === '' ? '' : num(v));
        else rec[f.k] = v;
        if (f.req && !v && f.k !== 'code') reqMiss.push(f.label);
      });
      if (!hasVal) { empty++; continue; }
      var codeV = String(rec.code || '').toLowerCase();
      if (codeV && exist[codeV]) { skipped++; continue; }
      if (rec.name && exist['n:' + String(rec.name).toLowerCase()]) { skipped++; continue; }
      if (reqMiss.length) { errs.push('第' + (i + 1) + '行缺：' + reqMiss.join(',')); continue; }
      if (!rec.code) rec.code = ERP._nextCode(ent);
      if (itemsField) {
        var itIdx = colIdx['物料明细'];
        var raw = itIdx === undefined ? '' : String(row[itIdx] == null ? '' : row[itIdx]).trim();
        rec[itemsField.k] = [];
        if (raw) {
          var colDefs = itemsField.cols.filter(function (c) { return c.k !== 'code' && c.type !== 'calc' && !c.autoFrom; });
          raw.split(/[;；]/).forEach(function (seg) {
            seg = seg.trim();
            if (!seg) return;
            var parts = seg.split('@');
            var codeRaw = (parts[0] || '').trim();
            var itName = '';
            if (codeRaw.indexOf(':') >= 0) { itName = codeRaw.slice(codeRaw.indexOf(':') + 1).trim(); codeRaw = codeRaw.slice(0, codeRaw.indexOf(':')).trim(); }
            else if (codeRaw.indexOf('：') >= 0) { itName = codeRaw.slice(codeRaw.indexOf('：') + 1).trim(); codeRaw = codeRaw.slice(0, codeRaw.indexOf('：')).trim(); }
            var it = { code: codeRaw, name: itName };
            colDefs.forEach(function (c, idx) {
              var v = parts[idx + 1] == null ? '' : String(parts[idx + 1]).trim();
              if (v === '') return;
              if (c.type === 'number') it[c.k] = num(v); else it[c.k] = v;
            });
            var m = findRec('material', it.code);
            if (m) { it.name = m.name || ''; it.unit = m.unit || ''; }
            rec[itemsField.k].push(it);
          });
        }
      }
      d[key].push(rec);
      exist[String(rec.code).toLowerCase()] = 1;
      if (rec.name) exist['n:' + String(rec.name).toLowerCase()] = 1;
      added++;
    }
    save();
    if (key === 'bom') ERP.syncFromBom();
    ERP.closeImport();
    ERP.renderList();
    var msg = '导入完成：新增 ' + added + (skipped ? '，跳过重复 ' + skipped : '') +
      (empty ? '，空行 ' + empty : '') + (errs.length ? '，失败 ' + errs.length : '');
    toast(msg);
    if (errs.length) setTimeout(function () { alert('导入失败明细（最多显示10条）：\n' + errs.slice(0, 10).join('\n')); }, 120);
  };


  function rpBox(id, title) {
    return '<div class="rp-card"><div class="rp-card-t">' + title + '</div><div id="' + id + '" class="rp-chart" style="height:260px">'
      + '<div style="color:#9aa7b4;font-size:13px;padding:60px 0;text-align:center">数据不足或组件未加载</div></div></div>';
  }

  /* ===== 报表图表渲染（ECharts） ===== */
  ERP.renderCharts = function () {
    if (!window.echarts) return;
    function el(id) { return document.getElementById(id); }
    function pad2(n) { return n < 10 ? '0' + n : '' + n; }
    function opt(id, option) {
      var dom = el(id);
      if (!dom) return;
      var c = echarts.getInstanceByDom(dom);
      if (c) c.dispose();
      c = echarts.init(dom);
      c.setOption(option);
      return c;
    }
    var charts = [];
    var GREEN = '#1f7a4d', GRAY = '#c4ccd6';

    /* 1. 销售订单金额趋势 */
    (function () {
      var months = [], amt = {};
      for (var i = 11; i >= 0; i--) { var d = new Date(); d.setMonth(d.getMonth() - i); months.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1)); amt[months[months.length - 1]] = 0; }
      listOf('so').forEach(function (so) { var m = String(so.orderDate || '').slice(0, 7); if (amt[m] !== undefined) amt[m] += num(so.amount); });
      charts.push(opt('rpSaleTrend', {
        grid: { left: 50, right: 16, top: 26, bottom: 30 },
        xAxis: { type: 'category', data: months, axisLabel: { rotate: 30, fontSize: 10 } },
        yAxis: { type: 'value' },
        tooltip: { trigger: 'axis' },
        series: [{ type: 'bar', data: months.map(function (m) { return amt[m]; }), itemStyle: { color: GREEN }, barWidth: '55%' }]
      }));
    })();

    /* 2. 采购金额按供应商 */
    (function () {
      var bm = {};
      listOf('po').forEach(function (po) { var k = po.supplier || '(未指定)'; bm[k] = (bm[k] || 0) + num(po.amount); });
      var keys = Object.keys(bm).sort(function (a, b) { return bm[b] - bm[a]; }).slice(0, 10);
      charts.push(opt('rpBuySup', {
        grid: { left: 90, right: 20, top: 16, bottom: 26 },
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: keys, axisLabel: { fontSize: 11 } },
        tooltip: { trigger: 'axis' },
        series: [{ type: 'bar', data: keys.map(function (k) { return bm[k]; }), itemStyle: { color: '#2d6cdf' }, barWidth: '55%' }]
      }));
    })();

    /* 3. 库存结存 TOP 10 */
    (function () {
      var st = ERP.buildStock().slice().sort(function (a, b) { return b.bal - a.bal; }).slice(0, 10);
      charts.push(opt('rpStockTop', {
        grid: { left: 90, right: 20, top: 16, bottom: 26 },
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: st.map(function (r) { return r.name || r.code; }), axisLabel: { fontSize: 11 } },
        tooltip: { trigger: 'axis' },
        series: [{ type: 'bar', data: st.map(function (r) { return r.bal; }), itemStyle: { color: '#e6a23c' }, barWidth: '55%' }]
      }));
    })();

    /* 4. 生产工单状态分布 */
    (function () {
      var sm = {};
      listOf('mo').forEach(function (m) { var k = m.status || '未设置'; sm[k] = (sm[k] || 0) + 1; });
      var keys = Object.keys(sm);
      charts.push(opt('rpMoStatus', {
        tooltip: { trigger: 'item' },
        legend: { bottom: 0, fontSize: 11 },
        series: [{ type: 'pie', radius: ['38%', '62%'], center: ['50%', '45%'],
          data: keys.map(function (k) { return { name: k, value: sm[k] }; }),
          label: { fontSize: 11 }, itemStyle: { borderColor: '#fff', borderWidth: 1 } }]
      }));
    })();

    /* 5. 检验合格率（按类型） */
    (function () {
      var insp = []; try { var d = window.DATAHUB && DATAHUB.get('inspect'); insp = (d && d.inspections) || []; } catch (e) {}
      var types = ['IQC', 'FIRST', 'PATROL', 'OQC'];
      var names = { IQC: '进料', FIRST: '首件', PATROL: '巡检', OQC: '成品' };
      var data = types.map(function (t) {
        var arr = insp.filter(function (r) { return r.type === t; });
        var pass = arr.filter(function (r) { return r.result === 'pass'; }).length;
        return arr.length ? Math.round(pass / arr.length * 100) : 0;
      });
      charts.push(opt('rpInspRate', {
        grid: { left: 50, right: 20, top: 26, bottom: 30 },
        xAxis: { type: 'category', data: types.map(function (t) { return names[t]; }), axisLabel: { fontSize: 11 } },
        yAxis: { type: 'value', max: 100 },
        tooltip: { trigger: 'axis' },
        series: [{ type: 'bar', data: data, itemStyle: { color: '#1f7a4d' }, barWidth: '45%', label: { show: true, position: 'top', fontSize: 11, formatter: '{c}%' } }]
      }));
    })();

    /* 6. 不合格评审结论分布 */
    (function () {
      var insp = []; try { var d = window.DATAHUB && DATAHUB.get('inspect'); insp = (d && d.inspections) || []; } catch (e) {}
      var sm = {};
      insp.forEach(function (r) { if (r.flowTo && String(r.flowTo).indexOf('MRB') >= 0) { var k = r.flowTo.replace('MRB 评审结论：', ''); sm[k] = (sm[k] || 0) + 1; } });
      var keys = Object.keys(sm);
      charts.push(opt('rpMrbConcl', {
        tooltip: { trigger: 'item' },
        legend: { bottom: 0, fontSize: 10 },
        series: [{ type: 'pie', radius: ['38%', '62%'], center: ['50%', '45%'],
          data: keys.map(function (k) { return { name: k, value: sm[k] }; }),
          label: { fontSize: 10 }, itemStyle: { borderColor: '#fff', borderWidth: 1 } }]
      }));
    })();

    /* 7. 售后故障 TOP */
    (function () {
      var fm = {};
      (listOf('afterSale') || []).forEach(function (a) { var k = String(a.fault || '(未填)').trim(); if (!k) k = '(未填)'; fm[k] = (fm[k] || 0) + num(a.qty || 1); });
      var keys = Object.keys(fm).sort(function (a, b) { return fm[b] - fm[a]; }).slice(0, 8);
      charts.push(opt('rpAfterFault', {
        grid: { left: 110, right: 20, top: 16, bottom: 26 },
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: keys, axisLabel: { fontSize: 10 } },
        tooltip: { trigger: 'axis' },
        series: [{ type: 'bar', data: keys.map(function (k) { return fm[k]; }), itemStyle: { color: '#8a5cd6' }, barWidth: '55%' }]
      }));
    })();

    window.addEventListener('resize', function () { charts.forEach(function (c) { if (c) c.resize(); }); });
  };

  ERP.exportCurrent = function () {
    var key = ERP.current, ent = ENTITIES[key];
    if (!ent) return;
    var rows = tableToRows(ent);
    var name = ent.name + (ERP.kw ? '_' + ERP.kw : '') + '.xlsx';
    function toHtml() {
      var h = '<table border="1"><tr>';
      rows[0].forEach(function (c) { h += '<th>' + String(c == null ? '' : c) + '</th>'; });
      h += '</tr>';
      for (var i = 1; i < rows.length; i++) {
        h += '<tr>';
        rows[i].forEach(function (c) { h += '<td>' + String(c == null ? '' : c) + '</td>'; });
        h += '</tr>';
      }
      return h + '</table>';
    }
    try {
      if (typeof global.exportHtmlTableToXlsx === 'function') {
        global.exportHtmlTableToXlsx(toHtml(), name, ent.name);
        toast('已导出 ' + name);
        return;
      }
    } catch (e) { console.error(e); }
    csvDownload(rows, name.replace(/\.xlsx$/, '.csv'));
    toast('已导出 CSV');
  };

})(window);

/* ===== ERPFORM_STYLE_V1：单据表单自动化后的样式 ===== */
(function () {
  if (document.getElementById('erpFormStyleV1')) return;
  var st = document.createElement('style');
  st.id = 'erpFormStyleV1';
  st.textContent = `
.erp-hint{display:block;font-size:11px;color:#94a3b8;margin-top:3px;line-height:1.3}
.erp-readonly{background:#f1f5f9!important;color:#64748b!important;cursor:not-allowed}
.erp-items-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.erp-fillhint{font-size:12px;color:#0f766e;background:#f0fdfa;border:1px solid #ccfbf1;
  padding:2px 10px;border-radius:12px;line-height:1.6}
.erp-items-head .erp-addrow{margin-left:auto}
@media(max-width:560px){
  .erp-items-head{gap:6px}
  .erp-fillhint{font-size:11px;padding:2px 8px}
  .erp-items-head .erp-addrow{margin-left:0}
}
`;
  document.head.appendChild(st);
})();
