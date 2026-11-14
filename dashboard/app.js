// Token Launch Radar — board, filters, sorting and per-protocol detail.
// Reads window.BOARD_DATA (data.js, written by main.ts from the same snapshot).
// No network, no framework. Deep links: #/ board, #/protocol/<slug> detail,
// #/filter/<category> board with that category applied.
(function () {
  'use strict';
  var D = window.BOARD_DATA;
  if (!D) return;
  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function usd(v) {
    return v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US');
  }
  function compact(v) {
    if (v == null) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(v);
  }
  function pct(v) {
    if (v == null) return '<span class="flat">n/a</span>';
    var cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (v >= 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }

  // ---- header stats + model strip -------------------------------------------
  var total = D.total_implied_usd;
  document.getElementById('stats').innerHTML =
    '<div><dt>Snapshot</dt><dd>' + esc(D.as_of) + '</dd></div>' +
    '<div><dt>Protocols scanned</dt><dd>' + D.protocol_count + '</dd></div>' +
    '<div><dt>Pre-token ranked</dt><dd><em>' + D.board_size + '</em></dd></div>' +
    '<div><dt>Watchlist covered</dt><dd>' + D.watchlist_size + ' / ' + D.watchlist_size + '</dd></div>' +
    '<div><dt>Total implied value</dt><dd>' + compact(total) + '</dd></div>';
  document.getElementById('model-strip').innerHTML =
    '<strong>Model ' + esc(D.model.version) + '.</strong> Implied value = TVL priced at the median mcap/TVL of tokenized peers ' +
    '(global median <span class="mono">' + D.model.global_ratio.toFixed(3) + '</span> across ' + D.model.peer_count + ' usable peers; ' +
    D.model.categories_priced + ' categories priced on their own peers), adjusted for 7-day momentum, years tokenless and chain breadth.' +
    '<span class="formula">' + esc(D.model.formula) + '</span>';

  // ---- controls --------------------------------------------------------------
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('f-category');
  var chainEl = document.getElementById('f-chain');
  var watchEl = document.getElementById('f-watch');
  var limitEl = document.getElementById('f-limit');

  var cats = {}, chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; catEl.appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; chainEl.appendChild(o);
  });

  var sortKey = 'rank', sortDir = 1;
  var DEFAULT_DIR = { rank: 1, name: 1, category: 1, tvl_usd: -1, change_7d: -1, implied_value_usd: -1 };

  function currentRows() {
    var q = qEl.value.trim().toLowerCase();
    var cat = catEl.value, chain = chainEl.value, watchOnly = watchEl.checked;
    var out = rows.filter(function (r) {
      if (watchOnly && !r.watchlist) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) === -1) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + r.chains.join(' ') + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    out.sort(function (a, b) {
      var x = a[sortKey], y = b[sortKey];
      if (x == null && y == null) return a.rank - b.rank;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === 'string') return sortDir * x.localeCompare(y) || a.rank - b.rank;
      return sortDir * (x - y) || a.rank - b.rank;
    });
    return out;
  }

  var bodyEl = document.getElementById('board-body');
  var lineEl = document.getElementById('result-line');

  function renderBoard() {
    var list = currentRows();
    var limit = limitEl.value === 'all' ? list.length : parseInt(limitEl.value, 10);
    var shown = list.slice(0, limit);
    var html = shown.map(function (r) {
      return '<tr class="rowlink" data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' +
          (r.watchlist ? '<span class="badge">Watchlist</span>' : '<span class="badge early">Early</span>') +
          '<br><span class="pslug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + compact(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num implied">' + usd(r.implied_value_usd) + '</td>' +
        '<td class="num ratio">' + r.model.category_ratio.toFixed(3) + (r.model.ratio_basis === 'category' ? ' cat' : ' glob') + '</td>' +
        '</tr>';
    }).join('');
    bodyEl.innerHTML = html || '<tr><td colspan="8">No protocol matches these filters.</td></tr>';
    lineEl.textContent = 'Showing ' + shown.length + ' of ' + list.length + ' matching rows · ' + rows.length + ' pre-token protocols ranked · sorted by ' + sortKey.replace('_usd', '').replace('_', ' ') + (sortDir === 1 ? ' ↑' : ' ↓');
    var trs = bodyEl.querySelectorAll('tr.rowlink');
    Array.prototype.forEach.call(trs, function (tr) {
      tr.addEventListener('click', function () { location.hash = '#/protocol/' + tr.getAttribute('data-slug'); });
    });
  }

  // Set-apart table: tokenized protocols with the market's own values, then the
  // pre-token protocols the ranking sets apart, each with its reason stated.
  document.getElementById('live-body').innerHTML = D.live.map(function (r) {
    var note = r.set_apart_reason
      ? '<br><span class="pslug">records no token — set apart: ' + esc(r.set_apart_reason) + '</span>'
      : '';
    return '<tr><td><span class="pname">' + esc(r.name) + '</span><br><span class="pslug">' + esc(r.slug) + '</span>' + note + '</td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td class="num">' + compact(r.tvl_usd) + '</td>' +
      '<td class="num">' + (r.mcap_usd == null ? '—' : compact(r.mcap_usd)) + '</td>' +
      '<td class="num ratio">' + (r.ratio == null ? '—' : r.ratio.toFixed(3)) + '</td></tr>';
  }).join('');

  // Sorting headers
  Array.prototype.forEach.call(document.querySelectorAll('th.sortable'), function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (sortKey === key) { sortDir = -sortDir; } else { sortKey = key; sortDir = DEFAULT_DIR[key] || 1; }
      markSort(); renderBoard();
    });
  });
  function markSort() {
    Array.prototype.forEach.call(document.querySelectorAll('th.sortable'), function (th) {
      var old = th.querySelector('.arrow'); if (old) old.remove();
      if (th.getAttribute('data-sort') === sortKey) {
        var s = document.createElement('span'); s.className = 'arrow'; s.textContent = sortDir === 1 ? ' ▲' : ' ▼'; th.appendChild(s);
      }
    });
  }

  [qEl, catEl, chainEl, watchEl, limitEl].forEach(function (el) {
    el.addEventListener('input', renderBoard);
    el.addEventListener('change', renderBoard);
  });

  // ---- detail view -------------------------------------------------------------
  var boardView = document.getElementById('board-view');
  var detailView = document.getElementById('detail-view');

  function factor(label, value, note) {
    return '<div class="factor"><span>' + label + '</span><b>' + value + '</b></div>' +
      (note ? '<div class="factor"><span>' + note + '</span><b></b></div>' : '');
  }

  function renderDetail(r) {
    var m = r.model;
    var ageTxt = r.age_days == null ? 'not recorded' : r.age_days.toLocaleString('en-US') + ' days (' + (r.age_days / 365.25).toFixed(2) + ' years)';
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    detailView.innerHTML =
      '<a class="backlink" href="#/">&larr; back to the board</a>' +
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' +
      (r.watchlist ? '<span class="badge">Watchlist</span>' : '<span class="badge early">Early — below the $50M floor</span>') +
      '<span class="detail-implied">' + usd(r.implied_value_usd) + '</span></div>' +
      '<p class="result-line">Rank #' + r.rank + ' of ' + rows.length + ' pre-token protocols · records no token in the snapshot (no market cap, no CoinGecko id, no symbol)</p>' +
      '<div class="detail-grid">' +
      '<section class="card"><h3>Snapshot record</h3><dl>' +
      '<dt>Slug</dt><dd>' + esc(r.slug) + '</dd>' +
      '<dt>Category</dt><dd>' + esc(r.category || '—') + '</dd>' +
      '<dt>Chains</dt><dd>' + esc(r.chains.join(', ') || '—') + '</dd>' +
      '<dt>TVL</dt><dd>' + usd(r.tvl_usd) + '</dd>' +
      '<dt>7d TVL change</dt><dd>' + (r.change_7d == null ? 'not reported' : r.change_7d.toFixed(2) + '%') + '</dd>' +
      '<dt>Tracked since</dt><dd>' + esc(r.listed_at || 'not recorded') + '</dd>' +
      '<dt>Age at snapshot</dt><dd>' + ageTxt + '</dd>' +
      '<dt>Market cap</dt><dd>none recorded</dd>' +
      '</dl></section>' +
      '<section class="card"><h3>How the model prices it</h3>' +
      factor('TVL base', usd(r.tvl_usd)) +
      factor('Peer ratio (mcap/TVL)', m.category_ratio.toFixed(4), null) +
      '<div class="factor"><span>ratio basis</span><b>' + (m.ratio_basis === 'category' ? 'category median · ' + m.ratio_peers + ' peers' : 'global median · ' + m.ratio_peers + ' peers') + '</b></div>' +
      factor('Momentum x', m.momentum.toFixed(4)) +
      factor('Maturity x', m.maturity.toFixed(4)) +
      factor('Breadth x', m.breadth.toFixed(4)) +
      factor('Implied value', usd(r.implied_value_usd)) +
      '<p style="color:var(--muted);font-size:13px;margin:10px 0 0">TVL x ratio x momentum x maturity x breadth, rounded to whole dollars. The same function prices every row; no name is special-cased.</p>' +
      '</section>' +
      '<section class="card wide"><h3>Farm plan — before any token exists</h3><ol class="plan">' + steps + '</ol></section>' +
      '</div>';
  }

  // ---- hash routing --------------------------------------------------------------
  var applyingHash = false;
  function route() {
    var h = location.hash || '#/';
    var proto = h.match(/^#\/protocol\/(.+)$/);
    var filt = h.match(/^#\/filter\/(.+)$/);
    if (proto) {
      var r = bySlug[decodeURIComponent(proto[1])];
      if (r) {
        renderDetail(r);
        boardView.hidden = true; detailView.hidden = false;
        window.scrollTo(0, 0);
        return;
      }
    }
    boardView.hidden = false; detailView.hidden = true;
    if (filt) {
      var cat = decodeURIComponent(filt[1]);
      applyingHash = true;
      if (catEl.value !== cat) { catEl.value = cat; }
      applyingHash = false;
    }
    renderBoard();
  }
  catEl.addEventListener('change', function () {
    if (applyingHash) return;
    if (catEl.value) location.hash = '#/filter/' + encodeURIComponent(catEl.value);
  });
  window.addEventListener('hashchange', route);
  markSort();
  route();
})();
