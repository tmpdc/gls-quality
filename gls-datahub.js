/* gls-datahub.js — 统一数据中心：所有板块数据打通，共用一个存储键
 * 中央键: gls_quality_data_v2（与 page.html 主数据同一键）
 * 分区: appData.pqs（品质资料库）/ appData.inspect（检验工作台）/ appData.accounts（账号）/ appData.erp（ERP）
 * 职责: 1) 旧键数据迁移并入中央，删除独立键  2) 板块读写统一走中央  3) 跨板块物料统一查询
 * 依赖: page.html 全局 appData / saveData（同文档加载时可用）；account-admin 独立页面无 appData 时直接读写中央键
 */
(function () {
  'use strict';
  var CENTRAL_KEY = 'gls_quality_data_v2';
  /* 旧独立键 → 中央分区映射 */
  var LEGACY = {
    pqs:      'gls_pqs_db_v1',
    inspect:  'gls_inspect_db_v1',
    accounts: 'gls_accounts'
  };

  function readCentral() {
    try {
      var raw = localStorage.getItem(CENTRAL_KEY);
      if (!raw) return {};
      var o = JSON.parse(raw);
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }
  function writeCentral(obj) {
    try { localStorage.setItem(CENTRAL_KEY, JSON.stringify(obj)); }
    catch (e) { console.warn('DATAHUB 写中央键失败', e.message); }
  }

  /* 防抖保存：page.html 场景交给全局 saveData，独立页面直接写中央键 */
  var _tm = null;
  function scheduleSave() {
    clearTimeout(_tm);
    _tm = setTimeout(function () {
      if (typeof saveData === 'function') { try { saveData(); } catch (e) {} }
      var obj = readCentral();
      if (typeof appData !== 'undefined' && appData) obj = appData;
      writeCentral(obj);
    }, 300);
  }

  function get(section, fallback) {
    var v;
    if (typeof appData !== 'undefined' && appData && appData[section] !== undefined) v = appData[section];
    if (v === undefined) v = readCentral()[section];
    if (v === undefined && LEGACY[section]) {
      try { v = JSON.parse(localStorage.getItem(LEGACY[section]) || 'null'); } catch (e) {}
    }
    return v !== undefined ? v : (fallback !== undefined ? fallback : null);
  }
  function set(section, val) {
    if (typeof appData !== 'undefined' && appData) appData[section] = val;
    var obj = readCentral(); obj[section] = val; writeCentral(obj);
    scheduleSave();
    _emit('change', section);
  }

  /* 迁移：旧独立键并入中央分区后删除（数据不再单独存在）
   * 注意：必须同时更新 appData 内存，否则 page.html 的 saveData 会用旧内存覆盖中央键 */
  function migrateAll() {
    var changed = false;
    Object.keys(LEGACY).forEach(function (section) {
      var key = LEGACY[section];
      try {
        var raw = localStorage.getItem(key);
        if (!raw) return;
        var data = JSON.parse(raw);
        var hasCentral = false;
        if (typeof appData !== 'undefined' && appData) {
          hasCentral = appData[section] !== undefined
            && !(Array.isArray(appData[section]) && appData[section].length === 0);
          if (!hasCentral) { appData[section] = data; hasCentral = true; changed = true; }
        }
        if (!hasCentral) {
          var obj = readCentral();
          if (!obj[section]) { obj[section] = data; writeCentral(obj); changed = true; }
        }
        localStorage.removeItem(key);
      } catch (e) {}
    });
    if (changed) scheduleSave();
  }

  /* ---- 跨板块物料统一查询 ----
   * 顺序：品质资料库实时标准 → ERP 物料档案 → 静态 PQS_DATA 兜底
   * 保证用户在品质资料库新增/修改物料标准，扫码立刻生效；ERP 建的物料也能扫出来 */
  function _match(list, code) {
    code = String(code || '').trim().toLowerCase();
    if (!code) return null;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].code || '').toLowerCase() === code) return list[i];
    }
    for (i = 0; i < list.length; i++) {
      if (String(list[i].name || '').toLowerCase().indexOf(code) >= 0) return list[i];
    }
    return null;
  }
  function findMaterial(code) {
    var pqs = get('pqs');
    var hit = pqs && pqs.material ? _match(pqs.material, code) : null;
    if (hit) return mergeMat(hit, 'pqs');
    var erp = get('erp');
    hit = erp && erp.material ? _match(erp.material, code) : null;
    if (hit) return mergeMat(hit, 'erp');
    var st = (window.PQS_DATA && window.PQS_DATA.materials) || [];
    hit = _match(st, code);
    if (hit) return mergeMat(hit, 'seed');
    return null;
  }
  function mergeMat(m, src) {
    var r = {};
    ['code', 'name', 'cls', 'ver', 'key', 'tool', 'spec', 'unit', 'category', 'safeStock', 'price', 'supplier', 'remark'].forEach(function (k) {
      if (m[k] !== undefined && m[k] !== '') r[k] = m[k];
    });
    r._src = src;
    return r;
  }

  /* 跨板块物料详情：ERP 档案 + PQS 标准 + 检验历史 聚合 */
  function materialDetail(code) {
    var m = findMaterial(code);
    var erp = get('erp'); var erpMat = erp && erp.material ? _match(erp.material, code) : null;
    var pqs = get('pqs'); var pqsMat = pqs && pqs.material ? _match(pqs.material, code) : null;
    var insp = get('inspect') || { inspections: [] };
    var history = (insp.inspections || []).filter(function (r) {
      return r.matCode && String(r.matCode).toLowerCase() === String(code).toLowerCase();
    });
    var pass = history.filter(function (r) { return r.result === 'pass'; }).length;
    var fail = history.length - pass;
    return {
      code: code,
      erp: erpMat, pqs: pqsMat, found: !!m, _src: m ? m._src : null,
      history: history.slice(-8).reverse(),
      stat: { total: history.length, pass: pass, fail: fail }
    };
  }

  /* 简单事件总线：板块数据变更后广播，供 UI 联动刷新 */
  var _listeners = {};
  function on(evt, fn) { (_listeners[evt] = _listeners[evt] || []).push(fn); }
  function _emit(evt, data) {
    (_listeners[evt] || []).forEach(function (fn) { try { fn(data); } catch (e) {} });
  }

  /* 启动：等 appData 就绪后迁移旧键（最多等 5 秒） */
  var _migrated = false;
  function tryMigrate() {
    if (_migrated) return;
    if (typeof appData === 'undefined' || !appData) { return; }
    migrateAll();
    _migrated = true;
  }
  var tries = 0;
  var t = setInterval(function () {
    tries++;
    tryMigrate();
    if (_migrated || tries > 33) clearInterval(t);
  }, 150);
  setTimeout(function () { tryMigrate(); }, 4000);

  window.DATAHUB = {
    CENTRAL_KEY: CENTRAL_KEY,
    get: get, set: set,
    migrateAll: migrateAll,
    findMaterial: findMaterial,
    materialDetail: materialDetail,
    mergeMat: mergeMat,
    on: on
  };
})();
