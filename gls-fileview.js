/* ============================================================
   gls-fileview.js —— 原文件存取 + 1:1 预览（零依赖）
   · 文件本体存 IndexedDB，字节级原封不动，可下载 / 打印
   · xlsx / xls / docx：自己解 zip + XML，保住合并单元格、列宽行高、字体边框底色
   · pdf：交给浏览器内置阅读器；图片：直接显示
   · 不依赖任何外网 CDN
   ============================================================ */
(function () {
  'use strict';

  var DB_NAME = 'gls_files_db', STORE = 'files', DB_VER = 1, _dbp = null;

  function openDB() {
    if (_dbp) return _dbp;
    _dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('此浏览器不支持本地文件库')); return; }
      var rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = function () {
        var d = rq.result;
        if (!d.objectStoreNames.contains(STORE)) {
          var s = d.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('name', 'name', { unique: false });
        }
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error || new Error('本地文件库打开失败')); };
    });
    return _dbp;
  }
  function storeOf(mode) {
    return openDB().then(function (d) { return d.transaction(STORE, mode).objectStore(STORE); });
  }
  function wrap(req) {
    return new Promise(function (res, rej) {
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }

  var FV = {};
  window.FV = FV;

  /* ================= 存取 ================= */
  FV.put = function (rec) { return storeOf('readwrite').then(function (s) { return wrap(s.put(rec)); }); };
  FV.get = function (id) { return storeOf('readonly').then(function (s) { return wrap(s.get(id)); }); };
  FV.del = function (id) { return storeOf('readwrite').then(function (s) { return wrap(s.delete(id)); }); };
  FV.all = function () { return storeOf('readonly').then(function (s) { return wrap(s.getAll()); }); };
  FV.count = function () { return storeOf('readonly').then(function (s) { return wrap(s.count()); }); };
  FV.byName = function (name) {
    return storeOf('readonly').then(function (s) {
      return wrap(s.getAll());
    }).then(function (a) {
      var hit = null;
      (a || []).forEach(function (x) { if (x.name === name) hit = x; });
      return hit;
    });
  };
  FV.uid = function () { return 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); };

  FV.saveFile = function (file) {
    var rec = {
      id: FV.uid(), name: file.name, type: file.type || '',
      size: file.size, mtime: Date.now(), ext: (file.name.split('.').pop() || '').toLowerCase(),
      blob: file
    };
    return FV.put(rec).then(function () { return rec; });
  };

  FV.blobUrl = function (blob) { return URL.createObjectURL(blob); };

  /* ================= zip 解析 ================= */
  function dv16(dv, p) { return dv.getUint16(p, true); }
  function dv32(dv, p) { return dv.getUint32(p, true); }

  function Zip(dv, u8, files) { this.dv = dv; this.u8 = u8; this.files = files; }

  Zip.prototype.raw = function (name) {
    var f = this.files[name];
    if (!f) return null;
    var lho = f.lho, dv = this.dv;
    var nlen = dv16(dv, lho + 26), elen = dv16(dv, lho + 28);
    var start = lho + 30 + nlen + elen;
    return this.u8.subarray(start, start + f.csize);
  };

  Zip.prototype.read = function (name) {
    var f = this.files[name];
    if (!f) return Promise.resolve(null);
    var raw = this.raw(name);
    if (!raw) return Promise.resolve(null);
    if (f.method === 0) return Promise.resolve(raw);
    if (f.method !== 8) return Promise.reject(new Error('不支持的压缩方式 ' + f.method));
    if (typeof DecompressionStream !== 'function') {
      return Promise.reject(new Error('此浏览器不支持解压（请用 Chrome / Edge 103 以上，或新版手机浏览器）'));
    }
    try {
      var ds = new DecompressionStream('deflate-raw');
      var w = ds.writable.getWriter();
      w.write(raw); w.close();
      return new Response(ds.readable).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    } catch (e) {
      return Promise.reject(e);
    }
  };

  Zip.prototype.text = function (name) {
    return this.read(name).then(function (u8) { return u8 ? new TextDecoder('utf-8').decode(u8) : ''; });
  };
  Zip.prototype.has = function (name) { return !!this.files[name]; };
  Zip.prototype.list = function () { return Object.keys(this.files); };

  FV.unzip = function (blob) {
    return blob.arrayBuffer().then(function (ab) {
      var u8 = new Uint8Array(ab), dv = new DataView(ab), n = u8.length, i;
      var eocd = -1;
      for (i = n - 22; i >= Math.max(0, n - 66000); i--) {
        if (dv32(dv, i) === 0x06054b50) { eocd = i; break; }
      }
      if (eocd < 0) throw new Error('文件结构异常（不是有效的 zip / xlsx / docx）');
      var cnt = dv16(dv, eocd + 10), cd = dv32(dv, eocd + 16), p = cd, files = {};
      for (i = 0; i < cnt; i++) {
        if (p + 46 > n || dv32(dv, p) !== 0x02014b50) break;
        var method = dv16(dv, p + 10), csize = dv32(dv, p + 20);
        var nlen = dv16(dv, p + 28), elen = dv16(dv, p + 30), clen = dv16(dv, p + 32);
        var lho = dv32(dv, p + 42);
        var nm = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nlen));
        files[nm] = { method: method, csize: csize, lho: lho };
        p += 46 + nlen + elen + clen;
      }
      return new Zip(dv, u8, files);
    });
  };

  /* ================= XML 小工具 ================= */
  function parseXml(s) { return new DOMParser().parseFromString(s || '', 'application/xml'); }
  function list(node, tag) { return Array.prototype.slice.call((node || document).getElementsByTagName(tag)); }
  function first(node, tag) { var a = list(node, tag); return a.length ? a[0] : null; }
  function txt(node) { return node ? (node.textContent || '') : ''; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  FV.esc = esc;

  /* ================= xlsx ================= */
  function colToNum(ref) {
    var m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return 0;
    var s = m[1], v = 0;
    for (var i = 0; i < s.length; i++) { v = v * 26 + (s.charCodeAt(i) - 64); }
    return v;
  }
  function rowOf(ref) { var m = /(\d+)/.exec(ref || ''); return m ? parseInt(m[1], 10) : 0; }

  function sharedStrings(xml) {
    var out = [];
    if (!xml) return out;
    list(parseXml(xml), 'si').forEach(function (si) {
      var ts = list(si, 't'), s = '';
      ts.forEach(function (t) { s += txt(t); });
      out.push(s);
    });
    return out;
  }

  /* 样式：字体 / 填充 / 边框 / 对齐 / 数字格式 */
  function styles(xml) {
    var st = { numFmt: {}, fonts: [], fills: [], borders: [], xfs: [] };
    if (!xml) return st;
    var d = parseXml(xml);
    list(d, 'numFmt').forEach(function (f) {
      var id = f.getAttribute('numFmtId'), code = f.getAttribute('formatCode') || '';
      if (id != null) st.numFmt[id] = code;
    });
    var fonts = first(d, 'fonts');
    if (fonts) list(fonts, 'font').forEach(function (f) {
      var o = { b: !!first(f, 'b'), i: !!first(f, 'i'), u: !!first(f, 'u') };
      var sz = first(f, 'sz'); if (sz) o.sz = parseFloat(sz.getAttribute('val')) || 11;
      var nm = first(f, 'name'); if (nm) o.ff = nm.getAttribute('val') || '';
      var c = first(f, 'color');
      if (c) { o.col = c.getAttribute('rgb') || c.getAttribute('theme') || ''; o.theme = c.getAttribute('theme'); }
      st.fonts.push(o);
    });
    var fills = first(d, 'fills');
    if (fills) list(fills, 'fill').forEach(function (f) {
      var pf = first(f, 'patternFill'), o = { type: '' };
      if (pf) {
        o.type = (pf.getAttribute('patternType') || '').toLowerCase();
        var fg = first(pf, 'fgColor');
        if (fg) o.fg = fg.getAttribute('rgb') || '';
      }
      st.fills.push(o);
    });
    var bos = first(d, 'borders');
    if (bos) list(bos, 'border').forEach(function (b) {
      var o = {};
      ['left', 'right', 'top', 'bottom'].forEach(function (side) {
        var e = first(b, side);
        if (e) { o[side] = e.getAttribute('style') || ''; }
      });
      st.borders.push(o);
    });
    var xfs = first(d, 'cellXfs');
    if (xfs) list(xfs, 'xf').forEach(function (x) {
      st.xfs.push({
        f: x.getAttribute('fontId'), fill: x.getAttribute('fillId'),
        bd: x.getAttribute('borderId'), nf: x.getAttribute('numFmtId'),
        wrap: (function () { var a = first(x, 'alignment'); return a ? (a.getAttribute('wrapText') === '1') : false; })(),
        ha: (function () { var a = first(x, 'alignment'); return a ? (a.getAttribute('horizontal') || '') : ''; })(),
        va: (function () { var a = first(x, 'alignment'); return a ? (a.getAttribute('vertical') || '') : ''; })()
      });
    });
    return st;
  }
  FV._styles = styles;

  function argb(c) {
    if (!c) return '';
    c = String(c).replace(/^#/, '');
    if (/^[0-9a-fA-F]{8}$/.test(c)) c = c.slice(2);
    if (/^[0-9a-fA-F]{6}$/.test(c)) return '#' + c;
    return '';
  }

  function styleToCss(xf, st) {
    if (!xf) return '';
    var css = [];
    var fo = st.fonts[Number(xf.f)] || {};
    if (fo.b) css.push('font-weight:700');
    if (fo.i) css.push('font-style:italic');
    if (fo.u) css.push('text-decoration:underline');
    if (fo.sz) css.push('font-size:' + fo.sz + 'pt');
    if (fo.ff) css.push("font-family:'" + fo.ff + "',微软雅黑,Arial,sans-serif");
    var fc = argb(fo.col);
    if (fc) css.push('color:' + fc);
    var fi = st.fills[Number(xf.fill)] || {};
    if (fi.type && fi.type !== 'none') {
      var bg = argb(fi.fg);
      if (bg) css.push('background:' + bg);
    }
    var bd = st.borders[Number(xf.bd)] || {};
    ['left', 'right', 'top', 'bottom'].forEach(function (s) {
      if (bd[s]) css.push('border-' + s + ':1px solid #000');
    });
    if (xf.wrap) css.push('white-space:pre-wrap');
    if (xf.ha) css.push('text-align:' + ({ center: 'center', right: 'right', left: 'left' }[xf.ha] || xf.ha));
    if (xf.va) css.push('vertical-align:' + ({ center: 'middle', top: 'top', bottom: 'bottom' }[xf.va] || xf.va));
    return css.join(';');
  }
  FV._styleToCss = styleToCss;

  function numFmtFor(xf, st) {
    if (!xf || !xf.nf) return '';
    var builtin = {
      0: '', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
      9: '0%', 10: '0.00%', 14: 'yyyy/m/d', 22: 'yyyy/m/d h:mm',
      37: '#,##0;-#,##0', 38: '#,##0;[红色]-#,##0', 49: '@'
    };
    return st.numFmt[xf.nf] || builtin[xf.nf] || '';
  }
  FV._numFmtFor = numFmtFor;

  function fmtVal(v, xf, st) {
    if (v == null || v === '') return '';
    var f = numFmtFor(xf, st);
    if (f) {
      var num = Number(v);
      if (!isNaN(num) && String(v).trim() !== '') {
        if (/%/.test(f)) return (num * 100).toFixed((f.match(/0\.(0+)/) || [0, ''])[1].length) + '%';
        if (/[yYmMdD]/.test(f) && num > 20000 && num < 80000) {
          var d = new Date(Date.UTC(1899, 11, 30) + num * 86400000);
          var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
          if (/h/.test(f)) return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes());
          return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
        }
        if (/#,##/.test(f)) return num.toLocaleString('en-US', { minimumFractionDigits: (f.match(/\.(0+)/) || [0, ''])[1].length });
        return String(num);
      }
    }
    return String(v);
  }
  FV._fmtVal = fmtVal;

  function sheetList(zip) {
    return Promise.all([zip.text('xl/workbook.xml'), zip.text('xl/_rels/workbook.xml.rels')])
      .then(function (r) {
        var wb = parseXml(r[0]), rels = parseXml(r[1]);
        var map = {};
        list(rels, 'Relationship').forEach(function (x) {
          map[x.getAttribute('Id')] = x.getAttribute('Target');
        });
        var out = [];
        list(wb, 'sheet').forEach(function (s) {
          var rid = s.getAttribute('r:id') || s.getAttribute('id') || s.getAttribute('sheetId');
          var tgt = map[rid] || '';
          /* Target 可能是 /xl/worksheets/sheet1.xml、worksheets/sheet1.xml、xl/... 三种写法 */
          tgt = String(tgt).replace(/^\.\//, '');
          if (tgt.charAt(0) === '/') tgt = tgt.slice(1);
          if (tgt.indexOf('xl/') !== 0) tgt = 'xl/' + tgt;
          out.push({ name: s.getAttribute('name') || 'Sheet', path: tgt });
        });
        return out;
      });
  }

  function renderSheetXml(xml, ss, st) {
    if (!xml) return '<p style="color:#888">（空表）</p>';
    var d = parseXml(xml);
    /* 列宽 */
    var colW = {};
    list(d, 'col').forEach(function (c) {
      var mn = parseInt(c.getAttribute('min') || '0', 10);
      var mx = parseInt(c.getAttribute('max') || '0', 10);
      var w = parseFloat(c.getAttribute('width') || '0');
      if (!w && c.getAttribute('customWidth') !== '1') {
        var cw = c.getAttribute('width'); w = cw ? parseFloat(cw) : 0;
      }
      for (var k = mn; k <= mx && k - mn < 200; k++) colW[k] = w;
    });
    /* 合并 */
    var merges = [];
    var mc = first(d, 'mergeCells');
    if (mc) list(mc, 'mergeCell').forEach(function (m) {
      var ref = m.getAttribute('ref') || '';
      var parts = ref.split(':');
      if (parts.length === 2) merges.push(parts);
    });
    var mergeSet = {}, mergeHide = {};
    merges.forEach(function (mm) {
      var c1 = colToNum(mm[0]), r1 = rowOf(mm[0]), c2 = colToNum(mm[1]), r2 = rowOf(mm[1]);
      mergeSet[r1 + '_' + c1] = { rs: r2 - r1 + 1, cs: c2 - c1 + 1 };
      for (var r = r1; r <= r2; r++) for (var c = c1; c <= c2; c++) {
        if (r !== r1 || c !== c1) mergeHide[r + '_' + c] = 1;
      }
    });
    /* 单元格 */
    var grid = {}, maxR = 0, maxC = 0;
    list(d, 'row').forEach(function (row) {
      var r = parseInt(row.getAttribute('r') || '0', 10);
      if (!r) return;
      var ht = parseFloat(row.getAttribute('ht') || '0');
      grid['__h' + r] = ht;
      list(row, 'c').forEach(function (c) {
        var ref = c.getAttribute('r') || '';
        var cc = colToNum(ref) || 0;
        if (!cc) return;
        var t = c.getAttribute('t') || '', v = first(c, 'v'), isv = first(c, 'is');
        var val = '';
        if (isv) {
          /* inlineStr：<is><t>…</t></is>，可能被拆成多个 <t> 或 <r><t> */
          var _ts = isv.getElementsByTagName('t'), _s = '';
          for (var _k = 0; _k < _ts.length; _k++) { _s += (_ts[_k].textContent || ''); }
          val = _s || (isv.textContent || '');
        } else if (t === 's') {
          var si = parseInt(txt(v) || '-1', 10);
          val = (si >= 0 && ss[si] != null) ? ss[si] : (txt(v) || '');
        } else {
          val = txt(v);
        }
        var sidx = parseInt(c.getAttribute('s') || '0', 10) || 0;
        grid[r + '_' + cc] = { v: val, xf: st.xfs[sidx] || null };
        if (r > maxR) maxR = r;
        if (cc > maxC) maxC = cc;
      });
    });
    if (!maxC) return '<p style="color:#888">（空表）</p>';
    var html = ['<table class="fv-xlsx" style="border-collapse:collapse;table-layout:fixed;font-size:11pt;">'];
    html.push('<colgroup>');
    for (var c2 = 1; c2 <= maxC; c2++) {
      var w2 = colW[c2];
      var px = w2 ? Math.round(w2 * 7 + 5) : 64;
      html.push('<col style="width:' + px + 'px">');
    }
    html.push('</colgroup><tbody>');
    var emptyCss = 'border:1px solid #d0d7de;';
    for (var r2 = 1; r2 <= maxR; r2++) {
      var hs = grid['__h' + r2];
      html.push('<tr' + (hs ? ' style="height:' + Math.round(hs * 1.33) + 'px"' : '') + '>');
      for (var cc2 = 1; cc2 <= maxC; cc2++) {
        if (mergeHide[r2 + '_' + cc2]) continue;
        var cell = grid[r2 + '_' + cc2];
        var m2 = mergeSet[r2 + '_' + cc2];
        var css = (cell ? styleToCss(cell.xf, st) : '') || '';
        css = emptyCss + (css ? ';' + css : '');
        var span = '';
        if (m2) {
          if (m2.rs > 1) span += ' rowspan="' + m2.rs + '"';
          if (m2.cs > 1) span += ' colspan="' + m2.cs + '"';
        }
        var body = cell ? esc(fmtVal(cell.v, cell.xf, st)) : '';
        html.push('<td' + span + ' style="' + css + '">' + body + '</td>');
      }
      html.push('</tr>');
    }
    html.push('</tbody></table>');
    return html.join('');
  }
  FV._renderSheetXml = renderSheetXml;

  FV.xlsxToHtml = function (blob) {
    return FV.unzip(blob).then(function (zip) {
      return Promise.all([
        zip.text('xl/sharedStrings.xml'),
        zip.text('xl/styles.xml'),
        sheetList(zip)
      ]).then(function (r) {
        var ss = sharedStrings(r[0]), st = styles(r[1]), sheets = r[2];
        if (!sheets.length) return '<p style="color:#888">未找到工作表</p>';
        return Promise.all(sheets.map(function (sh) {
          return zip.text(sh.path).then(function (xml) {
            return { name: sh.name, html: renderSheetXml(xml, ss, st) };
          });
        })).then(function (arr) {
          if (arr.length === 1) return '<div class="fv-sheetname">' + esc(arr[0].name) + '</div>' + arr[0].html;
          var tabs = arr.map(function (a, i) {
            return '<button class="fv-tab' + (i ? '' : ' on') + '" onclick="FV.tab(this,' + i + ')">' + esc(a.name) + '</button>';
          }).join('');
          var panes = arr.map(function (a, i) {
            return '<div class="fv-pane" data-i="' + i + '" style="' + (i ? 'display:none' : '') + '">' + a.html + '</div>';
          }).join('');
          return '<div class="fv-tabs">' + tabs + '</div><div class="fv-panes">' + panes + '</div>';
        });
      });
    });
  };

  FV.tab = function (btn, i) {
    var wrap = btn.parentNode.parentNode;
    var bs = wrap.querySelectorAll('.fv-tab');
    for (var k = 0; k < bs.length; k++) bs[k].classList.remove('on');
    btn.classList.add('on');
    var ps = wrap.querySelectorAll('.fv-pane');
    for (var j = 0; j < ps.length; j++) ps[j].style.display = (String(i) === ps[j].getAttribute('data-i')) ? '' : 'none';
  };

  /* ================= docx ================= */
  function runHtml(r) {
    var t = first(r, 'w:t');
    var s = '';
    list(r, 'w:t').forEach(function (x) { s += txt(x); });
    if (!s && first(r, 'w:br')) s = '\n';
    if (!s && first(r, 'w:tab')) s = '\u3000\u3000';
    if (!s) return '';
    var pr = first(r, 'w:rPr'), css = [];
    if (pr) {
      if (first(pr, 'w:b')) css.push('font-weight:700');
      if (first(pr, 'w:i')) css.push('font-style:italic');
      if (first(pr, 'w:u')) css.push('text-decoration:underline');
      var sz = first(pr, 'w:sz');
      if (sz) css.push('font-size:' + (parseInt(sz.getAttribute('w:val') || '21', 10) / 2) + 'pt');
      var col = first(pr, 'w:color');
      if (col) { var cv = argb(col.getAttribute('w:val')); if (cv) css.push('color:' + cv); }
      var rf = first(pr, 'w:rFonts');
      if (rf) { var fn = rf.getAttribute('w:eastAsia') || rf.getAttribute('w:ascii'); if (fn) css.push("font-family:'" + fn + "',微软雅黑,Arial,sans-serif"); }
    }
    return css.length ? '<span style="' + css.join(';') + '">' + esc(s) + '</span>' : esc(s);
  }

  function paraHtml(p) {
    var pr = first(p, 'w:pPr'), css = [], tag = 'p';
    var jc = pr ? first(pr, 'w:jc') : null;
    if (jc) {
      var v = jc.getAttribute('w:val') || '';
      css.push('text-align:' + ({ center: 'center', right: 'right', both: 'justify' }[v] || 'left'));
    }
    var ind = pr ? first(pr, 'w:ind') : null;
    if (ind) {
      var l = ind.getAttribute('w:left') || ind.getAttribute('w:start');
      if (l) css.push('margin-left:' + Math.round(parseInt(l, 10) / 20) + 'pt');
    }
    var sp = pr ? first(pr, 'w:spacing') : null;
    if (sp) {
      var aft = sp.getAttribute('w:after');
      if (aft) css.push('margin-bottom:' + Math.round(parseInt(aft, 10) / 20) + 'pt');
    }
    var ph = pr ? first(pr, 'w:pStyle') : null;
    var styleName = ph ? (ph.getAttribute('w:val') || '') : '';
    if (/^Heading([1-6])$/.test(styleName) || /^\d$/.test(styleName)) {
      tag = 'h' + (/^Heading([1-6])$/.exec(styleName) ? RegExp.$1 : styleName);
    }
    var inner = '';
    list(p, 'w:r').forEach(function (r) { inner += runHtml(r); });
    var st2 = css.length ? ' style="' + css.join(';') + '"' : '';
    if (!inner) return '<' + tag + st2 + '>&nbsp;</' + tag + '>';
    return '<' + tag + st2 + '>' + inner + '</' + tag + '>';
  }

  function tableHtml(tbl) {
    var rows = list(tbl, 'w:tr'), out = ['<table class="fv-docx">'];
    rows.forEach(function (tr) {
      out.push('<tr>');
      list(tr, 'w:tc').forEach(function (tc) {
        var pr = first(tc, 'w:tcPr');
        var span = pr ? first(pr, 'w:gridSpan') : null;
        var cs = span ? parseInt(span.getAttribute('w:val') || '1', 10) : 1;
        var vm = pr ? first(pr, 'w:vMerge') : null;
        var vmAttr = '';
        if (vm) vmAttr = ' data-vm="' + (vm.getAttribute('w:val') || 'cont') + '"';
        var wpr = pr ? first(pr, 'w:tcW') : null;
        var wAttr = '';
        if (wpr) {
          var tw = parseInt(wpr.getAttribute('w:w') || '0', 10);
          if (tw > 0) wAttr = ' style="width:' + Math.round(tw / 20) + 'pt"';
        }
        var inner = '';
        list(tc, 'w:p').forEach(function (p) { inner += paraHtml(p); });
        if (!inner) inner = '&nbsp;';
        out.push('<td' + (cs > 1 ? ' colspan="' + cs + '"' : '') + wAttr + vmAttr + '>' + inner + '</td>');
      });
      out.push('</tr>');
    });
    out.push('</table>');
    return out.join('');
  }

  FV.docxToHtml = function (blob) {
    return FV.unzip(blob).then(function (zip) {
      return zip.text('word/document.xml').then(function (xml) {
        if (!xml) return '<p style="color:#888">文档内容为空</p>';
        var d = parseXml(xml);
        var body = first(d, 'w:body');
        if (!body) return '<p style="color:#888">文档内容为空</p>';
        var out = [];
        Array.prototype.slice.call(body.childNodes).forEach(function (nd) {
          if (nd.nodeType !== 1) return;
          var tag = nd.tagName || '';
          if (/w:p$/.test(tag)) out.push(paraHtml(nd));
          else if (/w:tbl$/.test(tag)) out.push(tableHtml(nd));
        });
        return out.length ? out.join('') : '<p style="color:#888">文档内容为空</p>';
      });
    });
  };

  /* ================= xls（老格式）：借 SheetJS 解，自己出 HTML ================= */
  FV.xlsToHtml = function (blob) {
    if (!window.XLSX) {
      return Promise.resolve('<div class="fv-note">这是老版 <b>.xls</b> 格式，当前环境没能加载解析器。<br>'
        + '点下方「⬇ 下载原文件」用 WPS / Excel 打开即为<b>原样</b>；'
        + '若要在网页里看内容，建议在 WPS 里另存为 <b>.xlsx</b> 再上传。</div>');
    }
    return blob.arrayBuffer().then(function (ab) {
      var wb = XLSX.read(new Uint8Array(ab), { type: 'array', cellStyles: false, cellDates: true });
      var names = wb.SheetNames || [];
      if (!names.length) return '<p style="color:#888">未找到工作表</p>';
      var panes = names.map(function (nm, i) {
        var ws = wb.Sheets[nm];
        var ref = ws['!ref'] || 'A1:A1';
        var rng = XLSX.utils.decode_range(ref);
        var merges = (ws['!merges'] || []).map(function (m) {
          return [XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c }), XLSX.utils.encode_cell({ r: m.e.r, c: m.e.c })];
        });
        var cols = ws['!cols'] || [];
        var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true });
        var h = ['<table class="fv-xlsx" style="border-collapse:collapse;table-layout:fixed;font-size:11pt;">'];
        h.push('<colgroup>');
        for (var c = rng.s.c; c <= rng.e.c; c++) {
          var w = cols[c] && cols[c].wpx ? Math.round(cols[c].wpx) : (cols[c] && cols[c].wch ? Math.round(cols[c].wch * 7 + 5) : 64);
          h.push('<col style="width:' + (w || 64) + 'px">');
        }
        h.push('</colgroup><tbody>');
        var span = {}, skip = {};
        merges.forEach(function (mm) {
          var c1 = colToNum(mm[0]), r1 = rowOf(mm[0]), c2 = colToNum(mm[1]), r2 = rowOf(mm[1]);
          span[r1 + '_' + c1] = { rs: r2 - r1 + 1, cs: c2 - c1 + 1 };
          for (var r = r1; r <= r2; r++) for (var cc = c1; cc <= c2; cc++) {
            if (r !== r1 || cc !== c1) skip[r + '_' + cc] = 1;
          }
        });
        for (var r2 = rng.s.r; r2 <= rng.e.r; r2++) {
          h.push('<tr>');
          for (var c2 = rng.s.c; c2 <= rng.e.c; c2++) {
            if (skip[(r2 + 1) + '_' + (c2 + 1)]) continue;
            var v = (aoa[r2] || [])[c2];
            var body = (v === undefined || v === null || v === '') ? '' : esc(String(v));
            var sp = span[(r2 + 1) + '_' + (c2 + 1)];
            if (sp && sp.rs === 1 && sp.cs === 1) sp = null;
            var spanAttr = '';
            if (sp) {
              if (sp.rs > 1) spanAttr += ' rowspan="' + sp.rs + '"';
              if (sp.cs > 1) spanAttr += ' colspan="' + sp.cs + '"';
            }
            h.push('<td' + spanAttr
              + ' style="border:1px solid #d0d7de;padding:2px 5px;vertical-align:middle;word-break:break-word;">' + body + '</td>');
          }
          h.push('</tr>');
        }
        h.push('</tbody></table>');
        return { name: nm, html: h.join('') };
      });
      if (panes.length === 1) return '<div class="fv-sheetname">' + esc(panes[0].name) + '</div>' + panes[0].html;
      var tabs = panes.map(function (a, i) {
        return '<button class="fv-tab' + (i ? '' : ' on') + '" onclick="FV.tab(this,' + i + ')">' + esc(a.name) + '</button>';
      }).join('');
      var ps = panes.map(function (a, i) {
        return '<div class="fv-pane" data-i="' + i + '" style="' + (i ? 'display:none' : '') + '">' + a.html + '</div>';
      }).join('');
      return '<div class="fv-tabs">' + tabs + '</div><div class="fv-panes">' + ps + '</div>';
    });
  };

  /* ================= 统一渲染入口 ================= */
  FV.kindOf = function (ext, type) {
    ext = (ext || '').toLowerCase();
    if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
    if (ext === 'xls') return 'xls';
    if (ext === 'csv') return 'csv';
    if (ext === 'docx' || ext === 'dotx') return 'docx';
    if (ext === 'doc' || ext === 'dot') return 'doc';
    if (ext === 'pdf') return 'pdf';
    if (/^(png|jpg|jpeg|gif|bmp|webp|svg)$/.test(ext)) return 'img';
    if (/^(txt|md|log|json|xml|html?)$/.test(ext)) return 'text';
    if (type && /^image\//.test(type)) return 'img';
    if (type && /pdf/.test(type)) return 'pdf';
    return 'other';
  };

  FV.render = function (rec) {
    var kind = FV.kindOf(rec.ext, rec.type);
    var blob = rec.blob;
    if (kind === 'pdf' || kind === 'img') {
      return Promise.resolve({ kind: kind, url: FV.blobUrl(blob) });
    }
    if (kind === 'xlsx') return FV.xlsxToHtml(blob).then(function (h) { return { kind: 'html', html: h }; });
    if (kind === 'docx') return FV.docxToHtml(blob).then(function (h) { return { kind: 'html', html: h }; });
    if (kind === 'xls') return FV.xlsToHtml(blob).then(function (h) { return { kind: 'html', html: h }; });
    if (kind === 'csv' || kind === 'text') {
      return blob.text().then(function (t) {
        if (kind === 'csv') {
          var rows = t.split(/\r?\n/).filter(function (x) { return x !== ''; });
          var h = ['<table class="fv-xlsx" style="border-collapse:collapse;font-size:11pt;">'];
          rows.forEach(function (line) {
            h.push('<tr>');
            line.split(',').forEach(function (c) {
              h.push('<td style="border:1px solid #d0d7de;padding:4px 8px;">' + esc(c.replace(/^"|"$/g, '')) + '</td>');
            });
            h.push('</tr>');
          });
          h.push('</table>');
          return { kind: 'html', html: h.join('') };
        }
        return { kind: 'html', html: '<pre class="fv-pre">' + esc(t) + '</pre>' };
      });
    }
    return Promise.resolve({
      kind: 'other',
      html: '<div class="fv-note">这种格式（<b>.' + esc(rec.ext || '?') + '</b>）浏览器不能直接还原画面。<br>'
        + '点下方「⬇ 下载原文件」，用 WPS / 对应软件打开即为<b>原样</b>；'
        + '2D / 3D 图纸建议下载后用专业软件查看。</div>'
    });
  };

  FV.fileSize = function (n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  };

  FV.download = function (rec) {
    var a = document.createElement('a');
    a.href = FV.blobUrl(rec.blob || rec);
    a.download = rec.name || 'file';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); }, 400);
  };

  FV.print = function (rec) {
    var url = FV.blobUrl(rec.blob);
    var w = window.open(url, '_blank');
    if (!w) { alert('浏览器拦截了新窗口，请允许弹窗后重试'); return; }
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) { } }, 1200);
  };

  FV.stylesheet = function () {
    return [
      '.fv-xlsx{border-collapse:collapse;background:#fff;font-family:微软雅黑,Arial,sans-serif;}',
      '.fv-xlsx td{padding:2px 5px;vertical-align:middle;word-break:break-word;line-height:1.35;}',
      '.fv-docx{border-collapse:collapse;width:100%;margin:8px 0;}',
      '.fv-docx td{border:1px solid #999;padding:5px 7px;vertical-align:top;font-size:10.5pt;}',
      '.fv-docx p{margin:2px 0;}',
      '.fv-wrap{background:#f6f8fa;padding:14px;border-radius:8px;overflow:auto;max-height:62vh;}',
      '.fv-paper{background:#fff;padding:22px 26px;box-shadow:0 1px 5px rgba(0,0,0,.12);display:inline-block;vertical-align:top;max-width:100%;}',
      '.fv-zoom{width:100%;overflow:hidden;}',
      '.fv-zbar{display:inline-flex;gap:4px;align-items:center;margin-left:2px;flex-wrap:wrap;}',
      '.fv-zbtn{padding:4px 10px !important;font-size:11.5px !important;}',
      '.fv-zval{font-size:11px;color:#8a9a90;min-width:40px;text-align:center;}',
      '@media (max-width:640px){.fv-wrap{padding:8px !important;max-height:none !important;}.fv-paper{padding:10px 10px !important;}.fv-docx-paper{padding:16px 14px !important;}.fv-zbtn{padding:3px 8px !important;}}',
      '.fv-docx-paper{background:#fff;padding:34px 40px;box-shadow:0 1px 5px rgba(0,0,0,.12);font-size:10.5pt;line-height:1.75;color:#111;}',
      '.fv-sheetname{font-weight:700;color:#2d7a4f;margin:6px 0 8px;font-size:13px;}',
      '.fv-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;}',
      '.fv-tab{padding:5px 12px;border:1px solid #d0d7de;background:#fff;border-radius:6px;cursor:pointer;font-size:12px;}',
      '.fv-tab.on{background:#2d7a4f;color:#fff;border-color:#2d7a4f;}',
      '.fv-note{background:#fff8e8;border:1px solid #e6c87a;border-radius:8px;padding:14px 16px;color:#7a5b16;line-height:1.8;font-size:13px;}',
      '.fv-pre{white-space:pre-wrap;font-family:Consolas,monospace;font-size:12px;background:#fff;padding:14px;border-radius:6px;}',
      '.fv-pdf{width:100%;height:66vh;border:1px solid #d0d7de;border-radius:8px;background:#fff;}',
      '.fv-img{max-width:100%;display:block;margin:0 auto;background:#fff;}'
    ].join('');
  };
})();
