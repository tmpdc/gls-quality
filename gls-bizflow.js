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
    { id: 'RTN',    name: '销售退货·售后库存生成',      dept: '销售部', ent: 'soReturn', icon: '↩️', action: 'genRtn',    next: 'ANALY' },
    { id: 'ANALY',  name: '品质部售后分析',             dept: '品质部', ent: 'afterSale', icon: '📊', action: 'genAnaly', next: 'RNV' },
    { id: 'RNV',    name: '售后翻新工单·自动补料',      dept: '生产部', ent: 'renovate',  icon: '🛠️', action: 'genRnv',   next: 'RNV_QC' },
    { id: 'RNV_QC', name: '翻新检验',                   dept: '品质部', ent: null,        icon: '✅', branch: { pass: 'RNV_IN', fail: 'MRB' }, next: 'RNV_IN' },
    { id: 'RNV_IN', name: '完工入库·售后翻新·生成成品库存', dept: '仓储部', ent: 'moIn', icon: '🏬', action: 'genRnvIn', next: null }
  ];
  /* 不合格评审（MRB）结论（可视化修改口子） */
  var MRB_OPTIONS = ['退货', '挑选使用', '特采接收', '返工返修', '报废', '重新检验'];
  /* 触发环节 → 物料类型（决定争议物料最终流向哪个仓库/环节） */
  var MRB_KIND = { IQC: 'raw', FIRST: 'semi', PATROL: 'semi', OQC: 'finished', RNV_QC: 'finished' };
  var MRB_KIND_NAME = { raw: '原材料', semi: '半成品', finished: '成品' };
  /* 结论 → 流转去向（可视化修改口子：原材料进原材料仓库、半成品进生产、成品进成品仓库） */
  var MRB_DEST = {
    '退货':     { raw: '原材料仓库（退供应商）', semi: '生产（返工）',   finished: '成品仓库（待退货）' },
    '挑选使用': { raw: '原材料仓库',             semi: '生产',           finished: '成品仓库' },
    '特采接收': { raw: '原材料仓库',             semi: '生产',           finished: '成品仓库' },
    '返工返修': { raw: '原材料仓库',             semi: '生产（返工）',   finished: '生产（返工）' },
    '报废':     { raw: '报废区',                 semi: '报废区',         finished: '报废区' },
    '重新检验': { raw: '原材料待检区',           semi: '生产待检区',     finished: '成品待检区' }
  };
  /* 默认会签部门（可视化口子，可按物料类型调） */
  var MRB_DEFAULT_DEPTS = {
    raw: ['品质部', '采购部', '仓储部', '生产部'],
    semi: ['品质部', '生产部', '技术部'],
    finished: ['品质部', '生产部', '销售部', '仓储部']
  };
  /* 去向 → 通知部门 */
  function mrbDestDept(dest) {
    var d = String(dest || '');
    if (d.indexOf('生产') >= 0) return '生产部';
    if (d.indexOf('报废') >= 0 || d.indexOf('仓库') >= 0 || d.indexOf('待检区') >= 0) return '仓储部';
    return '品质部';
  }
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
  /* ===== 审批人绑定：按账号部门 + 角色（部门主管/超管） ===== */
  function accountOf(username) {
    try {
      var a = window.DATAHUB ? DATAHUB.get('accounts', null) : null;
      var users = (a && a.users) || [];
      for (var i = 0; i < users.length; i++) if (users[i].username === username) return users[i];
    } catch (e) {}
    return null;
  }
  function deptManagers(dept) {
    var out = [];
    try {
      var a = window.DATAHUB ? DATAHUB.get('accounts', null) : null;
      var users = (a && a.users) || [];
      users.forEach(function (u) {
        if (u.status === 'disabled') return;
        if (u.role === 'manager' && u.department === dept) out.push(u);
      });
    } catch (e) {}
    if (!out.length) out.push({ username: dept + '领导', realname: dept + '领导' });
    return out;
  }
  function canApprove(f) {
    var u = curUser(); if (!u || !u.username) return false;
    if (u.role === 'admin') return true;
    var acc = accountOf(u.username);
    if (!acc) return false;
    var nd = curNode(f);
    return acc.role === 'manager' && acc.department === nd.dept;
  }
  function canMrb() {
    var u = curUser(); if (!u || !u.username) return false;
    if (u.role === 'admin') return true;
    var acc = accountOf(u.username);
    return !!(acc && acc.role === 'manager' && acc.department === '品质部');
  }
  function notifyDept(dept, text, flowId) {
    var users = deptManagers(dept);
    users.forEach(function (u) { notify(u.realname || u.username, text, flowId); });
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
    /* 同一时刻也推到企业微信：服务端配好 gls-wecom.ini 才真的发出，失败不影响站内消息 */
    try { wecomPush(to, text, flowId); } catch (e) {}
  }

  /* 企业微信推送：异步、静默，发不出去也不打扰用户 */
  function wecomPush(to, text, flowId) {
    if (!window.GLSSYNC || !GLSSYNC.isOnline || !GLSSYNC.isOnline()) return;
    var base = (GLSSYNC.apiBase ? GLSSYNC.apiBase() : '');
    if (base === null) return;
    try {
      fetch((base || '') + '/api/wecom/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ to: to, text: text, flowId: flowId || '' })
      }).catch(function () {});
    } catch (e) {}
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

  /* 站点定位：全项目统一口径算「第几站 / 共几站 / 当前站 / 下一站」
     列表、待办、详情都调它，避免各处各算一套、说法不一致 */
  function station(f) {
    var tmpl = (f && f.kind === 'after') ? FLOW_AFTER : FLOW_BIZ;
    var idx = -1, cur = null, i, j;
    for (i = 0; i < tmpl.length; i++) {
      if (f && tmpl[i].id === f.cur) { idx = i; cur = tmpl[i]; break; }
    }
    /* 下一站优先按当前节点自己的 next 指针找（能跟上分支）；
       找不到就按模板顺序取下一个，保证任何时候都有个说法 */
    var next = null;
    if (cur && cur.next) {
      for (j = 0; j < tmpl.length; j++) {
        if (tmpl[j].id === cur.next) { next = tmpl[j]; break; }
      }
    }
    if (!next && idx >= 0 && idx + 1 < tmpl.length) next = tmpl[idx + 1];
    return {
      at: idx + 1,                              /* 第几站，1 起；0 = 没定位到 */
      total: tmpl.length,                       /* 全程共几站 */
      cur: cur,                                 /* 当前站定义（含 name/dept/icon） */
      next: next,                               /* 下一站定义 */
      name: cur ? cur.name : '',
      dept: cur ? cur.dept : '',
      icon: cur ? cur.icon : '▪'
    };
  }

  /* 一句人话：把「现在在哪、归谁、接下来去哪」压成一行 */
  function stationText(f) {
    var st = station(f);
    if (!st.cur) return '流程已结束';
    var t = '第 ' + st.at + '/' + st.total + ' 站 · ' + st.name + '【' + st.dept + '】';
    if (f && f.status === FLOW_STATUS.DONE) return t + ' · 已全部完成';
    if (f && f.status === FLOW_STATUS.CLOSE) return t + ' · 已关闭';
    if (st.next) t += ' → 下一站：' + st.next.name + '【' + st.next.dept + '】';
    return t;
  }

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
        if (!f.mrbId) { try { var _m = mrbCreate(f.id, {}); f.mrbId = _m.id; f.mrbNo = _m.no; } catch (e) {} }
        f.log.push(today() + ' ' + nowTime() + ' ' + by + ' 提交「' + nd.name + '」检验不合格 → 进入不合格评审');
        save();
        notify(nd.dept + '领导', '流程 ' + f.no + '「' + nd.name + '」检验不合格，进入不合格评审', f.id);
        return;
      }
    }
    f.status = FLOW_STATUS.APPR;
    var apprs = deptManagers(nd.dept);
    f.approver = apprs.map(function (u) { return u.realname || u.username; }).join('、');
    f.approverDept = nd.dept;
    f._submitBy = by;
    f._submitAt = today() + ' ' + nowTime();
    f.log.push(f._submitAt + ' ' + by + ' 完成「' + nd.name + '」，提交' + nd.dept + '审批');
    save();
    apprs.forEach(function (u) {
      notify(u.realname || u.username, '【待审批】流程 ' + f.no + ' 环节「' + nd.name + '」待您审批', f.id);
    });
  }

  /* 部门上级领导审批：通过 → 执行节点动作并自动流转下一环节；驳回 → 退回 */
  /* 审批入口：先弹页内意见框（手机上 window.prompt 会直接返回 null，点了没反应） */
  function approve(fid, pass) {
    var f = getFlow(fid);
    if (!f || f.status !== FLOW_STATUS.APPR) { toast('当前无待审批事项', false); return; }
    var nd = curNode(f);
    if (!canApprove(f)) { toast('仅「' + nd.dept + '」部门主管或超管可审批此单', false); return; }
    openRemarkDlg(fid, pass, nd);
  }

  function closeRemarkDlg() {
    var d = document.getElementById('bizRemarkDlg');
    if (d && d.parentNode) d.parentNode.removeChild(d);
  }

  function openRemarkDlg(fid, pass, nd) {
    closeRemarkDlg();
    var f = getFlow(fid) || {};
    var d = document.createElement('div');
    d.id = 'bizRemarkDlg';
    d.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.45);'
      + 'z-index:9999;display:flex;align-items:center;justify-content:center;padding:18px;';
    d.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:460px;width:100%;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.22)">'
      + '<div style="padding:15px 17px;border-bottom:1px solid #eef0f2">'
      +   '<div style="font-weight:700;font-size:16px;color:#111827">' + (pass ? '审批通过' : '驳回') + ' · ' + esc(nd.name) + '</div>'
      +   '<div style="font-size:12.5px;color:#6b7280;margin-top:4px">' + esc(f.no || '') + ' ｜ ' + esc(nd.dept || '') + '</div>'
      + '</div>'
      + (f._submitBy ? '<div style="padding:10px 17px 0;font-size:12.5px;color:#6b7280">提交人：' + esc(f._submitBy) + '</div>' : '')
      + '<div style="padding:13px 17px 4px">'
      +   '<div style="font-size:13px;color:#374151;margin-bottom:7px">' + (pass ? '审批意见（可留空）' : '驳回原因（必填）') + '</div>'
      +   '<textarea id="bizRemarkText" rows="3" placeholder="' + (pass ? '可留空' : '请写明原因，便于提交人整改') + '"'
      +   ' style="width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:9px;font-size:14px;resize:vertical;font-family:inherit"></textarea>'
      + '</div>'
      + '<div style="padding:10px 17px 16px;display:flex;gap:10px">'
      +   '<span class="erp-btn" style="flex:1;text-align:center;padding:9px" onclick="BIZFLOW.closeRemarkDlg()">取消</span>'
      +   '<span class="erp-btn ' + (pass ? 'primary' : 'danger') + '" style="flex:1;text-align:center;padding:9px"'
      +   ' onclick="BIZFLOW.doApprove(\'' + fid + '\',' + (pass ? 'true' : 'false') + ')">' + (pass ? '确认通过' : '确认驳回') + '</span>'
      + '</div></div>';
    document.body.appendChild(d);
    setTimeout(function () { var t = document.getElementById('bizRemarkText'); if (t) t.focus(); }, 80);
  }

  /* 真正执行审批 */
  function doApprove(fid, pass) {
    var f = getFlow(fid);
    if (!f || f.status !== FLOW_STATUS.APPR) { toast('当前无待审批事项', false); closeRemarkDlg(); return; }
    var nd = curNode(f);
    if (!canApprove(f)) { toast('仅「' + nd.dept + '」部门主管或超管可审批此单', false); closeRemarkDlg(); return; }
    var remark = '';
    var _t = document.getElementById('bizRemarkText');
    if (_t) remark = String(_t.value || '').trim();
    if (!pass && !remark) { toast('驳回必须填写原因', false); return; }
    closeRemarkDlg();
    var by = curUser().realname || curUser().username || '';
    if (pass) {
      f.done.push({ node: nd.id, name: nd.name, by: by, time: today() + ' ' + nowTime(), result: '通过', remark: remark });
      f.log.push(today() + ' ' + nowTime() + ' ' + by + '（' + nd.dept + '领导）审批通过「' + nd.name + '」' + (remark ? '，意见：' + remark : ''));
      /* 执行节点动作（自动建单/库存/齐套检查） */
      var act = nd.action || (nd.branch ? null : null);
      if (act) { try { nodeAction(f, nd, act); } catch (e) { f.log.push('节点动作异常: ' + e.message); } }
      try { applyStatus(f, nd); } catch (e) {}
      advance(f);
    } else {
      f.status = FLOW_STATUS.REJ;
      f.done.push({ node: nd.id, name: nd.name, by: by, time: today() + ' ' + nowTime(), result: '驳回', remark: remark });
      f.log.push(today() + ' ' + nowTime() + ' ' + by + '（' + nd.dept + '领导）驳回「' + nd.name + '」' + (remark ? '：' + remark : ''));
      notify(f._submitBy || f.creator || '相关人', '流程 ' + f.no + ' 环节「' + nd.name + '」被驳回，请重新处理', f.id);
      save();
    }
    /* 办完就地刷新本模块待办，不用手动刷新页面 */
    try {
      if (typeof window.renderModuleTodo === 'function' && window.currentModule) {
        window.renderModuleTodo(window.currentModule.id);
      }
    } catch (e) {}
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
    notifyDept(nnd.dept, '流程 ' + f.no + ' 已流转至「' + nnd.name + '」，请处理并提交审批', f.id);
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
      var moRec = findMo(f);
      if (moRec) { moRec.status = lack.length ? '待料' : '待生产'; erpSave(); }
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
      /* 售后翻新工单 + 自动补料（领料出库，复用原模块） */
      var rnv = { id: uid('r'), code: erpCode('renovate'), rtnCode: f.srcCode, product: f.product, qty: f.planQty, status: '翻新中', owner: by, startDate: today(), flowId: f.id };
      var d11 = erpData(); if (!d11.renovate) d11.renovate = [];
      d11.renovate.push(rnv);
      var out3 = { id: uid('r'), code: erpCode('stockOut'), type: '翻新领料', date: today(), status: '已出库', flowId: f.id, items: [] };
      var need3 = bomNeed(f.product, f.planQty);
      out3.items = need3.map(function (it) { return { code: it.code, name: it.name, qty: it.needQty, unit: it.unit }; });
      var d12 = erpData(); if (!d12.stockOut) d12.stockOut = [];
      d12.stockOut.push(out3); erpSave();
      f.log.push(today() + ' ' + nowTime() + ' 售后翻新工单 ' + rnv.code + ' 已下达（自动补料 ' + out3.code + '）');
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


  /* ===== 单据状态随流转自动显示（保留手动选择：表单状态列仍可改） ===== */
  function findMo(f) {
    if (f.moId) { var m0 = findRecById('mo', f.moId); if (m0) return m0; }
    var m1 = findFlowDoc('mo', f);
    if (m1) return m1;
    var arr = erpList('mo');
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i].product || '') === String(f.product || '') && arr[i].status !== '已完工' && arr[i].status !== '已关闭') return arr[i];
    }
    return null;
  }
  function applyStatus(f, nd) {
    var ST = {
      SO:      { so: '进行中' },
      MO:      {},
      PR:      { pr: '已确认' },
      PO:      { po: '已下单' },
      PO_RECV: { poRecv: '已收货', po: '已收货' },
      IQC:     {}, IN: {},
      PICK:    { moPick: '已完成' },
      FIRST:   {}, PATROL: {}, OQC: {},
      MO_IN:   { moIn: '已完工' },
      SHIP:    { so: '已发货', soShip: '已发货' },
      RTN:     { soReturn: '已退货' },
      ANALY:   { afterSale: '已分析' },
      RNV:     { renovate: '翻新中' },
      RNV_QC:  {},
      RNV_IN:  { renovate: '已完成', moIn: '已完工' }
    };
    var map = ST[nd.id] || {};
    var d = erpData();
    function putFlow(key, st) {
      var rec = findFlowDoc(key, f);
      if (rec) rec.status = st;
    }
    for (var k in map) {
      var st2 = map[k];
      if (k === 'so') { if (f.soId) { var so0 = findRecById('so', f.soId); if (so0) so0.status = st2; } }
      else if (k === 'soReturn') { if (f.srcId) { var r0 = findRecById('soReturn', f.srcId); if (r0) r0.status = st2; } }
      else putFlow(k, st2);
    }
    var mo2 = findMo(f);
    if (mo2) {
      if (nd.id === 'PICK' && mo2.status !== '已完工') mo2.status = '生产中';
      if (nd.id === 'MO_IN') mo2.status = '已完工';
    }
    erpSave();
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

  /* 兼容旧入口：快速评审（跳过会签，直接出结论并留痕） */
  function mrbDecide(fid, conclusion) {
    var f = getFlow(fid);
    if (!f || f.status !== FLOW_STATUS.MRB) { toast('当前不在评审状态', false); return; }
    var m = mrbOfFlow(fid);
    if (!m) { m = mrbCreate(fid, {}); }
    if (m.stage === 'concluded') { toast('该评审已定稿（' + m.conclusion + '），不可更改', false); return; }
    if (!canMrb()) { toast('仅品质部主管或超管可快速评审', false); return; }
    if (mrbConclude(m.id, conclusion, '（快速评审）', true)) {
      toast('评审结论已定稿：' + conclusion, true);
    }
  }

  /* ==================== 不合格品评审（MRB）：多部门会签 + 留痕 ==================== */
  function mrbAll() { var d = db(); if (!d.mrb) d.mrb = []; return d.mrb; }
  function mrbGet(id) { var a = mrbAll(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  function mrbNo() {
    var a = mrbAll(), dd = today().replace(/-/g, ''), n = 0;
    a.forEach(function (x) { if (x.no && x.no.indexOf('MRB-' + dd) === 0) n++; });
    return 'MRB-' + dd + '-' + ('00' + (n + 1)).slice(-3);
  }
  /* 可选评审人：全部启用账号（按部门分组） */
  function mrbAccounts() {
    var out = [];
    try {
      var a = window.DATAHUB ? DATAHUB.get('accounts', null) : null;
      (a && a.users || []).forEach(function (u) { if (u.status !== 'disabled' && u.username) out.push(u); });
    } catch (e) {}
    return out;
  }
  function mrbKindOf(nodeId) { return MRB_KIND[nodeId] || 'raw'; }
  function mrbDestOf(kind, conclusion) {
    var m = MRB_DEST[conclusion]; if (!m) return '待指定';
    return m[kind] || '待指定';
  }
  /* 建立评审单：自动带默认会签部门的主管；不占用主流程节点（旁挂） */
  function mrbCreate(flowId, opt) {
    opt = opt || {};
    var f = flowId ? getFlow(flowId) : null;
    var nd = f ? curNode(f) : null;
    var nodeId = opt.nodeId || (nd ? nd.id : '');
    var kind = opt.kind || mrbKindOf(nodeId);
    var cu = curUser();
    var m = {
      id: uid('mrb'), no: mrbNo(),
      flowId: flowId || '', flowNo: f ? f.no : '',
      nodeId: nodeId, nodeName: opt.nodeName || (nd ? nd.name : ''),
      inspId: opt.inspId || '', inspNo: opt.inspNo || '',
      material: opt.material || '', materialName: opt.materialName || '',
      batch: opt.batch || '', qty: opt.qty || '', supplier: opt.supplier || '',
      kind: kind, kindName: MRB_KIND_NAME[kind] || '原材料',
      desc: opt.desc || '',
      by: cu.realname || cu.username || '', byUser: cu.username || '',
      time: today() + ' ' + nowTime(),
      reviewers: [], stage: 'collecting',
      conclusion: '', conclusionRemark: '', conclusionBy: '', conclusionTime: '',
      dest: '', destDept: '', locked: false
    };
    (opt.depts || MRB_DEFAULT_DEPTS[kind] || []).forEach(function (dp) {
      deptManagers(dp).forEach(function (u) {
        if (!u || !u.username) return;
        var dup = false;
        m.reviewers.forEach(function (x) { if (x.username === u.username) dup = true; });
        if (dup) return;
        m.reviewers.push({ id: uid('rv'), dept: dp, user: u.realname || u.username,
          username: u.username, status: 'pending', advice: [], opinion: '', time: '' });
      });
    });
    mrbAll().push(m); save();
    /* 通知每一位默认会签人：明确告诉去哪提交意见 */
    m.reviewers.forEach(function (r) {
      notify(r.user || r.username,
        '不合格评审 ' + m.no + ' 邀请你会签（' + (m.materialName || m.material || '—') + ' · ' + m.kindName + '）：请进【异常处理】模块 → 待我处理 → 填写评审意见',
        m.flowId);
    });
    return m;
  }
  function mrbAddReviewer(id, username) {
    var m = mrbGet(id); if (!m) { toast('评审单不存在', false); return false; }
    if (m.stage === 'concluded' || m.locked) { toast('已定稿，不可修改', false); return false; }
    var u = null;
    mrbAccounts().forEach(function (x) { if (x.username === username) u = x; });
    if (!u) { toast('未找到该账号', false); return false; }
    var dup = false;
    m.reviewers.forEach(function (r) { if (r.username === username) dup = true; });
    if (dup) { toast('该人员已在评审名单中', false); return false; }
    m.reviewers.push({ id: uid('rv'), dept: u.department || '', user: u.realname || u.username,
      username: u.username, status: 'pending', advice: [], opinion: '', time: '' });
    save();
    notify(u.realname || u.username, '不合格评审 ' + m.no + ' 邀请你会签（' + (m.materialName || m.material || '—') + ' · ' + m.kindName + '）：请进【异常处理】模块 → 待我处理 → 填写评审意见', m.flowId);
    return true;
  }
  function mrbDelReviewer(id, rid) {
    var m = mrbGet(id); if (!m) return false;
    if (m.stage === 'concluded' || m.locked) { toast('已定稿，不可修改', false); return false; }
    var r = null; m.reviewers.forEach(function (x) { if (x.id === rid) r = x; });
    if (r && r.status === 'done') { toast('该人员已提交意见，不可移除（留痕）', false); return false; }
    m.reviewers = m.reviewers.filter(function (x) { return x.id !== rid; });
    save(); return true;
  }
  function mrbProgress(m) {
    var t = m.reviewers.length, dn = 0;
    m.reviewers.forEach(function (r) { if (r.status === 'done') dn++; });
    return { total: t, done: dn, all: t > 0 && dn === t };
  }
  /* 待我评审（我是评审人且未提交） */
  function mrbMine() {
    var u = curUser(), un = u.username, rn = u.realname, out = [];
    mrbAll().forEach(function (m) {
      if (m.stage === 'concluded') return;
      if (!mrbCanSee(m)) return;
      m.reviewers.forEach(function (r) {
        if (r.status === 'pending' && (r.username === un || (rn && r.user === rn))) out.push({ m: m, rv: r });
      });
    });
    return out;
  }
  /* 待我定稿（我是发起人，或超管） */
  function mrbToConclude() {
    var u = curUser(), un = u.username, rn = u.realname, isAdm = u.role === 'admin';
    return mrbAll().filter(function (m) {
      if (m.stage === 'concluded') return false;
      return isAdm || (m.byUser && m.byUser === un) || (rn && m.by === rn);
    });
  }
  /* 可见性：超管 / 发起人 / 评审人 / 品质部主管 */
  function mrbCanSee(m) {
    var u = curUser(); if (!u || !u.username) return false;
    if (u.role === 'admin' || u.role === 'manager') return true;
    if (m.byUser === u.username || m.by === u.realname) return true;
    var hit = false;
    m.reviewers.forEach(function (r) { if (r.username === u.username || r.user === u.realname) hit = true; });
    return hit;
  }
  /* 评审人提交意见：提交即锁定，不可更改 */
  function mrbSubmitReview(id, rid, advice, opinion) {
    var m = mrbGet(id); if (!m) { toast('评审单不存在', false); return false; }
    if (m.stage === 'concluded' || m.locked) { toast('该评审已定稿，不可修改', false); return false; }
    var r = null; m.reviewers.forEach(function (x) { if (x.id === rid) r = x; });
    if (!r) { toast('未找到评审人', false); return false; }
    if (r.status === 'done') { toast('你已提交过意见，提交后不可更改', false); return false; }
    var adv = advice || [];
    if (!adv.length) { toast('请至少勾选一项建议处置', false); return false; }
    var op = String(opinion || '').trim();
    if (!op) { toast('请填写评审意见', false); return false; }
    r.status = 'done'; r.advice = adv; r.opinion = op;
    r.time = today() + ' ' + nowTime();
    var p = mrbProgress(m);
    notify(m.by, '不合格评审 ' + m.no + ' 收到「' + (r.dept || '') + ' ' + r.user + '」的意见（' + p.done + '/' + p.total + '）', m.flowId);
    if (p.all) notify(m.by, '不合格评审 ' + m.no + ' 意见已收齐（' + p.done + '/' + p.total + '），请确认最终结论', m.flowId);
    save();
    return true;
  }
  /* 定稿：写死结论、留痕、按物料类型与结论决定去向，并推动主流程 */
  function mrbConclude(id, conclusion, remark, force) {
    var m = mrbGet(id); if (!m) { toast('评审单不存在', false); return false; }
    if (m.stage === 'concluded' || m.locked) { toast('已定稿，不可更改', false); return false; }
    if (MRB_OPTIONS.indexOf(conclusion) < 0) { toast('结论无效', false); return false; }
    var u = curUser(), isAdm = u.role === 'admin', me = u.realname || u.username;
    if (!isAdm && m.byUser !== u.username && m.by !== me) { toast('仅发起人或管理员可定稿', false); return false; }
    var p = mrbProgress(m);
    if (!force && p.total > 0 && !p.all) {
      toast('还有 ' + (p.total - p.done) + ' 位评审人未提交意见，不能定稿', false); return false;
    }
    m.conclusion = conclusion;
    m.conclusionRemark = String(remark || '').trim();
    m.conclusionBy = me; m.conclusionTime = today() + ' ' + nowTime();
    m.dest = mrbDestOf(m.kind, conclusion);
    m.destDept = mrbDestDept(m.dest);
    m.stage = 'concluded'; m.locked = true;
    save();
    applyMrbToFlow(m);
    notifyDept(m.destDept, '不合格评审 ' + m.no + ' 定稿：' + conclusion + '，' + m.kindName + '去向 → ' + m.dest + '，请接收处理', m.flowId);
    notify(m.by, '不合格评审 ' + m.no + ' 已定稿：' + conclusion + '（' + m.dest + '）', m.flowId);
    return true;
  }
  /* 把评审结论落到主流程（留痕不可改） */
  function applyMrbToFlow(m) {
    var f = m.flowId ? getFlow(m.flowId) : null;
    if (!f) return;
    var nd = curNode(f);
    if (nd) {
      f.done.push({ node: nd.id, name: nd.name, by: m.conclusionBy, time: m.conclusionTime,
        result: '不合格→' + m.conclusion, remark: m.conclusionRemark });
    }
    f.mrbId = m.id; f.mrbNo = m.no;
    f.log.push(m.conclusionTime + ' 不合格评审 ' + m.no + ' 定稿：' + m.conclusion + '；' + m.kindName + '流向 → ' + m.dest + '（' + m.conclusionBy + '）');
    if (m.conclusionRemark) f.log.push('  结论备注：' + m.conclusionRemark);
    m.reviewers.forEach(function (r) {
      f.log.push('  会签留痕 · ' + (r.dept || '') + ' ' + r.user + '：建议[' + ((r.advice || []).join('／') || '—') + '] ' + (r.opinion || '') + '（' + r.time + '）');
    });
    var c = m.conclusion;
    if (c === '退货' || c === '报废') {
      f.status = FLOW_STATUS.CLOSE;
      f.log.push(today() + ' ' + nowTime() + ' 流程关闭（' + c + '）');
      notify(f.creator || '相关人', '流程 ' + f.no + ' 因' + c + '已关闭', f.id);
      save(); return;
    }
    if (c === '重新检验' || c === '返工返修') {
      f.status = FLOW_STATUS.RUN;
      f.log.push(today() + ' ' + nowTime() + ' 退回「' + nd.name + '」返工／重新检验');
      notifyDept(nd.dept, '流程 ' + f.no + '「' + nd.name + '」需返工／重新检验，请处理', f.id);
      save(); return;
    }
    /* 挑选使用 / 特采接收 → 放行，走合格分支 */
    var nxt = (nd.branch && nd.branch.pass) ? nd.branch.pass : nd.next;
    f.status = FLOW_STATUS.RUN;
    f.cur = nxt;
    var nnd = curNode(f);
    if (!nnd) f.status = FLOW_STATUS.DONE;
    else f.log.push(today() + ' ' + nowTime() + ' 评审放行，自动流转至「' + nnd.name + '」');
    save();
    notifyDept(nnd ? nnd.dept : '相关人', '流程 ' + f.no + ' 评审放行，流转至「' + (nnd ? nnd.name : '完成') + '」', f.id);
  }
  /* 按流程找评审单 */
  function mrbOfFlow(fid) {
    var hit = null;
    mrbAll().forEach(function (m) { if (m.flowId === fid) hit = m; });
    return hit;
  }

  /* ==================== 检验工作台闭环联动 ====================
     检验工作台（IQC/首件/巡检/成品检验）提交与审批后，由这里真正驱动业务流程，
     使「检验记录」与「流程实例」成为同一件事：
       合格 → 提交本环节审批 → 审批通过自动推进下一环节并通知下一部门
       不合格 → 进入不合格评审（MRB）→ 定稿结论决定去向
     检验类型 → 流程环节（可视化修改口子：改这里即可调整对应关系） */
  var INSP_FLOW_NODE = { IQC: 'IQC', FIRST: 'FIRST', PATROL: 'PATROL', IPQC: 'PATROL', OQC: 'OQC', FQC: 'OQC' };

  function nodeDef(id) {
    var all = FLOW_BIZ.concat(FLOW_AFTER);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  /* 按检验类型 + 物料编码找应关联的流程单：物料编码命中优先，否则取该环节最早一条 */
  function findInspFlow(type, matCode) {
    var nid = INSP_FLOW_NODE[type] || '';
    if (!nid) return null;
    var cand = flows().filter(function (f) {
      if (f.status === FLOW_STATUS.DONE || f.status === FLOW_STATUS.CLOSE) return false;
      var nd = curNode(f);
      return nd && nd.id === nid;
    });
    if (!cand.length) return null;
    var code = String(matCode == null ? '' : matCode).trim();
    if (code) {
      var hit = cand.filter(function (f) {
        try { return JSON.stringify(f.items || f.mats || f.moItems || f.recs || []).indexOf(code) >= 0; }
        catch (e) { return false; }
      });
      if (hit.length) return hit[0];
    }
    return cand[0];
  }
  /* 真实去向，一句人话：第 N/M 站 · 环节【部门】 → 下一站：xxx【部门】 */
  function destText(f) {
    if (!f) return '';
    var st = station(f);
    if (!st.cur) return '流程已结束';
    var t = '第 ' + st.at + '/' + st.total + ' 站 · ' + st.name + (st.dept ? '【' + st.dept + '】' : '');
    if (f.status === FLOW_STATUS.CLOSE) return t + ' · 已关闭';
    if (f.status === FLOW_STATUS.DONE || !st.next) return t + ' · 已全部完成';
    return t + ' → 下一站：' + st.next.name + (st.next.dept ? '【' + st.next.dept + '】' : '');
  }
  function noFlowMsg(type) {
    var nd = nodeDef(INSP_FLOW_NODE[type] || '');
    return '未找到当前处于「' + (nd ? nd.name : '检验') + '」环节的业务流程单，本次只记录检验结果，未驱动流程。可从 ERP 工作台对应环节发起流程后再检验。';
  }

  /* ① 检验提交：合格 → 提交本环节审批；不合格 → 进入不合格评审（MRB） */
  function linkInspSubmit(rec) {
    if (!rec) return { ok: false, reason: '数据缺失' };
    var f = (rec.flowId && getFlow(rec.flowId)) || findInspFlow(rec.type, rec.matCode);
    if (!f) return { ok: false, reason: noFlowMsg(rec.type), flowId: '', flowNo: '' };
    var pass = (rec.result === 'pass');
    try {
      if (pass) { if (f.status !== FLOW_STATUS.APPR) submit(f.id, { result: 'pass' }); }
      else { if (f.status !== FLOW_STATUS.MRB) submit(f.id, { result: 'fail' }); }
    } catch (e) {
      return { ok: false, reason: '驱动流程失败：' + e.message, flowId: f.id, flowNo: f.no };
    }
    var f2 = getFlow(f.id) || f;
    var st = station(f2);
    return { ok: true, flowId: f2.id, flowNo: f2.no, dest: destText(f2),
             nextName: (st.next ? st.next.name : ''), nextDept: (st.next ? st.next.dept : ''),
             status: f2.status };
  }

  /* ② 流转审批（合格单放行）：通过 → 执行节点动作并推进下一环节、通知下一部门；驳回 → 退回 */
  function linkInspApprove(rec, pass, remark) {
    if (!rec) return { ok: false, reason: '数据缺失' };
    var f = (rec.flowId && getFlow(rec.flowId)) || findInspFlow(rec.type, rec.matCode);
    if (!f) return { ok: false, reason: noFlowMsg(rec.type), flowId: '', flowNo: '' };
    if (f.status === FLOW_STATUS.MRB) {
      return { ok: false, reason: '该流程单正处于不合格评审中，请先到【异常处理】模块完成会签评审。', flowId: f.id, flowNo: f.no };
    }
    if (f.status !== FLOW_STATUS.APPR) {
      try { submit(f.id, { result: 'pass' }); } catch (e) {}
      f = getFlow(f.id) || f;
      if (f.status !== FLOW_STATUS.APPR) {
        return { ok: false, reason: '未能提交审批（当前状态：' + f.status + '）', flowId: f.id, flowNo: f.no };
      }
    }
    remark = String(remark || '').trim();
    if (!pass && !remark) return { ok: false, reason: '驳回必须填写原因', flowId: f.id, flowNo: f.no };
    var by = curUser().realname || curUser().username || '';
    var nd = curNode(f);
    f.done = f.done || [];
    if (pass) {
      f.done.push({ node: nd.id, name: nd.name, by: by, time: today() + ' ' + nowTime(), result: '合格放行', remark: remark });
      f.log.push(today() + ' ' + nowTime() + ' ' + by + ' 审批通过「' + nd.name + '」（检验单 ' + (rec.no || '') + '）' + (remark ? '，意见：' + remark : ''));
      var act = nd.action || null;
      if (act) { try { nodeAction(f, nd, act); } catch (e) { f.log.push('节点动作异常: ' + e.message); } }
      try { applyStatus(f, nd); } catch (e) {}
      advance(f);
    } else {
      f.status = FLOW_STATUS.REJ;
      f.done.push({ node: nd.id, name: nd.name, by: by, time: today() + ' ' + nowTime(), result: '驳回', remark: remark });
      f.log.push(today() + ' ' + nowTime() + ' ' + by + ' 驳回「' + nd.name + '」（检验单 ' + (rec.no || '') + '）：' + remark);
      notify(f.creator || '相关人', '流程 ' + f.no + '「' + nd.name + '」被驳回，请重新处理', f.id);
      save();
    }
    var f3 = getFlow(f.id) || f;
    return { ok: true, flowId: f3.id, flowNo: f3.no, dest: destText(f3), status: f3.status };
  }

  /* ③ 不合格评审定稿：按结论决定去向，并推动主流程（与 MRB 模块同一套规则） */
  function linkMrbConclude(rec, conclusion, remark) {
    if (!rec) return { ok: false, reason: '数据缺失' };
    var f = (rec.flowId && getFlow(rec.flowId)) || findInspFlow(rec.type, rec.matCode);
    if (!f) return { ok: false, reason: noFlowMsg(rec.type), flowId: '', flowNo: '' };
    if (MRB_OPTIONS.indexOf(conclusion) < 0) return { ok: false, reason: '结论无效', flowId: f.id, flowNo: f.no };
    var nd = curNode(f);
    var kind = MRB_KIND[nd ? nd.id : ''] || 'raw';
    var dest = mrbDestOf(kind, conclusion);
    var dept = mrbDestDept(dest);
    var by = curUser().realname || curUser().username || '';
    remark = String(remark || '').trim();
    f.mrbNo = f.mrbNo || ('MRB-' + (rec.no || ''));
    f.log.push(today() + ' ' + nowTime() + ' ' + by + ' 不合格评审定稿「' + conclusion + '」（检验单 ' + (rec.no || '') + '）：'
      + MRB_KIND_NAME[kind] + '去向 → ' + dest + (remark ? '，备注：' + remark : ''));
    if (conclusion === '退货' || conclusion === '报废') {
      f.status = FLOW_STATUS.CLOSE;
      f.log.push(today() + ' ' + nowTime() + ' 流程关闭（' + conclusion + '）');
      notify(f.creator || '相关人', '流程 ' + f.no + ' 因' + conclusion + '已关闭', f.id);
    } else if (conclusion === '重新检验' || conclusion === '返工返修') {
      f.status = FLOW_STATUS.RUN;
      var word = (conclusion === '返工返修') ? '返工／返修' : '重新检验';
      f.log.push(today() + ' ' + nowTime() + ' 退回「' + nd.name + '」' + word);
      notifyDept(nd.dept, '流程 ' + f.no + '「' + nd.name + '」需' + word + '，请处理', f.id);
    } else {
      /* 挑选使用 / 特采接收 → 放行，走合格分支 */
      var nxt = (nd && nd.branch && nd.branch.pass) ? nd.branch.pass : (nd ? nd.next : null);
      f.status = FLOW_STATUS.RUN;
      if (!nxt) { f.status = FLOW_STATUS.DONE; }
      else {
        f.cur = nxt;
        var nnd = curNode(f);
        if (!nnd) f.status = FLOW_STATUS.DONE;
        else f.log.push(today() + ' ' + nowTime() + ' 评审放行，自动流转至「' + nnd.name + '」');
      }
    }
    save();
    notifyDept(dept, '不合格评审定稿：' + conclusion + '，' + MRB_KIND_NAME[kind] + '去向 → ' + dest + '，请接收处理', f.id);
    var f3 = getFlow(f.id) || f;
    return { ok: true, flowId: f3.id, flowNo: f3.no, dest: dest, destDept: dept,
             text: conclusion + ' → ' + dest + '【' + dept + '】', stationText: destText(f3) };
  }

  /* ==================== 对外暴露 ==================== */
  window.BIZFLOW = {
    FLOW_BIZ: FLOW_BIZ, FLOW_AFTER: FLOW_AFTER, MRB_OPTIONS: MRB_OPTIONS,
    FLOW_STATUS: FLOW_STATUS, INSP_TYPE: INSP_TYPE,
    db: db, flows: flows, notices: notices, getFlow: getFlow,
    startFromSo: startFromSo, startFromRtn: startFromRtn,
    submit: submit, approve: approve, mrbDecide: mrbDecide,
    doApprove: doApprove, openRemarkDlg: openRemarkDlg, closeRemarkDlg: closeRemarkDlg,
    MRB_KIND: MRB_KIND, MRB_KIND_NAME: MRB_KIND_NAME, MRB_DEST: MRB_DEST,
    MRB_DEFAULT_DEPTS: MRB_DEFAULT_DEPTS, MRB_ADVICE: MRB_OPTIONS,
    mrbAll: mrbAll, mrbGet: mrbGet, mrbCreate: mrbCreate, mrbOfFlow: mrbOfFlow,
    mrbAddReviewer: mrbAddReviewer, mrbDelReviewer: mrbDelReviewer,
    mrbAccounts: mrbAccounts, mrbProgress: mrbProgress, mrbDestOf: mrbDestOf,
    mrbDestDept: mrbDestDept, mrbKindOf: mrbKindOf, mrbCanSee: mrbCanSee,
    mrbMine: mrbMine, mrbToConclude: mrbToConclude,
    mrbSubmitReview: mrbSubmitReview, mrbConclude: mrbConclude,
    curNode: curNode, station: station, stationText: stationText,
    /* 检验工作台闭环联动 */
    INSP_FLOW_NODE: INSP_FLOW_NODE, findInspFlow: findInspFlow, destText: destText,
    linkInspSubmit: linkInspSubmit, linkInspApprove: linkInspApprove, linkMrbConclude: linkMrbConclude,
    bomNeed: bomNeed, stockBal: stockBal, canApprove: canApprove, canMrb: canMrb,
    deptManagers: deptManagers, accountOf: accountOf, notifyDept: notifyDept,
    erpList: erpList, erpEnt: erpEnt, erpData: erpData, findRec: findRec,
    notify: notify, markRead: function (id) {
      var ns = notices();
      for (var i = 0; i < ns.length; i++) if (ns[i].id === id) ns[i].read = true;
      save();
    },
    unread: function () {
      var u = curUser(); if (!u || !u.username) return 0;
      if (u.role === 'admin') return notices().filter(function (n) { return !n.read; }).length;
      var acc = accountOf(u.username);
      var meSet = [u.username, u.realname];
      if (acc) { meSet.push(acc.department); if (acc.realname) meSet.push(acc.realname); }
      return notices().filter(function (n) { return !n.read && meSet.indexOf(n.to) >= 0; }).length;
    }
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
    var myTodo = flows.filter(function (f) { return f.status === B.FLOW_STATUS.APPR && B.canApprove(f); });
    /* 兜底：处于待评审但没有评审单的流程，自动补建一张（不让评审卡住） */
    flows.forEach(function (f) {
      if (f.status === B.FLOW_STATUS.MRB && !f.mrbId) {
        try { var mm = B.mrbCreate(f.id, {}); f.mrbId = mm.id; f.mrbNo = mm.no; } catch (e) {}
      }
    });
    var _mrbAll = B.mrbAll ? B.mrbAll().filter(function (m) { return B.mrbCanSee(m); }) : [];
    var myMrb = {
      mine: B.mrbMine ? B.mrbMine() : [],
      toConcl: B.mrbToConclude ? B.mrbToConclude() : [],
      done: _mrbAll.filter(function (m) { return m.stage === 'concluded'; }).slice(-6).reverse()
    };

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

  /* ==================== 审批内容展示：让审批人看清在审什么 ==================== */
  var DOC_SKIP = { id: 1, flowId: 1, flowStatus: 1 };
  function entName(key) { var e = B.erpEnt(key); return e ? (e.name || key) : key; }
  function itemsFieldOf(key) {
    var e = B.erpEnt(key); if (!e) return null;
    var out = null;
    (e.fields || []).forEach(function (f) { if (f.type === 'items') out = f; });
    return out;
  }
  /* 引用字段反查可读名称：客户 / 供应商 / 物料 */
  function refName(kind, v) {
    if (v === '' || v == null) return null;
    var arr = B.erpList(kind);
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i].code) === String(v) || String(arr[i].id) === String(v)) {
        return (arr[i].code ? arr[i].code + ' ' : '') + (arr[i].name || '');
      }
    }
    return null;
  }
  function refKindOf(k) {
    if (k === 'customer') return 'customer';
    if (k === 'supplier') return 'supplier';
    if (k === 'mat' || k === 'material' || k === 'product' || k === 'code') return 'material';
    if (k === 'warehouse') return 'warehouse';
    return null;
  }
  function nodeNameById(id) {
    var t = B.FLOW_BIZ.concat(B.FLOW_AFTER);
    for (var i = 0; i < t.length; i++) if (t[i].id === id) return t[i].name;
    return id || '';
  }
  /* 一张单据渲染成「字段表 + 明细表」 */
  function docTable(key, rec, title) {
    if (!rec) return '';
    var ent = B.erpEnt(key);
    var h = '<div class="biz-doc">';
    if (title) h += '<div class="biz-doc-h">' + esc(title) + '</div>';
    var rows = '';
    if (ent) {
      (ent.fields || []).forEach(function (f) {
        if (f.type === 'items' || f.type === 'calcSum') return;
        if (DOC_SKIP[f.k]) return;
        var v = rec[f.k];
        if (v === '' || v == null) return;
        if (typeof v === 'object') return;
        var shown = String(v);
        var rk = refKindOf(f.k);
        if (rk) { var rn = refName(rk, v); if (rn) shown = rn; }
        rows += '<tr><th>' + esc(f.label) + '</th><td>' + esc(shown) + '</td></tr>';
      });
    }
    if (!rows) {
      Object.keys(rec).forEach(function (k) {
        if (DOC_SKIP[k]) return;
        var v = rec[k];
        if (v === '' || v == null || typeof v === 'object') return;
        rows += '<tr><th>' + esc(k) + '</th><td>' + esc(String(v)) + '</td></tr>';
      });
    }
    h += rows ? '<table class="biz-doc-t"><tbody>' + rows + '</tbody></table>'
              : '<div class="biz-doc-none">该单据暂无字段内容</div>';
    /* 明细 */
    var itf = itemsFieldOf(key);
    var ikey = itf ? itf.k : 'items';
    var arr = rec[ikey] || [];
    if (!arr.length) {
      ['items', 'detail', 'lines'].forEach(function (k) { if (!arr.length && rec[k] && rec[k].length) arr = rec[k]; });
    }
    if (arr && arr.length) {
      var cols = (itf && itf.cols) || null;
      h += '<div class="biz-doc-sub">' + esc(itf ? itf.label : '明细') + '（' + arr.length + ' 行）</div>';
      h += '<div class="biz-tablewrap"><table class="biz-table biz-doc-items"><thead><tr>';
      var ks = cols ? cols.map(function (c) { return c.k; }) : Object.keys(arr[0] || {});
      var lb = cols ? cols.map(function (c) { return c.label; }) : ks;
      lb.forEach(function (t) { h += '<th>' + esc(t) + '</th>'; });
      h += '</tr></thead><tbody>';
      arr.forEach(function (r) {
        h += '<tr>';
        ks.forEach(function (k) {
          var v = r[k];
          var t = (v === '' || v == null) ? '' : String(v);
          if (k === 'code' || k === 'mat' || k === 'material') { var rn2 = refName('material', t); if (rn2) t = rn2; }
          h += '<td>' + esc(t) + '</td>';
        });
        h += '</tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';
    return h;
  }
  /* 审批前能看到的东西：原始单据 + 本环节单据 + 已完成环节记录 */
  function docBlock(f) {
    var h = '';
    var nd = B.curNode(f);
    var sk = (f.kind === 'after') ? 'soReturn' : 'so';
    var src = B.findRec(sk, 'id', f.srcId) || B.findRec(sk, 'code', f.srcCode);
    if (src) h += docTable(sk, src, '原始单据 · ' + entName(sk) + (src.code ? ' ' + src.code : ''));
    var sameAsSrc = false;
    if (nd && nd.ent) {
      var hit = null;
      B.erpList(nd.ent).forEach(function (x) { if (x.flowId === f.id) hit = x; });
      if (hit) {
        sameAsSrc = !!(src && sk === nd.ent && hit.id === src.id);
        if (!sameAsSrc) h += docTable(nd.ent, hit, '本环节单据 · ' + nd.name + (hit.code ? ' ' + hit.code : ''));
      }
    }
    /* 检验类环节：带出检验单 */
    if (nd && !nd.ent && window.INSP && INSP.list) {
      try {
        var recs = INSP.list() || [];
        var mine = recs.filter(function (r) { return r.flowId === f.id || (r.flowNo && r.flowNo === f.no); });
        if (mine.length) {
          var r0 = mine[mine.length - 1];
          h += '<div class="biz-doc"><div class="biz-doc-h">本环节检验单 · ' + esc(r0.type || '') + ' ' + esc(r0.matCode || '') + '</div>';
          h += '<table class="biz-doc-t"><tbody>';
          [['物料名称', r0.matName], ['供应商', r0.supplier], ['批次号', r0.batch], ['数量', r0.qty],
           ['实测记录', r0.measured], ['检验人', r0.inspector], ['检验日期', r0.date],
           ['判定结果', r0.result], ['状态', r0.status]].forEach(function (kv) {
            if (kv[1] === '' || kv[1] == null) return;
            h += '<tr><th>' + esc(kv[0]) + '</th><td>' + esc(String(kv[1])) + '</td></tr>';
          });
          h += '</tbody></table></div>';
        }
      } catch (e) {}
    }
    /* 已完成环节（谁、什么时候、什么结论、什么意见） */
    if ((f.done || []).length) {
      h += '<div class="biz-doc"><div class="biz-doc-h">已完成环节·审批记录</div>';
      h += '<table class="biz-doc-t"><tbody>';
      (f.done || []).forEach(function (d) {
        var line = esc(d.result || '通过') + ' · ' + esc(d.by || '') + ' · ' + esc(d.time || '');
        if (d.remark) line += ' · 意见：' + esc(d.remark);
        h += '<tr><th>' + esc(d.name || nodeNameById(d.node)) + '</th><td>' + line + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    if (sameAsSrc) h += '<div class="biz-doc-none-note">（本环节单据即上方原始单据，不再重复列出）</div>';
    if (!h) h = '<div class="biz-doc-none">本环节暂无可展示的单据内容</div>';
    return '<div class="biz-docbox">' + h + '</div>';
  }

  /* ---- 站点徽章：第 N/M 站 · 环节名【部门】---- */
  function stationBar(f, big) {
    var st = B.station ? B.station(f) : null;
    if (!st || !st.cur) return '';
    var h = '<div class="biz-station">';
    h += '<span class="biz-station-no">第 ' + st.at + '<span style="opacity:.55">/' + st.total + '</span> 站</span>';
    if (st.dept) h += '<span class="biz-station-dept">' + esc(st.dept) + '</span>';
    h += '<div class="biz-station-name">' + esc(st.icon) + ' ' + esc(st.name) + '</div>';
    h += '</div>';
    return h;
  }

  /* 下一站提示 */
  function nextBar(f) {
    var st = B.station ? B.station(f) : null;
    if (!st || !st.cur) return '';
    if (f.status === '已完成') return '<div class="biz-next done">✔ 全程 ' + st.total + ' 站已走完</div>';
    if (f.status === '已关闭') return '<div class="biz-next rej">✕ 流程已关闭</div>';
    if (f.status === '已驳回') return '<div class="biz-next rej">↩ 已被驳回，退回处理</div>';
    if (!st.next) return '<div class="biz-next done">✔ 这是最后一站</div>';
    return '<div class="biz-next">➡ 通过后流转到 <b>' + esc(st.next.name) + '</b>【' + esc(st.next.dept) + '】</div>';
  }

  /* 这里只做总览，实际操作去对应模块办 */
  function gotoModuleBtn(f) {
    var mid = '';
    try { if (window.moduleOfFlow) mid = window.moduleOfFlow(f) || ''; } catch (e) {}
    var nm = '';
    try { if (mid && window.moduleName) nm = window.moduleName(mid); } catch (e) {}
    if (!mid) return '<span class="erp-btn primary" onclick="BIZFLOW.approve(\'' + f.id + '\', true)">✓ 通过并流转</span>';
    return '<span class="erp-btn primary" onclick="window.gotoModuleTodo(\'' + mid + '\')">→ 去【'
      + esc(nm) + '】模块办理</span>';
  }

  /* ---- 我的待办 ---- */
  function mrbSummaryHtml(m) {
    if (!m.reviewers || !m.reviewers.length) return '<div class="mrb-none">尚未指定会签人员</div>';
    var h = '<div class="mrb-tbwrap"><table class="mrb-sum"><thead><tr>'
      + '<th>部门</th><th>会签人</th><th>建议处置</th><th>评审意见</th><th>提交时间</th><th>状态</th>'
      + '</tr></thead><tbody>';
    m.reviewers.forEach(function (r) {
      h += '<tr>'
        + '<td>' + esc(r.dept || '—') + '</td>'
        + '<td>' + esc(r.user) + '</td>'
        + '<td>' + esc((r.advice || []).join('／') || '—') + '</td>'
        + '<td class="mrb-op">' + esc(r.opinion || '—') + '</td>'
        + '<td>' + esc(r.time || '—') + '</td>'
        + '<td>' + (r.status === 'done' ? '<span class="mrb-ok">已提交</span>' : '<span class="mrb-wait">待提交</span>') + '</td>'
        + '</tr>';
    });
    h += '</tbody></table></div>';
    if (m.stage === 'concluded') {
      h += '<div class="mrb-final">最终结论：<b>' + esc(m.conclusion) + '</b>　去向：<b>' + esc(m.dest) + '</b>'
        + '<br>定稿人：' + esc(m.conclusionBy) + '　定稿时间：' + esc(m.conclusionTime)
        + (m.conclusionRemark ? '<br>结论备注：' + esc(m.conclusionRemark) : '')
        + '<br><span class="mrb-lock">已定稿锁定 · 不可更改</span></div>';
    }
    return h;
  }
  function mrbInfoHtml(m) {
    var p = B.mrbProgress(m);
    return '<div class="mrb-info">'
      + '<div class="mrb-info-r"><span>评审单号</span><b>' + esc(m.no) + '</b></div>'
      + '<div class="mrb-info-r"><span>触发环节</span><b>' + esc(m.nodeName || '—') + '</b></div>'
      + '<div class="mrb-info-r"><span>物料类型</span><b>' + esc(m.kindName || '—') + '</b></div>'
      + '<div class="mrb-info-r"><span>物料</span><b>' + esc(m.materialName || m.material || '—') + '</b></div>'
      + '<div class="mrb-info-r"><span>批次 / 数量</span><b>' + esc(m.batch || '—') + ' / ' + esc(m.qty || '—') + '</b></div>'
      + (m.supplier ? '<div class="mrb-info-r"><span>供应商</span><b>' + esc(m.supplier) + '</b></div>' : '')
      + '<div class="mrb-info-r"><span>发起</span><b>' + esc(m.by) + ' · ' + esc(m.time) + '</b></div>'
      + '<div class="mrb-info-r"><span>会签进度</span><b>' + p.done + ' / ' + p.total + '</b></div>'
      + (m.desc ? '<div class="mrb-desc">问题描述：' + esc(m.desc) + '</div>' : '')
      + '</div>';
  }
  function renderTodo(apprList, mrbObj) {
    var mrbMine = (mrbObj && mrbObj.mine) || [];
    var mrbConcl = (mrbObj && mrbObj.toConcl) || [];
    var mrbDone = (mrbObj && mrbObj.done) || [];
    var h = '<div class="biz-section">';
    h += '<div class="biz-sec-title">📌 我的待办<span style="font-size:12px;font-weight:400;color:#9ca3af;margin-left:8px">'
       + '这里只做总览，办理请进对应模块</span></div>';
    if (!apprList.length && !mrbMine.length && !mrbConcl.length && !mrbDone.length) {
      h += '<div class="biz-empty">暂无待办事项</div></div>';
      return h;
    }
    /* ① 待审批 */
    apprList.forEach(function (f) {
      var nd = B.curNode(f);
      h += '<div class="biz-todo appr"><div class="biz-todo-t">【待审批】' + esc(f.no) + ' · ' + esc(f.title) + '</div>'
        + stationBar(f, true)
        + '<div class="biz-todo-s">提交人：' + esc(f._submitBy || '') + ' · 审批人：' + esc(f.approver || '') + '</div>'
        + nextBar(f)
        + docBlock(f)
        + '<div class="biz-todo-a">'
        + gotoModuleBtn(f)
        + '<span class="erp-btn" onclick="BIZFLOW_UI.detail(\'' + f.id + '\')">查看详情</span>'
        + '</div></div>';
    });
    /* ② 待我会签 */
    mrbMine.forEach(function (it) {
      var m = it.m, rv = it.rv, p = B.mrbProgress(m);
      h += '<div class="biz-todo mrb"><div class="biz-todo-t">【待我会签】' + esc(m.no) + ' · ' + esc(m.nodeName || '不合格评审') + '</div>'
        + '<div class="biz-todo-s">' + esc(m.kindName) + ' · ' + esc(m.materialName || m.material || '—')
        + ' · 批次 ' + esc(m.batch || '—') + ' · 数量 ' + esc(m.qty || '—') + '</div>'
        + '<div class="biz-todo-s">发起：' + esc(m.by) + ' · ' + esc(m.time) + ' · 会签进度 <b>' + p.done + '/' + p.total + '</b></div>'
        + (m.desc ? '<div class="mrb-desc">问题描述：' + esc(m.desc) + '</div>' : '')
        + '<div class="biz-todo-a">'
        + '<span class="erp-btn primary" onclick="BIZFLOW_UI.mrbReview(\'' + m.id + '\',\'' + rv.id + '\')">✍ 填写评审意见</span>'
        + '<span class="erp-btn" onclick="BIZFLOW_UI.mrbDetail(\'' + m.id + '\')">详情</span>'
        + '</div></div>';
    });
    /* ③ 待定稿 */
    mrbConcl.forEach(function (m) {
      var p = B.mrbProgress(m);
      h += '<div class="biz-todo mrb concl"><div class="biz-todo-t">【待定稿】' + esc(m.no) + ' · ' + esc(m.nodeName || '不合格评审') + '</div>'
        + '<div class="biz-todo-s">' + esc(m.kindName) + ' · ' + esc(m.materialName || m.material || '—')
        + ' · 会签进度 <b>' + p.done + '/' + p.total + '</b>'
        + (p.total === 0 ? '（尚未指定会签人）' : (p.all ? '（意见已收齐）' : '（还有 ' + (p.total - p.done) + ' 人未提交）')) + '</div>'
        + mrbSummaryHtml(m)
        + '<div class="biz-todo-a">'
        + '<span class="erp-btn primary" onclick="BIZFLOW_UI.mrbConcludeDlg(\'' + m.id + '\')">✔ 确认结论并定稿</span>'
        + '<span class="erp-btn" onclick="BIZFLOW_UI.mrbEditRvl(\'' + m.id + '\')">＋ 调整会签人</span>'
        + '<span class="erp-btn" onclick="BIZFLOW_UI.mrbDetail(\'' + m.id + '\')">详情</span>'
        + '</div></div>';
    });
    /* ④ 已定稿留痕 */
    mrbDone.forEach(function (m) {
      h += '<div class="biz-todo mrb done"><div class="biz-todo-t">【已定稿·留痕】' + esc(m.no) + ' · 结论 ' + esc(m.conclusion) + '</div>'
        + '<div class="biz-todo-s">' + esc(m.kindName) + ' · ' + esc(m.materialName || m.material || '—')
        + ' · 去向 <b>' + esc(m.dest) + '</b></div>'
        + mrbSummaryHtml(m)
        + '<div class="biz-todo-a"><span class="erp-btn" onclick="BIZFLOW_UI.mrbDetail(\'' + m.id + '\')">查看留痕</span></div></div>';
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
      + '<th>流程号</th><th>类型</th><th>标题</th><th>产品</th><th>数量</th><th>当前环节 → 下一站</th><th>状态</th><th>操作</th>'
      + '</tr></thead><tbody>';
    flows.slice().reverse().forEach(function (f) {
      var nd = B.curNode(f);
      var kind = f.kind === 'after' ? '售后翻新' : '正常生产';
      h += '<tr><td>' + esc(f.no) + '</td><td>' + kind + '</td><td>' + esc(f.title) + '</td>'
        + '<td>' + esc(f.product || '-') + '</td><td>' + esc(f.planQty || '-') + '</td>'
        + '<td class="biz-td-station">' + stationBar(f) + nextCell(f) + '</td>'
        + '<td><span class="biz-st ' + (f.status === '待审批' ? 'appr' : f.status === '待评审' ? 'mrb' : f.status === '已完成' ? 'done' : 'run') + '">' + f.status + '</span></td>'
        + '<td class="biz-ops">'
        + '<span class="erp-op" onclick="BIZFLOW_UI.detail(\'' + f.id + '\')">详情</span>';
      if (f.status === B.FLOW_STATUS.RUN) {
        var _mid3 = '';
        try { if (window.moduleOfFlow) _mid3 = window.moduleOfFlow(f) || ''; } catch (e) {}
        if (_mid3) {
          h += '<span class="erp-op" onclick="window.gotoModuleTodo(\'' + _mid3 + '\')">去本模块办理</span>';
        } else {
          var nd2 = B.curNode(f);
          if (nd2 && nd2.branch) {
            h += '<span class="erp-op" onclick="BIZFLOW_UI.submitDlg(\'' + f.id + '\')">提交检验</span>';
          } else {
            h += '<span class="erp-op" onclick="BIZFLOW.submit(\'' + f.id + '\')">提交审批</span>';
          }
        }
      }
      h += '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  /* 列表里紧凑的下一站：只写「→ 名字【部门】」 */
  function nextCell(f) {
    var st = B.station ? B.station(f) : null;
    if (!st || !st.cur) return '';
    if (f.status === '已完成') return '<div class="biz-cell-next done">✔ 已走完 ' + st.total + ' 站</div>';
    if (f.status === '已关闭') return '<div class="biz-cell-next rej">✕ 已关闭</div>';
    if (f.status === '已驳回') return '<div class="biz-cell-next rej">↩ 已驳回</div>';
    if (!st.next) return '<div class="biz-cell-next done">✔ 最后一站</div>';
    return '<div class="biz-cell-next">→ ' + esc(st.next.name) + '【' + esc(st.next.dept) + '】</div>';
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
      + ' ｜ 状态：<b>' + f.status + '</b>'
      + '</div>'
      + '<div class="biz-detail-station">' + stationBar(f, true) + nextBar(f) + '</div>';
    if (f.status === B.FLOW_STATUS.RUN && nd) {
      h += '<div class="biz-detail-actions">';
      if (nd.branch) h += '<span class="erp-btn primary" onclick="BIZFLOW_UI.submitDlg(\'' + f.id + '\')">提交检验结果</span>';
      else h += '<span class="erp-btn primary" onclick="BIZFLOW.submit(\'' + f.id + '\')">提交审批</span>';
      h += '</div>';
    }
    /* 要审批/要看的内容：原始单据 + 本环节单据 + 审批记录 */
    h += '<div class="biz-sec-title" style="margin-top:14px">📄 单据内容（审的就是这些）</div>';
    h += docBlock(f);
    /* 环节时间线 */
    h += '<div class="biz-sec-title" style="margin-top:14px">🕒 环节进度</div>';
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
  /* ==================== 不合格评审（MRB）交互 ==================== */
  function mrbModal(title, bodyHtml, footHtml) {
    mrbClose();
    var d = document.createElement('div');
    d.id = 'mrbModal';
    d.className = 'mrb-mask';
    d.innerHTML = '<div class="mrb-dlg">'
      + '<div class="mrb-dlg-h"><b>' + esc(title) + '</b><span class="mrb-x" onclick="BIZFLOW_UI.mrbClose()">✕</span></div>'
      + '<div class="mrb-dlg-b">' + bodyHtml + '</div>'
      + '<div class="mrb-dlg-f">' + footHtml + '</div>'
      + '</div>';
    document.body.appendChild(d);
    var b = d.querySelector('.mrb-dlg-b'); if (b) b.scrollTop = 0;
  }
  function mrbClose() {
    var m = document.getElementById('mrbModal');
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }
  function rvChecked() {
    var out = [], cs = document.querySelectorAll('#mrbModal input.mrb-a'), i;
    for (i = 0; i < cs.length; i++) if (cs[i].checked) out.push(cs[i].value);
    return out;
  }
  function rvRadio() {
    var out = '', cs = document.querySelectorAll('#mrbModal input.mrb-c'), i;
    for (i = 0; i < cs.length; i++) if (cs[i].checked) out = cs[i].value;
    return out;
  }
  /* 评审人填写意见 */
  function mrbReview(mrbId, rvId) {
    var m = B.mrbGet(mrbId); if (!m) { toast('评审单不存在', false); return; }
    var rv = null;
    m.reviewers.forEach(function (r) { if (r.id === rvId) rv = r; });
    if (!rv) { toast('未找到你的会签记录', false); return; }
    if (rv.status === 'done') {
      mrbModal('不合格评审 · 我的意见（已提交）',
        mrbInfoHtml(m) + mrbSummaryHtml(m),
        '<span class="erp-btn" onclick="BIZFLOW_UI.mrbClose()">关闭</span>');
      return;
    }
    var body = mrbInfoHtml(m)
      + '<div class="mrb-lb">我的建议处置（可多选，必选至少一项）</div><div class="mrb-adv">';
    B.MRB_OPTIONS.forEach(function (op) {
      body += '<label class="mrb-ck"><input type="checkbox" class="mrb-a" value="' + esc(op) + '">' + esc(op) + '</label>';
    });
    body += '</div>'
      + '<div class="mrb-lb">评审意见（提交后锁定，不可更改）</div>'
      + '<textarea id="mrbOpinion" class="mrb-ta" placeholder="写清判断依据与处置建议，例如：外观不良 3pcs，建议挑选使用并加严抽检"></textarea>'
      + '<div class="mrb-note">提交后本记录会永久留痕（含你的姓名、部门、意见、时间），任何人不含你自己都不能再修改。</div>';
    var foot = '<span class="erp-btn" onclick="BIZFLOW_UI.mrbClose()">取消</span>'
      + '<span class="erp-btn primary" onclick="BIZFLOW_UI.mrbReviewSave(\'' + m.id + '\',\'' + rv.id + '\')">提交意见（锁定）</span>';
    mrbModal('不合格评审 · 填写我的意见', body, foot);
  }
  function mrbReviewSave(mrbId, rvId) {
    var op = (document.getElementById('mrbOpinion') || {}).value || '';
    if (B.mrbSubmitReview(mrbId, rvId, rvChecked(), op)) {
      mrbClose();
      toast('意见已提交并留痕，不可更改', true);
      renderHome();
    }
  }
  /* 发起人定稿 */
  function mrbConcludeDlg(mrbId) {
    var m = B.mrbGet(mrbId); if (!m) { toast('评审单不存在', false); return; }
    if (m.stage === 'concluded') { mrbDetail(mrbId); return; }
    var p = B.mrbProgress(m);
    var body = mrbInfoHtml(m) + mrbSummaryHtml(m);
    if (p.total === 0) body += '<div class="mrb-warn">尚未指定会签人，请先「调整会签人」再定稿；也可以直接定稿（快速评审）。</div>';
    else if (!p.all) body += '<div class="mrb-warn">还有 ' + (p.total - p.done) + ' 位会签人未提交意见。意见收齐后才能定稿。</div>';
    body += '<div class="mrb-lb">最终结论（单选，定稿后不可更改）</div><div class="mrb-adv">';
    B.MRB_OPTIONS.forEach(function (op, i) {
      body += '<label class="mrb-ck"><input type="radio" name="mrbC" class="mrb-c" value="' + esc(op) + '"'
        + (i === 0 ? '' : '') + ' onchange="BIZFLOW_UI.mrbDestTip(\'' + m.id + '\')">' + esc(op) + '</label>';
    });
    body += '</div>'
      + '<div class="mrb-lb">结论备注（可选）</div>'
      + '<textarea id="mrbRemark" class="mrb-ta" placeholder="例如：经四部门会签，同意挑选使用，加严抽检一批"></textarea>'
      + '<div class="mrb-lb">定稿后物料去向（按类型自动判定）</div>'
      + '<div id="mrbDestTip" class="mrb-tip">选择结论后显示（当前物料类型：' + esc(m.kindName) + '）</div>';
    var foot = '<span class="erp-btn" onclick="BIZFLOW_UI.mrbClose()">取消</span>'
      + '<span class="erp-btn primary" onclick="BIZFLOW_UI.mrbConcludeSave(\'' + m.id + '\')">✔ 定稿并自动流转</span>';
    mrbModal('不合格评审 · 确认最终结论', body, foot);
  }
  function mrbDestTip(mrbId) {
    var m = B.mrbGet(mrbId); if (!m) return;
    var c = rvRadio();
    var el = document.getElementById('mrbDestTip');
    if (!el) return;
    if (!c) { el.textContent = '选择结论后显示（当前物料类型：' + m.kindName + '）'; return; }
    var dest = B.mrbDestOf(m.kind, c);
    el.innerHTML = '<b>' + esc(m.kindName) + '</b> → <b class="mrb-dest">' + esc(dest) + '</b>'
      + '（定稿后自动通知 ' + esc(B.mrbDestDept(dest)) + ' 接收处理）';
  }
  function mrbConcludeSave(mrbId) {
    var c = rvRadio();
    var rm = (document.getElementById('mrbRemark') || {}).value || '';
    if (!c) { toast('请选择最终结论', false); return; }
    var m = B.mrbGet(mrbId);
    var p = m ? B.mrbProgress(m) : null;
    var force = !!(p && (p.total === 0 || p.all));
    if (p && p.total > 0 && !p.all) { toast('还有 ' + (p.total - p.done) + ' 位会签人未提交意见', false); return; }
    if (B.mrbConclude(mrbId, c, rm, force)) {
      mrbClose();
      toast('已定稿：' + c + '，已通知 ' + (B.mrbDestDept(B.mrbDestOf((m || {}).kind, c))) + ' 接收', true);
      renderHome();
    }
  }
  /* 调整会签人 */
  function mrbEditRvl(mrbId) {
    var m = B.mrbGet(mrbId); if (!m) { toast('评审单不存在', false); return; }
    if (m.stage === 'concluded') { toast('已定稿，不可调整', false); return; }
    var body = mrbInfoHtml(m) + '<div class="mrb-lb">当前会签人</div>' + mrbSumEditable(m)
      + '<div class="mrb-tip">会签人操作路径：进【异常处理】模块 → 待我处理 → 点「填写评审意见」提交（提交后锁定留痕）。名单内的人会收到站内提醒。</div>';
    var add = mrbAddable(m);
    body += '<div class="mrb-lb">添加会签人（按部门选人）</div>';
    if (add.count > 0) {
      body += '<div class="mrb-addrow"><select id="mrbAddUser" class="mrb-sel">' + mrbUserOptions(m) + '</select>'
        + '<span class="erp-btn" onclick="BIZFLOW_UI.mrbAddRv(\'' + m.id + '\')">＋ 加入</span></div>';
    } else {
      body += '<div class="mrb-warn">暂无可加入的人员：'
        + (add.total === 0
          ? '账号库里还没有带部门的人员账号。请先到账号后台添加人员并填好所属部门，再回到这里加入会签。'
          : '账号库里的 ' + add.total + ' 人已全部在本评审名单中。如需增加会签人，请先到账号后台添加对应部门的人员账号。')
        + '</div>';
    }
    var p = B.mrbProgress(m);
    body += p.all && p.total > 0 ? '<div class="mrb-note">✓ 会签意见已收齐，可回到列表确认结论定稿。</div>'
      : '<div class="mrb-note">已提交意见的人不可移除（留痕要求）。</div>';
    var foot = '<span class="erp-btn" onclick="BIZFLOW_UI.mrbClose()">关闭</span>'
      + '<span class="erp-btn primary" onclick="BIZFLOW_UI.mrbConcludeDlg(\'' + m.id + '\')">下一步：确认结论</span>';
    mrbModal('不合格评审 · 调整会签人', body, foot);
  }
  function mrbSumEditable(m) {
    if (!m.reviewers.length) return '<div class="mrb-none">尚未指定会签人员</div>';
    var h = '<div class="mrb-tbwrap"><table class="mrb-sum"><thead><tr>'
      + '<th>部门</th><th>会签人</th><th>状态</th><th>操作</th></tr></thead><tbody>';
    m.reviewers.forEach(function (r) {
      h += '<tr><td>' + esc(r.dept || '—') + '</td><td>' + esc(r.user) + '</td>'
        + '<td>' + (r.status === 'done' ? '<span class="mrb-ok">已提交</span>' : '<span class="mrb-wait">待提交</span>') + '</td>'
        + '<td>' + (r.status === 'done'
          ? '<span class="mrb-lk">已锁定</span>'
          : '<span class="mrb-del" onclick="BIZFLOW_UI.mrbDelRv(\'' + m.id + '\',\'' + r.id + '\')">移除</span>')
        + '</td></tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }
  /* 可加入会签的人 = 账号库的人 减去 已在名单的人；空态要能说清原因 */
  function mrbAddable(m) {
    var accs = B.mrbAccounts(), inSet = {}, byDept = {}, order = [], cnt = 0;
    m.reviewers.forEach(function (r) { if (r.username) inSet[r.username] = true; });
    accs.forEach(function (u) {
      if (inSet[u.username]) return;
      var dp = u.department || '未分配部门';
      if (!byDept[dp]) { byDept[dp] = []; order.push(dp); }
      byDept[dp].push(u); cnt++;
    });
    return { byDept: byDept, order: order, count: cnt, total: accs.length };
  }
  function mrbUserOptions(m) {
    var a = mrbAddable(m);
    var h = '<option value="">请选择人员</option>';
    a.order.forEach(function (dp) {
      h += '<optgroup label="' + esc(dp) + '">';
      a.byDept[dp].forEach(function (u) {
        var role = u.role === 'manager' ? '（主管）' : (u.role === 'admin' ? '（管理员）' : '');
        h += '<option value="' + esc(u.username) + '">' + esc((u.realname || u.username) + role + ' · ' + (u.post || '') + ' · ' + dp) + '</option>';
      });
      h += '</optgroup>';
    });
    return h;
  }
  function mrbAddRv(mrbId) {
    var sel = document.getElementById('mrbAddUser');
    var v = sel ? sel.value : '';
    if (!v) { toast('请选择要加入的人员', false); return; }
    if (B.mrbAddReviewer(mrbId, v)) { toast('已加入会签名单并通知本人', true); mrbEditRvl(mrbId); }
  }
  function mrbDelRv(mrbId, rid) {
    if (B.mrbDelReviewer(mrbId, rid)) { toast('已移除', true); mrbEditRvl(mrbId); }
  }
  /* 留痕详情（只读） */
  function mrbDetail(mrbId) {
    var m = B.mrbGet(mrbId); if (!m) { toast('评审单不存在', false); return; }
    var locked = m.stage === 'concluded';
    var body = mrbInfoHtml(m) + mrbSummaryHtml(m)
      + '<div class="mrb-note">' + (locked ? '本评审已定稿并锁定，以下记录永久留痕、不可更改。'
        : '本评审进行中，已提交的意见立即锁定、不可更改。') + '</div>';
    var foot = '<span class="erp-btn" onclick="BIZFLOW_UI.mrbClose()">关闭</span>';
    if (m.flowId) foot += '<span class="erp-btn" onclick="BIZFLOW_UI.detail(\'' + m.flowId + '\')">查看流程</span>';
    mrbModal('不合格评审 · ' + m.no, body, foot);
  }

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
    var n = f.filter(function (x) {
      return (x.status === B.FLOW_STATUS.APPR && B.canApprove(x)) || (x.status === B.FLOW_STATUS.MRB && B.canMrb());
    }).length;
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
    mrbModal: mrbModal, mrbClose: mrbClose, mrbReview: mrbReview, mrbReviewSave: mrbReviewSave,
    mrbConcludeDlg: mrbConcludeDlg, mrbConcludeSave: mrbConcludeSave, mrbDestTip: mrbDestTip,
    mrbEditRvl: mrbEditRvl, mrbAddRv: mrbAddRv, mrbDelRv: mrbDelRv, mrbDetail: mrbDetail,
    mrbAddable: mrbAddable,
    openHome: openHome, openStart: openStart, openNotices: openNotices,
    detail: detail, submitDlg: submitDlg, help: help, goInsp: goInsp, goMrb: goMrb,
    updateBadge: updateBadge, injectBiz: injectBiz
  };

  /* 审批内容展示样式 */
  (function () {
    if (document.getElementById('bizDocStyle')) return;
    var st = document.createElement('style');
    st.id = 'bizDocStyle';
    st.textContent = [
      '.biz-docbox{margin:10px 0 2px}',
      '.biz-doc{border:1px solid #e3ece6;border-radius:8px;padding:10px 12px;background:#fbfdfb;margin-top:8px}',
      '.biz-doc-h{font-weight:600;color:#1f5a38;margin-bottom:8px;font-size:13px}',
      '.biz-doc-t{width:100%;border-collapse:collapse;font-size:13px}',
      '.biz-doc-t th{text-align:left;width:112px;color:#6b7280;font-weight:500;padding:3px 8px 3px 0;vertical-align:top;white-space:nowrap}',
      '.biz-doc-t td{padding:3px 0;color:#111827;word-break:break-word}',
      '.biz-doc-sub{margin:10px 0 6px;font-size:13px;color:#374151;font-weight:600}',
      '.biz-doc-items th,.biz-doc-items td{white-space:nowrap}',
      '.biz-doc-none,.biz-doc-none-note{font-size:12px;color:#9ca3af}',
      '.biz-todo-t{word-break:break-word}',
      '.biz-station{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:7px 0 2px}',
      '.biz-station-no{flex:0 0 auto;background:#166534;color:#fff;border-radius:999px;padding:3px 11px;font-size:12px;font-weight:700;letter-spacing:.3px}',
      '.biz-station-dept{flex:0 0 auto;background:#dcfce7;color:#166534;border:1px solid #bbf7d0;border-radius:5px;padding:2px 9px;font-size:12px}',
      '.biz-station-name{flex:1 0 100%;font-size:22px;font-weight:800;color:#14532d;line-height:1.25;margin-top:6px}',
      '.biz-next{margin:5px 0 2px;font-size:13px;color:#374151;background:#f0fdf4;border-left:3px solid #22c55e;border-radius:0 6px 6px 0;padding:6px 10px}',
      '.biz-next.done{color:#166534;background:#f0fdf4;border-left-color:#16a34a}',
      '.biz-next.rej{color:#b91c1c;background:#fef2f2;border-left-color:#dc2626}',
      '.biz-cell-next{margin-top:3px;font-size:12px;color:#6b7280;white-space:nowrap}',
      '.biz-cell-next.done{color:#16a34a}',
      '.biz-cell-next.rej{color:#dc2626}',
      '.biz-td-station{min-width:170px}',
      '.biz-detail-station{margin:10px 0 4px;padding:10px 12px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px}',
      '@media(max-width:560px){',
      '.biz-doc{padding:9px 10px}',
      '.biz-doc-t th{width:84px;font-size:12px}',
      '.biz-doc-t td{font-size:12px}',
      '.biz-docbox .biz-tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch}',
      '}'
    ].join('');
    document.head.appendChild(st);
  })();

})();

/* ===== 不合格评审（MRB）会签界面：样式注入 ===== */
(function () {
  if (document.getElementById('mrbStyle')) return;
  var st = document.createElement('style');
  st.id = 'mrbStyle';
  st.textContent = `/* ===== 不合格评审（MRB）会签界面 ===== */
.mrb-mask{position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(15,23,42,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px}
.mrb-dlg{background:#fff;border-radius:12px;width:100%;max-width:860px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.28)}
.mrb-dlg-h{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:15px;color:#111827}
.mrb-x{cursor:pointer;color:#9ca3af;font-size:16px;padding:0 4px}
.mrb-x:hover{color:#374151}
.mrb-dlg-b{padding:16px 18px;overflow-y:auto;flex:1}
.mrb-dlg-f{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid #e5e7eb}
.mrb-info{background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin-bottom:12px}
.mrb-info-r{display:flex;gap:8px;font-size:13px;line-height:1.9;color:#374151}
.mrb-info-r>span{flex:0 0 84px;color:#6b7280}
.mrb-info-r>b{flex:1;color:#111827;font-weight:600;word-break:break-all}
.mrb-desc{margin-top:6px;padding:8px 10px;background:#fff7ed;border-left:3px solid #f59e0b;border-radius:4px;font-size:13px;color:#7c2d12;line-height:1.7}
.mrb-lb{font-size:13px;font-weight:600;color:#374151;margin:14px 0 8px}
.mrb-adv{display:flex;flex-wrap:wrap;gap:8px}
.mrb-ck{display:flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid #d1d5db;border-radius:20px;font-size:13px;cursor:pointer;color:#374151;background:#fff}
.mrb-ck:hover{border-color:#16a34a;background:#f0fdf4}
.mrb-ck input{margin:0}
.mrb-ta{width:100%;min-height:88px;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:10px;font-size:13px;line-height:1.7;resize:vertical;font-family:inherit}
.mrb-ta:focus{outline:none;border-color:#16a34a;box-shadow:0 0 0 3px rgba(22,163,74,.12)}
.mrb-note{margin-top:10px;font-size:12px;color:#6b7280;line-height:1.7;background:#f3f4f6;border-radius:6px;padding:8px 10px}
.mrb-warn{margin:10px 0;font-size:13px;color:#92400e;background:#fef3c7;border-radius:6px;padding:9px 11px;line-height:1.7}
.mrb-tip{margin-top:6px;font-size:13px;color:#374151;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;padding:9px 11px;line-height:1.7}
.mrb-dest{color:#15803d}
.mrb-tbwrap{overflow-x:auto;border:1px solid #e5e7eb;border-radius:8px}
.mrb-sum{width:100%;border-collapse:collapse;font-size:12.5px;min-width:640px}
.mrb-sum th{background:#f0fdf4;color:#166534;font-weight:600;text-align:left;padding:8px 10px;border-bottom:1px solid #dcfce7;white-space:nowrap}
.mrb-sum td{padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#374151;vertical-align:top}
.mrb-sum tr:last-child td{border-bottom:none}
.mrb-op{min-width:180px;line-height:1.65;word-break:break-word}
.mrb-ok{color:#15803d;font-weight:600;white-space:nowrap}
.mrb-wait{color:#b45309;white-space:nowrap}
.mrb-lk{color:#9ca3af;white-space:nowrap}
.mrb-del{color:#dc2626;cursor:pointer;white-space:nowrap}
.mrb-del:hover{text-decoration:underline}
.mrb-none{font-size:13px;color:#9ca3af;padding:10px;background:#f9fafb;border-radius:6px}
.mrb-final{margin-top:10px;padding:10px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;font-size:13px;color:#14532d;line-height:1.85}
.mrb-lock{display:inline-block;margin-top:4px;font-size:12px;color:#15803d;background:#d1fae5;border-radius:4px;padding:2px 8px}
.mrb-addrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mrb-sel{flex:1;min-width:220px;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit;background:#fff}
.biz-todo.concl{border-left:4px solid #f59e0b}
.biz-todo.done{border-left:4px solid #15803d;background:#fafdfb}
@media(max-width:560px){
  .mrb-dlg{max-height:94vh}
  .mrb-info-r>span{flex:0 0 68px}
  .mrb-sum{min-width:520px;font-size:12px}
  .mrb-sum th,.mrb-sum td{padding:6px 8px}
  .mrb-ck{padding:6px 10px;font-size:12.5px}
}
`;
  document.head.appendChild(st);
})();
