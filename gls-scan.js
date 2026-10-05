/* ============================================================
   格丽思质量管理工作台 · 全局扫码引擎  gls-scan.js
   三种扫码方式：摄像头 / 扫码枪 / 手动输入
   扫码结果自动识别并跳转到对应模块的记录
   识别规则（前缀映射）可视化可改：SCAN.prefixMap
   ============================================================ */
(function (global) {
  'use strict';

  var SCAN = {};

  /* ---------- 可配置区（后续要加/改，只动这里） ---------- */
  SCAN.prefixMap = [
    { p: 'SO', key: 'so', label: '销售订单' },
    { p: 'FH', key: 'soShip', label: '销售发货' },
    { p: 'ST', key: 'soReturn', label: '销售退货' },
    { p: 'AS', key: 'afterSale', label: '售后分析' },
    { p: 'RN', key: 'renovate', label: '售后翻新' },
    { p: 'PR', key: 'pr', label: '采购申请' },
    { p: 'PO', key: 'po', label: '采购订单' },
    { p: 'RC', key: 'poRecv', label: '采购收货' },
    { p: 'IN', key: 'stockIn', label: '入库单' },
    { p: 'OUT', key: 'stockOut', label: '出库单' },
    { p: 'CK', key: 'stockCheck', label: '库存盘点' },
    { p: 'MO', key: 'mo', label: '生产工单' },
    { p: 'PK', key: 'moPick', label: '生产领料' },
    { p: 'FI', key: 'moIn', label: '完工入库' },
    { p: 'M', key: 'material', label: '物料档案' },
    { p: 'C', key: 'customer', label: '客户档案' },
    { p: 'S', key: 'supplier', label: '供应商档案' },
    { p: 'W', key: 'warehouse', label: '仓库设置' },
    { p: 'B', key: 'bom', label: 'BOM 清单' }
  ];
  /* 额外参与模糊匹配的字段（够了就停，避免误命中） */
  SCAN.fuzzyFields = ['code', 'name', 'spec', 'supplyName', 'supplySpec', 'customer', 'supplier'];

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    if (typeof global.toast === 'function') { try { global.toast(msg); return; } catch (e) {} }
    var t = $('scanToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'scanToast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'scan-toast show';
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.className = 'scan-toast'; }, 2400);
  }
  function erpEntities() {
    return (global.ERP && global.ERP.ENTITIES) ? global.ERP.ENTITIES : null;
  }
  /* appData 在 page.html 里是 let 声明的全局词法变量，不挂在 window 上，
     所以这里必须直接引用裸标识符（不能用 window.appData） */
  function dataRef() {
    try {
      if (typeof appData === 'undefined' || !appData) return null;
      return appData;
    } catch (e) { return null; }
  }
  function erpList(key) {
    var d = dataRef();
    if (!d || !d.erp) return [];
    return d.erp[key] || [];
  }

  /* ---------- 识别引擎 ---------- */
  /* 返回 {kind:'erp', key, ent, row} | {kind:'multi', hits:[]} | {kind:'none'} */
  SCAN.resolve = function (raw) {
    var code = String(raw == null ? '' : raw).trim();
    if (!code) return { kind: 'none', code: code };

    var ents = erpEntities();
    var keys = ents ? Object.keys(ents).filter(function (k) { return !ents[k].view; }) : [];

    /* ① 编码精确匹配（所有实体一起找，最准） */
    var exact = [];
    keys.forEach(function (k) {
      erpList(k).forEach(function (r) {
        if (r && r.code != null && String(r.code).toUpperCase() === code.toUpperCase()) {
          exact.push({ key: k, ent: ents[k], row: r });
        }
      });
    });
    if (exact.length === 1) {
      return { kind: 'erp', key: exact[0].key, ent: exact[0].ent, row: exact[0].row, code: code };
    }
    if (exact.length > 1) {
      return { kind: 'multi', hits: exact.map(function (x) {
        return { key: x.key, label: x.ent.name, title: x.row.code, sub: x.row.name || '', row: x.row };
      }), code: code };
    }

    /* ② 前缀匹配（按最长前缀优先，避免 M 抢了 MO） */
    var sorted = SCAN.prefixMap.slice().sort(function (a, b) { return b.p.length - a.p.length; });
    for (var i = 0; i < sorted.length; i++) {
      var m = sorted[i];
      if (code.toUpperCase().indexOf(m.p) === 0 && m.p.length <= code.length) {
        var list = erpList(m.key);
        /* 前缀命中后，若该实体里能找到完全一致的 code 就定位；否则只跳到列表 */
        var hit = null;
        for (var j = 0; j < list.length; j++) {
          if (list[j] && String(list[j].code || '').toUpperCase() === code.toUpperCase()) { hit = list[j]; break; }
        }
        if (hit) return { kind: 'erp', key: m.key, ent: ents ? ents[m.key] : null, row: hit, code: code };
        return { kind: 'open', key: m.key, label: m.label, code: code };
      }
    }

    /* ③ 模糊匹配名称/规格 */
    var fuzzy = [];
    keys.forEach(function (k) {
      var ent = ents[k];
      erpList(k).forEach(function (r) {
        if (!r) return;
        for (var f = 0; f < SCAN.fuzzyFields.length; f++) {
          var v = r[SCAN.fuzzyFields[f]];
          if (v != null && String(v) !== '' && String(v).indexOf(code) >= 0) {
            fuzzy.push({ key: k, label: ent.name, title: r.code || r.name, sub: r.name || r.spec || '', row: r });
            return;
          }
        }
      });
    });
    if (fuzzy.length) return { kind: 'multi', hits: fuzzy.slice(0, 30), code: code };

    return { kind: 'none', code: code };
  };

  /* ---------- 跳转 ---------- */
  function gotoErp(key) {
    if (global.ERP && typeof global.ERP.openList === 'function') {
      if (typeof global.navigateTo === 'function') { try { global.navigateTo('erp'); } catch (e) {} }
      global.ERP.openList(key);
      return true;
    }
    return false;
  }
  SCAN.highlightRow = function (row) {
    if (!row) return;
    setTimeout(function () {
      var list = document.querySelectorAll('.erp-row, tr[data-id], [data-erp-row]');
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        var txt = el.innerText || el.textContent || '';
        if (row.code && txt.indexOf(String(row.code)) >= 0) {
          el.classList.add('scan-hit');
          try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); }
          setTimeout(function () { el.classList.remove('scan-hit'); }, 4200);
          return;
        }
      }
    }, 420);
  };

  /* ---------- 处理一次扫码 ---------- */
  SCAN.handle = function (raw, opts) {
    opts = opts || {};
    var code = String(raw == null ? '' : raw).trim();
    if (!code) { toast('没有扫到内容'); return; }
    var res = SCAN.resolve(code);
    SCAN.pushHistory(code, res);
    if (opts.silent !== true) SCAN.renderResult(code, res);

    if (res.kind === 'erp') {
      gotoErp(res.key);
      SCAN.highlightRow(res.row);
      toast('已定位：' + (res.ent ? res.ent.name : '') + ' ' + (res.row.code || ''));
    } else if (res.kind === 'open') {
      gotoErp(res.key);
      toast('已打开：' + res.label + '（未找到编号 ' + code + '）');
    }
  };

  /* ---------- 历史 ---------- */
  var HK = 'gls_scan_history_v1';
  SCAN.history = [];
  SCAN.loadHistory = function () {
    try { SCAN.history = JSON.parse(localStorage.getItem(HK) || '[]') || []; }
    catch (e) { SCAN.history = []; }
    return SCAN.history;
  };
  SCAN.pushHistory = function (code, res) {
    var label = '';
    if (res.kind === 'erp') label = (res.ent ? res.ent.name : '') + ' ' + (res.row.code || '');
    else if (res.kind === 'open') label = res.label + '（仅定位模块）';
    else if (res.kind === 'multi') label = '匹配到 ' + res.hits.length + ' 条';
    else label = '未找到匹配';
    SCAN.history.unshift({ code: code, label: label, t: Date.now() });
    SCAN.history = SCAN.history.slice(0, 60);
    try { localStorage.setItem(HK, JSON.stringify(SCAN.history)); } catch (e) {}
  };
  SCAN.clearHistory = function () {
    SCAN.history = [];
    try { localStorage.removeItem(HK); } catch (e) {}
    SCAN.renderResult($('scanLastCode') ? $('scanLastCode').textContent : '', null, true);
  };

  /* ---------- 样式 ---------- */
  var CSS = [
    '.scan-mask{position:fixed;inset:0;background:rgba(0,0,0,.46);z-index:9600;display:none;align-items:center;justify-content:center;padding:16px;}',
    '.scan-mask.show{display:flex;}',
    '.scan-panel{width:100%;max-width:520px;max-height:88vh;overflow:auto;background:#fff;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.28);}',
    '.scan-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #eef0f3;}',
    '.scan-head h3{margin:0;font-size:17px;color:#1f2d3d;}',
    '.scan-x{border:0;background:transparent;font-size:22px;line-height:1;color:#8a94a6;cursor:pointer;padding:2px 6px;}',
    '.scan-tabs{display:flex;gap:6px;padding:12px 18px 0;}',
    '.scan-tab{flex:1;text-align:center;padding:9px 6px;border-radius:10px;background:#f4f6f9;color:#4b5563;font-size:14px;cursor:pointer;border:1px solid transparent;}',
    '.scan-tab.on{background:#e8f5ee;color:#127a44;border-color:#b7e0c9;font-weight:600;}',
    '.scan-body{padding:14px 18px 6px;}',
    '.scan-video{width:100%;border-radius:12px;background:#000;min-height:210px;object-fit:cover;}',
    '.scan-hint{font-size:12.5px;color:#8a94a6;line-height:1.7;margin-top:8px;}',
    '.scan-input{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #d9dee7;border-radius:10px;font-size:15px;}',
    '.scan-input:focus{outline:none;border-color:#127a44;box-shadow:0 0 0 3px rgba(18,122,68,.12);}',
    '.scan-btn{margin-top:10px;width:100%;padding:12px;border:0;border-radius:10px;background:#127a44;color:#fff;font-size:15px;font-weight:600;cursor:pointer;}',
    '.scan-btn.ghost{background:#f4f6f9;color:#4b5563;font-weight:500;margin-top:8px;}',
    '.scan-res{margin:12px 18px 18px;border-top:1px dashed #e6e9ef;padding-top:12px;}',
    '.scan-res-t{font-size:13px;color:#8a94a6;margin-bottom:8px;}',
    '.scan-hit-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #e6e9ef;border-radius:10px;margin-bottom:8px;cursor:pointer;background:#fff;}',
    '.scan-hit-item:hover{border-color:#127a44;background:#f7fdf9;}',
    '.scan-hit-tag{font-size:11.5px;background:#e8f5ee;color:#127a44;border-radius:6px;padding:2px 7px;white-space:nowrap;}',
    '.scan-hit-main{flex:1;min-width:0;}',
    '.scan-hit-t{font-size:14px;color:#1f2d3d;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.scan-hit-s{font-size:12px;color:#8a94a6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.scan-empty{font-size:13.5px;color:#c0392b;background:#fdf1f0;border-radius:10px;padding:10px 12px;line-height:1.7;}',
    '.scan-ok{font-size:13.5px;color:#127a44;background:#eefaf3;border-radius:10px;padding:10px 12px;line-height:1.7;}',
    '.scan-hist{margin:0 18px 18px;}',
    '.scan-hist-h{display:flex;align-items:center;justify-content:space-between;font-size:13px;color:#8a94a6;margin-bottom:8px;}',
    '.scan-hist-h a{color:#8a94a6;font-size:12.5px;cursor:pointer;text-decoration:none;}',
    '.scan-hist-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #f2f4f7;font-size:13px;}',
    '.scan-hist-code{font-family:Consolas,Menlo,monospace;color:#1f2d3d;font-weight:600;}',
    '.scan-hist-lb{color:#8a94a6;font-size:12px;text-align:right;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.scan-toast{position:fixed;left:50%;bottom:64px;transform:translateX(-50%) translateY(20px);background:rgba(31,45,61,.94);color:#fff;padding:11px 20px;border-radius:10px;font-size:14px;z-index:9700;opacity:0;transition:.25s;pointer-events:none;max-width:84vw;text-align:center;}',
    '.scan-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}',
    '.scan-hit{animation:scanPulse 1.5s ease-out 3;background:#fff8e1 !important;}',
    '@keyframes scanPulse{0%{box-shadow:inset 0 0 0 2px #f0a020}100%{box-shadow:inset 0 0 0 2px rgba(240,160,32,0)}}',
    '@media (max-width:560px){.scan-panel{max-height:92vh;border-radius:14px}.scan-head h3{font-size:16px}}'
  ].join('');
  (function injectCss() {
    if ($('scanCss')) return;
    var s = document.createElement('style');
    s.id = 'scanCss';
    s.textContent = CSS;
    document.head.appendChild(s);
  })();

  /* ---------- 面板 ---------- */
  function panelHtml() {
    return '' +
      '<div class="scan-panel">' +
      '  <div class="scan-head"><h3>📷 扫码</h3><button type="button" class="scan-x" onclick="SCAN.close()">✕</button></div>' +
      '  <div class="scan-tabs">' +
      '    <div class="scan-tab on" id="scanTabCam" onclick="SCAN.tab(\'cam\')">📷 摄像头</div>' +
      '    <div class="scan-tab" id="scanTabGun" onclick="SCAN.tab(\'gun\')">⌨️ 扫码枪</div>' +
      '    <div class="scan-tab" id="scanTabMan" onclick="SCAN.tab(\'man\')">✍️ 手动</div>' +
      '  </div>' +
      '  <div class="scan-body">' +
      '    <div id="scanPaneCam">' +
      '      <video class="scan-video" id="scanVideo" playsinline muted></video>' +
      '      <div class="scan-hint" id="scanCamHint">正在启动摄像头…</div>' +
      '      <button type="button" class="scan-btn ghost" onclick="SCAN.stopCam()">停止摄像头</button>' +
      '    </div>' +
      '    <div id="scanPaneGun" style="display:none">' +
      '      <input class="scan-input" id="scanGunInput" placeholder="把光标放在这里，直接用扫码枪扫" autocomplete="off">' +
      '      <div class="scan-hint">扫码枪相当于键盘：保持本框有光标，扫一下会自动带出编号并回车确认。工厂常用的有线/无线扫码枪都适用，无需装任何驱动。</div>' +
      '      <button type="button" class="scan-btn" onclick="SCAN.submitGun()">确认这个编号</button>' +
      '    </div>' +
      '    <div id="scanPaneMan" style="display:none">' +
      '      <input class="scan-input" id="scanManInput" placeholder="输入或粘贴条码 / 编号，如 M20261005001" autocomplete="off">' +
      '      <button type="button" class="scan-btn" onclick="SCAN.submitMan()">查询</button>' +
      '      <div class="scan-hint">支持物料编码、订单号、工单号、入库/出库单号等；也可以输入名称或规格做模糊查询。</div>' +
      '    </div>' +
      '  </div>' +
      '  <div class="scan-res" id="scanRes"></div>' +
      '  <div class="scan-hist">' +
      '    <div class="scan-hist-h"><span>最近扫码</span><a onclick="SCAN.clearHistory()">清空</a></div>' +
      '    <div id="scanHistBody"></div>' +
      '  </div>' +
      '</div>';
  }

  SCAN.open = function () {
    var mask = $('scanMask');
    if (!mask) {
      mask = document.createElement('div');
      mask.id = 'scanMask';
      mask.className = 'scan-mask';
      mask.innerHTML = panelHtml();
      document.body.appendChild(mask);
      mask.addEventListener('click', function (e) { if (e.target === mask) SCAN.close(); });
    }
    mask.classList.add('show');
    SCAN.loadHistory();
    SCAN.renderHistory();
    SCAN.tab('cam');
    setTimeout(function () {
      var g = $('scanGunInput'); if (g) g.focus();
    }, 260);
  };

  SCAN.close = function () {
    SCAN.stopCam();
    var mask = $('scanMask');
    if (mask) mask.classList.remove('show');
  };

  SCAN.tab = function (which) {
    ['cam', 'gun', 'man'].forEach(function (w) {
      var t = $('scanTab' + w.charAt(0).toUpperCase() + w.slice(1));
      if (t) t.className = 'scan-tab' + (w === which ? ' on' : '');
      var p = $('scanPane' + w.charAt(0).toUpperCase() + w.slice(1));
      if (p) p.style.display = (w === which ? '' : 'none');
    });
    if (which === 'cam') SCAN.startCam(); else SCAN.stopCam();
    if (which === 'gun') setTimeout(function () { var g = $('scanGunInput'); if (g) g.focus(); }, 60);
    if (which === 'man') setTimeout(function () { var m = $('scanManInput'); if (m) m.focus(); }, 60);
  };

  /* ---------- 摄像头 ---------- */
  var camStream = null, camTimer = null, camDet = null;

  SCAN.startCam = function () {
    var v = $('scanVideo'), hint = $('scanCamHint');
    if (!v) return;
    var hasDet = (typeof global.BarcodeDetector !== 'undefined');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (hint) hint.innerHTML = '当前环境不支持调用摄像头（需要用 https 打开，或浏览器不允许）。<br>请改用「扫码枪」或「手动」方式。';
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(function (st) {
        camStream = st;
        v.srcObject = st;
        v.play().catch(function () {});
        if (hint) {
          hint.innerHTML = hasDet
            ? '把条码对准取景框，识别到会自动跳转。'
            : '当前浏览器不支持自动识别条码，请用「扫码枪」或「手动」方式（手机端建议用 Chrome / Edge 打开）。';
        }
        if (hasDet) {
          try { camDet = new global.BarcodeDetector(); } catch (e) { camDet = null; }
          if (camDet) camScanLoop();
        }
      })
      .catch(function (err) {
        if (hint) hint.innerHTML = '无法打开摄像头：' + (err && err.name ? err.name : '未知原因') +
          '。<br>请检查浏览器权限，或改用「扫码枪」「手动」方式。';
      });
  };

  function camScanLoop() {
    var v = $('scanVideo');
    if (!v || !camDet) return;
    if (v.readyState < 2) { camTimer = setTimeout(camScanLoop, 300); return; }
    camDet.detect(v).then(function (codes) {
      if (codes && codes.length) {
        var val = codes[0].rawValue || '';
        if (val) {
          SCAN.close();
          SCAN.handle(val);
          return;
        }
      }
      camTimer = setTimeout(camScanLoop, 420);
    }).catch(function () {
      camTimer = setTimeout(camScanLoop, 700);
    });
  }

  SCAN.stopCam = function () {
    if (camTimer) { clearTimeout(camTimer); camTimer = null; }
    if (camStream) {
      try { camStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      camStream = null;
    }
    var v = $('scanVideo');
    if (v) { try { v.srcObject = null; } catch (e) {} }
  };

  /* ---------- 输入提交 ---------- */
  SCAN.submitGun = function () {
    var el = $('scanGunInput'); if (!el) return;
    var v = (el.value || '').trim();
    if (!v) { toast('请先扫码或输入编号'); return; }
    el.value = '';
    SCAN.handle(v);
  };
  SCAN.submitMan = function () {
    var el = $('scanManInput'); if (!el) return;
    var v = (el.value || '').trim();
    if (!v) { toast('请输入条码或编号'); return; }
    SCAN.handle(v);
  };

  /* ---------- 结果渲染 ---------- */
  SCAN.renderResult = function (code, res, quiet) {
    var box = $('scanRes');
    if (!box) return;
    if (quiet) { box.innerHTML = ''; return; }
    if (!code) { box.innerHTML = ''; return; }
    if (!res) res = SCAN.resolve(code);

    var head = '<div class="scan-res-t">扫描结果 · ' + esc(code) + '</div>';

    if (res.kind === 'erp') {
      box.innerHTML = head + '<div class="scan-ok">✅ 已定位到「' + esc(res.ent ? res.ent.name : '') + '」：' +
        esc(res.row.code || '') + (res.row.name ? ' · ' + esc(res.row.name) : '') + '<br>列表已打开，该行会闪烁高亮。</div>';
      return;
    }
    if (res.kind === 'open') {
      box.innerHTML = head + '<div class="scan-ok">已打开「' + esc(res.label) + '」模块。该模块里暂时没有编号为 ' +
        esc(code) + ' 的记录，可在列表中用「＋ 新增」建档。</div>';
      return;
    }
    if (res.kind === 'multi') {
      var h = head + '<div class="scan-res-t" style="margin-top:2px">匹配到 ' + res.hits.length + ' 条，点击打开：</div>';
      res.hits.forEach(function (it) {
        h += '<div class="scan-hit-item" onclick="SCAN.pick(\'' + esc(it.key) + '\',\'' + esc(it.title || '') + '\')">' +
          '<span class="scan-hit-tag">' + esc(it.label) + '</span>' +
          '<span class="scan-hit-main"><span class="scan-hit-t">' + esc(it.title || '') + '</span>' +
          '<span class="scan-hit-s">' + esc(it.sub || '') + '</span></span></div>';
      });
      box.innerHTML = h;
      return;
    }
    box.innerHTML = head + '<div class="scan-empty">❌ 没有找到与「' + esc(code) + '」匹配的物料或单据。<br>' +
      '可以到「🔍 全局搜索」里换个关键词，或确认这个条码是否已经建档。</div>';
  };

  SCAN.pick = function (key, code) {
    gotoErp(key);
    var row = null;
    erpList(key).forEach(function (r) { if (r && String(r.code) === String(code)) row = r; });
    SCAN.highlightRow(row);
    SCAN.close();
    toast('已打开：' + code);
  };

  /* ---------- 历史渲染 ---------- */
  SCAN.renderHistory = function () {
    var box = $('scanHistBody');
    if (!box) return;
    if (!SCAN.history.length) { box.innerHTML = '<div style="font-size:12.5px;color:#b6bcc8;padding:6px 0">还没有扫码记录</div>'; return; }
    var h = '';
    SCAN.history.slice(0, 8).forEach(function (it) {
      h += '<div class="scan-hist-row">' +
        '<span class="scan-hist-code" onclick="SCAN.handle(\'' + esc(it.code) + '\')" style="cursor:pointer">' + esc(it.code) + '</span>' +
        '<span class="scan-hist-lb">' + esc(it.label || '') + '</span></div>';
    });
    box.innerHTML = h;
  };

  /* ---------- 扫码枪全局监听（面板没开也能用） ---------- */
  (function gunListener() {
    var buf = '', last = 0;
    document.addEventListener('keydown', function (e) {
      var mask = $('scanMask');
      var opened = mask && mask.classList.contains('show');
      var tag = (e.target && e.target.tagName || '').toUpperCase();
      var typing = (tag === 'INPUT' || tag === 'TEXTAREA');
      if (opened) return;              /* 面板开着时交给面板自己的输入框 */
      if (typing) return;              /* 正常打字时不抢 */
      var now = Date.now();
      if (now - last > 120) buf = '';  /* 间隔过长，重新起头 */
      last = now;
      if (e.key === 'Enter') {
        if (buf.length >= 4) { SCAN.handle(buf); buf = ''; e.preventDefault(); }
        return;
      }
      if (e.key && e.key.length === 1 && /[A-Za-z0-9\-_\.]/.test(e.key)) {
        buf += e.key;
        if (buf.length > 64) buf = buf.slice(-64);
      }
    }, true);
  })();

  /* ---------- 快捷键 ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'F8') { e.preventDefault(); SCAN.open(); }
  });

  global.SCAN = SCAN;
})(window);
