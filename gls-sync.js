/* gls-sync.js — 多人数据同步层（接入方式可配置）
 *
 * 原则：不侵入任何现有模块。
 *   1) 拦截 localStorage.setItem，凡是写中央键的动作都被自动推送到服务端；
 *   2) 打开页面时先问服务端要版本号，服务端更新则拉全量并应用；
 *   3) 每隔几秒问一次版本号，有同事改动就提示/自动刷新。
 *
 * 接入方式（右下角齿轮里随时可改，改完自动记住，以后换网页/小程序/其他服务器都不用动代码）：
 *   auto   跟随网页地址——网页从哪台服务器打开就同步到哪台（默认，最省心）
 *   server 指定服务器——填 http://IP:端口，小程序或异地接入都走这个
 *   off    只用本机——数据只存这台电脑的浏览器，不联网
 *
 * 兼容：探测不到服务端时自动降级为单机，行为与从前完全一致。
 */
(function () {
  'use strict';

  var CENTRAL_KEY = 'gls_quality_data_v2';
  var V_KEY = 'gls_sync_v';          // 本地已知的服务端版本号
  var CFG_KEY = 'gls_conn_v1';       // 接入配置
  var POLL_MS = 8000;                // 轮询间隔
  var PUSH_DEBOUNCE = 900;           // 本地改动合并推送

  /* ---------------------------------------------------------- 接入配置 */
  function readCfg() {
    var o = {};
    try { o = JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch (e) { o = {}; }
    return {
      mode: o.mode || 'auto',                          // auto | server | off
      base: String(o.base || '').replace(/\/+$/, '')   // 例：http://192.168.1.16:8686
    };
  }
  function saveCfg(c) {
    cfg = { mode: c.mode, base: String(c.base || '').replace(/\/+$/, '') };
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { }
  }
  var cfg = readCfg();
  var API = '';                      // 实际使用的接口前缀，'' 表示与网页同源
  function initApi() {
    if (cfg.mode === 'off') { API = null; return; }
    API = (cfg.mode === 'server' && cfg.base) ? cfg.base : '';
  }
  function url(p) { return (API || '') + p; }

  var remote = { alive: false, v: 0 };
  var _pushTm = null;
  var _lastPushed = null;            // 上次成功推送的内容指纹
  var _pushing = false;
  var _pending = false;
  var _online = null;                // 单机 / 多人
  // 启动锁：在确认服务端状态之前，禁止把本机数据推上去
  // （否则新电脑第一次打开，页面初始化出的空数据会把服务端真实数据覆盖掉）
  var _bootLock = true;
  setTimeout(function () { _bootLock = false; }, 9000);   // 兜底解锁，避免服务端慢时永不推送

  /* ---------------------------------------------------------- 小工具 */
  function LS(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch (e) { }
    return null;
  }
  function localV() { return parseInt(LS(V_KEY) || '0', 10) || 0; }
  function setLocalV(v) { LS(V_KEY, String(v)); }
  function fingerprint(o) { try { return JSON.stringify(o); } catch (e) { return null; } }

  /* ---------------------------------------------------------- 顶部提示条 */
  var bar = null, barTimer = null;
  function banner(text, kind, actionText, onAction) {
    if (!text) {
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      bar = null;
      return;
    }
    if (!document.body) {   // 脚本放在 head 里时 body 还没建好，稍后再来
      setTimeout(function () { banner(text, kind, actionText, onAction); }, 200);
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'glsSyncBar';
      bar.style.cssText = [
        'position:fixed', 'left:50%', 'transform:translateX(-50%)',
        'top:10px', 'z-index:2147483000',
        'max-width:min(92vw,620px)', 'box-sizing:border-box',
        'padding:9px 14px', 'border-radius:10px',
        'font:13px/1.5 -apple-system,"Microsoft YaHei",sans-serif',
        'box-shadow:0 6px 22px rgba(0,0,0,.22)', 'letter-spacing:.2px'
      ].join(';');
      document.body.appendChild(bar);
    }
    var ok = kind === 'ok';
    bar.style.background = ok ? '#1f7a44' : '#b7791f';
    bar.style.color = '#fff';
    bar.innerHTML = '';
    var span = document.createElement('span');
    span.textContent = text;
    bar.appendChild(span);
    if (actionText && onAction) {
      var a = document.createElement('a');
      a.textContent = actionText;
      a.href = 'javascript:void(0)';
      a.style.cssText = 'margin-left:10px;color:#fff;text-decoration:underline;font-weight:600;cursor:pointer';
      a.onclick = function () { onAction(); };
      bar.appendChild(a);
    }
    clearTimeout(barTimer);
    barTimer = setTimeout(function () { banner(null); }, 12000);
  }

  /* ---------------------------------------------------------- 拉取服务端数据 */
  function applyServer(full) {
    var raw = fingerprint(full.data);
    if (raw === null) return;
    var cur = LS(CENTRAL_KEY);
    LS(CENTRAL_KEY, raw);
    setLocalV(full.v);
    remote.v = full.v;
    _lastPushed = raw;
    // 首次进入本会话时，重载一次让页面用服务端数据完成初始化
    if (cur !== raw && !sessionStorage.getItem('gls_sync_reloaded')) {
      sessionStorage.setItem('gls_sync_reloaded', '1');
      location.reload();
    } else if (cur !== raw) {
      banner('已更新为同事刚提交的数据', 'ok');
      setTimeout(function () { location.reload(); }, 600);
    }
  }

  function refreshFromServer(silent) {
    return fetch(url('/api/load'), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (full) {
        if (!full || !full.data) return;
        if (full.v < localV()) return;      // 服务端反而旧，忽略
        applyServer(full);
        if (!silent) banner('已拉取最新数据', 'ok');
      })
      .catch(function () { });
  }

  /* ---------------------------------------------------------- 推送本地改动 */
  function push(force) {
    if (!remote.alive || _bootLock) return;
    var raw = LS(CENTRAL_KEY);
    if (!raw) return;
    if (!force && raw === _lastPushed) return;   // 内容没变，不必推
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }

    if (_pushing) { _pending = true; return; }
    _pushing = true;

    fetch(url('/api/save'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ v: remote.v, data: data })
    })
      .then(function (r) {
        return r.json().then(function (j) { return { status: r.status, body: j }; })
          .catch(function () { return { status: r.status, body: {} }; });
      })
      .then(function (res) {
        var j = res.body || {};
        if (res.status === 200 && j.ok) {
          remote.v = j.v;
          setLocalV(j.v);
          _lastPushed = raw;
          banner(null);
        } else if (res.status === 409) {
          // 有人先改过了：接受对方版本号后重推一次，自己的改动不被丢弃
          remote.v = j.v || remote.v;
          setLocalV(remote.v);
          banner('有同事也在改，已保留你的内容', 'warn');
          setTimeout(function () { push(true); }, 400);
        }
      })
      .catch(function () { /* 服务端不可达，等下次轮询恢复 */ })
      .then(function () {
        _pushing = false;
        if (_pending) { _pending = false; setTimeout(function () { push(false); }, 200); }
      });
  }

  /* ---------------------------------------------------------- 轮询 */
  function poll() {
    if (document.hidden || !remote.alive) return;
    fetch(url('/api/version'), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || typeof j.v !== 'number') return;
        if (j.v === remote.v) return;
        if (j.v > remote.v) {
          var raw = LS(CENTRAL_KEY);
          var dirty = raw && raw !== _lastPushed;   // 本地有没推上去的改动
          if (dirty) {
            banner('有同事更新了数据。', 'warn', '查看最新', function () { refreshFromServer(false); });
            remote.v = j.v;
          } else {
            refreshFromServer(true);
          }
        }
      })
      .catch(function () { });
  }

  /* ---------------------------------------------------------- 启动 */
  function boot() {
    initApi();
    if (API === null) {                 // 配置为「只用本机」
      _online = false;
      _bootLock = false;
      return;
    }
    fetch(url('/api/version'), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || typeof j.v !== 'number') { _online = false; _bootLock = false; return; }
        _online = true;
        remote.alive = true;
        remote.v = j.v;
        if (j.v > localV()) {
          // 服务端比本机新 —— 一律以服务端为准拉全量，绝不用本机覆盖它
          // 注意：必须等拉取真正完成才解锁，否则页面会抢先把空数据推上去覆盖服务端
          refreshFromServer(true).then(function () { _bootLock = false; });
        } else if (j.v === 0 && localV() === 0) {
          // 服务端还是空的（第一次启用共享）：把本机现有数据推上去
          _bootLock = false;
          if (LS(CENTRAL_KEY)) push(true);
        } else {
          // 版本一致：本机可能还有没推上去的改动，推一次
          setLocalV(j.v);
          _bootLock = false;
          if (LS(CENTRAL_KEY)) push(true);
        }
        setInterval(poll, POLL_MS);
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) poll();
        });
        window.addEventListener('beforeunload', function () {
          // 关页面时尽力推最后一把（同步请求，保证不丢）
          if (!remote.alive) return;
          var raw = LS(CENTRAL_KEY);
          if (!raw || raw === _lastPushed) return;
          try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', url('/api/save'), false);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify({ v: remote.v, data: JSON.parse(raw) }));
          } catch (e) { }
        });
      })
      .catch(function () { _online = false; _bootLock = false; });   // 单机模式，什么都不做
  }

  /* ---------------------------------------------------------- 接入设置面板 */
  var panel = null;
  function statusText() {
    if (cfg.mode === 'off') return '只用本机（不联网）';
    if (_online === true) return '已连接共享服务，版本 v' + remote.v;
    if (_online === false) return '未连上共享服务（当前是本机模式）';
    return '正在检测…';
  }

  function closePanel() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
  }

  function openPanel() {
    closePanel();
    if (!document.body) return;
    var mask = document.createElement('div');
    mask.style.cssText = 'position:fixed;inset:0;z-index:2147483200;background:rgba(15,25,20,.42)';
    var box = document.createElement('div');
    box.style.cssText = [
      'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
      'z-index:2147483300', 'width:min(94vw,460px)', 'max-height:88vh', 'overflow:auto',
      'box-sizing:border-box', 'background:#fff', 'border-radius:14px', 'padding:20px 20px 16px',
      'font:14px/1.6 -apple-system,"Microsoft YaHei",sans-serif', 'color:#22312a',
      'box-shadow:0 18px 50px rgba(0,0,0,.32)'
    ].join(';');

    var rows = [
      { v: 'auto', t: '跟随网页地址', d: '从哪台服务器打开网页，就同步到哪台（推荐）' },
      { v: 'server', t: '指定服务器', d: '手动填服务器地址，小程序 / 异地接入都走这里' },
      { v: 'off', t: '只用本机', d: '数据只存这台电脑的浏览器，不与任何人同步' }
    ];
    var html = '<div style="font-size:17px;font-weight:700;margin-bottom:4px">接入设置</div>'
      + '<div style="font-size:12.5px;color:#6b7f72;margin-bottom:16px">当前：' + statusText() + '</div>';

    rows.forEach(function (r) {
      var on = cfg.mode === r.v;
      html += '<label style="display:flex;gap:10px;align-items:flex-start;padding:11px 12px;margin-bottom:8px;'
        + 'border:1.5px solid ' + (on ? '#1f7a4d' : '#dfe7e2') + ';border-radius:10px;cursor:pointer;'
        + 'background:' + (on ? '#f1f9f4' : '#fff') + '">'
        + '<input type="radio" name="glsConnMode" value="' + r.v + '"' + (on ? ' checked' : '')
        + ' style="margin-top:3px;width:16px;height:16px;accent-color:#1f7a4d">'
        + '<span><b style="font-size:14px">' + r.t + '</b>'
        + '<span style="display:block;font-size:12.5px;color:#6b7f72;line-height:1.45">' + r.d + '</span></span></label>';
    });

    html += '<div id="glsConnBaseWrap" style="margin:12px 0 6px;' + (cfg.mode === 'server' ? '' : 'display:none') + '">'
      + '<div style="font-size:12.5px;color:#6b7f72;margin-bottom:6px">服务器地址（含端口）</div>'
      + '<input id="glsConnBase" value="' + (cfg.base || '').replace(/"/g, '&quot;')
      + '" placeholder="例如 http://192.168.1.16:8686" '
      + 'style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid #dfe7e2;'
      + 'border-radius:9px;font-size:14px;outline:none">'
      + '<div id="glsConnTest" style="font-size:12.5px;color:#6b7f72;margin-top:7px;min-height:18px">'
      + '点右边按钮可以先测一下通不通</div></div>';

    html += '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">'
      + '<button id="glsConnTestBtn" style="padding:10px 16px;border-radius:9px;border:1.5px solid #dfe7e2;'
      + 'background:#fff;font-size:14px;cursor:pointer">测试连接</button>'
      + '<button id="glsConnSave" style="padding:10px 20px;border-radius:9px;border:0;background:#1f7a4d;'
      + 'color:#fff;font-size:14px;font-weight:600;cursor:pointer">保存并重连</button></div>';

    box.innerHTML = html;
    mask.appendChild(box);
    document.body.appendChild(mask);
    panel = mask;
    mask.onclick = function (e) { if (e.target === mask) closePanel(); };

    var wrap = box.querySelector('#glsConnBaseWrap');
    box.querySelectorAll('input[name=glsConnMode]').forEach(function (inp) {
      inp.onchange = function () {
        wrap.style.display = inp.value === 'server' ? '' : 'none';
      };
    });

    box.querySelector('#glsConnTestBtn').onclick = function () {
      var v = (box.querySelector('#glsConnBase').value || '').trim().replace(/\/+$/, '');
      var tip = box.querySelector('#glsConnTest');
      if (!v) { tip.textContent = '先填服务器地址'; tip.style.color = '#b7791f'; return; }
      tip.textContent = '正在测试…'; tip.style.color = '#6b7f72';
      fetch(v + '/api/ping', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.ok) { tip.textContent = '通！' + (j.name || '服务正常'); tip.style.color = '#1f7a4d'; }
          else { tip.textContent = '能连上，但对方不是本系统的服务'; tip.style.color = '#b7791f'; }
        })
        .catch(function () {
          tip.textContent = '连不上：确认服务已启动、地址和端口写对、同一网络、防火墙已放行';
          tip.style.color = '#c0392b';
        });
    };

    box.querySelector('#glsConnSave').onclick = function () {
      var mode = (box.querySelector('input[name=glsConnMode]:checked') || {}).value || 'auto';
      var base = (box.querySelector('#glsConnBase').value || '').trim();
      if (mode === 'server' && !base) {
        var tip = box.querySelector('#glsConnTest');
        tip.textContent = '选了「指定服务器」就要把地址填上';
        tip.style.color = '#c0392b';
        return;
      }
      saveCfg({ mode: mode, base: base });
      try { sessionStorage.removeItem('gls_sync_reloaded'); } catch (e) { }
      location.reload();
    };
  }

  function gear() {
    if (!document.body) { setTimeout(gear, 200); return; }
    if (document.getElementById('glsConnBtn')) return;
    var btn = document.createElement('div');
    btn.id = 'glsConnBtn';
    btn.title = '接入设置（网页 / 小程序 / 换服务器都在这改）';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" '
      + 'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle">'
      + '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    btn.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147482000;width:40px;height:40px;'
      + 'border-radius:50%;background:rgba(31,122,77,.86);display:flex;align-items:center;'
      + 'justify-content:center;cursor:pointer;box-shadow:0 3px 14px rgba(0,0,0,.26);user-select:none';
    btn.onclick = openPanel;
    document.body.appendChild(btn);
  }

  /* ---------------------------------------------------------- 拦截写中央键 */
  var _setItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (k, v) {
    _setItem(k, v);
    if (k === CENTRAL_KEY && remote.alive) {
      clearTimeout(_pushTm);
      _pushTm = setTimeout(function () { push(false); }, PUSH_DEBOUNCE);
    }
  };

  // 立刻开始探测，尽量赶在页面读取本机数据之前拿到服务端版本号
  boot();
  gear();

  window.GLSSYNC = {
    isOnline: function () { return _online === true; },
    refresh: function () { return refreshFromServer(false); },
    pushNow: function () { return push(true); },
    version: function () { return remote.v; },
    apiBase: function () { return API; },
    getConfig: function () { return { mode: cfg.mode, base: cfg.base }; },
    setConfig: function (c) { saveCfg(c || {}); try { sessionStorage.removeItem('gls_sync_reloaded'); } catch (e) { } },
    openSettings: openPanel
  };
})();
