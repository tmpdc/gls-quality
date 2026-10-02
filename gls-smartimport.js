/* gls-smartimport.js — 智能识别导入引擎（GLSIMP）
 * 目标：
 *  1) 任意格式（WPS/Excel 复制、xlsx/xls/csv 文件、纯文本、粘贴）上传后自动识别是哪种表
 *  2) 表头智能匹配到系统字段：能识别的直接填进对应板块；识别不到的列作为「新增字段」保留
 *  3) 记录里没有的（物料/供应商/客户）自动建档，有的直接复用（不重复建）
 *  4) 模板原样保真：导入的表格/文档格式不被改动，可原样查看、直接填写或打印
 * 依赖：window.ERP（ENTITIES/nextCode）、window.DATAHUB、SheetJS(XLSX，可选)
 */

// ===== 保真转换：Excel 工作表 -> HTML 表格（处理合并单元格/列宽/行高）=====
function glsEsc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function glsSheetToHtml(ws) {
  if (!ws || !ws['!ref']) return '';
  var range = XLSX.utils.decode_range(ws['!ref']);
  var merges = ws['!merges'] || [];
  var cols = ws['!cols'] || [];
  var rowsInfo = ws['!rows'] || [];
  var span = {}, covered = {};
  merges.forEach(function (m) {
    if (!m || !m.s || !m.e) return;
    span[m.s.r + ',' + m.s.c] = [m.e.r - m.s.r + 1, m.e.c - m.s.c + 1];
    for (var r = m.s.r; r <= m.e.r; r++) {
      for (var c = m.s.c; c <= m.e.c; c++) {
        if (!(r === m.s.r && c === m.s.c)) covered[r + ',' + c] = 1;
      }
    }
  });
  var h = '<table class="gtbl" style="border-collapse:collapse;table-layout:fixed;width:100%;background:#fff;">';
  var total = 0, widths = [];
  for (var c0 = range.s.c; c0 <= range.e.c; c0++) {
    var w = (cols[c0] && (cols[c0].wch || cols[c0].width)) || 8;
    widths.push(w); total += w;
  }
  h += '<colgroup>';
  widths.forEach(function (w) { h += '<col style="width:' + (w / total * 100).toFixed(2) + '%">'; });
  h += '</colgroup>';
  for (var r = range.s.r; r <= range.e.r; r++) {
    var rh = (rowsInfo[r] && rowsInfo[r].hpx) ? Math.round(rowsInfo[r].hpx) : 24;
    if (rh < 18) rh = 18;
    h += '<tr style="height:' + rh + 'px;">';
    for (var c = range.s.c; c <= range.e.c; c++) {
      if (covered[r + ',' + c]) continue;
      var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })];
      var v = '';
      if (cell) {
        if (cell.w != null && cell.w !== '') v = cell.w;
        else if (cell.v != null) v = (cell.v instanceof Date) ? cell.v.toLocaleDateString() : String(cell.v);
      }
      var sp = span[r + ',' + c] || [1, 1];
      var attr = '';
      if (sp[1] > 1) attr += ' colspan="' + sp[1] + '"';
      if (sp[0] > 1) attr += ' rowspan="' + sp[0] + '"';
      var ctr = (sp[1] > 2) ? 'text-align:center;' : '';
      h += '<td' + attr + ' style="border:1px solid #666;padding:2px 4px;font-size:12px;' + ctr +
        'word-break:break-all;vertical-align:middle;line-height:1.35;">' + glsEsc(v) + '</td>';
    }
    h += '</tr>';
  }
  return h + '</table>';
}

(function (global) {
  'use strict';

  var VERSION = '2.0.1';

  /* ============================================================
   * 一、字段别名词典（所有可选列名 → 系统字段）
   * al = 别名（小写、去空格/符号后比对）；w = 权重
   * ============================================================ */
  var COMMON_REMARK = ['remark', '备注', '说明', '备注说明', '附注', 'note', 'comments', '其他说明'];
  var COMMON_UNIT = ['unit', '单位', '计量单位', '基本单位', '单位名称', 'um', 'uom'];
  var COMMON_SPEC = ['spec', '规格', '规格型号', '型号规格', '规格/型号', '型号', '规格及型号', '材质规格', '产品规格'];
  var COMMON_QTY = ['qty', '数量', '用量', '数目', '数量(pcs)', '订购数量', '数'];

  var DICT = {
    /* ---------------- BOM 清单 ---------------- */
    bom: {
      label: 'BOM 清单', icon: '🧩', ent: 'bom', multi: true, score: 1,
      /* 必备特征：没有「用量」类明细列的表不算 BOM（避免物料台账被误判） */
      need: ['item.qty'],
      kw: ['bom', '物料清单', '物料表', '用料表', '材料清单', '产品结构', '结构表',
        '组成表', '配料表', '物料明细', 'bom表', 'bom清单', '单台用量', '单位用量', '每台用量'],
      main: [
        { k: 'code', label: 'BOM编号', w: 1.2, al: ['bom编号', 'bom号', 'bomno', 'bom no', '清单编号', 'bom编码', '物料清单编号', 'bom#'] },
        { k: 'product', label: '产品', w: 1.5, al: ['产品', '产品名称', '成品', '成品名称', '产品编码', '成品编码', '产品型号', '成品型号',
          '机型', '产品料号', '成品料号', '父项', '父件', '父项物料', '主机', '主机型号', '适用机型', '适用产品', '整机型号', '产品描述'] },
        { k: 'version', label: '版本', w: 0.9, al: ['版本', '版本号', '版次', 'ver', 'version', 'rev', 'bom版本'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ],
      items: [
        { k: 'code', label: '物料', w: 1.5, al: ['物料', '物料编码', '料号', '物料料号', '零件号', '零件编码',
          '子件', '子项', '子件编码', '组件', '元件', 'item', 'itemno', 'partno', 'part no',
          'partnumber', 'part number', '子物料', '下级物料', '组成物料', '物料规格'] },
        { k: 'name', label: '物料名称', w: 1.2, al: ['物料名称', '品名', '零件名称', '元件名称', '子件名称', '物料描述',
          '描述', '名称', 'item name', 'part name', '物料中文名'] },
        { k: 'qty', label: '单台用量', w: 1.5, al: ['单台用量', '用量', '单位用量', '每台用量', '单机用量', '单台数量', '每台数量',
          '装配数量', '组成用量', '单件用量', '定额', '消耗定额', 'qty', 'quantity', '数量', '用量(pcs)'] },
        { k: 'unit', label: '单位', w: 0.8, al: COMMON_UNIT },
        { k: 'spec', label: '规格/材质', w: 1.0,
          al: ['规格', '规格型号', '零件规格', '零件规格/材质', '规格/材质', '材质', '材料', '材料规格',
               '料质', '规格及材质', '部品规格', 'spec', '规格说明'] },
        { k: 'loss', label: '损耗率%', w: 1.0, al: ['损耗率', '损耗', '损耗%', '损耗率%', '报废率', '损耗系数', '损耗比例', 'loss'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK.concat(['位置', '工位', '装配位置', '工序', '工序号', '部位']) }
      ]
    },

    /* ---------------- 物料档案 ---------------- */
    material: {
      label: '物料档案', icon: '📦', ent: 'material', score: 1,
      kw: ['物料档案', '物料清单表', '料号表', '物料台账', '物料信息', '主数据'],
      main: [
        { k: 'code', label: '物料编码', w: 1.5, al: ['物料编码', '料号', '物料料号', '物料编号', '零件号', '编码', 'code', '物料代码', '图号'] },
        { k: 'name', label: '物料名称', w: 1.5, al: ['物料名称', '名称', '品名', '物料描述', '描述', 'name', '零件名称', '产品名称'] },
        { k: 'products', label: '适用产品', w: 1.0,
          al: ['适用产品', '所属产品', '适用机型', '归属产品', '适用型号', '使用机型', '所属机型', '适配产品', '应用产品', '适用产品名称'] },
        { k: 'spec', label: '规格型号', w: 1.2, al: COMMON_SPEC },
        { k: 'unit', label: '单位', w: 0.8, al: COMMON_UNIT },
        { k: 'category', label: '类别', w: 0.9, al: ['类别', '物料类别', '物料分类', '分类', '物料类型', '类型', 'category'] },
        { k: 'safeStock', label: '安全库存', w: 0.9, al: ['安全库存', '最低库存', '库存下限', '安全存量'] },
        { k: 'price', label: '参考单价', w: 0.9, al: ['参考单价', '单价', '价格', '含税单价', '标准单价', 'price', '采购单价'] },
        { k: 'supplier', label: '默认供应商', w: 0.7, al: ['默认供应商', '供应商', '厂商', '供方'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ]
    },

    /* ---------------- 供应商档案 ---------------- */
    supplier: {
      label: '供应商档案', icon: '🏭', ent: 'supplier', score: 1,
      kw: ['供应商', '合格供方', '供方名录', '供应商名录', 'vendor list', '供方档案', '合格供应商'],
      main: [
        { k: 'code', label: '供应商编码', w: 1.2, al: ['供应商编码', '供方编码', '供应商编号', 'vendorcode', '编码'] },
        { k: 'name', label: '供应商名称', w: 1.5, al: ['供应商名称', '供应商', '供方名称', '厂商名称', '厂商', 'vender', 'vendor', '公司名称', '供方'] },
        { k: 'contact', label: '联系人', w: 1.0, al: ['联系人', '业务联系人', '对接人', 'contact'] },
        { k: 'phone', label: '联系电话', w: 1.0, al: ['联系电话', '电话', '手机', '联系方式', 'tel', 'phone', '手机号'] },
        { k: 'address', label: '地址', w: 0.8, al: ['地址', '公司地址', '厂址', 'address'] },
        { k: 'level', label: '等级', w: 0.8, al: ['等级', '供应商等级', '评级', '级别'] },
        { k: 'supplyCat', label: '供货类别', w: 0.8, al: ['供货类别', '供货分类', '供货物料类别', '物料类别'] },
        { k: 'supplyCode', label: '供应产品编码', w: 1.0, al: ['供应产品编码', '供货编码', '物料编码', '产品编码'] },
        { k: 'supplyName', label: '供应产品名称', w: 1.2, al: ['供应产品名称', '供货产品名称', '供应产品', '供货产品', '产品名称', '物料名称', '供应物料'] },
        { k: 'supplySpec', label: '产品规格/型号', w: 1.2, al: ['产品规格', '规格型号', '供应产品规格', '产品规格型号', '规格/型号', '型号规格', '规格'].concat(COMMON_SPEC) },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ]
    },

    /* ---------------- 客户档案 ---------------- */
    customer: {
      label: '客户档案', icon: '👥', ent: 'customer', score: 1,
      kw: ['客户档案', '客户名录', '客户台账', 'customer list'],
      main: [
        { k: 'code', label: '客户编码', w: 1.2, al: ['客户编码', '客户编号', '客户代码', '编码'] },
        { k: 'name', label: '客户名称', w: 1.5, al: ['客户名称', '客户', '顾客名称', '顾客', 'customer', '公司名称'] },
        { k: 'contact', label: '联系人', w: 1.0, al: ['联系人', 'contact'] },
        { k: 'phone', label: '联系电话', w: 1.0, al: ['联系电话', '电话', '手机', 'tel', 'phone'] },
        { k: 'address', label: '地址', w: 0.8, al: ['地址', '收货地址', 'address'] },
        { k: 'level', label: '等级', w: 0.8, al: ['等级', '客户等级', '级别'] },
        { k: 'credit', label: '信用额度', w: 0.8, al: ['信用额度', '授信额度', '信用'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ]
    },

    /* ---------------- 仓库设置 ---------------- */
    warehouse: {
      label: '仓库设置', icon: '🏬', ent: 'warehouse', score: 1,
      kw: ['仓库设置', '仓库档案', '库位'],
      main: [
        { k: 'code', label: '仓库编码', w: 1.2, al: ['仓库编码', '库房编码'] },
        { k: 'name', label: '仓库名称', w: 1.5, al: ['仓库名称', '仓库', '库房', '库别'] },
        { k: 'location', label: '库位', w: 0.9, al: ['库位', '储位', '货位'] },
        { k: 'keeper', label: '保管员', w: 0.9, al: ['保管员', '库管', '仓管员', '保管人'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ]
    },

    /* ---------------- 销售订单 ---------------- */
    so: {
      label: '销售订单', icon: '📝', ent: 'so', multi: true, score: 1,
      kw: ['销售订单', '客户订单', '订单明细', '销售合同', '订单表', 'sales order', 'po单', '客户下单'],
      main: [
        { k: 'code', label: '订单号', w: 1.5, al: ['订单号', '订单编号', '销售订单号', '客户订单号', '单号', '合同号', '订单'] },
        { k: 'customer', label: '客户', w: 1.5, al: ['客户', '客户名称', '顾客', '客户简称', '下单客户'] },
        { k: 'orderDate', label: '下单日期', w: 1.0, al: ['下单日期', '订单日期', '订单日期', '订购日期', '接单日期', '日期'] },
        { k: 'deliveryDate', label: '交货日期', w: 1.0, al: ['交货日期', '交期', '要求交期', '交货期', '出货日期', '发货日期'] },
        { k: 'amount', label: '订单总额', w: 0.8, al: ['订单总额', '总额', '合计金额', '总金额', '订单金额'] },
        { k: 'status', label: '状态', w: 0.6, al: ['状态', '订单状态'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ],
      items: [
        { k: 'code', label: '物料/产品', w: 1.5, al: ['物料', '产品', '产品编码', '物料编码', '产品名称', '货号', '型号', '品名', '物料名称', '产品型号'] },
        { k: 'qty', label: '数量', w: 1.5, al: COMMON_QTY.concat(['订单数量', '下单数量']) },
        { k: 'unit', label: '单位', w: 0.8, al: COMMON_UNIT },
        { k: 'price', label: '单价', w: 1.0, al: ['单价', '含税单价', '售价', 'price', '单价(元)'] },
        { k: 'amount', label: '金额', w: 0.9, al: ['金额', '小计', '合计', '总价', 'amount', '金额(元)'] }
      ]
    },

    /* ---------------- 销售发货 ---------------- */
    soShip: {
      label: '销售发货', icon: '🚚', ent: 'soShip', multi: true, score: 1,
      kw: ['发货单', '出货单', '送货单', '发货明细', '出货记录'],
      main: [
        { k: 'code', label: '发货单号', w: 1.4, al: ['发货单号', '出货单号', '送货单号', '发货单编号', '单号'] },
        { k: 'soCode', label: '关联订单号', w: 1.0, al: ['关联订单号', '订单号', '来源订单', '合同号'] },
        { k: 'customer', label: '客户', w: 1.2, al: ['客户', '客户名称', '收货单位', '顾客'] },
        { k: 'shipDate', label: '发货日期', w: 1.0, al: ['发货日期', '出货日期', '送货日期', '日期'] },
        { k: 'warehouse', label: '发货仓库', w: 0.8, al: ['发货仓库', '仓库', '出货仓'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ],
      items: [
        { k: 'code', label: '物料/产品', w: 1.4, al: ['物料', '产品', '产品编码', '物料编码', '品名', '型号', '物料名称'] },
        { k: 'qty', label: '数量', w: 1.4, al: COMMON_QTY.concat(['发货数量', '出货数量', '实发数量']) },
        { k: 'unit', label: '单位', w: 0.8, al: COMMON_UNIT }
      ]
    },

    /* ---------------- 销售退货 ---------------- */
    soReturn: {
      label: '销售退货', icon: '↩️', ent: 'soReturn', multi: true, score: 1,
      kw: ['退货单', '退换货', '客户退货', '退货明细', '客诉退货'],
      main: [
        { k: 'code', label: '退货单号', w: 1.4, al: ['退货单号', '退单号', '退货编号', '单号'] },
        { k: 'customer', label: '客户', w: 1.2, al: ['客户', '客户名称', '退货单位', '顾客'] },
        { k: 'returnDate', label: '退货日期', w: 1.0, al: ['退货日期', '退回日期', '日期'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ],
      items: [
        { k: 'code', label: '物料/产品', w: 1.4, al: ['物料', '产品', '产品编码', '物料编码', '品名', '型号'] },
        { k: 'qty', label: '数量', w: 1.4, al: COMMON_QTY.concat(['退货数量', '退回数量']) },
        { k: 'reason', label: '退货原因', w: 1.0, al: ['退货原因', '原因', '退货理由', '不良现象', '退货说明'] }
      ]
    },

    /* ---------------- 售后翻新 ---------------- */
    renovate: {
      label: '售后翻新', icon: '🔧', ent: 'renovate', score: 1,
      kw: ['翻新单', '翻新工单', '返修单', '返修记录', '翻新记录'],
      main: [
        { k: 'code', label: '翻新单号', w: 1.4, al: ['翻新单号', '翻新编号', '返修单号', '单号'] },
        { k: 'rtnCode', label: '关联退货单', w: 1.0, al: ['关联退货单', '退货单号', '来源单号'] },
        { k: 'product', label: '产品', w: 1.3, al: ['产品', '产品名称', '机型', '成品', '产品编码'] },
        { k: 'qty', label: '翻新数量', w: 1.2, al: ['翻新数量', '返修数量', '数量'] },
        { k: 'owner', label: '负责人', w: 0.9, al: ['负责人', '责任人', '担当', '维修人'] },
        { k: 'startDate', label: '开始日期', w: 0.9, al: ['开始日期', '日期', '翻新日期'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ]
    },

    /* ---------------- 采购申请 ---------------- */
    pr: {
      label: '采购申请', icon: '📋', ent: 'pr', multi: true, score: 1,
      kw: ['采购申请', '请购单', '申购单', '请购记录'],
      main: [
        { k: 'code', label: '申请单号', w: 1.4, al: ['申请单号', '请购单号', '申购单号', '单号'] },
        { k: 'dept', label: '申请部门', w: 1.0, al: ['申请部门', '部门', '请购部门', '需求部门'] },
        { k: 'applicant', label: '申请人', w: 1.0, al: ['申请人', '请购人', '经办人'] },
        { k: 'applyDate', label: '申请日期', w: 1.0, al: ['申请日期', '请购日期', '日期'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ],
      items: [
        { k: 'code', label: '物料', w: 1.4, al: ['物料', '物料编码', '料号', '品名', '物料名称', '物料描述'] },
        { k: 'name', label: '名称', w: 1.0, al: ['名称', '物料名称', '品名'] },
        { k: 'qty', label: '数量', w: 1.4, al: COMMON_QTY },
        { k: 'needDate', label: '需求日期', w: 0.9, al: ['需求日期', '需要日期', '要求到货', '到货日期'] }
      ]
    },

    /* ---------------- 采购订单 ---------------- */
    po: {
      label: '采购订单', icon: '📑', ent: 'po', multi: true, score: 1,
      kw: ['采购订单', '采购单', '订购单', '采购合同', 'purchase order'],
      main: [
        { k: 'code', label: '采购单号', w: 1.4, al: ['采购单号', '采购订单号', '订单号', '采购编号', 'po no', '单号'] },
        { k: 'supplier', label: '供应商', w: 1.5, al: ['供应商', '供应商名称', '供方', '厂商', '供货商'] },
        { k: 'orderDate', label: '下单日期', w: 1.0, al: ['下单日期', '订单日期', '采购日期', '日期'] },
        { k: 'deliveryDate', label: '交货日期', w: 1.0, al: ['交货日期', '交期', '要求交期', '到货日期'] },
        { k: 'amount', label: '采购总额', w: 0.8, al: ['采购总额', '总额', '合计金额', '合计'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ],
      items: [
        { k: 'code', label: '物料', w: 1.4, al: ['物料', '物料编码', '料号', '物料名称', '品名', '物料描述'] },
        { k: 'name', label: '名称', w: 1.0, al: ['名称', '物料名称', '品名'] },
        { k: 'qty', label: '数量', w: 1.4, al: COMMON_QTY.concat(['采购数量', '订购数量']) },
        { k: 'unit', label: '单位', w: 0.8, al: COMMON_UNIT },
        { k: 'price', label: '单价', w: 1.1, al: ['单价', '含税单价', '价格', 'price'] },
        { k: 'amount', label: '金额', w: 0.9, al: ['金额', '小计', '合计', 'amount'] }
      ]
    },

    /* ---------------- 采购收货 ---------------- */
    poRecv: {
      label: '采购收货', icon: '📥', ent: 'poRecv', multi: true, score: 1,
      kw: ['收货单', '到货单', '收料单', '来料收货', '收货记录'],
      main: [
        { k: 'code', label: '收货单号', w: 1.4, al: ['收货单号', '到货单号', '收料单号', '单号'] },
        { k: 'poCode', label: '关联采购单', w: 1.0, al: ['关联采购单', '采购单号', '订单号', '来源单号'] },
        { k: 'supplier', label: '供应商', w: 1.4, al: ['供应商', '供应商名称', '供方', '厂商'] },
        { k: 'recvDate', label: '收货日期', w: 1.0, al: ['收货日期', '到货日期', '收料日期', '日期'] },
        { k: 'warehouse', label: '收货仓库', w: 0.8, al: ['收货仓库', '仓库', '入库仓'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ],
      items: [
        { k: 'code', label: '物料', w: 1.4, al: ['物料', '物料编码', '料号', '物料名称', '品名'] },
        { k: 'name', label: '名称', w: 1.0, al: ['名称', '物料名称', '品名'] },
        { k: 'qty', label: '到货数量', w: 1.4, al: ['到货数量', '收货数量', '数量', '送检数量'] },
        { k: 'okQty', label: '合格数量', w: 1.1, al: ['合格数量', '良品数', '合格数', '接收数量'] },
        { k: 'batch', label: '批次号', w: 1.0, al: ['批次号', '批号', '批次', 'lot', 'batch'] }
      ]
    },

    /* ---------------- 入库单 ---------------- */
    stockIn: {
      label: '入库单', icon: '📦', ent: 'stockIn', multi: true, score: 1,
      kw: ['入库单', '入库记录', '收货入库', '成品入库'],
      main: [
        { k: 'code', label: '入库单号', w: 1.4, al: ['入库单号', '入库编号', '单号'] },
        { k: 'type', label: '入库类型', w: 0.9, al: ['入库类型', '类型'] },
        { k: 'inDate', label: '入库日期', w: 1.0, al: ['入库日期', '日期'] },
        { k: 'warehouse', label: '仓库', w: 0.9, al: ['仓库', '入库仓库', '库别'] },
        { k: 'operator', label: '经手人', w: 0.8, al: ['经手人', '经办人', '仓管', '操作人'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ],
      items: [
        { k: 'code', label: '物料', w: 1.4, al: ['物料', '物料编码', '料号', '物料名称', '品名'] },
        { k: 'name', label: '名称', w: 1.0, al: ['名称', '物料名称', '品名'] },
        { k: 'qty', label: '数量', w: 1.4, al: COMMON_QTY.concat(['入库数量']) },
        { k: 'unit', label: '单位', w: 0.8, al: COMMON_UNIT },
        { k: 'batch', label: '批次号', w: 1.0, al: ['批次号', '批号', '批次', 'lot'] },
        { k: 'source', label: '来源单号', w: 0.9, al: ['来源单号', '关联单号', '来源', '工单号'] }
      ]
    },

    /* ---------------- 出库单 ---------------- */
    stockOut: {
      label: '出库单', icon: '📤', ent: 'stockOut', multi: true, score: 1,
      kw: ['出库单', '领料单', '发料单', '出库记录'],
      main: [
        { k: 'code', label: '出库单号', w: 1.4, al: ['出库单号', '领料单号', '发料单号', '单号'] },
        { k: 'type', label: '出库类型', w: 0.9, al: ['出库类型', '类型'] },
        { k: 'outDate', label: '出库日期', w: 1.0, al: ['出库日期', '领料日期', '日期'] },
        { k: 'warehouse', label: '仓库', w: 0.9, al: ['仓库', '出库仓库', '领料仓库'] },
        { k: 'receiver', label: '领用人', w: 0.9, al: ['领用人', '领料人', '领取人', '领用'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ],
      items: [
        { k: 'code', label: '物料', w: 1.4, al: ['物料', '物料编码', '料号', '物料名称', '品名'] },
        { k: 'name', label: '名称', w: 1.0, al: ['名称', '物料名称', '品名'] },
        { k: 'qty', label: '数量', w: 1.4, al: COMMON_QTY.concat(['出库数量', '领用数量']) },
        { k: 'unit', label: '单位', w: 0.8, al: COMMON_UNIT }
      ]
    },

    /* ---------------- 库存盘点 ---------------- */
    stockCheck: {
      label: '库存盘点', icon: '🧮', ent: 'stockCheck', multi: true, score: 1,
      kw: ['盘点单', '盘点表', '库存盘点', '盘点记录'],
      main: [
        { k: 'code', label: '盘点单号', w: 1.3, al: ['盘点单号', '盘点编号', '单号'] },
        { k: 'checkDate', label: '盘点日期', w: 1.0, al: ['盘点日期', '日期'] },
        { k: 'warehouse', label: '仓库', w: 0.9, al: ['仓库', '库别'] },
        { k: 'checker', label: '盘点人', w: 0.9, al: ['盘点人', '盘点员', '清点人'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ],
      items: [
        { k: 'code', label: '物料', w: 1.4, al: ['物料', '物料编码', '料号', '物料名称', '品名'] },
        { k: 'name', label: '名称', w: 1.0, al: ['名称', '物料名称', '品名'] },
        { k: 'bookQty', label: '账面数', w: 1.2, al: ['账面数', '账面数量', '系统数量', '库存数'] },
        { k: 'realQty', label: '实盘数', w: 1.2, al: ['实盘数', '实盘数量', '实际数量', '盘点数量'] },
        { k: 'diff', label: '差异', w: 1.0, al: ['差异', '差异数', '盘盈盘亏'] }
      ]
    },

    /* ---------------- 生产工单 ---------------- */
    mo: {
      label: '生产工单', icon: '🏭', ent: 'mo', multi: true, score: 1,
      kw: ['生产工单', '工单', '生产任务', '派工单', '生产计划'],
      main: [
        { k: 'code', label: '工单号', w: 1.4, al: ['工单号', '生产工单号', '任务单号', '单号'] },
        { k: 'product', label: '生产产品', w: 1.4, al: ['生产产品', '产品', '产品名称', '机型', '产品编码', '成品'] },
        { k: 'planQty', label: '计划数量', w: 1.3, al: ['计划数量', '计划产量', '生产数量', '订单数量', '数量'] },
        { k: 'doneQty', label: '完成数量', w: 1.0, al: ['完成数量', '完工数量', '实际产量', '已生产数量'] },
        { k: 'soCode', label: '关联订单', w: 0.9, al: ['关联订单', '订单号', '来源订单', '销售订单号'] },
        { k: 'startDate', label: '开工日期', w: 0.9, al: ['开工日期', '开始日期', '计划开工'] },
        { k: 'dueDate', label: '完工日期', w: 0.9, al: ['完工日期', '结束日期', '计划完工', '交期'] },
        { k: 'line', label: '生产线别', w: 0.8, al: ['生产线别', '线别', '生产线', '产线'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ]
    },

    /* ---------------- 生产领料 ---------------- */
    moPick: {
      label: '生产领料', icon: '🧾', ent: 'moPick', multi: true, score: 1,
      kw: ['领料单', '生产领料', '发料记录', '领料记录'],
      main: [
        { k: 'code', label: '领料单号', w: 1.3, al: ['领料单号', '领料编号', '单号'] },
        { k: 'moCode', label: '关联工单', w: 1.0, al: ['关联工单', '工单号', '生产工单号'] },
        { k: 'pickDate', label: '领料日期', w: 1.0, al: ['领料日期', '日期'] },
        { k: 'warehouse', label: '领料仓库', w: 0.8, al: ['领料仓库', '仓库'] },
        { k: 'picker', label: '领料人', w: 0.9, al: ['领料人', '领用人', '领取人'] }
      ],
      items: [
        { k: 'code', label: '物料', w: 1.4, al: ['物料', '物料编码', '料号', '物料名称', '品名'] },
        { k: 'name', label: '名称', w: 1.0, al: ['名称', '物料名称', '品名'] },
        { k: 'qty', label: '数量', w: 1.4, al: COMMON_QTY.concat(['领料数量', '领用数量']) },
        { k: 'unit', label: '单位', w: 0.8, al: COMMON_UNIT }
      ]
    },

    /* ---------------- 完工入库 ---------------- */
    moIn: {
      label: '完工入库', icon: '📦', ent: 'moIn', multi: false, score: 1,
      kw: ['完工入库', '成品入库', '完工报告'],
      main: [
        { k: 'code', label: '入库单号', w: 1.3, al: ['入库单号', '单号'] },
        { k: 'moCode', label: '关联工单', w: 1.0, al: ['关联工单', '工单号'] },
        { k: 'product', label: '产品', w: 1.3, al: ['产品', '产品名称', '成品', '机型'] },
        { k: 'qty', label: '入库数量', w: 1.3, al: ['入库数量', '数量', '完工数量'] },
        { k: 'okQty', label: '合格数量', w: 1.1, al: ['合格数量', '良品数', '合格数'] },
        { k: 'inDate', label: '入库日期', w: 1.0, al: ['入库日期', '日期'] },
        { k: 'warehouse', label: '入库仓库', w: 0.8, al: ['入库仓库', '仓库'] },
        { k: 'remark', label: '备注', w: 0.5, al: COMMON_REMARK }
      ]
    }
  };

  /* 忽略列（序号、页码等无信息列） */
  /* 只忽略真正无信息的列（序号/页码）；单位、备注、编号都是有效字段，不能忽略 */
  var IGNORE_AL = ['序号', 'no', 'no.', '项次', '行号', 'index', '序列', '页码', 'page', 'sn', 's/n'];

  /* ============================================================
   * 二、工具
   * ============================================================ */
  function norm(s) {
    if (s === undefined || s === null) return '';
    s = String(s);
    s = s.replace(/\u3000/g, ' ').trim().toLowerCase();
    s = s.replace(/[\s\r\n\t]+/g, '');
    /* 短横线与斜杠必须转义，否则字符类会构成区间、把字母数字一起删掉 */
    s = s.replace(/[（）()【】\[\]{}<>《》\u201c\u201d'\u2018\u2019`、,，。.。:：;；!！?？*#_—\/\\|~\-]/g, '');
    return s;
  }
  function norm2(s) { // 更宽松：去掉百分号、单位括号内容
    return norm(s).replace(/[%‰]/g, '').replace(/元|rmb|cny|pcs|个|套/g, '');
  }
  function toNum(v) {
    if (v === undefined || v === null) return '';
    var s = String(v).replace(/[,\s，]/g, '').replace(/[￥¥]/g, '');
    var m = s.match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : '';
  }
  function toDate(v) {
    if (!v) return '';
    var s = String(v).trim().replace(/[年月]/g, '-').replace(/日/g, '').replace(/[\/\.]/g, '-');
    var m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    m = s.match(/^(\d{1,2})-(\d{1,2})$/);
    if (m) { var y = new Date().getFullYear(); return y + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2); }
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }
    return '';
  }
  function uid(p) { return (p || 'X') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toast(msg, ms) {
    if (global.ERP && ERP.toast) { try { return ERP.toast(msg, ms); } catch (e) {} }
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);background:#1f3b2d;color:#fff;'
      + 'padding:12px 20px;border-radius:8px;z-index:99999;font:14px/1.5 sans-serif;max-width:70vw;box-shadow:0 6px 20px rgba(0,0,0,.3)';
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, ms || 2600);
  }

  /* ============================================================
   * 三、数据层（ERP 台账）
   * ============================================================ */
  function erpData() {
    if (typeof appData === 'undefined' || !appData) return null;
    if (!appData.erp) appData.erp = {};
    return appData.erp;
  }
  function listOf(entKey) {
    var d = erpData(); if (!d) return [];
    if (!d[entKey]) d[entKey] = [];
    return d[entKey];
  }
  function saveErp() {
    try { if (typeof saveData === 'function') { saveData(); return; } } catch (e) {}
    try { localStorage.setItem('gls_quality_data_v2', JSON.stringify(appData)); } catch (e) {}
  }
  function nextCode(entKey) {
    if (global.ERP && ERP._nextCode && ERP.ENTITIES[entKey]) return ERP._nextCode(ERP.ENTITIES[entKey]);
    return entKey.toUpperCase() + Date.now().toString().slice(-8);
  }
  /* 找档案：按编码/名称匹配 */
  function findRef(entKey, val) {
    if (!val) return '';
    var v = norm2(val), list = listOf(entKey);
    for (var i = 0; i < list.length; i++) {
      if (norm2(list[i].code) === v || norm2(list[i].name) === v) return list[i].code;
    }
    /* 一个单元格里写了多个值（「产品A；产品B」）时不做包含匹配，
       否则会被误合并成第一个值、把后面的丢掉 */
    if (/[；;，,、\/]/.test(String(val))) return '';
    for (var j = 0; j < list.length; j++) {
      var n = norm2(list[j].name);
      if (n && (n.indexOf(v) >= 0 || v.indexOf(n) >= 0) && v.length >= 3) return list[j].code;
    }
    return '';
  }
  /* 自动建档（物料/客户/供应商），返回编码 */
  var CODE_LIKE = /^[A-Za-z0-9][A-Za-z0-9\-_.\/]{1,30}$/;
  function ensureRef(entKey, val, opt) {
    if (!val) return '';
    var hit = findRef(entKey, val);
    if (hit) {
      /* 已有档案：顺手补全缺失的规格/单位（不覆盖已有值，避免越导越乱） */
      if (opt && (opt.spec || opt.unit)) {
        var ex0 = listOf(entKey).filter(function (x) { return x.code === hit; })[0];
        if (ex0) {
          if (opt.spec && !ex0.spec) ex0.spec = String(opt.spec).trim();
          if (opt.unit && !ex0.unit) ex0.unit = String(opt.unit).trim();
        }
      }
      return hit;
    }
    var raw = String(val).trim();
    var rec = { code: '', name: raw };
    /* 本身就是编码样式（M001 / A-01 / 12345 / AB_9）→ 直接沿用，便于与原表一致 */
    if (CODE_LIKE.test(raw) && !/^[0-9]{1,3}$/.test(raw)) {
      var dup = listOf(entKey).filter(function (x) { return norm2(x.code) === norm2(raw); })[0];
      if (dup) return dup.code;
      rec.code = raw;
    } else {
      rec.code = nextCode(entKey);
    }
    if (opt && opt.spec && entKey === 'material') rec.spec = opt.spec;
    if (entKey === 'material') { rec.unit = (opt && opt.unit) || 'PCS'; rec.category = opt && opt.category ? opt.category : '原材料'; }
    if (opt && opt.extra) for (var k in opt.extra) rec[k] = opt.extra[k];
    listOf(entKey).push(rec);
    _stats.newRef[entKey] = (_stats.newRef[entKey] || 0) + 1;
    return rec.code;
  }

  /* ============================================================
   * 四、解析：统一产出 { rows, htmlRaw, title, fileName, fileBlob }
   * ============================================================ */
  function htmlTableToRows(html) {
    var div = document.createElement('div');
    div.innerHTML = html;
    var table = div.querySelector('table');
    if (!table) return null;
    var rows = [];
    table.querySelectorAll('tr').forEach(function (tr) {
      var cells = [];
      tr.querySelectorAll('td,th').forEach(function (td) {
        var cs = parseInt(td.getAttribute('colspan') || '1', 10);
        cells.push((td.textContent || '').replace(/\u00a0/g, ' ').trim());
        for (var i = 1; i < cs; i++) cells.push('');
      });
      if (cells.join('').trim() !== '') rows.push(cells);
    });
    return rows;
  }
  function textToRows(text) {
    var lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
      .filter(function (l) { return l.replace(/[\s,\t]/g, '') !== ''; });
    var sep = '\t';
    if (lines.length && lines[0].indexOf('\t') < 0) {
      if (lines[0].split(',').length > lines[0].split(';').length) sep = ','; else sep = ';';
      if (lines[0].split(sep).length < 2) sep = ' ';
    }
    return lines.map(function (l) {
      return l.split(sep).map(function (c) { return c.replace(/^"|"$/g, '').trim(); });
    });
  }
  function sheetToRows(ws) {
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    return aoa.map(function (r) { return r.map(function (c) { return String(c === null || c === undefined ? '' : c).trim(); }); })
      .filter(function (r) { return r.join('').trim() !== ''; });
  }

  /* ============================================================
   * 五、识别：判断表类型 + 列映射
   * ============================================================ */
  function fieldHit(al, header) {
    var h = norm(header), h2 = norm2(header);
    if (!h) return 0;
    for (var i = 0; i < al.length; i++) {
      var a = norm(al[i]), a2 = norm2(al[i]);
      if (!a) continue;
      if (h === a || h2 === a2) return 1.0;
    }
    for (var j = 0; j < al.length; j++) {
      var b = norm(al[j]);
      if (b.length < 2) continue;
      /* 表头比别名更具体：「用量 PCS」含「用量」、「零件规格/材质」含「规格」→ 命中 */
      if (h.indexOf(b) >= 0) return 0.72;
      /* 别名比表头长时语义常常不同（「单位」≠「单位用量」），
         只有长度接近才认，避免把「单位」吃成「用量」这类串列 */
      if (b.indexOf(h) >= 0 && h.length >= 3 && h.length >= b.length * 0.7) return 0.6;
    }
    return 0;
  }
  /* 给一个表头行打分：返回 {score, map:{colIdx:fieldKey}, detail:{fieldKey:colIdx}} */
  function scoreHeader(def, row) {
    var all = [], main = def.main || [], items = def.items || [];
    main.forEach(function (f) { all.push({ k: f.k, label: f.label, al: f.al, w: f.w || 1, kind: 'main' }); });
    items.forEach(function (f) { all.push({ k: f.k, label: f.label, al: f.al, w: f.w || 1, kind: 'item' }); });
    var score = 0, map = {}, used = {};
    for (var c = 0; c < row.length; c++) {
      var best = null, bestH = 0;
      for (var f = 0; f < all.length; f++) {
        var fl = all[f];
        var h = fieldHit(fl.al, row[c]) * fl.w;
        if (fl.kind === 'item') h *= 1.12;              // 明细列更可信
        if (h > bestH && !used[fl.k + '|' + fl.kind]) { bestH = h; best = fl; }
      }
      var isIgn = false;
      for (var g = 0; g < IGNORE_AL.length; g++) if (norm(row[c]) === norm(IGNORE_AL[g])) isIgn = true;
      /* 命中字段优先：只有「没命中任何字段」的列才按忽略清单处理 */
      if (best && bestH >= 0.5) {
        map[c] = best.kind === 'item' ? ('item.' + best.k) : best.k;
        used[best.k + '|' + best.kind] = true;
        score += bestH;
      } else if (isIgn) {
        map[c] = '__skip';
      }
    }
    return { score: score, map: map, cols: Object.keys(map).length };
  }
  function detect(rows) {
    var defs = Object.keys(DICT).map(function (k) { return { key: k, def: DICT[k] }; });
    var textTop = rows.slice(0, 12).map(function (r) { return r.join(' '); }).join(' ').toLowerCase();
    var cands = [];
    for (var d = 0; d < defs.length; d++) {
      var def = defs[d].def, best = null;
      var limit = Math.min(rows.length, 10);
      for (var r = 0; r < limit; r++) {
        var sc = scoreHeader(def, rows[r]);
        if (sc.cols >= 2 && (!best || sc.score > best.score)) best = { row: r, score: sc.score, map: sc.map, cols: sc.cols };
      }
      if (!best) continue;
      /* 必备特征列校验：缺了就说明不是这类表 */
      if (def.need && def.need.length) {
        var hitNeed = false;
        for (var ni = 0; ni < def.need.length; ni++) {
          for (var mk in best.map) { if (best.map[mk] === def.need[ni]) { hitNeed = true; break; } }
          if (hitNeed) break;
        }
        if (!hitNeed) continue;
      }
      var kwHit = 0;
      (def.kw || []).forEach(function (k) { if (textTop.indexOf(String(k).toLowerCase()) >= 0) kwHit++; });
      var total = best.score + Math.min(kwHit, 3) * 1.6 + (def.multi ? 0.2 : 0);
      cands.push({
        key: defs[d].key, label: def.label, icon: def.icon, ent: def.ent, multi: !!def.multi,
        score: Math.round(total * 100) / 100, kwHits: kwHit,
        headerIdx: best.row, map: best.map, colCount: best.cols
      });
    }
    cands.sort(function (a, b) { return b.score - a.score; });
    return cands;
  }
  /* 列清单（含未识别 → 新增字段） */
  function columnPlan(def, header, map) {
    var cols = [];
    for (var c = 0; c < header.length; c++) {
      var t = map[c];
      var label = header[c] || ('第' + (c + 1) + '列');
      if (t === '__skip') {
        cols.push({ idx: c, header: label, target: '__skip', label: '（忽略）', kind: 'extra', isNew: false });
        continue;
      }
      if (t) {
        var f = null, kind = t.indexOf('item.') === 0 ? 'items' : 'main';
        var kk = t.replace('item.', '');
        var arr = kind === 'items' ? (def.items || []) : (def.main || []);
        arr.forEach(function (x) { if (x.k === kk) f = x; });
        cols.push({ idx: c, header: label, target: t, label: f ? f.label : kk, kind: kind, isNew: false });
      } else {
        var ign = false;
        for (var g = 0; g < IGNORE_AL.length; g++) if (norm(label) === norm(IGNORE_AL[g])) ign = true;
        cols.push({ idx: c, header: label, target: ign ? '__skip' : '__extra', label: ign ? '（忽略）' : (label + '（新增字段）'), kind: 'extra', isNew: !ign });
      }
    }
    return cols;
  }

  /* ============================================================
   * 六、导入执行
   * ============================================================ */
  var _stats = null;
  function resetStats() { _stats = { recs: 0, items: 0, newRef: {}, newFields: {}, merged: 0, replaced: 0 }; }
  function getStats() { return _stats || { recs: 0, items: 0, newRef: {}, newFields: {}, merged: 0, replaced: 0 }; }

  /* ============================================================
   * 导入批次：每次导入留档，可整批撤销、可按板块清空、可导出备份
   * ============================================================ */
  var BATCH_KEY = 'gls_import_batches';
  var REF_ENTS = ['material', 'customer', 'supplier', 'warehouse'];
  var _batch = null;
  function batches() { try { return JSON.parse(localStorage.getItem(BATCH_KEY) || '[]'); } catch (e) { return []; } }
  function setBatches(l) { try { localStorage.setItem(BATCH_KEY, JSON.stringify(l)); } catch (e) {} }
  function batchBegin(title, entKey) {
    var snap = {};
    REF_ENTS.forEach(function (e) { snap[e] = listOf(e).map(function (r) { return r.code; }); });
    _batch = { id: uid('B'), time: new Date().toISOString(), title: title || '', entKey: entKey || '',
               ent: entKey ? ((DICT[entKey] || {}).ent || '') : '',
               added: [], updated: [], refsAdded: [], fieldsAdded: [], snapshot: snap };
    return _batch;
  }
  function batchAdd(ent, rec) {
    if (!_batch || !rec) return;
    rec._imp = _batch.id;
    rec._impAt = _batch.time;
    _batch.added.push({ ent: ent, code: rec.code });
  }
  function batchUpdate(ent, code, before) {
    if (!_batch) return;
    for (var i = 0; i < _batch.updated.length; i++) {
      if (_batch.updated[i].ent === ent && _batch.updated[i].code === code) return;
    }
    _batch.updated.push({ ent: ent, code: code, before: JSON.parse(JSON.stringify(before)) });
  }
  function batchCommit() {
    if (!_batch) return null;
    /* 本次顺带新建的档案（物料/客户/供应商/仓库） */
    REF_ENTS.forEach(function (e) {
      var oldCodes = _batch.snapshot[e] || [];
      listOf(e).forEach(function (r) { if (oldCodes.indexOf(r.code) < 0) _batch.refsAdded.push({ ent: e, code: r.code }); });
    });
    if (!_batch.added.length && !_batch.updated.length && !_batch.refsAdded.length) { _batch = null; return null; }
    var l = batches();
    l.unshift(_batch);
    if (l.length > 200) l = l.slice(0, 200);
    setBatches(l);
    var id = _batch.id;
    _batch = null;
    return id;
  }
  /* 档案是否仍被其它单据引用（撤销时用） */
  function refUsed(ent, code) {
    if (REF_ENTS.indexOf(ent) < 0) return false;
    var hit = false;
    ['bom', 'so', 'po', 'pr', 'moPick', 'poRecv', 'stockIn', 'stockOut', 'stockCheck',
     'soShip', 'soReturn', 'mo', 'moIn', 'renovate'].forEach(function (e) {
      if (hit) return;
      listOf(e).forEach(function (r) {
        if (hit) return;
        if (r.product === code || r.supplier === code || r.customer === code) hit = true;
        (r.items || []).forEach(function (it) { if (it && it.code === code) hit = true; });
      });
    });
    return hit;
  }
  function refreshAll() {
    saveErp();
    try { if (global.DATAHUB) DATAHUB.set('erp', appData.erp); } catch (e) {}
    try { if (global.ERP && ERP.refreshCurrent) ERP.refreshCurrent(); } catch (e) {}
  }
  /* 撤销某一批导入 */
  function undoBatch(id, quiet) {
    var l = batches(), b = null;
    for (var i = 0; i < l.length; i++) if (l[i].id === id) { b = l[i]; break; }
    if (!b) { if (!quiet) toast('没找到这批导入记录'); return false; }
    (b.added || []).forEach(function (a) {
      var arr = listOf(a.ent);
      for (var i = arr.length - 1; i >= 0; i--) if (arr[i].code === a.code) { arr.splice(i, 1); break; }
    });
    (b.updated || []).forEach(function (u) {
      var arr = listOf(u.ent);
      for (var i = 0; i < arr.length; i++) if (arr[i].code === u.code) { arr[i] = u.before; break; }
    });
    (b.refsAdded || []).forEach(function (r) {
      if (refUsed(r.ent, r.code)) return;
      var arr = listOf(r.ent);
      for (var i = arr.length - 1; i >= 0; i--) if (arr[i].code === r.code) { arr.splice(i, 1); break; }
    });
    (b.fieldsAdded || []).forEach(function (f) {
      var other = false;
      l.forEach(function (x) {
        if (x.id === id) return;
        (x.fieldsAdded || []).forEach(function (y) { if (y.ent === f.ent && y.name === f.name) other = true; });
      });
      if (other) return;
      var all = {};
      try { all = JSON.parse(localStorage.getItem(EXTRA_KEY) || '{}'); } catch (e) { return; }
      if (all[f.ent]) { var k = all[f.ent].indexOf(f.name); if (k >= 0) all[f.ent].splice(k, 1); }
      try { localStorage.setItem(EXTRA_KEY, JSON.stringify(all)); } catch (e) {}
    });
    setBatches(l.filter(function (x) { return x.id !== id; }));
    refreshAll();
    if (!quiet) toast('已撤销这批导入');
    return true;
  }
  function undoAllBatches() {
    var l = batches().slice();
    if (!l.length) { toast('没有可撤销的导入记录'); return; }
    var n = 0;
    l.forEach(function (b) { if (undoBatch(b.id, true)) n++; });
    refreshAll();
    toast('已撤销 ' + n + ' 批导入数据');
  }
  /* 按板块清理：onlyImported=true 只删导入产生的，false 清空该板块全部 */
  function clearEntity(key, onlyImported) {
    var def = DICT[key];
    var ent = def ? def.ent : key;
    var arr = listOf(ent);
    var before = arr.length;
    if (onlyImported) {
      for (var i = arr.length - 1; i >= 0; i--) if (arr[i]._imp) arr.splice(i, 1);
    } else {
      arr.splice(0, arr.length);
    }
    var n = before - arr.length;
    refreshAll();
    return n;
  }
  function clearMany(keys, onlyImported) {
    var total = 0;
    keys.forEach(function (k) { total += clearEntity(k, onlyImported); });
    toast('已清理 ' + total + ' 条记录');
    return total;
  }
  /* 导出备份（含台账与批次，万一删错可留档） */
  function backupDownload() {
    var dump = {
      exportedAt: new Date().toISOString(),
      company: 'GREENIS格丽思电器有限公司',
      batches: batches(),
      extraFields: (function () { try { return JSON.parse(localStorage.getItem(EXTRA_KEY) || '{}'); } catch (e) { return {}; } })(),
      userTemplates: userTpls(),
      erp: erpData()
    };
    var name = '格丽思质量管理系统_数据备份_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
    openBlob(new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' }), name, true);
    toast('备份已开始下载');
  }

  /* 取某列的值 */
  function cellAt(row, cols, target) {
    for (var i = 0; i < cols.length; i++) if (cols[i].target === target) return (row[cols[i].idx] || '').trim();
    return '';
  }
  function extrasOf(row, cols) {
    var o = null;
    cols.forEach(function (c) {
      if (c.target === '__extra') {
        var v = (row[c.idx] || '').trim();
        if (v) { if (!o) o = {}; o[c.header] = v; }
      }
    });
    return o;
  }

  function importRows(entKey, rows, columns, opt) {
    var def = DICT[entKey]; if (!def) return { added: 0 };
    var dataRows = rows.slice(opt.headerIdx + 1).filter(function (r) { return r.join('').trim() !== ''; });
    var out = { added: 0, entities: {}, log: [] };
    var ent = ERP.ENTITIES[def.ent];

    /* —— 明细型：按父级字段分组 —— */
    if (def.multi && (def.items || []).length) {
      var parentKeys = (def.main || []).map(function (f) { return f.k; });
      var groups = {}, order = [], lastParent = {};
      dataRows.forEach(function (row) {
        var key = '', parent = {};
        columns.forEach(function (c) {
          if (c.target === '__skip' || c.target === '__extra' || c.target.indexOf('item.') === 0) return;
          var v = (row[c.idx] || '').trim();
          /* 合并单元格：本行为空时沿用上一行的父级值（BOM编号/产品/客户等只在首行出现的表） */
          if (!v) v = lastParent[c.target] || '';
          if (!v) return;
          parent[c.target] = v;
          lastParent[c.target] = v;
          if (c.target === 'product' || c.target === 'code' || c.target === 'customer'
            || c.target === 'supplier' || c.target === 'soCode' || c.target === 'poCode'
            || c.target === 'moCode' || c.target === 'rtnCode') key += '|' + v;
        });
        if (!key) key = '__single';
        if (!groups[key]) { groups[key] = { parent: parent, rows: [] }; order.push(key); }
        else {
          for (var pk in parent) if (!groups[key].parent[pk]) groups[key].parent[pk] = parent[pk];
        }
        groups[key].rows.push(row);
      });

      order.forEach(function (gk) {
        var g = groups[gk], p = g.parent, rec = {};
        (def.main || []).forEach(function (f) {
          var v = p[f.k] !== undefined ? p[f.k] : '';
          if (!v) return;
          if (f.k === 'amount') { rec[f.k] = toNum(v); return; }
          if (/(date|Date)$/.test(f.k)) { rec[f.k] = toDate(v) || v; return; }
          rec[f.k] = v;
        });
        // ref 字段建档
        if (rec.customer) rec.customer = ensureRef('customer', rec.customer);
        if (rec.supplier) rec.supplier = ensureRef('supplier', rec.supplier);
        if (rec.product && (def.ent === 'bom' || def.ent === 'mo' || def.ent === 'moIn' || def.ent === 'renovate')) {
          rec.product = ensureRef('material', rec.product, { category: def.ent === 'bom' ? '成品' : '半成品' });
        }
        if (!rec.code) rec.code = nextCode(def.ent);
        rec.items = [];
        g.rows.forEach(function (row) {
          var it = {};
          (def.items || []).forEach(function (f) {
            var v = cellAt(row, columns, 'item.' + f.k);
            if (v === '') return;
            if (f.k === 'qty' || f.k === 'loss' || f.k === 'price' || f.k === 'amount') { it[f.k] = toNum(v); return; }
            it[f.k] = v;
          });
          if (!it.code && !it.name) return;
          var _refEnts = ['bom', 'so', 'po', 'pr', 'moPick', 'poRecv', 'stockIn', 'stockOut', 'stockCheck', 'soShip', 'soReturn'];
          if (def.ent === 'bom' && !it.code && it.name) {
            /* 只有名称的 BOM 明细 → 用名称建档并回填编码 */
            it.code = ensureRef('material', it.name, { unit: it.unit, spec: it.spec });
            it.name = '';
          }
          if (it.code && _refEnts.indexOf(def.ent) >= 0) {
            it.code = ensureRef('material', it.code, { unit: it.unit, spec: it.spec });
          }
          /* 既有编码又有名称 → 用名称补全档案里缺失的名字 */
          if (it.code && it.name) {
            var _m = listOf('material').filter(function (x) { return x.code === it.code; })[0];
            if (_m && (!_m.name || _m.name === _m.code)) _m.name = it.name;
          }
          if (!it.unit && it.code) {
            var m = listOf('material').filter(function (x) { return x.code === it.code; })[0];
            if (m && m.unit) it.unit = m.unit;
          }
          if (f_anyEmpty(it)) { /* noop */ }
          rec.items.push(it);
          /* 物料按产品归集：明细物料自动挂到本 BOM 的产品下 */
          if (def.ent === 'bom' && it.code && rec.product) {
            try {
              if (global.ERP && ERP.attachProduct) {
                var _pn = ERP.prodName ? ERP.prodName(rec.product) : rec.product;
                ERP.attachProduct(it.code, _pn);
              }
            } catch (e) {}
          }
          _stats.items++;
        });
        // 未识别列 → 附加字段
        var ex = extrasOf(g.rows[0], columns);
        if (ex) { rec.extra = ex; Object.keys(ex).forEach(function (k) { _stats.newFields[k] = 1; }); }
        // 同编码：覆盖重导 / 合并明细 / 新建
        var exist = listOf(def.ent).filter(function (x) { return x.code === rec.code; })[0];
        if (exist && opt.replace) {
          batchUpdate(def.ent, rec.code, exist);   /* 覆盖属更新，不改其是否「导入产生」的身份 */
          for (var rk in rec) if (rk !== 'code') exist[rk] = rec[rk];
          exist.code = rec.code;
          _stats.replaced++;
        } else if (exist && opt.mergeSame) {
          batchUpdate(def.ent, rec.code, exist);
          exist.items = (exist.items || []).concat(rec.items);
          _stats.merged++;
        } else {
          listOf(def.ent).push(rec);
          batchAdd(def.ent, rec);
          _stats.recs++;
        }
        out.added++;
      });
    } else {
      /* —— 平铺型 —— */
      dataRows.forEach(function (row) {
        var rec = {};
        (def.main || []).forEach(function (f) {
          var v = cellAt(row, columns, f.k);
          if (v === '') return;
          if (f.k === 'safeStock' || f.k === 'price' || f.k === 'credit' || f.k === 'qty'
            || f.k === 'okQty' || f.k === 'planQty' || f.k === 'doneQty') { rec[f.k] = toNum(v); return; }
          if (/(date|Date)$/.test(f.k)) { rec[f.k] = toDate(v) || v; return; }
          rec[f.k] = v;
        });
        if (!rec.name && !rec.code) return;
        if (rec.supplier) rec.supplier = ensureRef('supplier', rec.supplier);
        /* 本身就是档案表（物料/供应商/客户/仓库）→ 直接落库，不经 ensureRef 自建空壳 */
        var _SELF = ['material', 'supplier', 'customer', 'warehouse'];
        if (rec.code && _SELF.indexOf(def.ent) < 0) {
          rec.code = ensureRef('material', rec.code, { unit: rec.unit, spec: rec.spec });
        }
        var ex = extrasOf(row, columns);
        if (ex) { rec.extra = ex; Object.keys(ex).forEach(function (k) { _stats.newFields[k] = 1; }); }
        if (rec.code) rec.code = rec.code;
        else rec.code = nextCode(def.ent);
        var exist = listOf(def.ent).filter(function (x) { return norm2(x.code) === norm2(rec.code); })[0];
        if (exist && (opt.replace || opt.mergeSame)) {
          batchUpdate(def.ent, rec.code, exist);
          for (var kk in rec) if (kk !== 'code') exist[kk] = rec[kk];
          if (opt.replace) _stats.replaced++;
          else _stats.merged++;
        } else {
          listOf(def.ent).push(rec);
          batchAdd(def.ent, rec);
          _stats.recs++;
        }
        out.added++;
      });
    }
    out.entities[def.ent] = out.added;
    return out;
  }
  function f_anyEmpty(o) { for (var k in o) if (o[k] === '' || o[k] === undefined) return true; return false; }

  /* 新字段登记（供详情页展示） */
  var EXTRA_KEY = 'gls_erp_extra_fields';
  function registerExtraFields(entKey, names) {
    if (!names.length) return;
    var all = {};
    try { all = JSON.parse(localStorage.getItem(EXTRA_KEY) || '{}'); } catch (e) { all = {}; }
    if (!all[entKey]) all[entKey] = [];
    names.forEach(function (n) { if (all[entKey].indexOf(n) < 0) all[entKey].push(n); });
    try { localStorage.setItem(EXTRA_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function getExtraFields(entKey) {
    try { return (JSON.parse(localStorage.getItem(EXTRA_KEY) || '{}')[entKey]) || []; } catch (e) { return []; }
  }

  /* ============================================================
   * 七、原文件仓储（IndexedDB）— 保证「文档原样、表格原样」
   * ============================================================ */
  var DB_NAME = 'gls_files_db', STORE = 'files';
  function idb() {
    return new Promise(function (res, rej) {
      var done = false;
      var tm = setTimeout(function () { fin(null, new Error('原文件仓储响应超时')); }, 6000);
      function fin(v, err) {
        if (done) return;
        done = true;
        clearTimeout(tm);
        if (err) rej(err); else res(v);
      }
      var rq;
      try { rq = indexedDB.open(DB_NAME); } catch (e) { return fin(null, e); }
      rq.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('tplfiles')) db.createObjectStore('tplfiles', { keyPath: 'id' });
      };
      rq.onsuccess = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains('tplfiles')) {
          try { db.close(); } catch (e) {}
          var rq2;
          try { rq2 = indexedDB.open(DB_NAME, db.version + 1); } catch (e) { return fin(null, e); }
          rq2.onupgradeneeded = function (e2) {
            var d2 = e2.target.result;
            if (!d2.objectStoreNames.contains(STORE)) d2.createObjectStore(STORE, { keyPath: 'id' });
            if (!d2.objectStoreNames.contains('tplfiles')) d2.createObjectStore('tplfiles', { keyPath: 'id' });
          };
          rq2.onsuccess = function () { fin(rq2.result); };
          rq2.onerror = function () { fin(null, rq2.error); };
          /* 被其它标签页占用时不能永久挂起 */
          rq2.onblocked = function () { fin(null, new Error('原文件仓储被其它标签页占用')); };
          return;
        }
        fin(db);
      };
      rq.onerror = function () { fin(null, rq.error); };
      rq.onblocked = function () { fin(null, new Error('原文件仓储被其它标签页占用')); };
    });
  }
  function txGuard(fn, ms) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var done = false;
        var tm = setTimeout(function () { if (!done) { done = true; rej(new Error('原文件仓储事务超时')); } }, ms || 8000);
        function ok(v) { if (done) return; done = true; clearTimeout(tm); res(v); }
        function no(e) { if (done) return; done = true; clearTimeout(tm); rej(e || new Error('原文件仓储事务失败')); }
        try { fn(db, ok, no); } catch (e) { no(e); }
      });
    });
  }
  function idbPut(store, obj) {
    return txGuard(function (db, ok, no) {
      var tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(obj);
      tx.oncomplete = function () { ok(obj.id); };
      tx.onerror = function () { no(tx.error); };
      tx.onabort = function () { no(tx.error || new Error('事务被中止')); };
    });
  }
  function idbGet(store, id) {
    return txGuard(function (db, ok, no) {
      var tx = db.transaction(store, 'readonly');
      var rq = tx.objectStore(store).get(id);
      rq.onsuccess = function () { ok(rq.result || null); };
      rq.onerror = function () { no(rq.error); };
    });
  }
  function idbDel(store, id) {
    return txGuard(function (db, ok) {
      var tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      tx.oncomplete = function () { ok(true); };
      tx.onerror = function () { ok(false); };
      tx.onabort = function () { ok(false); };
    }).catch(function () { return false; });
  }
  /* 打开原文件（新窗口）或下载 */
  function openBlob(blob, name, download) {
    var url = URL.createObjectURL(blob);
    if (download) {
      var a = document.createElement('a');
      a.href = url; a.download = name || 'file'; document.body.appendChild(a); a.click();
      setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 4000);
    } else {
      var w = window.open(url, '_blank');
      if (!w) toast('浏览器拦截了新窗口，请允许弹出窗口后重试');
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }
  }
  global.GLSIMP_openBlob = openBlob;

  /* ============================================================
   * 八、模板：原样保存 / 打印 / 填写
   * ============================================================ */
  var USER_TPL_KEY = 'gls_user_templates';
  function userTpls() { try { return JSON.parse(localStorage.getItem(USER_TPL_KEY) || '[]'); } catch (e) { return []; } }
  function setUserTpls(list) { try { localStorage.setItem(USER_TPL_KEY, JSON.stringify(list)); } catch (e) {} }
  /* 让编辑器渲染层刷新（gls-erp.js 提供） */
  function refreshTplPage() {
    try { if (global.ERP && ERP.refreshTemplates) { ERP.refreshTemplates(); return; } } catch (e) {}
    try { if (typeof global.renderTemplatesPage === 'function') global.renderTemplatesPage(); } catch (e) {}
  }
  function saveUserTpl(o) {
    var list = userTpls();
    list.unshift(o);
    setUserTpls(list);
    refreshTplPage();
    return o;
  }
  /* 打印模板（A4，原样保留表格样式） */
  function printTemplate(tplOrHtml, title) {
    var html = typeof tplOrHtml === 'string' ? tplOrHtml : (tplOrHtml.recordTemplate || '');
    if (!html) { toast('该模板没有可打印内容'); return; }
    var w = window.open('', '_blank');
    if (!w) { toast('浏览器拦截了新窗口，请允许弹出窗口后重试'); return; }
    var doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title || '模板打印') + '</title>'
      + '<style>@page{size:A4;margin:12mm 10mm}'
      + 'body{font-family:"宋体","SimSun",serif;font-size:12px;color:#000;background:#fff;margin:0}'
      + 'table{border-collapse:collapse;width:100%}'
      + 'td,th{padding:3px 5px;vertical-align:middle}'
      + '.tpl-print-title{font-size:16px;font-weight:700;text-align:center;margin:0 0 8px}'
      + '.tpl-print-bar{text-align:right;margin:0 0 8px}'
      + '@media print{.tpl-print-bar{display:none}}'
      + '</style></head><body>'
      + '<div class="tpl-print-bar"><button onclick="window.print()">打印 / 另存为 PDF</button></div>'
      + (title ? '<div class="tpl-print-title">' + esc(title) + '</div>' : '')
      + html + '</body></html>';
    w.document.open(); w.document.write(doc); w.document.close();
    setTimeout(function () { try { w.focus(); } catch (e) {} }, 300);
  }
  /* 直接填写：把模板表格变可编辑并打印/导出 */
  function fillTemplate(tpl) {
    var html = (tpl && tpl.recordTemplate) || '';
    if (!html) { toast('该模板没有可填写内容'); return; }
    var w = window.open('', '_blank');
    if (!w) { toast('浏览器拦截了新窗口，请允许弹出窗口后重试'); return; }
    var doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(tpl.name || '模板填写') + '</title>'
      + '<style>@page{size:A4;margin:12mm 10mm}'
      + 'body{font-family:"宋体","SimSun",serif;font-size:12px;color:#000;background:#fff;margin:0}'
      + 'table{border-collapse:collapse;width:100%}td,th{padding:3px 5px}'
      + '[contenteditable="true"]:focus{outline:2px solid #2e7d52;background:#f4fff9}'
      + '.bar{background:#f2f6f3;border-bottom:1px solid #d6e2da;padding:8px 10px;margin:-1px 0 10px;'
      + 'display:flex;gap:8px;align-items:center;font-family:system-ui,sans-serif}'
      + '.bar button{padding:6px 12px;border:1px solid #2e7d52;background:#2e7d52;color:#fff;border-radius:6px;cursor:pointer}'
      + '.bar button.ghost{background:#fff;color:#2e7d52}'
      + '@media print{.bar{display:none}}'
      + '</style></head><body>'
      + '<div class="bar"><b>' + esc(tpl.name || '') + '</b>'
      + '<span style="color:#5b6b62;font-size:12px">点击任意单元格即可填写</span>'
      + '<span style="flex:1"></span>'
      + '<button onclick="document.querySelectorAll(\'td,th\').forEach(function(x){x.setAttribute(\'contenteditable\',\'true\')})">开启填写</button>'
      + '<button class="ghost" onclick="window.print()">打印 / 另存为 PDF</button>'
      + '</div>'
      + html + '</body></html>';
    w.document.open(); w.document.write(doc); w.document.close();
    setTimeout(function () {
      try {
        w.document.querySelectorAll('td,th').forEach(function (x) { x.setAttribute('contenteditable', 'true'); });
      } catch (e) {}
    }, 400);
  }
  /* 取模板原文件 */
  function openTplOrigFile(tpl) {
    if (!tpl || !tpl.origFileId) { toast('该模板没有留存原文件'); return; }
    idbGet('tplfiles', tpl.origFileId).then(function (rec) {
      if (!rec || !rec.blob) { toast('原文件已不存在'); return; }
      openBlob(rec.blob, rec.name, false);
    }).catch(function () { toast('读取原文件失败'); });
  }

  /* ============================================================
   * 九、界面：智能导入向导
   * ============================================================ */
  var S = { rows: null, htmlRaw: null, title: '', fileName: '', fileBlob: null, cands: [], entKey: '', headerIdx: 0, columns: [], isDoc: false };

  function modal(html, opts) {
    opts = opts || {};
    var old = document.getElementById('glsimpMask');
    if (old) old.remove();
    var mask = document.createElement('div');
    mask.id = 'glsimpMask';
    mask.style.cssText = 'position:fixed;inset:0;background:rgba(12,24,18,.55);z-index:99998;display:flex;'
      + 'align-items:flex-start;justify-content:center;padding:24px;overflow:auto;font-family:system-ui,"Microsoft YaHei",sans-serif';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;max-width:' + (opts.w || 1080) + 'px;width:100%;'
      + 'box-shadow:0 18px 50px rgba(0,0,0,.35);overflow:hidden';
    box.innerHTML = html;
    mask.appendChild(box);
    document.body.appendChild(mask);
    mask.addEventListener('mousedown', function (e) { if (e.target === mask && opts.dismiss !== false) close(); });
    return box;
  }
  function close() { var m = document.getElementById('glsimpMask'); if (m) m.remove(); }
  global.GLSIMP_close = close;

  function head(title, sub) {
    return '<div style="background:linear-gradient(135deg,#2e7d52,#1f5f3d);color:#fff;padding:14px 18px;display:flex;align-items:center;gap:10px">'
      + '<div style="font-size:16px;font-weight:700">' + esc(title) + '</div>'
      + (sub ? '<div style="font-size:12px;opacity:.85">' + esc(sub) + '</div>' : '')
      + '<div style="flex:1"></div>'
      + '<button onclick="GLSIMP_close()" style="background:rgba(255,255,255,.18);border:0;color:#fff;font-size:16px;'
      + 'width:30px;height:30px;border-radius:8px;cursor:pointer">×</button></div>';
  }
  var BTN = 'padding:8px 14px;border-radius:8px;border:1px solid #cbd8d0;background:#fff;cursor:pointer;font-size:13px';
  var BTN_P = 'padding:9px 18px;border-radius:8px;border:0;background:#2e7d52;color:#fff;cursor:pointer;font-size:13px;font-weight:600';

  /* 第一步：来源 */
  function open() {
    var box = modal(head('智能导入', '任意表格 / 文档 → 自动识别字段 → 填进对应板块')
      + '<div style="padding:18px">'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px">'
      + card('📋', '从剪贴板导入', 'WPS/Excel 中 Ctrl+C 后点这里，<b>格式原样保留</b>', 'GLSIMP.fromClipboard()')
      + card('📂', '选择表格文件', 'xlsx / xls / csv，原文件会一并留存', 'GLSIMP.pickFile()')
      + card('⌨️', '粘贴文本', '从任意地方复制的内容，自动识别列', 'GLSIMP.fromText()')
      + card('📄', '上传文档/图纸', 'docx / pdf / dwg / 图片 → 存入技术资料库', 'GLSIMP.pickDoc()')
      + '</div>'
      + '<div style="margin-top:14px;font-size:12px;color:#5b6b62;line-height:1.7">'
      + '识别机制：读表头 → 匹配系统字段（BOM 清单 / 物料档案 / 供应商 / 销售订单 / 采购 / 收货 / 仓库 / 生产 …）→ '
      + '能对上的<b>直接填进对应板块</b>，对不上的作为<b>新增字段</b>保留，档案里没有的物料/供应商<b>自动建档</b>。'
      + '</div></div>');
    return box;
  }
  function card(icon, title, desc, call) {
    return '<div onclick="' + call + '" style="border:1px solid #dbe6df;border-radius:10px;padding:14px;cursor:pointer;'
      + 'transition:.15s" onmouseover="this.style.borderColor=\'#2e7d52\';this.style.background=\'#f7fcf9\'" '
      + 'onmouseout="this.style.borderColor=\'#dbe6df\';this.style.background=\'#fff\'">'
      + '<div style="font-size:22px">' + icon + '</div>'
      + '<div style="font-weight:700;margin:6px 0 4px;color:#1f3b2d">' + title + '</div>'
      + '<div style="font-size:12px;color:#5b6b62;line-height:1.6">' + desc + '</div></div>';
  }

  /* 来源：剪贴板 */
  function fromClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      toast('当前浏览器不支持读剪贴板，请改用「粘贴文本」'); return;
    }
    navigator.clipboard.read().then(function (items) {
      var htmlItem = null, textItem = null;
      items.forEach(function (it) {
        if (it.types.indexOf('text/html') >= 0) htmlItem = it;
        if (it.types.indexOf('text/plain') >= 0) textItem = it;
      });
      if (htmlItem) {
        return htmlItem.getType('text/html').then(function (b) { return b.text(); }).then(function (html) {
          ingest({ rows: htmlTableToRows(html), htmlRaw: html, title: '', fileName: '剪贴板内容' });
        });
      }
      if (textItem) {
        return textItem.getType('text/plain').then(function (b) { return b.text(); }).then(function (t) {
          ingest({ rows: textToRows(t), htmlRaw: null, title: '', fileName: '剪贴板文本' });
        });
      }
      toast('剪贴板里没有可导入的表格');
    }).catch(function (e) {
      toast('读取剪贴板失败（' + (e && e.message ? e.message : '权限') + '），请改用「粘贴文本」');
    });
  }
  /* 来源：文件 */
  function pickFile() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv,.txt';
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var name = f.name, isCsv = /\.csv$/i.test(name), isTxt = /\.txt$/i.test(name);
      if (isCsv || isTxt) {
        var fr = new FileReader();
        fr.onload = function () {
          var txt = String(fr.result || '');
          ingest({ rows: textToRows(txt), htmlRaw: null, title: name.replace(/\.[^.]+$/, ''), fileName: name, fileBlob: f, isCsv: true });
        };
        fr.readAsText(f, 'utf-8');
        return;
      }
      if (typeof XLSX === 'undefined') { toast('表格解析库未就绪，请刷新页面重试'); return; }
      var fr2 = new FileReader();
      fr2.onload = function () {
        try {
          var wb = XLSX.read(new Uint8Array(fr2.result), { type: 'array', cellStyles: true });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var rows = sheetToRows(ws);
          var html = null;
          try { html = glsSheetToHtml(ws); } catch (e) { html = XLSX.utils.sheet_to_html(ws); }
          ingest({ rows: rows, htmlRaw: html, title: name.replace(/\.[^.]+$/, ''), fileName: name, fileBlob: f, wb: wb });
        } catch (e) { toast('表格解析失败：' + e.message); }
      };
      fr2.readAsArrayBuffer(f);
    };
    inp.click();
  }
  /* 来源：粘贴文本 */
  function fromText() {
    var box = modal(head('粘贴文本', '直接 Ctrl+V 到下面的框里')
      + '<div style="padding:16px">'
      + '<textarea id="glsimpTxt" placeholder="把表格内容粘进来（支持 Excel/WPS 复制的制表符文本、CSV）" '
      + 'style="width:100%;height:220px;border:1px solid #cbd8d0;border-radius:8px;padding:10px;font:13px/1.6 ui-monospace,Consolas,monospace"></textarea>'
      + '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">'
      + '<button style="' + BTN + '" onclick="GLSIMP_close()">取消</button>'
      + '<button style="' + BTN_P + '" onclick="GLSIMP.useText()">识别</button></div></div>');
    setTimeout(function () { var t = document.getElementById('glsimpTxt'); if (t) t.focus(); }, 100);
    return box;
  }
  function useText() {
    var t = document.getElementById('glsimpTxt');
    var v = t ? t.value : '';
    if (!v.trim()) { toast('请先粘贴内容'); return; }
    ingest({ rows: textToRows(v), htmlRaw: null, title: '', fileName: '粘贴内容' });
  }
  /* 来源：文档/图纸 → 技术资料库 */
  function pickDoc() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true;
    inp.accept = '.doc,.docx,.pdf,.dwg,.dxf,.step,.stp,.igs,.iges,.png,.jpg,.jpeg,.xlsx,.xls,.zip';
    inp.onchange = function () {
      var files = Array.prototype.slice.call(inp.files || []);
      if (!files.length) return;
      var done = 0;
      files.forEach(function (f) {
        idbPut(STORE, {
          id: uid('F'), name: f.name, type: f.type || '', size: f.size, cat: docCat(f.name),
          blob: f, createdAt: new Date().toISOString(), rel: ''
        }).then(function () {
          done++;
          if (done === files.length) {
            toast('已存入技术资料库：' + done + ' 个文件');
            try { if (global.ERP && ERP.go) ERP.go('files'); } catch (e) {}
          }
        });
      });
    };
    inp.click();
  }
  function docCat(name) {
    var n = String(name).toLowerCase();
    if (/\.(dwg|dxf|step|stp|igs|iges|sldprt|sldasm|prt|catpart)$/.test(n)) return '2d3d';
    if (/\.pdf$/.test(n)) return 'pdf';
    if (/\.(png|jpe?g|gif|bmp|webp)$/.test(n)) return 'img';
    if (/\.(xlsx|xls|csv)$/.test(n)) return 'sheet';
    if (/\.(docx?|txt|md)$/.test(n)) return 'doc';
    return 'other';
  }

  /* 第二步：识别结果 + 映射 */
  function ingest(src) {
    S.rows = src.rows || [];
    S.htmlRaw = src.htmlRaw || null;
    S.title = src.title || '';
    S.fileName = src.fileName || '';
    S.fileBlob = src.fileBlob || null;
    if (!S.rows.length) { toast('没有解析到内容'); return; }
    if (S.rows.length < 2) { toast('内容太少，至少需要表头 + 一行数据'); }
    S.cands = detect(S.rows);
    S.entKey = S.cands.length ? S.cands[0].key : '';
    S.headerIdx = S.cands.length ? S.cands[0].headerIdx : 0;
    renderDetect();
  }

  function renderDetect() {
    var c = S.cands[0] || null;
    var conf = c ? (c.score >= 8 ? '高' : c.score >= 4 ? '中' : '低') : '无';
    var opts = S.cands.slice(0, 8).map(function (x) {
      return '<option value="' + x.key + '"' + (x.key === S.entKey ? ' selected' : '') + '>'
        + x.icon + ' ' + esc(x.label) + '（匹配度 ' + x.score + '，命中 ' + x.colCount + ' 列）</option>';
    }).join('');
    var noMatch = '<option value=""' + (S.entKey ? '' : ' selected') + '>— 不写入台账，仅保存为模板 —</option>';

    var headerOpts = '';
    for (var i = 0; i < Math.min(S.rows.length, 10); i++) {
      headerOpts += '<option value="' + i + '"' + (i === S.headerIdx ? ' selected' : '') + '>第 ' + (i + 1) + ' 行：'
        + esc(S.rows[i].slice(0, 8).join(' | ').slice(0, 90)) + '</option>';
    }

    var body = '<div style="padding:16px 18px">';
    body += '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:#f4f8f5;border:1px solid #dbe6df;'
      + 'border-radius:10px;padding:12px 14px">'
      + '<div style="font-weight:700;color:#1f3b2d">识别结果</div>'
      + '<div style="font-size:13px">' + (c ? ('判定为 <b style="color:#2e7d52">' + esc(c.label) + '</b>（置信度：' + conf + '）') : '未能自动判定表类型，可手动选择') + '</div>'
      + '<div style="flex:1"></div>'
      + '<label style="font-size:12px;color:#5b6b62">写入板块：</label>'
      + '<select id="glsimpEnt" onchange="GLSIMP.setEnt(this.value)" style="' + BTN + ';min-width:250px">' + opts + noMatch + '</select>'
      + '</div>';

    body += '<div style="margin:12px 0 6px;font-size:12px;color:#5b6b62">表头所在行：'
      + '<select id="glsimpHeader" onchange="GLSIMP.setHeader(this.value)" style="' + BTN + ';margin-left:6px">' + headerOpts + '</select>'
      + '<span style="margin-left:12px">共 ' + S.rows.length + ' 行 · ' + (S.rows[0] || []).length + ' 列</span></div>';

    body += '<div id="glsimpMapWrap"></div>';
    body += '<div id="glsimpPreviewWrap" style="margin-top:12px"></div>';

    body += '<div style="margin-top:14px;border-top:1px solid #e6efe9;padding-top:12px;display:flex;flex-wrap:wrap;gap:16px;align-items:center">'
      + '<label style="font-size:13px"><input type="checkbox" id="glsimpDoTpl" checked> 同时存为模板（<b>原样保真</b>，可打印/填写）</label>'
      + '<label style="font-size:13px"><input type="checkbox" id="glsimpMerge" checked> 同编码合并（不重复建单）</label>'
      + '<label style="font-size:13px"><input type="checkbox" id="glsimpReplace"> 覆盖同编码（用新表刷新旧记录）</label>'
      + '<input id="glsimpTplName" placeholder="模板名称（留空用文件名）" style="' + BTN + ';min-width:220px" value="' + esc(S.title || '') + '">'
      + '<div style="flex:1"></div>'
      + '<button style="' + BTN + '" onclick="GLSIMP.openBatches()">导入数据管理</button>'
      + '<button style="' + BTN + '" onclick="GLSIMP.open()">返回</button>'
      + '<button style="' + BTN_P + '" id="glsimpGo" onclick="GLSIMP.run()">确认导入</button>'
      + '</div>';
    body += '<div id="glsimpResult" style="margin-top:10px;font-size:12px;color:#2e7d52"></div>';
    body += '</div>';

    modal(head('智能导入 · 确认字段', S.fileName || '') + body, { w: 1180 });
    renderMap();
    renderPreview();
  }

  function setEnt(k) {
    S.entKey = k;
    if (k && S.cands.length) {
      for (var i = 0; i < S.cands.length; i++) {
        if (S.cands[i].key === k && S.cands[i].headerIdx < S.rows.length) { S.headerIdx = S.cands[i].headerIdx; break; }
      }
    }
    renderDetect();
  }
  function setHeader(i) { S.headerIdx = parseInt(i, 10) || 0; renderDetect(); }

  function renderMap() {
    var wrap = document.getElementById('glsimpMapWrap');
    if (!wrap) return;
    var def = S.entKey ? DICT[S.entKey] : null;
    var header = S.rows[S.headerIdx] || [];
    var map = {};
    if (def) {
      var sc = scoreHeader(def, header);
      map = sc.map;
    }
    S.columns = def ? columnPlan(def, header, map)
      : header.map(function (h, i) { return { idx: i, header: h || ('第' + (i + 1) + '列'), target: '__extra', label: (h || '') + '（新增字段）', kind: 'extra', isNew: true }; });

    var fOpts = '<option value="__extra">➕ 新增字段（保留原值）</option><option value="__skip">（忽略此列）</option>';
    if (def) {
      fOpts += '<optgroup label="单据字段">';
      (def.main || []).forEach(function (f) { fOpts += '<option value="' + f.k + '">' + esc(f.label) + '</option>'; });
      fOpts += '</optgroup>';
      if (def.items) {
        fOpts += '<optgroup label="明细字段">';
        def.items.forEach(function (f) { fOpts += '<option value="item.' + f.k + '">明细 · ' + esc(f.label) + '</option>'; });
        fOpts += '</optgroup>';
      }
    }
    function mkSel(ci) {
      var col = S.columns[ci];
      return '<select data-col="' + ci + '" onchange="GLSIMP.setCol(' + ci + ',this.value)" style="' + BTN + ';width:100%">'
        + fOpts.replace('value="' + col.target + '"', 'value="' + col.target + '" selected')
        + '</select>';
    }
    var html = '<div style="border:1px solid #dbe6df;border-radius:10px;overflow:hidden">'
      + '<div style="background:#f4f8f5;padding:8px 12px;font-weight:700;font-size:13px;color:#1f3b2d">'
      + '字段对应（可改）' + (def ? '' : '　· 未选择板块时全部按「新增字段」处理')
      + '</div><div style="max-height:260px;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px">'
      + '<thead><tr style="background:#fbfdfc">'
      + '<th style="text-align:left;padding:6px 10px;border-bottom:1px solid #e6efe9">原表列名</th>'
      + '<th style="text-align:left;padding:6px 10px;border-bottom:1px solid #e6efe9">示例值</th>'
      + '<th style="text-align:left;padding:6px 10px;border-bottom:1px solid #e6efe9">写入系统字段</th>'
      + '</tr></thead><tbody>';
    for (var i = 0; i < S.columns.length; i++) {
      var c0 = S.columns[i];
      var sample = '';
      for (var r = S.headerIdx + 1; r < S.rows.length && r < S.headerIdx + 4; r++) {
        if (S.rows[r][c0.idx]) { sample = S.rows[r][c0.idx]; break; }
      }
      html += '<tr>' + '<td style="padding:5px 10px;border-bottom:1px solid #f1f6f3">' + esc(c0.header) + '</td>'
        + '<td style="padding:5px 10px;border-bottom:1px solid #f1f6f3;color:#5b6b62">' + esc(String(sample).slice(0, 26)) + '</td>'
        + '<td style="padding:5px 10px;border-bottom:1px solid #f1f6f3;width:300px">' + mkSel(i) + '</td>'
        + '</tr>';
    }
    html += '</tbody></table></div></div>';
    wrap.innerHTML = html;
  }
  function setCol(ci, v) {
    S.columns[ci].target = v;
    S.columns[ci].isNew = (v === '__extra');
  }
  function renderPreview() {
    var wrap = document.getElementById('glsimpPreviewWrap');
    if (!wrap) return;
    var rows = S.rows.slice(0, 8);
    var html = '<div style="border:1px solid #dbe6df;border-radius:10px;overflow:hidden">'
      + '<div style="background:#f4f8f5;padding:8px 12px;font-weight:700;font-size:13px;color:#1f3b2d">数据预览（前 ' + rows.length + ' 行）</div>'
      + '<div style="overflow:auto;max-height:220px"><table style="border-collapse:collapse;font-size:12px;white-space:nowrap">';
    rows.forEach(function (r, ri) {
      html += '<tr' + (ri === S.headerIdx ? ' style="background:#eaf6ef;font-weight:700"' : '') + '>';
      for (var c = 0; c < Math.min(r.length, 14); c++) {
        html += '<td style="border:1px solid #e6efe9;padding:4px 8px">' + esc(String(r[c] || '').slice(0, 22)) + '</td>';
      }
      html += '</tr>';
    });
    html += '</table></div></div>';
    wrap.innerHTML = html;
  }

  /* 第三步：执行 */
  function run() {
    var btn = document.getElementById('glsimpGo');
    if (btn) { btn.disabled = true; btn.textContent = '导入中…'; }
    resetStats();
    var doTpl = (document.getElementById('glsimpDoTpl') || {}).checked !== false;
    var mergeSame = (document.getElementById('glsimpMerge') || {}).checked !== false;
    var replaceSame = (document.getElementById('glsimpReplace') || {}).checked === true;
    var tplName = (document.getElementById('glsimpTplName') || {}).value || S.title || S.fileName || ('导入模板 ' + new Date().toLocaleDateString());
    var def = S.entKey ? DICT[S.entKey] : null;
    var res = { added: 0 };

    batchBegin(tplName, S.entKey);
    try {
      if (S.entKey) {
        res = importRows(S.entKey, S.rows, S.columns,
                         { headerIdx: S.headerIdx, mergeSame: mergeSame, replace: replaceSame });
      }
      /* 新增字段登记 */
      var newNames = S.columns.filter(function (c) { return c.target === '__extra'; }).map(function (c) { return c.header; });
      if (S.entKey && def) {
        registerExtraFields(def.ent, newNames);
        newNames.forEach(function (n) { if (_batch) _batch.fieldsAdded.push({ ent: def.ent, name: n }); });
      }
      var bid = batchCommit();
      S.lastBatchId = bid;
      saveErp();
      // 通知其他板块刷新
      try { if (global.DATAHUB) DATAHUB.set('erp', appData.erp); } catch (e) {}
      try { if (global.ERP && ERP.refreshCurrent) ERP.refreshCurrent(); } catch (e) {}
    } catch (e) {
      toast('导入出错：' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = '确认导入'; }
      return;
    }

    var finish = function (tplMsg) {
      /* 无论模板是否保存成功，按钮必须恢复，避免界面停在「导入中…」 */
      var gb = document.getElementById('glsimpGo');
      if (gb) { gb.disabled = false; gb.textContent = '确认导入'; }
      var st = getStats();
      var lines = [];
      if (S.entKey) {
        lines.push('写入「' + DICT[S.entKey].label + '」<b>' + st.recs + '</b> 条'
          + (st.items ? '（明细 ' + st.items + ' 行）' : '') + (st.merged ? '，合并 ' + st.merged + ' 条' : ''));
        var refs = Object.keys(st.newRef);
        if (refs.length) lines.push('自动建档：' + refs.map(function (k) {
          return ({ material: '物料', customer: '客户', supplier: '供应商' }[k] || k) + ' ' + st.newRef[k] + ' 条';
        }).join('、'));
        var nf = Object.keys(st.newFields);
        if (nf.length) lines.push('新增字段 ' + nf.length + ' 个：' + nf.slice(0, 6).map(esc).join('、') + (nf.length > 6 ? ' …' : ''));
        if (S.lastBatchId) lines.push('本次导入已留档，可随时在本弹窗底部点「导入数据管理」整批撤销。');
      }
      if (tplMsg) lines.push(tplMsg);
      var el = document.getElementById('glsimpResult');
      if (el) el.innerHTML = lines.join('<br>');
      toast('导入完成：' + (st.recs ? st.recs + ' 条记录' : '已保存模板'));
    };

    finish('');   /* 数据已落库 → 立即出结果并恢复按钮；模板/原文件随后台保存 */
    if (doTpl) {
      saveTemplateFromImport(tplName).then(function (tplMsg) {
        var el2 = document.getElementById('glsimpResult');
        if (el2 && tplMsg) el2.innerHTML += '<br>' + tplMsg;
      }).catch(function (e) {
        toast('数据已导入；模板原文件保存失败：'
          + ((e && e.message) || '原文件仓储被其它标签页占用，关闭多余标签页后重试'));
      });
    }
  }

  /* ============================================================
   * 导入数据管理：整批撤销 / 按板块清空 / 导出备份
   * ============================================================ */
  function openBatches() {
    var l = batches();
    var rows = l.map(function (b) {
      var lbl = (DICT[b.entKey] || {}).label || '—';
      return '<tr style="border-bottom:1px solid #eef4f0">'
        + '<td style="padding:7px 10px;white-space:nowrap">' + esc(new Date(b.time).toLocaleString()) + '</td>'
        + '<td style="padding:7px 10px">' + esc(b.title || '—') + '</td>'
        + '<td style="padding:7px 10px">' + esc(lbl) + '</td>'
        + '<td style="padding:7px 10px;text-align:center">' + (b.added || []).length + '</td>'
        + '<td style="padding:7px 10px;text-align:center">' + (b.updated || []).length + '</td>'
        + '<td style="padding:7px 10px;text-align:center">' + (b.refsAdded || []).length + '</td>'
        + '<td style="padding:7px 10px">'
        + '<button style="' + BTN + '" onclick="GLSIMP.undoBatch(\'' + b.id + '\')">撤销这批</button></td>'
        + '</tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="7" style="padding:16px;text-align:center;color:#84958b">暂无导入留档</td></tr>';

    var entOpts = Object.keys(DICT).map(function (k) {
      return '<option value="' + k + '">' + esc(DICT[k].label) + '</option>';
    }).join('');

    var body = '<div style="padding:16px 18px">';
    body += '<div style="font-weight:700;color:#1f3b2d;margin-bottom:6px">导入留档（可整批撤销，撤销即还原到导入前的状态）</div>';
    body += '<div style="border:1px solid #dbe6df;border-radius:10px;overflow:auto;max-height:250px">'
      + '<table style="width:100%;border-collapse:collapse;font-size:12.5px">'
      + '<thead><tr style="background:#f4f8f5;color:#1f3b2d">'
      + '<th style="text-align:left;padding:7px 10px">时间</th><th style="text-align:left;padding:7px 10px">来源</th>'
      + '<th style="text-align:left;padding:7px 10px">写入板块</th>'
      + '<th style="padding:7px 10px">新建</th><th style="padding:7px 10px">更新</th><th style="padding:7px 10px">建档</th>'
      + '<th style="text-align:left;padding:7px 10px">操作</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    body += '<div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">'
      + '<button style="' + BTN + '" onclick="GLSIMP.undoAllBatches()">撤销全部导入</button>'
      + '<button style="' + BTN + '" onclick="GLSIMP.backupDownload()">导出数据备份（JSON）</button>'
      + '</div>';

    body += '<div style="margin-top:18px;border-top:1px solid #e6efe9;padding-top:14px">'
      + '<div style="font-weight:700;color:#1f3b2d;margin-bottom:8px">按板块清理（清理前建议先导出备份）</div>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">'
      + '<select id="glsimpClrEnt" style="' + BTN + ';min-width:230px">' + entOpts + '</select>'
      + '<button style="' + BTN + '" onclick="GLSIMP.doClear(true)">只清导入产生的记录</button>'
      + '<button style="' + BTN + ';border-color:#e0b4b4;color:#b03030" onclick="GLSIMP.doClear(false)">清空该板块全部记录</button>'
      + '</div>'
      + '<div style="margin-top:8px;font-size:12px;color:#84958b">「只清导入产生的记录」只删掉经过智能导入写入的条目，你手工录入的不受影响。</div>'
      + '</div>';
    body += '<div style="margin-top:16px;text-align:right"><button style="' + BTN + '" onclick="GLSIMP.close()">关闭</button></div>';
    body += '</div>';
    modal(head('导入数据管理', '撤销 / 清理 / 备份') + body, { w: 1080 });
  }

  function doClear(onlyImported) {
    var sel = document.getElementById('glsimpClrEnt');
    if (!sel) return;
    var key = sel.value;
    var def = DICT[key] || {};
    var ent = def.ent || key;
    var n = listOf(ent).length;
    var tip = onlyImported
      ? '确定要删除「' + (def.label || key) + '」里由智能导入产生的记录吗？（共 ' + n + ' 条，手工录入的会保留）'
      : '确定要清空「' + (def.label || key) + '」的全部记录吗？（共 ' + n + ' 条，此操作不可恢复，建议先导出备份）';
    if (!global.confirm(tip)) return;
    var removed = clearEntity(key, onlyImported);
    toast('已清理 ' + removed + ' 条记录');
    openBatches();
  }

  /* 模板：原样保存 */
  function saveTemplateFromImport(name) {
    var id = uid('UT');
    var p = Promise.resolve(null);
    if (S.fileBlob) {
      var fid = uid('TF');
      p = idbPut('tplfiles', {
        id: fid, name: S.fileName || (name + '.xlsx'), type: S.fileBlob.type || '', size: S.fileBlob.size,
        blob: S.fileBlob, createdAt: new Date().toISOString()
      }).then(function () { return fid; }).catch(function () { return null; });
    }
    return p.then(function (fid) {
      var html = S.htmlRaw;
      if (!html) {
        /* 无原始 HTML（文本/CSV/xlsx 无样式时）→ 生成一份整洁表格，仅作展示 */
        html = htmlFromRows(S.rows);
      }
      var tpl = {
        id: id, name: name || '导入模板', description: '智能导入 · ' + (S.fileName || '剪贴板') + ' · ' + new Date().toLocaleString(),
        recordTemplate: html, isUser: true, moduleId: 'imported',
        origFileId: fid || '', origFileName: S.fileName || '', origType: S.fileBlob ? (S.fileBlob.type || '') : '',
        lackFill: true, createdAt: new Date().toISOString()
      };
      saveUserTpl(tpl);
      return '已存为模板「' + esc(name) + '」（原样保真' + (fid ? ' + 原文件留存' : '') + '，可打印/填写）';
    });
  }
  function htmlFromRows(rows) {
    if (!rows || !rows.length) return '';
    var h = '<table style="border-collapse:collapse;width:100%;font-family:\'宋体\',serif;font-size:12px">';
    rows.forEach(function (r, i) {
      h += '<tr>';
      (r || []).forEach(function (c) {
        var tag = i === 0 ? 'th' : 'td';
        var st = 'border:1px solid #999;padding:3px 6px;' + (i === 0 ? 'background:#f2f2f2;font-weight:700;text-align:center' : '');
        h += '<' + tag + ' style="' + st + '">' + esc(c) + '</' + tag + '>';
      });
      h += '</tr>';
    });
    return h + '</table>';
  }

  global.GLSIMP = {
    version: VERSION, DICT: DICT, norm: norm, detect: detect, columnPlan: columnPlan, scoreHeader: scoreHeader,
    htmlTableToRows: htmlTableToRows, textToRows: textToRows, sheetToRows: sheetToRows,
    importRows: importRows, resetStats: resetStats, getStats: getStats,
    getExtraFields: getExtraFields, registerExtraFields: registerExtraFields,
    listOf: listOf, saveErp: saveErp, ensureRef: ensureRef, findRef: findRef, nextCode: nextCode,
    toNum: toNum, toDate: toDate, esc: esc, toast: toast, uid: uid,
    /* 界面与模板 */
    open: open, fromClipboard: fromClipboard, pickFile: pickFile, fromText: fromText, useText: useText,
    pickDoc: pickDoc, setEnt: setEnt, setHeader: setHeader, setCol: setCol, run: run,
    printTemplate: printTemplate, fillTemplate: fillTemplate, openTplOrigFile: openTplOrigFile,
    htmlFromRows: htmlFromRows, userTpls: userTpls, setUserTpls: setUserTpls, saveUserTpl: saveUserTpl,
    idbPut: idbPut, idbGet: idbGet, idbDel: idbDel, docCat: docCat, ingest: ingest, renderDetect: renderDetect,
    /* 导入数据管理 */
    batches: batches, batchBegin: batchBegin, batchCommit: batchCommit,
    openBatches: openBatches, undoBatch: undoBatch, undoAllBatches: undoAllBatches,
    clearEntity: clearEntity, clearMany: clearMany, doClear: doClear,
    backupDownload: backupDownload, refreshAll: refreshAll
  };
})(window);
