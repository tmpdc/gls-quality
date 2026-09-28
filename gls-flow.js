/*!
 * gls-flow.js —— 格丽思质量管理工作台 流程引擎
 * 功能：发起流程 / 环节流转 / 审批（通过·退回·终止）/ 待办 / 全程留痕 / 自动指派下一环节
 * 设计原则：不修改主逻辑，通过函数包装实现增强；流程数据存于 appData.flows，随工作台数据一起持久化
 */
(function (global) {

  var FLOW_VER = '1';
  var MY_TODO_KEY = 'gls_flow_filter';

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
    var d = new Date(ts);
    var now = new Date();
    if (d.toDateString() === now.toDateString()) return '今天 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function uid(prefix) {
    return (prefix || 'flow_') + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  }

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
      var a = JSON.parse(localStorage.getItem('gls_accounts') || '[]');
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

  /* ==================== 流程数据层 ==================== */
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

  // 从业务卡片的 process 里解析环节；解析不出则用模块默认环节
  function parseNodes(item, moduleId) {
    var nodes = [];
    var src = (item && item.process) ? String(item.process) : '';
    if (src) {
      var liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi, m;
      while ((m = liRe.exec(src)) !== null) {
        var inner = m[1];
        var bm = inner.match(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/i);
        var raw = bm ? bm[1] : inner;
        var name = stripHtml(raw).replace(/^[\s\d一二三四五六七八九十]+[.、)）]?\s*/, '').trim();
        name = name.replace(/[：:]\s*$/, '').trim();
        if (name) nodes.push(name.slice(0, 26));
      }
    }
    if (!nodes.length) {
      nodes = (DEFAULT_NODES[moduleId] || ['申请', '审核', '批准', '执行', '归档']).slice();
    }
    return nodes;
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

  var STATUS_MAP = {
    running: { name: '进行中', cls: 'run' },
    done: { name: '已办结', cls: 'ok' },
    terminated: { name: '已终止', cls: 'stop' }
  };

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
    var arr = getFlows();
    var out = arr.filter(function (f) {
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
    var statEl = $('flowStats');
    var tabEl = $('flowTabs');
    var listEl = $('flowList');
    if (!listEl) return;

    var all = getFlows();
    var u = curUser();
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
        '<div style="font-size:12px;color:#bbb;margin-top:8px;">在业务卡片详情页点「发起流程」即可创建</div></div>';
      return;
    }

    var html = '';
    list.forEach(function (f) {
      html += flowCardHtml(f);
    });
    listEl.innerHTML = html;
  }

  function flowCardHtml(f) {
    var st = STATUS_MAP[f.status] || STATUS_MAP.running;
    var total = (f.nodes || []).length;
    var cur = Math.min(f.cur || 0, Math.max(total - 1, 0));
    var pct = total ? Math.round(((f.status === 'done' ? total : cur) / total) * 100) : 0;
    var nodeName = (f.nodes && f.nodes[cur]) ? f.nodes[cur] : '—';
    var todo = isMyTodo(f);
    var late = f.status === 'running' && f.dueDate && Date.now() > f.dueDate;

    return '<div class="flow-card' + (todo ? ' is-todo' : '') + '" onclick="openFlow(\'' + escAttr(f.id) + '\')">' +
      '<div class="fc-top">' +
        '<span class="fc-icon">' + moduleIcon(f.moduleId) + '</span>' +
        '<span class="fc-title">' + escHtml(f.title) + '</span>' +
        '<span class="fc-badge ' + st.cls + '">' + st.name + '</span>' +
      '</div>' +
      '<div class="fc-mid">' +
        '<span class="fc-node">当前：' + escHtml(nodeName) + '</span>' +
        '<span class="fc-step">' + (f.status === 'done' ? total : cur + 1) + '/' + total + '</span>' +
      '</div>' +
      '<div class="fc-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="fc-bot">' +
        '<span>' + escHtml(moduleName(f.moduleId)) + '</span>' +
        '<span>发起：' + escHtml(userLabel(f.initiator)) + '</span>' +
        '<span>' + fmtShort(f.updatedAt || f.createdAt) + '</span>' +
        (todo ? '<span class="fc-todo">待我处理</span>' : '') +
        (late ? '<span class="fc-late">已超期</span>' : '') +
      '</div>' +
    '</div>';
  }

  global.setFlowFilter = function (f) {
    flowFilter = f;
    renderFlowsPage();
  };

  /* ==================== 流程详情 ==================== */
  var curFlowId = null;

  global.openFlow = function (id) {
    var f = findFlow(id);
    if (!f) { toast('未找到该流程', 'error'); return; }
    curFlowId = id;
    switchPage('flow', '流程详情');
    try { currentPage = 'flow'; } catch (e) {}
    renderFlowDetail();
  };

  function renderFlowDetail() {
    var f = findFlow(curFlowId);
    var headEl = $('flowHead'), tlEl = $('flowTimeline'), actEl = $('flowActions');
    if (!f || !headEl) return;
    var st = STATUS_MAP[f.status] || STATUS_MAP.running;
    var nodes = f.nodes || [];
    var cur = f.cur || 0;
    var can = canHandle(f);
    var u = curUser();

    headEl.innerHTML =
      '<div class="fh-title">' + escHtml(f.title) + '</div>' +
      '<div class="fh-meta">' +
        '<span class="fc-badge ' + st.cls + '">' + st.name + '</span>' +
        '<span>' + escHtml(moduleName(f.moduleId)) + '</span>' +
        '<span>发起人：' + escHtml(userLabel(f.initiator)) + '</span>' +
        '<span>' + fmtTime(f.createdAt) + '</span>' +
        (f.priority === 'urgent' ? '<span class="fc-late">紧急</span>' : '') +
      '</div>' +
      (f.remark ? '<div class="fh-remark">' + escHtml(f.remark) + '</div>' : '') +
      (f.itemId ? '<div class="fh-link" onclick="jumpToItem()">↗ 查看关联业务卡片</div>' : '');

    // 时间轴
    var _showIdx = (f.status === 'done') ? nodes.length : Math.min(cur + 1, nodes.length);
    var tl = '<div class="ftl-head"><span>流程进度</span><span>' +
      _showIdx + '/' + nodes.length + ' 环节</span></div>';
    tl += '<div class="ftl">';
    nodes.forEach(function (n, i) {
      var rec = null, recIdx = -1;
      (f.records || []).forEach(function (r, ri) {
        if (r.node === n && r.action !== 'comment' && ri > recIdx) { rec = r; recIdx = ri; }
      });
      var cls = 'wait', mark = '○';
      if (f.status === 'done' || i < cur) { cls = 'ok'; mark = '✓'; }
      else if (i === cur && f.status === 'running') { cls = 'cur'; mark = '●'; }
      if (i === cur && f.status === 'terminated') { cls = 'stop'; mark = '×'; }
      var sub = '';
      if (rec) {
        sub = '<div class="ftl-sub">' + escHtml(userLabel(rec.actor)) + ' · ' + fmtTime(rec.at) +
          (rec.opinion ? ' · ' + escHtml(rec.opinion) : '') + '</div>';
      } else if (i === cur && f.status === 'running') {
        sub = '<div class="ftl-sub pending">待 ' + escHtml(userLabel(f.assignee)) + ' 处理' + (f.dueDate ? ' · 限 ' + fmtTime(f.dueDate) : '') + '</div>';
      }
      tl += '<div class="ftl-item ' + cls + '">' +
        '<div class="ftl-dot">' + mark + '</div>' +
        '<div class="ftl-body"><div class="ftl-name">' + (i + 1) + '. ' + escHtml(n) + '</div>' + sub + '</div>' +
        '</div>';
    });
    tl += '</div>';

    // 流转记录
    if ((f.records || []).length) {
      tl += '<div class="frec-head">流转记录</div><div class="frec">';
      f.records.slice().reverse().forEach(function (r) {
        var actName = { submit: '发起', approve: '通过', reject: '退回', terminate: '终止', comment: '意见', assign: '指派' }[r.action] || r.action;
        tl += '<div class="frec-item"><span class="frec-act ' + r.action + '">' + actName + '</span>' +
          '<span class="frec-txt">' + escHtml(userLabel(r.actor)) + ' 于 ' + fmtTime(r.at) +
          (r.node ? ' 在「' + escHtml(r.node) + '」' : '') + (r.opinion ? '：' + escHtml(r.opinion) : '') + '</span></div>';
      });
      tl += '</div>';
    }
    tlEl.innerHTML = tl;

    // 操作区
    if (f.status !== 'running') {
      actEl.innerHTML = '<div class="fa-done">该流程已' + st.name + '，无待办操作</div>';
      return;
    }
    var nextName = nodes[cur + 1] || '（结束）';
    var opts = '';
    activeAccounts().forEach(function (a) {
      opts += '<option value="' + escAttr(a.username) + '"' + (a.username === (f.assignee || u.username) ? ' selected' : '') + '>' +
        escHtml((a.realname || a.username) + (a.dept ? '（' + a.dept + '）' : '')) + '</option>';
    });
    var canAct = can;
    actEl.innerHTML =
      '<div class="fa-label">审批意见（可选）</div>' +
      '<textarea id="flowOpinion" class="fa-input" placeholder="填写处理说明 / 审批意见…" rows="2"></textarea>' +
      '<div class="fa-row">' +
        '<div class="fa-col"><div class="fa-label">下一环节处理人</div>' +
        '<select id="flowNextUser" class="fa-input">' + opts + '</select></div>' +
        '<div class="fa-col"><div class="fa-label">下一环节</div>' +
        '<div class="fa-static">' + escHtml(nextName) + '</div></div>' +
      '</div>' +
      '<div class="fa-btns">' +
        '<button class="btn btn-approve"' + (canAct ? '' : ' disabled') + ' onclick="flowApprove()">✓ 通过并流转</button>' +
        '<button class="btn btn-reject"' + (canAct ? '' : ' disabled') + ' onclick="flowReject()">↩ 退回上一环节</button>' +
        '<button class="btn btn-stop"' + (canAct ? '' : ' disabled') + ' onclick="flowTerminate()">✕ 终止</button>' +
      '</div>' +
      (canAct ? '' : '<div class="fa-tip">当前环节处理人为 ' + escHtml(userLabel(f.assignee)) + '，你不是该环节处理人，无法操作</div>');
  }

  global.jumpToItem = function () {
    var f = findFlow(curFlowId);
    if (!f || !f.itemId) return;
    navigateTo('detail', f.moduleId, f.itemId);
  };

  /* ---- 流转动作 ---- */
  function doAction(action) {
    var f = findFlow(curFlowId);
    if (!f || f.status !== 'running') { toast('流程已结束', 'error'); return; }
    if (!canHandle(f)) { toast('你不是该环节处理人', 'error'); return; }
    var u = curUser();
    var opinionEl = $('flowOpinion');
    var opinion = opinionEl ? opinionEl.value.trim() : '';
    var nextEl = $('flowNextUser');
    var nextUser = nextEl ? nextEl.value : '';
    var nodes = f.nodes || [];
    var nodeName = nodes[f.cur] || '';

    if (action === 'approve') {
      if (!opinion && (f.nodes || []).length > 2) {
        // 中间环节建议填写意见，但不强制
      }
      f.records = f.records || [];
      f.records.push({ node: nodeName, actor: u.username, action: 'approve', opinion: opinion, at: Date.now() });
      if (f.cur + 1 >= nodes.length) {
        f.status = 'done';
        f.assignee = '';
        f.records.push({ node: '流程结束', actor: u.username, action: 'comment', opinion: '流程已办结', at: Date.now() });
        syncItemStatus(f, 'done');
        toast('流程已办结', 'success');
      } else {
        f.cur = f.cur + 1;
        f.assignee = nextUser || u.username;
        f.records.push({ node: nodes[f.cur], actor: u.username, action: 'assign', opinion: '指派给 ' + userLabel(f.assignee), at: Date.now() });
        toast('已通过，自动流转至「' + nodes[f.cur] + '」', 'success');
      }
    } else if (action === 'reject') {
      f.records = f.records || [];
      f.records.push({ node: nodeName, actor: u.username, action: 'reject', opinion: opinion, at: Date.now() });
      if (f.cur > 0) {
        f.cur = f.cur - 1;
        f.assignee = nextUser || f.initiator || u.username;
        toast('已退回至「' + nodes[f.cur] + '」', 'success');
      } else {
        f.assignee = nextUser || f.initiator || u.username;
        toast('已在首个环节，已退回发起人', 'success');
      }
    } else if (action === 'terminate') {
      f.records = f.records || [];
      f.records.push({ node: nodeName, actor: u.username, action: 'terminate', opinion: opinion, at: Date.now() });
      f.status = 'terminated';
      f.assignee = '';
      toast('流程已终止', 'success');
    }

    f.updatedAt = Date.now();
    saveFlows();
    renderFlowDetail();
    try { renderSidebar(); } catch (e) {}
  }

  global.flowApprove = function () { doAction('approve'); };
  global.flowReject = function () { doAction('reject'); };
  global.flowTerminate = function () {
    if (global.confirm && !global.confirm('确认终止该流程？终止后不能再流转。')) return;
    doAction('terminate');
  };

  // 流程办结后同步业务卡片状态
  function syncItemStatus(f, status) {
    try {
      if (!f.itemId || typeof appData === 'undefined') return;
      var arr = appData[f.moduleId] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === f.itemId) {
          arr[i].status = status;
          arr[i].flowId = f.id;
          break;
        }
      }
      saveData();
    } catch (e) { console.error(e); }
  }

  /* ==================== 发起流程弹窗 ==================== */
  var pendingItem = null;

  global.openFlowCreate = function (moduleId, itemId) {
    var item = null, mId = moduleId;
    try {
      if (itemId) {
        var arr = appData[moduleId] || [];
        for (var i = 0; i < arr.length; i++) { if (arr[i].id === itemId) { item = arr[i]; break; } }
      } else {
        item = (typeof currentItem !== 'undefined') ? currentItem : null;
        mId = (typeof currentModule !== 'undefined' && currentModule) ? currentModule.id : moduleId;
      }
    } catch (e) {}
    if (!item) { toast('未找到业务卡片', 'error'); return; }
    pendingItem = { moduleId: mId, itemId: item.id, item: item };

    var nodes = parseNodes(item, mId);
    var u = curUser();
    var opts = '';
    activeAccounts().forEach(function (a) {
      opts += '<option value="' + escAttr(a.username) + '"' + (a.username === u.username ? ' selected' : '') + '>' +
        escHtml((a.realname || a.username) + (a.dept ? '（' + a.dept + '）' : '')) + '</option>';
    });

    var body =
      '<div class="fm-row"><div class="fm-label">流程名称</div>' +
      '<input id="fmTitle" class="fm-input" value="' + escAttr(item.name + ' · 流程') + '"></div>' +
      '<div class="fm-row"><div class="fm-label">关联业务卡片</div>' +
      '<div class="fm-static">' + moduleIcon(mId) + ' ' + escHtml(moduleName(mId)) + ' / ' + escHtml(item.name) + '</div></div>' +
      '<div class="fm-row"><div class="fm-label">流程环节<span class="fm-tip">每行一个环节，可自由增删改</span></div>' +
      '<textarea id="fmNodes" class="fm-input" rows="' + Math.max(4, nodes.length) + '">' + escHtml(nodes.join('\n')) + '</textarea></div>' +
      '<div class="fm-row fm-2col">' +
        '<div><div class="fm-label">当前处理人</div><select id="fmAssignee" class="fm-input">' + opts + '</select></div>' +
        '<div><div class="fm-label">优先级</div><select id="fmPriority" class="fm-input">' +
          '<option value="normal">普通</option><option value="urgent">紧急</option></select></div>' +
      '</div>' +
      '<div class="fm-row"><div class="fm-label">备注（可选）</div>' +
      '<textarea id="fmRemark" class="fm-input" rows="2" placeholder="补充说明…"></textarea></div>';

    var box = $('flowModalBody');
    if (box) box.innerHTML = body;
    var _t = document.querySelector('#flowModal .modal-title');
    if (_t) _t.textContent = '🚀 发起流程';
    var _nb = $('flowNextBtn'), _sb = $('flowSubmitBtn');
    if (_nb) _nb.style.display = 'none';
    if (_sb) _sb.style.display = '';
    var md = $('flowModal');
    if (md) md.classList.add('show');
    var t = $('fmTitle');
    if (t) setTimeout(function () { try { t.focus(); } catch (e) {} }, 60);
  };

  global.closeFlowModal = function () {
    var md = $('flowModal');
    if (md) md.classList.remove('show');
    pendingItem = null;
  };

  global.submitFlowCreate = function () {
    if (!pendingItem) { toast('数据已失效，请重新发起', 'error'); return; }
    var titleEl = $('fmTitle'), nodesEl = $('fmNodes');
    var title = titleEl ? titleEl.value.trim() : '';
    if (!title) { toast('请输入流程名称', 'error'); return; }
    var raw = nodesEl ? nodesEl.value : '';
    var nodes = raw.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
    if (nodes.length < 2) { toast('流程至少需要 2 个环节', 'error'); return; }

    var u = curUser();
    var f = {
      id: uid(),
      title: title,
      moduleId: pendingItem.moduleId,
      itemId: pendingItem.itemId,
      nodes: nodes,
      cur: 0,
      status: 'running',
      initiator: u.username,
      assignee: ($('fmAssignee') || {}).value || u.username,
      priority: ($('fmPriority') || {}).value || 'normal',
      remark: ($('fmRemark') || {}).value.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      records: [{ node: nodes[0], actor: u.username, action: 'submit', opinion: ($('fmRemark') || {}).value.trim() || '发起流程', at: Date.now() }]
    };
    getFlows().unshift(f);

    // 回写业务卡片
    try {
      pendingItem.item.flowId = f.id;
      if (pendingItem.item.status === 'pending') pendingItem.item.status = 'doing';
    } catch (e) {}
    saveFlows();
    closeFlowModal();
    toast('流程已发起，当前环节：' + nodes[0], 'success');
    try { renderSidebar(); } catch (e) {}
    openFlow(f.id);
  };

  /* ---- 从流程中心发起：先选业务卡片 ---- */
  global.openFlowPicker = function () {
    var opts = '', cnt = 0;
    try {
      MODULES.forEach(function (m) {
        if (m.id === 'knowledge') return;
        var arr = (typeof appData !== 'undefined' && appData[m.id]) || [];
        var items = arr.filter(function (it) { return it && !it.isTemplate && !it.isKnowledge; });
        if (!items.length) return;
        opts += '<optgroup label="' + escAttr(m.icon + ' ' + m.name) + '">';
        items.forEach(function (it) {
          cnt++;
          opts += '<option value="' + escAttr(m.id + '|' + it.id) + '">' + escHtml(it.name) + '</option>';
        });
        opts += '</optgroup>';
      });
    } catch (e) { console.error(e); }

    var body = '<div class="fm-row"><div class="fm-label">选择要发起流程的业务卡片' +
      '<span class="fm-tip">共 ' + cnt + ' 张</span></div>' +
      '<select id="fmPickItem" class="fm-input" size="' + Math.min(12, Math.max(5, cnt)) + '">' + opts + '</select></div>' +
      '<div class="fm-row" style="font-size:12px;color:#999;line-height:1.7;">' +
      '选定后进入下一步，可编辑流程环节、指定当前环节处理人。</div>';

    var box = $('flowModalBody');
    if (box) box.innerHTML = body;
    var t = document.querySelector('#flowModal .modal-title');
    if (t) t.textContent = '🚀 发起流程';
    var nb = $('flowNextBtn'), sb2 = $('flowSubmitBtn');
    if (nb) nb.style.display = '';
    if (sb2) sb2.style.display = 'none';
    var md = $('flowModal');
    if (md) md.classList.add('show');
    pendingItem = null;
  };

  global.flowPickerNext = function () {
    var el = $('fmPickItem');
    var v = el ? el.value : '';
    var parts = String(v).split('|');
    if (parts.length !== 2 || !parts[0]) { toast('请先选择业务卡片', 'error'); return; }
    openFlowCreate(parts[0], parts[1]);
  };

  global.toastFlowHelp = function () {
    var html = '<div style="font-size:13px;line-height:1.9;color:#444;">' +
      '<p style="margin:0 0 10px;"><b>1. 怎么发起</b><br>在业务卡片详情页点「🚀 发起流程」，或在流程中心点「＋ 发起流程」选一张卡片。</p>' +
      '<p style="margin:0 0 10px;"><b>2. 环节从哪来</b><br>自动读取该卡片的「流程步骤」拆成环节（如新品立项→需求提出/可行性评估/成本核算…），<b>每行一个，可自由增删改</b>。</p>' +
      '<p style="margin:0 0 10px;"><b>3. 谁来处理</b><br>发起时指定「当前环节处理人」；每次通过时可指定「下一环节处理人」，默认沿用当前处理人。</p>' +
      '<p style="margin:0 0 10px;"><b>4. 怎么流转</b><br>「通过并流转」自动进入下一环节；末环节通过即办结；「退回上一环节」用于打回重做；「终止」结束流程。每一步都留痕。</p>' +
      '<p style="margin:0 0 10px;"><b>5. 去哪看待办</b><br>指派给你的流程会出现在侧边栏「⚡流程中心」角标和首页「流程待办」卡片里。</p>' +
      '<p style="margin:0;"><b>6. 多人怎么用</b><br>同一台电脑、同一浏览器下，退出后换账号登录，即可看到各自身份的待办并审批（数据存在本机浏览器里）。</p>' +
      '</div>';
    var box = $('flowModalBody');
    if (box) box.innerHTML = html;
    var t = document.querySelector('#flowModal .modal-title');
    if (t) t.textContent = '流程中心使用说明';
    var nb = $('flowNextBtn'), sb2 = $('flowSubmitBtn');
    if (nb) nb.style.display = 'none';
    if (sb2) sb2.style.display = 'none';
    pendingItem = null;
    var md = $('flowModal');
    if (md) md.classList.add('show');
  };

  /* ==================== 详情页集成 ==================== */
  function flowOfItem(item) {
    if (!item) return null;
    var arr = getFlows();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].itemId === item.id) return arr[i];
    }
    return null;
  }

  function appendFlowSection() {
    try {
      if (typeof currentModule === 'undefined' || !currentModule) return;
      if (typeof currentItem === 'undefined' || !currentItem) return;
      if (currentItem.isKnowledge) return;
      if (currentModule.id === 'knowledge') return;
      var wrap = $('detailSections');
      if (!wrap) return;
      if (wrap.querySelector('[data-flow-box="1"]')) return;

      var f = flowOfItem(currentItem);
      var html = '<div class="detail-section" data-flow-box="1">' +
        '<div class="section-head"><span class="icon">⚡</span><span class="name">流程处理</span></div>';

      if (f) {
        var st = STATUS_MAP[f.status] || STATUS_MAP.running;
        var total = (f.nodes || []).length;
        var cur = Math.min(f.cur || 0, Math.max(total - 1, 0));
        var pct = total ? Math.round(((f.status === 'done' ? total : cur) / total) * 100) : 0;
        html += '<div class="fb-card">' +
          '<div class="fb-row"><span class="fb-title">' + escHtml(f.title) + '</span>' +
          '<span class="fc-badge ' + st.cls + '">' + st.name + '</span></div>' +
          '<div class="fb-node">当前环节：' + escHtml((f.nodes || [])[cur] || '—') +
          '（' + (f.status === 'done' ? total : cur + 1) + '/' + total + '）</div>' +
          '<div class="fc-bar"><i style="width:' + pct + '%"></i></div>' +
          '<div class="fb-btns">' +
            '<button class="btn-sm primary" onclick="openFlow(\'' + escAttr(f.id) + '\')">查看流程</button>' +
            (isMyTodo(f) ? '<button class="btn-sm warn" onclick="openFlow(\'' + escAttr(f.id) + '\')">去处理（待我）</button>' : '') +
          '</div></div>';
      } else {
        html += '<div class="fb-empty">该卡片还没有流程' +
          '<button class="btn-sm primary" onclick="openFlowCreate(\'' + escAttr(currentModule.id) + '\',\'' + escAttr(currentItem.id) + '\')">🚀 发起流程</button></div>';
      }
      html += '</div>';
      wrap.insertAdjacentHTML('beforeend', html);
    } catch (e) { console.error('渲染流程区块失败:', e); }
  }

  /* ==================== 侧边栏入口 ==================== */
  function injectFlowEntry() {
    try {
      var nav = $('sidebarNav');
      if (!nav) return;
      if (nav.querySelector('[data-flow-entry="1"]')) {
        var badge = nav.querySelector('[data-flow-entry="1"] .nav-badge');
        var n = countTodo();
        if (badge) { badge.textContent = n; badge.style.display = n ? '' : 'none'; }
        return;
      }
      var anchor = nav.querySelector('.nav-section');
      var n2 = countTodo();
      var div = document.createElement('div');
      div.setAttribute('data-flow-entry', '1');
      div.className = 'nav-item';
      div.setAttribute('onclick', "navigateTo('flows'); toggleSidebar()");
      div.innerHTML = '<span class="nav-icon">⚡</span><span class="nav-text">流程中心</span>' +
        '<span class="nav-badge nav-badge-warn" style="' + (n2 ? '' : 'display:none') + '">' + n2 + '</span>';
      var sec = document.createElement('div');
      sec.className = 'nav-section';
      sec.textContent = '流程与审批';
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(sec, anchor);
        anchor.parentNode.insertBefore(div, anchor);
      } else {
        nav.insertBefore(div, nav.firstChild);
      }
    } catch (e) { console.error(e); }
  }

  /* ==================== 首页待办入口 ==================== */
  function injectHomeTodo() {
    try {
      var box = $('homeStats');
      if (!box) return;
      if (box.querySelector('[data-flow-stat="1"]')) {
        var num = box.querySelector('[data-flow-stat="1"] .stat-num');
        if (num) num.textContent = countTodo();
        return;
      }
      var n = countTodo();
      var div = document.createElement('div');
      div.className = 'stat-card';
      div.setAttribute('data-flow-stat', '1');
      div.setAttribute('onclick', "navigateTo('flows')");
      div.innerHTML = '<div class="stat-num ' + (n ? 'warn' : '') + '">' + n + '</div><div class="stat-label">流程待办</div>';
      box.appendChild(div);
    } catch (e) { console.error(e); }
  }

  /* ==================== 函数包装 ==================== */
  function patchFunctions() {
    var _nav = global.navigateTo;
    if (typeof _nav === 'function' && !_nav.__flowPatched) {
      var newNav = function (page, moduleId, itemId) {
        if (page === 'flows') {
          switchPage('flows', '流程中心');
          try { currentPage = 'flows'; } catch (e) {}
          renderFlowsPage();
          return;
        }
        return _nav.apply(this, arguments);
      };
      newNav.__flowPatched = true;
      global.navigateTo = newNav;
    }

    var _side = global.renderSidebar;
    if (typeof _side === 'function' && !_side.__flowPatched) {
      var newSide = function () {
        _side.apply(this, arguments);
        try { injectFlowEntry(); } catch (e) { console.error(e); }
      };
      newSide.__flowPatched = true;
      global.renderSidebar = newSide;
    }

    var _home = global.renderHome;
    if (typeof _home === 'function' && !_home.__flowPatched) {
      var newHome = function () {
        _home.apply(this, arguments);
        try { injectHomeTodo(); } catch (e) { console.error(e); }
      };
      newHome.__flowPatched = true;
      global.renderHome = newHome;
    }

    var _detail = global.renderDetail;
    if (typeof _detail === 'function' && !_detail.__flowPatched) {
      var newDetail = function () {
        _detail.apply(this, arguments);
        try { appendFlowSection(); } catch (e) { console.error(e); }
      };
      newDetail.__flowPatched = true;
      global.renderDetail = newDetail;
    }
  }

  function switchPage(pageId, title) {
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    var el = $('page-' + pageId);
    if (el) el.classList.add('active');
    var t = $('pageTitle'); if (t) t.textContent = title;
    var fab = $('fabAdd'); if (fab) fab.style.display = 'none';
    var sb = $('searchBtn'); if (sb) sb.style.display = 'none';
    document.querySelectorAll('.sidebar .nav-item').forEach(function (n) { n.classList.remove('active'); });
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  /* ==================== 启动 ==================== */
  function boot() {
    patchFunctions();
    try { renderSidebar(); } catch (e) {}
    try { if (typeof currentPage !== 'undefined' && currentPage === 'home') renderHome(); } catch (e) {}
    console.log('[FLOW] 流程引擎加载完成，待办 ' + countTodo() + ' 项');
  }

  global.glsFlow = {
    countTodo: countTodo,
    getFlows: getFlows,
    parseNodes: parseNodes,
    openFlow: function (id) { global.openFlow(id); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window);
