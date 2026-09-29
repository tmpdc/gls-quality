/* gls-pqs.js — 品质资料库 v2：资料查询 + 可视化增删改 + 数据备份
 * 数据来源：pqs-data.js（出厂种子）→ 首次加载写入 localStorage → 之后全部本地可改
 * 存储键：gls_pqs_db_v1
 */
(function () {
  'use strict';

  var LS_KEY = 'gls_pqs_db_v1';
  var SAMPLING_KEY = 'sampling';

  /* ================= 字段字典（改这里即可调整表单与列表列） ================= */
  var SCHEMA = {
    material: {
      title: '物料检验标准', icon: '🔩', autoPrefix: 'M',
      fields: [
        { k: 'code', label: '物料编码', type: 'text', req: true, w: 130 },
        { k: 'name', label: '物料名称', type: 'text', req: true, w: 120 },
        { k: 'cls', label: '分类', type: 'select', opts: ['电器件', '电子', '五金件', '塑胶件', '塑料件', '不锈钢件', '硅胶件', '软胶件', '包材', '包装件', '标贴件', '辅料'], w: 90 },
        { k: 'ver', label: '版本', type: 'text', w: 60 },
        { k: 'key', label: '关键检验要求', type: 'textarea', req: true, w: 320 },
        { k: 'tool', label: '检验手段', type: 'text', w: 170 }
      ]
    },
    param: {
      title: '标准参数库', icon: '📏', autoPrefix: 'PM',
      fields: [
        { k: 'id', label: '参数编号', type: 'text', w: 80 },
        { k: 'n', label: '参数名', type: 'text', req: true, w: 150 },
        { k: 'min', label: '下限', type: 'number', w: 80 },
        { k: 'max', label: '上限', type: 'number', w: 80 },
        { k: 'unit', label: '单位', type: 'text', w: 70 },
        { k: 'dev', label: '测试条件 / 方法', type: 'textarea', w: 240 },
        { k: 'src', label: '依据', type: 'text', w: 150 },
        { k: 'pid', label: '适用产品', type: 'text', w: 90 }
      ]
    },
    process: {
      title: '工序清单', icon: '🔧', autoPrefix: 'op',
      fields: [
        { k: 'p', label: '产品编号', type: 'text', w: 90 },
        { k: 'code', label: '工序号', type: 'text', w: 80 },
        { k: 'name', label: '工序名称', type: 'text', req: true, w: 240 },
        { k: 'key', label: '关键工序', type: 'checkbox', w: 80 },
        { k: 'note', label: '注意事项 / 检验点', type: 'textarea', w: 320 }
      ]
    },
    product: {
      title: '产品清单', icon: '📦', autoPrefix: 'P',
      fields: [
        { k: 'id', label: '产品编号', type: 'text', w: 80 },
        { k: 'name', label: '产品名称', type: 'text', req: true, w: 150 },
        { k: 'model', label: '型号', type: 'text', w: 120 },
        { k: 'status', label: '状态', type: 'select', opts: ['量产', '试产', '规划', '停产', '—'], w: 80 },
        { k: 'sop', label: 'SOP / 工艺文件', type: 'text', w: 260 },
        { k: 'note', label: '说明', type: 'textarea', w: 320 }
      ]
    },
    supplier: {
      title: '供应商档案', icon: '🏭', autoPrefix: '',
      fields: [
        { k: 'name', label: '供应商名称', type: 'text', req: true, w: 120 },
        { k: 'type', label: '类型', type: 'text', w: 110 },
        { k: 'supply', label: '供应物料', type: 'textarea', w: 320 },
        { k: 'cap', label: '产能', type: 'text', w: 180 }
      ]
    },
    doc: {
      title: '标准文件库', icon: '📄', autoPrefix: 'GLS-',
      fields: [
        { k: 'code', label: '文件编号', type: 'text', req: true, w: 140 },
        { k: 'name', label: '名称', type: 'text', req: true, w: 220 },
        { k: 'type', label: '类型', type: 'select', opts: ['标准', '表单', 'SOP', '制度', '记录', '外来文件'], w: 90 },
        { k: 'ver', label: '版本', type: 'text', w: 60 },
        { k: 'link', label: '文件链接 / 存放路径', type: 'text', w: 200 },
        { k: 'desc', label: '说明', type: 'textarea', w: 300 }
      ]
    },
    safety: {
      title: '关键安规参数', icon: '⚡', autoPrefix: '',
      fields: [
        { k: 'n', label: '项目', type: 'text', req: true, w: 150 },
        { k: 'v', label: '参数 / 要求', type: 'textarea', req: true, w: 400 }
      ]
    }
  };

  /* ================= 工具 ================= */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function uid() { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function cp(o) { return JSON.parse(JSON.stringify(o)); }
  function toast(msg, ok) {
    var t = $('pqsToast');
    if (!t) { t = document.createElement('div'); t.id = 'pqsToast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'pqs-toast show' + (ok === false ? ' err' : '');
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.className = 'pqs-toast'; }, 2400);
  }

  /* ================= 数据层 ================= */
  var DB = null;
  var LAST = { view: 'home', cat: null, kw: '' };

  function seedDB() {
    var d = window.PQS_DATA || {};
    return {
      material: cp(d.materials || []),
      param: cp(d.params || []),
      process: cp(d.processes || []),
      product: cp(d.products || []),
      supplier: cp(d.suppliers || []),
      doc: cp(d.docs || []),
      safety: cp(d.safety || []),
      sampling: cp(d.sampling || [])
    };
  }
  function ensureIds(db) {
    Object.keys(SCHEMA).forEach(function (cat) {
      if (!db[cat]) db[cat] = [];
      db[cat].forEach(function (r) { if (!r._id) r._id = uid(); });
    });
    db.sampling = (db.sampling || []).map(function (s) {
      if (typeof s === 'string') return { _id: uid(), text: s };
      if (!s._id) s._id = uid();
      if (s.text == null) s.text = String(s);
      return s;
    });
    return db;
  }
  function loadDB() {
    try {
      var p = (window.DATAHUB && DATAHUB.get('pqs')) || (function () {
        try { var raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
      })();
      if (p && p.material) return ensureIds(p);
    } catch (e) { }
    var db = ensureIds(seedDB());
    try { if (window.DATAHUB) DATAHUB.set('pqs', db); else localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch (e) { }
    return db;
  }
  function saveDB() {
    try {
      if (window.DATAHUB) { DATAHUB.set('pqs', DB); return true; }
      localStorage.setItem(LS_KEY, JSON.stringify(DB)); return true;
    }
    catch (e) { toast('保存失败：' + e.message, false); return false; }
  }
  function rows(cat) { return DB[cat] || (DB[cat] = []); }
  function findRec(cat, id) {
    var arr = rows(cat);
    for (var i = 0; i < arr.length; i++) if (arr[i]._id === id) return arr[i];
    return null;
  }
  function nextCode(cat) {
    var s = SCHEMA[cat];
    if (!s || !s.autoPrefix) return '';
    var key = (cat === 'param' || cat === 'product') ? 'id' : 'code';
    var prefix = s.autoPrefix, max = 0;
    rows(cat).forEach(function (r) {
      var v = String(r[key] || '');
      if (v.indexOf(prefix) === 0) {
        var n = parseInt(v.slice(prefix.length).replace(/\D/g, ''), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
    if (cat === 'process') return prefix + (max + 1);
    var pad = function (n) { return n < 10 ? '00' + n : (n < 100 ? '0' + n : '' + n); };
    return prefix + pad(max + 1);
  }

  /* ================= 样式（自注入） ================= */
  function injectCSS() {
    if ($('pqsStyleV2')) return;
    var s = document.createElement('style');
    s.id = 'pqsStyleV2';
    s.textContent = [
      '#page-pqs-home,#page-pqs-list,#page-pqs-manage{padding:20px;box-sizing:border-box;max-width:1500px;margin:0 auto;}',
      '#page-pqs-home .erp-stats{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:16px;}',
      '#page-pqs-home .stat-card{background:#fff;border-radius:10px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.06);}',
      '#page-pqs-home .stat-num{font-size:24px;font-weight:700;color:#2c5e36;}',
      '#page-pqs-home .stat-label{font-size:12px;color:#888;margin-top:4px;}',
      '.erp-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin-bottom:20px;}',
      '.erp-card{background:#fff;border-radius:10px;padding:16px;display:flex;align-items:center;gap:12px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.06);transition:.2s;}',
      '.erp-card:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.1);}',
      '.erp-card-icon{font-size:26px;}',
      '.erp-card-name{font-weight:600;font-size:14px;}',
      '.erp-card-desc{font-size:12px;color:#888;margin-top:3px;}',
      '.erp-card-count{margin-left:auto;background:#ecf5ff;color:#409eff;padding:2px 10px;border-radius:10px;font-size:13px;flex-shrink:0;}',
      '.pqs-searchbar{margin:16px 0;}',
      '.pqs-searchbar input{width:100%;padding:11px 14px;border:1px solid #dcdfe6;border-radius:8px;font-size:14px;box-sizing:border-box;}',
      '.pqs-section{margin:22px 0;}',
      '.pqs-section h3{margin:0 0 10px;font-size:15px;color:#303133;}',
      '.pqs-bullet{padding-left:20px;line-height:1.9;color:#606266;margin:0;}',
      '.erp-table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);}',
      '.erp-table th,.erp-table td{padding:9px 11px;text-align:left;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:top;line-height:1.6;}',
      '.erp-table th{background:#fafafa;font-weight:600;color:#333;white-space:nowrap;}',
      '.erp-table tr:hover td{background:#fafcff;}',
      '.pqs-cell-key{font-size:12px;color:#606266;}',
      '.pqs-range{font-family:Consolas,monospace;color:#e6a23c;font-weight:600;white-space:nowrap;}',
      '.erp-list-head{display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;}',
      '.erp-list-head h2{margin:0;font-size:18px;}',
      '.erp-search{flex:1;min-width:180px;padding:8px 12px;border:1px solid #dcdfe6;border-radius:6px;font-size:14px;}',
      '.btn-ghost{padding:8px 14px;background:#fff;border:1px solid #dcdfe6;border-radius:6px;cursor:pointer;font-size:13px;}',
      '.btn-ghost:hover{border-color:#2c5e36;color:#2c5e36;}',
      '.pqs-btn{padding:7px 12px;background:#fff;border:1px solid #dcdfe6;border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit;}',
      '.pqs-btn:hover{border-color:#2c5e36;color:#2c5e36;}',
      '.pqs-btn-primary{background:#2c5e36;color:#fff;border-color:#2c5e36;}',
      '.pqs-btn-primary:hover{background:#3a7a47;color:#fff;border-color:#3a7a47;}',
      '.pqs-btn-danger{color:#f56c6c;border-color:#fbc4c4;}',
      '.pqs-btn-danger:hover{background:#fef0f0;color:#f56c6c;border-color:#f56c6c;}',
      '.pqs-btn-xs{padding:3px 9px;font-size:12px;border-radius:4px;cursor:pointer;background:#fff;border:1px solid #dcdfe6;font-family:inherit;}',
      '.pqs-btn-xs:hover{border-color:#2c5e36;color:#2c5e36;}',
      '.pqs-tag{display:inline-block;padding:1px 7px;border-radius:4px;background:#f0f2f5;color:#606266;font-size:12px;}',
      '.pqs-tag-red{background:#fef0f0;color:#f56c6c;}',
      '.pqs-empty{padding:40px;text-align:center;color:#999;background:#fff;border-radius:8px;}',
      '.pqs-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:10000;}',
      '.pqs-modal{background:#fff;border-radius:12px;width:min(760px,94vw);max-height:88vh;display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.2);}',
      '.pqs-mhead{padding:16px 20px;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center;font-weight:600;}',
      '.pqs-mx{cursor:pointer;font-size:22px;color:#999;line-height:1;padding:0 4px;}',
      '.pqs-mx:hover{color:#333;}',
      '.pqs-mbody{padding:18px 20px;overflow-y:auto;}',
      '.pqs-mfoot{padding:14px 20px;border-top:1px solid #f0f0f0;display:flex;justify-content:flex-end;gap:10px;}',
      '.pqs-field{margin-bottom:14px;}',
      '.pqs-field > label{display:block;font-size:13px;color:#606266;margin-bottom:6px;}',
      '.pqs-field > label .req{color:#f56c6c;margin-left:3px;}',
      '.pqs-field input[type=text],.pqs-field input[type=number],.pqs-field textarea,.pqs-field select{width:100%;padding:8px 10px;border:1px solid #dcdfe6;border-radius:6px;font-size:13px;box-sizing:border-box;font-family:inherit;}',
      '.pqs-field textarea{min-height:72px;resize:vertical;line-height:1.6;}',
      '.pqs-field input:focus,.pqs-field textarea:focus,.pqs-field select:focus{outline:none;border-color:#2c5e36;}',
      '.pqs-toast{position:fixed;left:50%;bottom:60px;transform:translateX(-50%) translateY(20px);background:rgba(48,49,51,.92);color:#fff;padding:11px 22px;border-radius:8px;font-size:14px;opacity:0;pointer-events:none;transition:.25s;z-index:10001;}',
      '.pqs-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}',
      '.pqs-toast.err{background:#f56c6c;}',
      '.pqs-mgcard{background:#fff;border-radius:10px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.06);}',
      '.pqs-mgcard h3{margin:0 0 6px;font-size:15px;}',
      '.pqs-mgcard p{margin:0 0 14px;font-size:13px;color:#888;line-height:1.7;}',
      '.pqs-mgrow{display:flex;gap:10px;flex-wrap:wrap;}',
      '@media(max-width:820px){#page-pqs-home .erp-stats{grid-template-columns:repeat(2,1fr);}}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ================= 主页 ================= */
  function stat(label, v) {
    return '<div class="stat-card"><div class="stat-num">' + v + '</div><div class="stat-label">' + label + '</div></div>';
  }
  var DESCS = {
    material: '物料 · 关键检验要求 + 检验手段',
    param: '安规/工艺参数 · min~max 范围',
    process: '装配工序 · 关键工序标注',
    product: '产品 · 型号/SOP/状态',
    supplier: '供应商 · 产能/供货品类',
    doc: '体系文件 · 版本/依据'
  };
  function homeHTML() {
    var h = '<div class="erp-stats">'
      + stat('物料种类', rows('material').length)
      + stat('标准参数', rows('param').length)
      + stat('工序总数', rows('process').length)
      + stat('产品', rows('product').length)
      + stat('供应商', rows('supplier').length)
      + stat('体系文件', rows('doc').length)
      + '</div>';

    h += '<div class="pqs-searchbar"><input id="pqsGlobalSearch" '
      + 'placeholder="🔍 全局搜索：物料编码 / 名称 / 检验要求 / 参数 / 工序 / 文件编号…（回车）" '
      + 'onkeydown="if(event.key===\'Enter\')PQS.globalSearch(this.value)"></div>';

    h += '<div class="erp-card-grid">';
    Object.keys(SCHEMA).forEach(function (k) {
      if (k === 'safety') return;
      h += '<div class="erp-card" onclick="PQS.openList(\'' + k + '\')">'
        + '<div class="erp-card-icon">' + SCHEMA[k].icon + '</div>'
        + '<div><div class="erp-card-name">' + SCHEMA[k].title + '</div>'
        + '<div class="erp-card-desc">' + DESCS[k] + '</div></div>'
        + '<div class="erp-card-count">' + rows(k).length + '</div></div>';
    });
    h += '<div class="erp-card" onclick="PQS.openManage()">'
      + '<div class="erp-card-icon">⚙️</div>'
      + '<div><div class="erp-card-name">数据管理</div>'
      + '<div class="erp-card-desc">新增 / 备份导出 / 导入 / 恢复出厂</div></div></div>';
    h += '</div>';

    h += '<div class="pqs-section"><div class="erp-list-head">'
      + '<h3 style="margin:0">⚡ 关键安规参数速查（OQC 成品测试）</h3>'
      + '<button class="pqs-btn" onclick="PQS.openList(\'safety\')">管理 / 新增</button></div>';
    h += '<table class="erp-table"><thead><tr><th style="width:200px">项目</th><th>参数</th></tr></thead><tbody>';
    rows('safety').forEach(function (s) { h += '<tr><td><b>' + esc(s.n) + '</b></td><td>' + esc(s.v) + '</td></tr>'; });
    h += '</tbody></table></div>';

    h += '<div class="pqs-section"><div class="erp-list-head">'
      + '<h3 style="margin:0">📋 抽样与允收（GB/T 2828.1-2012）</h3>'
      + '<button class="pqs-btn" onclick="PQS.openList(\'sampling\')">管理 / 新增</button></div>';
    h += '<ul class="pqs-bullet">';
    rows('sampling').forEach(function (s) { h += '<li>' + esc(s.text) + '</li>'; });
    h += '</ul></div>';

    return h;
  }

  /* ================= 列表 ================= */
  function match(s, kw) { return !kw || String(s == null ? '' : s).toLowerCase().indexOf(kw) >= 0; }
  function filterRows(cat, kw) {
    if (!kw) return rows(cat).slice();
    return rows(cat).filter(function (r) {
      return Object.keys(r).some(function (k) { return k !== '_id' && match(r[k], kw); });
    });
  }

  function listHTML(cat, kw) {
    kw = (kw || '').trim().toLowerCase();
    var isSample = (cat === SAMPLING_KEY);
    var title = isSample ? '抽样与允收' : (SCHEMA[cat] ? SCHEMA[cat].title : '');
    var list = isSample
      ? rows('sampling').filter(function (s) { return match(s.text, kw); })
      : filterRows(cat, kw);

    var h = '<div class="erp-list-head">'
      + '<button class="btn-ghost" onclick="PQS.openHome()">← 返回</button>'
      + '<h2>' + title + '（' + list.length + '）</h2>'
      + '<input class="erp-search" placeholder="在当前列表搜索…" value="' + esc(kw) + '" '
      + 'oninput="PQS.openList(\'' + cat + '\', this.value)">'
      + '<button class="pqs-btn pqs-btn-primary" onclick="PQS.openForm(\'' + cat + '\')">＋ 新增</button>'
      + '<button class="pqs-btn" onclick="PQS.exportExcel(\'' + cat + '\')">导出 Excel</button>'
      + '</div>';

    if (isSample) h += sampleTable(list);
    else if (SCHEMA[cat]) h += genericTable(cat, list);
    else h += '<div class="pqs-empty">未知分类</div>';
    return h;
  }

  function genericTable(cat, list) {
    var s = SCHEMA[cat];
    var cols = s.fields.filter(function (f) { return f.type !== 'checkbox'; });
    var hasKey = s.fields.some(function (f) { return f.type === 'checkbox'; });

    var h = '<table class="erp-table"><thead><tr>';
    cols.forEach(function (f) { h += '<th>' + esc(f.label) + '</th>'; });
    if (hasKey) h += '<th style="width:70px">关键</th>';
    h += '<th style="width:120px">操作</th></tr></thead><tbody>';

    if (!list.length) {
      h += '<tr><td colspan="' + (cols.length + 2) + '" style="text-align:center;color:#999;padding:36px">'
        + '暂无数据，点击右上角「＋ 新增」</td></tr>';
    }
    list.forEach(function (r) {
      h += '<tr>';
      cols.forEach(function (f) {
        var v = r[f.k];
        var td;
        if (f.k === 'name' || f.k === 'n') td = '<b>' + esc(v) + '</b>';
        else if (f.k === 'min' || f.k === 'max') td = '<span class="pqs-range">' + esc(v == null || v === '' ? '—' : v) + '</span>';
        else if (f.k === 'cls' || f.k === 'type' || f.k === 'status') td = '<span class="pqs-tag">' + esc(v || '—') + '</span>';
        else td = esc(v == null || v === '' ? '—' : v);
        var cls = (f.type === 'textarea') ? ' class="pqs-cell-key"' : '';
        h += '<td' + cls + '>' + td + '</td>';
      });
      if (hasKey) h += '<td>' + (r.key ? '<span class="pqs-tag pqs-tag-red">关键</span>' : '—') + '</td>';
      h += '<td><button class="pqs-btn-xs" onclick="PQS.openForm(\'' + cat + '\',\'' + r._id + '\')">编辑</button> '
        + '<button class="pqs-btn-xs" onclick="PQS.del(\'' + cat + '\',\'' + r._id + '\')">删除</button></td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  function sampleTable(list) {
    var h = '<table class="erp-table"><thead><tr><th>内容</th><th style="width:120px">操作</th></tr></thead><tbody>';
    if (!list.length) h += '<tr><td colspan="2" style="text-align:center;color:#999;padding:36px">暂无内容，点击右上角「＋ 新增」</td></tr>';
    list.forEach(function (s) {
      h += '<tr><td>' + esc(s.text) + '</td>'
        + '<td><button class="pqs-btn-xs" onclick="PQS.openForm(\'sampling\',\'' + s._id + '\')">编辑</button> '
        + '<button class="pqs-btn-xs" onclick="PQS.del(\'sampling\',\'' + s._id + '\')">删除</button></td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  /* ================= 表单 ================= */
  function fieldHTML(f, val) {
    var v = (val == null) ? '' : val;
    var h = '<div class="pqs-field"><label>' + esc(f.label)
      + (f.req ? '<span class="req">*</span>' : '') + '</label>';
    if (f.type === 'textarea') {
      h += '<textarea data-k="' + f.k + '">' + esc(v) + '</textarea>';
    } else if (f.type === 'select') {
      h += '<select data-k="' + f.k + '"><option value="">— 请选择 —</option>';
      var opts = (f.opts || []).slice();
      if (v && opts.indexOf(v) < 0) opts.unshift(v);
      opts.forEach(function (o) {
        h += '<option value="' + esc(o) + '"' + (String(o) === String(v) ? ' selected' : '') + '>' + esc(o) + '</option>';
      });
      h += '</select>';
    } else if (f.type === 'checkbox') {
      h += '<label style="font-weight:400;display:flex;align-items:center;gap:6px">'
        + '<input type="checkbox" data-k="' + f.k + '"' + (v ? ' checked' : '') + ' style="width:auto;margin:0"> 是</label>';
    } else {
      h += '<input type="' + (f.type === 'number' ? 'number' : 'text') + '" data-k="' + f.k + '" value="' + esc(v) + '">';
    }
    return h + '</div>';
  }

  function openForm(cat, id) {
    var isSample = (cat === SAMPLING_KEY);
    var rec = {};
    if (id) {
      rec = isSample
        ? (rows('sampling').filter(function (x) { return x._id === id; })[0] || {})
        : (findRec(cat, id) || {});
    }
    var title = isSample ? '抽样与允收' : (SCHEMA[cat] ? SCHEMA[cat].title : '');
    var body = '';

    if (isSample) {
      body += fieldHTML({ k: 'text', label: '内容', type: 'textarea', req: true }, rec.text);
    } else {
      var codeKey = (cat === 'param' || cat === 'product') ? 'id' : 'code';
      SCHEMA[cat].fields.forEach(function (f) {
        var val = rec[f.k];
        if (!id && (val == null || val === '') && f.k === codeKey) val = nextCode(cat);
        body += fieldHTML(f, val);
      });
    }

    var mask = document.createElement('div');
    mask.className = 'pqs-mask';
    mask.id = 'pqsMask';
    mask.innerHTML = '<div class="pqs-modal">'
      + '<div class="pqs-mhead"><span>' + (id ? '编辑' : '新增') + ' · ' + title + '</span><span class="pqs-mx" id="pqsMx">×</span></div>'
      + '<div class="pqs-mbody">' + body + '</div>'
      + '<div class="pqs-mfoot"><button class="pqs-btn" id="pqsCancel">取消</button>'
      + '<button class="pqs-btn pqs-btn-primary" id="pqsSave">保存</button></div></div>';
    document.body.appendChild(mask);

    $('pqsMx').onclick = closeForm;
    $('pqsCancel').onclick = closeForm;
    mask.onclick = function (e) { if (e.target === mask) closeForm(); };
    $('pqsSave').onclick = function () { saveForm(cat, id, isSample); };
    setTimeout(function () {
      var first = mask.querySelector('input[type=text],textarea,select');
      if (first) first.focus();
    }, 60);
  }

  function closeForm() {
    var m = $('pqsMask');
    if (m) m.remove();
  }

  function saveForm(cat, id, isSample) {
    var mask = $('pqsMask');
    if (!mask) return;
    var rec = {};

    if (isSample) {
      var ta = mask.querySelector('textarea[data-k="text"]');
      var txt = ta ? ta.value.trim() : '';
      if (!txt) { toast('内容不能为空', false); return; }
      rec.text = txt;
    } else {
      var s = SCHEMA[cat], miss = null;
      s.fields.forEach(function (f) {
        var el = mask.querySelector('[data-k="' + f.k + '"]');
        if (!el) return;
        var v = (f.type === 'checkbox') ? el.checked : el.value;
        if (typeof v === 'string') v = v.trim();
        if (f.type === 'number' && v !== '') v = Number(v);
        if (f.req && (v === '' || v == null)) { if (!miss) miss = f; }
        rec[f.k] = v;
      });
      if (miss) { toast('「' + miss.label + '」为必填项', false); return; }
    }

    if (id) {
      if (isSample) {
        var t = rows('sampling').filter(function (x) { return x._id === id; })[0];
        if (t) t.text = rec.text;
      } else {
        var old = findRec(cat, id);
        if (old) Object.keys(rec).forEach(function (k) { old[k] = rec[k]; });
      }
      toast('已保存修改');
    } else {
      rec._id = uid();
      rows(cat).push(rec);
      toast('已新增 1 条');
    }
    saveDB();
    closeForm();
    if (LAST.cat === cat) openList(cat, LAST.kw); else openHome();
  }

  function del(cat, id) {
    var isSample = (cat === SAMPLING_KEY);
    var name = '';
    if (isSample) {
      var t = rows('sampling').filter(function (x) { return x._id === id; })[0];
      name = t ? String(t.text).slice(0, 24) : '';
    } else {
      var r = findRec(cat, id);
      name = r ? (r.name || r.n || r.code || r.id || '') : '';
    }
    if (!confirm('确定删除「' + name + '」？\n删除后不可恢复（可先到「数据管理」导出备份）。')) return;
    if (isSample) DB.sampling = rows('sampling').filter(function (x) { return x._id !== id; });
    else DB[cat] = rows(cat).filter(function (x) { return x._id !== id; });
    saveDB();
    toast('已删除');
    if (LAST.cat === cat) openList(cat, LAST.kw); else openHome();
  }

  /* ================= 数据管理 ================= */
  function countAll(d) {
    var n = 0;
    Object.keys(SCHEMA).forEach(function (k) { n += (d[k] || []).length; });
    return n + (d.sampling || []).length;
  }

  function openManage() {
    showPage('page-pqs-manage');
    var h = '<div class="erp-list-head"><button class="btn-ghost" onclick="PQS.openHome()">← 返回</button>'
      + '<h2>⚙️ 数据管理</h2></div>';

    h += '<div class="pqs-mgcard"><h3>当前数据量</h3>'
      + '<p>共 ' + countAll(DB) + ' 条：'
      + Object.keys(SCHEMA).map(function (k) { return SCHEMA[k].title + ' ' + rows(k).length; }).join(' · ')
      + ' · 抽样与允收 ' + rows('sampling').length + '</p>'
      + '<p style="color:#e6a23c">数据保存在本机浏览器里。换电脑、清理浏览器缓存前，请先「导出备份」。</p></div>';

    h += '<div class="pqs-mgcard"><h3>备份与恢复</h3>'
      + '<p>导出 JSON 备份文件可存到 U 盘或网盘；换电脑时用「导入备份」还原。</p>'
      + '<div class="pqs-mgrow">'
      + '<button class="pqs-btn pqs-btn-primary" onclick="PQS.exportAll()">⬇ 导出全部数据（JSON 备份）</button>'
      + '<button class="pqs-btn" onclick="document.getElementById(\'pqsImportFile\').click()">⬆ 导入备份文件</button>'
      + '<input type="file" id="pqsImportFile" accept=".json" style="display:none" onchange="PQS.importAll(this)">'
      + '</div></div>';

    h += '<div class="pqs-mgcard"><h3>恢复与同步</h3>'
      + '<p>「合并出厂数据」把系统自带的条目补进来，不影响你新增的内容；'
      + '「恢复出厂数据」清空你的全部改动，回到系统初始状态。</p>'
      + '<div class="pqs-mgrow">'
      + '<button class="pqs-btn" onclick="PQS.mergeSeed()">🔄 合并出厂数据（保留我的新增）</button>'
      + '<button class="pqs-btn pqs-btn-danger" onclick="PQS.resetSeed()">⚠ 恢复出厂数据（清空我的改动）</button>'
      + '</div></div>';

    h += '<div class="pqs-mgcard"><h3>批量新增</h3>'
      + '<p>把 Excel 里的多行内容直接粘进来，每行一条，字段用 Tab 或竖线「|」分隔，留空的列会自动跳过。</p>'
      + '<div class="pqs-mgrow">'
      + Object.keys(SCHEMA).map(function (k) {
        return '<button class="pqs-btn" onclick="PQS.openBatch(\'' + k + '\')">批量加 ' + SCHEMA[k].title + '</button>';
      }).join('')
      + '</div></div>';

    $('pqsManageBody').innerHTML = h;
    setTitle('⚙️ 数据管理');
  }

  function exportAll() {
    var payload = { _type: 'gls-pqs-backup', _ver: 2, _at: new Date().toISOString(), data: DB };
    download(JSON.stringify(payload, null, 2), '格丽思品质资料备份-' + stamp() + '.json', 'application/json');
    toast('已导出备份文件');
  }

  function importAll(input) {
    var f = input.files && input.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        var d = obj.data || obj;
        if (!d || !d.material) throw new Error('文件格式不正确');
        if (!confirm('导入将覆盖当前全部数据（当前 ' + countAll(DB) + ' 条 → 备份 ' + countAll(d) + ' 条）。\n继续吗？')) return;
        DB = ensureIds(d);
        saveDB();
        toast('导入成功');
        openManage();
      } catch (e) {
        toast('导入失败：' + e.message, false);
      }
    };
    reader.readAsText(f, 'utf-8');
    input.value = '';
  }

  function mergeSeed() {
    var sd = ensureIds(seedDB());
    var added = 0;
    var kfMap = { material: 'code', doc: 'code', process: 'code', param: 'id', product: 'id', supplier: 'name', safety: 'n' };
    Object.keys(SCHEMA).forEach(function (cat) {
      var kf = kfMap[cat];
      var exist = {};
      rows(cat).forEach(function (r) { exist[String(r[kf]) + '|' + String(r.p || '')] = 1; });
      (sd[cat] || []).forEach(function (r) {
        var key = String(r[kf]) + '|' + String(r.p || '');
        if (!exist[key]) { rows(cat).push(r); added++; }
      });
    });
    (sd.sampling || []).forEach(function (s) {
      if (!rows('sampling').some(function (x) { return x.text === s.text; })) { rows('sampling').push(s); added++; }
    });
    saveDB();
    toast(added ? ('已补入 ' + added + ' 条出厂数据') : '出厂数据已是最新，无需补充');
    openManage();
  }

  function resetSeed() {
    if (!confirm('将清空你的全部改动，恢复到系统初始数据。\n建议先导出备份。确定继续？')) return;
    DB = ensureIds(seedDB());
    saveDB();
    toast('已恢复出厂数据');
    openManage();
  }

  /* ================= 批量新增 ================= */
  function openBatch(cat) {
    var s = SCHEMA[cat];
    var labels = s.fields.map(function (f) { return f.label; });

    var mask = document.createElement('div');
    mask.className = 'pqs-mask';
    mask.id = 'pqsMask';
    mask.innerHTML = '<div class="pqs-modal">'
      + '<div class="pqs-mhead"><span>批量新增 · ' + s.title + '</span><span class="pqs-mx" id="pqsMx">×</span></div>'
      + '<div class="pqs-mbody">'
      + '<p style="font-size:13px;color:#888;margin:0 0 12px;line-height:1.8">列顺序：<b>' + labels.join(' | ') + '</b><br>'
      + '每行一条，可直接从 Excel 复制整列或多列粘贴。</p>'
      + '<textarea data-k="batch" style="width:100%;min-height:230px;padding:10px;border:1px solid #dcdfe6;border-radius:6px;font-family:Consolas,monospace;font-size:12px;box-sizing:border-box;line-height:1.7"></textarea></div>'
      + '<div class="pqs-mfoot"><button class="pqs-btn" id="pqsCancel">取消</button>'
      + '<button class="pqs-btn pqs-btn-primary" id="pqsSave">导入</button></div></div>';
    document.body.appendChild(mask);

    $('pqsMx').onclick = closeForm;
    $('pqsCancel').onclick = closeForm;
    mask.onclick = function (e) { if (e.target === mask) closeForm(); };
    $('pqsSave').onclick = function () {
      var ta = mask.querySelector('textarea[data-k="batch"]');
      var lines = (ta.value || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) { toast('请先粘贴内容', false); return; }
      var ok = 0, bad = 0;
      lines.forEach(function (line) {
        var parts = line.split(/\t|\|/).map(function (x) { return x.trim(); });
        var rec = { _id: uid() }, miss = false;
        s.fields.forEach(function (f, i) {
          var v = parts[i] == null ? '' : parts[i];
          if (f.type === 'checkbox') v = /^(是|1|y|yes|true|关键)$/i.test(v);
          else if (f.type === 'number' && v !== '') v = Number(v);
          if (f.req && (v === '' || v == null)) miss = true;
          rec[f.k] = v;
        });
        if (miss) { bad++; return; }
        rows(cat).push(rec); ok++;
      });
      saveDB();
      closeForm();
      toast('成功导入 ' + ok + ' 条' + (bad ? ('，跳过 ' + bad + ' 条（缺必填项）') : ''));
      openList(cat);
    };
  }

  /* ================= 导出 Excel ================= */
  function exportExcel(cat) {
    var isSample = (cat === SAMPLING_KEY);
    var title = isSample ? '抽样与允收' : (SCHEMA[cat] ? SCHEMA[cat].title : '数据');
    var list = isSample ? rows('sampling') : rows(cat);
    if (!list.length) { toast('暂无数据可导出', false); return; }

    var thead, tbody = '';
    if (isSample) {
      thead = '<tr><th>内容</th></tr>';
      list.forEach(function (r) { tbody += '<tr><td>' + esc(r.text) + '</td></tr>'; });
    } else {
      var s = SCHEMA[cat];
      thead = '<tr>' + s.fields.map(function (f) { return '<th>' + esc(f.label) + '</th>'; }).join('') + '</tr>';
      list.forEach(function (r) {
        tbody += '<tr>' + s.fields.map(function (f) {
          var v = r[f.k];
          if (f.type === 'checkbox') return '<td>' + (v ? '是' : '') + '</td>';
          return '<td>' + esc(v == null ? '' : v) + '</td>';
        }).join('') + '</tr>';
      });
    }
    var html = '<table><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table>';

    if (typeof window.exportHtmlTableToXlsx === 'function') {
      window.exportHtmlTableToXlsx(html, '格丽思-' + title + '-' + stamp() + '.xlsx', title);
      toast('已导出 Excel');
    } else {
      toast('导出组件未加载', false);
    }
  }

  /* ================= 全局搜索 ================= */
  function globalSearch(kw) {
    if (!kw || !kw.trim()) { openHome(); return; }
    kw = kw.trim().toLowerCase();
    var groups = Object.keys(SCHEMA).map(function (cat) {
      return { cat: cat, title: SCHEMA[cat].title, list: filterRows(cat, kw) };
    }).concat([{
      cat: 'sampling', title: '抽样与允收',
      list: rows('sampling').filter(function (s) { return match(s.text, kw); })
    }]);
    var total = groups.reduce(function (a, g) { return a + g.list.length; }, 0);

    showPage('page-pqs-list');
    setTitle('🔍 搜索：' + kw);
    LAST = { view: 'search', cat: null, kw: kw };

    var h = '<div class="erp-list-head"><button class="btn-ghost" onclick="PQS.openHome()">← 返回</button>'
      + '<h2>🔍 「' + esc(kw) + '」共 ' + total + ' 条结果</h2></div>';
    groups.forEach(function (g) {
      if (!g.list.length) return;
      h += '<div class="pqs-section"><h3>' + g.title + '（' + g.list.length + '） '
        + '<button class="pqs-btn-xs" onclick="PQS.openList(\'' + g.cat + '\')">进入列表</button></h3>';
      h += (g.cat === 'sampling') ? sampleTable(g.list) : genericTable(g.cat, g.list);
      h += '</div>';
    });
    if (!total) h += '<div class="pqs-empty">未找到与「' + esc(kw) + '」相关的资料</div>';
    $('pqsListBody').innerHTML = h;
  }

  /* ================= 路由 ================= */
  var CUR = '';
  function showPage(id) {
    document.querySelectorAll('.page').forEach(function (el) { el.classList.remove('active'); });
    var el = $(id);
    if (el) el.classList.add('active');
    CUR = id;
    window.scrollTo(0, 0);
  }
  function applyActive() {
    document.querySelectorAll('.sidebar .nav-item, #sidebarNav .nav-item').forEach(function (n) {
      n.classList.toggle('active', n.getAttribute('data-pqs-entry') === '1');
    });
    var fab = document.getElementById('fabAdd');
    if (fab) fab.style.display = 'none';
    var sb = document.getElementById('searchBtn');
    if (sb) sb.style.display = 'none';
  }
  function setTitle(t) {
    var el = document.getElementById('pageTitle');
    if (el) el.textContent = t;
    injectSidebar();   // 侧边栏入口可能被其它脚本重建过，先确保它在
    applyActive();
  }
  function openHome() {
    showPage('page-pqs-home');
    $('pqsHome').innerHTML = homeHTML();
    setTitle('📚 品质资料库');
    LAST = { view: 'home', cat: null, kw: '' };
  }
  function openList(cat, kw) {
    showPage('page-pqs-list');
    LAST = { view: 'list', cat: cat, kw: kw || '' };
    $('pqsListBody').innerHTML = listHTML(cat, kw);
    setTitle('📚 ' + ((cat === SAMPLING_KEY) ? '抽样与允收' : (SCHEMA[cat] ? SCHEMA[cat].title : '')));
  }

  /* ================= 侧边栏 ================= */
  function injectSidebar() {
    var nav = $('sidebarNav');
    if (!nav) return;
    if (nav.querySelector('[data-pqs-entry]')) return;   // 已在，不重复插
    var html = '<div class="nav-item" data-pqs-entry="1" onclick="PQS.openHome()">'
      + '<span class="nav-icon">📚</span><span class="nav-text">品质资料库</span></div>';
    var first = nav.querySelector('.nav-section, .nav-item');
    if (first) first.insertAdjacentHTML('beforebegin', html);
    else nav.insertAdjacentHTML('afterbegin', html);
  }

  /* ================= 下载 ================= */
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }
  function download(text, filename, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 300);
  }

  /* ================= 初始化 ================= */
  function init() {
    injectCSS();
    DB = loadDB();
    injectSidebar();
    setInterval(function () {
      injectSidebar();
      if (CUR.indexOf('page-pqs-') === 0) applyActive();
    }, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.PQS = {
    openHome: openHome, openList: openList, openManage: openManage, globalSearch: globalSearch,
    openForm: openForm, saveForm: saveForm, del: del, closeForm: closeForm,
    exportAll: exportAll, importAll: importAll, mergeSeed: mergeSeed, resetSeed: resetSeed,
    openBatch: openBatch, exportExcel: exportExcel,
    _db: function () { return DB; }, _seed: function () { return ensureIds(seedDB()); }
  };
})();
