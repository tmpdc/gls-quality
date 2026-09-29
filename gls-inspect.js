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
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && Array.isArray(p.inspections)) { DB = p; return; }
      }
    } catch (e) {}
    DB = { inspections: [], flowLog: [] };
  }
  function saveDB() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); }
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
    var mats = (window.PQS_DATA && window.PQS_DATA.materials) || [];
    code = String(code || '').trim().toLowerCase();
    for (var i = 0; i < mats.length; i++) {
      if (String(mats[i].code || '').toLowerCase() === code) return mats[i];
    }
    // 模糊匹配名称
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
      '.insp-flow b{color:#2c5e36;}'
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
    Object.keys(TYPES).forEach(function (k) {
      var t = TYPES[k];
      var cnt = DB.inspections.filter(function (r) { return r.type === k; }).length;
      h += '<div class="insp-card" onclick="INSP.openForm(\'' + k + '\')">'
        + '<div class="t">' + t.name + '</div>'
        + '<div class="d">合格放行 → ' + t.passFlow + '<br>不合格 → 进入 MRB 评审<br><b>本类已建单：' + cnt + '</b></div></div>';
    });
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
        + '<td><b>' + esc(r.matName) + '</b><br><span style="color:#999;font-size:12px">' + esc(r.matCode) + '</span></td>'
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
  function openForm(type) {
    showPage('page-insp-form');
    var h = '<h2 style="margin:0 0 16px">新建检验单</h2><div class="insp-form">';
    h += '<div class="insp-row"><label>检验类型 *</label><select id="fType">';
    Object.keys(TYPES).forEach(function (k) {
      h += '<option value="' + k + '"' + (type === k ? ' selected' : '') + '>' + TYPES[k].name + '</option>';
    });
    h += '</select></div>';

    h += '<div class="insp-row"><label>扫码 / 物料编码 *</label><div class="insp-scan">'
      + '<input id="fMatCode" placeholder="扫码枪扫物料条码，或输入编码/名称后回车" onkeydown="if(event.key===\'Enter\')INSP.scanMaterial()">'
      + '<button class="insp-btn insp-btn-g" onclick="INSP.scanMaterial()">带出标准</button></div></div>';

    h += '<div id="fStdBox"></div>';

    h += '<div class="insp-row"><label>物料名称</label><input id="fMatName" readonly></div>';
    h += '<div class="insp-row"><label>供应商</label><input id="fSupplier" placeholder="来料检验必填"></div>';
    h += '<div class="insp-row"><label>批次号</label><input id="fBatch" placeholder="如 LOT-20260929-001"></div>';
    h += '<div class="insp-row"><label>数量</label><input id="fQty" type="number" placeholder="送检数量"></div>';
    h += '<div class="insp-row"><label>实测记录</label><textarea id="fMeasured" placeholder="逐项记录实测值 / 目视结果，可多行"></textarea></div>';
    h += '<div class="insp-row"><label>检验人</label><input id="fInspector" placeholder="检验人姓名"></div>';
    h += '<div class="insp-row"><label>检验日期</label><input id="fDate" type="date" value="' + today() + '"></div>';

    h += '<div class="insp-row"><label>判定结果 *</label><div class="insp-result">'
      + '<label><input type="radio" name="fResult" value="pass"><span>✓ 合格</span></label>'
      + '<label><input type="radio" name="fResult" value="fail"><span>✗ 不合格</span></label></div></div>';

    h += '<div style="text-align:right;margin-top:18px">'
      + '<button class="insp-btn insp-btn-g" onclick="INSP.openHome()">取消</button> '
      + '<button class="insp-btn insp-btn-p" onclick="INSP.saveForm()">提交并自动流转</button></div>';
    h += '</div>';
    $('inspFormBody').innerHTML = h;
  }

  function scanMaterial() {
    var code = $('fMatCode').value.trim();
    if (!code) { toast('请先扫码或输入物料编码', false); return; }
    var m = findMaterial(code);
    if (!m) {
      $('fStdBox').innerHTML = '<div class="insp-std" style="border-left-color:#e6a23c"><b>未找到物料「' + esc(code) + '」</b>，可手动填写。建议先到「品质资料库 → 物料检验标准」补录该物料。</div>';
      $('fMatName').value = '';
      return;
    }
    $('fMatName').value = m.name || '';
    $('fStdBox').innerHTML = '<div class="insp-std"><b>已带出检验标准：</b><br>'
      + '分类：' + esc(m.cls || '—') + '　版本：' + esc(m.ver || '—') + '<br>'
      + '<b>关键检验要求：</b>' + esc(m.key || '—') + '<br>'
      + '<b>检验手段：</b>' + esc(m.tool || '—') + '</div>';
    toast('已带出：' + m.name);
  }

  function saveForm() {
    var type = $('fType').value;
    var code = $('fMatCode').value.trim();
    if (!code) { toast('请扫码或输入物料编码', false); return; }
    var resultEl = document.querySelector('input[name=fResult]:checked');
    if (!resultEl) { toast('请判定合格/不合格', false); return; }
    var result = resultEl.value;
    var t = TYPES[type];
    if (t.needSupplier && !$('fSupplier').value.trim()) {
      if (!confirm('来料检验建议填供应商，仍要提交吗？')) return;
    }

    var m = findMaterial(code) || {};
    var rec = {
      _id: uid(), no: nextNo(type), type: type,
      date: $('fDate').value || today(),
      matCode: code, matName: $('fMatName').value || m.name || code,
      supplier: $('fSupplier').value.trim(),
      batch: $('fBatch').value.trim(),
      qty: $('fQty').value.trim(),
      standard: m.key || '',
      measured: $('fMeasured').value.trim(),
      result: result,
      inspector: $('fInspector').value.trim(),
      status: '', approver: '', approveNote: '', approvedAt: '',
      flowTo: '', flowNote: '', createdAt: now()
    };

    if (result === 'pass') {
      rec.status = STATUS.APPROVING;
      rec.flowTo = '';
      rec.flowNote = '检验合格，待部门上级审批放行到：' + t.passFlow;
      DB.flowLog.push({ at: now(), no: rec.no, act: '合格单进入流转审批队列' });
      toast('已提交：合格，待部门上级审批放行');
    } else {
      rec.status = STATUS.MRB;
      rec.flowTo = '';
      rec.flowNote = '检验不合格，进入 MRB 评审';
      DB.flowLog.push({ at: now(), no: rec.no, act: '不合格单进入 MRB 评审' });
      toast('已提交：不合格，进入 MRB 评审');
    }
    DB.inspections.push(rec);
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
          + '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">'
          + '<button class="insp-btn insp-btn-r" onclick="INSP.approve(\'' + r._id + '\',\'reject\')">驳回到检验人</button>'
          + '<button class="insp-btn insp-btn-p" onclick="INSP.approve(\'' + r._id + '\',\'pass\')">审批通过 · 自动流转</button>'
          + '</div></div>';
      });
    }
    $('inspApproveBody').innerHTML = h;
  }

  function approve(id, decision) {
    var r = DB.inspections.filter(function (x) { return x._id === id; })[0];
    if (!r) return;
    var t = TYPES[r.type] || { passFlow: '' };
    var note = prompt(decision === 'pass'
      ? '请填写审批意见（将随单据流转到下一部门）：'
      : '请填写驳回原因（退回检验人）：');
    if (note === null) return;
    r.approveNote = note;
    r.approvedAt = now();
    r.approver = (JSON.parse(localStorage.getItem('gls_current_user') || '{}').realname) || '管理员';
    if (decision === 'pass') {
      r.status = STATUS.FLOWED;
      r.flowTo = t.passFlow;
      r.flowNote = '审批通过，自动流转：' + t.passFlow;
      DB.flowLog.push({ at: now(), no: r.no, act: '流转审批通过 → ' + t.passFlow });
      toast('已通过，自动流转到「' + t.passFlow + '」');
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
      DB.flowLog.push({ at: now(), no: r.no, act: 'MRB 退回检验人重检' });
      toast('已退回重检');
    } else {
      var opt = ($('mrbOpt_' + id) && $('mrbOpt_' + id).value) || '';
      var note = ($('mrbNote_' + id) && $('mrbNote_' + id).value) || '';
      r.approveNote = note;
      r.status = STATUS.FLOWED;
      r.flowTo = opt;
      r.flowNote = 'MRB 评审结论：' + opt + (note ? '（' + note + '）' : '');
      DB.flowLog.push({ at: now(), no: r.no, act: 'MRB 结论 → ' + opt });
      toast('已按「' + opt + '」流转');
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
      + '流转去向：<b>' + esc(r.flowTo || '—') + '</b><br>'
      + '流转说明：' + esc(r.flowNote || '—') + '</div>'
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
          var typeRaw = String(row['类型'] || row['type'] || '').trim();
          var type = mapType(typeRaw);
          var code = String(row['物料编码'] || row['编码'] || row['code'] || '').trim();
          if (!type || !code) { skipped++; return; }
          var m = findMaterial(code) || {};
          var resultRaw = String(row['结果'] || row['判定'] || '').trim();
          var result = /合格|pass|^1$|通过/i.test(resultRaw) && !/不合格|NG/i.test(resultRaw) ? 'pass' : 'fail';
          var rec = {
            _id: uid(), no: nextNo(type), type: type,
            date: row['日期'] || today(),
            matCode: code, matName: row['物料名称'] || row['名称'] || m.name || code,
            supplier: row['供应商'] || '', batch: row['批次'] || '', qty: row['数量'] || '',
            standard: m.key || '', measured: row['实测记录'] || row['实测'] || '',
            result: result, inspector: row['检验人'] || '',
            status: '', approver: '', approveNote: '', approvedAt: '',
            flowTo: '', flowNote: '', createdAt: now()
          };
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
    var cols = ['单号', '类型', '日期', '物料编码', '物料名称', '供应商', '批次', '数量', '标准要求', '实测记录', '判定', '状态', '检验人', '审批人', '审批意见', '流转去向', '流转说明'];
    var thead = '<tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>';
    var tbody = DB.inspections.map(function (r) {
      var t = TYPES[r.type] || { name: r.type };
      return '<tr><td>' + esc(r.no) + '</td><td>' + esc(t.name) + '</td><td>' + esc(r.date) + '</td>'
        + '<td>' + esc(r.matCode) + '</td><td>' + esc(r.matName) + '</td><td>' + esc(r.supplier) + '</td>'
        + '<td>' + esc(r.batch) + '</td><td>' + esc(r.qty) + '</td><td>' + esc(r.standard) + '</td>'
        + '<td>' + esc(r.measured) + '</td><td>' + (r.result === 'pass' ? '合格' : '不合格') + '</td>'
        + '<td>' + esc(r.status) + '</td><td>' + esc(r.inspector) + '</td><td>' + esc(r.approver) + '</td>'
        + '<td>' + esc(r.approveNote) + '</td><td>' + esc(r.flowTo) + '</td><td>' + esc(r.flowNote) + '</td></tr>';
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
    viewDetail: viewDetail, openImport: openImport, doImport: doImport, exportRecords: exportRecords,
    _db: function () { return DB; }
  };
})();
