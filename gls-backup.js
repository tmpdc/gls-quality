/* gls-backup.js — 全系统数据一键备份 / 恢复（覆盖 / 合并）
 * 备份范围：localStorage 中全部业务数据键（gls_quality_data_v2 中央键 + 未来新增数据键）
 * UI 入口：侧边栏「数据备份」（包装 renderSidebar 注入）
 */
window.glsBackup = (function () {
  'use strict';
  var IGNORE_KEYS = ['gls_current_user', 'gls_sidebar_open', 'gls_ui_state'];

  function nowStr() {
    var d = new Date(), p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /* 收集数据键：gls_ 开头且不在忽略列表 */
  function dataKeys() {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('gls_') === 0 && IGNORE_KEYS.indexOf(k) < 0) out.push(k);
    }
    return out;
  }

  function snapshot() {
    var keys = dataKeys(), obj = {};
    keys.forEach(function (k) { try { obj[k] = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { obj[k] = localStorage.getItem(k); } });
    return { app: 'gls-quality', version: 1, exportedAt: nowStr(), keys: obj };
  }

  /* ===== 概况统计 ===== */
  function stats() {
    var s = [];
    function len(sec, path) {
      try {
        var d = window.DATAHUB ? DATAHUB.get(sec) : null;
        if (!d) return 0;
        path.forEach(function (p) { d = d[p]; if (!d) return 0; });
        return Array.isArray(d) ? d.length : 0;
      } catch (e) { return 0; }
    }
    var e = { 物料: len('erp', ['material']), 客户: len('erp', ['customer']), 供应商: len('erp', ['supplier']),
      仓库: len('erp', ['warehouse']), BOM: len('erp', ['bom']), 检测设备: len('erp', ['equip']), 销售订单: len('erp', ['so']),
      销售发货: len('erp', ['soShip']), 销售退货: len('erp', ['soReturn']), 采购申请: len('erp', ['pr']),
      采购订单: len('erp', ['po']), 采购收货: len('erp', ['poRecv']), 生产工单: len('erp', ['mo']),
      生产领料: len('erp', ['moPick']), 完工入库: len('erp', ['moIn']), 入库单: len('erp', ['stockIn']),
      出库单: len('erp', ['stockOut']), 售后分析: len('erp', ['afterSale']), 售后翻新: len('erp', ['renovate']) };
    var insp = len('inspect', ['inspections']), flw = len('bizflow', ['flows']),
      usr = len('accounts', ['users']), pqs = len('pqs', ['materials']);
    s.push({ n: '业务数据总览', d: e }, { n: '检验记录', d: { '检验单': insp } },
      { n: '业务流程', d: { '流程实例': flw } }, { n: '账号与资料', d: { '系统账号': usr, '物料标准': pqs } });
    return s;
  }

  /* ===== 下载备份 ===== */
  function download() {
    try {
      var snap = snapshot();
      var blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '格丽思数据备份-' + nowStr() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      showToast('备份已生成，请保存好文件', 'success');
    } catch (e) { showToast('备份失败：' + e.message, 'error'); }
  }

  /* ===== 恢复 ===== */
  function chooseFile() {
    var input = document.getElementById('glsBackupFile');
    if (input) input.click();
  }

  function onFile(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var text = rd.result;
      var obj;
      try { obj = JSON.parse(text); } catch (e) { showToast('文件不是有效的备份 JSON', 'error'); return; }
      if (!obj || !obj.keys || typeof obj.keys !== 'object') { showToast('备份文件缺少数据内容，无法恢复', 'error'); return; }
      var mode = document.getElementById('glsBackupMode') ? document.getElementById('glsBackupMode').value : 'overwrite';
      var n = Object.keys(obj.keys).length;
      var msg = mode === 'overwrite'
        ? '将用备份【覆盖】当前全部数据（' + n + ' 个数据区）。继续？'
        : '将把备份【合并】进当前数据（' + n + ' 个数据区，按编号/ID 去重）。继续？';
      if (!confirm(msg)) { ev.target.value = ''; return; }
      var ok = 0;
      if (mode === 'overwrite') {
        dataKeys().forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      }
      Object.keys(obj.keys).forEach(function (k) {
        var v = obj.keys[k];
        try {
          if (mode === 'merge') v = mergeValue(localStorage.getItem(k), v);
          localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
          ok++;
        } catch (e) { showToast('恢复失败：' + k + ' ' + e.message, 'error'); }
      });
      ev.target.value = '';
      if (ok > 0) { showToast('已恢复 ' + ok + ' 个数据区，正在刷新…', 'success'); setTimeout(function () { location.reload(); }, 900); }
    };
    rd.readAsText(file);
  }

  /* 合并：对象含数组字段按 id/code 去重；纯数组按 id 去重；标量以备份为准 */
  function mergeValue(curRaw, bakVal) {
    if (curRaw === null || curRaw === undefined) return bakVal;
    var cur;
    try { cur = JSON.parse(curRaw); } catch (e) { return bakVal; }
    if (bakVal === null || bakVal === undefined || typeof bakVal !== 'object') return bakVal;
    if (Array.isArray(bakVal)) return mergeArray(Array.isArray(cur) ? cur : [], bakVal);
    if (typeof cur === 'object' && cur !== null) {
      var out = {};
      Object.keys(cur).forEach(function (k) { out[k] = cur[k]; });
      Object.keys(bakVal).forEach(function (k) {
        if (Array.isArray(bakVal[k])) out[k] = mergeArray(Array.isArray(cur[k]) ? cur[k] : [], bakVal[k]);
        else if (bakVal[k] && typeof bakVal[k] === 'object') out[k] = mergeValue(JSON.stringify(cur[k] === undefined ? null : cur[k]), bakVal[k]);
        else if (cur[k] === undefined || cur[k] === null) out[k] = bakVal[k];
      });
      return out;
    }
    return bakVal;
  }

  function mergeArray(cur, bak) {
    var out = cur.slice();
    bak.forEach(function (b) {
      var dup = out.some(function (c) { return sameKey(c, b); });
      if (!dup) out.push(b);
    });
    return out;
  }
  function sameKey(a, b) {
    if (!a || !b) return false;
    if (a.id && b.id) return String(a.id) === String(b.id);
    if (a.code && b.code) return String(a.code) === String(b.code);
    if (a.no && b.no) return String(a.no) === String(b.no);
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /* ===== 页面渲染 ===== */
  function render() {
    var box = document.getElementById('backupHome');
    if (!box) return;
    var s = stats();
    var h = '<div class="bkp-head"><h2 style="margin:0">数据备份与恢复</h2>'
      + '<div class="bkp-sub">一键导出全部业务数据（物料/订单/采购/库存/检验/流程/账号/资料），换设备或清理浏览器后可一键恢复</div></div>';
    /* 概况 */
    s.forEach(function (g) {
      h += '<div class="bkp-card"><div class="bkp-card-t">' + g.n + '</div><div class="bkp-grid">';
      Object.keys(g.d).forEach(function (k) {
        h += '<div class="bkp-stat"><div class="bkp-num">' + g.d[k] + '</div><div class="bkp-lbl">' + k + '</div></div>';
      });
      h += '</div></div>';
    });
    /* 操作 */
    h += '<div class="bkp-card">'
      + '<div class="bkp-card-t">备份操作</div>'
      + '<div class="bkp-actions">'
      + '<button class="bkp-btn bkp-btn-dl" onclick="glsBackup.download()">下载数据备份</button>'
      + '<div class="bkp-actions-r">'
      + '<select id="glsBackupMode" class="bkp-sel"><option value="overwrite">恢复模式：覆盖当前全部数据</option><option value="merge">恢复模式：合并（去重补充）</option></select>'
      + '<button class="bkp-btn bkp-btn-up" onclick="glsBackup.chooseFile()">选择备份文件恢复</button>'
      + '<input type="file" id="glsBackupFile" accept=".json,application/json" style="display:none" onchange="glsBackup.onFile(event)">'
      + '</div></div>'
      + '<div class="bkp-tip">提示：覆盖恢复会以备份文件为准替换当前数据；合并恢复会把备份中的新数据补充进来（按编号/ID 去重）。恢复完成后页面自动刷新。</div>'
      + '</div>';
    box.innerHTML = h;
  }

  function open() {
    var el = document.getElementById('page-backup');
    if (el) {
      document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
      el.classList.add('active');
    }
    render();
  }

  /* ===== 侧边栏注入 ===== */
  function injectSidebar() {
    var _base = window.renderSidebar;
    window.renderSidebar = function () {
      if (typeof _base === 'function') _base();
      var nav = document.getElementById('sidebarNav');
      if (!nav) return;
      var extra = '<div class="nav-item" onclick="glsBackup.open()"><span class="nav-icon">💾</span><span class="nav-text">数据备份</span></div>';
      var tpl = document.createElement('div');
      tpl.innerHTML = extra;
      nav.appendChild(tpl.firstChild);
    };
  }
  try { injectSidebar(); } catch (e) {}

  return { open: open, render: render, download: download, chooseFile: chooseFile, onFile: onFile, stats: stats };
})();
