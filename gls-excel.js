/*!
 * gls-excel.js —— HTML 表格导出为 Excel(.xlsx)
 * 纯前端实现：保留字体、字号、加粗、边框、对齐、背景色、合并单元格、列宽、行高
 * 不依赖任何第三方库
 */
(function (global) {
  'use strict';

  /* ==================== CRC32 ==================== */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ==================== ZIP（store 模式，不压缩） ==================== */
  function zipStore(entries) {
    var enc = new TextEncoder();
    var parts = [], central = [], offset = 0;

    entries.forEach(function (e) {
      var nameBytes = enc.encode(e.name);
      var data = e.data;
      var crc = crc32(data);
      var size = data.length;

      var lh = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0x21, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      parts.push(lh, data);

      var ch = new Uint8Array(46 + nameBytes.length);
      var dv2 = new DataView(ch.buffer);
      dv2.setUint32(0, 0x02014b50, true);
      dv2.setUint16(4, 20, true);
      dv2.setUint16(6, 20, true);
      dv2.setUint16(8, 0x0800, true);
      dv2.setUint16(10, 0, true);
      dv2.setUint16(12, 0, true);
      dv2.setUint16(14, 0x21, true);
      dv2.setUint32(16, crc, true);
      dv2.setUint32(20, size, true);
      dv2.setUint32(24, size, true);
      dv2.setUint16(28, nameBytes.length, true);
      dv2.setUint16(30, 0, true);
      dv2.setUint16(32, 0, true);
      dv2.setUint16(34, 0, true);
      dv2.setUint16(36, 0, true);
      dv2.setUint32(38, 0, true);
      dv2.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);

      offset += lh.length + size;
    });

    var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var end = new Uint8Array(22);
    var dv3 = new DataView(end.buffer);
    dv3.setUint32(0, 0x06054b50, true);
    dv3.setUint16(4, 0, true);
    dv3.setUint16(6, 0, true);
    dv3.setUint16(8, entries.length, true);
    dv3.setUint16(10, entries.length, true);
    dv3.setUint32(12, cdSize, true);
    dv3.setUint32(16, offset, true);
    dv3.setUint16(20, 0, true);

    var all = parts.concat(central);
    all.push(end);
    var total = all.reduce(function (a, b) { return a + b.length; }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    all.forEach(function (a) { out.set(a, pos); pos += a.length; });
    return out;
  }

  /* ==================== 工具 ==================== */
  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function colLetter(n) {
    var s = '';
    n = n + 1;
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function parseStyle(s) {
    var o = {};
    if (!s) return o;
    s.split(';').forEach(function (kv) {
      var i = kv.indexOf(':');
      if (i < 0) return;
      var k = kv.slice(0, i).trim().toLowerCase();
      var v = kv.slice(i + 1).trim();
      if (k && v) o[k] = v;
    });
    return o;
  }

  function normColor(v) {
    if (!v) return null;
    v = String(v).trim().toLowerCase();
    if (v === 'transparent' || v === 'none' || v === 'initial') return null;
    var m;
    if ((m = v.match(/^#([0-9a-f]{3})$/))) {
      return 'FF' + m[1][0] + m[1][0] + m[1][1] + m[1][1] + m[1][2] + m[1][2];
    }
    if ((m = v.match(/^#([0-9a-f]{6})$/))) return 'FF' + m[1];
    if ((m = v.match(/^#([0-9a-f]{8})$/))) return m[1].toUpperCase();
    if ((m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/))) {
      return 'FF' + [m[1], m[2], m[3]].map(function (x) {
        return ('0' + parseInt(x, 10).toString(16)).slice(-2);
      }).join('').toUpperCase();
    }
    return null;
  }

  // '1px solid #000' → { style: 'thin', color: 'FF000000' }
  function parseBorderVal(v) {
    if (!v) return null;
    v = String(v).trim().toLowerCase();
    if (v.indexOf('none') === 0 || v === '0') return null;
    var m = v.match(/([\d.]+)\s*(px|pt)?\s+(solid|dashed|dotted|double|groove|ridge|inset|outset)/);
    var width = 1, kind = null;
    if (m) {
      width = parseFloat(m[1]);
      kind = m[3];
    } else {
      if (/solid/.test(v)) kind = 'solid';
      else if (/dashed/.test(v)) kind = 'dashed';
      else if (/dotted/.test(v)) kind = 'dotted';
      else if (/double/.test(v)) kind = 'double';
      else return null;
    }
    var style = 'thin';
    if (kind === 'dashed') style = 'dashed';
    else if (kind === 'dotted') style = 'dotted';
    else if (kind === 'double') style = 'double';
    else if (width >= 2) style = 'medium';
    else if (width > 0 && width < 1) style = 'hair';
    var cm = v.match(/(#[0-9a-f]{3,8}|rgba?\([^)]*\))/);
    var color = cm ? normColor(cm[1]) : 'FF000000';
    return { style: style, color: color || 'FF000000' };
  }

  function cellText(cell) {
    var html = cell.innerHTML || '';
    html = html.replace(/<br\s*\/?>/gi, '\n');
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || '').replace(/\u00a0/g, ' ').replace(/\r/g, '');
  }

  /* ==================== 解析 HTML 表格 ==================== */
  function parseTable(table) {
    var occupied = {};
    var cells = [];
    // 只取本表格的行，排除嵌套子表格的行
    var rows = [];
    Array.prototype.forEach.call(table.querySelectorAll('tr'), function (tr) {
      try { if (tr.closest('table') === table) rows.push(tr); } catch (e) {}
    });
    if (!rows.length) rows = Array.prototype.slice.call(table.rows);
    var maxCol = 0;

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var c = 0;
      var cs = row.cells;
      for (var i = 0; i < cs.length; i++) {
        while (occupied[r + ',' + c]) c++;
        var cell = cs[i];
        var colspan = cell.colSpan || 1;
        var rowspan = cell.rowSpan || 1;
        if (colspan < 1) colspan = 1;
        if (rowspan < 1) rowspan = 1;
        for (var dr = 0; dr < rowspan; dr++) {
          for (var dc = 0; dc < colspan; dc++) {
            occupied[(r + dr) + ',' + (c + dc)] = 1;
          }
        }
        var st = parseStyle(cell.getAttribute('style') || '');
        cells.push({
          r: r, c: c,
          rowspan: rowspan, colspan: colspan,
          text: cellText(cell),
          st: st,
          rowStyle: parseStyle(row.getAttribute('style') || '')
        });
        c += colspan;
        if (c > maxCol) maxCol = c;
      }
    }
    return { cells: cells, maxCol: maxCol, rowCount: rows.length };
  }

  /* ==================== 样式收集 ==================== */
  function catmull(s) { return s; }

  function buildStyles(tablesData) {
    var fonts = [{ name: '宋体', sz: 11, b: false, color: null }];
    var fills = [null, null]; // 占位：none / gray125
    var borders = [null];     // 占位：空边框
    var xfs = [{ fontId: 0, fillId: 0, borderId: 0, align: null }];

    function key(o) { return JSON.stringify(o); }

    function addFont(f) {
      for (var i = 0; i < fonts.length; i++) if (key(fonts[i]) === key(f)) return i;
      fonts.push(f);
      return fonts.length - 1;
    }
    function addFill(f) {
      if (!f) return 0;
      for (var i = 2; i < fills.length; i++) if (key(fills[i]) === key(f)) return i;
      fills.push(f);
      return fills.length - 1;
    }
    function addBorder(b) {
      if (!b) return 0;
      for (var i = 1; i < borders.length; i++) if (key(borders[i]) === key(b)) return i;
      borders.push(b);
      return borders.length - 1;
    }
    function addXf(xf) {
      for (var i = 0; i < xfs.length; i++) if (key(xfs[i]) === key(xf)) return i;
      xfs.push(xf);
      return xfs.length - 1;
    }

    tablesData.forEach(function (data) {
      data.cells.forEach(function (cell) {
        var st = cell.st || {};
        var fs = (st['font-size'] || '').replace('pt', '').replace('px', '');
        var sz = parseFloat(fs);
        if (isNaN(sz) || sz <= 0) sz = 11;
        if (fs && /px/.test(st['font-size'] || '')) sz = sz * 0.75;
        sz = Math.round(sz * 10) / 10;

        var fw = String(st['font-weight'] || '').toLowerCase();
        var bold = (fw === 'bold' || fw === 'bolder' || (parseInt(fw, 10) >= 600));

        var font = {
          name: (st['font-family'] || '宋体').split(',')[0].replace(/["']/g, '').trim() || '宋体',
          sz: sz,
          b: bold,
          color: normColor(st['color'])
        };
        var fontId = addFont(font);

        // 边框：兼容 border-top 与 top 两种写法
        function bd(name) {
          var v = st['border-' + name] || st[name] || st['border'];
          if (!v) return null;
          // 排除 top/left 等定位属性误判
          if (!/solid|dashed|dotted|double|groove|ridge|inset|outset/.test(v)) return null;
          return parseBorderVal(v);
        }
        var bTop = bd('top'), bBot = bd('bottom'), bL = bd('left'), bR = bd('right');
        var border = null;
        if (bTop || bBot || bL || bR) {
          border = {
            l: bL || null, r: bR || null, t: bTop || null, b: bBot || null
          };
        }
        var borderId = addBorder(border);

        var bgRaw = st['background-color'] || st['background'] || '';
        var bgc = normColor(bgRaw);
        var fillId = addFill(bgc ? { color: bgc } : null);

        var hAlign = (st['text-align'] || '').toLowerCase();
        var vAlign = (st['vertical-align'] || '').toLowerCase();
        var align = null;
        if (hAlign === 'center' || hAlign === 'right' || hAlign === 'left' || vAlign === 'middle' || vAlign === 'top' || vAlign === 'bottom' || cell.text.indexOf('\n') >= 0) {
          align = {};
          if (hAlign === 'center') align.h = 'center';
          else if (hAlign === 'right') align.h = 'right';
          else if (hAlign === 'left') align.h = 'left';
          if (vAlign === 'middle' || vAlign === 'center') align.v = 'center';
          else if (vAlign === 'top') align.v = 'top';
          else if (vAlign === 'bottom') align.v = 'bottom';
          if (cell.text.indexOf('\n') >= 0) align.wrap = true;
          if (!align.h && !align.v && !align.wrap) align = null;
        }

        cell.styleId = addXf({ fontId: fontId, fillId: fillId, borderId: borderId, align: align });
      });
    });

    return { fonts: fonts, fills: fills, borders: borders, xfs: xfs };
  }

  /* ==================== 生成 xlsx 各部件 XML ==================== */
  function stylesXml(S, sheetName) {
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';

    x += '<fonts count="' + S.fonts.length + '">';
    S.fonts.forEach(function (f) {
      x += '<font>';
      if (f.b) x += '<b/>';
      x += '<sz val="' + f.sz + '"/>';
      if (f.color) x += '<color rgb="' + f.color + '"/>';
      x += '<name val="' + xmlEsc(f.name) + '"/>';
      x += '</font>';
    });
    x += '</fonts>';

    x += '<fills count="' + S.fills.length + '">';
    x += '<fill><patternFill patternType="none"/></fill>';
    x += '<fill><patternFill patternType="gray125"/></fill>';
    for (var i = 2; i < S.fills.length; i++) {
      x += '<fill><patternFill patternType="solid"><fgColor rgb="' + S.fills[i].color + '"/><bgColor indexed="64"/></patternFill></fill>';
    }
    x += '</fills>';

    x += '<borders count="' + S.borders.length + '">';
    x += '<border><left/><right/><top/><bottom/><diagonal/></border>';
    for (var j = 1; j < S.borders.length; j++) {
      var b = S.borders[j];
      function sideOf(sd, tag) {
        if (!sd) return '<' + tag + '/>';
        return '<' + tag + ' style="' + sd.style + '"><color rgb="' + sd.color + '"/></' + tag + '>';
      }
      x += '<border>' + sideOf(b.l, 'left') + sideOf(b.r, 'right') + sideOf(b.t, 'top') + sideOf(b.b, 'bottom') + '<diagonal/></border>';
    }
    x += '</borders>';

    x += '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>';

    x += '<cellXfs count="' + S.xfs.length + '">';
    S.xfs.forEach(function (xf) {
      x += '<xf numFmtId="0" fontId="' + xf.fontId + '" fillId="' + xf.fillId + '" borderId="' + xf.borderId + '" xfId="0"';
      if (xf.fontId) x += ' applyFont="1"';
      if (xf.fillId) x += ' applyFill="1"';
      if (xf.borderId) x += ' applyBorder="1"';
      if (xf.align) {
        x += ' applyAlignment="1"><alignment';
        if (xf.align.h) x += ' horizontal="' + xf.align.h + '"';
        if (xf.align.v) x += ' vertical="' + xf.align.v + '"';
        if (xf.align.wrap) x += ' wrapText="1"';
        x += '/></xf>';
      } else {
        x += '/>';
      }
    });
    x += '</cellXfs>';

    x += '<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>';
    x += '</styleSheet>';
    return x;
  }

  function sheetXml(data, sheetName) {
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';

    // 列宽
    var colWidths = new Array(data.maxCol).fill(0);
    data.cells.forEach(function (cell) {
      if (cell.colspan > 1) return;
      var lines = String(cell.text).split('\n');
      lines.forEach(function (ln) {
        var w = 0;
        for (var i = 0; i < ln.length; i++) w += (ln.charCodeAt(i) > 255 ? 2 : 1);
        if (w > colWidths[cell.c]) colWidths[cell.c] = w;
      });
    });
    var hasWidth = colWidths.some(function (w) { return w > 0; });
    if (hasWidth) {
      x += '<cols>';
      for (var ci = 0; ci < data.maxCol; ci++) {
        var wd = Math.min(Math.max((colWidths[ci] || 4) + 2, 6), 50);
        x += '<col min="' + (ci + 1) + '" max="' + (ci + 1) + '" width="' + wd + '" customWidth="1"/>';
      }
      x += '</cols>';
    }

    // 按行组织
    var byRow = {};
    data.cells.forEach(function (cell) {
      (byRow[cell.r] = byRow[cell.r] || []).push(cell);
    });

    x += '<sheetData>';
    for (var r = 0; r < data.rowCount; r++) {
      var list = (byRow[r] || []).slice().sort(function (a, b) { return a.c - b.c; });
      var rowH = null;
      if (list.length && list[0].rowStyle) {
        var h = list[0].rowStyle['height'];
        if (h) {
          var hv = parseFloat(String(h).replace('pt', '').replace('px', ''));
          if (!isNaN(hv) && hv > 0) rowH = hv > 100 ? hv * 0.75 : hv;
        }
      }
      x += '<row r="' + (r + 1) + '"' + (rowH ? ' ht="' + rowH + '" customHeight="1"' : '') + '>';
      list.forEach(function (cell) {
        var ref = colLetter(cell.c) + (r + 1);
        var txt = String(cell.text == null ? '' : cell.text);
        var sAttr = cell.styleId ? ' s="' + cell.styleId + '"' : '';
        if (txt === '') {
          x += '<c r="' + ref + '"' + sAttr + '/>';
        } else {
          x += '<c r="' + ref + '"' + sAttr + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(txt) + '</t></is></c>';
        }
      });
      x += '</row>';
    }
    x += '</sheetData>';

    // 合并单元格
    var merges = [];
    data.cells.forEach(function (cell) {
      if (cell.rowspan > 1 || cell.colspan > 1) {
        var r1 = cell.r + 1, c1 = cell.c, r2 = cell.r + cell.rowspan, c2 = cell.c + cell.colspan - 1;
        merges.push(colLetter(c1) + r1 + ':' + colLetter(c2) + r2);
      }
    });
    if (merges.length) {
      x += '<mergeCells count="' + merges.length + '">';
      merges.forEach(function (m) { x += '<mergeCell ref="' + m + '"/>'; });
      x += '</mergeCells>';
    }

    x += '</worksheet>';
    return x;
  }

  function buildParts(data, sheetName) {
    var S = buildStyles([data]);
    var enc = new TextEncoder();

    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';

    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var safeName = String(sheetName || 'Sheet1').replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31) || 'Sheet1';

    var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + xmlEsc(safeName) + '" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>';

    var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    return [
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
      { name: '_rels/.rels', data: enc.encode(rels) },
      { name: 'xl/workbook.xml', data: enc.encode(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
      { name: 'xl/styles.xml', data: enc.encode(stylesXml(S, safeName)) },
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml(data, safeName)) }
    ];
  }

  /* ==================== 对外接口 ==================== */
  function htmlToXlsxBytes(htmlString, sheetName) {
    var doc = new DOMParser().parseFromString(
      '<div>' + String(htmlString || '') + '</div>', 'text/html');
    var table = doc.querySelector('table');
    if (!table) return null;
    var data = parseTable(table);
    if (!data.cells.length) return null;
    return zipStore(buildParts(data, sheetName || '模板'));
  }

  function downloadBytes(bytes, fileName) {
    var blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { document.body.removeChild(a); } catch (e) {}
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function safeFileName(s) {
    return String(s || '模板').replace(/[\\\/:*?"<>|\r\n]/g, '_').slice(0, 80);
  }

  /**
   * 导出单个 HTML 表格为 xlsx
   * @returns {boolean} 是否成功
   */
  global.exportHtmlTableToXlsx = function (htmlString, fileName, sheetName) {
    try {
      var bytes = htmlToXlsxBytes(htmlString, sheetName || fileName);
      if (!bytes) return false;
      downloadBytes(bytes, safeFileName(fileName).replace(/\.xlsx$/i, '') + '.xlsx');
      return true;
    } catch (e) {
      console.error('导出 Excel 失败:', e);
      return false;
    }
  };

  /**
   * 批量导出：打包成一个 zip
   * @param {Array} items [{name, html}]
   */
  global.exportTemplatesAsZip = function (items) {
    try {
      var enc = new TextEncoder();
      var entries = [];
      items.forEach(function (it, idx) {
        var bytes = htmlToXlsxBytes(it.html, it.name);
        if (!bytes) return;
        var nm = safeFileName(it.name) || ('模板' + (idx + 1));
        // 避免重名
        var used = {};
        var base = nm, n = 1;
        while (used[nm]) { nm = base + '(' + (n++) + ')'; }
        used[nm] = 1;
        entries.push({ name: nm + '.xlsx', data: bytes });
      });
      if (!entries.length) return false;
      var zip = zipStore(entries);
      var blob = new Blob([zip], { type: 'application/zip' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = safeFileName(items.length ? (items[0].groupName || '模板合集') : '模板合集') + '.zip';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { document.body.removeChild(a); } catch (e) {}
        URL.revokeObjectURL(url);
      }, 1500);
      return true;
    } catch (e) {
      console.error('批量导出失败:', e);
      return false;
    }
  };

  global.glsExcelReady = true;
})(window);
