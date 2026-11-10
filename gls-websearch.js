/* 格丽思工作台 · 联网查标准/法规（方舟 web_search 代理）
 * 依赖：GLSSYNC.apiBase() / GLSSYNC.isOnline()
 * 服务端路由：POST {apiBase}/api/web-search  body: {question, city}
 */
(function () {
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function inject() {
    var home = document.getElementById('page-home');
    if (!home || document.getElementById('glsWsCard')) return;

    var card = el('div', 'gls-ws-card');
    card.id = 'glsWsCard';
    card.innerHTML =
      '<div class="gls-ws-head" id="glsWsHead">' +
      '  <span class="gls-ws-icon">🌐</span>' +
      '  <div class="gls-ws-t">' +
      '    <div class="gls-ws-title">联网查标准 / 法规</div>' +
      '    <div class="gls-ws-sub">查 GB、CCC、ISO、客户标准、最新法规（由方舟联网插件实时检索）</div>' +
      '  </div>' +
      '  <span class="gls-ws-toggle" id="glsWsToggle">展开 ▾</span>' +
      '</div>' +
      '<div class="gls-ws-body" id="glsWsBody" style="display:none">' +
      '  <div class="gls-ws-row">' +
      '    <input id="glsWsInput" type="text" placeholder="例如：GB 4706.1-2024 实施日期？空气炸锅温升测试要求？" />' +
      '    <button id="glsWsBtn">查询</button>' +
      '  </div>' +
      '  <div class="gls-ws-hint" id="glsWsHint">每次查询按次计费；结果由联网检索生成，正式判定前请核对标准原文。</div>' +
      '  <div class="gls-ws-result" id="glsWsResult"></div>' +
      '</div>';

    // 插在首页搜索条后面
    var entry = home.querySelector('.home-search-entry');
    if (entry && entry.parentNode) {
      entry.parentNode.insertBefore(card, entry.nextSibling);
    } else {
      home.insertBefore(card, home.firstChild);
    }

    var style = el('style', null,
      '.gls-ws-card{background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.04);border:1px solid #e6f7ee}' +
      '.gls-ws-head{display:flex;align-items:center;cursor:pointer}' +
      '.gls-ws-icon{font-size:22px;margin-right:10px}' +
      '.gls-ws-t{flex:1}' +
      '.gls-ws-title{font-size:14px;font-weight:600;color:#2d7a4f}' +
      '.gls-ws-sub{font-size:12px;color:#999;margin-top:2px}' +
      '.gls-ws-toggle{font-size:12px;color:#2d7a4f}' +
      '.gls-ws-body{margin-top:12px}' +
      '.gls-ws-row{display:flex;gap:8px}' +
      '.gls-ws-row input{flex:1;border:1px solid #d9e8df;border-radius:8px;padding:10px 12px;font-size:14px;outline:none}' +
      '.gls-ws-row input:focus{border-color:#2d7a4f}' +
      '.gls-ws-row button{background:#2d7a4f;color:#fff;border:none;border-radius:8px;padding:0 18px;font-size:14px;cursor:pointer}' +
      '.gls-ws-row button:disabled{background:#9cccaf}' +
      '.gls-ws-hint{font-size:11px;color:#bbb;margin:8px 0}' +
      '.gls-ws-result{background:#f7faf8;border-radius:8px;padding:12px;font-size:14px;line-height:1.7;color:#333;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow-y:auto}' +
      '.gls-ws-result.err{background:#fff2f0;color:#cf1322}' +
      '.gls-ws-result .meta{font-size:11px;color:#999;margin-top:8px;border-top:1px dashed #e5e5e5;padding-top:6px}'
    );
    document.head.appendChild(style);

    // 展开/收起
    var body = card.querySelector('#glsWsBody');
    var tog = card.querySelector('#glsWsToggle');
    card.querySelector('#glsWsHead').onclick = function () {
      var open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      tog.textContent = open ? '展开 ▾' : '收起 ▴';
      if (!open) setTimeout(function(){ card.querySelector('#glsWsInput').focus(); }, 50);
    };

    var btn = card.querySelector('#glsWsBtn');
    var input = card.querySelector('#glsWsInput');
    var out = card.querySelector('#glsWsResult');

    function run() {
      var q = (input.value || '').trim();
      if (!q) { out.className = 'gls-ws-result err'; out.textContent = '请输入要查的问题。'; return; }
      var base = (window.GLSSYNC && GLSSYNC.apiBase) ? GLSSYNC.apiBase() : '';
      if (!base || (window.GLSSYNC && !GLSSYNC.isOnline())) {
        out.className = 'gls-ws-result err';
        out.textContent = '还没连接内部服务。请先在工作台右下角「设置」里填好公司常开电脑的地址（http://IP:端口），联网查标准需要走那台电脑转发。';
        return;
      }
      btn.disabled = true; btn.textContent = '检索中…';
      out.className = 'gls-ws-result'; out.textContent = '正在联网检索「' + q + '」，通常 5~20 秒…';
      fetch(base.replace(/\/+$/,'') + '/api/web-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, city: '宁波' })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok && d.answer) {
          out.className = 'gls-ws-result';
          out.textContent = d.answer;
          var tu = d.usage && d.usage.tool_usage;
          if (tu) {
            var m = el('div', 'meta', '本次联网检索：' + JSON.stringify(tu));
            out.appendChild(m);
          }
        } else {
          out.className = 'gls-ws-result err';
          out.textContent = d.error || '查询失败，服务端返回异常。';
        }
      }).catch(function (e) {
        out.className = 'gls-ws-result err';
        out.textContent = '连不上内部服务：' + e + '（确认那台常开电脑开着、地址对）';
      }).finally(function () {
        btn.disabled = false; btn.textContent = '查询';
      });
    }
    btn.onclick = run;
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
  }

  function boot() {
    if (document.getElementById('page-home')) { inject(); return; }
    var t = setInterval(function () {
      if (document.getElementById('page-home')) { clearInterval(t); inject(); }
    }, 300);
    setTimeout(function () { clearInterval(t); }, 15000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
