/* gls-inspect.js — 检验工作台：扫码判定 / 不合格审批 / 自动流转 / Excel 导入导出
 * 数据存 localStorage: gls_inspect_db_v1
 * 依赖: window.PQS_DATA.materials（物料主数据）、可选 window.exportHtmlTableToXlsx
 */
(function () {
  'use strict';

  var LS_KEY = 'gls_inspect_db_v1';

  /* ===== 可配置区（改这里即可调整流程，不写死） ===== */
  var TYPES = {
    IQC:    { name: '来料检验', needSupplier: true,  passFlow: '待检入库 → 仓储部确认' },
    FIRST:  { name: '首件检验', needSupplier: false, passFlow: '同意量产 → 正式生产' },
    PATROL: { name: '巡检',     needSupplier: false, passFlow: '继续生产' },
    OQC:    { name: '成品检验', needSupplier: false, passFlow: '成品入库 → 仓储部' }
  };
  /* 检验类型 → 字段规则（改这里即可调整，不用动别的代码）
     label：换个叫法；ro:true：置灰不可操作（仍可见、值仍会存）；hide:true：整项不显示
     来料检验（IQC）四项都可操作；首件/巡检/成品 只改名称与可操作性 */
  var NON_IQC_RULE = {
    matName: { label: '产品名称' },
    supplier: { ro: true },
    batch: { ro: true },
    recvQty: { ro: true }
  };
  var TYPE_FIELD_RULES = {
    IQC: {},              /* 来料检验：物料名称、供应商、批次号、来料数量 都可操作 */
    FIRST: NON_IQC_RULE,  /* 首件检验 */
    PATROL: NON_IQC_RULE, /* 巡检 */
    OQC: NON_IQC_RULE     /* 成品检验 */
  };
  function rulesOf(type) { return TYPE_FIELD_RULES[type] || {}; }

  /* 状态机：
   * 合格单：新建 → 待审批(部门上级放行流转权限) → 已流转(到下一部门) / 已驳回(退回检验人)
   * 不合格单：新建 → 待评审(MRB 不合格品评审) → 已流转(按 MRB 结论处理) / 已驳回(退回重检)
   */
  var STATUS = {
    APPROVING: '待审批',
    MRB:       '待评审',
    REJECTED:  '已驳回',
    FLOWED:    '已流转'
  };
  // 不合格品 MRB 可选结论（可视化修改口子）
  var MRB_OPTIONS = ['退货', '挑选使用', '特采接收', '返工返修', '报废', '重新检验'];

  /* ===== 工具 ===== */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function uid() { return 'in' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function today() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function now() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function toast(msg, ok) {
    var t = $('inspToast');
    if (!t) { t = document.createElement('div'); t.id = 'inspToast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'insp-toast show' + (ok === false ? ' err' : '');
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.className = 'insp-toast'; }, 2400);
  }

  /* ===== 数据层 ===== */
  var DB = { inspections: [], flowLog: [] };
  function loadDB() {
    try {
      var p = (window.DATAHUB && DATAHUB.get('inspect')) || (function () {
        try { var raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
      })();
      if (p && Array.isArray(p.inspections)) { DB = p; return; }
    } catch (e) {}
    DB = { inspections: [], flowLog: [] };
  }
  function saveDB() {
    try {
      if (window.DATAHUB) { DATAHUB.set('inspect', DB); return; }
      localStorage.setItem(LS_KEY, JSON.stringify(DB));
    }
    catch (e) { toast('保存失败：' + e.message, false); }
  }
  function nextNo(type) {
    var d = today().replace(/-/g, '');
    var prefix = type + '-' + d + '-';
    var max = 0;
    DB.inspections.forEach(function (r) {
      if (r.no && r.no.indexOf(prefix) === 0) {
        var n = parseInt(r.no.slice(prefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
    return prefix + String(max + 1).padStart(3, '0');
  }
  function findMaterial(code) {
    if (window.DATAHUB) { var r = DATAHUB.findMaterial(code); if (r) return r; }
    var mats = (window.PQS_DATA && window.PQS_DATA.materials) || [];
    code = String(code || '').trim().toLowerCase();
    for (var i = 0; i < mats.length; i++) {
      if (String(mats[i].code || '').toLowerCase() === code) return mats[i];
    }
    for (i = 0; i < mats.length; i++) {
      if (String(mats[i].name || '').toLowerCase().indexOf(code) >= 0) return mats[i];
    }
    return null;
  }

  /* ===== 样式 ===== */
  function injectCSS() {
    if ($('inspStyle')) return;
    var s = document.createElement('style');
    s.id = 'inspStyle';
    s.textContent = [
      '#page-insp-home,#page-insp-form,#page-insp-list,#page-insp-approve{padding:20px;box-sizing:border-box;max-width:1500px;margin:0 auto;}',
      '.insp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin:16px 0;}',
      '.insp-card{background:#fff;border-radius:10px;padding:18px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.06);transition:.2s;border-left:4px solid #2c5e36;}',
      '.insp-card:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.1);}',
      '.insp-card .t{font-size:16px;font-weight:600;margin-bottom:6px;}',
      '.insp-card .d{font-size:12px;color:#888;line-height:1.6;}',
      /* 4 类检验单合一：整行大卡，里面每类一行 */
      '.insp-one{grid-column:1/-1;cursor:default;}',
      '.insp-one:hover{transform:none;box-shadow:0 1px 3px rgba(0,0,0,.06);}',
      '.insp-types{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 26px;}',
      '.insp-type{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px dashed #eef0ee;}',
      '.insp-type:nth-child(-n+2){border-top:0;}',
      '@media(max-width:700px){.insp-types{grid-template-columns:1fr;}'
      + '.insp-type:nth-child(-n+2){border-top:1px dashed #eef0ee;}.insp-type:first-child{border-top:0;}}',
      '.insp-type .nm{font-size:14px;font-weight:600;color:#2c5e36;white-space:nowrap;}',
      '.insp-type .fl{flex:1;min-width:0;}',
      '.insp-type .ct{color:#999;white-space:nowrap;}',
      '.insp-type .go{font-size:12px;padding:4px 12px;white-space:nowrap;}',
      '.insp-badge{display:inline-block;background:#f56c6c;color:#fff;border-radius:10px;padding:1px 8px;font-size:12px;margin-left:6px;}',
      '.insp-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:16px 0;}',
      '.insp-toolbar input,.insp-toolbar select{padding:9px 12px;border:1px solid #dcdfe6;border-radius:6px;font-size:14px;}',
      '.insp-btn{padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-family:inherit;}',
      '.insp-btn-p{background:#2c5e36;color:#fff;}.insp-btn-p:hover{background:#3a7a47;}',
      '.insp-btn-g{background:#fff;border:1px solid #dcdfe6;color:#333;}.insp-btn-g:hover{border-color:#2c5e36;color:#2c5e36;}',
      '.insp-btn-r{background:#f56c6c;color:#fff;}.insp-btn-r:hover{background:#f78989;}',
      '.insp-btn-o{background:#e6a23c;color:#fff;}.insp-btn-o:hover{background:#ebb563;}',
      '.insp-table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);}',
      '.insp-table th,.insp-table td{padding:9px 11px;text-align:left;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:top;line-height:1.6;}',
      '.insp-table th{background:#fafafa;font-weight:600;white-space:nowrap;}',
      '.insp-table tr:hover td{background:#fafcff;}',
      '.insp-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;}',
      '.insp-tag-p{background:#f0f9eb;color:#67c23a;}',
      '.insp-tag-f{background:#fef0f0;color:#f56c6c;}',
      '.insp-tag-w{background:#fdf6ec;color:#e6a23c;}',
      '.insp-tag-g{background:#f4f4f5;color:#909399;}',
      '.insp-form{background:#fff;border-radius:10px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.06);max-width:900px;}',
      '.insp-row{display:grid;grid-template-columns:140px 1fr;gap:10px;align-items:center;margin-bottom:12px;}',
      '.insp-row label{font-size:13px;color:#606266;text-align:right;}',
      '.insp-row input,.insp-row select,.insp-row textarea{padding:8px 10px;border:1px solid #dcdfe6;border-radius:6px;font-size:14px;font-family:inherit;width:100%;box-sizing:border-box;}',
      '.insp-row textarea{min-height:70px;resize:vertical;line-height:1.6;}',
      '.insp-scan{display:flex;gap:8px;}',
      '.insp-scan input{flex:1;}',
      '.insp-std{background:#f8f9fa;border-left:3px solid #2c5e36;padding:12px;border-radius:4px;margin:10px 0;font-size:13px;line-height:1.8;}',
      '.insp-std b{color:#2c5e36;}',
      '.insp-result{display:flex;gap:10px;margin:14px 0;}',
      '.insp-result label{flex:1;padding:14px;border:2px solid #dcdfe6;border-radius:8px;text-align:center;cursor:pointer;font-size:14px;}',
      '.insp-result input{display:none;}',
      '.insp-result input:checked + span{font-weight:600;}',
      '.insp-result label:has(input:checked[value=pass]){border-color:#67c23a;background:#f0f9eb;}',
      '.insp-result label:has(input:checked[value=fail]){border-color:#f56c6c;background:#fef0f0;}',
      '.insp-toast{position:fixed;left:50%;bottom:60px;transform:translateX(-50%) translateY(20px);background:rgba(48,49,51,.92);color:#fff;padding:11px 22px;border-radius:8px;font-size:14px;opacity:0;pointer-events:none;transition:.25s;z-index:10001;}',
      '.insp-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}',
      '.insp-toast.err{background:#f56c6c;}',
      '.insp-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:10000;}',
      '.insp-modal{background:#fff;border-radius:12px;width:min(680px,94vw);max-height:88vh;overflow-y:auto;padding:22px;}',
      '.insp-flow{font-size:13px;line-height:2;color:#606266;}',
      '.insp-flow b{color:#2c5e36;}',
      '.insp-digestwrap{margin:14px 0 4px;background:#f8faf9;border:1px solid #e3ece6;border-radius:8px;padding:12px 14px}',
      '.insp-digest{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}',
      '.insp-digest th{width:34%;text-align:left;font-weight:500;color:#4b5563;background:#eef4f0;border:1px solid #dbe7e0;padding:7px 10px;vertical-align:top}',
      '.insp-digest td{border:1px solid #dbe7e0;padding:7px 10px;color:#111827;background:#fff;word-break:break-word;line-height:1.7}',
      '@media(max-width:768px){.insp-digest th{width:40%}}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ===== 路由 ===== */
  function showPage(id) {
    document.querySelectorAll('.page').forEach(function (el) { el.classList.remove('active'); });
    var el = $(id);
    if (el) el.classList.add('active');
    window.scrollTo(0, 0);
    var pt = $('pageTitle'); if (pt) pt.textContent = '🔍 检验工作台';
    document.querySelectorAll('#sidebarNav .nav-item').forEach(function (n) {
      n.classList.toggle('active', n.getAttribute('data-insp-entry') === '1');
    });
    var fab = $('fabAdd'); if (fab) fab.style.display = 'none';
    var sb = $('searchBtn'); if (sb) sb.style.display = 'none';
  }

  /* ===== 主页 ===== */
  function countApproving() {
    return DB.inspections.filter(function (r) { return r.status === STATUS.APPROVING; }).length;
  }
  function countMrb() {
    return DB.inspections.filter(function (r) { return r.status === STATUS.MRB; }).length;
  }
  function openHome() {
    showPage('page-insp-home');
    $('inspHomeBody').innerHTML = homeHTML();
  }

  function homeHTML() {
    var ap = countApproving(), mrb = countMrb();
    var h = '<div class="insp-toolbar">'
      + '<button class="insp-btn insp-btn-g" onclick="INSP.openHome()">刷新</button>'
      + '<button class="insp-btn insp-btn-p" onclick="INSP.openForm()">＋ 新建检验单</button>'
      + '<button class="insp-btn insp-btn-g" onclick="INSP.openImport()">📥 表格导入</button>'
      + '<button class="insp-btn insp-btn-g" onclick="INSP.exportRecords()">📤 导出记录</button>'
      + '<span style="margin-left:auto;color:#888;font-size:13px">累计 ' + DB.inspections.length + ' 单</span>'
      + '</div>';

    h += '<div class="insp-grid">';
    /* 4 类检验单原先是 4 张一样的卡（点开都是同一套表单），整合成一张：
       类型 / 放行流程 / 本类已建单数 在一行里看全，每类直接「＋ 新建」 */
    h += '<div class="insp-card insp-one">'
      + '<div class="t">检验单 <span style="font-size:12px;color:#999;font-weight:400">'
      + Object.keys(TYPES).length + ' 类合一 · 同一套表单，只是检验类型不同</span></div>'
      + '<div class="d insp-types">';
    Object.keys(TYPES).forEach(function (k) {
      var t = TYPES[k];
      var cnt = DB.inspections.filter(function (r) { return r.type === k; }).length;
      h += '<div class="insp-type">'
        + '<span class="nm">' + t.name + '</span>'
        + '<span class="fl">合格放行 → ' + t.passFlow + '<br>不合格 → 进入 MRB 评审</span>'
        + '<span class="ct">已建单 <b>' + cnt + '</b></span>'
        + '<button class="insp-btn insp-btn-p go" onclick="event.stopPropagation();INSP.openForm(\'' + k + '\')">＋ 新建</button>'
        + '</div>';
    });
    h += '</div></div>';
    // 合格单的流转审批（部门上级）
    h += '<div class="insp-card" style="border-left-color:#e6a236" onclick="INSP.openApprove()">'
      + '<div class="t">流转审批' + (ap ? '<span class="insp-badge">' + ap + '</span>' : '') + '</div>'
      + '<div class="d">合格单放行到下一部门<br>本部门上级审批通过后自动交棒</div></div>';
    // 不合格品 MRB 评审（另一套）
    h += '<div class="insp-card" style="border-left-color:#f56c6c" onclick="INSP.openMrb()">'
      + '<div class="t">不合格评审' + (mrb ? '<span class="insp-badge">' + mrb + '</span>' : '') + '</div>'
      + '<div class="d">MRB 不合格品评审<br>结论：退货/挑选/特采/返工/报废</div></div>';
    h += '<div class="insp-card" style="border-left-color:#409eff" onclick="INSP.openList()">'
      + '<div class="t">检验记录</div><div class="d">全部检验单 · 状态追溯<br>支持导出 Excel</div></div>';
    h += '</div>';

    // 最近 5 条
    h += '<h3 style="margin:20px 0 10px;font-size:15px">最近检验单</h3>';
    var recent = DB.inspections.slice(-5).reverse();
    if (!recent.length) h += '<div style="background:#fff;padding:30px;text-align:center;color:#999;border-radius:8px">暂无检验单，点上方「新建检验单」开始</div>';
    else h += recordTable(recent);
    return h;
  }

  function recordTable(list) {
    var h = '<table class="insp-table"><thead><tr>'
      + '<th>单号</th><th>类型</th><th>日期</th><th>物料</th><th>批次</th><th>数量</th>'
      + '<th>结果</th><th>状态</th><th>检验人</th><th>流转去向</th><th>操作</th></tr></thead><tbody>';
    if (!list.length) h += '<tr><td colspan="11" style="text-align:center;color:#999;padding:24px">暂无记录</td></tr>';
    list.forEach(function (r) {
      var t = TYPES[r.type] || { name: r.type };
      var resultCls = r.result === 'pass' ? 'insp-tag-p' : 'insp-tag-f';
      var stCls = r.status === STATUS.APPROVING ? 'insp-tag-w'
        : r.status === STATUS.MRB ? 'insp-tag-f'
        : r.status === STATUS.REJECTED ? 'insp-tag-g'
        : 'insp-tag-p';
      h += '<tr><td>' + esc(r.no) + '</td><td>' + esc(t.name) + '</td><td>' + esc(r.date) + '</td>'
        + '<td><a href="javascript:;" style="font-weight:600;color:#2c5e36;text-decoration:none;border-bottom:1px dashed #2c5e36" onclick="INSP.matDetail(\'' + esc(r.matCode) + '\')">' + esc(r.matName) + '</a><br><span style="color:#999;font-size:12px">' + esc(r.matCode) + '</span></td>'
        + '<td>' + esc(r.batch || '—') + '</td><td>' + esc(r.qty || '—') + '</td>'
        + '<td><span class="insp-tag ' + resultCls + '">' + (r.result === 'pass' ? '合格' : '不合格') + '</span></td>'
        + '<td><span class="insp-tag ' + stCls + '">' + esc(r.status) + '</span></td>'
        + '<td>' + esc(r.inspector || '—') + '</td>'
        + '<td style="font-size:12px">' + esc(r.flowTo || '—') + '</td>'
        + '<td><button class="insp-btn insp-btn-g" style="padding:3px 9px;font-size:12px" onclick="INSP.viewDetail(\'' + r._id + '\')">详情</button></td></tr>';
    });
    return h + '</tbody></table>';
  }

  /* ===== 新建检验单（扫码） ===== */
  function openForm(type, vals) {
    showPage('page-insp-form');
    var cur = vals || { type: (type || 'IQC'), date: today() };
    if (!cur.type) cur.type = (type || 'IQC');
    var h = '<h2 style="margin:0 0 16px">新建检验单</h2><div class="insp-form">';

    if (window.FIELDS) {
      /* 字段全部来自配置：可在「⚙ 配置项目」里随时增/减/改，无需改代码
         rules：按「检验类型」改字段（来料检验全可操作；首件/巡检/成品 只换名称、供应商与批次等置灰） */
      h += FIELDS.render('inspect', cur, { rules: rulesOf(cur.type) });
    } else {
      h += legacyFields(cur.type);
    }

    h += '<div style="text-align:right;margin-top:18px">'
      + '<button class="insp-btn insp-btn-g" onclick="INSP.openHome()">取消</button> '
      + '<button class="insp-btn insp-btn-p" onclick="INSP.saveForm()">提交并自动流转</button></div>';
    h += '</div>';
    $('inspFormBody').innerHTML = h;

    /* 换检验类型：按新类型的规则重渲染，已填内容原样带过去 */
    var tsel = $('fx_inspect_type');
    if (tsel && !tsel.getAttribute('data-bound')) {
      tsel.setAttribute('data-bound', '1');
      tsel.addEventListener('change', function () { retype(); });
    }

    /* 检验标准展示盒：插在「扫码 / 物料编码」后面 */
    var scanRow = document.querySelector('#inspFormBody .fx-row[data-key="matCode"]');
    if (scanRow && !$('fStdBox')) {
      var box = document.createElement('div');
      box.id = 'fStdBox';
      scanRow.parentNode.insertBefore(box, scanRow.nextSibling);
    }
  }

  function retype() {
    var el = $('fx_inspect_type');
    var t = el ? String(el.value || 'IQC') : 'IQC';
    var vals = null;
    if (window.FIELDS) { try { vals = FIELDS.collect('inspect'); } catch (e) { vals = null; } }
    if (!vals) vals = { type: t, date: today() };
    vals.type = t;
    if (!vals.date) vals.date = today();
    openForm(t, vals);
    toast('已切换到「' + ((TYPES[t] || {}).name || t) + '」');
  }

  /* 引擎未加载时的兜底（老版硬编码字段） */
  function legacyFields(type) {
    var h = '';
    h += '<div class="insp-row"><label>检验类型 *</label><select id="fType">';
    Object.keys(TYPES).forEach(function (k) {
      h += '<option value="' + k + '"' + (type === k ? ' selected' : '') + '>' + TYPES[k].name + '</option>';
    });
    h += '</select></div>';
    h += '<div class="insp-row"><label>扫码 / 物料编码 *</label><div class="insp-scan">'
      + '<input id="fMatCode" placeholder="扫码"' + '>'
      + '<button class="insp-btn insp-btn-g" onclick="INSP.scanMaterial()">带出标准</button></div></div>';
    h += '<div class="insp-row"><label>物料名称</label><input id="fMatName" readonly></div>';
    h += '<div class="insp-row"><label>供应商</label><input id="fSupplier"></div>';
    h += '<div class="insp-row"><label>批次号</label><input id="fBatch"></div>';
    h += '<div class="insp-row"><label>数量</label><input id="fQty" type="number"></div>';
    h += '<div class="insp-row"><label>实测记录</label><textarea id="fMeasured"></textarea></div>';
    h += '<div class="insp-row"><label>检验人</label><input id="fInspector"></div>';
    h += '<div class="insp-row"><label>检验日期</label><input id="fDate" type="date" value="' + today() + '"></div>';
    h += '<div class="insp-row"><label>判定结果 *</label><div class="insp-result">'
      + '<label><input type="radio" name="fResult" value="pass"><span>✓ 合格</span></label>'
      + '<label><input type="radio" name="fResult" value="fail"><span>✗ 不合格</span></label></div></div>';
    return h;
  }

  function scanMaterial() {
    var codeEl = $('fx_inspect_matCode') || $('fMatCode');
    var code = codeEl ? String(codeEl.value || '').trim() : '';
    if (!code) { toast('请先扫码或输入物料编码', false); return; }
    var nameEl = $('fx_inspect_matName') || $('fMatName');
    var box = $('fStdBox');
    var m = findMaterial(code);
    if (!m) {
      if (box) box.innerHTML = '<div class="insp-std" style="border-left-color:#e6a23c"><b>未找到物料「' + esc(code)
        + '」</b>，可手动填写。建议先到「品质资料库 → 物料检验标准」补录该物料。</div>';
      if (nameEl) nameEl.value = '';
      return;
    }
    /* 先把「物料名称 / 供应商」两个下拉按这个编码重算，再回填，值才落得进去 */
    if (window.FIELDS && FIELDS.syncDep) { try { FIELDS.syncDep('inspect', 'matCode'); } catch (e) {} }
    if (nameEl) {
      nameEl.value = m.name || '';
      if (nameEl.tagName === 'SELECT' && nameEl.value !== (m.name || '') && m.name) {
        nameEl.insertAdjacentHTML('beforeend', '<option value="' + String(m.name).replace(/[&<>"]/g, '') + '"></option>');
        nameEl.value = m.name;
      }
    }
    if (box) box.innerHTML = '<div class="insp-std"><b>已带出检验标准：</b><br>'
      + '分类：' + esc(m.cls || '—') + '　版本：' + esc(m.ver || '—') + '<br>'
      + '<b>关键检验要求：</b>' + esc(m.key || '—') + '<br>'
      + '<b>检验手段：</b>' + esc(m.tool || '—') + '</div>';
    toast('已带出：' + m.name);
  }

  function saveForm() {
    var d = null;
    if (window.FIELDS) { d = FIELDS.collect('inspect'); }

    var type, code, result, supplier, dateV, matNameV, batch, qty, measured, inspector;
    if (d) {
      type = d.type || 'IQC';
      code = String(d.matCode || '').trim();
      result = d.result || '';
      supplier = String(d.supplier || '').trim();
      dateV = d.date || today();
      matNameV = d.matName || '';
      batch = String(d.batch || '').trim();
      qty = String(d.qty || '').trim();
      measured = String(d.measured || '').trim();
      inspector = String(d.inspector || '').trim();
      if (!code) { toast('请扫码或输入物料编码', false); return; }
      if (!result) { toast('请判定合格/不合格', false); return; }
      var vd = FIELDS.validate('inspect', d);
      if (!vd.ok) { toast(vd.msg, false); return; }
    } else {
      type = $('fType').value;
      code = $('fMatCode').value.trim();
      if (!code) { toast('请扫码或输入物料编码', false); return; }
      var resultEl = document.querySelector('input[name=fResult]:checked');
      if (!resultEl) { toast('请判定合格/不合格', false); return; }
      result = resultEl.value;
      supplier = $('fSupplier').value.trim();
      dateV = $('fDate').value || today();
      matNameV = $('fMatName').value;
      batch = $('fBatch').value.trim();
      qty = $('fQty').value.trim();
      measured = $('fMeasured').value.trim();
      inspector = $('fInspector').value.trim();
    }

    var t = TYPES[type] || TYPES.IQC;
    if (t.needSupplier && !supplier) {
      if (!confirm('来料检验建议填供应商，仍要提交吗？')) return;
    }

    var m = findMaterial(code) || {};
    var rec = {
      _id: uid(), no: nextNo(type), type: type,
      date: dateV,
      matCode: code, matName: matNameV || m.name || code,
      supplier: supplier,
      batch: batch,
      qty: qty,
      standard: m.key || '',
      measured: measured,
      result: result,
      inspector: inspector,
      status: '', approver: '', approveNote: '', approvedAt: '',
      flowTo: '', flowNote: '', flowId: '', flowNo: '', createdAt: now()
    };
    /* 表单里所有项目都平铺存到单据顶层（含以后在「配置项目」里自行新增的字段），
       这样导出、单据串联、报表都能直接读到；老单据里存在 extra 下的历史数据仍可正常读取。 */
    if (d) {
      Object.keys(d).forEach(function (k) {
        if (k in rec) return;
        rec[k] = d[k];
      });
    }

    DB.inspections.push(rec);
    /* 与业务流程打通：合格 → 提交本环节审批；不合格 → 进入不合格评审（MRB） */
    var lk = null;
    try { lk = (window.BIZFLOW && BIZFLOW.linkInspSubmit) ? BIZFLOW.linkInspSubmit(rec) : null; } catch (e) { lk = null; }
    if (lk && lk.ok) { rec.flowId = lk.flowId; rec.flowNo = lk.flowNo; }
    if (result === 'pass') {
      rec.status = STATUS.APPROVING;
      rec.flowTo = '';
      rec.flowNote = (lk && lk.ok)
        ? ('检验合格，已提交审批；流程单 ' + lk.flowNo + ' 现在 ' + lk.dest)
        : ('检验合格，待部门上级审批放行到：' + t.passFlow + (lk && lk.reason ? '（' + lk.reason + '）' : ''));
      DB.flowLog.push({ at: now(), no: rec.no, act: '合格单进入流转审批队列' + (lk && lk.ok ? '，已关联流程 ' + lk.flowNo : '') });
      toast((lk && lk.ok) ? ('已提交：合格，待审批（流程 ' + lk.flowNo + '）') : '已提交：合格，待部门上级审批放行');
    } else {
      rec.status = STATUS.MRB;
      rec.flowTo = '';
      rec.flowNote = (lk && lk.ok)
        ? ('检验不合格，已进入不合格评审（MRB）；流程单 ' + lk.flowNo + ' 现在 ' + lk.dest)
        : ('检验不合格，进入 MRB 评审' + (lk && lk.reason ? '（' + lk.reason + '）' : ''));
      DB.flowLog.push({ at: now(), no: rec.no, act: '不合格单进入 MRB 评审' + (lk && lk.ok ? '，已关联流程 ' + lk.flowNo : '') });
      toast((lk && lk.ok) ? ('已提交：不合格，已进入评审（流程 ' + lk.flowNo + '）') : '已提交：不合格，进入 MRB 评审');
    }
    saveDB();
    openHome();
  }

  /* ===== 流转审批（合格单，部门上级放行到下一部门） ===== */
  function openApprove() {
    showPage('page-insp-approve');
    var list = DB.inspections.filter(function (r) { return r.status === STATUS.APPROVING; });
    var h = '<h2 style="margin:0 0 16px">流转审批（' + list.length + '）</h2>';
    if (!list.length) h += '<div style="background:#fff;padding:30px;text-align:center;color:#999;border-radius:8px">暂无待审批单据</div>';
    else {
      h += '<p style="color:#888;font-size:13px">这是<b>合格单的流转权限审批</b>：本部门上级确认无误后放行，单据自动交棒到下一部门环节；驳回则退回检验人重检。</p>';
      list.forEach(function (r) {
        var t = TYPES[r.type] || { name: r.type, passFlow: '' };
        h += '<div style="background:#fff;border-radius:10px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06)">'
          + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
          + '<b>' + esc(r.no) + '</b><span class="insp-tag insp-tag-w">合格 · 待放行</span></div>'
          + '<div class="insp-flow">'
          + '类型：<b>' + esc(t.name) + '</b>　日期：' + esc(r.date) + '　检验人：' + esc(r.inspector || '—') + '<br>'
          + '物料：<b>' + esc(r.matName) + '</b>（' + esc(r.matCode) + '）　批次：' + esc(r.batch || '—') + '　数量：' + esc(r.qty || '—') + '<br>'
          + '标准要求：' + esc(r.standard || '—') + '<br>'
          + '实测记录：' + esc(r.measured || '—') + '<br>'
          + '拟流转去向：<b>' + esc(t.passFlow) + '</b></div>'
          + (digestHtml(r)
            ? '<div class="insp-digestwrap"><b style="color:#2c5e36;font-size:13px">审批依据 · 本单全部项目</b>' + digestHtml(r) + '</div>'
            : '')
          + '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">'
          + '<button class="insp-btn insp-btn-r" onclick="INSP.askApprove(\'' + r._id + '\',\'reject\')">驳回到检验人</button>'
          + '<button class="insp-btn insp-btn-p" onclick="INSP.askApprove(\'' + r._id + '\',\'pass\')">审批通过 · 自动流转</button>'
          + '</div></div>';
      });
    }
    $('inspApproveBody').innerHTML = h;
  }

  /* 收审批意见：页内弹框（手机上 window.prompt 会直接返回 null，点了没反应） */
  function askApprove(id, decision) {
    var r = DB.inspections.filter(function (x) { return x._id === id; })[0];
    if (!r) return;
    var t = TYPES[r.type] || { name: r.type, passFlow: '' };
    var pass = (decision === 'pass');
    closeApproveDlg();
    var d = document.createElement('div');
    d.id = 'inspApproveDlg';
    d.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.45);'
      + 'z-index:9999;display:flex;align-items:center;justify-content:center;padding:18px;';
    d.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:470px;width:100%;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.22)">'
      + '<div style="padding:15px 17px;border-bottom:1px solid #eef0f2">'
      +   '<div style="font-weight:700;font-size:16px;color:#111827">' + (pass ? '审批通过 · 放行' : '驳回 · 退回检验人') + '</div>'
      +   '<div style="font-size:12.5px;color:#6b7280;margin-top:4px">' + esc(r.no) + ' ｜ 类型：' + esc(t.name || r.type) + '</div>'
      + '</div>'
      + '<div style="padding:13px 17px 4px">'
      +   '<div style="font-size:13px;color:#374151;margin-bottom:7px">' + (pass ? '审批意见（可留空，将随单据留痕）' : '驳回原因（必填）') + '</div>'
      +   '<textarea id="inspApproveText" rows="3" placeholder="' + (pass ? '可留空' : '请写明原因，便于检验人整改') + '"'
      +   ' style="width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:9px;font-size:14px;resize:vertical;font-family:inherit"></textarea>'
      + '</div>'
      + '<div style="padding:10px 17px 16px;display:flex;gap:10px">'
      +   '<span class="insp-btn insp-btn-g" style="flex:1;text-align:center;padding:9px" onclick="INSP.closeApproveDlg()">取消</span>'
      +   '<span class="insp-btn ' + (pass ? 'insp-btn-g' : 'insp-btn-r') + '" style="flex:1;text-align:center;padding:9px"'
      +   ' onclick="INSP.approve(\'' + id + '\',\'' + decision + '\')">' + (pass ? '确认通过' : '确认驳回') + '</span>'
      + '</div></div>';
    document.body.appendChild(d);
    setTimeout(function () { var tx = document.getElementById('inspApproveText'); if (tx) tx.focus(); }, 80);
  }
  function closeApproveDlg() {
    var d = document.getElementById('inspApproveDlg');
    if (d && d.parentNode) d.parentNode.removeChild(d);
  }

  /* 真正执行审批：同时驱动业务流程推进到下一环节，并把真实去向写回检验单 */
  function approve(id, decision) {
    var r = DB.inspections.filter(function (x) { return x._id === id; })[0];
    if (!r) return;
    var t = TYPES[r.type] || { passFlow: '' };
    var box = document.getElementById('inspApproveText');
    if (!box) { askApprove(id, decision); return; }
    var note = String(box.value || '').trim();
    var pass = (decision === 'pass');
    if (!pass && !note) { toast('驳回必须填写原因', false); return; }
    closeApproveDlg();
    r.approveNote = note;
    r.approvedAt = now();
    r.approver = (JSON.parse(localStorage.getItem('gls_current_user') || '{}').realname) || '管理员';
    /* 与业务流程打通：审批通过即推进流程并通知下一部门 */
    var lk = null;
    try { lk = (window.BIZFLOW && BIZFLOW.linkInspApprove) ? BIZFLOW.linkInspApprove(r, pass, note) : null; } catch (e) { lk = null; }
    if (lk && lk.ok) { r.flowId = lk.flowId; r.flowNo = lk.flowNo; }
    if (pass) {
      r.status = STATUS.FLOWED;
      if (lk && lk.ok) {
        r.flowTo = lk.dest;
        r.flowNote = '审批通过，已自动流转' + (r.flowNo ? '（流程 ' + r.flowNo + '）' : '') + (note ? '；审批意见：' + note : '');
      } else {
        r.flowTo = t.passFlow;
        r.flowNote = '审批通过，自动流转：' + t.passFlow + (lk && lk.reason ? '（' + lk.reason + '）' : '');
      }
      DB.flowLog.push({ at: now(), no: r.no, act: '流转审批通过 → ' + r.flowTo });
      toast((lk && lk.ok) ? ('已通过，流转至 ' + lk.dest) : ('已通过，自动流转到「' + t.passFlow + '」'));
    } else {
      r.status = STATUS.REJECTED;
      r.flowTo = '退回检验人重检';
      r.flowNote = '审批驳回：' + note;
      DB.flowLog.push({ at: now(), no: r.no, act: '流转审批驳回，退回检验人' });
      toast('已驳回，退回检验人');
    }
    saveDB();
    openApprove();
  }

  /* ===== 不合格品 MRB 评审（独立一套） ===== */
  function openMrb() {
    showPage('page-insp-mrb');
    var list = DB.inspections.filter(function (r) { return r.status === STATUS.MRB; });
    var h = '<h2 style="margin:0 0 16px">不合格品评审 MRB（' + list.length + '）</h2>';
    if (!list.length) h += '<div style="background:#fff;padding:30px;text-align:center;color:#999;border-radius:8px">暂无待评审不合格单</div>';
    else {
      h += '<p style="color:#888;font-size:13px">这是<b>不合格品单独评审流程</b>（MRB）：由品质/工程/采购/生产共同确定处理结论，确定后按结论流转。</p>';
      list.forEach(function (r) {
        var t = TYPES[r.type] || { name: r.type };
        h += '<div style="background:#fff;border-radius:10px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06)">'
          + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
          + '<b>' + esc(r.no) + '</b><span class="insp-tag insp-tag-f">不合格 · 待 MRB</span></div>'
          + '<div class="insp-flow">'
          + '类型：<b>' + esc(t.name) + '</b>　日期：' + esc(r.date) + '　检验人：' + esc(r.inspector || '—') + '<br>'
          + '物料：<b>' + esc(r.matName) + '</b>（' + esc(r.matCode) + '）　批次：' + esc(r.batch || '—') + '　数量：' + esc(r.qty || '—') + '<br>'
          + '供应商：' + esc(r.supplier || '—') + '<br>'
          + '标准要求：' + esc(r.standard || '—') + '<br>'
          + '实测记录：' + esc(r.measured || '—') + '</div>'
          + '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">'
          + '<label style="font-size:13px;align-self:center">评审结论：</label>'
          + '<select id="mrbOpt_' + r._id + '" style="padding:6px 10px;border:1px solid #dcdfe6;border-radius:6px">'
          + MRB_OPTIONS.map(function (o) { return '<option>' + o + '</option>'; }).join('')
          + '</select>'
          + '<input id="mrbNote_' + r._id + '" placeholder="评审说明（可空）" style="flex:1;padding:6px 10px;border:1px solid #dcdfe6;border-radius:6px;min-width:200px">'
          + '<button class="insp-btn insp-btn-r" onclick="INSP.mrbDecide(\'' + r._id + '\',\'reject\')">退回重检</button>'
          + '<button class="insp-btn insp-btn-o" onclick="INSP.mrbDecide(\'' + r._id + '\',\'decide\')">确认结论 · 流转</button>'
          + '</div></div>';
      });
    }
    $('inspMrbBody').innerHTML = h;
  }

  function mrbDecide(id, decision) {
    var r = DB.inspections.filter(function (x) { return x._id === id; })[0];
    if (!r) return;
    r.approvedAt = now();
    r.approver = (JSON.parse(localStorage.getItem('gls_current_user') || '{}').realname) || '管理员';
    if (decision === 'reject') {
      r.status = STATUS.REJECTED;
      r.flowTo = '退回检验人重检';
      r.flowNote = 'MRB 退回重检';
      try {
        if (window.BIZFLOW && BIZFLOW.linkInspApprove) {
          var l0 = BIZFLOW.linkInspApprove(r, false, 'MRB 退回重检');
          if (l0 && l0.ok) { r.flowId = l0.flowId; r.flowNo = l0.flowNo; r.flowNote = 'MRB 退回重检；流程 ' + l0.flowNo + ' 现在 ' + l0.dest; }
        }
      } catch (e) {}
      DB.flowLog.push({ at: now(), no: r.no, act: 'MRB 退回检验人重检' });
      toast('已退回重检');
    } else {
      var opt = ($('mrbOpt_' + id) && $('mrbOpt_' + id).value) || '';
      var note = ($('mrbNote_' + id) && $('mrbNote_' + id).value) || '';
      r.approveNote = note;
      r.status = STATUS.FLOWED;
      /* 与业务流程打通：结论决定真实去向，并推动主流程走下一环节 */
      var lk = null;
      try { lk = (window.BIZFLOW && BIZFLOW.linkMrbConclude) ? BIZFLOW.linkMrbConclude(r, opt, note) : null; } catch (e) { lk = null; }
      if (lk && lk.ok) {
        r.flowId = lk.flowId; r.flowNo = lk.flowNo;
        r.flowTo = lk.text;
        r.flowNote = 'MRB 评审结论：' + opt + ' → 去向 ' + lk.dest + '【' + lk.destDept + '】'
          + (lk.stationText ? '；流程进度 ' + lk.stationText : '')
          + (note ? '（' + note + '）' : '');
        DB.flowLog.push({ at: now(), no: r.no, act: 'MRB 结论 → ' + opt + '，去向 ' + lk.dest });
        toast('已按「' + opt + '」流转至 ' + lk.dest);
      } else {
        r.flowTo = opt;
        r.flowNote = 'MRB 评审结论：' + opt + (note ? '（' + note + '）' : '') + (lk && lk.reason ? '；' + lk.reason : '');
        DB.flowLog.push({ at: now(), no: r.no, act: 'MRB 结论 → ' + opt });
        toast('已按「' + opt + '」流转');
      }
    }
    saveDB();
    openMrb();
  }

  /* ===== 检验记录 ===== */
  function openList() {
    showPage('page-insp-list');
    var h = '<div class="insp-toolbar"><h2 style="margin:0">检验记录</h2>'
      + '<input id="inspFilterType" onchange="INSP.openList()" style="width:130px">'
      + '<input id="inspFilterStatus" onchange="INSP.openList()" style="width:130px">'
      + '<input id="inspFilterKw" placeholder="单号/物料/批次搜索…" onkeydown="if(event.key===\'Enter\')INSP.openList()" style="flex:1">'
      + '<button class="insp-btn insp-btn-g" onclick="INSP.openList()">筛选</button>'
      + '<button class="insp-btn insp-btn-g" onclick="INSP.exportRecords()">导出 Excel</button></div>';

    // 下拉选项（保留之前选的值）
    var ft = $('inspFilterType'), fs = $('inspFilterStatus');
    var curT = (ft && ft.value) || '', curS = (fs && fs.value) || '', curK = ($('inspFilterKw') && $('inspFilterKw').value || '').trim().toLowerCase();
    h += '<div id="inspListBox"></div>';
    $('inspListBody').innerHTML = h;

    var ft2 = $('inspFilterType'), fs2 = $('inspFilterStatus');
    ft2.innerHTML = '<option value="">全部类型</option>' + Object.keys(TYPES).map(function (k) {
      return '<option value="' + k + '"' + (curT === k ? ' selected' : '') + '>' + TYPES[k].name + '</option>';
    }).join('');
    fs2.innerHTML = '<option value="">全部状态</option>' + [STATUS.APPROVING, STATUS.MRB, STATUS.REJECTED, STATUS.FLOWED].map(function (s) {
      return '<option value="' + s + '"' + (curS === s ? ' selected' : '') + '>' + s + '</option>';
    }).join('');
    if (curK) $('inspFilterKw').value = curK;

    var list = DB.inspections.filter(function (r) {
      if (curT && r.type !== curT) return false;
      if (curS && r.status !== curS) return false;
      if (curK && [r.no, r.matName, r.matCode, r.batch].every(function (v) {
        return String(v || '').toLowerCase().indexOf(curK) < 0;
      })) return false;
      return true;
    }).slice().reverse();
    $('inspListBox').innerHTML = recordTable(list);
  }

  /* ===== 跨板块物料详情：ERP 档案 + PQS 标准 + 检验历史 ===== */
  function matDetail(code) {
    var d = null;
    if (window.DATAHUB) { try { d = DATAHUB.materialDetail(code); } catch (e) {} }
    var box = document.createElement('div');
    box.className = 'insp-mask';
    var h = '<div class="insp-modal"><h3 style="margin-top:0">物料全维度 · ' + esc(code) + '</h3>';
    if (!d || !d.found) {
      h += '<div class="insp-std" style="border-left-color:#e6a23c"><b>未在品质资料库 / ERP 物料档案中找到该物料</b>，可先到对应板块补录。</div>';
    } else {
      var m = d.erp || d.pqs || {};
      h += '<div class="insp-flow">'
        + '物料名称：<b>' + esc(m.name || code) + '</b>'
        + (m.spec ? '　规格型号：' + esc(m.spec) : '')
        + (m.unit ? '　单位：' + esc(m.unit) : '')
        + (m.category ? '　类别：' + esc(m.category) : '') + '<br>'
        + (m.supplier ? '默认供应商：' + esc(m.supplier) + '<br>' : '');
      if (d.pqs) {
        h += '<br><b>【品质资料库检验标准】</b><br>'
          + '分类：' + esc(d.pqs.cls || '—') + '　版本：' + esc(d.pqs.ver || '—') + '<br>'
          + '关键检验要求：' + esc(d.pqs.key || '—') + '<br>'
          + '检验手段：' + esc(d.pqs.tool || '—') + '<br>';
      }
      if (d.erp && !d.pqs) h += '<br><b>【ERP 物料档案】</b>（暂无检验标准，可在品质资料库补录）<br>'
        + '安全库存：' + esc(d.erp.safeStock || '—') + '　参考单价：' + esc(d.erp.price || '—') + '　备注：' + esc(d.erp.remark || '—') + '<br>';
      h += '<br><b>【检验历史】</b> 共 ' + d.stat.total + ' 单（合格 ' + d.stat.pass + ' / 不合格 ' + d.stat.fail + '）<br>';
      if (d.history.length) {
        h += '<table class="insp-table" style="margin-top:8px"><thead><tr><th>单号</th><th>类型</th><th>批次</th><th>结果</th><th>状态</th><th>日期</th></tr></thead><tbody>';
        d.history.forEach(function (r) {
          var t2 = TYPES[r.type] || { name: r.type };
          h += '<tr><td>' + esc(r.no) + '</td><td>' + esc(t2.name) + '</td><td>' + esc(r.batch || '—') + '</td>'
            + '<td><span class="insp-tag ' + (r.result === 'pass' ? 'insp-tag-p' : 'insp-tag-f') + '">' + (r.result === 'pass' ? '合格' : '不合格') + '</span></td>'
            + '<td>' + esc(r.status) + '</td><td>' + esc(r.date) + '</td></tr>';
        });
        h += '</tbody></table>';
      } else {
        h += '<span style="color:#999">暂无检验记录</span>';
      }
    }
    h += '<div style="text-align:right;margin-top:16px"><button class="insp-btn insp-btn-g" onclick="this.closest(\'.insp-mask\').remove()">关闭</button></div></div>';
    box.innerHTML = h;
    document.body.appendChild(box);
    box.onclick = function (e) { if (e.target === box) box.remove(); };
  }

  /* ===== 按「当前字段配置」列出单据的全部已填项目 =====
     以后在「⚙ 配置项目」里增删任何字段，详情页 / 审批页 / 导出都会自动跟着变，不用改代码。 */
  var DIGEST_SKIP = {
    type: 1, matCode: 1, matName: 1, date: 1, result: 1, status: 1,
    inspector: 1, approver: 1, approveNote: 1, approvedAt: 1,
    flowTo: 1, flowNote: 1, standard: 1, measured: 1, no: 1, _id: 1, createdAt: 1
  };
  function digestHtml(r) {
    if (!r) return '';
    var rows = [], seen = {};
    var list = [];
    try { if (window.FIELDS) list = FIELDS.get('inspect'); } catch (e) { list = []; }
    var push = function (label, val) {
      if (val == null) return;
      val = String(val);
      if (!val.trim()) return;
      rows.push([label, val]);
    };
    list.forEach(function (f) {
      if (!f || f.enabled === false || f.type === 'html') return;
      if (seen[f.key]) return;
      seen[f.key] = 1;
      if (DIGEST_SKIP[f.key]) return;
      var v = r[f.key];
      if ((v == null || v === '') && r.extra) v = r.extra[f.key];
      push(f.label || f.key, v);
    });
    /* 配置里已删掉、但单据里仍有值的项目也一并列出（不丢数据） */
    Object.keys(r.extra || {}).forEach(function (k) {
      if (seen[k] || DIGEST_SKIP[k]) return;
      push(k, r.extra[k]);
    });
    if (!rows.length) return '';
    var h = '<table class="insp-digest">';
    rows.forEach(function (x) {
      h += '<tr><th>' + esc(x[0]) + '</th><td>' + esc(x[1]).replace(/\n/g, '<br>') + '</td></tr>';
    });
    return h + '</table>';
  }

  function viewDetail(id) {
    var r = DB.inspections.filter(function (x) { return x._id === id; })[0];
    if (!r) return;
    var t = TYPES[r.type] || { name: r.type };
    var box = document.createElement('div');
    box.className = 'insp-mask';
    box.innerHTML = '<div class="insp-modal"><h3 style="margin-top:0">' + esc(r.no) + '</h3>'
      + '<div class="insp-flow">'
      + '类型：<b>' + esc(t.name) + '</b>　日期：' + esc(r.date) + '<br>'
      + '物料：<b>' + esc(r.matName) + '</b>（' + esc(r.matCode) + '）<br>'
      + '供应商：' + esc(r.supplier || '—') + '　批次：' + esc(r.batch || '—') + '　数量：' + esc(r.qty || '—') + '<br>'
      + '标准要求：' + esc(r.standard || '—') + '<br>'
      + '实测记录：' + esc(r.measured || '—') + '<br>'
      + '判定：<b>' + (r.result === 'pass' ? '合格' : '不合格') + '</b>　状态：' + esc(r.status) + '<br>'
      + '检验人：' + esc(r.inspector || '—') + '<br>'
      + '审批人：' + esc(r.approver || '—') + '　审批时间：' + esc(r.approvedAt || '—') + '<br>'
      + '审批意见：' + esc(r.approveNote || '—') + '<br>'
      + '<hr style="border:none;border-top:1px solid #eee;margin:12px 0">'
      + '流转去向：<b>' + esc(r.flowTo || '—') + '</b>'
      + (r.flowNo ? '　<span style="color:#6b7280;font-size:12.5px">关联流程单 ' + esc(r.flowNo) + '</span>' : '') + '<br>'
      + '流转说明：' + esc(r.flowNote || '—') + '</div>'
      + (digestHtml(r)
        ? '<div class="insp-digestwrap"><b style="color:#2c5e36;font-size:13px">本单全部项目</b>' + digestHtml(r) + '</div>'
        : '')
      + '<div style="text-align:right;margin-top:16px"><button class="insp-btn insp-btn-g" onclick="this.closest(\'.insp-mask\').remove()">关闭</button></div></div>';
    document.body.appendChild(box);
    box.onclick = function (e) { if (e.target === box) box.remove(); };
  }

  /* ===== Excel 导入 / 导出 ===== */
  function openImport() {
    var box = document.createElement('div');
    box.className = 'insp-mask';
    box.innerHTML = '<div class="insp-modal"><h3 style="margin-top:0">📥 表格导入检验单</h3>'
      + '<p style="font-size:13px;color:#666;line-height:1.8">请上传 <b>.xlsx</b> 文件，第一行是表头，列名需包含：</p>'
      + '<p style="background:#f8f9fa;padding:10px;border-radius:6px;font-size:13px">'
      + '<b>类型</b>（IQC/来料/首件/巡检/OQC/成品）、<b>物料编码</b>、物料名称、供应商、批次、数量、实测记录、检验人、结果（合格/不合格）、日期</p>'
      + '<p style="font-size:13px;color:#888">结果留空默认走「待审批」；日期留空默认今天。</p>'
      + '<input type="file" id="inspImportFile" accept=".xlsx,.xls" style="margin:14px 0">'
      + '<div style="text-align:right"><button class="insp-btn insp-btn-g" onclick="this.closest(\'.insp-mask\').remove()">取消</button> '
      + '<button class="insp-btn insp-btn-p" onclick="INSP.doImport()">开始导入</button></div></div>';
    document.body.appendChild(box);
    box.onclick = function (e) { if (e.target === box) box.remove(); };
  }

  function doImport() {
    var f = $('inspImportFile').files && $('inspImportFile').files[0];
    if (!f) { toast('请先选择文件', false); return; }
    if (typeof XLSX === 'undefined') { toast('Excel 解析库未加载，请检查网络', false); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (!rows.length) { toast('文件为空', false); return; }
        var added = 0, skipped = 0;
        rows.forEach(function (row) {
          var typeRaw = String(row['类型'] || row['检验类型'] || row['检验类别'] || row['type'] || '').trim();
          var type = mapType(typeRaw);
          var code = String(row['物料编码'] || row['物料编号'] || row['物料号'] || row['编码'] || row['code'] || '').trim();
          if (!type || !code) { skipped++; return; }
          var m = findMaterial(code) || {};
          var resultRaw = String(row['判定结果'] || row['结果'] || row['判定'] || '').trim();
          var result = /合格|pass|^1$|通过/i.test(resultRaw) && !/不合格|NG/i.test(resultRaw) ? 'pass' : 'fail';
          var rec = {
            _id: uid(), no: nextNo(type), type: type,
            matCode: code, matName: row['物料名称'] || row['名称'] || m.name || code,
            standard: m.key || '',
            result: result,
            status: '', approver: '', approveNote: '', approvedAt: '',
            flowTo: '', flowNote: '', flowId: '', flowNo: '', createdAt: now()
          };
          /* 其余项目（日期 / 供应商 / 批次 / 数量 / 抽样 / AQL / 实测 …）全部按字段配置认领 */
          applyRowByConfig(rec, row, m);
          if (!rec.date) rec.date = today();
          var t = TYPES[type];
          if (result === 'pass') {
            rec.status = STATUS.APPROVING; rec.flowNote = '导入：合格，待流转审批';
          } else {
            rec.status = STATUS.MRB; rec.flowNote = '导入：不合格，待 MRB 评审';
          }
          DB.inspections.push(rec); added++;
        });
        saveDB();
        toast('成功导入 ' + added + ' 单' + (skipped ? '，跳过 ' + skipped + ' 行（类型/编码缺失）' : ''));
        document.querySelectorAll('.insp-mask').forEach(function (x) { x.remove(); });
        openHome();
      } catch (err) {
        toast('导入失败：' + err.message, false);
      }
    };
    reader.readAsArrayBuffer(f);
  }
  /* 表格导入时，列名 -> 字段 key 的常用别名（列名直接用字段标签也可以） */
  var IMPORT_ALIAS = {
    qty: ['送检数量', '数量'],
    recvQty: ['来料数量', '到货数量', '送检批量', '批量'],
    sampleQty: ['抽检数量', '抽样数', '抽检数', '样本量'],
    sampleBasis: ['抽检依据', '检验依据', '抽样依据'],
    inspLevel: ['检验水平', '抽样水平'],
    samplePlan: ['抽样方案'],
    strictLevel: ['检验严格度', '严格度'],
    aql: ['AQL 值', 'AQL', 'AQL值'],
    acRe: ['判定标准 Ac/Re', '判定标准', 'Ac/Re', 'AcRe'],
    badQty: ['不合格品数', '不良数', '不良数量'],
    badRate: ['不合格率', '不良率', '不合格率(%)'],
    defectLevel: ['缺陷等级'],
    tool: ['测量器具', '量具', '检测设备'],
    stdVer: ['标准 / 图纸版本', '标准版本', '图纸版本'],
    measured: ['实测记录', '实测'],
    defectDesc: ['不良现象描述', '不良描述', '缺陷描述'],
    handle: ['处理方式', '处置方式'],
    inspector: ['检验人', '检验员'],
    date: ['检验日期', '日期'],
    supplier: ['供应商'],
    batch: ['批次号', '批次', '批号'],
    wo: ['生产工单号', '工单号']
  };
  function pickCol(row, f) {
    var names = [f.label, f.key].concat(IMPORT_ALIAS[f.key] || []);
    for (var i = 0; i < names.length; i++) {
      var n = String(names[i] == null ? '' : names[i]).trim();
      if (!n) continue;
      if (row[n] != null && String(row[n]).trim() !== '') return String(row[n]).trim();
    }
    return '';
  }
  /* 按当前字段配置把 Excel 每一列的值填进单据：配置里加字段，导入这里自动生效 */
  function applyRowByConfig(rec, row, m) {
    var list = [];
    try { if (window.FIELDS) list = FIELDS.get('inspect'); } catch (e) { list = []; }
    var skip = { type: 1, matCode: 1, matName: 1, result: 1 };
    list.forEach(function (f) {
      if (!f || f.enabled === false || f.type === 'html') return;
      if (skip[f.key]) return;
      var v = pickCol(row, f);
      if (!v) return;
      if (rec[f.key] == null || rec[f.key] === '') rec[f.key] = v;
    });
    if (!rec.standard && m && m.key) rec.standard = m.key;
  }

  function mapType(s) {
    s = (s || '').toLowerCase();
    if (/iqc|来料|进料|进货/.test(s)) return 'IQC';
    if (/首件|first/.test(s)) return 'FIRST';
    if (/巡检|patrol|process/.test(s)) return 'PATROL';
    if (/oqc|成品|出货|最终/.test(s)) return 'OQC';
    return '';
  }

  function exportRecords() {
    if (!DB.inspections.length) { toast('暂无记录可导出', false); return; }
    /* 列 = 单号/类型 + 当前字段配置里的全部项目 + 流转信息；以后加字段导出自动带上 */
    var cols = [['no', '单号'], ['__typeName', '类型']];
    var list = [];
    try { if (window.FIELDS) list = FIELDS.get('inspect'); } catch (e) { list = []; }
    var seenCol = {};
    list.forEach(function (f) {
      if (!f || f.enabled === false || f.type === 'html') return;
      if (seenCol[f.key]) return;
      seenCol[f.key] = 1;
      cols.push([f.key, f.label || f.key]);
    });
    [['standard', '标准要求'], ['status', '状态'], ['approver', '审批人'],
     ['approveNote', '审批意见'], ['flowTo', '流转去向'], ['flowNote', '流转说明']].forEach(function (c) {
      cols.push(c);
    });
    var thead = '<tr>' + cols.map(function (c) { return '<th>' + esc(c[1]) + '</th>'; }).join('') + '</tr>';
    var tbody = DB.inspections.map(function (r) {
      var t = TYPES[r.type] || { name: r.type };
      return '<tr>' + cols.map(function (c) {
        var k = c[0];
        if (k === 'no') return '<td>' + esc(r.no) + '</td>';
        if (k === '__typeName') return '<td>' + esc(t.name) + '</td>';
        var v = r[k];
        if ((v == null || v === '') && r.extra) v = r.extra[k];
        if (k === 'result') v = (v === 'pass' ? '合格' : (v === 'fail' ? '不合格' : v));
        return '<td>' + esc(v == null ? '' : v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var html = '<table><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table>';
    if (typeof window.exportHtmlTableToXlsx === 'function') {
      var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
      window.exportHtmlTableToXlsx(html, '格丽思检验记录-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.xlsx', '检验记录');
      toast('已导出 Excel');
    } else {
      toast('导出组件未加载', false);
    }
  }

  /* ===== 侧边栏注入 ===== */
  function injectSidebar() {
    var nav = $('sidebarNav');
    if (!nav || nav.querySelector('[data-insp-entry]')) return;
    var html = '<div class="nav-item" data-insp-entry="1" onclick="INSP.openHome()">'
      + '<span class="nav-icon">🔍</span><span class="nav-text">检验工作台</span></div>';
    var first = nav.querySelector('.nav-section, .nav-item');
    if (first) first.insertAdjacentHTML('beforebegin', html);
    else nav.insertAdjacentHTML('afterbegin', html);
  }

  function init() {
    injectCSS();
    loadDB();
    injectSidebar();
    setInterval(function () { injectSidebar(); }, 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.INSP = {
    openHome: openHome,
    openForm: openForm, openApprove: openApprove, openMrb: openMrb, openList: openList,
    scanMaterial: scanMaterial, saveForm: saveForm, approve: approve, mrbDecide: mrbDecide,
    retype: retype, _rules: function (t) { return rulesOf(t); },
    askApprove: askApprove, closeApproveDlg: closeApproveDlg,
    viewDetail: viewDetail, matDetail: matDetail, openImport: openImport, doImport: doImport, exportRecords: exportRecords,
    _db: function () { return DB; },
    _t: function (t) { return TYPES[t] || null; }
  };
})();
