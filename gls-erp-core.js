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
      desc: '料号、规格、单位、安全库存、参考单价',
      fields: [
        { k: 'code', label: '物料编码', type: 'text', req: true, auto: true, w: '130px' },
        { k: 'name', label: '物料名称', type: 'text', req: true },
        { k: 'spec', label: '规格型号', type: 'text' },
        { k: 'unit', label: '单位', type: 'select', opts: UNITS, def: 'PCS' },
        { k: 'category', label: '类别', type: 'select', opts: CATS },
        { k: 'safeStock', label: '安全库存', type: 'number' },
        { k: 'price', label: '参考单价', type: 'number' },
        { k: 'supplier', label: '默认供应商', type: 'text' },
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
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    warehouse: {
      key: 'warehouse', name: '仓库设置', icon: '🏬', group: '基础资料', prefix: 'W',
      desc: '仓库、库位、保管员',
      fields: [
        { k: 'code', label: '仓库编码', type: 'text', req: true, auto: true, w: '120px' },
        { k: 'name', label: '仓库名称', type: 'text', req: true },
        { k: 'location', label: '库位', type: 'text' },
        { k: 'keeper', label: '保管员', type: 'text' },
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
          { k: 'unit', label: '单位', type: 'text', w: '70px', autoFrom: 'code:unit' },
          { k: 'loss', label: '损耗率%', type: 'number', w: '80px' },
          { k: 'remark', label: '备注', type: 'text' }
        ] },
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
          { k: 'unit', label: '单位', type: 'text', w: '70px', autoFrom: 'code:unit' },
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
        { k: 'soCode', label: '关联订单号', type: 'text' },
        { k: 'customer', label: '客户', type: 'ref', ref: 'customer' },
        { k: 'shipDate', label: '发货日期', type: 'date', def: 'today' },
        { k: 'warehouse', label: '发货仓库', type: 'ref', ref: 'warehouse' },
        { k: 'items', label: '发货明细', type: 'items', cols: [
          { k: 'code', label: '物料/产品', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'qty', label: '数量', type: 'number', w: '90px' },
          { k: 'unit', label: '单位', type: 'text', w: '70px', autoFrom: 'code:unit' }
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
        { k: 'customer', label: '客户', type: 'ref', ref: 'customer' },
        { k: 'returnDate', label: '退货日期', type: 'date', def: 'today' },
        { k: 'items', label: '退货明细', type: 'items', cols: [
          { k: 'code', label: '物料/产品', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'qty', label: '数量', type: 'number', w: '90px' },
          { k: 'reason', label: '退货原因', type: 'text' }
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
        { k: 'owner', label: '分析人', type: 'text' },
        { k: 'date', label: '分析日期', type: 'date', def: 'today' }
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
        { k: 'owner', label: '负责人', type: 'text' },
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
        { k: 'dept', label: '申请部门', type: 'text' },
        { k: 'applicant', label: '申请人', type: 'text' },
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
        { k: 'supplier', label: '供应商', type: 'ref', ref: 'supplier', req: true },
        { k: 'orderDate', label: '下单日期', type: 'date', def: 'today' },
        { k: 'deliveryDate', label: '交货日期', type: 'date' },
        { k: 'items', label: '采购明细', type: 'items', cols: [
          { k: 'code', label: '物料', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'qty', label: '数量', type: 'number', w: '90px' },
          { k: 'unit', label: '单位', type: 'text', w: '70px', autoFrom: 'code:unit' },
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
        { k: 'poCode', label: '关联采购单', type: 'text' },
        { k: 'supplier', label: '供应商', type: 'ref', ref: 'supplier' },
        { k: 'recvDate', label: '收货日期', type: 'date', def: 'today' },
        { k: 'warehouse', label: '收货仓库', type: 'ref', ref: 'warehouse' },
        { k: 'items', label: '收货明细', type: 'items', cols: [
          { k: 'code', label: '物料', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
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
        { k: 'type', label: '入库类型', type: 'select', opts: ['采购入库', '生产入库', '退货入库', '其他入库'], def: '采购入库' },
        { k: 'inDate', label: '入库日期', type: 'date', def: 'today' },
        { k: 'warehouse', label: '仓库', type: 'ref', ref: 'warehouse' },
        { k: 'items', label: '入库明细', type: 'items', cols: [
          { k: 'code', label: '物料', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'qty', label: '数量', type: 'number', w: '90px' },
          { k: 'unit', label: '单位', type: 'text', w: '70px', autoFrom: 'code:unit' },
          { k: 'batch', label: '批次号', type: 'text', w: '120px' }
        ] },
        { k: 'source', label: '来源单号', type: 'text' },
        { k: 'operator', label: '经手人', type: 'text' },
        { k: 'status', label: '状态', type: 'select', opts: DOC_STATUS, def: '已审核' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    stockOut: {
      key: 'stockOut', name: '出库单', icon: '⬆️', group: '仓储管理', prefix: 'OUT',
      desc: '生产领料 / 销售出库，直接计入库存',
      fields: [
        { k: 'code', label: '出库单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'type', label: '出库类型', type: 'select', opts: ['生产领料', '销售出库', '其他出库'], def: '生产领料' },
        { k: 'outDate', label: '出库日期', type: 'date', def: 'today' },
        { k: 'warehouse', label: '仓库', type: 'ref', ref: 'warehouse' },
        { k: 'items', label: '出库明细', type: 'items', cols: [
          { k: 'code', label: '物料', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'qty', label: '数量', type: 'number', w: '90px' },
          { k: 'unit', label: '单位', type: 'text', w: '70px', autoFrom: 'code:unit' }
        ] },
        { k: 'source', label: '来源单号', type: 'text' },
        { k: 'receiver', label: '领用人', type: 'text' },
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
          { k: 'bookQty', label: '账面数', type: 'number', w: '90px' },
          { k: 'realQty', label: '实盘数', type: 'number', w: '90px' },
          { k: 'diff', label: '差异', type: 'calc', expr: 'realQty-bookQty', w: '80px' }
        ] },
        { k: 'checker', label: '盘点人', type: 'text' },
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
      desc: '工单下达、数量、进度',
      fields: [
        { k: 'code', label: '工单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'product', label: '生产产品', type: 'ref', ref: 'material', req: true },
        { k: 'planQty', label: '计划数量', type: 'number', req: true },
        { k: 'doneQty', label: '完成数量', type: 'number' },
        { k: 'soCode', label: '关联订单', type: 'text' },
        { k: 'startDate', label: '开工日期', type: 'date', def: 'today' },
        { k: 'dueDate', label: '完工日期', type: 'date' },
        { k: 'line', label: '生产线别', type: 'text' },
        { k: 'status', label: '状态', type: 'select', opts: ['待下达', '生产中', '已完工', '已关闭'], def: '待下达' },
        { k: 'remark', label: '备注', type: 'textarea' }
      ]
    },
    moPick: {
      key: 'moPick', name: '生产领料', icon: '📤', group: '生产管理', prefix: 'PK',
      desc: '按工单领料',
      fields: [
        { k: 'code', label: '领料单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'moCode', label: '关联工单', type: 'text' },
        { k: 'pickDate', label: '领料日期', type: 'date', def: 'today' },
        { k: 'warehouse', label: '领料仓库', type: 'ref', ref: 'warehouse' },
        { k: 'items', label: '领料明细', type: 'items', cols: [
          { k: 'code', label: '物料', type: 'ref', ref: 'material', w: '200px' },
          { k: 'name', label: '名称', type: 'text', w: '150px', autoFrom: 'code:name' },
          { k: 'qty', label: '数量', type: 'number', w: '90px' },
          { k: 'unit', label: '单位', type: 'text', w: '70px', autoFrom: 'code:unit' }
        ] },
        { k: 'picker', label: '领料人', type: 'text' },
        { k: 'status', label: '状态', type: 'select', opts: FLOW_STATUS, def: '已完成' }
      ]
    },
    moIn: {
      key: 'moIn', name: '完工入库', icon: '📦', group: '生产管理', prefix: 'FI',
      desc: '完工产品入库',
      fields: [
        { k: 'code', label: '入库单号', type: 'text', req: true, auto: true, w: '140px' },
        { k: 'moCode', label: '关联工单', type: 'text' },
        { k: 'product', label: '产品', type: 'ref', ref: 'material' },
        { k: 'qty', label: '入库数量', type: 'number' },
        { k: 'okQty', label: '合格数量', type: 'number' },
        { k: 'inDate', label: '入库日期', type: 'date', def: 'today' },
        { k: 'warehouse', label: '入库仓库', type: 'ref', ref: 'warehouse' },
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
    { name: '基础资料', icon: '📚', keys: ['material', 'customer', 'supplier', 'warehouse', 'bom'] },
    { name: '销售管理', icon: '📝', keys: ['so', 'soShip', 'soReturn'] },
    { name: '采购管理', icon: '🛒', keys: ['pr', 'po', 'poRecv'] },
    { name: '仓储管理', icon: '🏬', keys: ['stockIn', 'stockOut', 'stockCheck'], extras: ['stock'] },
    { name: '生产管理', icon: '🏭', keys: ['mo', 'moPick', 'moIn'] },
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
        map[code] = { code: code, name: name || code, unit: unit || '', spec: spec || '', in: 0, out: 0, safe: 0, bal: 0 };
        rows.push(map[code]);
      }
      if (name && map[code].name === code) map[code].name = name;
      if (unit) map[code].unit = unit;
      return map[code];
    }
    listOf('material').forEach(function (m) {
      var g = touch(m.code, m.name, m.unit, m.spec);
      if (g) { g.safe = num(m.safeStock); g.spec = m.spec || ''; }
    });
    listOf('stockIn').forEach(function (doc) {
      if (doc.status === '草稿' || doc.status === '已取消') return;
      (doc.items || []).forEach(function (it) {
        var g = touch(it.code, it.name, it.unit);
        if (g) g.in += num(it.qty);
      });
    });
    listOf('stockOut').forEach(function (doc) {
      if (doc.status === '草稿' || doc.status === '已取消') return;
      (doc.items || []).forEach(function (it) {
        var g = touch(it.code, it.name, it.unit);
        if (g) g.out += num(it.qty);
      });
    });
    rows.forEach(function (r) { r.bal = r.in - r.out; });
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
      '<div class="nav-item" data-erp2="1" onclick="ERP.openHome(); toggleSidebar()">' +
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

    var html = '<div class="erp-stats">' +
      statCard(st.length, '在管物料', '', 'stock') +
      statCard(docs, '业务单据', '', '') +
      statCard(waitSo, '待处理订单', waitSo ? 'warn' : '', 'so') +
      statCard(running, '在产工单', '', 'mo') +
      statCard(low, '低于安全库存', low ? 'danger' : '', 'stock') +
      '</div>';

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
    if (!ent) { box.innerHTML = '<div class="erp-empty">请从 ERP 工作台进入</div>'; return; }
    if (ent.view === 'stock') { box.innerHTML = barHtml(ent) + ERP.stockView(); return; }
    if (ent.view === 'report') {
      box.innerHTML = barHtml(ent) + ERP.reportView();
      if (window.echarts) setTimeout(function () { ERP.renderCharts(); }, 80);
      return;
    }

    var rows = listOf(key), kw = (ERP.kw || '').trim();
    if (kw) {
      var low2 = kw.toLowerCase();
      rows = rows.filter(function (r) { return JSON.stringify(r).toLowerCase().indexOf(low2) >= 0; });
    }
    var cols = ent.fields.filter(function (f) { return f.type !== 'items' && f.type !== 'textarea'; });
    var html = barHtml(ent);
    html += '<div class="erp-count">共 <b>' + rows.length + '</b> 条' +
      (kw ? ' · 关键词「' + escHtml(kw) + '」' : '') + '</div>';
    html += '<div class="erp-tablewrap"><table class="erp-table"><thead><tr>';
    cols.forEach(function (f) { html += '<th style="min-width:' + (f.w || '110px') + '">' + f.label + '</th>'; });
    html += '<th style="min-width:120px">操作</th></tr></thead><tbody>';
    if (!rows.length) {
      html += '<tr><td colspan="' + (cols.length + 1) + '" class="erp-empty">暂无数据，点「＋ 新增」开始录入</td></tr>';
    } else {
      rows.forEach(function (r) {
        html += '<tr>';
        cols.forEach(function (f) {
          var v = cellVal(ent, r, f);
          html += '<td>' + escHtml(v) + '</td>';
        });
        html += '<td class="erp-ops">' +
          '<span class="erp-op" onclick="ERP.openForm(\'' + r.id + '\')">编辑</span>' +
          '<span class="erp-op danger" onclick="ERP.delRow(\'' + r.id + '\')">删除</span>' +
          '</td></tr>';
      });
    }
    html += '</tbody></table></div>';
    box.innerHTML = html;
  };

  function barHtml(ent) {
    var kw = escAttr(ERP.kw || '');
    return '<div class="erp-bar">' +
      '<div class="erp-btn back" onclick="ERP.openHome()">← 返回</div>' +
      (ent.view ? '' :
        '<input class="erp-search" id="erpKw" placeholder="搜索本模块…" value="' + kw + '" oninput="ERP.doSearch(this.value)">' +
        '<div class="erp-btn primary" onclick="ERP.openForm()">＋ 新增</div>') +
      '<div class="erp-btn" onclick="ERP.exportCurrent()">⬇ 导出 Excel</div>' +
      '<div class="erp-btn" onclick="ERP.openImport()">📥 导入表格</div>' +
      '</div>';
  }

  /* ---------- 删除 ---------- */
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
  function fieldHtml(f, val) {
    var v = val == null ? '' : val;
    var inp = '';
    if (f.type === 'select') {
      var opts = f.opts || [];
      inp = '<select class="erp-in" id="erpf_' + f.k + '">';
      if (opts.indexOf(v) < 0) inp += '<option value="">' + (v ? escHtml(v) : '— 请选择 —') + '</option>';
      opts.forEach(function (o) {
        inp += '<option value="' + escAttr(o) + '"' + (o === v ? ' selected' : '') + '>' + escHtml(o) + '</option>';
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
    return '<div class="erp-f"><label>' + f.label + (f.req ? ' <i>*</i>' : '') + '</label>' + inp + '</div>';
  }

  /* ---------- 明细行 ---------- */
  function itemCellHtml(c, row, i) {
    var v = row[c.k] == null ? '' : row[c.k];
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
    f.cols.forEach(function (c) { html += '<th style="min-width:' + (c.w || '100px') + '">' + c.label + '</th>'; });
    html += '<th style="min-width:56px">删</th></tr></thead><tbody>';
    if (!arr.length) {
      html += '<tr><td colspan="' + (f.cols.length + 1) + '" class="erp-empty">点上方「＋ 添加明细行」录入</td></tr>';
    } else {
      arr.forEach(function (row, i) {
        html += '<tr>';
        f.cols.forEach(function (c) { html += '<td>' + itemCellHtml(c, row, i) + '</td>'; });
        html += '<td class="erp-ops"><span class="erp-op danger" onclick="ERP.delItemRow(' + i + ')">✕</span></td></tr>';
      });
    }
    html += '</tbody></table></div>';
    box.innerHTML = html;
    ERP.calcTotals();
  };

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
        var src = findRec(c.ref || f.cols[0].ref, v);
        if (src) arr[i][c.k] = src[parts[1]] == null ? '' : src[parts[1]];
      });
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

    var html = '<div class="erp-form">';
    ent.fields.forEach(function (f) {
      if (f.type === 'items') return;
      html += fieldHtml(f, rec[f.k]);
    });
    html += '</div>';
    var f2 = itemField(ent);
    if (f2) {
      html += '<div class="erp-items"><div class="erp-items-head"><span>' + f2.label + '</span>' +
        '<span class="erp-addrow" onclick="ERP.addItemRow()">＋ 添加明细行</span></div>' +
        '<div id="erpItemsBox"></div></div>';
    }
    var _ft = $('erpModal') ? $('erpModal').querySelector('.modal-footer') : null;
    if (_ft) _ft.innerHTML = '<button class="btn btn-cancel" onclick="ERP.closeForm()">取消</button>' +
      '<button class="btn btn-save" onclick="ERP.saveForm()">保存</button>';
    var t = $('erpFormTitle');
    if (t) t.textContent = (ERP._isNew ? '新增' : '编辑') + ' · ' + ent.name;
    var b = $('erpFormBody');
    if (b) b.innerHTML = html;
    var m = $('erpModal');
    if (m) m.classList.add('show');
    if (f2) ERP.renderItems();
    else ERP.calcTotals();
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
    var d = getData();
    if (!d[key]) d[key] = [];
    if (ERP._isNew) d[key].push(rec);
    save();
    ERP.closeForm();
    ERP.renderList();
    toast('已保存 · ' + ent.name);
  };

  /* ---------- 库存台账视图 ---------- */
  ERP.stockView = function () {
    var rows = ERP.buildStock();
    var inSum = 0, outSum = 0, lowN = 0;
    rows.forEach(function (r) {
      inSum += r.in; outSum += r.out;
      if (r.safe > 0 && r.bal < r.safe) lowN++;
    });
    var html = '<div class="erp-count">共 <b>' + rows.length + '</b> 种物料 · 入库合计 <b>' + inSum +
      '</b> · 出库合计 <b>' + outSum + '</b>' + (lowN ? ' · <span style="color:#dc2626">' + lowN + ' 种低于安全库存</span>' : '') + '</div>';
    html += '<div class="erp-tablewrap"><table class="erp-table"><thead><tr>' +
      '<th style="min-width:130px">物料编码</th><th style="min-width:150px">物料名称</th>' +
      '<th style="min-width:120px">规格型号</th><th style="min-width:70px">单位</th>' +
      '<th style="min-width:90px">入库合计</th><th style="min-width:90px">出库合计</th>' +
      '<th style="min-width:90px">结存</th><th style="min-width:90px">安全库存</th>' +
      '<th style="min-width:110px">状态</th></tr></thead><tbody>';
    if (!rows.length) {
      html += '<tr><td colspan="9" class="erp-empty">暂无数据：先到「基础资料 → 物料档案」建档，再录「入库单 / 出库单」</td></tr>';
    } else {
      rows.forEach(function (r) {
        var low = r.safe > 0 && r.bal < r.safe;
        var tag = low ? '<span class="erp-tag danger">低于安全库存</span>'
          : (r.bal <= 0 ? '<span class="erp-tag">无库存</span>' : '<span class="erp-tag ok">正常</span>');
        html += '<tr><td>' + escHtml(r.code) + '</td><td>' + escHtml(r.name) + '</td><td>' + escHtml(r.spec) + '</td>' +
          '<td>' + escHtml(r.unit) + '</td><td>' + r.in + '</td><td>' + r.out + '</td>' +
          '<td><b>' + r.bal + '</b></td><td>' + (r.safe || '') + '</td><td>' + tag + '</td></tr>';
      });
    }
    html += '</tbody></table></div>';
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
            var it = { code: (parts[0] || '').trim() };
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

