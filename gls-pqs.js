/* gls-pqs.js — 品质资料库：物料检验标准 / 标准参数库 / 工序 / 产品 / 供应商 / 标准文件 */
(function () {
  var D = window.PQS_DATA;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- 主页 ---------- */
  function homeHTML() {
    var cards = [
      { k: 'material', icon: '🔩', name: '物料检验标准', desc: '73 种物料 · 关键检验要求+检验手段', n: D.materials.length },
      { k: 'param',    icon: '📏', name: '标准参数库',   desc: '12 项安规/工艺参数 · min~max 范围', n: D.params.length },
      { k: 'process',  icon: '🔧', name: '工序清单',     desc: '89 道装配工序 · 关键工序标红', n: D.processes.length },
      { k: 'product',  icon: '📦', name: '产品清单',     desc: '8 个产品 · BOM/SOP/状态', n: D.products.length },
      { k: 'supplier', icon: '🏭', name: '供应商档案',   desc: '24 家供应商 · 产能/品类', n: D.suppliers.length },
      { k: 'doc',      icon: '📄', name: '标准文件库',   desc: '体系文件 · 版本/依据/抽样方案', n: D.docs.length },
    ];
    var h = '<div class="erp-home">';
    h += '<div class="erp-stats">';
    h += stat('物料种类', D.materials.length);
    h += stat('标准参数', D.params.length);
    h += stat('工序总数', D.processes.length);
    h += stat('供应商', D.suppliers.length);
    h += stat('体系文件', D.docs.length);
    h += '</div>';

    // 全局搜索
    h += '<div class="pqs-searchbar"><input id="pqsGlobalSearch" placeholder="🔍 全局搜索：物料编码/名称/检验要求/参数/工序/文件编号…（回车）" onkeydown="if(event.key===\'Enter\')PQS.globalSearch(this.value)"></div>';

    h += '<div class="erp-card-grid">';
    cards.forEach(function (c) {
      h += '<div class="erp-card" onclick="PQS.openList(\'' + c.k + '\')">'
        + '<div class="erp-card-icon">' + c.icon + '</div>'
        + '<div class="erp-card-body"><div class="erp-card-name">' + c.name + '</div>'
        + '<div class="erp-card-desc">' + c.desc + '</div></div>'
        + '<div class="erp-card-count">' + c.n + '</div></div>';
    });
    h += '</div>';

    // 关键安规参数卡（置顶速查）
    h += '<div class="pqs-section"><h3>⚡ 关键安规参数速查（OQC 成品测试）</h3><table class="erp-table"><thead><tr><th>项目</th><th>参数</th></tr></thead><tbody>';
    D.safety.forEach(function (s) { h += '<tr><td><b>' + esc(s.n) + '</b></td><td>' + esc(s.v) + '</td></tr>'; });
    h += '</tbody></table></div>';

    // 抽样方案
    h += '<div class="pqs-section"><h3>📋 抽样与允收（GB/T 2828.1-2012）</h3><ul class="pqs-bullet">';
    D.sampling.forEach(function (s) { h += '<li>' + esc(s) + '</li>'; });
    h += '</ul></div>';

    h += '</div>';
    return h;
  }
  function stat(label, v) {
    return '<div class="stat-card"><div class="stat-num">' + v + '</div><div class="stat-label">' + label + '</div></div>';
  }

  /* ---------- 列表页 ---------- */
  var KIND_TITLE = {
    material: '物料检验标准', param: '标准参数库', process: '工序清单',
    product: '产品清单', supplier: '供应商档案', doc: '标准文件库'
  };

  function listHTML(kind, kw) {
    kw = (kw || '').trim().toLowerCase();
    var rows = filterRows(kind, kw);
    var h = '<div class="erp-list-page">';
    h += '<div class="erp-list-head"><button class="btn-ghost" onclick="PQS.openHome()">← 返回</button>';
    h += '<h2>' + KIND_TITLE[kind] + '（' + rows.length + '）</h2>';
    h += '<input class="erp-search" placeholder="在当前列表搜索…" value="' + esc(kw) + '" oninput="PQS.openList(\'' + kind + '\', this.value)">';
    h += '</div>';

    if (kind === 'material') h += materialTable(rows);
    else if (kind === 'param') h += paramTable(rows);
    else if (kind === 'process') h += processTable(rows);
    else if (kind === 'product') h += productTable(rows);
    else if (kind === 'supplier') h += supplierTable(rows);
    else if (kind === 'doc') h += docTable(rows);
    h += '</div>';
    return h;
  }

  function match(s, kw) { return !kw || String(s || '').toLowerCase().indexOf(kw) >= 0; }

  function filterRows(kind, kw) {
    if (kind === 'material') return D.materials.filter(function (m) {
      return match(m.code, kw) || match(m.name, kw) || match(m.cls, kw) || match(m.key, kw) || match(m.tool, kw);
    });
    if (kind === 'param') return D.params.filter(function (p) {
      return match(p.n, kw) || match(p.unit, kw) || match(p.src, kw) || match(p.dev, kw);
    });
    if (kind === 'process') return D.processes.filter(function (p) {
      return match(p.code, kw) || match(p.name, kw) || match(p.note, kw) || match(p.p, kw);
    });
    if (kind === 'product') return D.products.filter(function (p) {
      return match(p.name, kw) || match(p.model, kw) || match(p.note, kw) || match(p.sop, kw) || match(p.key, kw);
    });
    if (kind === 'supplier') return D.suppliers.filter(function (s) {
      return match(s.name, kw) || match(s.type, kw) || match(s.supply, kw) || match(s.cap, kw);
    });
    if (kind === 'doc') return D.docs.filter(function (d) {
      return match(d.code, kw) || match(d.name, kw) || match(d.type, kw) || match(d.desc, kw);
    });
    return [];
  }

  function materialTable(rows) {
    var h = '<table class="erp-table"><thead><tr><th>物料编码</th><th>物料名称</th><th>分类</th><th>版本</th><th>关键检验要求</th><th>检验手段</th></tr></thead><tbody>';
    rows.forEach(function (m) {
      h += '<tr><td><b>' + esc(m.code) + '</b></td><td>' + esc(m.name) + '</td>'
        + '<td><span class="tag">' + esc(m.cls) + '</span></td>'
        + '<td>' + esc(m.ver) + '</td>'
        + '<td class="pqs-key">' + esc(m.key) + '</td>'
        + '<td>' + esc(m.tool) + '</td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }
  function paramTable(rows) {
    var h = '<table class="erp-table"><thead><tr><th>参数编号</th><th>参数名</th><th>标准范围</th><th>单位</th><th>测试条件/方法</th><th>依据</th></tr></thead><tbody>';
    rows.forEach(function (p) {
      h += '<tr><td>' + esc(p.id) + '</td><td><b>' + esc(p.n) + '</b></td>'
        + '<td class="pqs-range">' + esc(p.min) + ' ~ ' + esc(p.max) + '</td>'
        + '<td>' + esc(p.unit) + '</td>'
        + '<td>' + esc(p.dev) + '</td>'
        + '<td>' + esc(p.src) + '</td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }
  function processTable(rows) {
    var h = '<table class="erp-table"><thead><tr><th>产品</th><th>工序号</th><th>工序名称</th><th>关键</th><th>注意事项/检验点</th></tr></thead><tbody>';
    rows.forEach(function (p) {
      h += '<tr><td>' + esc(p.p) + '</td><td><b>' + esc(p.code) + '</b></td><td>' + esc(p.name) + '</td>'
        + '<td>' + (p.key ? '<span class="tag tag-red">关键</span>' : '—') + '</td>'
        + '<td>' + esc(p.note) + '</td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }
  function productTable(rows) {
    var h = '<table class="erp-table"><thead><tr><th>产品编号</th><th>产品名称</th><th>型号</th><th>状态</th><th>SOP</th><th>说明</th></tr></thead><tbody>';
    rows.forEach(function (p) {
      h += '<tr><td>' + esc(p.id) + '</td><td><b>' + esc(p.name) + '</b></td>'
        + '<td>' + esc(p.model) + '</td>'
        + '<td>' + esc(p.status || p.ver || '—') + '</td>'
        + '<td>' + esc(p.sop || p.key || '') + '</td>'
        + '<td>' + esc(p.note) + '</td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }
  function supplierTable(rows) {
    var h = '<table class="erp-table"><thead><tr><th>供应商</th><th>类型</th><th>供应物料</th><th>产能</th></tr></thead><tbody>';
    rows.forEach(function (s) {
      h += '<tr><td><b>' + esc(s.name) + '</b></td><td>' + esc(s.type) + '</td><td>' + esc(s.supply) + '</td><td>' + esc(s.cap) + '</td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }
  function docTable(rows) {
    var h = '<table class="erp-table"><thead><tr><th>文件编号</th><th>名称</th><th>类型</th><th>版本</th><th>说明</th></tr></thead><tbody>';
    rows.forEach(function (d) {
      h += '<tr><td><b>' + esc(d.code) + '</b></td><td>' + esc(d.name) + '</td>'
        + '<td><span class="tag">' + esc(d.type) + '</span></td>'
        + '<td>' + esc(d.ver) + '</td><td>' + esc(d.desc) + '</td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  /* ---------- 路由 ---------- */
  function showPage(id) {
    document.querySelectorAll('.page').forEach(function (el) { el.classList.remove('active'); });
    var el = $(id);
    if (el) el.classList.add('active');
    if (window.scrollTo) window.scrollTo(0, 0);
  }
  function openHome() {
    showPage('page-pqs-home');
    $('pqsHome').innerHTML = homeHTML();
    var hdr = document.querySelector('.topbar h1, .topbar-title');
    if (hdr) hdr.textContent = '📚 品质资料库';
  }
  function openList(kind, kw) {
    showPage('page-pqs-list');
    $('pqsListBody').innerHTML = listHTML(kind, kw);
    var hdr = document.querySelector('.topbar h1, .topbar-title');
    if (hdr) hdr.textContent = '📚 ' + (KIND_TITLE[kind] || '');
  }
  function globalSearch(kw) {
    if (!kw) { openHome(); return; }
    // 全局搜索：聚合所有类型，结果按类型分组
    kw = kw.trim();
    var groups = [
      { k: 'material', title: '物料检验标准', rows: filterRows('material', kw) },
      { k: 'param', title: '标准参数库', rows: filterRows('param', kw) },
      { k: 'process', title: '工序', rows: filterRows('process', kw) },
      { k: 'product', title: '产品', rows: filterRows('product', kw) },
      { k: 'supplier', title: '供应商', rows: filterRows('supplier', kw) },
      { k: 'doc', title: '标准文件', rows: filterRows('doc', kw) },
    ];
    var total = 0;
    groups.forEach(function (g) { total += g.rows.length; });
    showPage('page-pqs-list');
    var h = '<div class="erp-list-head"><button class="btn-ghost" onclick="PQS.openHome()">← 返回</button><h2>🔍 搜索：' + esc(kw) + '（' + total + ' 条结果）</h2></div>';
    groups.forEach(function (g) {
      if (!g.rows.length) return;
      h += '<div class="pqs-section"><h3>' + g.title + '（' + g.rows.length + '）</h3>';
      if (g.k === 'material') h += materialTable(g.rows);
      else if (g.k === 'param') h += paramTable(g.rows);
      else if (g.k === 'process') h += processTable(g.rows);
      else if (g.k === 'product') h += productTable(g.rows);
      else if (g.k === 'supplier') h += supplierTable(g.rows);
      else if (g.k === 'doc') h += docTable(g.rows);
      h += '</div>';
    });
    if (!total) h += '<p style="padding:30px;color:#888">未找到与「' + esc(kw) + '」相关的资料</p>';
    $('pqsListBody').innerHTML = h;
  }

  /* ---------- 侧边栏注入 ---------- */
  function injectSidebar() {
    var nav = $('sidebarNav');
    if (!nav || nav.querySelector('[data-pqs-entry]')) return;
    var html = '<div class="nav-item" data-pqs-entry="1" onclick="PQS.openHome()">📚 品质资料库</div>';
    // 插到"质量管理"分组前面
    var qm = nav.querySelector('.nav-section');
    if (qm) qm.insertAdjacentHTML('beforebegin', html);
    else nav.insertAdjacentHTML('afterbegin', html);
  }

  document.addEventListener('DOMContentLoaded', function () {
    injectSidebar();
    // 每次切页后也尝试注入（应对动态重建侧边栏）
    setInterval(injectSidebar, 2000);
  });

  window.PQS = { openHome: openHome, openList: openList, globalSearch: globalSearch };
})();
