/*!
 * gls-flow.js —— 格丽思质量管理工作台 流程引擎（图结构版）
 * 支持：顺序环节 / 条件分支 / 检验判定 / 可选环节 / 评审处理回流 / 自动环节
 * 数据存于 appData.flows，随工作台数据一起持久化在本机浏览器
 */
(function (global) {

  var FLOW_VER = '2';

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

  function stripHtml(s) {
    return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  }

  function toast(msg, type) {
    if (typeof global.showToast === 'function') global.showToast(msg, type || '');
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fmtShort(ts) {
    if (!ts) return '';
    var d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return '今天 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function uid(p) { return (p || 'flow_') + Date.now().toString(36) + Math.random().toString(36).substr(2, 4); }

  /* ==================== 用户 / 账号 ==================== */
  function curUser() {
    try {
      var u = JSON.parse(localStorage.getItem('gls_current_user') || 'null');
      if (u && u.username) return u;
    } catch (e) {}
    return { username: 'admin', role: 'admin', realname: '系统管理员' };
  }

  function getAccounts() {
    try {
      var a = (window.DATAHUB && DATAHUB.get('accounts')) || JSON.parse(localStorage.getItem('gls_accounts') || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }

  function activeAccounts() {
    var list = getAccounts().filter(function (a) { return a && a.status !== 'disabled'; });
    if (!list.length) {
      list = [{ username: curUser().username, realname: curUser().realname || curUser().username, dept: '管理层', role: 'admin' }];
    }
    return list;
  }

  function userLabel(username) {
    if (!username) return '未指派';
    var list = getAccounts();
    for (var i = 0; i < list.length; i++) {
      if (list[i].username === username) {
        return (list[i].realname || list[i].username) + (list[i].dept ? '·' + list[i].dept : '');
      }
    }
    return username;
  }

  function isAdmin() { return curUser().role === 'admin'; }

  /* ==================== 内置流程模板 ==================== */
  // 节点类型：normal 普通环节 / auto 自动环节 / branch 分支判断 / inspect 检验判定 /
  //           optional 可选环节 / review 评审处理 / end 结束
  var TEMPLATES = [
    {
      id: 'tpl_production_main',
      name: '主机生产全流程',
      icon: '🏭',
      desc: '销售订单 → PMC生产计划（自动核对物料齐套）→ 齐套走备料 / 不齐套走采购 → 进料检验 → 物料入库 → 生产备料 → 生产 → 首件 → 正式生产 → 巡检 → 成品 → 成品检验 → 成品入库 → 发货；各检验不合格均转评审处理',
      graph: {
        start: 'so',
        nodes: {
          so: { id: 'so', name: '销售订单', type: 'normal', dept: '业务部', note: '接单评审：数量、交期、特殊要求', next: 'pmc' },
          pmc: { id: 'pmc', name: 'PMC生产计划', type: 'auto', dept: 'PMC', note: '自动核对物料齐套：比对BOM需求与库存/在途，输出齐套结论', next: 'kitting' },
          kitting: { id: 'kitting', name: '物料齐套判断', type: 'branch', dept: 'PMC',
            note: '齐套则直接备料；不齐套转采购',
            options: [{ label: '齐套', to: 'prep' }, { label: '不齐套', to: 'purchase' }] },
          purchase: { id: 'purchase', name: '采购', type: 'normal', dept: '采购部', note: '下达采购订单并跟催交期', next: 'wh_confirm' },
          wh_confirm: { id: 'wh_confirm', name: '物料仓库确认', type: 'normal', dept: '仓储部', note: '到货数量、包装、标识核对', next: 'iqc' },
          iqc: { id: 'iqc', name: '进料检验', type: 'inspect', dept: '品质部', note: '按检验标准抽样判定',
            options: [{ label: '合格', to: 'mat_in' }, { label: '不合格', to: 'review' }] },
          mat_in: { id: 'mat_in', name: '物料入库', type: 'normal', dept: '仓储部', note: '标识、FIFO、防静电/防潮', next: 'prep' },
          prep: { id: 'prep', name: '生产备料', type: 'normal', dept: '仓储部/生产部', note: '按工单发料，核对料号数量', next: 'prod' },
          prod: { id: 'prod', name: '生产', type: 'normal', dept: '生产部', note: '按作业指导书生产，参数点检', next: 'fai' },
          fai: { id: 'fai', name: '首件检验', type: 'inspect', dept: '品质部', note: '首件全项目确认，合格方可批量',
            options: [{ label: '合格', to: 'mass' }, { label: '不合格', to: 'review' }] },
          mass: { id: 'mass', name: '正式生产', type: 'normal', dept: '生产部', note: '批量生产，参数监控', next: 'patrol' },
          patrol: { id: 'patrol', name: '巡检', type: 'optional', dept: '品质部', note: '按岗位/工序设定巡检频次，可跳过',
            options: [{ label: '合格', to: 'fg' }, { label: '批量不合格', to: 'review' }, { label: '跳过巡检', to: 'fg', skip: true }] },
          fg: { id: 'fg', name: '成品', type: 'normal', dept: '生产部', note: '成品下线，待检验', next: 'oqc' },
          oqc: { id: 'oqc', name: '成品检验', type: 'inspect', dept: '品质部', note: '成品抽检+安全项目',
            options: [{ label: '合格', to: 'fg_in' }, { label: '不合格', to: 'review' }] },
          fg_in: { id: 'fg_in', name: '成品入库', type: 'normal', dept: '仓储部', note: '入库上架，记录批次', next: 'ship' },
          ship: { id: 'ship', name: '发货', type: 'end', dept: '仓储部/业务部', note: '按订单发货，出库记录留存' },
          review: { id: 'review', name: '评审处理', type: 'review', dept: '品质部/工程/生产',
            note: '不合格品评审：返工返修 / 让步接收 / 报废退货（由评审结论决定去向）' }
        }
      }
    }
  ];

  function getTemplate(id) {
    for (var i = 0; i < TEMPLATES.length; i++) { if (TEMPLATES[i].id === id) return TEMPLATES[i]; }
    return null;
  }

  /* ==================== 流程数据层 ==================== */
  function getFlows() {
    if (typeof appData === 'undefined' || !appData) return [];
    if (!Array.isArray(appData.flows)) appData.flows = [];
    return appData.flows;
  }

  function saveFlows() {
    try { if (typeof saveData === 'function') saveData(); } catch (e) { console.error(e); }
  }

  function findFlow(id) {
    var arr = getFlows();
    for (var i = 0; i < arr.length; i++) { if (arr[i].id === id) return arr[i]; }
    return null;
  }

  var STATUS_MAP = {
    running: { name: '进行中', cls: 'run' },
    done: { name: '已办结', cls: 'ok' },
    terminated: { name: '已终止', cls: 'stop' }
  };

  /* ---- 图操作 ---- */
  function graphOf(f) { return (f && f.graph && f.graph.nodes) ? f.graph : null; }
  function nodeOf(f, id) { var g = graphOf(f); return (g && g.nodes[id]) ? g.nodes[id] : null; }
  function curNode(f) { return nodeOf(f, f.curId); }

  function isMulti(type) { return type === 'branch' || type === 'inspect' || type === 'optional' || type === 'review'; }

  function nextOf(f, node) {
    if (!node) return null;
    if (node.type === 'review') return null;
    if (node.type === 'branch' || node.type === 'inspect' || node.type === 'optional') {
      var opts = node.options || [];
      for (var i = 0; i < opts.length; i++) { if (!opts[i].skip && opts[i].to !== 'review') return opts[i].to; }
      return null;
    }
    return node.next || null;
  }

  // 主链路线性展开（用于列表页显示进度）
  function mainChain(f) {
    var g = graphOf(f), out = [], seen = {};
    if (!g) return out;
    var id = g.start, guard = 0;
    while (id && !seen[id] && guard++ < 60) {
      seen[id] = 1;
      var n = g.nodes[id];
      if (!n) break;
      out.push(n);
      id = nextOf(f, n);
    }
    return out;
  }

  function totalCount(f) { var g = graphOf(f); return g ? Object.keys(g.nodes).length : 0; }

  function doneCount(f) {
    var v = f.visited || [], n = 0;
    v.forEach(function (x) { if (x) n++; });
    return n;
  }

  function progressPct(f) {
    if (f.status === 'done') return 100;
    var total = totalCount(f);
    if (!total) return 0;
    var visited = (f.visited || []).length;
    return Math.min(96, Math.round((visited / total) * 100));
  }

  /* ---- 权限 / 待办 ---- */
  function canHandle(f) {
    if (!f || f.status !== 'running') return false;
    var u = curUser();
    if (!f.assignee) return true;
    if (f.assignee === u.username) return true;
    return isAdmin();
  }

  function isMyTodo(f) {
    if (!f || f.status !== 'running') return false;
    var u = curUser();
    if (!f.assignee) return true;
    return f.assignee === u.username || isAdmin();
  }

  function countTodo() {
    var n = 0;
    getFlows().forEach(function (f) { if (isMyTodo(f)) n++; });
    return n;
  }

  /* ==================== 兼容旧流程（字符串数组） ==================== */
  function migrate(f) {
    if (!f) return f;
    if (f._mg) return f;
    if (f.graph) {
      if (!f.curId && f.status === 'running') f.curId = f.graph.start;
      f._mg = 1;
      return f;
    }
    var arr = f.nodes || [];
    var nodes = {}, start = null;
    for (var i = 0; i < arr.length; i++) {
      var id = 'm' + i;
      nodes[id] = { id: id, name: String(arr[i]), type: 'normal', next: (i + 1 < arr.length) ? ('m' + (i + 1)) : null };
      if (i === 0) start = id;
    }
    if (!start) { nodes.m0 = { id: 'm0', name: '开始', type: 'normal', next: null }; start = 'm0'; }
    f.graph = { start: start, nodes: nodes };
    f.curId = 'm' + Math.min(f.cur || 0, arr.length - 1);
    f.visited = [];
    for (var j = 0; j <= (f.cur || 0) && j < arr.length; j++) f.visited.push('m' + j);
    f._mg = 1;
    return f;
  }

  function migrateAll() {
    var changed = false;
    getFlows().forEach(function (f) { if (!f._mg) { migrate(f); changed = true; } });
    if (changed) saveFlows();
  }

  /* ---- 从业务卡片解析环节（保留原有能力） ---- */
  var DEFAULT_NODES = {
    suppliers: ['供应商开发', '资质审查', '样品测试', '现场审核', '批准纳入合格名录'],
    incoming: ['报检申请', '抽样检验', '判定', '入库或退货'],
    rd: ['立项申请', '可行性评审', '批准', '开发实施', '验证确认', '归档'],
    production: ['首件申请', '首件检验', '确认', '批量生产'],
    inspection: ['报检', '成品检验', '判定', '入库'],
    shipping: ['出货申请', '出货检验', '审批', '放行'],
    abnormal: ['异常报告', '原因分析', '纠正措施', '措施验证', '结案'],
    risk: ['风险识别', '风险评估', '制定措施', '跟踪验证'],
    documents: ['文件编制', '审核', '批准', '发布'],
    knowledge: ['提出', '审核', '入库'],
    training: ['培训申请', '计划审批', '实施培训', '效果评估', '归档']
  };

  function parseNodes(item, moduleId) {
    var nodes = [];
    var src = (item && item.process) ? String(item.process) : '';
    if (src) {
      var liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi, m;
      while ((m = liRe.exec(src)) !== null) {
        var inner = m[1];
        var bm = inner.match(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/i);
        var name = stripHtml(bm ? bm[1] : inner).replace(/^[\s\d一二三四五六七八九十]+[.、)）]?\s*/, '').trim();
        name = name.replace(/[：:]\s*$/, '').trim();
        if (name) nodes.push(name.slice(0, 26));
      }
    }
    if (!nodes.length) nodes = (DEFAULT_NODES[moduleId] || ['申请', '审核', '批准', '执行', '归档']).slice();
    return nodes;
  }

  function linearGraph(names) {
    var nodes = {}, start = null;
    for (var i = 0; i < names.length; i++) {
      var id = 'k' + i;
      nodes[id] = { id: id, name: names[i], type: 'normal', next: (i + 1 < names.length) ? ('k' + (i + 1)) : null };
      if (i === 0) start = id;
    }
    return { start: start, nodes: nodes };
  }

  function moduleName(id) {
    try {
      var m = MODULES.filter(function (x) { return x.id === id; })[0];
      return m ? m.name : id;
    } catch (e) { return id; }
  }

  function moduleIcon(id) {
    try {
      var m = MODULES.filter(function (x) { return x.id === id; })[0];
      return m ? m.icon : '📋';
    } catch (e) { return '📋'; }
  }

  /* ==================== 导出内部对象 ==================== */
  var API = {
    $: $, escHtml: escHtml, escAttr: escAttr, stripHtml: stripHtml, toast: toast,
    fmtTime: fmtTime, fmtShort: fmtShort, uid: uid, pad2: pad2,
    curUser: curUser, getAccounts: getAccounts, activeAccounts: activeAccounts,
    userLabel: userLabel, isAdmin: isAdmin,
    TEMPLATES: TEMPLATES, getTemplate: getTemplate,
    getFlows: getFlows, saveFlows: saveFlows, findFlow: findFlow, migrateAll: migrateAll,
    STATUS_MAP: STATUS_MAP, graphOf: graphOf, nodeOf: nodeOf, curNode: curNode,
    nextOf: nextOf, mainChain: mainChain, totalCount: totalCount, doneCount: doneCount,
    progressPct: progressPct, canHandle: canHandle, isMyTodo: isMyTodo, countTodo: countTodo,
    parseNodes: parseNodes, linearGraph: linearGraph,
    moduleName: moduleName, moduleIcon: moduleIcon, isMulti: isMulti
  };
  global.GF = API;


  /* ==================== 流程图渲染 ==================== */
  var TYPE_TAG = {
    auto: '<span class="fg-tag auto">自动</span>',
    branch: '<span class="fg-tag branch">分支</span>',
    inspect: '<span class="fg-tag insp">检验判定</span>',
    optional: '<span class="fg-tag opt">可选</span>',
    review: '<span class="fg-tag rev">评审</span>',
    end: '<span class="fg-tag end">结束</span>'
  };

  function renderGraphTree(f) {
    var g = graphOf(f);
    if (!g) return '';
    var visited = f.visited || [];
    var cur = f.curId;
    var seen = {}, num = 0, out = [];

    function classify(n) {
      if (n.id === cur && f.status === 'running') return 'cur';
      if (visited.indexOf(n.id) >= 0) return 'past';
      return 'future';
    }

    function row(n, depth, label) {
      var cls = classify(n);
      var dot = cls === 'past' ? '✓' : (cls === 'cur' ? '●' : '○');
      var idx = seen[n.id] ? ('<span class="fg-idx">' + seen[n.id] + '</span>') : '';
      return '<div class="fg-node ' + cls + '" style="margin-left:' + (depth * 16) + 'px">' +
        (label ? '<span class="fg-lbl">' + escHtml(label) + '</span>' : '') +
        '<span class="fg-dot">' + dot + '</span>' + idx +
        '<span class="fg-name">' + escHtml(n.name) + '</span>' +
        (TYPE_TAG[n.type] || '') +
        (n.dept ? '<span class="fg-dept">' + escHtml(n.dept) + '</span>' : '') +
        (cls === 'cur' ? '<span class="fg-here">当前</span>' : '') +
        '</div>' +
        (n.note && (cls === 'cur' || depth === 0 || n.type === 'review')
          ? '<div class="fg-note" style="margin-left:' + (depth * 16 + 22) + 'px">' + escHtml(n.note) + '</div>' : '');
    }

    function walk(id, depth, label, guard) {
      if (!id || guard > 90) return;
      var n = g.nodes[id];
      if (!n) return;
      if (seen[id]) {
        out.push('<div class="fg-node ref" style="margin-left:' + (depth * 16) + 'px">' +
          (label ? '<span class="fg-lbl">' + escHtml(label) + '</span>' : '') +
          '<span class="fg-ref">↩ 汇聚回「' + escHtml(n.name) + '」</span></div>');
        return;
      }
      seen[id] = ++num;
      out.push(row(n, depth, label));
      if (n.type === 'review') return;
      if (n.options && n.options.length) {
        n.options.forEach(function (o) { walk(o.to, depth + 1, o.label, guard + 1); });
      } else if (n.next) {
        walk(n.next, depth, null, guard + 1);
      }
    }
    walk(g.start, 0, null, 0);
    return out.join('');
  }

  /* ==================== 流程中心（列表页） ==================== */
  var flowFilter = 'todo';

  var FLOW_TABS = [
    { id: 'todo', name: '待我处理' },
    { id: 'mine', name: '我发起的' },
    { id: 'running', name: '进行中' },
    { id: 'done', name: '已办结' },
    { id: 'all', name: '全部流程' }
  ];

  function filterFlows() {
    var u = curUser();
    var out = getFlows().filter(function (f) {
      if (flowFilter === 'todo') return isMyTodo(f);
      if (flowFilter === 'mine') return f.initiator === u.username;
      if (flowFilter === 'running') return f.status === 'running';
      if (flowFilter === 'done') return f.status === 'done' || f.status === 'terminated';
      return true;
    });
    out.sort(function (a, b) { return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0); });
    return out;
  }

  function renderFlowsPage() {
    var statEl = $('flowStats'), tabEl = $('flowTabs'), listEl = $('flowList');
    if (!listEl) return;
    var all = getFlows(), u = curUser();
    var todo = 0, mine = 0, running = 0, done = 0;
    all.forEach(function (f) {
      if (isMyTodo(f)) todo++;
      if (f.initiator === u.username) mine++;
      if (f.status === 'running') running++;
      if (f.status === 'done' || f.status === 'terminated') done++;
    });

    if (statEl) {
      statEl.innerHTML =
        '<div class="fstat' + (flowFilter === 'todo' ? ' on' : '') + '" onclick="setFlowFilter(\'todo\')"><div class="fstat-num warn">' + todo + '</div><div class="fstat-lb">待我处理</div></div>' +
        '<div class="fstat' + (flowFilter === 'mine' ? ' on' : '') + '" onclick="setFlowFilter(\'mine\')"><div class="fstat-num">' + mine + '</div><div class="fstat-lb">我发起的</div></div>' +
        '<div class="fstat' + (flowFilter === 'running' ? ' on' : '') + '" onclick="setFlowFilter(\'running\')"><div class="fstat-num blue">' + running + '</div><div class="fstat-lb">进行中</div></div>' +
        '<div class="fstat' + (flowFilter === 'done' ? ' on' : '') + '" onclick="setFlowFilter(\'done\')"><div class="fstat-num ok">' + done + '</div><div class="fstat-lb">已办结</div></div>';
    }
    if (tabEl) {
      var th = '';
      FLOW_TABS.forEach(function (t) {
        th += '<div class="filter-tab' + (flowFilter === t.id ? ' active' : '') + '" onclick="setFlowFilter(\'' + t.id + '\')">' + t.name + '</div>';
      });
      tabEl.innerHTML = th;
    }

    var list = filterFlows();
    if (!list.length) {
      listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">⚡</div>' +
        '<div class="empty-text">' + (flowFilter === 'todo' ? '暂无待办流程' : '暂无流程记录') + '</div>' +
        '<div style="font-size:12px;color:#bbb;margin-top:8px;">点上方「＋ 发起流程」可发起生产全流程或业务卡片流程</div></div>';
      return;
    }
    var html = '';
    list.forEach(function (f) { html += flowCardHtml(f); });
    listEl.innerHTML = html;
  }

  function flowCardHtml(f) {
    var st = STATUS_MAP[f.status] || STATUS_MAP.running;
    var total = totalCount(f);
    var n = curNode(f);
    var pct = progressPct(f);
    var todo = isMyTodo(f);
    var nodeName = n ? n.name : (f.status === 'done' ? '已办结' : '—');
    var done = (f.visited || []).length;
    var icon = f.templateId ? (getTemplate(f.templateId) ? getTemplate(f.templateId).icon : '⚡') : moduleIcon(f.moduleId);

    return '<div class="flow-card' + (todo ? ' is-todo' : '') + '" onclick="openFlow(\'' + escAttr(f.id) + '\')">' +
      '<div class="fc-top"><span class="fc-icon">' + icon + '</span>' +
        '<span class="fc-title">' + escHtml(f.title) + '</span>' +
        '<span class="fc-badge ' + st.cls + '">' + st.name + '</span></div>' +
      '<div class="fc-mid"><span class="fc-node">当前：' + escHtml(nodeName) + '</span>' +
        '<span class="fc-step">已走 ' + done + '/' + total + ' 节点</span></div>' +
      '<div class="fc-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="fc-bot">' +
        '<span>' + escHtml(f.templateId ? '生产全流程' : moduleName(f.moduleId)) + '</span>' +
        '<span>发起：' + escHtml(userLabel(f.initiator)) + '</span>' +
        '<span>' + fmtShort(f.updatedAt || f.createdAt) + '</span>' +
        (todo ? '<span class="fc-todo">待我处理</span>' : '') +
        (f.priority === 'urgent' ? '<span class="fc-late">紧急</span>' : '') +
      '</div></div>';
  }

  global.setFlowFilter = function (f) { flowFilter = f; renderFlowsPage(); };

  /* ==================== 流程详情 ==================== */
  var curFlowId = null;

  global.openFlow = function (id) {
    var f = findFlow(id);
    if (!f) { toast('未找到该流程', 'error'); return; }
    migrate(f);
    curFlowId = id;
    switchFlowPage('flow', '流程详情');
    renderFlowDetail();
  };

  function renderFlowDetail() {
    var f = findFlow(curFlowId);
    var headEl = $('flowHead'), tlEl = $('flowTimeline'), actEl = $('flowActions');
    if (!f || !headEl) return;
    migrate(f);
    var st = STATUS_MAP[f.status] || STATUS_MAP.running;
    var n = curNode(f);
    var u = curUser();

    headEl.innerHTML =
      '<div class="fh-title">' + escHtml(f.title) + '</div>' +
      '<div class="fh-meta">' +
        '<span class="fc-badge ' + st.cls + '">' + st.name + '</span>' +
        '<span>' + escHtml(f.templateId ? '流程模板' : moduleName(f.moduleId)) + '</span>' +
        '<span>发起人：' + escHtml(userLabel(f.initiator)) + '</span>' +
        '<span>' + fmtTime(f.createdAt) + '</span>' +
        (f.priority === 'urgent' ? '<span class="fc-late">紧急</span>' : '') +
      '</div>' +
      (f.remark ? '<div class="fh-remark">' + escHtml(f.remark) + '</div>' : '') +
      (f.itemId ? '<div class="fh-link" onclick="jumpToItem()">↗ 查看关联业务卡片</div>' : '') +
      (n && f.status === 'running'
        ? '<div class="fh-cur"><span class="fh-cur-dot"></span>当前节点：<b>' + escHtml(n.name) + '</b>' +
          (n.dept ? ' · ' + escHtml(n.dept) : '') + ' · 处理人 ' + escHtml(userLabel(f.assignee)) + '</div>'
        : '');

    // 流程图 + 记录
    var tl = '<div class="ftl-head"><span>流程路径</span><span>已走 ' + doneCount(f) + '/' + totalCount(f) + ' 节点</span></div>';
    tl += '<div class="fg-wrap">' + renderGraphTree(f) + '</div>';
    if ((f.history || []).length) {
      tl += '<div class="frec-head">流转记录</div><div class="frec">';
      f.history.slice().reverse().forEach(function (r) {
        var actName = { submit: '发起', approve: '通过', branch: '选择', review: '评审', reject: '退回', terminate: '终止', comment: '意见', assign: '指派' }[r.action] || r.action;
        var path = (r.fromName ? '「' + r.fromName + '」' : '') + (r.toName ? ' → 「' + r.toName + '」' : '');
        var lbl = r.label ? '【' + r.label + '】' : '';
        tl += '<div class="frec-item"><span class="frec-act ' + r.action + '">' + actName + '</span>' +
          '<span class="frec-txt">' + escHtml(userLabel(r.actor)) + ' · ' + fmtTime(r.at) +
          (path ? ' · ' + escHtml(path) : '') + (lbl ? ' ' + escHtml(lbl) : '') +
          (r.opinion ? '：' + escHtml(r.opinion) : '') + '</span></div>';
      });
      tl += '</div>';
    }
    tlEl.innerHTML = tl;

    // 操作区
    if (f.status !== 'running') {
      actEl.innerHTML = '<div class="fa-done">该流程已' + st.name + '，无待办操作</div>';
      return;
    }
    actEl.innerHTML = renderActions(f, n, u);
  }

  function userSelectHtml(f, selected) {
    var opts = '<option value="">自动 · 指派给该环节部门领导</option>';
    var sel = selected || '';
    activeAccounts().forEach(function (a) {
      opts += '<option value="' + escAttr(a.username) + '"' + (a.username === sel ? ' selected' : '') + '>' +
        escHtml((a.realname || a.username) + (a.dept ? '（' + a.dept + '）' : '')) + '</option>';
    });
    return '<select id="flowNextUser" class="fa-input">' + opts + '</select>';
  }

  function renderActions(f, n, u) {
    if (!n) return '<div class="fa-done">流程节点异常</div>';
    var can = canHandle(f);
    var head = '';
    if (n.note) head += '<div class="fa-note">' + escHtml(n.note) + '</div>';

    var opinionBox =
      '<div class="fa-label">处理意见（可选）</div>' +
      '<textarea id="flowOpinion" class="fa-input" placeholder="填写处理说明 / 审批意见…" rows="2"></textarea>';

    var _ld = leaderOfNode(f, n);
    var nextBox =
      '<div class="fa-row"><div class="fa-col"><div class="fa-label">下一环节处理人' +
      '<span class="fm-tip">留空则自动指派该环节部门领导</span></div>' +
      userSelectHtml(f) + '</div>' +
      '<div class="fa-col"><div class="fa-label">当前节点 / 负责部门</div>' +
      '<div class="fa-static">' + escHtml(n.name) + (n.dept ? ' · ' + escHtml(n.dept) : '') +
      (_ld ? '<div class="fa-ld">部门领导：' + escHtml(userLabel(_ld)) + '</div>' : '') + '</div></div></div>';

    var dis = can ? '' : ' disabled';
    var tip = can ? '' : '<div class="fa-tip">当前节点处理人为 ' + escHtml(userLabel(f.assignee)) + '，你不是该节点处理人，无法操作（超级管理员可代审）</div>';

    // 评审处理节点
    if (n.type === 'review') {
      var ctx = f.reviewCtx || {};
      return head + opinionBox +
        '<div class="fa-label" style="margin-top:12px;">评审结论</div>' +
        '<div class="fa-btns">' +
          '<button class="btn btn-approve"' + dis + ' onclick="flowReview(\'rework\')">↻ 返工返修</button>' +
          '<button class="btn btn-concede"' + dis + ' onclick="flowReview(\'concede\')">⇢ 让步接收</button>' +
          '<button class="btn btn-stop"' + dis + ' onclick="flowReview(\'scrap\')">✕ 报废/退货终止</button>' +
        '</div>' +
        '<div class="fa-tip2">返工返修 → 回到「' + escHtml(ctx.backName || '上一检验环节') + '」重检；' +
        '让步接收 → 继续走合格路径' + (ctx.okName ? '（' + escHtml(ctx.okName) + '）' : '') + '；报废/退货 → 终止流程</div>' +
        tip;
    }

    // 分支 / 检验判定 / 可选节点
    if (n.options && n.options.length) {
      var btns = '';
      n.options.forEach(function (o, i) {
        var cls = 'btn-opt';
        if (o.skip) cls = 'btn-skip';
        else if (/不合格|不齐套|批量不合格/.test(o.label)) cls = 'btn-reject';
        else cls = 'btn-approve';
        btns += '<button class="btn ' + cls + '"' + dis + ' onclick="flowChoose(' + i + ')">' + escHtml(o.label) + '</button>';
      });
      return head + opinionBox +
        '<div class="fa-label" style="margin-top:12px;">选择走向</div>' +
        '<div class="fa-btns">' + btns + '</div>' +
        '<div class="fa-row" style="margin-top:12px;"><div class="fa-col"><div class="fa-label">下一环节处理人' +
        '<span class="fm-tip">留空则自动指派该环节部门领导</span></div>' +
        userSelectHtml(f) + '</div></div>' +
        '<div class="fa-btns" style="margin-top:10px;"><button class="btn btn-plain"' + dis + ' onclick="flowReject()">↩ 退回上一节点</button></div>' +
        tip;
    }

    // 自动节点
    if (n.type === 'auto') {
      return head + opinionBox +
        '<div class="fa-btns"><button class="btn btn-approve"' + dis + ' onclick="flowApprove()">⚙ 执行并流转</button>' +
        '<button class="btn btn-plain"' + dis + ' onclick="flowReject()">↩ 退回上一节点</button>' +
        '<button class="btn btn-stop"' + dis + ' onclick="flowTerminate()">✕ 终止</button></div>' +
        nextBox + tip;
    }

    // 普通节点
    var endInfo = '';
    if (!n.next) endInfo = '<div class="fa-note">该节点为最后节点，通过后流程办结</div>';
    return head + opinionBox +
      '<div class="fa-btns">' +
        '<button class="btn btn-approve"' + dis + ' onclick="flowApprove()">✓ 通过并流转</button>' +
        '<button class="btn btn-plain"' + dis + ' onclick="flowReject()">↩ 退回上一节点</button>' +
        '<button class="btn btn-stop"' + dis + ' onclick="flowTerminate()">✕ 终止</button>' +
      '</div>' + nextBox + endInfo + tip;
  }

  function switchFlowPage(pageId, title) {
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    var el = $('page-' + pageId);
    if (el) el.classList.add('active');
    var t = $('pageTitle'); if (t) t.textContent = title;
    var fab = $('fabAdd'); if (fab) fab.style.display = 'none';
    var sb = $('searchBtn'); if (sb) sb.style.display = 'none';
    document.querySelectorAll('.sidebar .nav-item').forEach(function (x) { x.classList.remove('active'); });
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  global.jumpToItem = function () {
    var f = findFlow(curFlowId);
    if (!f || !f.itemId) return;
    navigateTo('detail', f.moduleId, f.itemId);
  };

  /* ==================== 流转动作 ==================== */
  function pushRec(f, fromNode, toNode, opinion, action, label, actor) {
    f.history = f.history || [];
    f.history.push({
      at: Date.now(), actor: actor || curUser().username, action: action,
      from: fromNode ? fromNode.id : '', fromName: fromNode ? fromNode.name : '',
      to: toNode ? toNode.id : '', toName: toNode ? toNode.name : '',
      label: label || '', opinion: opinion || ''
    });
  }

  function okTargetOf(f, node) {
    if (!node || !node.options) return null;
    for (var i = 0; i < node.options.length; i++) {
      var o = node.options[i];
      if (o.skip) continue;
      if (/合格|齐套/.test(o.label)) return o.to;
    }
    return null;
  }

  function commit(f, fromNode, toId, opinion, nextUser, action, label) {
    var u = curUser();
    var toNode = nodeOf(f, toId);
    f.visited = f.visited || [];
    if (fromNode && f.visited.indexOf(fromNode.id) < 0) f.visited.push(fromNode.id);
    pushRec(f, fromNode, toNode, opinion, action, label, u.username);

    if (!toNode) {
      f.status = 'done';
      f.curId = '';
      f.reviewCtx = null;
      try {
        if (f.itemId && typeof appData !== 'undefined' && appData[f.moduleId]) {
          var it = appData[f.moduleId].filter(function (x) { return x.id === f.itemId; })[0];
          if (it) { it.status = 'done'; it.flowStatus = 'done'; }
        }
      } catch (e) {}
    } else {
      f.curId = toNode.id;
      var _autoLd = leaderOfNode(f, toNode);
      f.assignee = nextUser || _autoLd || f.assignee || u.username;
      if (toNode.type === 'review') {
        var ok = okTargetOf(f, fromNode);
        f.reviewCtx = {
          back: fromNode ? fromNode.id : '', backName: fromNode ? fromNode.name : '',
          ok: ok,
          okName: (ok && nodeOf(f, ok)) ? nodeOf(f, ok).name : ''
        };
      } else {
        f.reviewCtx = null;
      }
    }
    f.updatedAt = Date.now();
    if (toNode) {
      notifyNode(f, toNode, fromNode ? fromNode.name : '');
    } else {
      notify(f.initiator, '【流程办结】' + f.title,
        '流程已办结，最后环节：' + (fromNode ? fromNode.name : ''), f.id);
    }
    saveFlows();
    renderFlowDetail();
    refreshBadges();
    refreshNoticeBadge();
    toast(toNode ? ('已流转到「' + toNode.name + '」') : '流程已办结');
  }

  function guard() {
    var f = findFlow(curFlowId);
    if (!f) { toast('未找到该流程', 'error'); return null; }
    if (f.status !== 'running') { toast('该流程已结束', 'error'); return null; }
    if (!canHandle(f)) { toast('你不是当前节点处理人，无法操作', 'error'); return null; }
    return f;
  }

  function readForm() {
    return {
      opinion: ($('flowOpinion') && $('flowOpinion').value) || '',
      nextUser: ($('flowNextUser') && $('flowNextUser').value) || ''
    };
  }

  global.flowApprove = function () {
    var f = guard(); if (!f) return;
    var n = curNode(f);
    if (!n) return;
    var v = readForm();
    var to = n.next || null;
    if (!to && n.options) {
      for (var i = 0; i < n.options.length; i++) {
        if (!n.options[i].skip && n.options[i].to !== 'review') { to = n.options[i].to; break; }
      }
    }
    commit(f, n, to, v.opinion, v.nextUser, 'approve', '');
  };

  global.flowChoose = function (i) {
    var f = guard(); if (!f) return;
    var n = curNode(f);
    var o = (n.options || [])[i];
    if (!o) return;
    var v = readForm();
    commit(f, n, o.to, v.opinion, v.nextUser, o.skip ? 'comment' : 'branch', o.label);
  };

  global.flowReview = function (kind) {
    var f = guard(); if (!f) return;
    var n = curNode(f);
    var v = readForm();
    var ctx = f.reviewCtx || {};

    if (kind === 'scrap') {
      f.visited = f.visited || [];
      if (f.visited.indexOf(n.id) < 0) f.visited.push(n.id);
      pushRec(f, n, null, v.opinion, 'terminate', '报废/退货', curUser().username);
      f.status = 'terminated';
      f.curId = '';
      f.reviewCtx = null;
      f.updatedAt = Date.now();
      notify(f.initiator, '【流程终止】' + f.title,
        '评审结论：报废/退货。环节：' + n.name + (v.opinion ? '，意见：' + v.opinion : ''), f.id);
      saveFlows(); renderFlowDetail(); refreshBadges(); refreshNoticeBadge();
      toast('流程已终止（报废/退货）');
      return;
    }
    var to = (kind === 'rework') ? ctx.back : ctx.ok;
    if (!to) { toast('评审上下文缺失，无法流转', 'error'); return; }
    commit(f, n, to, v.opinion, v.nextUser, 'review', (kind === 'rework' ? '返工返修' : '让步接收'));
  };

  global.flowReject = function () {
    var f = guard(); if (!f) return;
    var n = curNode(f);
    var v = readForm();
    var prev = null;
    var hist = f.history || [];
    for (var i = hist.length - 1; i >= 0; i--) {
      if (hist[i].from && hist[i].from !== n.id) { prev = hist[i].from; break; }
    }
    if (!prev) { toast('已是第一个节点，无法退回', 'error'); return; }
    commit(f, n, prev, v.opinion, v.nextUser, 'reject', '退回');
  };

  global.flowTerminate = function () {
    var f = guard(); if (!f) return;
    var n = curNode(f);
    var v = readForm();
    f.visited = f.visited || [];
    if (n && f.visited.indexOf(n.id) < 0) f.visited.push(n.id);
    pushRec(f, n, null, v.opinion, 'terminate', '终止', curUser().username);
    f.status = 'terminated';
    f.curId = '';
    f.reviewCtx = null;
    f.updatedAt = Date.now();
    notify(f.initiator, '【流程终止】' + f.title,
      '流程已终止。环节：' + (n ? n.name : '') + (v.opinion ? '，意见：' + v.opinion : ''), f.id);
    saveFlows(); renderFlowDetail(); refreshBadges(); refreshNoticeBadge();
    toast('流程已终止');
  };

  /* ==================== 发起流程 ==================== */
  var pending = null;

  function showModal(title) {
    var t = document.querySelector('#flowModal .modal-title');
    if (t) t.textContent = title;
    var md = $('flowModal');
    if (md) md.classList.add('show');
    var nb = $('flowNextBtn'), sb = $('flowSubmitBtn');
    if (nb) nb.style.display = 'none';
    if (sb) sb.style.display = '';
  }

  global.closeFlowModal = function () {
    var md = $('flowModal');
    if (md) md.classList.remove('show');
    pending = null;
  };

  /* ---- 选择器：内置模板 or 业务卡片 ---- */
  global.openFlowPicker = function () {
    var opts = '';
    opts += '<optgroup label="⚡ 内置流程模板">';
    TEMPLATES.forEach(function (t) {
      opts += '<option value="tpl|' + escAttr(t.id) + '">' + escHtml(t.icon + ' ' + t.name) + '</option>';
    });
    opts += '</optgroup>';
    var cnt = 0;
    try {
      MODULES.forEach(function (m) {
        var arr = (typeof appData !== 'undefined' && appData[m.id]) || [];
        var items = arr.filter(function (it) { return it && !it.isTemplate && !it.isKnowledge; });
        if (!items.length) return;
        opts += '<optgroup label="' + escAttr(m.icon + ' ' + m.name) + '（业务卡片）">';
        items.forEach(function (it) {
          cnt++;
          opts += '<option value="card|' + escAttr(m.id + '|' + it.id) + '">' + escHtml(it.name) + '</option>';
        });
        opts += '</optgroup>';
      });
    } catch (e) { console.error(e); }

    var box = $('flowModalBody');
    if (box) box.innerHTML =
      '<div class="fm-row"><div class="fm-label">选择流程模板或业务卡片<span class="fm-tip">共 ' + cnt + ' 张业务卡片</span></div>' +
      '<select id="fmPickItem" class="fm-input" size="' + Math.min(14, Math.max(6, cnt + 1)) + '">' + opts + '</select></div>' +
      '<div class="fm-hint">「主机生产全流程」是按公司实际业务流程内置的完整流程，含齐套/合格判定与评审回流；' +
      '选业务卡片则按该卡片的流程步骤生成环节。</div>';
    showModal('🚀 发起流程');
    var nb = $('flowNextBtn');
    if (nb) nb.style.display = '';
    var sb = $('flowSubmitBtn');
    if (sb) sb.style.display = 'none';
  };

  global.flowPickerNext = function () {
    var el = $('fmPickItem');
    var v = el ? el.value : '';
    if (!v) { toast('请先选择', 'error'); return; }
    if (v.indexOf('tpl|') === 0) {
      openFlowFromTemplate(v.split('|')[1]);
    } else if (v.indexOf('card|') === 0) {
      var p = v.split('|');
      openFlowFromCard(p[1], p[2]);
    }
  };

  /* ---- 模板发起 ---- */
  function openFlowFromTemplate(tplId) {
    var t = getTemplate(tplId);
    if (!t) { toast('模板不存在', 'error'); return; }
    var graph = JSON.parse(JSON.stringify(t.graph));
    pending = { templateId: tplId, title: t.name, graph: graph, moduleId: '', itemId: '' };
    renderCreateForm('template');
  }

  /* ---- 卡片发起 ---- */
  function openFlowFromCard(moduleId, itemId) {
    var item = null;
    try {
      item = (appData[moduleId] || []).filter(function (x) { return x.id === itemId; })[0];
    } catch (e) {}
    if (!item) { toast('业务卡片不存在', 'error'); return; }
    var names = parseNodes(item, moduleId);
    pending = { templateId: '', title: item.name + ' · 流程', graph: linearGraph(names),
      moduleId: moduleId, itemId: itemId, itemName: item.name };
    renderCreateForm('card');
  }

  global.openFlowCreate = function (moduleId, itemId) {
    if (moduleId && itemId) { openFlowFromCard(moduleId, itemId); return; }
    var item = null, mid = '';
    try { item = (typeof currentItem !== 'undefined') ? currentItem : null; } catch (e) {}
    try { mid = (typeof currentModule !== 'undefined') ? currentModule : ''; } catch (e) {}
    if (item && item.id && mid) { openFlowFromCard(mid, item.id); return; }
    global.openFlowPicker();
  };

  function assigneeOptions() {
    var opts = '', u = curUser();
    activeAccounts().forEach(function (a) {
      opts += '<option value="' + escAttr(a.username) + '"' + (a.username === u.username ? ' selected' : '') + '>' +
        escHtml((a.realname || a.username) + (a.dept ? '（' + a.dept + '）' : '')) + '</option>';
    });
    return opts;
  }

  function renderCreateForm(mode) {
    if (!pending) return;
    var isTpl = mode === 'template';
    var g = pending.graph;
    var nodeRows = '';
    if (isTpl) {
      var ids = Object.keys(g.nodes), _ni = 0;
      nodeRows = '<div class="fe-list">';
      ids.forEach(function (id) {
        var n = g.nodes[id];
        nodeRows += '<div class="fe-row"><span class="fe-idx">' + (++_ni) + '</span>' +
          '<input class="fe-input fe-name" data-id="' + escAttr(id) + '" value="' + escHtml(n.name) + '">' +
          '<input class="fe-input fe-dept" data-id="' + escAttr(id) + '" value="' + escHtml(n.dept || '') + '" placeholder="负责部门">' +
          '</div>';
        if (n.options && n.options.length) {
          nodeRows += '<div class="fe-branch">' + n.options.map(function (o) {
            return '<span>' + escHtml(o.label) + ' → ' + escHtml((g.nodes[o.to] || {}).name || '') + '</span>';
          }).join('') + '</div>';
        }
      });
      nodeRows += '</div>';
    }

    var box = $('flowModalBody');
    if (box) box.innerHTML =
      '<div class="fm-row"><div class="fm-label">流程名称</div>' +
        '<input id="fmTitle" class="fm-input" value="' + escHtml(pending.title) + '"></div>' +
      (pending.itemName ? '<div class="fm-row"><div class="fm-label">关联业务卡片</div><div class="fm-static">' + escHtml(pending.itemName) + '</div></div>' : '') +
      '<div class="fm-row"><div class="fm-label">当前节点处理人</div>' +
        '<select id="fmAssignee" class="fm-input">' + assigneeOptions() + '</select></div>' +
      '<div class="fm-row"><div class="fm-label">备注（可选）</div>' +
        '<textarea id="fmRemark" class="fm-input" rows="2" placeholder="如订单号、机型、批量…"></textarea></div>' +
      (isTpl
        ? '<div class="fm-row"><div class="fm-label">流程节点<span class="fm-tip">名称与负责部门可直接修改，分支走向固定</span></div>' + nodeRows + '</div>'
        : '<div class="fm-row"><div class="fm-label">流程环节<span class="fm-tip">每行一个，可自由增删改</span></div>' +
          '<textarea id="fmNodes" class="fm-input" rows="6">' +
          mainChain({ graph: g }).map(function (n) { return escHtml(n.name); }).join('\n') + '</textarea></div>');
    showModal('🚀 ' + (isTpl ? '发起生产全流程' : '发起流程'));
  }

  global.submitFlowCreate = function () {
    if (!pending) return;
    var title = ($('fmTitle') && $('fmTitle').value || '').trim() || pending.title;
    var assignee = ($('fmAssignee') && $('fmAssignee').value) || curUser().username;
    var remark = ($('fmRemark') && $('fmRemark').value || '').trim();
    var g = pending.graph;

    if (pending.templateId) {
      var nameEls = document.querySelectorAll('#flowModalBody .fe-name');
      var deptEls = document.querySelectorAll('#flowModalBody .fe-dept');
      Array.prototype.forEach.call(nameEls, function (el) {
        var id = el.getAttribute('data-id');
        if (g.nodes[id] && el.value.trim()) g.nodes[id].name = el.value.trim();
      });
      Array.prototype.forEach.call(deptEls, function (el) {
        var id = el.getAttribute('data-id');
        if (g.nodes[id]) g.nodes[id].dept = el.value.trim();
      });
    } else {
      var ta = $('fmNodes');
      var lines = (ta && ta.value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!lines.length) { toast('至少保留一个环节', 'error'); return; }
      g = linearGraph(lines);
    }

    var u = curUser();
    var now = Date.now();
    var f = {
      id: uid(),
      title: title,
      templateId: pending.templateId || '',
      moduleId: pending.moduleId || '',
      itemId: pending.itemId || '',
      graph: g,
      curId: g.start,
      assignee: assignee,
      initiator: u.username,
      status: 'running',
      priority: '',
      remark: remark,
      visited: [],
      history: [],
      reviewCtx: null,
      createdAt: now,
      updatedAt: now
    };
    var startNode = g.nodes[g.start];
    pushRec(f, null, startNode, remark, 'submit', '发起', u.username);

    var _pid = pending.itemId || '';
    getFlows().push(f);
    saveFlows();
    try { notifyNode(f, startNode, ''); } catch (e) {}
    global.closeFlowModal();
    refreshBadges();
    if ($('page-flows') && $('page-flows').classList.contains('active')) renderFlowsPage();
    var _cur = null;
    try { _cur = (typeof currentItem !== 'undefined') ? currentItem : null; } catch (e) {}
    if (_cur && _pid && _cur.id === _pid) { renderFlowBoxInDetail(); }
    openFlow(f.id);
    toast('流程已发起');
  };

  /* ==================== 卡片详情页集成 ==================== */
  function flowsOfItem(moduleId, itemId) {
    return getFlows().filter(function (f) { return f.moduleId === moduleId && f.itemId === itemId; })
      .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  }

  function renderFlowBoxInDetail() {
    var box = document.querySelector('[data-flow-box="1"]');
    if (!box) return;
    var item = null;
    try { item = (typeof currentItem !== 'undefined') ? currentItem : null; } catch (e) {}
    if (!item) return;
    var mid = (typeof currentModule !== 'undefined') ? currentModule : '';
    var list = flowsOfItem(mid, item.id);
    var h = '<div class="fbox-head">⚡ 流程处理</div>';
    if (!list.length) {
      h += '<div class="fbox-empty">该卡片还没有流程</div>' +
        '<div class="fbox-btn" onclick="openFlowCreate(\'' + escAttr(mid) + '\',\'' + escAttr(item.id) + '\')">🚀 发起流程</div>';
    } else {
      list.forEach(function (f) {
        var st = STATUS_MAP[f.status] || STATUS_MAP.running;
        var n = curNode(f);
        h += '<div class="fbox-item" onclick="openFlow(\'' + escAttr(f.id) + '\')">' +
          '<div class="fbox-t">' + escHtml(f.title) + '<span class="fc-badge ' + st.cls + '">' + st.name + '</span></div>' +
          '<div class="fbox-s">当前：' + escHtml(n ? n.name : '—') + ' · ' + escHtml(userLabel(f.assignee)) + ' · ' + fmtShort(f.updatedAt) + '</div>' +
          '</div>';
      });
      h += '<div class="fbox-btn ghost" onclick="openFlowCreate(\'' + escAttr(mid) + '\',\'' + escAttr(item.id) + '\')">🚀 再发起一条流程</div>';
    }
    box.innerHTML = h;
  }

  /* ==================== 角标 / 首页 ==================== */
  function refreshBadges() {
    var n = countTodo();
    try {
      document.querySelectorAll('#sidebarNav .nav-item').forEach(function (el) {
        if (el.textContent.indexOf('流程中心') < 0) return;
        var b = el.querySelector('.nav-badge');
        if (n > 0) {
          if (!b) { b = document.createElement('span'); b.className = 'nav-badge nav-badge-warn'; el.appendChild(b); }
          b.textContent = n;
          b.style.display = '';
        } else if (b) { b.style.display = 'none'; }
      });
    } catch (e) {}
    try {
      var hs = $('homeStats');
      if (hs) {
        var c = $('homeFlowStat');
        if (!c) {
          c = document.createElement('div');
          c.id = 'homeFlowStat';
          c.className = 'stat-card';
          hs.appendChild(c);
        }
        c.setAttribute('onclick', "navigateTo('flows')");
        c.innerHTML = '<div class="stat-num warn">' + n + '</div><div class="stat-label">流程待办</div>';
      }
    } catch (e) {}
  }


  /* ==================== 部门领导 ==================== */
  function firstDept(s) {
    if (!s) return '';
    return String(s).split(/[\/、,，|]/)[0].trim();
  }

  function getLeaders() {
    if (typeof appData === 'undefined' || !appData) return {};
    if (!appData.deptLeaders || typeof appData.deptLeaders !== 'object') appData.deptLeaders = {};
    return appData.deptLeaders;
  }

  function guessLeader(dept) {
    var accs = getAccounts();
    for (var i = 0; i < accs.length; i++) {
      if (accs[i].dept === dept && accs[i].role === 'manager' && accs[i].status !== 'disabled') return accs[i].username;
    }
    for (var j = 0; j < accs.length; j++) {
      if (accs[j].dept === dept && accs[j].status !== 'disabled') return accs[j].username;
    }
    return '';
  }

  function leaderOfDept(dept) {
    var d = firstDept(dept);
    if (!d) return '';
    var L = getLeaders();
    return L[d] || guessLeader(d);
  }

  function leaderOfNode(f, node) {
    if (!node) return '';
    if (f && f.nodeLeaders && f.nodeLeaders[node.id]) return f.nodeLeaders[node.id];
    return leaderOfDept(node.dept);
  }

  function allDepts() {
    var set = {};
    getAccounts().forEach(function (a) { if (a.dept) set[a.dept] = 1; });
    TEMPLATES.forEach(function (t) {
      Object.keys(t.graph.nodes).forEach(function (k) {
        var d = firstDept(t.graph.nodes[k].dept);
        if (d) set[d] = 1;
      });
    });
    getFlows().forEach(function (f) {
      var g = graphOf(f); if (!g) return;
      Object.keys(g.nodes).forEach(function (k) {
        var d = firstDept(g.nodes[k].dept);
        if (d) set[d] = 1;
      });
    });
    return Object.keys(set);
  }

  /* ==================== 消息通知 ==================== */
  function getNotices() {
    if (typeof appData === 'undefined' || !appData) return [];
    if (!Array.isArray(appData.notices)) appData.notices = [];
    return appData.notices;
  }

  function notify(to, title, body, flowId) {
    if (!to) return 0;
    var list = getNotices(), now = Date.now();
    for (var i = list.length - 1; i >= 0 && i > list.length - 30; i--) {
      if (list[i].to === to && list[i].flowId === flowId && list[i].title === title && (now - list[i].at) < 60000) return 0;
    }
    list.push({ id: uid('ntc_'), to: to, from: curUser().username, title: title,
      body: body || '', flowId: flowId || '', at: now, read: false });
    if (list.length > 300) list.splice(0, list.length - 300);
    saveFlows();
    return 1;
  }

  function myNotices() {
    var u = curUser().username;
    return getNotices().filter(function (n) { return n.to === u; })
      .sort(function (a, b) { return b.at - a.at; });
  }

  function unreadCount() {
    return myNotices().filter(function (n) { return !n.read; }).length;
  }

  var soundOn = false;

  function beep() {
    if (!soundOn) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.30);
      o.start(); o.stop(ctx.currentTime + 0.32);
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 700);
    } catch (e) {}
  }

  function pushDesktop(title, body) {
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      new Notification(title, { body: body || '', tag: 'gls-flow-' + Date.now() });
    } catch (e) {}
  }

  global.enableNotice = function () {
    requestPermission();
    soundOn = true;
    beep();
    toast('桌面提醒与提示音已开启');
  };

  function requestPermission() {
    try {
      if (typeof Notification === 'undefined') { toast('当前浏览器不支持桌面通知', 'error'); return; }
      if (Notification.permission === 'default') Notification.requestPermission();
    } catch (e) {}
  }

  // 流转到节点后：通知处理人 + 该部门领导
  function notifyNode(f, node, fromName) {
    if (!node || f.status !== 'running') return 0;
    var targets = {};
    if (f.assignee) targets[f.assignee] = 1;
    var ld = leaderOfNode(f, node);
    if (ld) targets[ld] = 1;
    var title = '【流程待办】' + f.title;
    var body = '当前环节：' + node.name + (node.dept ? '（' + firstDept(node.dept) + '）' : '') +
      (fromName ? '，由「' + fromName + '」流转而来' : '') + '，请及时评审处理。';
    var n = 0;
    Object.keys(targets).forEach(function (u) { n += notify(u, title, body, f.id); });
    if (n) { pushDesktop(title, body); beep(); }
    return n;
  }

  /* ==================== 消息中心 ==================== */
  global.openNotices = function () {
    switchFlowPage('notices', '消息中心');
    renderNotices();
  };

  function renderNotices() {
    var el = $('noticeList');
    if (!el) return;
    var list = myNotices();
    var unread = list.filter(function (n) { return !n.read; }).length;

    var head = $('noticeHead');
    if (head) {
      var permTxt = '';
      try {
        if (typeof Notification !== 'undefined') {
          permTxt = Notification.permission === 'granted' ? '桌面提醒已开启'
            : (Notification.permission === 'denied' ? '桌面提醒被浏览器拒绝' : '桌面提醒未开启');
        } else { permTxt = '当前浏览器不支持桌面通知'; }
      } catch (e) {}
      head.innerHTML =
        '<div class="nt-head-row"><span class="nt-count">未读 <b>' + unread + '</b> / 共 ' + list.length + ' 条</span>' +
        '<span class="nt-acts">' +
          '<span class="nt-btn" onclick="enableNotice()">🔔 开启提醒</span>' +
          (unread ? '<span class="nt-btn" onclick="markAllRead()">全部已读</span>' : '') +
        '</span></div>' +
        '<div class="nt-perm">' + escHtml(permTxt) + ' · 数据存本机浏览器，同一台电脑切换账号即可看到各自身份的消息</div>';
    }

    if (!list.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">🔔</div>' +
        '<div class="empty-text">暂无消息</div>' +
        '<div style="font-size:12px;color:#bbb;margin-top:8px;">流程流转到需你评审的环节时，这里会收到提醒</div></div>';
      return;
    }
    var html = '';
    list.forEach(function (n) {
      html += '<div class="nt-item' + (n.read ? '' : ' unread') + '" onclick="openNotice(\'' + escAttr(n.id) + '\')">' +
        '<div class="nt-dot"></div>' +
        '<div class="nt-body">' +
          '<div class="nt-title">' + escHtml(n.title) + '</div>' +
          '<div class="nt-txt">' + escHtml(n.body) + '</div>' +
          '<div class="nt-time">来自 ' + escHtml(userLabel(n.from)) + ' · ' + fmtTime(n.at) + '</div>' +
        '</div></div>';
    });
    el.innerHTML = html;
  }

  global.openNotice = function (id) {
    var list = getNotices();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i].read = true;
        saveFlows();
        refreshNoticeBadge();
        if (list[i].flowId && findFlow(list[i].flowId)) { global.openFlow(list[i].flowId); return; }
        break;
      }
    }
    renderNotices();
  };

  global.markAllRead = function () {
    var u = curUser().username;
    getNotices().forEach(function (n) { if (n.to === u) n.read = true; });
    saveFlows();
    refreshNoticeBadge();
    renderNotices();
    toast('已全部标记为已读');
  };

  function refreshNoticeBadge() {
    var n = unreadCount();
    try {
      var dot = $('noticeDot');
      if (dot) {
        dot.textContent = n > 9 ? '9+' : (n || '');
        dot.style.display = n > 0 ? '' : 'none';
      }
      document.querySelectorAll('#sidebarNav .nav-item').forEach(function (el) {
        if (el.textContent.indexOf('消息中心') < 0) return;
        var b = el.querySelector('.nav-badge');
        if (n > 0) {
          if (!b) { b = document.createElement('span'); b.className = 'nav-badge'; el.appendChild(b); }
          b.textContent = n; b.style.display = '';
        } else if (b) { b.style.display = 'none'; }
      });
    } catch (e) {}
  }

  /* ==================== 部门领导设置 ==================== */
  global.openDeptConfig = function () {
    var depts = allDepts().sort();
    var L = getLeaders();
    var rows = '';
    var accOpts = '';
    activeAccounts().forEach(function (a) {
      accOpts += '<option value="' + escAttr(a.username) + '">' +
        escHtml((a.realname || a.username) + (a.dept ? '（' + a.dept + '）' : '')) + '</option>';
    });
    depts.forEach(function (d) {
      var sel = L[d] || guessLeader(d);
      var opts = '<option value="">— 未设置 —</option>';
      activeAccounts().forEach(function (a) {
        opts += '<option value="' + escAttr(a.username) + '"' + (a.username === sel ? ' selected' : '') + '>' +
          escHtml((a.realname || a.username) + (a.dept ? '（' + a.dept + '）' : '')) + '</option>';
      });
      rows += '<div class="fe-row"><div class="dp-name">' + escHtml(d) + '</div>' +
        '<select class="fe-input dp-sel" data-dept="' + escAttr(d) + '">' + opts + '</select></div>';
    });
    if (!rows) rows = '<div class="fa-done">暂无可配置的部门</div>';

    var box = $('flowModalBody');
    if (box) box.innerHTML =
      '<div class="fm-row"><div class="fm-label">各部门上级领导' +
      '<span class="fm-tip">流程流转到某部门环节时，自动指派给该部门领导评审</span></div>' +
      '<div class="fe-list">' + rows + '</div></div>' +
      '<div class="fm-hint">已在进行的流程不受影响，新流转的环节按此指派。部门来自账号资料与流程节点。</div>';
    showModal('⚙ 部门领导设置');
  };

  global.saveDeptConfig = function () {
    var L = getLeaders();
    var sels = document.querySelectorAll('#flowModalBody .dp-sel');
    Array.prototype.forEach.call(sels, function (el) {
      var d = el.getAttribute('data-dept');
      if (!d) return;
      if (el.value) L[d] = el.value; else delete L[d];
    });
    saveFlows();
    global.closeFlowModal();
    toast('部门领导已保存');
    if ($('page-flows') && $('page-flows').classList.contains('active')) renderFlowsPage();
  };

  /* ==================== 使用说明 ==================== */
  global.toastFlowHelp = function () {
    var html = '<div class="help-doc">' +
      '<p><b>1. 怎么发起</b><br>在业务卡片详情页点「🚀 发起流程」，或在流程中心点「＋ 发起流程」选内置模板 / 业务卡片。</div>' +
      '<p><b>2. 环节从哪来</b><br>「主机生产全流程」是按公司实际业务流程内置的；选业务卡片则自动读取该卡片的流程步骤拆分。</p>' +
      '<p><b>3. 部门领导评审</b><br>每个环节绑定负责部门，流转到该环节时<b>自动指派给该部门领导</b>评审；如需调整，在「⚙ 部门领导」里设置。</p>' +
      '<p><b>4. 自动流转</b><br>领导评审通过后自动进入下一部门环节；分支环节（齐套/合格等）选择走向后流转；末环节通过即办结。</p>' +
      '<p><b>5. 消息提醒</b><br>每次流转会自动通知<b>该环节处理人与部门领导</b>，右上角 🔔 显示未读数；在消息中心点「🔔 开启提醒」可开启桌面通知与提示音。</p>' +
      '<p><b>6. 不合格怎么办</b><br>评审处理有三个结论：返工返修（回到原检验环节重检）、让步接收（继续走合格路径）、报废/退货（终止流程）。</p>' +
      '<p><b>7. 多人怎么用</b><br>同一台电脑、同一浏览器下，退出后换账号登录，即可看到各自身份的待办与消息。</p>' +
      '</div>';
    var box = $('flowModalBody');
    if (box) box.innerHTML = html;
    showModal('流程中心使用说明');
  };

  /* ==================== 启动 ==================== */
  function boot() {
    try { migrateAll(); } catch (e) {}

    // 侧边栏入口
    var _rs = global.renderSidebar;
    if (typeof _rs === 'function') {
      global.renderSidebar = function () {
        var r = _rs.apply(this, arguments);
        try {
          var nav = $('sidebarNav');
          if (nav && nav.innerHTML.indexOf('流程中心') < 0) {
            var n = countTodo();
            var un = unreadCount();
            var html = '<div class="nav-section">流程协作</div>' +
              '<div class="nav-item" onclick="navigateTo(\'flows\'); toggleSidebar()">' +
              '<span class="nav-icon">⚡</span><span class="nav-text">流程中心</span>' +
              (n > 0 ? '<span class="nav-badge nav-badge-warn">' + n + '</span>' : '') + '</div>' +
              '<div class="nav-item" onclick="navigateTo(\'notices\'); toggleSidebar()">' +
              '<span class="nav-icon">🔔</span><span class="nav-text">消息中心</span>' +
              (un > 0 ? '<span class="nav-badge">' + un + '</span>' : '') + '</div>';
            var secs = nav.querySelectorAll('.nav-section');
            var done = false;
            for (var i = 0; i < secs.length; i++) {
              if (secs[i].textContent.indexOf('数据分析') >= 0) { secs[i].insertAdjacentHTML('beforebegin', html); done = true; break; }
            }
            if (!done) nav.insertAdjacentHTML('beforeend', html);
          }
        } catch (e) {}
        return r;
      };
    }

    // 导航到流程中心
    var _nav = global.navigateTo;
    if (typeof _nav === 'function') {
      global.navigateTo = function (page) {
        var r = _nav.apply(this, arguments);
        try {
          if (page === 'flows') { renderFlowsPage(); refreshBadges(); }
          if (page === 'notices') { renderNotices(); refreshNoticeBadge(); }
        } catch (e) {}
        return r;
      };
    }

    // 首页统计补流程待办
    var _rh = global.renderHome;
    if (typeof _rh === 'function') {
      global.renderHome = function () {
        var r = _rh.apply(this, arguments);
        try { refreshBadges(); } catch (e) {}
        return r;
      };
    }

    // 卡片详情页注入流程区块
    var _rd = global.renderDetail;
    if (typeof _rd === 'function') {
      global.renderDetail = function () {
        var r = _rd.apply(this, arguments);
        try {
          var pg = $('page-detail');
          if (pg && pg.classList.contains('active') && !document.querySelector('[data-flow-box="1"]')) {
            var box = document.createElement('div');
            box.className = 'fbox';
            box.setAttribute('data-flow-box', '1');
            pg.appendChild(box);
          }
          renderFlowBoxInDetail();
        } catch (e) { console.error(e); }
        return r;
      };
    }

    setTimeout(function () {
      try { if (typeof renderSidebar === 'function') renderSidebar(); } catch (e) {}
      try { if ($('page-flows') && $('page-flows').classList.contains('active')) renderFlowsPage(); } catch (e) {}
      refreshBadges();
      refreshNoticeBadge();
      var _un = unreadCount();
      if (_un > 0) toast('你有 ' + _un + ' 条新消息，点右上角 🔔 查看');
    }, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // 供外部调用
  global.glsFlow = {
    getFlows: getFlows, findFlow: findFlow, countTodo: countTodo,
    openFlow: global.openFlow, parseNodes: parseNodes, renderFlowsPage: renderFlowsPage,
    TEMPLATES: TEMPLATES, renderFlowBoxInDetail: renderFlowBoxInDetail
  };

})(window);
