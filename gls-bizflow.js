/* gls-bizflow.js — 业务主流程引擎（审批流转 + 自动流转 + 消息提醒 + 齐套检查 + 售后翻新）
 * 数据：DATAHUB 'bizflow' 分区（与全系统共用一个中央键，数据打通）
 * 流程：销售订单 → 生产工单(自动核对库存) → 采购→收货→进料检验→入库 → 领料→首件→巡检→成品检验→完工入库 → 发货 → 售后退货→售后分析→售后翻新→翻新完工入库
 * 审批 = 流转权限：部门上级领导审批通过后自动流转下一环节并消息提醒相关人员与部门领导
 * 不合格评审 = 独立一套（MRB），评审结论决定流转去向
 * 顶部 FLOW_BIZ / FLOW_AFTER 为可视化修改口子（改数组即可调整流程，不写死）
 */
(function () {
  'use strict';

  /* ==================== 可配置区（改这里调整流程，不写死） ==================== */
  var FLOW_BIZ = [
    { id: 'SO',      name: '销售订单',            dept: '销售部', ent: 'so',       icon: '📝', action: null,          next: 'MO' },
    { id: 'MO',      name: '生产工单·自动核对库存', dept: '生产部', ent: 'mo',      icon: '🏭', action: 'checkStock',  next: 'PICK', prNext: 'PR' },
    { id: 'PR',      name: '采购申请',            dept: '采购部', ent: 'pr',       icon: '📋', action: 'genPr',        next: 'PO' },
    { id: 'PO',      name: '采购订单',            dept: '采购部', ent: 'po',       icon: '🛒', action: 'genPo',        next: 'PO_RECV' },
    { id: 'PO_RECV', name: '采购收货·仓储部确认',  dept: '仓储部', ent: 'poRecv',   icon: '🚚', action: 'genRecv',      next: 'IQC' },
    { id: 'IQC',     name: '进料检验',            dept: '品质部', ent: null,       icon: '📥', branch: { pass: 'IN', fail: 'MRB' }, next: 'IN' },
    { id: 'IN',      name: '物料入库·库存台账',    dept: '仓储部', ent: 'stockIn',  icon: '📦', action: 'genIn',        next: 'MO' },
    { id: 'PICK',    name: '生产领料',            dept: '生产部', ent: 'moPick',   icon: '🧺', action: 'genPick',      next: 'FIRST' },
    { id: 'FIRST',   name: '首件检验',            dept: '品质部', ent: null,       icon: '✅', branch: { pass: 'PATROL', fail: 'MRB' }, next: 'PATROL' },
    { id: 'PATROL',  name: '巡检',               dept: '品质部', ent: null,       icon: '🔍', branch: { pass: 'OQC', fail: 'MRB' }, next: 'OQC' },
    { id: 'OQC',     name: '成品检验',            dept: '品质部', ent: null,       icon: '🧪', branch: { pass: 'MO_IN', fail: 'MRB' }, next: 'MO_IN' },
    { id: 'MO_IN',   name: '完工入库·生成成品库存', dept: '仓储部', ent: 'moIn',   icon: '🏬', action: 'genMoIn',      next: 'SHIP' },
    { id: 'SHIP',    name: '销售发货·成品库存自动更新', dept: '销售部', ent: 'soShip', icon: '🚛', action: 'genShip',  next: 'DONE' },
    { id: 'DONE',    name: '销售完成',            dept: '销售部', ent: null,       icon: '🎯', action: null,          next: null }
  ];
  var FLOW_AFTER = [
    { id: 'RTN',       name: '销售退货·售后库存生成',   dept: '销售部', ent: 'soReturn', icon: '↩️', action: 'genRtn',    next: 'ANALY' },
    { id: 'ANALY',     name: '品质部售后分析',          dept: '品质部', ent: 'afterSale', icon: '📊', action: 'genAnaly', next: 'RNV' },
    { id: 'RNV',       name: '售后翻新工单',            dept: '生产部', ent: 'renovate',  icon: '🛠️', action: 'genRnv',   next: 'RNV_PICK' },
    { id: 'RNV_PICK',  name: '生产补料·售后翻新',       dept: '生产部', ent: 'moPick',   icon: '🧺', action: 'genRnvPick', next: 'RNV_FIRST' },
    { id: 'RNV_FIRST', name: '首件检验·售后翻新',       dept: '品质部', ent: null,       icon: '✅', branch: { pass: 'RNV_PATROL', fail: 'MRB' }, next: 'RNV_PATROL' },
    { id: 'RNV_PATROL',name: '巡检·售后翻新',          dept: '品质部', ent: null,       icon: '🔍', branch: { pass: 'RNV_OQC', fail: 'MRB' }, next: 'RNV_OQC' },
    { id: 'RNV_OQC',   name: '成品检验·售后翻新',       dept: '品质部', ent: null,       icon: '🧪', branch: { pass: 'RNV_IN', fail: 'MRB' }, next: 'RNV_IN' },
    { id: 'RNV_IN',    name: '完工入库·售后翻新·生成成品库存', dept: '仓储部', ent: 'moIn', icon: '🏬', action: 'genRnvIn', next: null }
  ];
  /* 不合格评审（MRB）结论（可视化修改口子） */
  var MRB_OPTIONS = ['退货', '挑选使用', '特采接收', '返工返修', '报废', '重新检验'];
  /* 检验节点 → 对应检验工作台类型（INSP.TYPES） */
  var INSP_TYPE = { IQC: 'IQC', FIRST: 'FIRST', PATROL: 'PATROL', OQC: 'OQC', RNV_FIRST: 'FIRST', RNV_PATROL: 'PATROL', RNV_OQC: 'OQC' };
  /* 流程状态 */
  var FLOW_STATUS = { RUN: '流转中', APPR: '待审批', MRB: '待评审', REJ: '已驳回', DONE: '已完成', CLOSE: '已关闭' };

  /* ==================== 工具 ==================== */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function nowTime() { var d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function uid(p) { return (p || 'b') + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function curUser() {
    try { return JSON.parse(localStorage.getItem('gls_current_user') || 'null') || {}; } catch (e) { return {}; }
  }
  function toast(msg, ok) {
    if (window.ERP && ERP.toast) { ERP.toast(msg, ok); return; }
    try { alert(msg); } catch (e) {}
  }

  /* ==================== 数据层（DATAHUB bizflow 分区） ==================== */
  function db() {
    var d = window.DATAHUB ? DATAHUB.get('bizflow', null) : null;
    if (!d) { d = { flows: [], notices: [] }; if (window.DATAHUB) { try { DATAHUB.set('bizflow', d); } catch (e) {} } }
    if (!d.flows) d.flows = [];
    if (!d.notices) d.notices = [];
    return d;
  }
  function save() {
    if (window.DATAHUB) DATAHUB.set('bizflow', db());
    else { try { localStorage.setItem('gls_bizflow', JSON.stringify(db())); } catch (e) {} }
  }
  function flows() { return db().flows; }
  function notices() { return db().notices; }
  function getFlow(id) {
    var arr = flows();
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  function notify(to, text, flowId) {
    var n = { id: uid('n'), time: today() + ' ' + nowTime(), to: to, text: text, flowId: flowId || null, read: false };
    notices().unshift(n);
    if (notices().length > 200) notices().length = 200;
    save();
  }
  function nodeById(kind, id) {
    var arr = (kind === 'after') ? FLOW_AFTER : FLOW_BIZ;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  function flowNo(kind) {
    var prefix = (kind === 'after') ? 'AF' : 'BF';
    var arr = flows(), max = 0;
    arr.forEach(function (f) {
      var c = String(f.no || '');
      if (c.indexOf(prefix) === 0) { var n = parseInt(c.substr(2), 10); if (!isNaN(n) && n > max) max = n; }
    });
    return prefix + (max + 1);
  }
  function erpList(key) { try { return (window.ERP && ERP._listOf) ? ERP._listOf(key) : []; } catch (e) { return []; } }
  function erpData() { try { return (window.ERP && ERP._getData) ? ERP._getData() : {}; } catch (e) { return {}; } }
  function erpEnt(key) { try { return (window.ERP && ERP.ENTITIES) ? ERP.ENTITIES[key] : null; } catch (e) { return null; } }
  function erpSave() { try { if (window.ERP && ERP._save) ERP._save(); } catch (e) {} }
  function erpCode(key) {
    var ent = erpEnt(key);
    if (ent && window.ERP && ERP._nextCode) { try { return ERP._nextCode(ent); } catch (e) {} }
    var d = new Date();
    return (ent ? ent.prefix : 'X') + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '001';
  }
  function findRec(key, field, val) {
    var arr = erpList(key), v = String(val || '').trim().toLowerCase();
    if (!v) return null;
    for (var i = 0; i < arr.length; i++) if (String(arr[i][field] || '').trim().toLowerCase() === v) return arr[i];
    return null;
  }
  function stockRows() { try { return (window.ERP && ERP.buildStock) ? ERP.buildStock() : []; } catch (e) { return []; } }
  function stockBal(code) {
    var rows = stockRows();
    for (var i = 0; i < rows.length; i++) if (String(rows[i].code).toLowerCase() === String(code).toLowerCase()) return rows[i].bal;
    return 0;
  }

  /* ==================== 发起流程 ==================== */
  function newFlow(kind, opts) {
    var f = {
      id: uid('f'), no: flowNo(kind), kind: kind,
      title: opts.title || '', srcId: opts.srcId || null, srcCode: opts.srcCode || '',
      soId: opts.soId || null, soCode: opts.soCode || '',
      product: opts.product || '', planQty: opts.planQty || 0,
      cur: (kind === 'after') ? 'RTN' : 'SO',
      status: FLOW_STATUS.RUN,
      done: [], log: [],
      created: today() + ' ' + nowTime(), creator: (opts.creator || curUser().realname || curUser().username || '')
    };
    flows().push(f);
    f.log.push(f.created + ' 发起「' + f.title + '」流程');
    save();
    return f;
  }
  /* 从销售订单发起主流程 */
  function startFromSo(soId) {
    var so = null, arr = erpList('so');
    for (var i = 0; i < arr.length; i++) if (arr[i].id === soId) { so = arr[i]; break; }
    if (!so) { toast('未找到销售订单', false); return null; }
    /* 防重复：同一销售订单已发起过主流程 */
    var dup = flows().filter(function (f) { return f.kind === 'main' && f.soId === soId && f.status !== FLOW_STATUS.CLOSE; });
    if (dup.length) { toast('该订单已发起流程（' + dup[0].no + '）', false); return null; }
    var product = '', qty = 0;
    var items = so.items || [];
    if (items.length) { product = items[0].code || ''; qty = num(items[0].qty); }
    var f = newFlow('main', {
      title: '销售订单 ' + (so.code || '') + ' → 生产交付',
      srcId: so.id, srcCode: so.code, soId: so.id, soCode: so.code,
      product: product, planQty: qty
    });
    so.flowId = f.id;
    so.flowStatus = FLOW_STATUS.RUN;
    erpSave();
    toast('已发起流程 ' + f.no + '，当前环节：销售订单');
    return f;
  }
  /* 从售后退货发起翻新流程 */
  function startFromRtn(rtnId) {
    var rtn = null, arr = erpList('soReturn');
    for (var i = 0; i < arr.length; i++) if (arr[i].id === rtnId) { rtn = arr[i]; break; }
    if (!rtn) { toast('未找到退货单', false); return null; }
    var dup = flows().filter(function (f) { return f.kind === 'after' && f.srcId === rtnId && f.status !== FLOW_STATUS.CLOSE; });
    if (dup.length) { toast('该退货单已发起翻新流程（' + dup[0].no + '）', false); return null; }
    var product = '', qty = 0;
    var items = rtn.items || [];
    if (items.length) { product = items[0].code || ''; qty = num(items[0].qty); }
    var f = newFlow('after', {
      title: '售后翻新 ' + (rtn.code || '') + '（退货 ' + (rtn.code || '') + '）',
      srcId: rtn.id, srcCode: rtn.code, product: product, planQty: qty
    });
    rtn.flowId = f.id;
    rtn.flowStatus = FLOW_STATUS.RUN;
    erpSave();
    toast('已发起翻新流程 ' + f.no + '，当前环节：销售退货');
    return f;
  }

  /* ==================== 提交审批 / 审批 / MRB 评审 ==================== */
  function curNode(f) { return nodeById(f.kind, f.cur); }

  /* 当前环节完成后提交上级审批（检验环节需传 result: 'pass'|'fail'） */
  function submit(fid, opts) {
    opts = opts || {};
    var f = getFlow(fid);
    if (!f) { toast('流程不存在', false); return; }
    if (f.status === FLOW_STATUS.APPR) { toast('该环节已提交审批，请等待领导审批', false); return; }
    if (f.status === FLOW_STATUS.MRB) { toast('该环节在不合格评审中，请先完成评审', false); return; }
    var nd = curNode(f);
    if (!nd) { toast('流程已结束', false); return; }
    var by = curUser().realname || curUser().username || '';
    if (nd.branch) {
      /* 检验节点：pass → 正常流转；fail → 进入不合格评审（独立一套） */
      if (opts.result === 'fail') {
        f.status = FLOW_STATUS.MRB;
        f.log.push(today() + ' ' + nowTime() + ' ' + by + ' 提交「' + nd.name + '」检验不合格 → 进入不合格评审');
        save();
        notify(nd.dept + '领导', '流程 ' + f.no + '「' + nd.name + '」检验不合格，进入不合格评审', f.id);
        return;
      }
    }
    f.status = FLOW_STATUS.APPR;
    f.approver = nd.dept + '领导';
    f._submitBy = by;
    f._submitAt = today() + ' ' + nowTime();
    f.log.push(f._submitAt + ' ' + by + ' 完成「' + nd.name + '」，提交' + nd.dept + '领导审批');
    save();
    notify(nd.dept + '领导', '【待审批】流程 ' + f.no + ' 环节「' + nd.name + '」待您审批', f.id);
  }

  /* 部门上级领导审批：通过 → 执行节点动作并自动流转下一环节；驳回 → 退回 */
  function approve(fid, pass) {
    var f = getFlow(fid);
    if (!f || f.status !== FLOW_STATUS.APPR) { toast('当前无待审批事项', false); return; }
    var nd = curNode(f);
    var by = curUser().realname || curUser().username || '';
    if (pass) {
      f.done.push({ node: nd.id, name: nd.name, by: by, time: today() + ' ' + nowTime(), result: '通过' });
      f.log.push(today() + ' ' + nowTime() + ' ' + by + '（' + nd.dept + '领导）审批通过「' + nd.name + '」');
      /* 执行节点动作（自动建单/库存/齐套检查） */
      var act = nd.action || (nd.branch ? null : null);
      if (act) { try { nodeAction(f, nd, act); } catch (e) { f.log.push('节点动作异常: ' + e.message); } }
      advance(f);
    } else {
      f.status = FLOW_STATUS.REJ;
      f.log.push(today() + ' ' + nowTime() + ' ' + by + '（' + nd.dept + '领导）驳回「' + nd.name + '」');
      notify(f._submitBy || f.creator || '相关人', '流程 ' + f.no + ' 环节「' + nd.name + '」被驳回，请重新处理', f.id);
      save();
    }
  }

  /* 自动流转：推进到下一环节 */
  function advance(f) {
    var nd = curNode(f);
    var nextId = (nd.prNext && f._lack) ? nd.prNext : nd.next;
    if (!nextId) {
      f.status = FLOW_STATUS.DONE;
      f.log.push(today() + ' ' + nowTime() + ' 流程「' + f.title + '」全部环节完成');
      /* 源单状态完成 */
      markSrcDone(f);
      save();
      notify(f.creator || '相关人', '流程 ' + f.no + ' 已全部完成', f.id);
      return;
    }
    f.cur = nextId;
    var nnd = curNode(f);
    /* 终节点（无后继）→ 流程完成 */
    if (!nnd || !nnd.next) {
      f.status = FLOW_STATUS.DONE;
      f.log.push(today() + ' ' + nowTime() + ' 流程「' + f.title + '」全部环节完成');
      markSrcDone(f);
      save();
      notify(f.creator || '相关人', '流程 ' + f.no + ' 已全部完成', f.id);
      return;
    }
    f.status = FLOW_STATUS.RUN;
    f.log.push(today() + ' ' + nowTime() + ' 自动流转至下一环节「' + nnd.name + '」（' + nnd.dept + '）');
    save();
    notify(nnd.dept, '流程 ' + f.no + ' 已流转至「' + nnd.name + '」，请处理并提交审批', f.id);
  }

  /* 节点动作：齐套检查 / 自动生成下一环节单据 / 库存自动更新 */
  function nodeAction(f, nd, act) {
    var by = curUser().realname || curUser().username || '';
    if (act === 'checkStock') {
      /* 生产工单：自动核对库存数量（BOM 需求 vs 库存台账） */
      var need = bomNeed(f.product, f.planQty);
      var lack = [];
      need.forEach(function (it) {
        var bal = stockBal(it.code);
        if (bal < it.needQty) lack.push({ code: it.code, name: it.name, unit: it.unit, need: it.needQty, bal: bal, lack: it.needQty - bal });
      });
      var d = erpData();
      if (!d.mo) d.mo = [];
      f._lack = lack.length > 0;
      if (lack.length) {
        f.log.push(today() + ' ' + nowTime() + ' 齐套检查：缺料 ' + lack.length + ' 项（' + lack.map(function (l) { return l.name + ' 缺' + l.lack + l.unit; }).join('；') + '）');
        /* 自动生成采购申请（草稿），明细=缺料清单 */
        var pr = {
          id: uid('r'), code: erpCode('pr'), dept: '生产部', applicant: by,
          applyDate: today(), status: '草稿', flowId: f.id,
          items: lack.map(function (l) { return { code: l.code, name: l.name, qty: l.lack, unit: l.unit, remark: '流程' + f.no + '自动请购' }; })
        };
        if (!d.pr) d.pr = [];
        d.pr.push(pr);
        erpSave();
        f._prId = pr.id;
        f.log.push(today() + ' ' + nowTime() + ' 自动生成采购申请 ' + pr.code + '（' + lack.length + ' 项缺料）');
        notify('采购部', '流程 ' + f.no + ' 缺料，已自动生成采购申请 ' + pr.code + '，请处理', f.id);
      } else {
        f.log.push(today() + ' ' + nowTime() + ' 齐套检查：物料齐套，可直接生产领料');
      }
      return;
    }
    if (act === 'genPr') {
      /* 采购申请：若已自动生成草稿则确认，否则新建 */
      var pr2 = findFlowDoc('pr', f);
      if (!pr2) {
        pr2 = { id: uid('r'), code: erpCode('pr'), dept: '生产部', applicant: by, applyDate: today(), status: '草稿', flowId: f.id, items: [] };
        var d2 = erpData(); if (!d2.pr) d2.pr = [];
        d2.pr.push(pr2); erpSave();
      }
      pr2.status = '已确认';
      erpSave();
      f._prId = pr2.id;
      f.log.push(today() + ' ' + nowTime() + ' 采购申请 ' + pr2.code + ' 已确认');
      return;
    }
    if (act === 'genPo') {
      /* 采购订单：从采购申请复制明细 */
      var pr3 = findFlowDoc('pr', f);
      var po = { id: uid('r'), code: erpCode('po'), orderDate: today(), status: '已下单', flowId: f.id, items: [] };
      if (pr3) po.items = (pr3.items || []).map(function (it) {
        return { code: it.code, name: it.name, qty: it.qty, unit: it.unit, remark: '流程' + f.no };
      });
      var d3 = erpData(); if (!d3.po) d3.po = [];
      d3.po.push(po); erpSave();
      f._poId = po.id;
      f.log.push(today() + ' ' + nowTime() + ' 自动生成采购订单 ' + po.code + '（' + (po.items || []).length + ' 项）');
      notify('采购部', '流程 ' + f.no + ' 已生成采购订单 ' + po.code + '，请向供应商下单', f.id);
      return;
    }
    if (act === 'genRecv') {
      /* 采购收货（仓库确认） */
      var po4 = findFlowDoc('po', f);
      var grn = { id: uid('r'), code: erpCode('poRecv'), recvDate: today(), status: '已收货', flowId: f.id, items: [] };
      if (po4) grn.items = (po4.items || []).map(function (it) { return { code: it.code, name: it.name, qty: it.qty, unit: it.unit }; });
      var d4 = erpData(); if (!d4.poRecv) d4.poRecv = [];
      d4.poRecv.push(grn); erpSave();
      f.log.push(today() + ' ' + nowTime() + ' 采购收货 ' + grn.code + '（仓储部确认）→ 待进料检验');
      return;
    }
    if (act === 'genIn') {
      /* 物料入库：写入库存台账（stockIn 生效，库存自动增加） */
      var grn5 = findFlowDoc('poRecv', f);
      var st = { id: uid('r'), code: erpCode('stockIn'), type: '采购入库', date: today(), status: '已入库', flowId: f.id, items: [] };
      if (grn5) st.items = (grn5.items || []).map(function (it) { return { code: it.code, name: it.name, qty: it.qty, unit: it.unit }; });
      if (!st.items.length && f.product) st.items = [{ code: f.product, qty: f.planQty }];
      var d5 = erpData(); if (!d5.stockIn) d5.stockIn = [];
      d5.stockIn.push(st); erpSave();
      f.log.push(today() + ' ' + nowTime() + ' 物料入库 ' + st.code + '（库存台账自动更新）');
      return;
    }
    if (act === 'genPick') {
      /* 生产领料：扣减库存（stockOut） */
      var mo = findFlowDoc('mo', f);
      var out = { id: uid('r'), code: erpCode('stockOut'), type: '生产领料', date: today(), status: '已出库', flowId: f.id, items: [] };
      var need2 = bomNeed(f.product, f.planQty);
      out.items = need2.map(function (it) { return { code: it.code, name: it.name, qty: it.needQty, unit: it.unit }; });
      var d6 = erpData(); if (!d6.stockOut) d6.stockOut = [];
      d6.stockOut.push(out); erpSave();
      f.log.push(today() + ' ' + nowTime() + ' 生产领料 ' + out.code + '（库存自动扣减）');
      return;
    }
    if (act === 'genMoIn') {
      /* 完工入库：生成成品库存（stockIn） */
      var st2 = { id: uid('r'), code: erpCode('stockIn'), type: '生产入库', date: today(), status: '已入库', flowId: f.id, items: [] };
      if (f.product) st2.items = [{ code: f.product, name: f.product, qty: f.planQty, unit: '' }];
      var d7 = erpData(); if (!d7.stockIn) d7.stockIn = [];
      d7.stockIn.push(st2); erpSave();
      f.log.push(today() + ' ' + nowTime() + ' 完工入库 ' + st2.code + '（生成成品库存数据）');
      return;
    }
    if (act === 'genShip') {
      /* 销售发货：成品库存自动扣减 */
      var so = findFlowDoc('so', f);
      var ship = { id: uid('r'), code: erpCode('soShip'), shipDate: today(), status: '已发货', flowId: f.id, items: [] };
      if (so) ship.items = (so.items || []).map(function (it) { return { code: it.code, name: it.name, qty: it.qty, unit: it.unit }; });
      if (!ship.items.length && f.product) ship.items = [{ code: f.product, qty: f.planQty }];
      var d8 = erpData(); if (!d8.soShip) d8.soShip = [];
      d8.soShip.push(ship); erpSave();
      var out2 = { id: uid('r'), code: erpCode('stockOut'), type: '销售出库', date: today(), status: '已出库', flowId: f.id, items: ship.items.slice() };
      if (!d8.stockOut) d8.stockOut = [];
      d8.stockOut.push(out2); erpSave();
      f.log.push(today() + ' ' + nowTime() + ' 销售发货 ' + ship.code + '（成品库存自动更新）');
      return;
    }
    if (act === 'genRtn') {
      /* 销售退货：售后库存生成（stockIn 退货入库） */
      var rtn = findFlowDoc('soReturn', f);
      var st3 = { id: uid('r'), code: erpCode('stockIn'), type: '退货入库', date: today(), status: '已入库', flowId: f.id, items: [] };
      if (rtn) st3.items = (rtn.items || []).map(function (it) { return { code: it.code, name: it.name, qty: it.qty, unit: it.unit }; });
      if (!st3.items.length && f.product) st3.items = [{ code: f.product, qty: f.planQty }];
      var d9 = erpData(); if (!d9.stockIn) d9.stockIn = [];
      d9.stockIn.push(st3); erpSave();
      f.log.push(today() + ' ' + nowTime() + ' 销售退货入库 ' + st3.code + '（售后库存生成）');
      return;
    }
    if (act === 'genAnaly') {
      /* 品质部售后分析：生成分析数据 */
      var as = { id: uid('r'), code: erpCode('afterSale'), rtnCode: f.srcCode, product: f.product, qty: f.planQty, date: today(), status: '已分析', flowId: f.id };
      var d10 = erpData(); if (!d10.afterSale) d10.afterSale = [];
      d10.afterSale.push(as); erpSave();
      f.log.push(today() + ' ' + nowTime() + ' 售后分析单 ' + as.code + '（生成分析数据）');
      return;
    }
    if (act === 'genRnv') {
      /* 售后翻新工单 */
      var rnv = { id: uid('r'), code: erpCode('renovate'), rtnCode: f.srcCode, product: f.product, qty: f.planQty, status: '翻新中', owner: by, startDate: today(), flowId: f.id };
      var d11 = erpData(); if (!d11.renovate) d11.renovate = [];
      d11.renovate.push(rnv); erpSave();
      f.log.push(today() + ' ' + nowTime() + ' 售后翻新工单 ' + rnv.code + ' 已下达');
      return;
    }
    if (act === 'genRnvPick') {
      /* 翻新补料：库存扣减 */
      var out3 = { id: uid('r'), code: erpCode('stockOut'), type: '翻新领料', date: today(), status: '已出库', flowId: f.id, items: [] };
      var need3 = bomNeed(f.product, f.planQty);
      out3.items = need3.map(function (it) { return { code: it.code, name: it.name, qty: it.needQty, unit: it.unit }; });
      var d12 = erpData(); if (!d12.stockOut) d12.stockOut = [];
      d12.stockOut.push(out3); erpSave();
      f.log.push(today() + ' ' + nowTime() + ' 翻新补料 ' + out3.code + '（库存自动扣减）');
      return;
    }
    if (act === 'genRnvIn') {
      /* 翻新完工入库：生成成品库存 */
      var st4 = { id: uid('r'), code: erpCode('stockIn'), type: '翻新入库', date: today(), status: '已入库', flowId: f.id, items: [] };
      if (f.product) st4.items = [{ code: f.product, name: f.product, qty: f.planQty, unit: '' }];
      var d13 = erpData(); if (!d13.stockIn) d13.stockIn = [];
      d13.stockIn.push(st4); erpSave();
      f.log.push(today() + ' ' + nowTime() + ' 翻新完工入库 ' + st4.code + '（生成成品库存数据）');
      return;
    }
  }

  /* BOM 需求计算：产品物料结构 × 计划数量 × (1+损耗率) */
  function bomNeed(product, qty) {
    qty = num(qty) || 1;
    var boms = erpList('bom');
    var bom = null;
    for (var i = 0; i < boms.length; i++) {
      var p = boms[i].product;
      if (String(p).toLowerCase() === String(product).toLowerCase()) { bom = boms[i]; break; }
    }
    var out = [];
    if (bom && bom.items) {
      bom.items.forEach(function (it) {
        var loss = num(it.loss) || 0;
        var need = Math.ceil(num(it.qty) * qty * (1 + loss / 100));
        var m = findRec('material', 'code', it.code);
        out.push({ code: it.code, name: (m && m.name) || it.code, unit: (m && m.unit) || (it.unit || ''), needQty: need });
      });
    } else if (product) {
      var m2 = findRec('material', 'code', product);
      out.push({ code: product, name: (m2 && m2.name) || product, unit: (m2 && m2.unit) || '', needQty: qty });
    }
    return out;
  }

  function findFlowDoc(key, f) {
    var arr = erpList(key);
    for (var i = 0; i < arr.length; i++) if (arr[i].flowId === f.id) return arr[i];
    return null;
  }

  /* 流程结束时源单状态标记 */
  function markSrcDone(f) {
    if (f.kind === 'main' && f.soId) {
      var so = findRecById('so', f.soId);
      if (so) { so.status = '已完成'; so.flowStatus = FLOW_STATUS.DONE; erpSave(); }
    }
    if (f.kind === 'after' && f.srcId) {
      var rtn = findRecById('soReturn', f.srcId);
      if (rtn) { rtn.status = '已翻新'; rtn.flowStatus = FLOW_STATUS.DONE; erpSave(); }
      var rnv = findFlowDoc('renovate', f);
      if (rnv) { rnv.status = '已完成'; erpSave(); }
    }
  }
  function findRecById(key, id) {
    var arr = erpList(key);
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  /* MRB 不合格评审结论（独立一套）：决定流转去向 */
  function mrbDecide(fid, conclusion) {
    var f = getFlow(fid);
    if (!f || f.status !== FLOW_STATUS.MRB) { toast('当前不在评审状态', false); return; }
    var nd = curNode(f);
    var by = curUser().realname || curUser().username || '';
    f.done.push({ node: nd.id, name: nd.name, by: by, time: today() + ' ' + nowTime(), result: '不合格→' + conclusion });
    f.log.push(today() + ' ' + nowTime() + ' 不合格评审结论：' + conclusion + '（' + by + '）');
    if (conclusion === '退货' || conclusion === '报废') {
      f.status = FLOW_STATUS.CLOSE;
      f.log.push(today() + ' ' + nowTime() + ' 流程关闭（' + conclusion + '）');
      notify(f.creator || '相关人', '流程 ' + f.no + ' 因' + conclusion + '已关闭', f.id);
      save();
      return;
    }
    if (conclusion === '重新检验' || conclusion === '返工返修') {
      /* 退回当前检验节点重新检验 */
      f.status = FLOW_STATUS.RUN;
      f.log.push(today() + ' ' + nowTime() + ' 退回「' + nd.name + '」重新检验/返工后复检');
      notify(nd.dept, '流程 ' + f.no + '「' + nd.name + '」需返工/重新检验，请处理', f.id);
      save();
      return;
    }
    /* 挑选使用 / 特采接收：视为放行，走合格分支 */
    var nxt = (nd.branch && nd.branch.pass) ? nd.branch.pass : nd.next;
    f.status = FLOW_STATUS.RUN;
    f.log.push(today() + ' ' + nowTime() + ' 评审放行（' + conclusion + '），流转至下一环节');
    var t = f.cur;
    f.cur = nxt;
    var nnd = curNode(f);
    if (!nnd) { f.status = FLOW_STATUS.DONE; }
    else f.log.push(today() + ' ' + nowTime() + ' 自动流转至「' + nnd.name + '」');
    save();
    notify(nnd ? nnd.dept : '相关人', '流程 ' + f.no + ' 评审放行，流转至「' + (nnd ? nnd.name : '完成') + '」', f.id);
  }

  /* ==================== 对外暴露 ==================== */
  window.BIZFLOW = {
    FLOW_BIZ: FLOW_BIZ, FLOW_AFTER: FLOW_AFTER, MRB_OPTIONS: MRB_OPTIONS,
    FLOW_STATUS: FLOW_STATUS, INSP_TYPE: INSP_TYPE,
    db: db, flows: flows, notices: notices, getFlow: getFlow,
    startFromSo: startFromSo, startFromRtn: startFromRtn,
    submit: submit, approve: approve, mrbDecide: mrbDecide,
    curNode: curNode, bomNeed: bomNeed, stockBal: stockBal,
    notify: notify, markRead: function (id) {
      var ns = notices();
      for (var i = 0; i < ns.length; i++) if (ns[i].id === id) ns[i].read = true;
      save();
    },
    unread: function () { return notices().filter(function (n) { return !n.read; }).length; }
  };
})();

/* ==================== 页面渲染（业务流转工作台） ==================== */
(function () {
  var B = window.BIZFLOW;
  if (!B) return;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function me() { try { return JSON.parse(localStorage.getItem('gls_current_user') || 'null') || {}; } catch (e) { return {}; } }
  function isAdmin() { var u = me(); return !!(u && u.role === 'admin'); }
  function toast(m, ok) { if (window.ERP && ERP.toast) ERP.toast(m, ok); else try { alert(m); } catch (e) {} }

  function showPage(id) {
    var all = document.querySelectorAll('.page'), i;
    for (i = 0; i < all.length; i++) all[i].classList.remove('active');
    var el = $(id);
    if (el) el.classList.add('active');
    var items = document.querySelectorAll('.sidebar .nav-item');
    for (i = 0; i < items.length; i++) items[i].classList.remove('active');
    var t = $('pageTitle'); if (t) t.textContent = '业务流转';
    var f = $('fabAdd'); if (f) f.style.display = 'none';
    var s = $('searchBtn'); if (s) s.style.display = 'none';
    window.scrollTo(0, 0);
  }

  /* 打开工作台 */
  function openHome() {
    var page = $('page-bizflow');
    if (!page) { toast('业务流转页面未挂载，请刷新', false); return; }
    showPage('page-bizflow');
    try { updateBadge(); } catch (e) {}
    renderHome();
  }

  /* ---- 顶部统计 + 待办 ---- */
  function renderHome() {
    var flows = B.flows();
    var ns = B.notices();
    var u = me();
    var myName = u.realname || u.username || '';
    var stats = { run: 0, appr: 0, mrb: 0, done: 0 };
    flows.forEach(function (f) {
      if (f.status === B.FLOW_STATUS.RUN) stats.run++;
      else if (f.status === B.FLOW_STATUS.APPR) stats.appr++;
      else if (f.status === B.FLOW_STATUS.MRB) stats.mrb++;
      else if (f.status === B.FLOW_STATUS.DONE) stats.done++;
    });
    /* 我的待审批：管理员可审全部，普通用户审自己提交的？审批人=部门领导(role=admin 或 leader) */
    var myTodo = flows.filter(function (f) { return f.status === B.FLOW_STATUS.APPR && (isAdmin() || f.approver === myName + '（领导）'); });
    var myMrb = flows.filter(function (f) { return f.status === B.FLOW_STATUS.MRB && (isAdmin() || true); });

    var h = '<div class="biz-stats">'
      + stat(stats.run, '流转中', 'run') + stat(stats.appr, '待审批', 'appr')
      + stat(stats.mrb, '待评审', 'mrb') + stat(stats.done, '已完成', 'done')
      + '</div>'
      + '<div class="biz-toolbar">'
      + '<span class="erp-btn primary" onclick="BIZFLOW_UI.openStart()">＋ 发起流程</span>'
      + '<span class="erp-btn" onclick="BIZFLOW_UI.openNotices()">🔔 消息 ' + (B.unread() ? '<b style="color:#dc2626">(' + B.unread() + ')</b>' : '') + '</span>'
      + '<span class="erp-btn" onclick="BIZFLOW_UI.help()">? 说明</span>'
      + '</div>';
    var box = $('bizflowHome');
    if (box) box.innerHTML = h + renderTodo(myTodo, myMrb) + renderPanorama() + renderList();
  }
  function stat(n, t, c) {
    return '<div class="biz-stat ' + c + '"><div class="n">' + n + '</div><div class="t">' + t + '</div></div>';
  }

  /* ---- 我的待办 ---- */
  function renderTodo(apprList, mrbList) {
    var h = '<div class="biz-section">';
    h += '<div class="biz-sec-title">📌 我的待办</div>';
    if (!apprList.length && !mrbList.length) {
      h += '<div class="biz-empty">暂无待办事项</div></div>';
      return h;
    }
    apprList.forEach(function (f) {
      var nd = B.curNode(f);
      h += '<div class="biz-todo appr"><div class="biz-todo-t">【待审批】' + esc(f.no) + ' · ' + esc(f.title) + '</div>'
        + '<div class="biz-todo-s">当前环节：' + esc(nd ? nd.name : '') + ' · 提交人：' + esc(f._submitBy || '') + '</div>'
        + '<div class="biz-todo-a">'
        + '<span class="erp-btn primary" onclick="BIZFLOW.approve(\'' + f.id + '\', true)">✓ 通过并流转</span>'
        + '<span class="erp-btn danger" onclick="BIZFLOW.approve(\'' + f.id + '\', false)">✕ 驳回</span>'
        + '<span class="erp-btn" onclick="BIZFLOW_UI.detail(\'' + f.id + '\')">详情</span>'
        + '</div></div>';
    });
    mrbList.forEach(function (f) {
      var nd = B.curNode(f);
      h += '<div class="biz-todo mrb"><div class="biz-todo-t">【不合格评审】' + esc(f.no) + ' · ' + esc(f.title) + '</div>'
        + '<div class="biz-todo-s">不合格环节：' + esc(nd ? nd.name : '') + '</div>'
        + '<div class="biz-todo-a">';
      B.MRB_OPTIONS.forEach(function (op) {
        h += '<span class="erp-btn" onclick="BIZFLOW.mrbDecide(\'' + f.id + '\',\'' + op + '\')">' + op + '</span>';
      });
      h += '<span class="erp-btn" onclick="BIZFLOW_UI.detail(\'' + f.id + '\')">详情</span>'
        + '</div></div>';
    });
    h += '</div>';
    return h;
  }

  /* ---- 流程全景（正常主线 + 售后翻新支线） ---- */
  function renderPanorama() {
    var h = '<div class="biz-section"><div class="biz-sec-title">🗺 业务主流程</div>'
      + '<div class="biz-pano">';
    B.FLOW_BIZ.forEach(function (nd, i) {
      h += '<div class="biz-node"><div class="biz-node-ic">' + (nd.icon || '▪') + '</div>'
        + '<div class="biz-node-nm">' + esc(nd.name) + '</div>'
        + '<div class="biz-node-dp">' + esc(nd.dept) + '</div></div>';
      if (i < B.FLOW_BIZ.length - 1) h += '<div class="biz-arrow">→</div>';
    });
    h += '</div>';
    h += '<div class="biz-sec-title" style="margin-top:14px">🔄 售后翻新支线</div><div class="biz-pano">';
    B.FLOW_AFTER.forEach(function (nd, i) {
      h += '<div class="biz-node"><div class="biz-node-ic">' + (nd.icon || '▪') + '</div>'
        + '<div class="biz-node-nm">' + esc(nd.name) + '</div>'
        + '<div class="biz-node-dp">' + esc(nd.dept) + '</div></div>';
      if (i < B.FLOW_AFTER.length - 1) h += '<div class="biz-arrow">→</div>';
    });
    h += '</div></div>';
    return h;
  }

  /* ---- 流程实例列表 ---- */
  function renderList() {
    var flows = B.flows();
    var h = '<div class="biz-section"><div class="biz-sec-title">📋 流程实例（' + flows.length + '）</div>';
    if (!flows.length) {
      h += '<div class="biz-empty">暂无流程。可从「销售订单」发起生产交付流程，或从「销售退货」发起售后翻新流程。</div></div>';
      return h;
    }
    h += '<div class="biz-tablewrap"><table class="biz-table"><thead><tr>'
      + '<th>流程号</th><th>类型</th><th>标题</th><th>产品</th><th>数量</th><th>当前环节</th><th>状态</th><th>操作</th>'
      + '</tr></thead><tbody>';
    flows.slice().reverse().forEach(function (f) {
      var nd = B.curNode(f);
      var kind = f.kind === 'after' ? '售后翻新' : '正常生产';
      h += '<tr><td>' + esc(f.no) + '</td><td>' + kind + '</td><td>' + esc(f.title) + '</td>'
        + '<td>' + esc(f.product || '-') + '</td><td>' + esc(f.planQty || '-') + '</td>'
        + '<td>' + esc(nd ? nd.name : '-') + '</td>'
        + '<td><span class="biz-st ' + (f.status === '待审批' ? 'appr' : f.status === '待评审' ? 'mrb' : f.status === '已完成' ? 'done' : 'run') + '">' + f.status + '</span></td>'
        + '<td class="biz-ops">'
        + '<span class="erp-op" onclick="BIZFLOW_UI.detail(\'' + f.id + '\')">详情</span>';
      if (f.status === B.FLOW_STATUS.RUN) {
        var nd2 = B.curNode(f);
        if (nd2 && nd2.branch) {
          h += '<span class="erp-op" onclick="BIZFLOW_UI.submitDlg(\'' + f.id + '\')">提交检验</span>';
        } else {
          h += '<span class="erp-op" onclick="BIZFLOW.submit(\'' + f.id + '\')">提交审批</span>';
        }
      }
      h += '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  /* ---- 发起流程 ---- */
  function openStart() {
    var h = '<div class="biz-start">'
      + '<div class="biz-sec-title">发起新流程</div>';
    /* 未发起流程的销售订单 */
    var sos = [];
    try { if (window.ERP && ERP._listOf) sos = ERP._listOf('so'); } catch (e) {}
    var availSo = sos.filter(function (so) {
      return !so.flowId || !B.getFlow(so.flowId);
    });
    h += '<div class="biz-sec-sub">① 从销售订单发起【生产交付】主流程</div>';
    if (!availSo.length) h += '<div class="biz-empty">暂无未发起流程的销售订单，请先在 ERP 销售管理新建销售订单</div>';
    else {
      h += '<div class="biz-tablewrap"><table class="biz-table"><thead><tr><th>订单号</th><th>客户</th><th>日期</th><th>操作</th></tr></thead><tbody>';
      availSo.slice().reverse().forEach(function (so) {
        h += '<tr><td>' + esc(so.code || '-') + '</td><td>' + esc(so.customer || '-') + '</td>'
          + '<td>' + esc(so.orderDate || '-') + '</td>'
          + '<td><span class="erp-op" onclick="BIZFLOW.startFromSo(\'' + so.id + '\'); BIZFLOW_UI.openHome()">发起流程</span></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    /* 未发起翻新的退货单 */
    var rtns = [];
    try { if (window.ERP && ERP._listOf) rtns = ERP._listOf('soReturn'); } catch (e) {}
    var availRtn = rtns.filter(function (r) { return !r.flowId || !B.getFlow(r.flowId); });
    h += '<div class="biz-sec-sub" style="margin-top:14px">② 从销售退货发起【售后翻新】流程</div>';
    if (!availRtn.length) h += '<div class="biz-empty">暂无未发起翻新的退货单，请先在 ERP 销售管理新建销售退货</div>';
    else {
      h += '<div class="biz-tablewrap"><table class="biz-table"><thead><tr><th>退货单号</th><th>产品</th><th>数量</th><th>操作</th></tr></thead><tbody>';
      availRtn.slice().reverse().forEach(function (r) {
        var it0 = (r.items && r.items[0]) || {};
        h += '<tr><td>' + esc(r.code || '-') + '</td><td>' + esc(it0.code || r.product || '-') + '</td>'
          + '<td>' + esc(it0.qty != null ? it0.qty : '-') + '</td>'
          + '<td><span class="erp-op" onclick="BIZFLOW.startFromRtn(\'' + r.id + '\'); BIZFLOW_UI.openHome()">发起翻新</span></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';
    var box = $('bizflowHome');
    if (box) box.innerHTML = h;
  }

  /* ---- 检验节点提交（合格/不合格） ---- */
  function submitDlg(fid) {
    var f = B.getFlow(fid);
    if (!f) return;
    var nd = B.curNode(f);
    var inspT = B.INSP_TYPE[nd.id] || '';
    var h = '<div class="biz-submit"><div class="biz-sec-title">提交检验结果 · ' + esc(nd.name) + '</div>'
      + '<div style="margin:10px 0;color:#666">流程 ' + esc(f.no) + '，检验类型：' + esc(inspT)
      + '（在「品质检验」板块可录入检验记录，此处登记结果并流转）</div>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap">'
      + '<span class="erp-btn primary" onclick="BIZFLOW.submit(\'' + fid + '\',{result:\'pass\'}); BIZFLOW_UI.openHome()">✓ 检验合格 → 流转下一环节</span>'
      + '<span class="erp-btn danger" onclick="BIZFLOW.submit(\'' + fid + '\',{result:\'fail\'}); BIZFLOW_UI.openHome()">✕ 检验不合格 → 进入评审</span>'
      + '</div></div>';
    var box = $('bizflowHome');
    if (box) box.innerHTML = h;
  }

  /* ---- 流程详情（时间线） ---- */
  function detail(fid) {
    var f = B.getFlow(fid);
    if (!f) { toast('流程不存在', false); return; }
    var nd = B.curNode(f);
    var h = '<div class="biz-detail"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap">'
      + '<div class="biz-sec-title" style="margin:0">' + esc(f.no) + ' · ' + esc(f.title) + '</div>'
      + '<span class="erp-btn" onclick="BIZFLOW_UI.openHome()">← 返回</span></div>'
      + '<div class="biz-detail-info">'
      + '类型：' + (f.kind === 'after' ? '售后翻新' : '正常生产') + ' ｜ 产品：' + esc(f.product || '-')
      + ' ｜ 数量：' + esc(f.planQty || '-') + ' ｜ 发起：' + esc(f.creator || '') + ' ｜ 时间：' + esc(f.created)
      + ' ｜ 当前环节：<b>' + esc(nd ? nd.name : '-') + '</b> ｜ 状态：<b>' + f.status + '</b>'
      + '</div>';
    if (f.status === B.FLOW_STATUS.RUN && nd) {
      h += '<div class="biz-detail-actions">';
      if (nd.branch) h += '<span class="erp-btn primary" onclick="BIZFLOW_UI.submitDlg(\'' + f.id + '\')">提交检验结果</span>';
      else h += '<span class="erp-btn primary" onclick="BIZFLOW.submit(\'' + f.id + '\')">提交审批</span>';
      h += '</div>';
    }
    /* 环节时间线 */
    h += '<div class="biz-timeline">';
    var tmpl = (f.kind === 'after') ? B.FLOW_AFTER : B.FLOW_BIZ;
    tmpl.forEach(function (nd2) {
      var doneRec = null;
      (f.done || []).forEach(function (d) { if (d.node === nd2.id) doneRec = d; });
      var cur = (f.cur === nd2.id);
      var cls = doneRec ? 'done' : (cur ? 'cur' : 'wait');
      h += '<div class="biz-tl-item ' + cls + '">'
        + '<div class="biz-tl-dot"></div>'
        + '<div class="biz-tl-body"><div class="biz-tl-name">' + (nd2.icon || '▪') + ' ' + esc(nd2.name)
        + (doneRec ? ' <span class="biz-tl-ok">✓ ' + esc(doneRec.result || '通过') + '</span>' : cur ? ' <span class="biz-tl-cur">● 当前</span>' : '')
        + '</div><div class="biz-tl-meta">' + esc(nd2.dept) + (doneRec ? ' · ' + esc(doneRec.time) + ' · ' + esc(doneRec.by) : '') + '</div></div>'
        + '</div>';
    });
    h += '</div>';
    /* 流转日志 */
    h += '<div class="biz-sec-title" style="margin-top:14px">流转日志</div><div class="biz-log">';
    (f.log || []).forEach(function (l) { h += '<div class="biz-log-item">' + esc(l) + '</div>'; });
    h += '</div></div>';
    var box = $('bizflowHome');
    if (box) box.innerHTML = h;
  }

  /* ---- 消息中心 ---- */
  function openNotices() {
    var ns = B.notices();
    var h = '<div class="biz-section"><div class="biz-sec-title">🔔 消息中心（' + ns.length + '）</div>';
    if (!ns.length) h += '<div class="biz-empty">暂无消息</div>';
    else {
      h += '<div class="biz-msglist">';
      ns.forEach(function (n) {
        h += '<div class="biz-msg' + (n.read ? ' read' : '') + '" onclick="BIZFLOW.markRead(\'' + n.id + '\'); BIZFLOW_UI.openNotices()">'
          + '<div class="biz-msg-t">' + (n.read ? '' : '🔴 ') + esc(n.text) + '</div>'
          + '<div class="biz-msg-m">' + esc(n.to) + ' · ' + esc(n.time) + '</div></div>';
      });
      h += '</div>';
    }
    h += '</div>';
    var box = $('bizflowHome');
    if (box) box.innerHTML = h;
  }

  function help() {
    var h = '<div class="biz-section"><div class="biz-sec-title">? 使用说明</div>'
      + '<div class="biz-help">'
      + '<p><b>审批 = 流转权限</b>：每个环节完成后，提交人点击「提交审批」→ 该部门上级领导在「我的待办」中审批；审批通过后自动流转到下一环节，并消息提醒相关人与部门领导；驳回则退回重新处理。</p>'
      + '<p><b>不合格评审 = 独立一套</b>：首件/巡检/成品/进料检验不合格时进入「待评审」，由品质部按 MRB 结论（退货/挑选使用/特采接收/返工返修/报废/重新检验）处理，结论决定流程去向。</p>'
      + '<p><b>自动核对库存</b>：生产工单环节按 BOM × 计划数量自动核对库存台账；缺料自动生成采购申请，走 采购→收货→进料检验→入库 支线后回到生产。</p>'
      + '<p><b>库存自动更新</b>：领料自动扣减库存、完工/采购/退货自动入库，销售发货自动扣减成品库存，全程无需手工记账。</p>'
      + '<p><b>售后翻新闭环</b>：销售退货 → 售后分析 → 翻新工单 → 翻新补料 → 翻新检验 → 翻新完工入库，独立支线闭环。</p>'
      + '<p><b>流程可调整</b>：流程节点在 gls-bizflow.js 顶部 FLOW_BIZ / FLOW_AFTER 数组中修改；MRB 结论在 MRB_OPTIONS 中修改。</p>'
      + '</div></div>';
    var box = $('bizflowHome');
    if (box) box.innerHTML = h;
  }

  /* 跳转品质检验（INSP 工作台） */
  function goInsp(type) {
    if (!window.INSP) { toast('检验工作台未加载', false); return; }
    INSP.openList();
    var el = $('inspFilterType');
    if (el && type) {
      el.value = type;
      INSP.openList();
      /* 重建后回填显示值（列表已按类型过滤） */
      var el2 = $('inspFilterType');
      if (el2) el2.value = type;
      var kw = $('inspFilterKw'); if (kw) kw.placeholder = '';
    }
    window.scrollTo(0, 0);
  }
  function goMrb() {
    if (!window.INSP) { toast('检验工作台未加载', false); return; }
    INSP.openMrb();
    window.scrollTo(0, 0);
  }


  /* ---- 侧边栏入口（业务流转） ---- */
  function updateBadge() {
    var f = B.flows();
    var n = f.filter(function (x) { return x.status === B.FLOW_STATUS.APPR || x.status === B.FLOW_STATUS.MRB; }).length;
    var el = document.getElementById('bizNavBadge');
    if (el) { if (n > 0) { el.style.display = 'inline-block'; el.textContent = n; } else el.style.display = 'none'; }
    return n;
  }
  function injectBiz() {
    var nav = document.getElementById('sidebarNav');
    if (!nav || nav.querySelector('[data-bizflow]')) return;
    var sec = nav.querySelector('[data-erp2]');
    var n = 0;
    try { n = updateBadge(); } catch (e) {}
    var html = '<div class="nav-item" data-bizflow="1" onclick="BIZFLOW_UI.openHome(); toggleSidebar()">'
      + '<span class="nav-icon">🔄</span><span class="nav-text">业务流转</span>'
      + (n > 0 ? '<span class="nav-badge" id="bizNavBadge" style="background:#dc2626">' + n + '</span>' : '<span class="nav-badge" id="bizNavBadge" style="display:none"></span>')
      + '</div>';
    if (sec) sec.insertAdjacentHTML('afterend', html);
    else nav.insertAdjacentHTML('afterbegin', html);
  }
  /* 包装 renderSidebar：ERP 注入之后追加业务流转入口 */
  (function () {
    var _base = window.renderSidebar;
    if (typeof _base === 'function') {
      var ns = function () {
        _base.apply(this, arguments);
        try { injectBiz(); } catch (e) {}
      };
      ns.__biz = true;
      window.renderSidebar = ns;
    }
    setTimeout(function () { try { injectBiz(); } catch (e) {} }, 1200);
  })();

  window.BIZFLOW_UI = {
    openHome: openHome, openStart: openStart, openNotices: openNotices,
    detail: detail, submitDlg: submitDlg, help: help, goInsp: goInsp, goMrb: goMrb,
    updateBadge: updateBadge, injectBiz: injectBiz
  };
})();
