/* gls-sync.js — 多人数据同步层（内网共享模式）
 *
 * 原则：不侵入任何现有模块。
 *   1) 拦截 localStorage.setItem，凡是写中央键的动作都被自动推送到服务端；
 *   2) 打开页面时先问服务端要版本号，服务端更新则拉全量并应用；
 *   3) 每隔几秒问一次版本号，有同事改动就提示/自动刷新。
 *
 * 兼容：如果没有服务端（例如放在 GitHub Pages 上单机用），本脚本自动静默退出，
 *       行为与从前完全一致——数据仍存本机浏览器。
 */
(function () {
  'use strict';

  var CENTRAL_KEY = 'gls_quality_data_v2';
  var V_KEY = 'gls_sync_v';          // 本地已知的服务端版本号
  var POLL_MS = 8000;                // 轮询间隔
  var PUSH_DEBOUNCE = 900;           // 本地改动合并推送

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
    return fetch('/api/load', { cache: 'no-store' })
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

    fetch('/api/save', {
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
    fetch('/api/version', { cache: 'no-store' })
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
    fetch('/api/version', { cache: 'no-store' })
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
            xhr.open('POST', '/api/save', false);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify({ v: remote.v, data: JSON.parse(raw) }));
          } catch (e) { }
        });
      })
      .catch(function () { _online = false; _bootLock = false; });   // 单机模式，什么都不做
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

  window.GLSSYNC = {
    isOnline: function () { return _online === true; },
    refresh: function () { return refreshFromServer(false); },
    pushNow: function () { return push(true); },
    version: function () { return remote.v; }
  };
})();
