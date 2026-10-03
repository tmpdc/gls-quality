/* ============================================================
   格丽思质量管理工作台 · 实时提醒
   ------------------------------------------------------------
   作用：数据一变（别人流转 / 审批 / 邀请评审 / 缺料建单）就当场提醒，
        不用刷新页面、不用切到消息中心。

   原理：轮询本机数据（多人模式下每 8 秒会从服务端同步一次），
        发现「发给我的新通知」或「等着我审批的流程」就立刻浮出来。
        和 gls-bizflow.js 的 notify() 天然对接 —— 那边只管写，
        这边负责让当事人当场看到。

   判定口径与引擎保持一致：
     「是不是发给我的」  —— 对齐 BIZFLOW.unread() 的 meSet（姓名/账号/部门）
     「是不是该我审批」  —— 直接调 BIZFLOW.canApprove()，不另造一套

   提醒方式：
     1) 右下角浮出提示条（新消息绿色 / 待审批橙色，20 秒后自动收）
     2) 右上角未读红点，不重渲染也实时更新
     3) 系统级桌面通知（默认关，GLSLive.desktop(true) 开）
     4) 调试用 GLSLive.check() 手动体检、GLSLive.reset() 重锚

   不需要企业微信。企业微信配好之前，这就是唯一的实时通道。
   ============================================================ */
(function () {
  'use strict';

  var USER_KEY = 'gls_current_user';
  var SEEN_KEY = 'gls_live_seen_v1';       // 已提醒到的最后一条通知 id
  var FLOW_KEY = 'gls_live_flow_v1';       // 已提醒过的 (流程id@当前节点)
  var DESK_KEY = 'gls_live_desktop_v1';    // 桌面通知开关
  var TICK = 4000;

  function B() { return window.BIZFLOW || null; }

  function curUser() {
    try {
      var raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* ---------- 判定「这条是不是发给我的」：与引擎 unread() 同口径 ---------- */
  /* ---------- 已读锚点：按用户隔离，存 localStorage 才不会刷新就重锚 ---------- */
  function getAnchor(u) {
    try {
      var raw = localStorage.getItem(SEEN_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || o.user !== (u.username || '')) return null;   // 换人了，重新锚定
      return (typeof o.id === 'string') ? o.id : '';
    } catch (e) { return null; }
  }

  function setAnchor(u, id) {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify({ user: u.username || '', id: id || '' }));
    } catch (e) {}
  }

  function meSet(u) {
    var set = [];
    if (!u) return set;
    if (u.username) set.push(u.username);
    if (u.realname) set.push(u.realname);
    try {
      var b = B();
      if (b && b.accountOf) {
        var acc = b.accountOf(u.username);
        if (acc) {
          if (acc.department) set.push(acc.department);
          if (acc.realname) set.push(acc.realname);
        }
      }
    } catch (e) {}
    return set;
  }

  function isMine(n, u) {
    if (!n) return false;
    if (u && u.role === 'admin') return true;   // 超管全收
    return meSet(u).indexOf(n.to) >= 0;
  }

  /* ---------- 判定「这个流程是否等我审批」：直接问引擎 ---------- */
  function flowNeedsMe(f) {
    if (!f) return false;
    // 主判：直接问引擎（它认得流程图定义，唯一权威）
    try {
      var b = B();
      if (b && b.canApprove && b.canApprove(f)) return true;
    } catch (e) {}
    // 兜底：流程自带 nodes 数组时，按「当前节点部门 = 我的部门」判断
    try {
      if (f.status && f.status !== '待审批') return false;
      var nodes = f.nodes;
      if (!nodes || !nodes.length) return false;
      var u = curUser();
      if (!u) return false;
      if (u.role === 'admin') return true;
      var set = meSet(u);
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].id !== f.cur) continue;
        if (nodes[i].done) return false;
        return !!nodes[i].dept && set.indexOf(nodes[i].dept) >= 0;
      }
    } catch (e) {}
    return false;
  }

  /* ---------- 拿数据：优先走引擎，拿不到退回原始 JSON ---------- */
  function readDB() {
    try {
      var b = B();
      if (b && b.db) return b.db();
    } catch (e) {}
    try {
      var raw = localStorage.getItem('gls_quality_data_v2');
      if (!raw) return null;
      var all = JSON.parse(raw);
      return (all && all.bizflow) ? all.bizflow : null;
    } catch (e) { return null; }
  }

  /* ---------- 提示条 ---------- */
  var host = null;
  function box() {
    if (host && document.body && document.body.contains(host)) return host;
    if (!document.body) return null;
    host = document.createElement('div');
    host.id = 'glsLiveNotify';
    host.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483000',
      'display:flex', 'flex-direction:column', 'gap:8px',
      'max-width:min(360px,86vw)', 'pointer-events:none'
    ].join(';');
    document.body.appendChild(host);
    return host;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function close(el) {
    if (!el || !el.parentNode) return;
    el.style.opacity = '0';
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }

  function pop(text, kind, opts) {
    var h = box();
    if (!h) return;
    opts = opts || {};
    /* 同一时刻只留一条：新的顶掉旧的，避免堆一屏 */
    try {
      while (h.firstChild) h.removeChild(h.firstChild);
    } catch (e) {}
    var c = kind === 'todo'
      ? { bg: '#fff7ed', bd: '#fdba74', bar: '#ea580c', fg: '#9a3412', t: '待你审批' }
      : { bg: '#ffffff', bd: '#cfe0d8', bar: '#2f9e6e', fg: '#1f2d28', t: '新消息' };
    var d = document.createElement('div');
    d.style.cssText = [
      'pointer-events:auto', 'background:' + c.bg,
      'border:1px solid ' + c.bd, 'border-left:4px solid ' + c.bar,
      'border-radius:9px', 'padding:11px 13px',
      'box-shadow:0 6px 20px rgba(0,0,0,.13)',
      'font-size:13.5px', 'line-height:1.6', 'color:' + c.fg,
      'word-break:break-word', 'opacity:0', 'transform:translateY(8px)',
      'transition:opacity .2s ease,transform .2s ease', 'cursor:pointer'
    ].join(';');
    var mid = opts.mid || '';
    var mname = '';
    try { if (mid && window.moduleName) mname = window.moduleName(mid); } catch (e) {}
    d.innerHTML = '<div style="font-weight:700;margin-bottom:3px;">' + c.t + '</div>'
      + esc(text || '（无内容）')
      + (mname
          ? '<div style="margin-top:6px;font-size:12.5px;background:rgba(22,101,52,.10);'
            + 'border-radius:5px;padding:5px 8px;">'
            + (c.t === '待你审批' ? '请到' : '已送到') + '【' + esc(mname) + '】模块处理'
            + '<span style="opacity:.6"> · 点这里直接过去</span></div>'
          : '')
      + '<div style="margin-top:5px;font-size:12px;opacity:.65;">点一下收起</div>';
    d.onclick = function () {
      if (mid) { try { close(d); window.gotoModuleTodo(mid); return; } catch (e) {} }
      close(d);
    };
    h.appendChild(d);
    setTimeout(function () { d.style.opacity = '1'; d.style.transform = 'translateY(0)'; }, 20);
    setTimeout(function () { close(d); }, kind === 'todo' ? 20000 : 9000);
  }

  /* ---------- 桌面通知（默认关） ---------- */
  function desktopOn() {
    try { return localStorage.getItem(DESK_KEY) === '1'; } catch (e) { return false; }
  }

  function desktopNotify(text) {
    if (!desktopOn()) return;
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;
      new Notification('格丽思质量管理工作台', { body: String(text || '').slice(0, 120) });
    } catch (e) {}
  }

  /* ---------- 未读红点 + 铃铛数字，不重渲染也更新 ---------- */
  function bumpBell(unread) {
    try {
      // 业务流转页那个「🔔 消息 (n)」按钮
      var els = document.querySelectorAll('span,button,a');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.children.length > 3) continue;
        var t = el.textContent || '';
        if (t.indexOf('消息') < 0) continue;
        if (!el.getAttribute('onclick') && !el.onclick) continue;
        el.innerHTML = '🔔 消息 ' + (unread > 0
          ? '<b style="color:#dc2626">(' + unread + ')</b>' : '');
      }
      // 固定红点
      var dot = document.getElementById('glsBellDot');
      if (!dot && document.body) {
        dot = document.createElement('div');
        dot.id = 'glsBellDot';
        dot.style.cssText = [
          'position:fixed', 'top:8px', 'right:8px', 'z-index:2147482999',
          'min-width:18px', 'height:18px', 'line-height:18px', 'padding:0 5px',
          'border-radius:9px', 'background:#dc2626', 'color:#fff',
          'font-size:11px', 'font-weight:700', 'text-align:center',
          'box-shadow:0 2px 6px rgba(0,0,0,.25)', 'pointer-events:none',
          'box-sizing:border-box'
        ].join(';');
        document.body.appendChild(dot);
      }
      if (dot) {
        if (unread > 0) {
          dot.textContent = unread > 99 ? '99+' : String(unread);
          dot.style.display = '';
        } else {
          dot.style.display = 'none';
        }
      }
    } catch (e) {}
  }

  function nodeName(f) {
    try {
      var b = B();
      if (b && b.curNode) {
        var nd = b.curNode(f);
        if (nd && nd.name) return nd.name;
      }
    } catch (e) {}
    return '';
  }

  /* ---------- 主循环 ---------- */
  var busy = false;
  function poll(firstTime) {
    if (busy) return;
    busy = true;
    try {
      var u = curUser();
      if (!u) { busy = false; return; }
      var d = readDB();
      if (!d) { busy = false; return; }

      var ns = d.notices || [];
      /* 建 id -> 流程 索引，消息靠 flowId 反查它现在归哪个模块 */
      var byId = {};
      for (var bi = 0; bi < (d.flows || []).length; bi++) byId[d.flows[bi].id] = d.flows[bi];
      function modOfFlowId(fid) {
        try {
          var fl = byId[fid];
          if (!fl || !window.moduleOfFlow) return '';
          return window.moduleOfFlow(fl) || '';
        } catch (e) { return ''; }
      }
      var anchor = getAnchor(u);       // null = 从没锚过；'' = 锚过但当时没消息
      var fresh = [];

      if (anchor === null || firstTime) {
        // 第一次进来：只锚定位置，不把历史消息炸一屏
        fresh = [];
      } else if (anchor === '') {
        // 上次锚定时还没有任何消息，现在有了 —— 全是新的（最多弹 3 条）
        fresh = ns.slice(0, 3);
      } else {
        var idx = -1;
        for (var i = 0; i < ns.length; i++) {
          if (ns[i].id === anchor) { idx = i; break; }
        }
        fresh = (idx === -1) ? ns.slice(0, 1) : ns.slice(0, idx);
      }
      setAnchor(u, ns.length ? ns[0].id : '');

      if (ns.length) {

        for (var j = fresh.length - 1; j >= 0; j--) {
          if (!isMine(fresh[j], u)) continue;
          pop(fresh[j].text, 'msg', { mid: modOfFlowId(fresh[j].flowId) });
          desktopNotify(fresh[j].text);
        }

        var unread = 0;
        for (var k = 0; k < ns.length; k++) {
          if (!ns[k].read && isMine(ns[k], u)) unread++;
        }
        bumpBell(unread);
      }

      /* 等我审批的流程 */
      var fs = d.flows || [];
      var seen = {};
      try { seen = JSON.parse(sessionStorage.getItem(FLOW_KEY) || '{}'); } catch (e) { seen = {}; }
      var changed = false;
      for (var m = 0; m < fs.length; m++) {
        var f = fs[m];
        if (!flowNeedsMe(f)) continue;
        var mark = f.id + '@' + f.cur;
        if (seen[mark]) continue;
        seen[mark] = 1;
        changed = true;
        if (!firstTime) {
          var nm = nodeName(f);
          var _m2 = '';
          try { if (window.moduleOfFlow) _m2 = window.moduleOfFlow(f) || ''; } catch (e) {}
          pop('流程 ' + (f.no || f.id) + ' 环节「' + (nm || '审批') + '」等你审批', 'todo', { mid: _m2 });
          desktopNotify('流程 ' + (f.no || f.id) + ' 等你审批');
        }
      }
      if (changed) {
        var keys = Object.keys(seen);
        if (keys.length > 100) {
          var keep = {};
          for (var q = keys.length - 100; q < keys.length; q++) keep[keys[q]] = 1;
          seen = keep;
        }
        try { sessionStorage.setItem(FLOW_KEY, JSON.stringify(seen)); } catch (e) {}
      }
    } catch (e) {
      /* 实时提醒绝不能影响主流程 */
    }
    busy = false;
  }

  /* ---------- 对外接口 ---------- */
  window.GLSLive = {
    /* 开关桌面通知；开的时候顺手申请权限 */
    desktop: function (on) {
      try {
        if (!on) {
          localStorage.setItem(DESK_KEY, '0');
          return { ok: true, on: false };
        }
        if (!('Notification' in window)) return { ok: false, msg: '这个浏览器不支持桌面通知' };
        localStorage.setItem(DESK_KEY, '1');
        if (Notification.permission === 'granted') return { ok: true, on: true };
        if (Notification.permission === 'denied') {
          return { ok: false, msg: '浏览器把通知权限禁了，去地址栏左边的图标里开一下' };
        }
        Notification.requestPermission().then(function (p) {
          if (p !== 'granted') {
            try { localStorage.setItem(DESK_KEY, '0'); } catch (e) {}
          }
        });
        return { ok: true, on: true, msg: '已开，浏览器可能弹一个授权框，点允许' };
      } catch (e) {
        return { ok: false, msg: String(e) };
      }
    },
    isDesktopOn: desktopOn,
    check: function () { poll(false); return true; },
    reset: function () {
      try {
        localStorage.removeItem(SEEN_KEY);
        sessionStorage.removeItem(FLOW_KEY);
      } catch (e) {}
      return true;
    },
    /* 自己给自己发一条，验证提醒通不通 */
    demo: function () {
      var b = B();
      var u = curUser();
      if (!b || !u) return false;
      b.notify(u.realname || u.username, '【自检】实时提醒通道正常，这条是测试消息', null);
      return true;
    }
  };

  /* ---------- 启动：先锚定一次，再定时轮询 ---------- */
  setTimeout(function () {
    poll(true);
    setInterval(function () { poll(false); }, TICK);
  }, 2500);

})();
