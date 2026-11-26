/*!
 * 测试站共用的小工具:日志区 + 一张「这个能力在不在」的表。
 * 不依赖 AppShell —— 在普通浏览器里打开也要能看。
 */
(function () {
  'use strict';

  var logEl = null;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function stamp() {
    var d = new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /** 往日志区写一行。kind: '' | 'ok' | 'err' */
  function log(msg, kind) {
    if (!logEl) logEl = document.getElementById('log');
    if (!logEl) { console.log(msg); return; }
    var line = document.createElement('div');
    var t = document.createElement('span');
    t.className = 't';
    t.textContent = stamp() + '  ';
    line.appendChild(t);
    var body = document.createElement('span');
    if (kind) body.className = kind;
    body.textContent = msg;
    line.appendChild(body);
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  /** 把 Error 打印成「看得出问题在哪」的一行 */
  function logErr(prefix, e) {
    var code = e && e.code ? e.code : '(没有 code)';
    var msg = e && e.message ? e.message : String(e);
    log(prefix + ' 失败  code=' + code + '  ' + msg, 'err');
    if (e && e.cause) log('    ↳ 插件原始错误: ' + (e.cause.message || e.cause), 'err');
  }

  function esc(x) {
    return String(x).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  /** 把一个对象铺成 key/value 表格,塞进 el。
   *  【键和值都要转义】—— 键里常常带着 <html> 这种写法,
   *  不转义就被浏览器当成标签吃掉了（实测踩过）。 */
  function renderPairs(el, pairs) {
    var rows = pairs.map(function (p) {
      var v = p[1];
      var cell;
      if (v === true) cell = '<span class="pill y">在</span>';
      else if (v === false) cell = '<span class="pill n">不在</span>';
      else if (v === null || v === undefined || v === '') cell = '<span class="pill w">读不到</span>';
      else cell = '<code>' + esc(v) + '</code>';
      return '<tr><td>' + esc(p[0]) + '</td><td>' + cell + '</td></tr>';
    });
    el.innerHTML = '<table><tbody>' + rows.join('') + '</tbody></table>';
  }

  /** 壳在不在。不在就把 banner 显示出来,并禁用所有需要壳的按钮。 */
  function requireShell(bannerId) {
    var inApp = !!(window.AppShell && window.AppShell.platform);
    var banner = bannerId && document.getElementById(bannerId);
    if (!inApp && banner) banner.hidden = false;
    if (!inApp) {
      var bs = document.querySelectorAll('button[data-needs-shell]');
      for (var i = 0; i < bs.length; i++) bs[i].disabled = true;
    }
    return inApp;
  }

  window.T = { log: log, logErr: logErr, renderPairs: renderPairs, requireShell: requireShell };
})();
