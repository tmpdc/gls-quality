/* ============================================================
 * 格丽思 · 部门数据看板（GLS_DASH v2）
 * 按部门、按环节自动提取系统内业务数据，生成详细数据可视化。
 * 数据源（全部实时提取，不写死统计值）：
 *   - 检验记录  gls_inspect_db_v1 → INSP._db().inspections
 *   - 中央数据  gls_quality_data_v2 → suppliers/abnormal/rd/training/documents/accounts
 *   - ERP 业务  central.erp.{material,so,po,stockIn,...}
 * 无数据时显示空态引导，录入后自动填充。
 * 部门数据源映射集中在下方 DEPTS 配置（可视化修改口子）。
 * ============================================================ */
(function () {
  'use strict';

  var LS_INSP = 'gls_inspect_db_v1';
  var LS_CENTRAL = 'gls_quality_data_v2';

  /* ---------- 检验环节 / 部门归属（可改） ---------- */
  var TYPE_META = {
    ALL:    { name: '全部环节', dept: '品质部 · 生产部 · 仓储部' },
    IQC:    { name: '来料检验', dept: '品质部 · 来料检验　→　仓储部入库' },
    FIRST:  { name: '首件检验', dept: '生产部 · 首件确认（IPQC＋生产）' },
    PATROL: { name: '过程巡检', dept: '生产部 · 过程巡检（IPQC）' },
    OQC:    { name: '成品检验', dept: '品质部 · 成品检验　→　仓储部入库' }
  };
  var TYPE_ORDER = ['IQC', 'FIRST', 'PATROL', 'OQC'];
  var DEFECT_KEYS = ['defectType', 'defects', 'defect', 'reason', 'failReason', 'desc', 'note', 'measured'];
  var STATUS_ORDER = ['待审批', '待评审', '已流转', '已驳回'];
  var STATUS_COLOR = { '待审批': '#2563eb', '待评审': '#fa8c16', '已流转': '#2d7a4f', '已驳回': '#ef4444' };
  var COL = { green: '#16a34a', blue: '#2563eb', orange: '#f59e0b', red: '#ef4444', slate: '#64748b', cyan: '#0ea5e9', purple: '#8b5cf6' };

  /* ---------- 部门数据源配置（可视化修改口子：改这里即可调整各部门看板） ---------- */
  var DEPTS = [
    { id: 'quality',  name: '品质部', icon: '🔬', desc: '来料 / 首件 / 巡检 / 成品检验 · 不合格评审' },
    { id: 'production', name: '生产部', icon: '🏭', desc: '首件确认 · 过程巡检 · 生产工单 · 异常处理' },
    { id: 'warehouse', name: '仓储部', icon: '📦', desc: '库存台账 · 出入库 · 库位 · 安全库存预警' },
    { id: 'purchasing', name: '采购部', icon: '🛒', desc: '供应商档案 · 来料良率 · 采购订单与收货' },
    { id: 'sales',    name: '销售部', icon: '💼', desc: '成品检验 · 销售订单 · 发货退货 · 客诉' },
    { id: 'rd',       name: '研发部', icon: '🧪', desc: '研发项目 · BOM · 检测设备' },
    { id: 'admin',    name: '行政人事部', icon: '👤', desc: '人员账号 · 培训记录 · 体系文件' }
  ];

  var S = { dept: 'quality', type: 'ALL', range: 'all' };
  var charts = {};
  var _inited = false;

  /* ============ 数据层 ============ */
  function getDB() {
    try { if (window.INSP && typeof INSP._db === 'function') { var d = INSP._db(); if (d && Array.isArray(d.inspections)) return d; } } catch (e) {}
    try { if (window.DATAHUB && typeof DATAHUB.get === 'function') { var p = DATAHUB.get('inspect'); if (p && Array.isArray(p.inspections)) return p; } } catch (e) {}
    try { var raw = localStorage.getItem(LS_INSP); if (raw) { var p2 = JSON.parse(raw); if (p2 && Array.isArray(p2.inspections)) return p2; } } catch (e) {}
    return { inspections: [], flowLog: [] };
  }
  function getCentral() {
    try { return JSON.parse(localStorage.getItem(LS_CENTRAL) || '{}'); } catch (e) { return {}; }
  }
  function getErp() {
    var c = getCentral();
    return (c.erp && typeof c.erp === 'object') ? c.erp : {};
  }
  /* 业务记录：排除模板 */
  function bizOf(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (x) {
      return !x.isTemplate && String(x.id || '').indexOf('tpl_') !== 0 && String(x.id || '').indexOf('TPL') !== 0;
    });
  }

  function filterRecs(recs) {
    var t = S.type, rng = S.range, out = [];
    recs.forEach(function (r) {
      if (t !== 'ALL' && r.type !== t) return;
      if (rng !== 'all') {
        var ds = String(r.date || '').trim();
        if (ds) {
          var dnum = new Date(ds.replace(/-/g, '/')).getTime();
          if (!isNaN(dnum)) {
            var nowD = new Date(); nowD.setHours(0, 0, 0, 0);
            var days = rng === '30' ? 30 : 7;
            if (dnum < nowD.getTime() - days * 86400000) return;
          }
        }
      }
      out.push(r);
    });
    return out;
  }

  function stats(recs) {
    var total = recs.length, pass = 0, fail = 0, qtySum = 0;
    recs.forEach(function (r) {
      if (r.result === 'pass') pass++;
      else if (r.result === 'fail') fail++;
      var q = parseFloat(r.qty);
      if (!isNaN(q)) qtySum += q;
    });
    return {
      total: total, pass: pass, fail: fail, qtySum: qtySum,
      passRate: total ? (pass / total * 100) : 0,
      failRate: total ? (fail / total * 100) : 0
    };
  }

  /* ============ 工具 ============ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmt(n, d) { return Number(n).toFixed(d == null ? 1 : d); }
  function pct(n) { return fmt(n, 1) + '%'; }
  function dateStr() {
    var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function countUp(el, target, dur, fmt) {
    var t0 = null;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / (dur || 1200), 1);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt ? fmt(target * e) : String(Math.round(target * e));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function rankHtml(arr, max, suf, dec) {
    var h = '';
    arr.forEach(function (x, i) {
      var w = Math.max((x.n / max) * 100, 3);
      h += '<div class="gd-rank"><span class="rk' + (i < 3 ? ' t' : '') + '">' + (i + 1) + '</span><span class="nm">' + esc(x.key) + '</span><span class="ln"><i style="width:' + w.toFixed(1) + '%"></i></span><span class="vl">' + fmt(x.n, dec == null ? 0 : dec) + (suf || '') + '</span></div>';
    });
    return h;
  }

  function initChart(id, option) {
    var el = document.getElementById(id);
    if (!el || !window.echarts) return null;
    try {
      if (charts[id]) { try { charts[id].dispose(); } catch (e) {} }
      var c = echarts.init(el);
      c.setOption(option);
      charts[id] = c;
      return c;
    } catch (e) { return null; }
  }
  function disposeAll() {
    Object.keys(charts).forEach(function (k) { try { charts[k].dispose(); } catch (e) {} delete charts[k]; });
  }
  function resizeAll() {
    Object.keys(charts).forEach(function (k) { try { charts[k].resize(); } catch (e) {} });
  }
  function extractDefects(rec) {
    for (var i = 0; i < DEFECT_KEYS.length; i++) {
      var v = rec[DEFECT_KEYS[i]];
      if (v == null) continue;
      var s = String(v).trim();
      if (!s) continue;
      if (/^(—|-|无|na|n\/a)$/i.test(s)) continue;
      return s.split(/[,，、;；\/]+/).map(function (x) { return x.trim(); }).filter(function (x) { return x; });
    }
    return [];
  }

  /* ============ 聚合 ============ */
  function byType(recs) {
    var map = {};
    TYPE_ORDER.forEach(function (t) { map[t] = []; });
    recs.forEach(function (r) { if (map[r.type]) map[r.type].push(r); });
    return map;
  }
  function byDate(recs) {
    var map = {}, keys = [];
    recs.forEach(function (r) {
      var d = String(r.date || '未注明').slice(0, 10);
      if (!map[d]) { map[d] = []; keys.push(d); }
      map[d].push(r);
    });
    keys.sort();
    return { map: map, keys: keys };
  }
  function byGroup(recs, field) {
    var map = {};
    recs.forEach(function (r) {
      var k = String(r[field] || '').trim();
      if (!k) k = '未填写';
      if (!map[k]) map[k] = [];
      map[k].push(r);
    });
    return map;
  }
  function groupSummary(map) {
    var arr = [];
    Object.keys(map).forEach(function (k) {
      var s = stats(map[k]);
      arr.push({ key: k, count: s.total, pass: s.pass, fail: s.fail, rate: s.passRate });
    });
    return arr;
  }
  function groupCount(arr, field) {
    var map = {};
    (arr || []).forEach(function (x) {
      var k = String(x[field] || '').trim();
      if (!k) k = '未填写';
      map[k] = (map[k] || 0) + 1;
    });
    return map;
  }
  function sumField(arr, field) {
    var s = 0;
    (arr || []).forEach(function (x) {
      var v = parseFloat(x[field]);
      if (!isNaN(v)) s += v;
    });
    return s;
  }
  function statusCn(st) {
    return { pending: '待处理', doing: '进行中', done: '已完成', urgent: '紧急' }[st] || st || '未填写';
  }

  /* ============ CSS ============ */
  function css() {
    if (document.getElementById('glsDashStyle')) return;
    var st = document.createElement('style');
    st.id = 'glsDashStyle';
    st.textContent = [
      '#glsDashRoot{font-family:inherit}',
      '.gd-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}',
      '.gd-title{font-size:17px;font-weight:700;color:#1e293b}',
      '.gd-dept-tab{display:flex;gap:6px;flex-wrap:wrap}',
      '.gd-dept-tab button{border:1px solid #d7e0ec;background:#fff;color:#334155;padding:7px 13px;border-radius:8px;cursor:pointer;font-size:13px;transition:all .15s}',
      '.gd-dept-tab button.on{background:#2563eb;border-color:#2563eb;color:#fff;font-weight:600}',
      '.gd-tab{display:flex;gap:6px;flex-wrap:wrap}',
      '.gd-tab button{border:1px solid #d7e0ec;background:#fff;color:#334155;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12.5px}',
      '.gd-tab button.on{background:#e0ecff;border-color:#2563eb;color:#1d4ed8;font-weight:600}',
      '.gd-meta{color:#64748b;font-size:12px;line-height:1.7;margin-bottom:12px}',
      '.gd-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin-bottom:14px}',
      '.gd-kpi{background:#fff;border:1px solid #e8eef5;border-radius:10px;padding:12px 14px;box-shadow:0 1px 3px rgba(15,23,42,.05)}',
      '.gd-kpi .v{font-size:21px;font-weight:700;color:#1e293b;line-height:1.3}',
      '.gd-kpi .v.g{color:#16a34a}.gd-kpi .v.r{color:#ef4444}.gd-kpi .v.b{color:#2563eb}.gd-kpi .v.o{color:#f59e0b}.gd-kpi .v.p{color:#8b5cf6}',
      '.gd-kpi .l{font-size:12px;color:#64748b;margin-top:2px}',
      '.gd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:12px}',
      '.gd-card{background:#fff;border:1px solid #e8eef5;border-radius:12px;padding:14px 14px 6px;box-shadow:0 1px 3px rgba(15,23,42,.05)}',
      '.gd-card h4{margin:0 0 4px;font-size:14px;color:#1e293b;display:flex;align-items:center;gap:8px}',
      '.gd-card .gd-sub{font-size:11px;color:#94a3b8;margin-bottom:6px}',
      '.gd-chart{width:100%;height:250px}',
      '.gd-chart.tall{height:280px}',
      '.gd-empty{background:#fff;border:1px dashed #d7e0ec;border-radius:12px;padding:40px 20px;text-align:center;color:#64748b;margin-top:12px}',
      '.gd-empty .t{font-size:15px;color:#334155;margin-bottom:8px}',
      '.gd-empty button{margin-top:12px;background:#2563eb;color:#fff;border:0;padding:9px 18px;border-radius:8px;cursor:pointer;font-size:13px}',
      '.gd-empty2{background:#f8fafc;border:1px dashed #d7e0ec;border-radius:10px;padding:26px 14px;text-align:center;color:#94a3b8;font-size:12.5px}',
      '.gd-table-wrap{overflow-x:auto}',
      '.gd-table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px}',
      '.gd-table th{background:#f1f5f9;color:#475569;padding:7px 8px;text-align:left;white-space:nowrap;border-bottom:1px solid #e2e8f0}',
      '.gd-table td{padding:7px 8px;border-bottom:1px solid #eef2f7;color:#334155;white-space:nowrap}',
      '.gd-tag{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600}',
      '.gd-tag.pass{background:#dcfce7;color:#15803d}.gd-tag.fail{background:#fee2e2;color:#b91c1c}',
      '@media(max-width:640px){.gd-kpis{grid-template-columns:repeat(2,1fr)}.gd-grid{grid-template-columns:1fr}.gd-chart{height:225px}}',
      /* 销售高颜值看板 */
      '.gd-sales-hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:12px;margin-bottom:14px}',
      '.gd-s-hero{position:relative;border-radius:14px;padding:15px 16px;color:#fff;overflow:hidden;min-height:84px;box-shadow:0 4px 14px rgba(15,23,42,.12)}',
      '.gd-s-hero .num{font-size:24px;font-weight:800;letter-spacing:.5px;line-height:1.25;font-variant-numeric:tabular-nums}',
      '.gd-s-hero .num small{font-size:13px;font-weight:600;opacity:.9}',
      '.gd-s-hero .lb{font-size:12px;opacity:.9;margin-top:5px}',
      '.gd-s-hero .ic{position:absolute;right:12px;top:10px;font-size:24px;opacity:.3}',
      '.gd-s-hero.b1{background:linear-gradient(135deg,#2563eb,#60a5fa)}',
      '.gd-s-hero.b2{background:linear-gradient(135deg,#7c3aed,#a78bfa)}',
      '.gd-s-hero.b3{background:linear-gradient(135deg,#0891b2,#22d3ee)}',
      '.gd-s-hero.b4{background:linear-gradient(135deg,#059669,#34d399)}',
      '.gd-s-hero.b5{background:linear-gradient(135deg,#d97706,#fbbf24)}',
      '.gd-s-hero.b6{background:linear-gradient(135deg,#dc2626,#f87171)}',
      '.gd-target-card{background:linear-gradient(135deg,#f8fafc,#eef2ff);border:1px solid #e0e7ff;border-radius:14px;padding:16px 18px;margin-bottom:14px}',
      '.gd-target-card .tt{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px}',
      '.gd-target-card .tt .t{font-size:14px;font-weight:700;color:#312e81}',
      '.gd-target-card .tt .set{display:flex;gap:6px;align-items:center}',
      '.gd-target-card input{width:78px;padding:5px 8px;border:1px solid #c7d2fe;border-radius:7px;font-size:13px;color:#312e81;outline:none}',
      '.gd-target-card button{border:0;background:#6366f1;color:#fff;padding:6px 13px;border-radius:7px;font-size:12.5px;cursor:pointer}',
      '.gd-bar{height:16px;background:#e0e7ff;border-radius:99px;overflow:hidden;position:relative}',
      '.gd-bar i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,#6366f1,#8b5cf6);transition:width 1.2s cubic-bezier(.22,1,.36,1)}',
      '.gd-bar i.gt{background:linear-gradient(90deg,#059669,#34d399)}',
      '.gd-target-card .pr{display:flex;justify-content:space-between;align-items:flex-end;margin-top:10px;font-size:12px;color:#64748b;flex-wrap:wrap;gap:6px}',
      '.gd-target-card .pr b{font-size:24px;color:#4338ca;font-variant-numeric:tabular-nums}',
      '.gd-rank{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9}',
      '.gd-rank:last-child{border-bottom:0}',
      '.gd-rank .rk{width:22px;height:22px;border-radius:7px;background:#eef2ff;color:#4f46e5;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none}',
      '.gd-rank .rk.t{background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#78350f}',
      '.gd-rank .nm{flex:1;font-size:12.5px;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.gd-rank .ln{width:36%;flex:none}',
      '.gd-rank .ln i{display:block;height:7px;border-radius:99px;background:linear-gradient(90deg,#6366f1,#a5b4fc)}',
      '.gd-rank .vl{width:74px;text-align:right;font-size:12.5px;font-weight:700;color:#1e293b;flex:none;font-variant-numeric:tabular-nums}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ============ 渲染主入口 ============ */
  function render() {
    css();
    var root = document.getElementById('glsDashRoot');
    if (!root) return;
    disposeAll();
    var dept = deptOf();
    var html = '';
    html += '<div class="gd-top">'
      + '<span class="gd-title">📊 部门数据看板</span>'
      + '<div class="gd-dept-tab">' + DEPTS.map(function (d) {
          return '<button class="' + (S.dept === d.id ? 'on' : '') + '" onclick="GLS_DASH.setDept(\'' + d.id + '\')">' + d.icon + ' ' + d.name + '</button>';
        }).join('') + '</div>'
      + '<button style="border:1px solid #d7e0ec;background:#fff;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:13px;margin-left:auto" onclick="GLS_DASH.render()">↻ 刷新</button>'
      + '</div>';
    html += '<div class="gd-meta">' + esc(dept.name) + '　｜　' + esc(dept.desc) + '　｜　更新时间 ' + dateStr() + '<br>数据来源：系统业务数据自动提取（检验记录 / 档案 / ERP）· 录入数据后本看板自动填充</div>';
    /* 品质部保留环节 / 时间筛选 */
    if (S.dept === 'quality') {
      html += '<div class="gd-tab" style="margin-bottom:10px">'
        + Object.keys(TYPE_META).map(function (t) {
            return '<button class="' + (S.type === t ? 'on' : '') + '" onclick="GLS_DASH.setType(\'' + t + '\')">' + TYPE_META[t].name + '</button>';
          }).join('')
        + '<span style="width:1px;background:#d7e0ec;display:inline-block;margin:0 4px"></span>'
        + [['all', '全部时间'], ['30', '近30天'], ['7', '近7天']].map(function (r) {
            return '<button class="' + (S.range === r[0] ? 'on' : '') + '" onclick="GLS_DASH.setRange(\'' + r[0] + '\')">' + r[1] + '</button>';
          }).join('')
        + '</div>';
    }
    root.innerHTML = html;
    var body = document.createElement('div');
    body.id = 'glsDashBody';
    root.appendChild(body);
    renderDept(S.dept);
  }

  function deptOf() {
    for (var i = 0; i < DEPTS.length; i++) if (DEPTS[i].id === S.dept) return DEPTS[i];
    return DEPTS[0];
  }

  function kpi(label, value, cls) {
    return '<div class="gd-kpi"><div class="v ' + (cls || '') + '">' + value + '</div><div class="l">' + label + '</div></div>';
  }
  function card(title, sub, id, cls) {
    return '<div class="gd-card"><h4>' + title + '</h4><div class="gd-sub">' + sub + '</div><div class="gd-chart' + (cls ? ' ' + cls : '') + '" id="' + id + '"></div></div>';
  }
  function empty2(text) {
    return '<div class="gd-empty2">' + text + '</div>';
  }
  function cardEmpty(title, text) {
    return '<div class="gd-card"><h4>' + title + '</h4><div class="gd-sub">数据为空</div>' + empty2(text) + '</div>';
  }

  /* ================================================================
   * 品质部：检验全环节详细数据（合格率/不良率/原因/供应商/物料/趋势）
   * ================================================================ */

  function renderQuality(recs) {
    var s = stats(recs);
    var b = document.getElementById('glsDashBody');
    var html = '';

    if (!s.total) {
      html += '<div class="gd-empty"><div class="t">品质部暂无检验数据，无法生成看板</div>'
        + '<div style="font-size:13px">在「检验工作台」录入来料 / 首件 / 巡检 / 成品检验记录后，本部门看板将自动生成合格率、不良率、供应商与物料排名等全部图表。</div>'
        + '<button onclick="window.gotoInspWorkbench ? gotoInspWorkbench() : INSP.openHome()">去检验工作台录入 →</button></div>';
      b.innerHTML = html;
      return;
    }

    function hero(cls, ic, body, label) {
      return '<div class="gd-s-hero ' + cls + '"><div class="ic">' + ic + '</div><div class="num">' + body + '</div><div class="lb">' + label + '</div></div>';
    }
    html += '<div class="gd-sales-hero">'
      + hero('b1', '🔬', '<span id="gdqBatch">0</span>', '检验批次（单）')
      + hero('b2', '📦', '<span id="gdqQty">0</span>', '检验总数（PCS）')
      + hero('b3', '✅', '<span id="gdqPass">0</span>', '合格批次（单）')
      + hero('b4', '❌', '<span id="gdqFail">0</span>', '不合格批次（单）')
      + hero('b5', '🎯', '<span id="gdqRate">0</span><small>%</small>', '批次合格率')
      + hero('b6', '⚠️', '<span id="gdqBad">0</span><small>%</small>', '批次不良率')
      + '</div>';

    var qt = s.passRate >= 95 ? 'gt' : '';
    html += '<div class="gd-target-card">'
      + '<div class="tt"><span class="t">🎯 批次合格率达标进度（目标 ≥ 95%）</span>'
      + '<span class="set" style="font-size:12px;color:#64748b">当前筛选：' + TYPE_META[S.type].name + ' · ' + (S.range === 'all' ? '全部时间' : '近' + S.range + '天') + '</span></div>'
      + '<div class="gd-bar"><i id="gdqBar" class="' + qt + '"></i></div>'
      + '<div class="pr"><span>合格率 <b id="gdqRateBig">0%</b>　/　目标 95%　·　不良批次 <b id="gdqBadBig">0</b> 单</span><span id="gdqRateTxt">0%</span></div>'
      + '</div>';

    var supArr = groupSummary(byGroup(recs, 'supplier')).filter(function (x) { return x.key !== '未填写'; }).sort(function (a, b) { return b.rate - a.rate; }).slice(0, 10);
    var matArr = groupSummary(byGroup(recs, 'matName')).filter(function (x) { return x.key !== '未填写'; }).sort(function (a, b) { return a.rate - b.rate; }).slice(0, 10);
    var insArr = groupSummary(byGroup(recs, 'inspector')).sort(function (a, b) { return b.count - a.count; }).slice(0, 10);

    html += '<div class="gd-grid">'
      + card('🎯 合格率仪表盘', '当前筛选：' + TYPE_META[S.type].name, 'gdGauge')
      + card('🏭 各检验环节合格率对比', '按部门环节自动采集 · 柱=批次数 线=合格率', 'gdByType')
      + card('📈 每日检验量与合格率趋势', '柱=每日检验批次 线=每日合格率', 'gdTrend', 'tall')
      + '<div class="gd-card"><h4>🏆 供应商来料良率排名</h4><div class="gd-sub">按供应商自动汇总 · 合格率降序 TOP10</div><div id="gdSupplier">' + (supArr.length ? '' : '<div class="gd-sub" style="padding:14px 0">暂无数据</div>') + '</div></div>'
      + '<div class="gd-card"><h4>📦 物料合格率排行</h4><div class="gd-sub">按物料自动汇总 · 问题物料优先</div><div id="gdMaterial">' + (matArr.length ? '' : '<div class="gd-sub" style="padding:14px 0">暂无数据</div>') + '</div></div>'
      + card('🚨 不合格原因分布', '从不合格记录提取原因字段自动统计', 'gdDefect')
      + card('🔁 检验单状态分布', '待审批 / 待评审(MRB) / 已流转 / 已驳回', 'gdStatus')
      + card('➡️ 流转去向分布', '合格放行去向 + 不合格评审结论', 'gdFlow')
      + '<div class="gd-card"><h4>👤 检验人工作量</h4><div class="gd-sub">按检验人自动汇总 · 批次数与合格率</div><div id="gdInspector">' + (insArr.length ? '' : '<div class="gd-sub" style="padding:14px 0">暂无数据</div>') + '</div></div>'
      + '</div>';

    var recent = recs.slice(-15).reverse();
    html += '<div class="gd-card" style="margin-top:12px"><h4>📋 最近检验明细（' + s.total + ' 单中最近 15 单）</h4>'
      + '<div class="gd-table-wrap"><table class="gd-table"><tr>'
      + '<th>单号</th><th>环节</th><th>日期</th><th>物料</th><th>供应商</th><th>批次</th><th>数量</th><th>判定</th><th>状态</th><th>去向</th></tr>';
    recent.forEach(function (r) {
      var tm = TYPE_META[r.type] || { name: r.type };
      var tag = r.result === 'pass' ? '<span class="gd-tag pass">合格</span>' : '<span class="gd-tag fail">不合格</span>';
      html += '<tr><td>' + esc(r.no || '') + '</td><td>' + esc(tm.name || r.type) + '</td><td>' + esc(r.date || '')
        + '</td><td>' + esc(r.matName || '') + '</td><td>' + esc(r.supplier || '—') + '</td><td>' + esc(r.batch || '—')
        + '</td><td>' + esc(r.qty || '—') + '</td><td>' + tag + '</td><td>' + esc(r.status || '') + '</td><td>' + esc(r.flowTo || '—') + '</td></tr>';
    });
    html += '</table></div></div>';
    b.innerHTML = html;

    if (supArr.length) document.getElementById('gdSupplier').innerHTML = rankHtml(supArr.map(function (x) { return { key: x.key, n: x.rate }; }), supArr[0].rate, '%', 1);
    if (matArr.length) document.getElementById('gdMaterial').innerHTML = rankHtml(matArr.map(function (x) { return { key: x.key, n: x.rate }; }), matArr[0].rate, '%', 1);
    if (insArr.length) document.getElementById('gdInspector').innerHTML = rankHtml(insArr.map(function (x) { return { key: x.key, n: x.count }; }), insArr[0].count, '单');

    countUp(document.getElementById('gdqBatch'), s.total, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdqQty'), Math.round(s.qtySum) || 0, 1000, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdqPass'), s.pass, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdqFail'), s.fail, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdqRate'), s.passRate, 1000, function (v) { return fmt(v, 0); });
    countUp(document.getElementById('gdqBad'), s.failRate, 1000, function (v) { return fmt(v, 0); });
    countUp(document.getElementById('gdqRateBig'), s.passRate, 1000, function (v) { return fmt(v, 1) + '%'; });
    countUp(document.getElementById('gdqBadBig'), s.fail, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdqRateTxt'), s.passRate, 1000, function (v) { return fmt(v, 1) + '%'; });
    requestAnimationFrame(function () {
      document.getElementById('gdqBar').style.width = Math.min(s.passRate, 100).toFixed(1) + '%';
    });
    initQualityCharts(recs);
  }

  function initQualityCharts(recs) {
    var s = stats(recs);
    initChart('gdGauge', {
      series: [{
        type: 'gauge', min: 0, max: 100, startAngle: 205, endAngle: -25, center: ['50%', '58%'], radius: '88%',
        progress: { show: true, width: 14, itemStyle: { color: s.passRate >= 95 ? COL.green : (s.passRate >= 85 ? COL.orange : COL.red) } },
        axisLine: { lineStyle: { width: 14, color: [[1, '#eef2f7']] } },
        axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false },
        anchor: { show: false }, title: { show: true, offsetCenter: [0, '34%'], fontSize: 13, color: '#64748b' },
        detail: { valueAnimation: true, fontSize: 26, fontWeight: 700, color: '#1e293b', offsetCenter: [0, '0%'], formatter: '{value}%' },
        data: [{ value: fmt(s.passRate, 1), name: '批次合格率' }]
      }]
    });
    var byT = byType(recs);
    initChart('gdByType', {
      tooltip: { trigger: 'axis' }, legend: { data: ['检验批次', '合格率'], top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 40, right: 44, top: 30, bottom: 24 },
      xAxis: { type: 'category', data: TYPE_ORDER.map(function (t) { return TYPE_META[t].name; }), axisLabel: { fontSize: 11 } },
      yAxis: [
        { type: 'value', name: '批次', nameTextStyle: { fontSize: 10, color: '#94a3b8' }, splitLine: { lineStyle: { type: 'dashed' } } },
        { type: 'value', name: '合格率%', max: 100, nameTextStyle: { fontSize: 10, color: '#94a3b8' }, splitLine: { show: false } }
      ],
      series: [
        { name: '检验批次', type: 'bar', barWidth: 22, itemStyle: { color: COL.blue, borderRadius: [4, 4, 0, 0] }, data: TYPE_ORDER.map(function (t) { return byT[t].length; }) },
        { name: '合格率', type: 'line', yAxisIndex: 1, smooth: true, symbolSize: 7, lineStyle: { width: 3, color: COL.green }, itemStyle: { color: COL.green }, data: TYPE_ORDER.map(function (t) { return fmt(stats(byT[t]).passRate, 1); }) }
      ]
    });
    var byD = byDate(recs);
    var dKeys = byD.keys.slice(-30);
    initChart('gdTrend', {
      tooltip: { trigger: 'axis' }, legend: { data: ['检验批次', '合格率'], top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 40, right: 44, top: 30, bottom: 24 },
      xAxis: { type: 'category', data: dKeys, axisLabel: { fontSize: 10, rotate: 40, interval: 'auto' } },
      yAxis: [
        { type: 'value', name: '批次', nameTextStyle: { fontSize: 10, color: '#94a3b8' }, splitLine: { lineStyle: { type: 'dashed' } } },
        { type: 'value', name: '合格率%', max: 100, nameTextStyle: { fontSize: 10, color: '#94a3b8' }, splitLine: { show: false } }
      ],
      series: [
        { name: '检验批次', type: 'bar', barWidth: '46%', itemStyle: { color: COL.cyan, opacity: 0.75, borderRadius: [3, 3, 0, 0] }, data: dKeys.map(function (k) { return byD.map[k].length; }) },
        { name: '合格率', type: 'line', yAxisIndex: 1, smooth: true, lineStyle: { width: 2.5, color: COL.green }, itemStyle: { color: COL.green }, data: dKeys.map(function (k) { return fmt(stats(byD.map[k]).passRate, 1); }) }
      ]
    });
    /* 供应商良率已改为数据条（renderQuality 内填充） */
    /* 物料排行已改为数据条（renderQuality 内填充） */
    var defectMap = {};
    recs.forEach(function (r) {
      if (r.result !== 'fail') return;
      var ds = extractDefects(r);
      if (!ds.length) ds = ['未填写原因'];
      ds.forEach(function (x) { defectMap[x] = (defectMap[x] || 0) + 1; });
    });
    var defectArr = Object.keys(defectMap).map(function (k) { return { key: k, n: defectMap[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 12);
    if (!defectArr.length) defectArr = [{ key: '无不合格记录', n: 0 }];
    initChart('gdDefect', {
      tooltip: { trigger: 'axis' }, grid: { left: 90, right: 30, top: 8, bottom: 20 },
      xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
      yAxis: { type: 'category', data: defectArr.map(function (x) { return x.key; }), axisLabel: { fontSize: 11 } },
      series: [{ type: 'bar', barWidth: 14, itemStyle: { color: COL.red, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', fontSize: 10 }, data: defectArr.map(function (x) { return x.n; }) }]
    });
    var stMap = {};
    STATUS_ORDER.forEach(function (k) { stMap[k] = 0; });
    recs.forEach(function (r) { var k = r.status; if (stMap[k] == null) stMap[k] = 0; stMap[k]++; });
    initChart('gdStatus', {
      tooltip: { trigger: 'item', formatter: '{b}：{c} 单（{d}%）' }, legend: { bottom: 0, textStyle: { fontSize: 11 } },
      series: [{ type: 'pie', radius: ['40%', '66%'], center: ['50%', '44%'], avoidLabelOverlap: true, itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { show: true, formatter: '{b}\n{c}单', fontSize: 11 }, data: STATUS_ORDER.map(function (k) { return { name: k, value: stMap[k] || 0, itemStyle: { color: STATUS_COLOR[k] } }; }) }]
    });
    var flowMap = {};
    recs.forEach(function (r) {
      var k = '';
      if (r.status === '待评审') k = '不合格 → MRB 评审';
      else if (r.status === '待审批') k = '合格 → 待上级放行';
      else k = (r.flowTo && String(r.flowTo).trim()) ? String(r.flowTo).trim() : (r.status === '已流转' ? '已流转（去向未填）' : r.status);
      flowMap[k] = (flowMap[k] || 0) + 1;
    });
    var flowArr = Object.keys(flowMap).map(function (k) { return { key: k, n: flowMap[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 12);
    initChart('gdFlow', {
      tooltip: { trigger: 'axis' }, grid: { left: 110, right: 30, top: 8, bottom: 20 },
      xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
      yAxis: { type: 'category', data: flowArr.map(function (x) { return x.key; }), axisLabel: { fontSize: 10 } },
      series: [{ type: 'bar', barWidth: 14, itemStyle: { color: COL.blue, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', fontSize: 10 }, data: flowArr.map(function (x) { return x.n; }) }]
    });
    /* 检验人工作量已改为数据条（renderQuality 内填充） */
  }

  /* ================================================================
   * 生产部：首件/巡检检验 + 生产工单/领料/完工 + 异常处理
   * ================================================================ */

  function renderProduction() {
    var b = document.getElementById('glsDashBody');
    var db = getDB();
    var pp = filterRecs(db.inspections || []).filter(function (r) { return r.type === 'FIRST' || r.type === 'PATROL'; });
    var erp = getErp();
    var mo = erp.mo || [], moPick = erp.moPick || [], moIn = erp.moIn || [];
    var central = getCentral();
    var abnorm = bizOf(central.abnormal);
    var s = stats(pp);
    var hasErp = mo.length || moPick.length || moIn.length;

    function hero(cls, ic, body, label) {
      return '<div class="gd-s-hero ' + cls + '"><div class="ic">' + ic + '</div><div class="num">' + body + '</div><div class="lb">' + label + '</div></div>';
    }
    var html = '<div class="gd-sales-hero">'
      + hero('b1', '🔬', '<span id="gdpBatch">0</span>', '首件/巡检批次（单）')
      + hero('b2', '✅', '<span id="gdpPass">0</span>', '合格批次（单）')
      + hero('b3', '❌', '<span id="gdpFail">0</span>', '不合格批次（单）')
      + hero('b4', '🎯', '<span id="gdpRate">0</span><small>%</small>', '批次合格率')
      + hero('b5', '🧾', '<span id="gdpMo">0</span>', '生产工单（单）')
      + hero('b6', '🚨', '<span id="gdpAbn">0</span>', '异常处理（项）')
      + '</div>';

    var qt = s.passRate >= 95 ? 'gt' : '';
    html += '<div class="gd-target-card">'
      + '<div class="tt"><span class="t">🎯 生产检验合格率达标进度（目标 ≥ 95%）</span>'
      + '<span class="set" style="font-size:12px;color:#64748b">首件 + 过程巡检自动采集</span></div>'
      + '<div class="gd-bar"><i id="gdpBar" class="' + qt + '"></i></div>'
      + '<div class="pr"><span>合格率 <b id="gdpRateBig">0%</b>　/　目标 95%　·　不良批次 <b id="gdpBadBig">0</b> 单</span><span id="gdpRateTxt">0%</span></div>'
      + '</div>';

    var pickMap = {};
    moPick.forEach(function (x) {
      var items = x.items || [];
      items.forEach(function (it) {
        var nm = it.code || it.material || it.matName || '未填';
        var q = parseFloat(it.qty); if (isNaN(q)) q = 0;
        pickMap[nm] = (pickMap[nm] || 0) + q;
      });
    });
    var pickArr = Object.keys(pickMap).map(function (k) { return { key: k, n: pickMap[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 10);

    var grid = '<div class="gd-grid">';
    if (pp.length) {
      grid += card('🎯 生产环节合格率仪表盘', '首件 + 过程巡检', 'gdProdGauge')
        + card('📈 生产检验每日合格率趋势', '柱=检验批次 线=合格率', 'gdProdTrend', 'tall');
    } else {
      grid += cardEmpty('🎯 生产环节合格率', '暂无首件/巡检检验记录。在「检验工作台」录入首件、巡检后自动出图。');
    }
    if (hasErp) {
      grid += card('🧾 生产工单状态分布', 'ERP 生产工单自动汇总', 'gdMoStatus')
        + '<div class="gd-card"><h4>🔧 生产领料 TOP10</h4><div class="gd-sub">按物料汇总领料数量</div><div id="gdMoPick">' + (pickArr.length ? '' : '<div class="gd-sub" style="padding:14px 0">暂无领料数据</div>') + '</div></div>';
    } else {
      grid += cardEmpty('🧾 生产工单', '暂无生产工单数据。在「ERP业务 → 生产管理」录入工单/领料/完工后自动出图。');
    }
    grid += card('🚨 异常处理状态分布', '异常记录自动汇总（紧急/进行中/待处理）', 'gdAbnStatus')
      + card('📋 异常处理明细', '最近异常记录', 'gdAbnTable', 'tall');
    html += grid + '</div>';
    b.innerHTML = html;

    if (pickArr.length) document.getElementById('gdMoPick').innerHTML = rankHtml(pickArr, pickArr[0].n, '');

    if (pp.length) {
      initChart('gdProdGauge', {
        series: [{ type: 'gauge', min: 0, max: 100, startAngle: 205, endAngle: -25, center: ['50%', '58%'], radius: '88%',
          progress: { show: true, width: 14, itemStyle: { color: s.passRate >= 95 ? COL.green : (s.passRate >= 85 ? COL.orange : COL.red) } },
          axisLine: { lineStyle: { width: 14, color: [[1, '#eef2f7']] } },
          axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false },
          anchor: { show: false }, title: { show: true, offsetCenter: [0, '34%'], fontSize: 13, color: '#64748b' },
          detail: { valueAnimation: true, fontSize: 26, fontWeight: 700, color: '#1e293b', offsetCenter: [0, '0%'], formatter: '{value}%' },
          data: [{ value: fmt(s.passRate, 1), name: '生产检验合格率' }] }]
      });
      var byD = byDate(pp);
      var dKeys = byD.keys.slice(-30);
      initChart('gdProdTrend', {
        tooltip: { trigger: 'axis' }, legend: { data: ['检验批次', '合格率'], top: 0, textStyle: { fontSize: 11 } },
        grid: { left: 40, right: 44, top: 30, bottom: 24 },
        xAxis: { type: 'category', data: dKeys, axisLabel: { fontSize: 10, rotate: 40 } },
        yAxis: [
          { type: 'value', name: '批次', nameTextStyle: { fontSize: 10, color: '#94a3b8' }, splitLine: { lineStyle: { type: 'dashed' } } },
          { type: 'value', name: '合格率%', max: 100, nameTextStyle: { fontSize: 10, color: '#94a3b8' }, splitLine: { show: false } }
        ],
        series: [
          { name: '检验批次', type: 'bar', barWidth: '46%', itemStyle: { color: COL.cyan, opacity: 0.75, borderRadius: [3, 3, 0, 0] }, data: dKeys.map(function (k) { return byD.map[k].length; }) },
          { name: '合格率', type: 'line', yAxisIndex: 1, smooth: true, lineStyle: { width: 2.5, color: COL.green }, itemStyle: { color: COL.green }, data: dKeys.map(function (k) { return fmt(stats(byD.map[k]).passRate, 1); }) }
        ]
      });
    }
    if (hasErp) {
      var moSt = groupCount(mo, 'status');
      initChart('gdMoStatus', {
        tooltip: { trigger: 'item', formatter: '{b}：{c} 单（{d}%）' }, legend: { bottom: 0, textStyle: { fontSize: 11 } },
        series: [{ type: 'pie', radius: ['40%', '66%'], center: ['50%', '44%'], itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { show: true, formatter: '{b}\n{c}单', fontSize: 11 }, data: Object.keys(moSt).map(function (k) { return { name: statusCn(k), value: moSt[k] }; }) }]
      });
    }
    var abnSt = groupCount(abnorm, 'status');
    initChart('gdAbnStatus', {
      tooltip: { trigger: 'item', formatter: '{b}：{c} 项（{d}%）' }, legend: { bottom: 0, textStyle: { fontSize: 11 } },
      series: [{ type: 'pie', radius: ['40%', '66%'], center: ['50%', '44%'], itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { show: true, formatter: '{b}\n{c}项', fontSize: 11 }, data: Object.keys(abnSt).map(function (k) { return { name: statusCn(k), value: abnSt[k] }; }) }]
    });
    var abnTable = abnorm.slice(0, 12).map(function (x) {
      return '<tr><td>' + esc(x.name) + '</td><td>' + esc(statusCn(x.status)) + '</td><td>' + esc((x.description || '').slice(0, 40)) + '</td></tr>';
    }).join('');
    document.getElementById('gdAbnTable').innerHTML = '<div class="gd-table-wrap"><table class="gd-table"><tr><th>异常项</th><th>状态</th><th>描述</th></tr>' + abnTable + '</table></div>';

    countUp(document.getElementById('gdpBatch'), pp.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdpPass'), s.pass, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdpFail'), s.fail, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdpRate'), s.passRate, 1000, function (v) { return fmt(v, 0); });
    countUp(document.getElementById('gdpMo'), mo.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdpAbn'), abnorm.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdpRateBig'), s.passRate, 1000, function (v) { return fmt(v, 1) + '%'; });
    countUp(document.getElementById('gdpBadBig'), s.fail, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdpRateTxt'), s.passRate, 1000, function (v) { return fmt(v, 1) + '%'; });
    requestAnimationFrame(function () {
      document.getElementById('gdpBar').style.width = Math.min(s.passRate, 100).toFixed(1) + '%';
    });
  }


  function renderWarehouse() {
    var b = document.getElementById('glsDashBody');
    var erp = getErp();
    var stock = erp.stock || [], material = erp.material || [], stockIn = erp.stockIn || [], stockOut = erp.stockOut || [], stockCheck = erp.stockCheck || [];
    var db = getDB();
    var toWh = filterRecs(db.inspections || []).filter(function (r) { return /仓储|入库/.test(r.flowTo || ''); });
    var hasStock = stock.length || material.length;
    var totalQty = sumField(stock, 'qty');
    var lowStock = 0, smap = {};
    if (material.length && stock.length) {
      stock.forEach(function (x) { smap[x.code || x.matCode || x.material] = (smap[x.code || x.matCode || x.material] || 0) + (parseFloat(x.qty) || 0); });
      material.forEach(function (m) {
        var safe = parseFloat(m.safeStock) || 0;
        var cur = smap[m.code] || 0;
        if (safe > 0 && cur < safe) lowStock++;
      });
    }

    function hero(cls, ic, body, label) {
      return '<div class="gd-s-hero ' + cls + '"><div class="ic">' + ic + '</div><div class="num">' + body + '</div><div class="lb">' + label + '</div></div>';
    }
    var html = '<div class="gd-sales-hero">'
      + hero('b1', '📦', '<span id="gdwStock">0</span>', '库存物料（项）')
      + hero('b2', '🏷️', '<span id="gdwQty">0</span>', '库存总量（PCS）')
      + hero('b3', '⚠️', '<span id="gdwLow">0</span>', '安全库存预警（项）')
      + hero('b4', '📥', '<span id="gdwIn">0</span>', '入库单（单）')
      + hero('b5', '📤', '<span id="gdwOut">0</span>', '出库单（单）')
      + hero('b6', '✅', '<span id="gdwToWh">0</span>', '检验合格入库流转（单）')
      + '</div>';

    var wrate = lowStock ? Math.max(100 - (lowStock / Math.max(stock.length, 1)) * 100, 0) : 100;
    var wt = lowStock === 0 ? 'gt' : (wrate >= 60 ? '' : '');
    html += '<div class="gd-target-card">'
      + '<div class="tt"><span class="t">📊 库存健康度（无预警物料占比）</span>'
      + '<span class="set" style="font-size:12px;color:#64748b">低库存预警 ' + lowStock + ' 项 / 库存物料 ' + stock.length + ' 项</span></div>'
      + '<div class="gd-bar"><i id="gdwBar" class="' + wt + '"></i></div>'
      + '<div class="pr"><span>健康度 <b id="gdwRate">0%</b>　·　预警物料 <b id="gdwLowBig">0</b> 项</span><span id="gdwRateTxt">0%</span></div>'
      + '</div>';

    var qmap = {};
    stock.forEach(function (x) {
      var nm = x.name || x.code || x.matName || '未填';
      qmap[nm] = (qmap[nm] || 0) + (parseFloat(x.qty) || 0);
    });
    var stockTop = Object.keys(qmap).map(function (k) { return { key: k, n: qmap[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 10);
    var locMap = groupCount(stock, 'location');

    var grid = '<div class="gd-grid">';
    if (hasStock) {
      grid += '<div class="gd-card"><h4>📦 库存量 TOP10</h4><div class="gd-sub">按物料自动汇总库存数量</div><div id="gdStockTop">' + (stockTop.length ? '' : '<div class="gd-sub" style="padding:14px 0">暂无数据</div>') + '</div></div>';
      grid += card('🗂️ 库位分布', '按库位自动汇总物料项数', 'gdLocDist');
      if (lowStock) {
        grid += card('⚠️ 安全库存预警清单', '当前库存低于安全库存的物料', 'gdLowStock', 'tall');
      } else {
        grid += cardEmpty('⚠️ 安全库存预警', material.length ? '当前无低于安全库存的物料。' : '暂无物料档案，录入 ERP 物料档案（含安全库存）后自动预警。');
      }
    } else {
      grid += cardEmpty('📦 库存台账', '暂无库存数据。在「ERP业务 → 仓储管理」录入物料档案、库存台账、出入库后自动出图。');
      grid += cardEmpty('🗂️ 库位分布', '暂无库存数据。');
    }
    if (stockIn.length || stockOut.length) {
      var ioMap = {};
      stockIn.forEach(function (x) { var d = String(x.inDate || '未填').slice(0, 7); ioMap[d] = ioMap[d] || { inn: 0, out: 0 }; ioMap[d].inn += sumField(x.items || [], 'qty'); });
      stockOut.forEach(function (x) { var d = String(x.outDate || '未填').slice(0, 7); ioMap[d] = ioMap[d] || { inn: 0, out: 0 }; ioMap[d].out += sumField(x.items || [], 'qty'); });
      var ioKeys = Object.keys(ioMap).sort().slice(-12);
      grid += card('📈 月度出入库趋势', '柱=入库量 线=出库量（按月）', 'gdIoTrend', 'tall');
      initChart('gdIoTrend', {
        tooltip: { trigger: 'axis' }, legend: { data: ['入库', '出库'], top: 0, textStyle: { fontSize: 11 } },
        grid: { left: 44, right: 40, top: 30, bottom: 24 },
        xAxis: { type: 'category', data: ioKeys, axisLabel: { fontSize: 10 } },
        yAxis: [
          { type: 'value', name: '入库量', nameTextStyle: { fontSize: 10, color: '#94a3b8' }, splitLine: { lineStyle: { type: 'dashed' } } },
          { type: 'value', name: '出库量', nameTextStyle: { fontSize: 10, color: '#94a3b8' }, splitLine: { show: false } }
        ],
        series: [
          { name: '入库', type: 'bar', barWidth: '40%', itemStyle: { color: COL.green, borderRadius: [3, 3, 0, 0] }, data: ioKeys.map(function (k) { return ioMap[k].inn; }) },
          { name: '出库', type: 'line', yAxisIndex: 1, smooth: true, lineStyle: { width: 2.5, color: COL.orange }, itemStyle: { color: COL.orange }, data: ioKeys.map(function (k) { return ioMap[k].out; }) }
        ]
      });
    } else {
      grid += cardEmpty('📈 月度出入库趋势', '暂无出入库单数据。');
    }
    if (toWh.length) {
      grid += card('✅ 检验合格入库流转', '合格检验单流转到仓储部的记录', 'gdToWh');
      initChart('gdToWh', {
        tooltip: { trigger: 'axis' }, grid: { left: 100, right: 30, top: 8, bottom: 20 },
        xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' } } },
        yAxis: { type: 'category', data: toWh.slice(-10).reverse().map(function (r) { return r.no || '—'; }), axisLabel: { fontSize: 10 } },
        series: [{ type: 'bar', barWidth: 14, itemStyle: { color: COL.green, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', fontSize: 10, formatter: '{c}单' }, data: toWh.slice(-10).reverse().map(function () { return 1; }) }]
      });
    } else {
      grid += cardEmpty('✅ 检验合格入库流转', '暂无流转到仓储部的检验记录。');
    }
    html += grid + '</div>';
    b.innerHTML = html;

    if (stockTop.length) document.getElementById('gdStockTop').innerHTML = rankHtml(stockTop, stockTop[0].n, '');
    if (hasStock) {
      var locArr = Object.keys(locMap).map(function (k) { return { name: k, value: locMap[k] }; });
      initChart('gdLocDist', {
        tooltip: { trigger: 'item', formatter: '{b}：{c} 项（{d}%）' }, legend: { bottom: 0, textStyle: { fontSize: 11 } },
        series: [{ type: 'pie', radius: ['40%', '66%'], center: ['50%', '44%'], itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { show: true, formatter: '{b}\n{c}项', fontSize: 10 }, data: locArr }]
      });
      if (lowStock) {
        var lowArr = [];
        material.forEach(function (m) {
          var safe = parseFloat(m.safeStock) || 0;
          var cur = smap[m.code] || 0;
          if (safe > 0 && cur < safe) lowArr.push({ key: m.name || m.code, cur: cur, safe: safe });
        });
        document.getElementById('gdLowStock').innerHTML = '<div class="gd-table-wrap"><table class="gd-table"><tr><th>物料</th><th>当前库存</th><th>安全库存</th><th>缺口</th></tr>'
          + lowArr.map(function (x) { return '<tr><td>' + esc(x.key) + '</td><td>' + x.cur + '</td><td>' + x.safe + '</td><td style="color:#ef4444;font-weight:600">' + (x.safe - x.cur) + '</td></tr>'; }).join('')
          + '</table></div>';
      }
    }

    countUp(document.getElementById('gdwStock'), stock.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdwQty'), Math.round(totalQty) || 0, 1000, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdwLow'), lowStock, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdwIn'), stockIn.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdwOut'), stockOut.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdwToWh'), toWh.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdwRate'), wrate, 1000, function (v) { return fmt(v, 1) + '%'; });
    countUp(document.getElementById('gdwLowBig'), lowStock, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdwRateTxt'), wrate, 1000, function (v) { return fmt(v, 1) + '%'; });
    requestAnimationFrame(function () {
      document.getElementById('gdwBar').style.width = wrate.toFixed(1) + '%';
    });
  }


  function renderPurchasing() {
    var b = document.getElementById('glsDashBody');
    var central = getCentral();
    var sups = bizOf(central.suppliers);
    var erp = getErp();
    var po = erp.po || [], poRecv = erp.poRecv || [], pr = erp.pr || [];
    var db = getDB();
    var iqc = filterRecs(db.inspections || []).filter(function (r) { return r.type === 'IQC'; });
    var s = stats(iqc);
    var poAmt = 0;
    po.forEach(function (x) { poAmt += parseFloat(x.amount) || 0; });

    function hero(cls, ic, body, label) {
      return '<div class="gd-s-hero ' + cls + '"><div class="ic">' + ic + '</div><div class="num">' + body + '</div><div class="lb">' + label + '</div></div>';
    }
    var html = '<div class="gd-sales-hero">'
      + hero('b1', '🏭', '<span id="gdpSup">0</span>', '供应商档案（家）')
      + hero('b2', '🔬', '<span id="gdpIqc">0</span>', '来料检验批次（单）')
      + hero('b3', '✅', '<span id="gdpPass">0</span>', '来料合格批次（单）')
      + hero('b4', '🎯', '<span id="gdpRate">0</span><small>%</small>', '来料合格率')
      + hero('b5', '🛒', '<span id="gdpPo">0</span>', '采购订单（单）')
      + hero('b6', '💰', '<span id="gdpAmt">0</span>', '采购金额（元）')
      + '</div>';

    var qt = s.passRate >= 95 ? 'gt' : '';
    html += '<div class="gd-target-card">'
      + '<div class="tt"><span class="t">🎯 来料合格率达标进度（目标 ≥ 95%）</span>'
      + '<span class="set" style="font-size:12px;color:#64748b">来料检验 IQC 自动采集</span></div>'
      + '<div class="gd-bar"><i id="gdpBar" class="' + qt + '"></i></div>'
      + '<div class="pr"><span>合格率 <b id="gdpRateBig">0%</b>　/　目标 95%　·　不合格批次 <b id="gdpBadBig">0</b> 单</span><span id="gdpRateTxt">0%</span></div>'
      + '</div>';

    var sup = groupSummary(byGroup(iqc, 'supplier')).filter(function (x) { return x.key !== '未填写'; }).sort(function (a, b) { return b.rate - a.rate; }).slice(0, 10);
    var poSup = groupCount(po, 'supplier');
    var poSupArr = Object.keys(poSup).map(function (k) { return { key: k, n: poSup[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 10);

    var grid = '<div class="gd-grid">';
    if (sups.length) {
      var stMap = groupCount(sups, 'status');
      grid += card('🏭 供应商状态分布', '按状态自动汇总（已完成/进行中/待处理）', 'gdSupStatus');
      grid += card('📋 供应商档案明细', '最近供应商记录', 'gdSupTable', 'tall');
    } else {
      grid += cardEmpty('🏭 供应商状态分布', '暂无供应商档案。在「供应商管理」录入后自动出图。');
    }
    if (iqc.length) {
      grid += '<div class="gd-card"><h4>📊 供应商来料良率排名</h4><div class="gd-sub">按来料检验供应商自动汇总</div><div id="gdSupRate">' + (sup.length ? '' : '<div class="gd-sub" style="padding:14px 0">暂无数据</div>') + '</div></div>';
    } else {
      grid += cardEmpty('📊 供应商来料良率排名', '暂无来料检验记录。在「检验工作台」录入来料检验后自动生成。');
    }
    if (po.length) {
      var poSt = groupCount(po, 'status');
      grid += card('🛒 采购订单状态分布', '按状态自动汇总', 'gdPoStatus')
        + '<div class="gd-card"><h4>🏢 采购供应商订单量</h4><div class="gd-sub">按供应商汇总订单数</div><div id="gdPoSup">' + (poSupArr.length ? '' : '<div class="gd-sub" style="padding:14px 0">暂无数据</div>') + '</div></div>';
    } else {
      grid += cardEmpty('🛒 采购订单', '暂无采购订单。在「ERP业务 → 采购管理」录入采购申请/订单/收货后自动出图。');
    }
    html += grid + '</div>';
    b.innerHTML = html;

    if (sup.length) document.getElementById('gdSupRate').innerHTML = rankHtml(sup.map(function (x) { return { key: x.key, n: x.rate }; }), sup[0].rate, '%', 1);
    if (poSupArr.length) document.getElementById('gdPoSup').innerHTML = rankHtml(poSupArr, poSupArr[0].n, '单');

    if (sups.length) {
      initChart('gdSupStatus', {
        tooltip: { trigger: 'item', formatter: '{b}：{c} 家（{d}%）' }, legend: { bottom: 0, textStyle: { fontSize: 11 } },
        series: [{ type: 'pie', radius: ['40%', '66%'], center: ['50%', '44%'], itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { show: true, formatter: '{b}\n{c}家', fontSize: 11 }, data: Object.keys(stMap).map(function (k) { return { name: statusCn(k), value: stMap[k] }; }) }]
      });
      document.getElementById('gdSupTable').innerHTML = '<div class="gd-table-wrap"><table class="gd-table"><tr><th>供应商</th><th>状态</th><th>描述</th></tr>'
        + sups.slice(0, 12).map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td>' + esc(statusCn(x.status)) + '</td><td>' + esc((x.description || '').slice(0, 40)) + '</td></tr>'; }).join('')
        + '</table></div>';
    }
    if (po.length) {
      var poSt = groupCount(po, 'status');
      initChart('gdPoStatus', {
        tooltip: { trigger: 'item', formatter: '{b}：{c} 单（{d}%）' }, legend: { bottom: 0, textStyle: { fontSize: 11 } },
        series: [{ type: 'pie', radius: ['40%', '66%'], center: ['50%', '44%'], itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { show: true, formatter: '{b}\n{c}单', fontSize: 11 }, data: Object.keys(poSt).map(function (k) { return { name: statusCn(k), value: poSt[k] }; }) }]
      });
    }

    countUp(document.getElementById('gdpSup'), sups.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdpIqc'), iqc.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdpPass'), s.pass, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdpRate'), s.passRate, 1000, function (v) { return fmt(v, 0); });
    countUp(document.getElementById('gdpPo'), po.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdpAmt'), Math.round(poAmt), 1000, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdpRateBig'), s.passRate, 1000, function (v) { return fmt(v, 1) + '%'; });
    countUp(document.getElementById('gdpBadBig'), s.fail, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdpRateTxt'), s.passRate, 1000, function (v) { return fmt(v, 1) + '%'; });
    requestAnimationFrame(function () {
      document.getElementById('gdpBar').style.width = Math.min(s.passRate, 100).toFixed(1) + '%';
    });
  }

  function renderSales() {
    var b = document.getElementById('glsDashBody');
    var db = getDB();
    var oqc = filterRecs(db.inspections || []).filter(function (r) { return r.type === 'OQC'; });
    var erp = getErp();
    var so = erp.so || [], soShip = erp.soShip || [], soReturn = erp.soReturn || [], afterSale = erp.afterSale || [], customer = erp.customer || [];
    var central = getCentral();
    var abnorm = bizOf(central.abnormal);
    var complaint = abnorm.filter(function (x) { return /投诉|客诉/.test(x.name); });
    var s = stats(oqc);

    /* —— 金额聚合 —— */
    var totAmt = 0, doneAmt = 0, doneN = 0, custSet = {}, custAmt = {}, prodAmt = {}, dateAmt = {};
    so.forEach(function (x) {
      var a = parseFloat(x.amount);
      if (isNaN(a)) { a = 0; (x.items || []).forEach(function (it) { var p = parseFloat(it.amount); if (!isNaN(p)) a += p; }); }
      totAmt += a;
      var st = x.status || '';
      if (/完成|已发货|已交付|closed|done/i.test(st)) { doneAmt += a; doneN++; }
      var c = x.customer || '未填'; custSet[c] = 1;
      custAmt[c] = (custAmt[c] || 0) + a;
      var d = (x.orderDate || '').slice(0, 10);
      if (d) dateAmt[d] = (dateAmt[d] || 0) + a;
      (x.items || []).forEach(function (it) {
        var nm = it.name || it.code || '未填';
        var p = parseFloat(it.amount); if (isNaN(p)) p = parseFloat(it.price || 0) * (parseFloat(it.qty) || 0);
        prodAmt[nm] = (prodAmt[nm] || 0) + p;
      });
    });
    var custN = Object.keys(custSet).length;
    var avg = custN ? totAmt / custN : 0;
    var target = parseFloat(localStorage.getItem('gls_sales_target') || '') || 1000000;
    var rate = target ? Math.min(totAmt / target * 100, 999) : 0;
    var shipN = soShip.length, retN = soReturn.length;
    var complainN = complaint.length;

    /* —— 趋势（近30天）—— */
    var dKeys = Object.keys(dateAmt).sort().slice(-30);
    var cum = 0, cumArr = dKeys.map(function (k) { cum += dateAmt[k]; return Math.round(cum); });

    /* —— 排行 —— */
    var custArr = Object.keys(custAmt).map(function (k) { return { key: k, n: custAmt[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 10);
    var cMax = custArr.length ? custArr[0].n : 1;
    var prodArr = Object.keys(prodAmt).map(function (k) { return { key: k, n: prodAmt[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 10);
    var pMax = prodArr.length ? prodArr[0].n : 1;
    var soSt = groupCount(so, 'status');

    /* —— KPI 大数字卡 —— */
    function hero(cls, ic, fmt, label) {
      return '<div class="gd-s-hero ' + cls + '"><div class="ic">' + ic + '</div><div class="num">' + fmt + '</div><div class="lb">' + label + '</div></div>';
    }
    var html = '<div class="gd-sales-hero">'
      + hero('b1', '💰', '<span id="gdsTot">0</span>', '销售总额（元）')
      + hero('b2', '🎯', '<span id="gdsRate">0</span><small>%</small>', '目标完成率')
      + hero('b3', '📦', '<span id="gdsOrder">0</span>', '销售订单（单）')
      + hero('b4', '🧾', '<span id="gdsAvg">0</span>', '客单价（元）')
      + hero('b5', '🚚', '<span id="gdsShip">0</span>', '发货 / 退货')
      + hero('b6', '⚠️', '<span id="gdsCp">0</span>', '客诉处理（项）')
      + '</div>';

    /* —— 目标进度卡 —— */
    var gt = rate >= 100 ? 'gt' : '';
    html += '<div class="gd-target-card">'
      + '<div class="tt"><span class="t">🎯 本月销售目标进度</span>'
      + '<span class="set"><input id="gdsTarget" type="number" value="' + Math.round(target / 10000) + '" title="月销售目标（万元）"> 万元'
      + '<button onclick="GLS_DASH.saveTarget()">保存目标</button></span></div>'
      + '<div class="gd-bar"><i id="gdsBar" class="' + gt + '"></i></div>'
      + '<div class="pr"><span>已完成 <b id="gdsDone">0</b> 元　/　目标 ' + fmt(Math.round(target), 0) + ' 元</span>'
      + '<span id="gdsRateTxt">0%</span></div>'
      + '</div>';

    /* —— 图表区 —— */
    var grid = '<div class="gd-grid">';
    if (dKeys.length) {
      grid += '<div class="gd-card" style="grid-column:1/-1"><h4>📈 销售趋势（近30天）</h4><div class="gd-sub">柱=每日销售金额　线=累计金额</div><div class="gd-chart" id="gdSalesTrend" style="height:300px"></div></div>';
    } else {
      grid += '<div class="gd-card" style="grid-column:1/-1"><h4>📈 销售趋势</h4><div class="gd-sub">暂无销售订单。在「ERP业务 → 销售管理」录入订单后自动出图。</div></div>';
    }
    grid += '<div class="gd-card"><h4>🏆 客户销售排行</h4><div class="gd-sub">按订单金额自动汇总 TOP10</div><div id="gdCustRank">' + (custArr.length ? '' : '<div class="gd-sub" style="padding:14px 0">暂无数据</div>') + '</div></div>';
    grid += '<div class="gd-card"><h4>🏅 产品/物料销售排行</h4><div class="gd-sub">按订单明细金额自动汇总 TOP10</div><div id="gdProdRank">' + (prodArr.length ? '' : '<div class="gd-sub" style="padding:14px 0">暂无数据</div>') + '</div></div>';
    if (so.length) {
      grid += '<div class="gd-card"><h4>📝 订单状态分布</h4><div class="gd-sub">按状态自动汇总</div><div class="gd-chart" id="gdSoStatus"></div></div>';
    } else {
      grid += '<div class="gd-card"><h4>📝 订单状态分布</h4><div class="gd-sub">暂无销售订单</div></div>';
    }
    if (complainN) {
      grid += '<div class="gd-card"><h4>📋 客诉处理明细</h4><div class="gd-sub">最近客诉记录</div><div class="gd-table-wrap" id="gdComplaint"></div></div>';
    } else {
      grid += '<div class="gd-card"><h4>📋 客诉处理</h4><div class="gd-sub">' + (abnorm.length ? '当前无客诉类异常。' : '暂无异常记录。') + '</div></div>';
    }
    html += grid + '</div>';

    b.innerHTML = html;

    /* —— 排行数据条渲染 —— */
    function rankHtml(arr, max) {
      var h = '';
      arr.forEach(function (x, i) {
        var w = Math.max((x.n / max) * 100, 3);
        h += '<div class="gd-rank"><span class="rk' + (i < 3 ? ' t' : '') + '">' + (i + 1) + '</span><span class="nm">' + esc(x.key) + '</span><span class="ln"><i style="width:' + w.toFixed(1) + '%"></i></span><span class="vl">' + fmt(x.n, 0) + '</span></div>';
      });
      return h;
    }
    if (custArr.length) document.getElementById('gdCustRank').innerHTML = rankHtml(custArr, cMax);
    if (prodArr.length) document.getElementById('gdProdRank').innerHTML = rankHtml(prodArr, pMax);

    /* —— 图表 —— */
    if (dKeys.length) {
      initChart('gdSalesTrend', {
        tooltip: { trigger: 'axis' }, legend: { data: ['销售金额', '累计金额'], top: 0, textStyle: { fontSize: 11 } },
        grid: { left: 60, right: 60, top: 32, bottom: 28 },
        xAxis: { type: 'category', data: dKeys, axisLabel: { fontSize: 10, rotate: 40 } },
        yAxis: [
          { type: 'value', name: '金额', nameTextStyle: { fontSize: 10, color: '#94a3b8' }, splitLine: { lineStyle: { type: 'dashed' } } },
          { type: 'value', name: '累计', nameTextStyle: { fontSize: 10, color: '#94a3b8' }, splitLine: { show: false } }
        ],
        series: [
          { name: '销售金额', type: 'bar', barWidth: '48%', itemStyle: { color: COL.blue, opacity: 0.75, borderRadius: [3, 3, 0, 0] }, data: dKeys.map(function (k) { return Math.round(dateAmt[k]); }) },
          { name: '累计金额', type: 'line', yAxisIndex: 1, smooth: true, lineStyle: { width: 2.5, color: COL.purple }, itemStyle: { color: COL.purple }, areaStyle: { color: 'rgba(139,92,246,.10)' }, data: cumArr }
        ]
      });
    }
    if (so.length) {
      initChart('gdSoStatus', {
        tooltip: { trigger: 'item', formatter: '{b}：{c} 单（{d}%）' }, legend: { bottom: 0, textStyle: { fontSize: 11 } },
        series: [{ type: 'pie', radius: ['40%', '66%'], center: ['50%', '44%'], itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { show: true, formatter: '{b}\n{c}单', fontSize: 11 }, data: Object.keys(soSt).map(function (k) { return { name: statusCn(k), value: soSt[k] }; }) }]
      });
    }
    if (complainN) {
      document.getElementById('gdComplaint').innerHTML = '<table class="gd-table"><tr><th>客诉项</th><th>状态</th><th>描述</th></tr>'
        + complaint.slice(0, 8).map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td>' + esc(statusCn(x.status)) + '</td><td>' + esc((x.description || '').slice(0, 30)) + '</td></tr>'; }).join('')
        + '</table>';
    }

    /* —— 数字滚动 —— */
    countUp(document.getElementById('gdsTot'), Math.round(totAmt), 1100, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdsRate'), rate, 1100, function (v) { return fmt(v, 0); });
    countUp(document.getElementById('gdsOrder'), so.length, 900, function (v) { return fmt(v, 0); });
    countUp(document.getElementById('gdsAvg'), Math.round(avg), 1100, function (v) { return fmt(v, 0); });
    countUp(document.getElementById('gdsShip'), shipN, 800, function (v) { return fmt(v, 0) + ' / ' + retN; });
    countUp(document.getElementById('gdsCp'), complainN, 800, function (v) { return fmt(v, 0); });
    countUp(document.getElementById('gdsDone'), Math.round(totAmt), 1100, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdsRateTxt'), rate, 1100, function (v) { return fmt(v, 0) + '%'; });
    requestAnimationFrame(function () {
      document.getElementById('gdsBar').style.width = Math.min(rate, 100).toFixed(1) + '%';
    });
  }

  function saveTarget() {
    var v = parseFloat(document.getElementById('gdsTarget').value);
    if (!isNaN(v) && v > 0) {
      localStorage.setItem('gls_sales_target', String(v * 10000));
      GLS_DASH.render();
    }
  }


  function renderRd() {
    var b = document.getElementById('glsDashBody');
    var central = getCentral();
    var rds = bizOf(central.rd);
    var erp = getErp();
    var bom = erp.bom || [], equip = erp.equip || [];
    var doneN = rds.filter(function (x) { return x.status === 'done'; }).length;
    var rate = rds.length ? doneN / rds.length * 100 : 0;

    function hero(cls, ic, body, label) {
      return '<div class="gd-s-hero ' + cls + '"><div class="ic">' + ic + '</div><div class="num">' + body + '</div><div class="lb">' + label + '</div></div>';
    }
    var html = '<div class="gd-sales-hero">'
      + hero('b1', '🧪', '<span id="gdrProj">0</span>', '研发项目（项）')
      + hero('b2', '✅', '<span id="gdrDone">0</span>', '已完成项目（项）')
      + hero('b3', '🎯', '<span id="gdrRate">0</span><small>%</small>', '项目完成率')
      + hero('b4', '🧩', '<span id="gdrBom">0</span>', 'BOM 清单（项）')
      + hero('b5', '🧰', '<span id="gdrEquip">0</span>', '检测设备（台）')
      + hero('b6', '📋', '<span id="gdrTable">0</span>', '项目明细（条）')
      + '</div>';

    var qt = rate >= 60 ? 'gt' : '';
    html += '<div class="gd-target-card">'
      + '<div class="tt"><span class="t">📈 研发项目完成率进度</span>'
      + '<span class="set" style="font-size:12px;color:#64748b">已完成 ' + doneN + ' / ' + rds.length + ' 项</span></div>'
      + '<div class="gd-bar"><i id="gdrBar" class="' + qt + '"></i></div>'
      + '<div class="pr"><span>完成率 <b id="gdrRateBig">0%</b></span><span id="gdrRateTxt">0%</span></div>'
      + '</div>';

    var prodMap = groupCount(bom, 'product');
    var bomArr = Object.keys(prodMap).map(function (k) { return { key: k, n: prodMap[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 10);
    var eqMap = groupCount(equip, 'type');
    var eqArr = Object.keys(eqMap).map(function (k) { return { name: k, value: eqMap[k] }; });

    var grid = '<div class="gd-grid">';
    if (rds.length) {
      grid += card('🧪 研发项目状态分布', '按状态自动汇总', 'gdRdStatus');
      grid += card('📋 研发项目明细', '最近项目记录', 'gdRdTable', 'tall');
    } else {
      grid += cardEmpty('🧪 研发项目', '暂无研发项目。在「研发管理」录入项目后自动出图。');
    }
    if (bom.length) {
      grid += '<div class="gd-card"><h4>🧩 产品 BOM 构成项数</h4><div class="gd-sub">按产品汇总 BOM 项数</div><div id="gdBom">' + (bomArr.length ? '' : '<div class="gd-sub" style="padding:14px 0">暂无数据</div>') + '</div></div>';
    } else {
      grid += cardEmpty('🧩 BOM 清单', '暂无 BOM 数据。在「ERP业务 → 基础资料」录入 BOM 后自动出图。');
    }
    if (equip.length) {
      grid += card('🧰 检测设备一览', '按设备类型自动汇总', 'gdEquip', 'tall');
    } else {
      grid += cardEmpty('🧰 检测设备', '暂无检测设备数据。在「ERP业务 → 基础资料」录入检测设备一览表后自动出图。');
    }
    html += grid + '</div>';
    b.innerHTML = html;

    if (bomArr.length) document.getElementById('gdBom').innerHTML = rankHtml(bomArr, bomArr[0].n, '项');

    if (rds.length) {
      var stMap = groupCount(rds, 'status');
      initChart('gdRdStatus', {
        tooltip: { trigger: 'item', formatter: '{b}：{c} 项（{d}%）' }, legend: { bottom: 0, textStyle: { fontSize: 11 } },
        series: [{ type: 'pie', radius: ['40%', '66%'], center: ['50%', '44%'], itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { show: true, formatter: '{b}\n{c}项', fontSize: 11 }, data: Object.keys(stMap).map(function (k) { return { name: statusCn(k), value: stMap[k] }; }) }]
      });
      document.getElementById('gdRdTable').innerHTML = '<div class="gd-table-wrap"><table class="gd-table"><tr><th>项目</th><th>状态</th><th>描述</th></tr>'
        + rds.slice(0, 12).map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td>' + esc(statusCn(x.status)) + '</td><td>' + esc((x.description || '').slice(0, 40)) + '</td></tr>'; }).join('')
        + '</table></div>';
    }
    if (equip.length) {
      initChart('gdEquip', {
        tooltip: { trigger: 'item', formatter: '{b}：{c} 台（{d}%）' }, legend: { bottom: 0, textStyle: { fontSize: 11 } },
        series: [{ type: 'pie', radius: ['40%', '66%'], center: ['50%', '44%'], itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { show: true, formatter: '{b}\n{c}台', fontSize: 10 }, data: eqArr }]
      });
    }

    countUp(document.getElementById('gdrProj'), rds.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdrDone'), doneN, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdrRate'), rate, 1000, function (v) { return fmt(v, 0); });
    countUp(document.getElementById('gdrBom'), bom.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdrEquip'), equip.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdrTable'), rds.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdrRateBig'), rate, 1000, function (v) { return fmt(v, 1) + '%'; });
    countUp(document.getElementById('gdrRateTxt'), rate, 1000, function (v) { return fmt(v, 1) + '%'; });
    requestAnimationFrame(function () {
      document.getElementById('gdrBar').style.width = Math.min(rate, 100).toFixed(1) + '%';
    });
  }


  function renderAdmin() {
    var b = document.getElementById('glsDashBody');
    var central = getCentral();
    var accs = central.accounts || [];
    var trs = bizOf(central.training);
    var docs = bizOf(central.documents);
    var activeN = accs.filter(function (x) { return x.status === 'active'; }).length;
    var arate = accs.length ? activeN / accs.length * 100 : 0;
    var deptN = {};
    accs.forEach(function (x) { deptN[x.dept || '未填'] = (deptN[x.dept || '未填'] || 0) + 1; });

    function hero(cls, ic, body, label) {
      return '<div class="gd-s-hero ' + cls + '"><div class="ic">' + ic + '</div><div class="num">' + body + '</div><div class="lb">' + label + '</div></div>';
    }
    var html = '<div class="gd-sales-hero">'
      + hero('b1', '👤', '<span id="gdaAcc">0</span>', '系统账号（个）')
      + hero('b2', '✅', '<span id="gdaActive">0</span>', '启用账号（个）')
      + hero('b3', '🎓', '<span id="gdaTr">0</span>', '培训记录（项）')
      + hero('b4', '📚', '<span id="gdaDoc">0</span>', '体系文件（份）')
      + hero('b5', '🏢', '<span id="gdaDept">0</span>', '覆盖部门（个）')
      + hero('b6', '🛡️', '<span id="gdaRole">0</span>', '角色类型（种）')
      + '</div>';

    var qt = arate >= 90 ? 'gt' : '';
    html += '<div class="gd-target-card">'
      + '<div class="tt"><span class="t">👥 账号启用率进度</span>'
      + '<span class="set" style="font-size:12px;color:#64748b">启用 ' + activeN + ' / ' + accs.length + ' 个</span></div>'
      + '<div class="gd-bar"><i id="gdaBar" class="' + qt + '"></i></div>'
      + '<div class="pr"><span>启用率 <b id="gdaRateBig">0%</b></span><span id="gdaRateTxt">0%</span></div>'
      + '</div>';

    var docMap = groupCount(docs, 'type');
    var docArr = Object.keys(docMap).map(function (k) { return { key: k, n: docMap[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 10);

    var grid = '<div class="gd-grid">';
    if (accs.length) {
      grid += card('👥 账号部门分布', '按部门自动汇总', 'gdAccDept');
      grid += card('🛡️ 账号角色分布', '按角色自动汇总', 'gdAccRole');
    } else {
      grid += cardEmpty('👥 账号部门分布', '暂无账号数据。');
    }
    if (trs.length) {
      grid += card('🎓 培训记录状态分布', '按状态自动汇总', 'gdTrStatus');
      grid += card('📋 培训明细', '最近培训记录', 'gdTrTable', 'tall');
    } else {
      grid += cardEmpty('🎓 培训记录', '暂无培训记录。在「培训管理」录入后自动出图。');
    }
    if (docs.length) {
      grid += '<div class="gd-card"><h4>📚 体系文件类型分布</h4><div class="gd-sub">按类型自动汇总</div><div id="gdDoc">' + (docArr.length ? '' : '<div class="gd-sub" style="padding:14px 0">暂无数据</div>') + '</div></div>';
    } else {
      grid += cardEmpty('📚 体系文件', '暂无体系文件数据。');
    }
    html += grid + '</div>';
    b.innerHTML = html;

    if (docArr.length) document.getElementById('gdDoc').innerHTML = rankHtml(docArr, docArr[0].n, '份');

    if (accs.length) {
      var deptMap = groupCount(accs, 'dept');
      var roleMap = groupCount(accs, 'role');
      initChart('gdAccDept', {
        tooltip: { trigger: 'item', formatter: '{b}：{c} 个（{d}%）' }, legend: { bottom: 0, textStyle: { fontSize: 11 } },
        series: [{ type: 'pie', radius: ['40%', '66%'], center: ['50%', '44%'], itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { show: true, formatter: '{b}\n{c}个', fontSize: 10 }, data: Object.keys(deptMap).map(function (k) { return { name: k, value: deptMap[k] }; }) }]
      });
      initChart('gdAccRole', {
        tooltip: { trigger: 'item', formatter: '{b}：{c} 个（{d}%）' }, legend: { bottom: 0, textStyle: { fontSize: 11 } },
        series: [{ type: 'pie', radius: ['40%', '66%'], center: ['50%', '44%'], itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { show: true, formatter: '{b}\n{c}个', fontSize: 10 }, data: Object.keys(roleMap).map(function (k) { return { name: k, value: roleMap[k] }; }) }]
      });
    }
    if (trs.length) {
      var trSt = groupCount(trs, 'status');
      initChart('gdTrStatus', {
        tooltip: { trigger: 'item', formatter: '{b}：{c} 项（{d}%）' }, legend: { bottom: 0, textStyle: { fontSize: 11 } },
        series: [{ type: 'pie', radius: ['40%', '66%'], center: ['50%', '44%'], itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { show: true, formatter: '{b}\n{c}项', fontSize: 11 }, data: Object.keys(trSt).map(function (k) { return { name: statusCn(k), value: trSt[k] }; }) }]
      });
      document.getElementById('gdTrTable').innerHTML = '<div class="gd-table-wrap"><table class="gd-table"><tr><th>培训</th><th>状态</th><th>描述</th></tr>'
        + trs.slice(0, 10).map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td>' + esc(statusCn(x.status)) + '</td><td>' + esc((x.description || '').slice(0, 40)) + '</td></tr>'; }).join('')
        + '</table></div>';
    }

    var roleN = 0, deptCnt = 0;
    if (accs.length) {
      var roleMap2 = groupCount(accs, 'role'); roleN = Object.keys(roleMap2).length;
      var deptMap2 = groupCount(accs, 'dept'); deptCnt = Object.keys(deptMap2).length;
    }
    countUp(document.getElementById('gdaAcc'), accs.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdaActive'), activeN, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdaTr'), trs.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdaDoc'), docs.length, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdaDept'), deptCnt, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdaRole'), roleN, 800, function (v) { return fmt(Math.round(v), 0); });
    countUp(document.getElementById('gdaRateBig'), arate, 1000, function (v) { return fmt(v, 1) + '%'; });
    countUp(document.getElementById('gdaRateTxt'), arate, 1000, function (v) { return fmt(v, 1) + '%'; });
    requestAnimationFrame(function () {
      document.getElementById('gdaBar').style.width = Math.min(arate, 100).toFixed(1) + '%';
    });
  }

  function renderDept(deptId) {
    var db = getDB();
    var recs = filterRecs(db.inspections || []);
    switch (deptId) {
      case 'quality': renderQuality(recs); break;
      case 'production': renderProduction(); break;
      case 'warehouse': renderWarehouse(); break;
      case 'purchasing': renderPurchasing(); break;
      case 'sales': renderSales(); break;
      case 'rd': renderRd(); break;
      case 'admin': renderAdmin(); break;
      default: renderQuality(recs);
    }
  }

  /* ============ 对外 ============ */
  window.GLS_DASH = {
    render: render,
    setDept: function (d) { S.dept = d; render(); },
    setType: function (t) { S.type = t; render(); },
    setRange: function (r) { S.range = r; render(); },
    saveTarget: saveTarget,
    _stats: stats, _depts: DEPTS
  };

  if (!_inited) {
    _inited = true;
    var _t = null;
    window.addEventListener('resize', function () {
      clearTimeout(_t);
      _t = setTimeout(function () {
        if (!document.getElementById('page-dashboard') || !document.getElementById('page-dashboard').classList.contains('active')) return;
        resizeAll();
      }, 150);
    });
  }
})();
