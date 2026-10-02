/*!
 * gls-erp.js —— 格丽思质量管理工作台 增强模块
 * 功能：全局搜索 / 模板中心 / 相关模板与资料挂载 / 模板版本升级
 * 设计原则：不修改主逻辑，通过函数包装（包装后调用原函数）实现增强，避免影响原有页面
 */
(function (global) {

  var TPL_VER = '3';              // 模板数据版本号，模板内容大改时递增
  var AUTO_REL_KEY = 'gls_auto_rel_v1';

  /* ==================== 通用工具 ==================== */
  function $(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }

  function highlight(text, kw) {
    var t = escHtml(text);
    if (!kw) return t;
    var e = escHtml(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { return t.replace(new RegExp('(' + e + ')', 'gi'), '<em>$1</em>'); } catch (err) { return t; }
  }

  function stripHtml(s) {
    return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  }

  function toast(msg, type) {
    if (typeof global.showToast === 'function') global.showToast(msg, type || '');
  }

  function safeSet(name, value) {
    try { global[name] = value; } catch (e) {}
    try { eval(name + ' = value'); } catch (e2) {}
  }

  /* ==================== 用户导入模板（持久化） ==================== */
  var USER_TPL_KEY = 'gls_user_templates';

  function getUserTpls() {
    try { return JSON.parse(localStorage.getItem(USER_TPL_KEY) || '[]') || []; } catch (e) { return []; }
  }

  function setUserTpls(arr) {
    try { localStorage.setItem(USER_TPL_KEY, JSON.stringify(arr)); return true; }
    catch (e) {
      toast('保存失败：浏览器本地空间不足，请删除部分导入模板后重试', 'error');
      return false;
    }
  }

  function tplModuleOf(modId) {
    var m = null;
    try { m = MODULES.filter(function (x) { return x.id === modId; })[0]; } catch (e) {}
    return m || (MODULES && MODULES[0]) || { id: 'other', name: '自定义模板', icon: '⭐' };
  }

  /* ==================== 数据收集 ==================== */
  function getAllTemplates() {
    var out = [], seen = {};
    if (typeof appData === 'undefined' || !appData) return out;
    try {
      MODULES.forEach(function (m) {
        (appData[m.id] || []).forEach(function (it) {
          if (it && it.isTemplate) {
            out.push({ tpl: it, moduleId: m.id, moduleName: m.name, moduleIcon: m.icon, color: m.color });
            seen[it.id] = 1;
          }
        });
      });
      if (typeof TEMPLATE_CARDS !== 'undefined') {
        MODULES.forEach(function (m) {
          (TEMPLATE_CARDS[m.id] || []).forEach(function (tpl) {
            if (!seen[tpl.id]) {
              out.push({ tpl: tpl, moduleId: m.id, moduleName: m.name, moduleIcon: m.icon, color: m.color });
              seen[tpl.id] = 1;
            }
          });
        });
      }
      getUserTpls().forEach(function (t) {
        if (!t || !t.id || seen[t.id]) return;
        t.isUser = true;
        var m = tplModuleOf(t.moduleId);
        t.moduleId = m.id;
        out.push({ tpl: t, moduleId: m.id, moduleName: m.name, moduleIcon: m.icon, isUser: true });
        seen[t.id] = 1;
      });
    } catch (e) { console.error('收集模板失败:', e); }
    return out;
  }

  function findTemplateById(tplId, moduleId) {
    var all = getAllTemplates();
    for (var i = 0; i < all.length; i++) {
      if (all[i].tpl.id === tplId && (!moduleId || all[i].moduleId === moduleId)) return all[i];
    }
    return null;
  }

  function findItem(moduleId, itemId) {
    try {
      var arr = appData[moduleId] || [];
      for (var i = 0; i < arr.length; i++) if (arr[i].id === itemId) return arr[i];
    } catch (e) {}
    return null;
  }

  /* ==================== 页面切换 ==================== */
  function switchPage(pageId, title) {
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    var el = $('page-' + pageId);
    if (el) el.classList.add('active');
    var t = $('pageTitle'); if (t) t.textContent = title;
    var fab = $('fabAdd'); if (fab) fab.style.display = 'none';
    var sb = $('searchBtn'); if (sb) sb.style.display = 'none';
    document.querySelectorAll('.sidebar .nav-item').forEach(function (n) { n.classList.remove('active'); });
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  /* ==================== 全局搜索 ==================== */
  var SEARCH_SCOPES = [
    { id: 'all', name: '全部' },
    { id: 'tpl', name: '模板' },
    { id: 'doc', name: '体系文件' },
    { id: 'kb', name: '知识点' },
    { id: 'rec', name: '记录' }
  ];
  var searchScope = 'all';
  var searchTimer = null;
  var _docPlainCache = null;

  function getDocPlainList() {
    if (_docPlainCache) return _docPlainCache;
    _docPlainCache = [];
    try {
      if (typeof SYSTEM_DOCS !== 'undefined') {
        Object.keys(SYSTEM_DOCS).forEach(function (key) {
          var v = SYSTEM_DOCS[key];
          var body = (typeof v === 'string') ? v : ((v && v.content) || '');
          _docPlainCache.push({ key: key, plain: stripHtml(body).toLowerCase() });
        });
      }
    } catch (e) { console.error(e); }
    return _docPlainCache;
  }

  function runSearch(kw) {
    var k = String(kw || '').trim().toLowerCase();
    var res = { tpl: [], doc: [], kb: [], rec: [] };
    if (!k) return res;

    // 卡片（模板 / 记录）
    try {
      MODULES.forEach(function (m) {
        (appData[m.id] || []).forEach(function (it) {
          var name = it.name || '';
          var inName = name.toLowerCase().indexOf(k) >= 0;
          if (!inName) {
            var hay = stripHtml([it.description, it.process, it.knowledge, it.logic,
              it.operation, it.implementation, it.template].filter(Boolean).join(' ')).toLowerCase();
            if (hay.indexOf(k) < 0) return;
          }
          var entry = {
            name: name,
            desc: m.name + ' · ' + (it.description || '暂无描述'),
            moduleId: m.id, moduleName: m.name, icon: m.icon, id: it.id, inName: inName
          };
          if (it.isTemplate) res.tpl.push(entry); else res.rec.push(entry);
        });
      });
    } catch (e) { console.error(e); }

    // 知识点
    try {
      if (typeof KNOWLEDGE_INDEX !== 'undefined' && KNOWLEDGE_INDEX.groups) {
        var gi = 0;
        for (var g in KNOWLEDGE_INDEX.groups) {
          var list = KNOWLEDGE_INDEX.groups[g];
          for (var ii = 0; ii < list.length; ii++) {
            var t = list[ii].title || '';
            if (t.toLowerCase().indexOf(k) >= 0 || g.toLowerCase().indexOf(k) >= 0) {
              res.kb.push({
                name: t, desc: g + ' · ' + list[ii].len + ' 字',
                id: 'kb_' + gi + '_' + ii, group: g, inName: true
              });
            }
          }
          gi++;
        }
      }
    } catch (e) { console.error(e); }

    // 体系文件
    try {
      getDocPlainList().forEach(function (d) {
        var inName = d.key.toLowerCase().indexOf(k) >= 0;
        var inBody = !inName && d.plain.indexOf(k) >= 0;
        if (!inName && !inBody) return;
        var snippet = '';
        if (inBody) {
          var pos = d.plain.indexOf(k);
          snippet = d.plain.substr(Math.max(0, pos - 30), 90);
        }
        res.doc.push({
          name: d.key,
          desc: inBody ? '…' + snippet + '…' : '体系文件 · 文件名匹配',
          key: d.key, inName: inName
        });
      });
    } catch (e) { console.error(e); }

    return res;
  }

  function renderSearchPage() {
    var sc = $('searchScope');
    if (sc) {
      var h = '';
      SEARCH_SCOPES.forEach(function (s) {
        h += '<span class="scope-tag' + (searchScope === s.id ? ' active' : '') +
          '" onclick="setSearchScope(\'' + s.id + '\')">' + s.name + '</span>';
      });
      sc.innerHTML = h;
    }
    doRenderResults();
  }

  function doRenderResults() {
    var box = $('searchResults');
    if (!box) return;
    var input = $('globalSearchInput');
    var kw = input ? input.value.trim() : '';

    if (!kw) {
      box.innerHTML = '<div class="empty-state">' +
        '<div class="empty-icon">🔍</div>' +
        '<div class="empty-text">输入关键词，一次搜遍模板、体系文件、知识点和记录</div>' +
        '<div style="font-size:12px;color:#bbb;margin-top:8px;line-height:1.8;">' +
        '试试：来料检验 · 8D · 培训 · 首件 · SPC · 供应商</div></div>';
      return;
    }

    var res = runSearch(kw);
    var total = res.tpl.length + res.doc.length + res.kb.length + res.rec.length;
    if (!total) {
      box.innerHTML = '<div class="empty-state"><div class="empty-icon">🕳</div>' +
        '<div class="empty-text">没有找到「' + escHtml(kw) + '」相关的内容</div>' +
        '<div style="font-size:12px;color:#bbb;margin-top:8px;">换个词试试，或点上方标签切换搜索范围</div></div>';
      return;
    }

    var groups = [
      { id: 'tpl', icon: '📋', name: '记录模板', badge: 'tpl', list: res.tpl, limit: 30 },
      { id: 'doc', icon: '📁', name: '体系文件', badge: 'doc', list: res.doc, limit: 30 },
      { id: 'kb', icon: '📚', name: '知识点', badge: 'kb', list: res.kb, limit: 40 },
      { id: 'rec', icon: '🗂', name: '业务记录', badge: 'rec', list: res.rec, limit: 30 }
    ];

    var html = '<div class="search-stat">共找到 <b style="color:#2d7a4f">' + total + '</b> 条结果</div>';

    groups.forEach(function (g) {
      if (searchScope !== 'all' && searchScope !== g.id) return;
      if (!g.list.length) return;
      var show = g.list.slice(0, g.limit);
      html += '<div class="search-group-title"><span>' + g.icon + ' ' + g.name +
        '</span><span class="cnt">' + g.list.length + ' 条' +
        (g.list.length > g.limit ? '（显示前 ' + g.limit + '）' : '') + '</span></div>';
      show.forEach(function (it) {
        var onclick = '';
        if (g.id === 'tpl') onclick = "openTemplatePreview('" + escAttr(it.id) + "','" + escAttr(it.moduleId) + "')";
        else if (g.id === 'rec') onclick = "navigateTo('detail','" + escAttr(it.moduleId) + "','" + escAttr(it.id) + "')";
        else if (g.id === 'kb') onclick = "navigateTo('detail','knowledge','" + escAttr(it.id) + "')";
        else if (g.id === 'doc') onclick = "openSystemDoc('" + escAttr(it.key) + "')";

        html += '<div class="search-item" onclick="' + onclick + '">' +
          '<div class="si-title"><span class="si-badge ' + g.badge + '">' + g.name + '</span>' +
          highlight(it.name, kw) + '</div>' +
          '<div class="si-desc">' + escHtml(it.desc || '') + '</div>' +
          '</div>';
      });
    });

    box.innerHTML = html;
  }

  global.onSearchInput = function () {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { doRenderResults(); }, 260);
  };

  global.setSearchScope = function (s) {
    searchScope = s;
    renderSearchPage();
  };

  global.clearSearchInput = function () {
    var el = $('globalSearchInput');
    if (el) { el.value = ''; el.focus(); }
    doRenderResults();
  };

  global.openSystemDoc = function (name) {
    try {
      var arr = appData['documents'] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].name === name) { navigateTo('detail', 'documents', arr[i].id); return; }
      }
    } catch (e) {}
    toast('未找到该体系文件', 'error');
  };

  /* ==================== 模板中心 ==================== */
  var tplFilter = 'all';

  global.setTplFilter = function (f) {
    tplFilter = f;
    renderTemplatesPage();
  };

  function renderTemplatesPage() {
    var box = $('tplListContainer');
    if (!box) return;
    var all = getAllTemplates();

    // 筛选标签
    var groups = [{ id: 'all', name: '全部', count: all.length, icon: '' }];
    MODULES.forEach(function (m) {
      var c = all.filter(function (x) { return x.moduleId === m.id; }).length;
      if (c > 0) groups.push({ id: m.id, name: m.name, count: c, icon: m.icon });
    });
    var fh = '';
    groups.forEach(function (g) {
      fh += '<div class="filter-tab' + (tplFilter === g.id ? ' active' : '') +
        '" onclick="setTplFilter(\'' + g.id + '\')">' + (g.icon ? g.icon + ' ' : '') +
        g.name + ' (' + g.count + ')</div>';
    });
    var fEl = $('tplFilters');
    if (fEl) fEl.innerHTML = fh;

    if (!all.length) {
      box.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div>' +
        '<div class="empty-text">模板加载中…</div>' +
        '<div style="font-size:12px;color:#bbb;margin-top:8px;">若长时间无内容，请刷新页面</div></div>';
      return;
    }

    var list = (tplFilter === 'all') ? all : all.filter(function (x) { return x.moduleId === tplFilter; });

    // 按模块分组输出
    var byMod = {};
    list.forEach(function (x) {
      (byMod[x.moduleId] = byMod[x.moduleId] || []).push(x);
    });

    var html = '';
    MODULES.forEach(function (m) {
      var arr = byMod[m.id];
      if (!arr || !arr.length) return;
      html += '<div class="search-group-title"><span>' + m.icon + ' ' + escHtml(m.name) +
        '</span><span class="cnt">' + arr.length + ' 个模板</span></div>';
      arr.forEach(function (x) {
        var isU = !!x.isUser || !!x.tpl.isUser;
        html += '<div class="tpl-card">' +
          '<div class="tpl-name">' + escHtml(x.tpl.name) +
          (isU ? '<span class="mini-btn" style="margin-left:6px;padding:1px 6px;font-size:11px;background:#eef2ff;color:#4338ca">自定义</span>' : '') +
          '</div>' +
          '<div class="tpl-desc">' + escHtml(x.tpl.description || '标准空白模板') + '</div>' +
          '<div class="tpl-actions">' +
          '<span class="mini-btn" onclick="openTemplatePreview(\'' + escAttr(x.tpl.id) + '\',\'' + escAttr(x.moduleId) + '\')">👁 预览</span>' +
          '<span class="mini-btn blue" onclick="exportTemplate(\'' + escAttr(x.tpl.id) + '\',\'' + escAttr(x.moduleId) + '\')">⬇ 导出 Excel</span>' +
          (isU
            ? '<span class="mini-btn gray" onclick="editUserTpl(\'' + escAttr(x.tpl.id) + '\')">✏️ 改名</span>' +
              '<span class="mini-btn" style="color:#dc2626" onclick="deleteUserTpl(\'' + escAttr(x.tpl.id) + '\')">🗑 删除</span>'
            : '<span class="mini-btn gray" onclick="editTemplateItem(\'' + escAttr(x.moduleId) + '\',\'' + escAttr(x.tpl.id) + '\')">✏️ 编辑</span>') +
          '</div></div>';
      });
    });

    box.innerHTML = html || '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">该分组暂无模板</div></div>';
  }

  global.openTemplatePreview = function (tplId, moduleId) {
    var r = findTemplateById(tplId, moduleId);
    if (!r) { toast('未找到该模板', 'error'); return; }
    var tpl = r.tpl;
    var pt = $('previewTitle'); if (pt) pt.textContent = tpl.name;
    var body = '';
    body += '<div style="font-size:12px;color:#999;margin-bottom:10px;">' +
      escHtml(r.moduleName) + ' · ' + escHtml(tpl.description || '标准空白模板') + '</div>';
    if (tpl.recordTemplate) {
      body += '<div class="tpl-preview-wrap">' + tpl.recordTemplate + '</div>';
      body += '<div style="font-size:11px;color:#bbb;margin-top:10px;">表格可左右滑动查看 · 点下方按钮导出为 Excel 后即可直接填写</div>';
    } else {
      body += '<div style="padding:30px;text-align:center;color:#bbb;font-size:13px;">该模板暂无表格内容，可点「编辑」添加</div>';
    }
    var pb = $('previewBody'); if (pb) pb.innerHTML = body;
    var pf = $('previewFooter');
    if (pf) {
      pf.innerHTML = '<button class="btn btn-cancel" onclick="closePreview()">关闭</button>' +
        '<button class="btn btn-save" onclick="exportTemplate(\'' + escAttr(tplId) + '\',\'' + escAttr(r.moduleId) + '\')">⬇ 导出 Excel</button>';
    }
    var pm = $('previewModal'); if (pm) pm.classList.add('show');
  };

  global.closePreview = function () {
    var pm = $('previewModal'); if (pm) pm.classList.remove('show');
  };

  global.exportTemplate = function (tplId, moduleId) {
    var r = findTemplateById(tplId, moduleId);
    if (!r) { toast('未找到该模板', 'error'); return; }
    if (!r.tpl.recordTemplate) { toast('该模板暂无表格内容', 'error'); return; }
    if (typeof global.exportHtmlTableToXlsx !== 'function') {
      toast('导出模块未加载，请刷新页面后重试', 'error'); return;
    }
    var ok = global.exportHtmlTableToXlsx(r.tpl.recordTemplate, r.tpl.name, r.tpl.name.slice(0, 28));
    toast(ok ? '已开始下载，请在浏览器「下载」中查看' : '导出失败：模板中没有识别到表格',
      ok ? 'success' : 'error');
  };

  global.editTemplateItem = function (moduleId, itemId) {
    var it = findItem(moduleId, itemId);
    if (!it) { toast('未找到该模板', 'error'); return; }
    try {
      currentModule = MODULES.filter(function (m) { return m.id === moduleId; })[0];
      currentItem = it;
      isEditing = true;
      editingId = itemId;
      navigateTo('detail', moduleId, itemId);
      setTimeout(function () { openForm(); }, 60);
    } catch (e) { console.error(e); }
  };

  global.exportCurrentGroup = function () {
    var all = getAllTemplates();
    var list = (tplFilter === 'all') ? all : all.filter(function (x) { return x.moduleId === tplFilter; });
    if (!list.length) { toast('该分组暂无模板', 'error'); return; }
    if (typeof global.exportTemplatesAsZip !== 'function') {
      toast('导出模块未加载，请刷新页面后重试', 'error'); return;
    }
    var groupName = '全部模板';
    MODULES.forEach(function (m) { if (m.id === tplFilter) groupName = m.name + '模板'; });
    var items = [];
    list.forEach(function (x) {
      if (x.tpl.recordTemplate) items.push({ name: x.tpl.name, html: x.tpl.recordTemplate, groupName: groupName });
    });
    if (!items.length) { toast('这些模板没有可导出的表格内容', 'error'); return; }
    var ok = global.exportTemplatesAsZip(items);
    toast(ok ? '正在打包 ' + items.length + ' 个模板，请稍候…' : '导出失败',
      ok ? 'success' : 'error');
  };

  /* ==================== 模板导入（WPS / Excel） ==================== */
  var _tplImpHtml = '', _tplImpName = '';

  function moduleOptions(sel) {
    var h = '';
    try {
      MODULES.forEach(function (m) {
        h += '<option value="' + escAttr(m.id) + '"' + (m.id === sel ? ' selected' : '') + '>' +
          m.name + '</option>';
      });
    } catch (e) {}
    return h;
  }

  /* 把一列/一行文本切成二维数组（制表符 / 逗号 / 分号） */
  function textToRows(txt) {
    var rows = [];
    String(txt || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').forEach(function (line) {
      if (!line.length) return;
      var cells = (line.indexOf('\t') >= 0) ? line.split('\t') : (line.indexOf(',') >= 0 ? line.split(',') : line.split(';'));
      rows.push(cells.map(function (c) { return c.replace(/^"|"$/g, '').trim(); }));
    });
    return rows;
  }

  /* 判断是否数字 */
  function isNum(v) {
    if (v === '' || v === null || v === undefined) return false;
    return /^-?\d+(\.\d+)?%?$/.test(String(v).replace(/,/g, ''));
  }

  /* 二维数组 → 带边框的表格 HTML（第一行作表头） */
  function rowsToHtml(rows, title) {
    if (!rows.length) return '';
    var cols = 0;
    rows.forEach(function (r) { cols = Math.max(cols, r.length); });
    var h = '';
    if (title) h += '<div style="margin:10px 0 6px 0;"><b style="color:#1e40af;font-size:14px;">' + escHtml(title) + '</b></div>';
    h += '<table style="border-collapse:collapse;font-size:11px;width:100%;table-layout:fixed;">';
    rows.forEach(function (r, ri) {
      h += '<tr style="height:22px;">';
      for (var c = 0; c < cols; c++) {
        var v = (r[c] === undefined || r[c] === null) ? '' : String(r[c]);
        var head = (ri === 0);
        var st = 'font-family:宋体;font-size:10.5pt;border:1px solid #000;padding:3px;vertical-align:middle;' +
          'word-break:break-all;white-space:pre-wrap;' +
          (head ? 'font-weight:bold;text-align:center;background:#f3f4f6;' : (isNum(v) ? 'text-align:center;' : 'text-align:left;'));
        h += '<td style="' + st + '">' + escHtml(v) + '</td>';
      }
      h += '</tr>';
    });
    return h + '</table>';
  }

  /* SheetJS 工作表 → 带合并单元格/列宽的表格 HTML */
  function sheetToHtml(ws, title) {
    if (!ws || !ws['!ref']) return '';
    var range = XLSX.utils.decode_range(ws['!ref']);
    var merges = ws['!merges'] || [];
    var map = {}, covered = {};
    merges.forEach(function (m) {
      var rs = m.e.r - m.s.r + 1, cs = m.e.c - m.s.c + 1;
      map[m.s.r + ',' + m.s.c] = { rs: rs, cs: cs };
      for (var r = m.s.r; r <= m.e.r; r++) {
        for (var c = m.s.c; c <= m.e.c; c++) {
          if (!(r === m.s.r && c === m.s.c)) covered[r + ',' + c] = 1;
        }
      }
    });
    var cols = (range.e.c - range.s.c + 1);
    var h = '';
    if (title) h += '<div style="margin:10px 0 6px 0;"><b style="color:#1e40af;font-size:14px;">' + escHtml(title) + '</b></div>';
    h += '<table style="border-collapse:collapse;font-size:11px;width:100%;table-layout:fixed;">';
    // 列宽
    var colsInfo = ws['!cols'] || [];
    if (colsInfo.length) {
      h += '<colgroup>';
      for (var i = 0; i < cols; i++) {
        var w = colsInfo[i] && colsInfo[i].wpx ? colsInfo[i].wpx : (colsInfo[i] && colsInfo[i].wch ? colsInfo[i].wch * 7 : 0);
        h += w ? '<col style="width:' + Math.round(w) + 'px">' : '<col>';
      }
      h += '</colgroup>';
    }
    for (var r2 = range.s.r; r2 <= range.e.r; r2++) {
      h += '<tr style="height:22px;">';
      for (var c2 = range.s.c; c2 <= range.e.c; c2++) {
        var key = r2 + ',' + c2;
        if (covered[key]) continue;
        var m2 = map[key] || {};
        var cell = ws[XLSX.utils.encode_cell({ r: r2, c: c2 })];
        var v = '';
        if (cell) v = (cell.w !== undefined && cell.w !== null && cell.w !== '') ? cell.w : (cell.v === undefined || cell.v === null ? '' : cell.v);
        var head = (r2 === range.s.r);
        var st = 'font-family:宋体;font-size:10.5pt;border:1px solid #000;padding:3px;vertical-align:middle;' +
          'word-break:break-all;white-space:pre-wrap;' +
          (head ? 'font-weight:bold;text-align:center;background:#f3f4f6;' : (isNum(v) ? 'text-align:center;' : 'text-align:left;'));
        h += '<td' + (m2.cs ? ' colspan="' + m2.cs + '"' : '') + (m2.rs ? ' rowspan="' + m2.rs + '"' : '') +
          ' style="' + st + '">' + escHtml(v) + '</td>';
      }
      h += '</tr>';
    }
    return h + '</table>';
  }

  /* 清洗 WPS/网页复制来的 HTML，仅保留表格 */
  function cleanImportedHtml(html) {
    var box = document.createElement('div');
    box.innerHTML = String(html || '');
    var kill = box.querySelectorAll('script,meta,link,iframe,object,embed,img,svg,input,button,textarea,select,style,form');
    for (var i = 0; i < kill.length; i++) kill[i].parentNode.removeChild(kill[i]);
    var all = box.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      var el = all[j], at = el.attributes;
      for (var k = at.length - 1; k >= 0; k--) {
        var n = at[k].name.toLowerCase();
        if (n.indexOf('on') === 0) el.removeAttribute(at[k].name);
        else if (n === 'class' || n === 'id' || n === 'contenteditable' || n === 'data-sheets-value' || n === 'data-sheets-userformat') {
          el.removeAttribute(at[k].name);
        }
      }
    }
    var t = box.querySelector('table');
    if (t) {
      t.setAttribute('style', 'border-collapse:collapse;font-size:11px;width:100%;table-layout:fixed;');
      return t.outerHTML;
    }
    var rows = [];
    var trs = box.querySelectorAll('tr');
    if (trs.length) {
      for (var m = 0; m < trs.length; m++) {
        var tds = trs[m].querySelectorAll('td,th'), row = [];
        for (var n2 = 0; n2 < tds.length; n2++) row.push((tds[n2].textContent || '').trim());
        rows.push(row);
      }
      return rowsToHtml(rows, '');
    }
    var txt = '';
    var ps = box.querySelectorAll('p,div');
    for (var q = 0; q < ps.length; q++) {
      var s2 = (ps[q].textContent || '').trim();
      if (s2) txt += (txt ? '\n' : '') + s2;
    }
    if (!txt) txt = (box.textContent || '').trim();
    return txt ? '<div style="font-size:11pt;line-height:1.9;white-space:pre-wrap;font-family:宋体;">' + escHtml(txt) + '</div>' : '';
  }

  function showImpResult(msg) {
    var box = $('tplImpPrev');
    if (!box) return;
    box.innerHTML = _tplImpHtml
      ? '<div style="font-size:12px;color:#059669;margin-bottom:6px;">✓ ' + escHtml(msg || '已解析，预览如下（可保存为模板）') + '</div>' +
        '<div class="tpl-preview-wrap" style="max-height:320px;overflow:auto;border:1px solid #e5e7eb;border-radius:6px;padding:8px;background:#fff">' + _tplImpHtml + '</div>'
      : '<div style="font-size:12px;color:#dc2626;">未解析到表格内容</div>';
    var nb = $('tplImpName');
    if (nb && !nb.value && _tplImpName) nb.value = _tplImpName;
  }

  global.openTplImport = function () {
    _tplImpHtml = ''; _tplImpName = '';
    var pt = $('previewTitle'); if (pt) pt.textContent = '导入表格为模板（WPS / Excel）';
    var pb = $('previewBody');
    if (!pb) return;
    pb.innerHTML = ''
      + '<div style="font-size:13px;color:#374151;line-height:1.9;margin-bottom:10px;">'
      + '三种方式任选：<b>WPS/Excel 里选中区域复制 → 点「从剪贴板导入」</b>（最快，格式保留）；'
      + '或直接<b>选择 Excel 文件</b>；或把表格<b>粘贴</b>到下方文本框后解析。</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">'
      + '<span class="erp-btn primary" onclick="tplImpFromClipboard()">📋 从剪贴板导入</span>'
      + '<label class="erp-btn" style="cursor:pointer">📄 选择 Excel 文件'
      + '<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="tplImpReadFile(this)"></label>'
      + '<span class="erp-btn" onclick="tplImpFromText()">🔤 解析下方文本</span>'
      + '</div>'
      + '<textarea id="tplImpText" rows="5" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:12px" '
      + 'placeholder="在 WPS / Excel 里复制表格后，点这里 Ctrl+V 粘贴，再点「解析下方文本」…"></textarea>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">'
      + '<label style="font-size:12px;color:#6b7280">模板名称<input id="tplImpName" type="text" placeholder="如：杯盖进料检验记录" '
      + 'style="width:100%;box-sizing:border-box;margin-top:4px;padding:6px;border:1px solid #d1d5db;border-radius:6px"></label>'
      + '<label style="font-size:12px;color:#6b7280">归属模块<select id="tplImpModule" '
      + 'style="width:100%;box-sizing:border-box;margin-top:4px;padding:6px;border:1px solid #d1d5db;border-radius:6px">'
      + moduleOptions('') + '</select></label>'
      + '</div>'
      + '<label style="display:block;font-size:12px;color:#6b7280;margin-top:8px">模板说明（可空）<input id="tplImpDesc" type="text" '
      + 'placeholder="如：来料检验记录模板" style="width:100%;box-sizing:border-box;margin-top:4px;padding:6px;border:1px solid #d1d5db;border-radius:6px"></label>'
      + '<div id="tplImpPrev" style="margin-top:10px"></div>';
    var pf = $('previewFooter');
    if (pf) pf.innerHTML = '<button class="btn btn-cancel" onclick="closePreview()">取消</button>' +
      '<button class="btn btn-save" onclick="tplImportSave()">保存为模板</button>';
    var pm = $('previewModal'); if (pm) pm.classList.add('show');
  };

  global.tplImpReadFile = function (input) {
    var f = input && input.files && input.files[0];
    if (!f) return;
    _tplImpName = f.name.replace(/\.(xlsx|xls|csv)$/i, '');
    var rd = new FileReader();
    rd.onload = function (e) {
      try {
        if (typeof XLSX === 'undefined') { toast('表格解析库未加载，请刷新页面', 'error'); return; }
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var h = sheetToHtml(ws, _tplImpName);
        if (!h) { toast('文件里没有识别到表格内容', 'error'); return; }
        _tplImpHtml = h;
        var n = $('tplImpName'); if (n && !n.value) n.value = _tplImpName;
        showImpResult('已解析文件：' + f.name + '（共 ' + wb.SheetNames.length + ' 个工作表，取第一个）');
      } catch (err) {
        toast('解析失败：' + (err && err.message ? err.message : err), 'error');
      }
    };
    rd.readAsArrayBuffer(f);
  };

  global.tplImpFromClipboard = function () {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      toast('当前浏览器不支持读取剪贴板，请改用「选择 Excel 文件」或在文本框粘贴', 'error');
      return;
    }
    navigator.clipboard.read().then(function (items) {
      var jobs = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.types.indexOf('text/html') >= 0) jobs.push(it.getType('text/html').then(function (b) { return { k: 'html', b: b }; }));
        else if (it.types.indexOf('text/plain') >= 0) jobs.push(it.getType('text/plain').then(function (b) { return { k: 'text', b: b }; }));
      }
      if (!jobs.length) { toast('剪贴板里没有文本内容', 'error'); return; }
      return Promise.all(jobs);
    }).then(function (arr) {
      if (!arr || !arr.length) return;
      var h = null, plain = null;
      arr.forEach(function (x) {
        if (x.k === 'html' && h === null) h = x.b;
        if (x.k === 'text' && plain === null) plain = x.b;
      });
      var use = h ? 'html' : 'plain';
      var job = use === 'html' ? h.text() : plain.text();
      Promise.resolve(job).then(function (txt) {
        _tplImpHtml = (use === 'html') ? cleanImportedHtml(txt) : rowsToHtml(textToRows(txt), '');
        if (!_tplImpHtml) { toast('剪贴板内容里没有识别到表格', 'error'); return; }
        showImpResult('已从剪贴板导入（' + (use === 'html' ? '保留原格式' : '纯文本表格') + '）');
      });
    }).catch(function (e) {
      toast('无法读取剪贴板（' + (e && e.name ? e.name : '') + '），请在文本框里 Ctrl+V 粘贴后点「解析下方文本」', 'error');
    });
  };

  global.tplImpFromText = function () {
    var t = $('tplImpText');
    var v = t ? t.value : '';
    if (!v.trim()) { toast('请先粘贴表格内容', 'error'); return; }
    _tplImpHtml = rowsToHtml(textToRows(v), '');
    if (!_tplImpHtml) { toast('没有识别到表格内容', 'error'); return; }
    showImpResult('已解析粘贴文本');
  };

  global.tplImportSave = function () {
    if (!_tplImpHtml) { toast('请先导入或粘贴表格内容', 'error'); return; }
    var nameEl = $('tplImpName'), modEl = $('tplImpModule'), descEl = $('tplImpDesc');
    var name = (nameEl && nameEl.value.trim()) || _tplImpName || '未命名模板';
    var modId = (modEl && modEl.value) || '';
    var arr = getUserTpls();
    var dup = null;
    for (var i = 0; i < arr.length; i++) { if (arr[i].name === name) { dup = arr[i]; break; } }
    var rec;
    if (dup) {
      dup.recordTemplate = _tplImpHtml;
      dup.moduleId = modId || dup.moduleId;
      dup.description = (descEl && descEl.value.trim()) || dup.description;
      dup.updatedAt = Date.now();
      rec = dup;
    } else {
      rec = {
        id: 'utpl_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        name: name,
        description: (descEl && descEl.value.trim()) || 'WPS/Excel 导入模板',
        recordTemplate: _tplImpHtml,
        isTemplate: true,
        isUser: true,
        moduleId: modId || tplModuleOf('').id,
        createdAt: Date.now()
      };
      arr.push(rec);
    }
    if (!setUserTpls(arr)) return;
    _tplImpHtml = ''; _tplImpName = '';
    closePreview();
    renderTemplatesPage();
    toast(dup ? '已更新模板：' + name : '已导入模板：' + name, 'success');
  };

  global.editUserTpl = function (id) {
    var arr = getUserTpls(), it = null;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) { it = arr[i]; break; }
    if (!it) { toast('未找到该模板', 'error'); return; }
    var nn = prompt('模板名称', it.name);
    if (nn === null) return;
    nn = String(nn).trim();
    if (!nn) { toast('名称不能为空', 'error'); return; }
    it.name = nn;
    var dd = prompt('模板说明', it.description || '');
    if (dd !== null) it.description = String(dd).trim();
    it.updatedAt = Date.now();
    if (!setUserTpls(arr)) return;
    renderTemplatesPage();
    toast('已保存', 'success');
  };

  global.deleteUserTpl = function (id) {
    var arr = getUserTpls(), it = null;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) { it = arr[i]; break; }
    if (!it) { toast('未找到该模板', 'error'); return; }
    if (!confirm('删除模板「' + it.name + '」？删除后不可恢复。')) return;
    arr = arr.filter(function (x) { return x.id !== id; });
    if (!setUserTpls(arr)) return;
    renderTemplatesPage();
    toast('已删除模板：' + it.name, 'success');
  };

  /* ==================== 技术资料库（图纸 / 文档 / PDF / 表格） ==================== */
  var FILE_DB = 'gls_files_db', FILE_STORE = 'files', _fileCache = [];
  var fileFilter = 'all', fileKw = '';

  function fileDb(cb) {
    try {
      var rq = indexedDB.open(FILE_DB, 1);
      rq.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE, { keyPath: 'id' });
      };
      rq.onsuccess = function (e) { cb(e.target.result, null); };
      rq.onerror = function (e) { cb(null, e); };
    } catch (e) { cb(null, e); }
  }

  function fileAll(cb) {
    fileDb(function (db, err) {
      if (!db) { cb([]); return; }
      try {
        var tx = db.transaction(FILE_STORE, 'readonly');
        var rq = tx.objectStore(FILE_STORE).getAll();
        rq.onsuccess = function () { cb(rq.result || []); };
        rq.onerror = function () { cb([]); };
      } catch (e) { cb([]); }
    });
  }

  function filePut(rec, cb) {
    fileDb(function (db, err) {
      if (!db) { toast('浏览器不支持本地文件库（IndexedDB 不可用）', 'error'); cb && cb(false); return; }
      try {
        var tx = db.transaction(FILE_STORE, 'readwrite');
        tx.objectStore(FILE_STORE).put(rec);
        tx.oncomplete = function () { cb && cb(true); };
        tx.onerror = function () { toast('保存失败：本地空间可能不足', 'error'); cb && cb(false); };
      } catch (e) { toast('保存失败：' + e.message, 'error'); cb && cb(false); }
    });
  }

  function fileDel(id, cb) {
    fileDb(function (db) {
      if (!db) { cb && cb(false); return; }
      try {
        var tx = db.transaction(FILE_STORE, 'readwrite');
        tx.objectStore(FILE_STORE).delete(id);
        tx.oncomplete = function () { cb && cb(true); };
      } catch (e) { cb && cb(false); }
    });
  }

  function fileCat(name, type) {
    var n = String(name || '').toLowerCase();
    var ext = n.indexOf('.') >= 0 ? n.split('.').pop() : '';
    if (['dwg', 'dxf', 'step', 'stp', 'iges', 'igs', 'stl', 'prt', 'sldprt', 'sldasm', 'x_t', 'obj', '3mf', 'jt'].indexOf(ext) >= 0) return '2d3d';
    if (ext === 'pdf') return 'pdf';
    if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff'].indexOf(ext) >= 0) return 'img';
    if (['xls', 'xlsx', 'csv', 'et', 'ett'].indexOf(ext) >= 0) return 'sheet';
    if (['doc', 'docx', 'wps', 'txt', 'md', 'rtf', 'ppt', 'pptx', 'dps'].indexOf(ext) >= 0) return 'doc';
    return 'other';
  }

  var FILE_CATS = [
    { id: 'all', name: '全部' },
    { id: '2d3d', name: '2D/3D 图纸' },
    { id: 'pdf', name: 'PDF' },
    { id: 'img', name: '图片' },
    { id: 'sheet', name: '表格' },
    { id: 'doc', name: '文档' },
    { id: 'other', name: '其他' }
  ];

  function fileSize(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function fileIcon(cat) {
    if (cat === '2d3d') return '📐';
    if (cat === 'pdf') return '📕';
    if (cat === 'img') return '🖼';
    if (cat === 'sheet') return '📊';
    if (cat === 'doc') return '📄';
    return '📎';
  }

  function fileTime(t) {
    try {
      var d = new Date(t);
      function p2(x) { return (x < 10 ? '0' : '') + x; }
      return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    } catch (e) { return ''; }
  }

  global.setFileFilter = function (f) { fileFilter = f; renderFilesPage(); };
  global.setFileKw = function (v) { fileKw = String(v || ''); renderFilesPage(); };

  global.renderFilesPage = function () {
    var box = $('filesList');
    if (!box) return;
    var fh = '';
    FILE_CATS.forEach(function (c) {
      fh += '<div class="filter-tab' + (fileFilter === c.id ? ' active' : '') +
        '" onclick="setFileFilter(\'' + c.id + '\')">' + c.name + '</div>';
    });
    var fEl = $('fileFilters');
    if (fEl) fEl.innerHTML = fh;
    box.innerHTML = '<div class="empty-state"><div class="empty-icon">🗂</div><div class="empty-text">正在读取本地文件库…</div></div>';
    fileAll(function (arr) {
      _fileCache = arr || [];
      renderFileList();
    });
  };

  function renderFileList() {
    var box = $('filesList');
    if (!box) return;
    var arr = _fileCache.slice().sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
    var total = 0;
    _fileCache.forEach(function (f) { total += (f.size || 0); });
    var cntEl = $('fileStat');
    if (cntEl) cntEl.textContent = '共 ' + _fileCache.length + ' 个文件 · 占用 ' + fileSize(total);
    var list = arr.filter(function (f) {
      if (fileFilter !== 'all' && f.cat !== fileFilter) return false;
      if (fileKw) {
        var kw = fileKw.toLowerCase();
        var t = (f.name + ' ' + (f.material || '') + ' ' + (f.note || '') + ' ' + (f.owner || '')).toLowerCase();
        if (t.indexOf(kw) < 0) return false;
      }
      return true;
    });
    if (!list.length) {
      box.innerHTML = '<div class="empty-state"><div class="empty-icon">🗂</div>' +
        '<div class="empty-text">' + (_fileCache.length ? '没有符合条件的文件' : '还没有文件，点上方「📤 上传文件」加入图纸 / PDF / 文档 / 表格') + '</div></div>';
      return;
    }
    var html = '';
    list.forEach(function (f) {
      html += '<div class="tpl-card" style="display:flex;flex-direction:column;gap:6px">' +
        '<div class="tpl-name" style="display:flex;align-items:center;gap:6px">' +
        '<span style="font-size:18px">' + fileIcon(f.cat) + '</span>' +
        '<span style="flex:1;word-break:break-all">' + escHtml(f.name) + '</span></div>' +
        '<div class="tpl-desc">' + fileSize(f.size) + ' · ' + escHtml(fileTime(f.time)) +
        (f.owner ? ' · ' + escHtml(f.owner) : '') + '</div>' +
        ((f.material || f.note) ? '<div class="tpl-desc" style="color:#4338ca">关联：' +
          escHtml(f.material || '') + (f.note ? '　' + escHtml(f.note) : '') + '</div>' : '') +
        '<div class="tpl-actions">' +
        '<span class="mini-btn" onclick="filesPreview(\'' + escAttr(f.id) + '\')">👁 预览</span>' +
        '<span class="mini-btn blue" onclick="filesDownload(\'' + escAttr(f.id) + '\')">⬇ 下载</span>' +
        '<span class="mini-btn gray" onclick="filesSetRel(\'' + escAttr(f.id) + '\')">🔗 关联</span>' +
        '<span class="mini-btn" style="color:#dc2626" onclick="filesDelete(\'' + escAttr(f.id) + '\')">🗑 删除</span>' +
        '</div></div>';
    });
    box.innerHTML = html;
  }

  global.filesUpload = function (input) {
    var fs = input && input.files ? Array.prototype.slice.call(input.files) : [];
    if (!fs.length) return;
    var rec = null, ok = 0, fail = 0, total = fs.length;
    var owner = '';
    try { owner = (JSON.parse(localStorage.getItem('gls_current_user') || '{}').realname) || ''; } catch (e) {}
    toast('正在导入 ' + total + ' 个文件…', '');
    var idx = 0;
    function next() {
      if (idx >= fs.length) {
        if (input) input.value = '';
        renderFilesPage();
        toast('导入完成：成功 ' + ok + ' 个' + (fail ? '，失败 ' + fail + ' 个' : ''), fail ? 'error' : 'success');
        return;
      }
      var f = fs[idx++];
      var r = {
        id: 'f_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
        name: f.name,
        size: f.size,
        type: f.type || '',
        cat: fileCat(f.name, f.type),
        time: Date.now(),
        owner: owner,
        material: '',
        note: '',
        blob: f
      };
      filePut(r, function (good) { if (good) ok++; else fail++; next(); });
    }
    next();
  };

  function fileById(id) {
    for (var i = 0; i < _fileCache.length; i++) if (_fileCache[i].id === id) return _fileCache[i];
    return null;
  }

  global.filesPreview = function (id) {
    var f = fileById(id);
    if (!f) { toast('文件不存在，请刷新后重试', 'error'); return; }
    var pt = $('previewTitle'); if (pt) pt.textContent = f.name;
    var pb = $('previewBody'); if (!pb) return;
    if (!f.blob) { pb.innerHTML = '<div style="padding:20px;color:#dc2626">文件内容缺失，请重新上传</div>'; }
    else if (f.cat === 'img') {
      pb.innerHTML = '<img src="' + URL.createObjectURL(f.blob) + '" style="max-width:100%;border:1px solid #e5e7eb;border-radius:6px">';
    } else if (f.cat === 'pdf') {
      pb.innerHTML = '<iframe src="' + URL.createObjectURL(f.blob) + '" style="width:100%;height:70vh;border:1px solid #e5e7eb;border-radius:6px"></iframe>';
    } else if (f.cat === 'sheet' || f.cat === 'doc') {
      pb.innerHTML = '<div style="padding:14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;color:#374151;font-size:13px;line-height:2">' +
        fileIcon(f.cat) + ' <b>' + escHtml(f.name) + '</b>（' + fileSize(f.size) + '）<br>' +
        '此类文件不支持在线预览，点下方「下载」用本机 WPS / Office 打开。<br>' +
        '提示：WPS 表格类文件可在「模板中心 → 导入表格」里直接转成带格式模板。</div>';
    } else {
      pb.innerHTML = '<div style="padding:14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;color:#374151;font-size:13px;line-height:2">' +
        '📐 <b>' + escHtml(f.name) + '</b>（' + fileSize(f.size) + '）<br>' +
        '图纸文件（DWG/STEP 等）不支持网页预览，点下方「下载」用本机 CAD / 看图软件打开。</div>';
    }
    var pf = $('previewFooter');
    if (pf) pf.innerHTML = '<button class="btn btn-cancel" onclick="closePreview()">关闭</button>' +
      '<button class="btn btn-save" onclick="filesDownload(\'' + escAttr(id) + '\')">⬇ 下载</button>';
    var pm = $('previewModal'); if (pm) pm.classList.add('show');
  };

  global.filesDownload = function (id) {
    var f = fileById(id);
    if (!f || !f.blob) { toast('文件不存在', 'error'); return; }
    try {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(f.blob);
      a.download = f.name || 'download';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { document.body.removeChild(a); }, 800);
    } catch (e) { toast('下载失败：' + e.message, 'error'); }
  };

  global.filesDelete = function (id) {
    var f = fileById(id);
    if (!f) { toast('文件不存在', 'error'); return; }
    if (!confirm('删除文件「' + f.name + '」？删除后不可恢复。')) return;
    fileDel(id, function (ok) {
      if (!ok) { toast('删除失败', 'error'); return; }
      _fileCache = _fileCache.filter(function (x) { return x.id !== id; });
      renderFileList();
      toast('已删除：' + f.name, 'success');
    });
  };

  global.filesSetRel = function (id) {
    var f = fileById(id);
    if (!f) { toast('文件不存在', 'error'); return; }
    var m = prompt('关联物料 / 产品（编码或名称，可留空）', f.material || '');
    if (m === null) return;
    var n = prompt('备注（如：杯体组件 2D 图 版本B）', f.note || '');
    if (n === null) return;
    f.material = String(m).trim();
    f.note = String(n).trim();
    filePut(f, function (ok) {
      if (!ok) return;
      renderFileList();
      toast('已保存关联', 'success');
    });
  };

  global.toastTplHelp = function () {
    var pt = $('previewTitle'); if (pt) pt.textContent = '模板中心使用说明';
    var pb = $('previewBody');
    if (pb) pb.innerHTML = '<div style="font-size:13px;line-height:2;color:#444;">' +
      '<p><b>1. 找模板</b>：上方标签按业务模块分类，点标签即可只看该模块的模板。</p>' +
      '<p><b>2. 看模板</b>：点「预览」查看带格式的空白表格（合并单元格、边框都在）。</p>' +
      '<p><b>3. 用模板</b>：点「导出 Excel」下载 .xlsx 文件，直接用 Excel 打开填写，格式完整保留。</p>' +
      '<p><b>4. 批量拿</b>：点顶部「导出本组 Excel」，把当前分组的所有模板打包成 zip 一次下载。</p>' +
      '<p><b>5. 改模板</b>：点「编辑」可以修改模板内容；在业务卡片里也能勾选关联模板，详情页就会直接列出。</p>' +
      '<p style="color:#999;font-size:12px;margin-top:10px;">说明：模板为空白模板，不含具体人名和数据，可直接打印或填写。</p>' +
      '</div>';
    var pf = $('previewFooter');
    if (pf) pf.innerHTML = '<button class="btn btn-cancel" onclick="closePreview()">知道了</button>';
    var pm = $('previewModal'); if (pm) pm.classList.add('show');
  };

  /* ==================== 详情页：相关模板与资料 ==================== */
  function appendRelatedSections() {
    try {
      if (typeof currentModule === 'undefined' || !currentModule) return;
      if (typeof currentItem === 'undefined' || !currentItem) return;
      if (currentModule.id === 'knowledge') return;
      if (currentItem.isKnowledge) return;
      var wrap = $('detailSections');
      if (!wrap) return;
      if (wrap.querySelector('[data-erp-related="1"]')) return;

      // 相关模板
      var tplIds = currentItem.relatedTemplates || [];
      var tplHtml = '';
      tplIds.forEach(function (tid) {
        var r = findTemplateById(tid);
        if (!r) return;
        tplHtml += '<div class="related-item" onclick="openTemplatePreview(\'' + escAttr(tid) + '\',\'' + escAttr(r.moduleId) + '\')">' +
          '<span class="ri-name">' + escHtml(r.tpl.name) + '</span>' +
          '<span class="ri-type">模板</span></div>';
      });

      // relatedTemplates 为空时，按名称相似度临时推荐（不写库）
      if (!tplHtml) {
        var rec = recommendTemplates(currentItem, 4);
        rec.forEach(function (r) {
          tplHtml += '<div class="related-item" onclick="openTemplatePreview(\'' + escAttr(r.tpl.id) + '\',\'' + escAttr(r.moduleId) + '\')">' +
            '<span class="ri-name">' + escHtml(r.tpl.name) + '</span>' +
            '<span class="ri-type" style="background:#fff7e6;color:#fa8c16;">推荐</span></div>';
        });
      }

      // 相关资料
      var docNames = currentItem.relatedDocs || [];
      var docHtml = '';
      docNames.forEach(function (nm) {
        if (nm === currentItem.name) return;   // 不把当前卡片自身列为相关资料
        var exist = false;
        try { exist = (typeof SYSTEM_DOCS !== 'undefined') && !!SYSTEM_DOCS[nm]; } catch (e) {}
        if (!exist) return;
        docHtml += '<div class="related-item" onclick="openSystemDoc(\'' + escAttr(nm) + '\')">' +
          '<span class="ri-name">' + escHtml(nm) + '</span>' +
          '<span class="ri-type" style="background:#e6f7ff;color:#1890ff;">资料</span></div>';
      });

      var html = '<div class="detail-section" data-erp-related="1">' +
        '<div class="section-head"><span class="icon">🔗</span><span class="name">相关模板与资料</span></div>';

      if (tplHtml || docHtml) {
        html += '<div class="related-grid">' + tplHtml + docHtml + '</div>';
        html += '<div style="margin-top:10px;font-size:11px;color:#bbb;">点「编辑」可勾选要固定关联的模板和体系文件</div>';
      } else {
        html += '<div class="related-empty">暂未关联模板或资料 —— 点右下角「编辑」可勾选</div>';
      }
      html += '</div>';
      wrap.insertAdjacentHTML('beforeend', html);
    } catch (e) { console.error('渲染关联区失败:', e); }
  }

  // 按业务关键词推荐模板
  var BIZ_WORDS = ['供应商', '采购', '来料', '进货', '检验', '首件', '巡检', '生产', '成品', '出货',
    '交付', '异常', '不合格', '纠正', '预防', '风险', '培训', '研发', '设计', '变更', '评审', '审核',
    '设备', '校准', '仓储', '库存', '文件', '记录', '客户', '投诉', '退货', '召回', '标识', '追溯',
    '试产', '样品', '报价', '成本', '计划', '目标', '职责', '安全', '环境', '应急', '废弃物', '8D', 'SPC'];

  function hitWords(name) {
    var out = [];
    var s = String(name || '');
    BIZ_WORDS.forEach(function (w) { if (s.indexOf(w) >= 0) out.push(w); });
    return out;
  }

  function recommendTemplates(item, max) {
    var out = [];
    try {
      var iw = hitWords(item.name);
      if (!iw.length) return out;
      var all = getAllTemplates();
      var scored = [];
      all.forEach(function (x) {
        if (x.tpl.id === item.id) return;
        if (x.moduleId !== (currentModule ? currentModule.id : '')) return;
        var tw = hitWords(x.tpl.name);
        var hit = 0;
        tw.forEach(function (w) { if (iw.indexOf(w) >= 0) hit++; });
        if (hit > 0) scored.push({ r: x, s: hit });
      });
      scored.sort(function (a, b) { return b.s - a.s; });
      scored.slice(0, max || 4).forEach(function (x) { out.push(x.r); });
    } catch (e) {}
    return out;
  }

  /* ==================== 表单：关联多选 ==================== */
  function buildTemplatePickHtml(item) {
    var selected = (item && item.relatedTemplates) || [];
    var all = getAllTemplates();
    if (!all.length) return '<div class="pick-empty">暂无模板</div>';
    var html = '';
    MODULES.forEach(function (m) {
      var arr = all.filter(function (x) { return x.moduleId === m.id; });
      if (!arr.length) return;
      html += '<div class="pick-group">' + m.icon + ' ' + escHtml(m.name) + '</div>';
      arr.forEach(function (x) {
        if (item && x.tpl.id === item.id) return;
        var ck = selected.indexOf(x.tpl.id) >= 0 ? ' checked' : '';
        html += '<label class="pick-item"><input type="checkbox" value="' + escHtml(x.tpl.id) + '"' + ck + '>' +
          escHtml(x.tpl.name) + '</label>';
      });
    });
    return html || '<div class="pick-empty">暂无模板</div>';
  }

  function buildDocPickHtml(item) {
    var selected = (item && item.relatedDocs) || [];
    var names = [];
    try { if (typeof SYSTEM_DOCS !== 'undefined') names = Object.keys(SYSTEM_DOCS); } catch (e) {}
    if (!names.length) return '<div class="pick-empty">暂无体系文件</div>';
    var html = '';
    names.forEach(function (nm) {
      var ck = selected.indexOf(nm) >= 0 ? ' checked' : '';
      html += '<label class="pick-item"><input type="checkbox" value="' + escHtml(nm) + '"' + ck + '>' +
        escHtml(nm) + '</label>';
    });
    return html;
  }

  function appendPickLists() {
    var body = $('formModalBody');
    if (!body || $('pickTemplates')) return;
    var item = (typeof isEditing !== 'undefined' && isEditing && typeof currentItem !== 'undefined') ? currentItem : null;
    var html = '';
    html += '<div class="form-group"><label>🔗 关联模板（可多选）</label>' +
      '<div class="pick-wrap" id="pickTemplates">' + buildTemplatePickHtml(item) + '</div>' +
      '<div class="form-hint">勾选后，本卡片详情页底部会直接列出这些模板，点开即可预览、导出 Excel</div></div>';
    html += '<div class="form-group"><label>🔗 关联体系文件（可多选）</label>' +
      '<div class="pick-wrap" id="pickDocs">' + buildDocPickHtml(item) + '</div>' +
      '<div class="form-hint">勾选后，详情页可直接跳转到对应体系文件全文</div></div>';
    body.insertAdjacentHTML('beforeend', html);

    // 显示已选数量
    ['pickTemplates', 'pickDocs'].forEach(function (wid) {
      var w = $(wid);
      if (!w) return;
      w.addEventListener('change', function () { updatePickCount(wid); });
      updatePickCount(wid);
    });
  }

  function updatePickCount(wid) {
    var w = $(wid);
    if (!w) return;
    var n = 0;
    w.querySelectorAll('input[type=checkbox]').forEach(function (cb) { if (cb.checked) n++; });
    var label = w.parentNode.querySelector('.pick-count');
    if (!label) {
      label = document.createElement('span');
      label.className = 'pick-count';
      var lb = w.parentNode.querySelector('label');
      if (lb) lb.appendChild(label);
    }
    label.textContent = n ? ' 已选 ' + n + ' 项' : '';
  }

  function collectPickedSafe(wrapId) {
    var w = $(wrapId);
    if (!w) return null;   // 没有这个区块 → 不改动原值
    var out = [];
    w.querySelectorAll('input[type=checkbox]').forEach(function (cb) { if (cb.checked) out.push(cb.value); });
    return out;
  }

  /* ==================== 函数包装 ==================== */
  function patchFunctions() {
    // 1) navigateTo
    var _nav = global.navigateTo;
    if (typeof _nav === 'function' && !_nav.__erpPatched) {
      var newNav = function (page, moduleId, itemId) {
        if (page === 'search') {
          switchPage('search', '全局搜索');
          try { currentPage = 'search'; } catch (e) {}
          renderSearchPage();
          return;
        }
        if (page === 'templates') {
          switchPage('templates', '模板中心');
          try { currentPage = 'templates'; } catch (e) {}
          renderTemplatesPage();
          return;
        }
        if (page === 'files') {
          switchPage('files', '技术资料库');
          try { currentPage = 'files'; } catch (e) {}
          renderFilesPage();
          return;
        }
        return _nav.apply(this, arguments);
      };
      newNav.__erpPatched = true;
      global.navigateTo = newNav;
    }

    // 2) renderSidebar
    var _side = global.renderSidebar;
    if (typeof _side === 'function' && !_side.__erpPatched) {
      var newSide = function () {
        _side.apply(this, arguments);
        try { injectSidebarExtras(); } catch (e) { console.error(e); }
      };
      newSide.__erpPatched = true;
      global.renderSidebar = newSide;
    }

    // 3) renderHome
    var _home = global.renderHome;
    if (typeof _home === 'function' && !_home.__erpPatched) {
      var newHome = function () {
        _home.apply(this, arguments);
        try { injectQuickTemplates(); } catch (e) { console.error(e); }
      };
      newHome.__erpPatched = true;
      global.renderHome = newHome;
    }

    // 4) renderDetail
    var _detail = global.renderDetail;
    if (typeof _detail === 'function' && !_detail.__erpPatched) {
      var newDetail = function () {
        _detail.apply(this, arguments);
        try { appendRelatedSections(); } catch (e) { console.error(e); }
      };
      newDetail.__erpPatched = true;
      global.renderDetail = newDetail;
    }

    // 5) openForm
    var _openForm = global.openForm;
    if (typeof _openForm === 'function' && !_openForm.__erpPatched) {
      var newOpenForm = function () {
        _openForm.apply(this, arguments);
        try { appendPickLists(); } catch (e) { console.error(e); }
      };
      newOpenForm.__erpPatched = true;
      global.openForm = newOpenForm;
    }

    // 6) saveForm —— 重写，带上关联字段
    global.saveForm = function () {
      var nameEl = $('formName');
      if (!nameEl) return;
      var name = nameEl.value.trim();
      if (!name) { toast('请输入名称', 'error'); return; }

      function v(id) { var e = $(id); return e ? e.value.trim() : ''; }
      function rw(id) { var e = $(id); return e ? e.value : ''; }

      var data = {
        name: name,
        description: v('formDesc'),
        status: (($('formStatus') || {}).value) || 'pending',
        process: rw('formProcess'),
        recordTemplate: rw('formRecordTemplate'),
        template: v('formTemplate'),
        knowledge: v('formKnowledge'),
        logic: v('formLogic'),
        operation: v('formOperation'),
        implementation: rw('formImplementation')
      };

      var pkTpl = collectPickedSafe('pickTemplates');
      if (pkTpl) data.relatedTemplates = pkTpl;
      var pkDoc = collectPickedSafe('pickDocs');
      if (pkDoc) data.relatedDocs = pkDoc;

      if (typeof isEditing !== 'undefined' && isEditing) {
        var idx = -1;
        var arr = appData[currentModule.id] || [];
        for (var i = 0; i < arr.length; i++) if (arr[i].id === editingId) { idx = i; break; }
        if (idx > -1) {
          var merged = Object.assign({}, arr[idx], data, { updatedAt: Date.now() });
          arr[idx] = merged;
        }
        toast('更新成功', 'success');
      } else {
        data.id = genId();
        data.createdAt = Date.now();
        appData[currentModule.id].unshift(data);
        toast('添加成功', 'success');
      }

      saveData();
      closeForm();

      if (typeof isEditing !== 'undefined' && isEditing) {
        var found = null;
        (appData[currentModule.id] || []).forEach(function (x) { if (x.id === editingId) found = x; });
        if (found) currentItem = found;
        renderDetail();
      } else {
        renderModuleList();
      }
    };
    global.saveForm.__erpPatched = true;
  }

  function injectSidebarExtras() {
    var nav = $('sidebarNav');
    if (!nav) return;
    if (nav.querySelector('[data-erp="side"]')) return;
    var sections = nav.querySelectorAll('.nav-section');
    var target = null;
    for (var i = 0; i < sections.length; i++) {
      if ((sections[i].textContent || '').indexOf('数据分析') >= 0) { target = sections[i]; break; }
    }
    var cnt = getAllTemplates().length;
    var html = '<div class="nav-section" data-erp="side">常用工具</div>' +
      '<div class="nav-item" data-erp="side" onclick="navigateTo(\'search\'); toggleSidebar()">' +
      '<span class="nav-icon">🔍</span><span class="nav-text">全局搜索</span></div>' +
      '<div class="nav-item" data-erp="side" onclick="navigateTo(\'templates\'); toggleSidebar()">' +
      '<span class="nav-icon">📋</span><span class="nav-text">模板中心</span>' +
      (cnt ? '<span class="nav-badge" style="background:#7dd3a0;color:#1f5a38">' + cnt + '</span>' : '') +
      '</div>' +
      '<div class="nav-item" data-erp="side" onclick="navigateTo(\'files\'); toggleSidebar()">' +
      '<span class="nav-icon">🗂</span><span class="nav-text">技术资料库</span>' +
      '<span class="nav-badge" style="background:#dbeafe;color:#1d4ed8">图纸/PDF</span>' +
      '</div>';
    if (target) target.insertAdjacentHTML('beforebegin', html);
    else nav.insertAdjacentHTML('beforeend', html);
  }

  function injectQuickTemplates() {
    var grid = $('quickGrid');
    if (!grid || grid.querySelector('[data-erp="quick"]')) return;
    grid.insertAdjacentHTML('afterbegin',
      '<div class="quick-item" data-erp="quick" onclick="navigateTo(\'templates\')">' +
      '<div class="quick-icon">📋</div><div class="quick-text">模板中心</div></div>');
    var items = grid.querySelectorAll('.quick-item');
    if (items.length > 8) items[items.length - 1].remove();
  }

  /* ==================== 模板版本升级 ==================== */
  function applyTemplateUpgrade() {
    if (typeof TEMPLATE_CARDS === 'undefined') return false;
    if (typeof appData === 'undefined' || !appData) return false;
    var verKey = 'gls_templates_ver';
    var cur = null;
    try { cur = localStorage.getItem(verKey); } catch (e) {}
    if (cur === TPL_VER) return true;

    var needSave = false, added = 0, updated = 0;

    MODULES.forEach(function (m) {
      var tpls = TEMPLATE_CARDS[m.id] || [];
      if (!appData[m.id]) appData[m.id] = [];
      tpls.forEach(function (tpl) {
        var idx = -1;
        for (var i = 0; i < appData[m.id].length; i++) {
          if (appData[m.id][i].id === tpl.id) { idx = i; break; }
        }
        if (idx > -1) {
          var it = appData[m.id][idx];
          if (it.recordTemplate !== tpl.recordTemplate || it.name !== tpl.name) {
            it.recordTemplate = tpl.recordTemplate;
            it.name = tpl.name;
            it.description = tpl.description;
            it.isTemplate = true;
            needSave = true; updated++;
          }
        } else if (!cur) {
          var copy = {};
          for (var k in tpl) { if (Object.prototype.hasOwnProperty.call(tpl, k)) copy[k] = tpl[k]; }
          copy.createdAt = copy.createdAt || Date.now();
          appData[m.id].unshift(copy);
          needSave = true; added++;
        }
      });
    });

    try { localStorage.setItem(verKey, TPL_VER); } catch (e) {}
    try { localStorage.setItem('gls_templates_initialized', '1'); } catch (e) {}
    if (needSave) { try { saveData(); } catch (e) {} }
    console.log('[ERP] 模板版本 ' + TPL_VER + ' 应用完成：新增 ' + added + '，更新 ' + updated);
    return true;
  }

  /* ==================== 自动关联（仅首次） ==================== */
  function buildAutoRelations() {
    try {
      if (localStorage.getItem(AUTO_REL_KEY)) return;
      if (typeof appData === 'undefined' || !appData) return;

      var allTpl = getAllTemplates();
      var docNames = [];
      try { if (typeof SYSTEM_DOCS !== 'undefined') docNames = Object.keys(SYSTEM_DOCS); } catch (e) {}

      var changed = false;
      MODULES.forEach(function (m) {
        (appData[m.id] || []).forEach(function (it) {
          if (it.isTemplate) return;                 // 模板卡片本身不自动关联
          if (it.relatedTemplates || it.relatedDocs) return;

          var iw = hitWords(it.name);
          if (!iw.length) return;

          // 模板：同模块优先
          var same = [], other = [];
          allTpl.forEach(function (x) {
            if (x.tpl.id === it.id) return;
            var tw = hitWords(x.tpl.name);
            var hit = 0;
            tw.forEach(function (w) { if (iw.indexOf(w) >= 0) hit++; });
            if (!hit) return;
            var rec = { id: x.tpl.id, s: hit, same: x.moduleId === m.id };
            if (rec.same) same.push(rec); else other.push(rec);
          });
          same.sort(function (a, b) { return b.s - a.s; });
          other.sort(function (a, b) { return b.s - a.s; });
          var pick = same.concat(other).slice(0, 6).map(function (x) { return x.id; });
          if (pick.length) { it.relatedTemplates = pick; changed = true; }

          // 体系文件
          var dpick = [];
          docNames.forEach(function (nm) {
            var dw = hitWords(nm);
            var hit = 0;
            dw.forEach(function (w) { if (iw.indexOf(w) >= 0) hit++; });
            if (hit) dpick.push({ nm: nm, s: hit });
          });
          dpick.sort(function (a, b) { return b.s - a.s; });
          if (dpick.length) {
            it.relatedDocs = dpick.slice(0, 8).map(function (x) { return x.nm; });
            changed = true;
          }
        });
      });

      if (changed) saveData();
      localStorage.setItem(AUTO_REL_KEY, '1');
      console.log('[ERP] 自动关联完成');
    } catch (e) { console.error('自动关联失败:', e); }
  }

  /* ==================== 启动 ==================== */
  function boot() {
    patchFunctions();

    // 模板版本升级：若已加载则立刻执行，否则等 onTemplatesLoaded
    var _tplLoaded = global.onTemplatesLoaded;
    applyTemplateUpgrade();

    global.onTemplatesLoaded = function () {
      try { if (typeof _tplLoaded === 'function') _tplLoaded.apply(this, arguments); } catch (e) {}
      try { applyTemplateUpgrade(); } catch (e) { console.error(e); }
      try {
        if (typeof currentPage !== 'undefined') {
          if (currentPage === 'home') renderHome();
          else if (currentPage === 'module') renderModuleList();
          else if (currentPage === 'templates') renderTemplatesPage();
        }
      } catch (e) {}
      try { renderSidebar(); } catch (e) {}
    };

    // 首次自动建立关联
    buildAutoRelations();

    // 重新渲染（让新增入口出现）
    try { renderSidebar(); } catch (e) {}
    try {
      if (typeof currentPage !== 'undefined' && currentPage === 'home') renderHome();
    } catch (e) {}

    console.log('[ERP] 增强模块加载完成');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window);
