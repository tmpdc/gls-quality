/* gls-fields-ui.js — 字段/下拉选项的配置界面（挂到 window.FIELDS 上）
 * 能力：每个模块都能增/减项目、改项目类型、把它做成下拉、增删下拉选项、排序、停用/启用、恢复默认
 */
(function () {
  'use strict';
  if (!window.FIELDS) { return; }
  var FD = window.FIELDS;

  /* ---------- 工具 ---------- */
  function esc(s) { return FD.esc(s); }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  var TYPE_LABEL = {
    text: '单行文本', textarea: '多行文本', number: '数字', date: '日期',
    select: '下拉选择', multiselect: '多选下拉', radio: '单选按钮', scan: '扫码/编码', readonly: '只读'
  };

  var _draft = null;      // 设计器里的字段副本
  var _module = null;     // 当前模块
  var _editIdx = -1;      // 正在展开编辑的行

  /* ==================== 设计器弹窗 ==================== */
  function ensureShell() {
    if ($('fxDesigner')) return;
    var mask = el('div', 'fx-mask');
    mask.id = 'fxMask';
    mask.onclick = function () { };
    var box = el('div', 'fx-drawer');
    box.id = 'fxDesigner';
    box.innerHTML = '<div class="fx-dhead"><b id="fxDTitle">配置项目</b><span class="fx-x" onclick="FIELDS.closeDesigner()">✕</span></div>'
      + '<div class="fx-dbody" id="fxDBody"></div>'
      + '<div class="fx-dfoot" id="fxDFoot"></div>';
    document.body.appendChild(mask);
    document.body.appendChild(box);
  }

  function openDesigner(moduleId) {
    ensureShell();
    _module = moduleId;
    _editIdx = -1;
    _draft = FD.get(moduleId);
    $('fxDTitle').textContent = '配置项目 · ' + FD.moduleName(moduleId);
    renderDesigner();
    $('fxMask').classList.add('show');
    $('fxDesigner').classList.add('show');
  }

  function closeDesigner() {
    var m = $('fxMask'), d = $('fxDesigner');
    if (m) m.classList.remove('show');
    if (d) d.classList.remove('show');
    _draft = null; _module = null; _editIdx = -1;
  }

  function renderDesigner() {
    var h = '<div class="fx-dtools">'
      + '<button class="fx-btn fx-btn-p" onclick="FIELDS.dzAdd()">＋ 新增项目</button>'
      + '<button class="fx-btn" onclick="FIELDS.openDictManager()">📋 管理下拉选项</button>'
      + '<button class="fx-btn" onclick="FIELDS.dzReset()">恢复默认</button>'
      + '<span class="fx-dcount">共 ' + _draft.length + ' 个项目</span>'
      + '</div>';
    h += '<div class="fx-dlist">';
    if (!_draft.length) h += '<div class="fx-empty">还没有项目，点「＋ 新增项目」开始</div>';
    _draft.forEach(function (f, i) {
      if (i === _editIdx) { h += editRowHtml(f, i); return; }
      var off = f.enabled === false;
      h += '<div class="fx-ditem' + (off ? ' off' : '') + '">'
        + '<span class="fx-order">' + (i + 1) + '</span>'
        + '<span class="fx-dname">' + esc(f.label) + (f.required ? ' <i class="fx-rdot">*</i>' : '') + '</span>'
        + '<span class="fx-dtype">' + (TYPE_LABEL[f.type] || f.type)
        + (f.type === 'select' && f.dict ? '（' + esc(f.dict) + '）' : '') + '</span>'
        + '<span class="fx-dacts">'
        + '<a onclick="FIELDS.dzEdit(' + i + ')">编辑</a>'
        + '<a onclick="FIELDS.dzUp(' + i + ')" title="上移">↑</a>'
        + '<a onclick="FIELDS.dzDown(' + i + ')" title="下移">↓</a>'
        + '<a onclick="FIELDS.dzToggle(' + i + ')">' + (off ? '启用' : '停用') + '</a>'
        + '<a class="del" onclick="FIELDS.dzDel(' + i + ')">删除</a>'
        + '</span></div>';
    });
    h += '</div>';
    $('fxDBody').innerHTML = h;

    var cust = FD.isCustom(_module);
    $('fxDFoot').innerHTML = '<span class="fx-tip">' + (cust ? '已按你的配置保存' : '当前是默认配置，保存后将按你的配置运行') + '</span>'
      + '<button class="fx-btn" onclick="FIELDS.closeDesigner()">取消</button>'
      + '<button class="fx-btn fx-btn-p" onclick="FIELDS.dzOk()">保存</button>';
  }

  /* 展开编辑单行 */
  function editRowHtml(f, i) {
    var typeOpts = Object.keys(TYPE_LABEL).map(function (k) {
      return '<option value="' + k + '"' + (f.type === k ? ' selected' : '') + '>' + TYPE_LABEL[k] + '</option>';
    }).join('');
    var dictNames = Object.keys(FD.dicts());
    var dictSel = '<select id="fxE_dict"><option value="">（不使用下拉字典）</option>'
      + dictNames.map(function (n) { return '<option value="' + esc(n) + '"' + (f.dict === n ? ' selected' : '') + '>' + esc(n) + '（' + FD.dict(n).length + '项）</option>'; }).join('')
      + '</select>';
    var radioVals = '';
    if (f.type === 'radio') {
      radioVals = (f.options || []).map(function (o) {
        return Array.isArray(o) ? (o[0] + '=' + o[1]) : o;
      }).join(',');
    }
    return '<div class="fx-dedit">'
      + '<div class="fx-dedit-h">编辑项目 ' + (i + 1) + '</div>'
      + '<div class="fx-grid">'
      + '<label>项目名称</label><input id="fxE_label" value="' + esc(f.label) + '" placeholder="显示在表单里的名称">'
      + '<label>项目类型</label><select id="fxE_type" onchange="FIELDS.dzTypeChange()">' + typeOpts + '</select>'
      + '<label>下拉选项来源</label>' + dictSel
      + '<label>单选值对</label><input id="fxE_radio" value="' + esc(radioVals) + '" placeholder="如 pass=合格,fail=不合格（仅单选按钮用）">'
      + '<label>提示文字</label><input id="fxE_ph" value="' + esc(f.placeholder || '') + '" placeholder="输入框里的灰字提示">'
      + '<label>补充说明</label><input id="fxE_hint" value="' + esc(f.hint || '') + '" placeholder="字段下方的小字说明">'
      + '<label>是否必填</label><span><input type="checkbox" id="fxE_req"' + (f.required ? ' checked' : '') + '> 必填</span>'
      + '<label>字段标识</label><input id="fxE_key" value="' + esc(f.key) + '" placeholder="英文/拼音，保存数据用，建议不要改">'
      + '</div>'
      + '<div class="fx-dedit-f">'
      + '<button class="fx-btn" onclick="FIELDS.dzCancelEdit()">取消</button>'
      + '<button class="fx-btn fx-btn-p" onclick="FIELDS.dzSaveEdit(' + i + ')">确定</button>'
      + '</div></div>';
  }

  function dzAdd() {
    var n = _draft.length + 1;
    _draft.push({
      key: 'f' + Date.now().toString(36),
      label: '新项目 ' + n, type: 'text', dict: '', options: [],
      required: false, enabled: true, placeholder: '', readonly: false, hint: ''
    });
    _editIdx = _draft.length - 1;
    renderDesigner();
  }

  function dzEdit(i) { _editIdx = i; renderDesigner(); }
  function dzCancelEdit() { _editIdx = -1; renderDesigner(); }
  function dzTypeChange() { /* 类型变化时无需立刻重渲染，保存时读取 */ }

  function dzSaveEdit(i) {
    var f = _draft[i];
    var label = ($('fxE_label') || {}).value || '';
    if (!label.trim()) { alert('请填写项目名称'); return; }
    f.label = label.trim();
    f.type = ($('fxE_type') || {}).value || 'text';
    f.dict = ($('fxE_dict') || {}).value || '';
    f.placeholder = ($('fxE_ph') || {}).value || '';
    f.hint = ($('fxE_hint') || {}).value || '';
    f.required = !!($('fxE_req') || {}).checked;
    var k = (($('fxE_key') || {}).value || '').trim();
    if (k) f.key = k;
    if (f.type === 'radio') {
      var raw = (($('fxE_radio') || {}).value || '').trim();
      if (raw) {
        f.options = raw.split(',').map(function (seg) {
          seg = seg.trim();
          if (!seg) return null;
          var p = seg.split('=');
          return p.length > 1 ? [p[0].trim(), p[1].trim()] : [seg, seg];
        }).filter(Boolean);
      }
    } else if (f.type !== 'radio') {
      f.options = [];
    }
    _editIdx = -1;
    renderDesigner();
  }

  function dzDel(i) {
    if (!confirm('删除项目「' + _draft[i].label + '」？（保存后生效）')) return;
    _draft.splice(i, 1);
    if (_editIdx === i) _editIdx = -1;
    renderDesigner();
  }
  function dzUp(i) {
    if (i <= 0) return;
    var t = _draft[i - 1]; _draft[i - 1] = _draft[i]; _draft[i] = t;
    if (_editIdx === i) _editIdx = i - 1; else if (_editIdx === i - 1) _editIdx = i;
    renderDesigner();
  }
  function dzDown(i) {
    if (i >= _draft.length - 1) return;
    var t = _draft[i + 1]; _draft[i + 1] = _draft[i]; _draft[i] = t;
    if (_editIdx === i) _editIdx = i + 1; else if (_editIdx === i + 1) _editIdx = i;
    renderDesigner();
  }
  function dzToggle(i) {
    _draft[i].enabled = _draft[i].enabled === false;
    renderDesigner();
  }
  function dzReset() {
    if (!confirm('恢复成系统默认的项目配置？你已做的增删改会被覆盖。')) return;
    FD.reset(_module);
    _draft = FD.get(_module);
    _editIdx = -1;
    renderDesigner();
  }
  function dzOk() {
    var keys = _draft.map(function (f) { return f.key; });
    var dup = keys.filter(function (k, i) { return keys.indexOf(k) !== i; });
    if (dup.length) { alert('字段标识重复：' + dup.join('、') + '，请改成不同的'); return; }
    FD.save(_module, _draft);
    closeDesigner();
    if (typeof window.fxOnFieldsSaved === 'function') { try { window.fxOnFieldsSaved(_module); } catch (e) {} }
  }

  /* ==================== 下拉选项管理 ==================== */
  function ensureDictShell() {
    if ($('fxDictBox')) return;
    var box = el('div', 'fx-drawer fx-drawer2');
    box.id = 'fxDictBox';
    box.innerHTML = '<div class="fx-dhead"><b id="fxDictTitle">下拉选项</b><span class="fx-x" onclick="FIELDS.closeDict()">✕</span></div>'
      + '<div class="fx-dbody" id="fxDictBody"></div>'
      + '<div class="fx-dfoot"><span class="fx-tip">改完直接生效，所有用到该下拉的表单都会同步</span>'
      + '<button class="fx-btn fx-btn-p" onclick="FIELDS.closeDict()">完成</button></div>';
    document.body.appendChild(box);
  }

  function openDictManager() {
    ensureDictShell();
    _dictMode = 'list';
    _dictName = '';
    renderDict();
    $('fxDictBox').classList.add('show');
  }
  function closeDict() {
    var b = $('fxDictBox');
    if (b) b.classList.remove('show');
    if (_dictMode === 'one') { openDictManager(); return; }
  }
  var _dictMode = 'list', _dictName = '';

  function renderDict() {
    var t = $('fxDictTitle'), body = $('fxDictBody');
    if (_dictMode === 'list') {
      t.textContent = '下拉选项库';
      var d = FD.dicts();
      var names = Object.keys(d);
      var h = '<div class="fx-dtools"><button class="fx-btn fx-btn-p" onclick="FIELDS.dictAddNew()">＋ 新建下拉</button>'
        + '<span class="fx-dcount">共 ' + names.length + ' 组</span></div><div class="fx-dictlist">';
      names.forEach(function (n) {
        h += '<div class="fx-dictitem"><span class="fx-dictname">' + esc(n) + '</span>'
          + '<span class="fx-dictcnt">' + d[n].length + ' 项</span>'
          + '<span class="fx-dictopts">' + esc(d[n].slice(0, 6).join('、')) + (d[n].length > 6 ? ' …' : '') + '</span>'
          + '<span class="fx-dacts"><a onclick="FIELDS.dictOpen(\'' + esc(n).replace(/'/g, "\\'") + '\')">编辑选项</a>'
          + '<a onclick="FIELDS.dictRename(\'' + esc(n).replace(/'/g, "\\'") + '\')">改名</a>'
          + '<a class="del" onclick="FIELDS.dictDel(\'' + esc(n).replace(/'/g, "\\'") + '\')">删除</a></span></div>';
      });
      h += '</div>';
      body.innerHTML = h;
      return;
    }
    // 单个下拉的选项编辑
    t.textContent = '编辑下拉：' + _dictName;
    var opts = FD.dict(_dictName);
    var h2 = '<div class="fx-dtools"><button class="fx-btn" onclick="FIELDS.openDictManager()">← 返回列表</button>'
      + '<button class="fx-btn fx-btn-p" onclick="FIELDS.dictOptAdd()">＋ 新增选项</button></div>';
    h2 += '<div class="fx-optlist">';
    if (!opts.length) h2 += '<div class="fx-empty">还没有选项</div>';
    opts.forEach(function (o, i) {
      h2 += '<div class="fx-optitem">'
        + '<input class="fx-optinput" value="' + esc(o) + '" onchange="FIELDS.dictOptSave(' + i + ', this.value)">'
        + '<span class="fx-dacts"><a onclick="FIELDS.dictOptUp(' + i + ')">↑</a>'
        + '<a onclick="FIELDS.dictOptDown(' + i + ')">↓</a>'
        + '<a class="del" onclick="FIELDS.dictOptDel(' + i + ')">删除</a></span></div>';
    });
    h2 += '</div>';
    body.innerHTML = h2;
  }

  function dictOpen(name) { _dictMode = 'one'; _dictName = name; renderDict(); }
  function dictAddNew() {
    var n = prompt('新下拉名称（如「不良现象」「客户类型」）：');
    if (!n || !n.trim()) return;
    n = n.trim();
    FD.setDict(n, []);
    dictOpen(n);
  }
  function dictRename(name) {
    var n = prompt('把「' + name + '」改成：', name);
    if (!n || !n.trim() || n === name) return;
    FD.renameDict(name, n.trim());
    renderDict();
  }
  function dictDel(name) {
    if (!confirm('删除下拉「' + name + '」？（用它的字段会变成普通文本输入）')) return;
    FD.delDict(name);
    renderDict();
  }
  function dictOptAdd() {
    var v = prompt('新增选项内容：');
    if (!v || !v.trim()) return;
    var arr = FD.dict(_dictName);
    arr.push(v.trim());
    FD.setDict(_dictName, arr);
    renderDict();
  }
  function dictOptSave(i, v) {
    var arr = FD.dict(_dictName);
    if (!v.trim()) { arr.splice(i, 1); } else { arr[i] = v.trim(); }
    FD.setDict(_dictName, arr);
    renderDict();
  }
  function dictOptDel(i) {
    var arr = FD.dict(_dictName);
    arr.splice(i, 1);
    FD.setDict(_dictName, arr);
    renderDict();
  }
  function dictOptUp(i) {
    if (i <= 0) return;
    var arr = FD.dict(_dictName);
    var t = arr[i - 1]; arr[i - 1] = arr[i]; arr[i] = t;
    FD.setDict(_dictName, arr);
    renderDict();
  }
  function dictOptDown(i) {
    var arr = FD.dict(_dictName);
    if (i >= arr.length - 1) return;
    var t = arr[i + 1]; arr[i + 1] = arr[i]; arr[i] = t;
    FD.setDict(_dictName, arr);
    renderDict();
  }

  /* ==================== 样式 ==================== */
  var CSS2 = [
    '.fx-mask{position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:9400;display:none}',
    '.fx-mask.show{display:block}',
    '.fx-drawer{position:fixed;top:0;right:0;height:100%;width:620px;max-width:100%;background:#fff;z-index:9500;display:none;flex-direction:column;box-shadow:-4px 0 24px rgba(0,0,0,.15)}',
    '.fx-drawer.show{display:flex}',
    '.fx-drawer2{width:520px;z-index:9600}',
    '.fx-dhead{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:16px;color:#111827}',
    '.fx-x{cursor:pointer;color:#9ca3af;font-size:18px;padding:0 6px}',
    '.fx-dbody{flex:1;overflow:auto;padding:14px 18px;background:#f9fafb}',
    '.fx-dfoot{display:flex;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid #e5e7eb;justify-content:flex-end;background:#fff}',
    '.fx-dtools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}',
    '.fx-dcount{color:#9ca3af;font-size:12px;margin-left:auto}',
    '.fx-empty{background:#fff;border:1px dashed #d1d5db;border-radius:8px;padding:26px;text-align:center;color:#9ca3af;font-size:13px}',
    '.fx-ditem{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:13px}',
    '.fx-ditem.off{opacity:.5}',
    '.fx-order{width:22px;height:22px;line-height:22px;text-align:center;background:#eef7f1;color:#2d7a4f;border-radius:5px;font-size:12px;flex:0 0 auto}',
    '.fx-dname{font-weight:600;color:#111827;flex:0 0 auto}',
    '.fx-rdot{color:#dc2626;font-style:normal}',
    '.fx-dtype{color:#6b7280;font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.fx-dacts{display:flex;gap:9px;flex:0 0 auto;align-items:center}',
    '.fx-dacts a{color:#2d7a4f;cursor:pointer;font-size:12px;text-decoration:none}',
    '.fx-dacts a.del{color:#dc2626}',
    '.fx-dedit{background:#fff;border:1px solid #2d7a4f;border-radius:8px;padding:12px;margin-bottom:8px}',
    '.fx-dedit-h{font-weight:600;color:#2d7a4f;margin-bottom:10px;font-size:13px}',
    '.fx-grid{display:grid;grid-template-columns:96px 1fr;gap:8px 10px;align-items:center;font-size:13px}',
    '.fx-grid label{color:#374151;text-align:right}',
    '.fx-grid input[type=text],.fx-grid input,.fx-grid select{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-family:inherit}',
    '.fx-dedit-f{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}',
    '.fx-dictlist,.fx-optlist{display:block}',
    '.fx-dictitem{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:13px}',
    '.fx-dictname{font-weight:600;color:#111827;flex:0 0 auto;min-width:96px}',
    '.fx-dictcnt{color:#2d7a4f;background:#eef7f1;border-radius:5px;padding:1px 7px;font-size:12px;flex:0 0 auto}',
    '.fx-dictopts{color:#9ca3af;font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.fx-optitem{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;margin-bottom:7px}',
    '.fx-optinput{flex:1;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-family:inherit}',
    '@media(max-width:768px){.fx-drawer{width:100%}.fx-drawer2{width:100%}.fx-grid{grid-template-columns:1fr}.fx-grid label{text-align:left}}'
  ].join('\n');
  (function inject2() {
    if (document.getElementById('fxUiStyle')) return;
    var s = document.createElement('style');
    s.id = 'fxUiStyle';
    s.textContent = CSS2;
    (document.head || document.documentElement).appendChild(s);
  })();

  /* ==================== 挂载 ==================== */
  FD.openDesigner = openDesigner;
  FD.closeDesigner = closeDesigner;
  FD.dzAdd = dzAdd; FD.dzEdit = dzEdit; FD.dzCancelEdit = dzCancelEdit;
  FD.dzSaveEdit = dzSaveEdit; FD.dzDel = dzDel; FD.dzUp = dzUp; FD.dzDown = dzDown;
  FD.dzToggle = dzToggle; FD.dzReset = dzReset; FD.dzOk = dzOk; FD.dzTypeChange = dzTypeChange;
  FD.openDictManager = openDictManager; FD.closeDict = closeDict;
  FD.dictOpen = dictOpen; FD.dictAddNew = dictAddNew; FD.dictRename = dictRename; FD.dictDel = dictDel;
  FD.dictOptAdd = dictOptAdd; FD.dictOptSave = dictOptSave; FD.dictOptDel = dictOptDel;
  FD.dictOptUp = dictOptUp; FD.dictOptDown = dictOptDown;
})();
