(function () {
  "use strict";
  var DATA = window.CONF_DATA || { conferences: [] };
  var CONFS = DATA.conferences;
  var AREAS = ["All"].concat(Array.from(new Set(CONFS.map(function (c) { return c.area; }))));
  var PALETTE = ["#2a7fb8", "#d1603d", "#3a9d6a", "#8b5cc7", "#c49a1d", "#d14f8a", "#4f6fd1", "#6f8f2a", "#c0504d", "#1f9aa5"];
  var DAY = 86400000;

  var state = { area: "All", q: "", projected: true, statsArea: "All", selected: ["NeurIPS", "ICML", "ICLR", "CVPR", "AAAI", "ICRA"] };

  function store(k, v) { try { localStorage.setItem("acd-" + k, JSON.stringify(v)); } catch (e) {} }
  function load(k, d) { try { var v = localStorage.getItem("acd-" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  state.projected = load("projected", true);
  state.selected = load("selected", state.selected);

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function pad(n) { return String(n).padStart(2, "0"); }
  var fmtLocal = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  var fmtDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

  // ---------- Deadlines ----------
  function nextFor(c, now) {
    var real = [];
    c.editions.forEach(function (e) {
      e.deadlines.forEach(function (d) {
        var t = Date.parse(d.utc);
        if (t > now) real.push({ d: d, t: t, ed: e });
      });
    });
    real.sort(function (a, b) { return a.t - b.t; });
    if (real.length) return { items: real, projected: false, year: real[0].ed.year, link: real[0].ed.link, place: real[0].ed.place, date: real[0].ed.date };
    if (c.estimate) {
      var est = c.estimate.deadlines.map(function (d) { return { d: d, t: Date.parse(d.utc) }; })
        .filter(function (x) { return x.t > now; }).sort(function (a, b) { return a.t - b.t; });
      var last = c.editions[c.editions.length - 1];
      if (est.length) return { items: est, projected: true, year: c.estimate.year, from: c.estimate.from_year, link: c.estimate.link || last.link };
    }
    return null;
  }

  function urgency(ms) { return ms < 7 * DAY ? "urgent" : ms < 30 * DAY ? "soon" : "calm"; }

  function renderChips(container, current, onPick) {
    container.innerHTML = "";
    AREAS.forEach(function (a) {
      var b = el("button", { class: "chip", "aria-pressed": String(a === current), type: "button" }, esc(a));
      b.addEventListener("click", function () { onPick(a); });
      container.appendChild(b);
    });
  }

  function renderDeadlines() {
    var now = Date.now();
    var list = document.getElementById("deadline-list");
    var q = state.q.trim().toLowerCase();
    var rows = CONFS.map(function (c) { return { c: c, n: nextFor(c, now) }; })
      .filter(function (r) { return r.n; })
      .filter(function (r) { return state.area === "All" || r.c.area === state.area; })
      .filter(function (r) { return state.projected || !r.n.projected; })
      .filter(function (r) { return !q || (r.c.title + " " + r.c.description).toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return a.n.items[0].t - b.n.items[0].t; });

    list.innerHTML = "";
    if (!rows.length) { list.appendChild(el("div", { class: "empty" }, "No conferences match. Clear the search or pick another area.")); return; }

    rows.forEach(function (r) {
      var c = r.c, n = r.n, first = n.items[0];
      var row = el("div", { class: "row" + (n.projected ? " projected" : ""), "data-urgency": n.projected ? "projected" : urgency(first.t - now) });
      row.appendChild(el("div", { class: "stripe" }));

      var rank = c.core && c.core !== "N" ? '<span class="badge" title="CORE rank">CORE ' + esc(c.core) + "</span>" : "";
      var proj = n.projected ? '<span class="badge proj" title="Not announced yet">Projected</span>' : "";
      var meta = [c.description, n.place].filter(Boolean).map(esc).join(" · ");
      row.appendChild(el("div", { class: "name" },
        '<h3><a href="' + esc(n.link) + '" target="_blank" rel="noopener">' + esc(c.title) + " " + n.year + "</a>" + rank + proj + "</h3><p>" + meta + "</p>"));

      var others = n.items.slice(1, 3).map(function (x) { return esc(x.d.label) + ": " + fmtDay.format(new Date(x.t)); }).join(" · ");
      var noteText = n.projected ? "Estimated from the " + n.from + " deadline. Check the official site." : (first.d.note || "");
      row.appendChild(el("div", { class: "dates" },
        '<div class="lbl">' + esc(first.d.label) + (/deadline/i.test(first.d.label) ? "" : " deadline") + "</div>" +
        '<div class="when">' + (n.projected ? "~" + fmtDay.format(new Date(first.t)) : fmtLocal.format(new Date(first.t))) + "</div>" +
        (n.projected ? "" : '<div class="aoe">' + esc(first.d.local) + "</div>") +
        (others ? '<div class="others">' + others + "</div>" : "") +
        (noteText ? '<div class="note">' + esc(noteText) + "</div>" : "")));

      var cd = el("div", { class: "count", "data-t": String(first.t), "data-proj": n.projected ? "1" : "" });
      row.appendChild(cd);
      list.appendChild(row);
    });
    tick();
  }

  function tick() {
    var now = Date.now();
    document.querySelectorAll(".count").forEach(function (cd) {
      var ms = Math.max(0, +cd.dataset.t - now);
      var d = Math.floor(ms / DAY), h = Math.floor(ms % DAY / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
      cd.innerHTML = cd.dataset.proj
        ? '<div class="days">~' + d + "<small>days</small></div>"
        : '<div class="days">' + d + "<small>days</small></div><div class=\"hms\">" + pad(h) + ":" + pad(m) + ":" + pad(s) + "</div>";
      if (ms === 0 && !cd.dataset.done) { cd.dataset.done = "1"; setTimeout(renderDeadlines, 1500); }
    });
    var aoe = new Date(now - 12 * 3600000);
    document.getElementById("aoe-clock").textContent = aoe.getUTCFullYear() + "-" + pad(aoe.getUTCMonth() + 1) + "-" + pad(aoe.getUTCDate()) + " " + pad(aoe.getUTCHours()) + ":" + pad(aoe.getUTCMinutes()) + ":" + pad(aoe.getUTCSeconds());
    document.getElementById("local-clock").textContent = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  // ---------- Statistics ----------
  var rateChart, subChart, tableSort = { key: "rate", dir: 1 };
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function colorFor(title) {
    var i = state.selected.indexOf(title);
    return i < 0 ? "var(--muted)" : PALETTE[i % PALETTE.length];
  }
  function statConfs() { return CONFS.filter(function (c) { return c.rates.length && (state.statsArea === "All" || c.area === state.statsArea); }); }

  function renderPicker() {
    var p = document.getElementById("series-picker");
    p.innerHTML = "";
    statConfs().forEach(function (c) {
      var on = state.selected.indexOf(c.title) >= 0;
      var b = el("button", { class: "chip", type: "button", "aria-pressed": String(on), style: "--c:" + colorFor(c.title) }, esc(c.title));
      b.addEventListener("click", function () {
        var i = state.selected.indexOf(c.title);
        if (i >= 0) state.selected.splice(i, 1); else state.selected.push(c.title);
        store("selected", state.selected);
        renderPicker(); renderCharts();
      });
      p.appendChild(b);
    });
  }

  function renderCharts() {
    if (!window.Chart) return;
    var shown = statConfs().filter(function (c) { return state.selected.indexOf(c.title) >= 0; });
    var years = Array.from(new Set([].concat.apply([], shown.map(function (c) { return c.rates.map(function (r) { return r.year; }); })))).sort();
    var ink = cssVar("--muted"), grid = cssVar("--line");
    function ds(field) {
      return shown.map(function (c) {
        var byYear = {}; c.rates.forEach(function (r) { byYear[r.year] = r; });
        return {
          label: c.title, borderColor: colorFor(c.title), backgroundColor: colorFor(c.title),
          data: years.map(function (y) { return byYear[y] ? (field === "rate" ? +(byYear[y].rate * 100).toFixed(1) : byYear[y].submitted) : null; }),
          spanGaps: true, tension: 0.25, pointRadius: 3, borderWidth: 2
        };
      });
    }
    function opts(yfmt) {
      return {
        responsive: true, maintainAspectRatio: false, interaction: { mode: "nearest", intersect: false },
        plugins: { legend: { labels: { color: ink, boxWidth: 10, font: { family: "IBM Plex Sans" } } },
                   tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": " + yfmt(c.parsed.y); } } } },
        scales: { x: { ticks: { color: ink }, grid: { color: grid } },
                  y: { ticks: { color: ink, callback: yfmt }, grid: { color: grid }, beginAtZero: true } }
      };
    }
    var pct = function (v) { return v + "%"; }, num = function (v) { return Number(v).toLocaleString(); };
    if (rateChart) rateChart.destroy();
    if (subChart) subChart.destroy();
    rateChart = new Chart(document.getElementById("rate-chart"), { type: "line", data: { labels: years, datasets: ds("rate") }, options: opts(pct) });
    subChart = new Chart(document.getElementById("sub-chart"), { type: "line", data: { labels: years, datasets: ds("submitted") }, options: opts(num) });
  }

  function spark(rates) {
    var pts = rates.slice(-6), w = 70, h = 20;
    if (pts.length < 2) return "";
    var vals = pts.map(function (r) { return r.rate; }), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = hi - lo || 0.01;
    var path = pts.map(function (r, i) { return (i ? "L" : "M") + (i * w / (pts.length - 1)).toFixed(1) + " " + (h - 2 - (r.rate - lo) / span * (h - 4)).toFixed(1); }).join(" ");
    var lx = w, ly = h - 2 - (vals[vals.length - 1] - lo) / span * (h - 4);
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="-2 0 ' + (w + 4) + " " + h + '" aria-hidden="true"><path d="' + path + '" fill="none" stroke="var(--accent)" stroke-width="1.5"/><circle cx="' + lx + '" cy="' + ly.toFixed(1) + '" r="2.5" fill="var(--accent)"/></svg>';
  }

  function renderTable() {
    var t = document.getElementById("stats-table");
    var rows = statConfs().map(function (c) {
      var r = c.rates[c.rates.length - 1], prev = c.rates.length > 1 ? c.rates[c.rates.length - 2] : null;
      return { c: c, r: r, growth: prev ? (r.submitted / prev.submitted - 1) / (r.year - prev.year) : null };
    });
    var keyFn = { name: function (x) { return x.c.title.toLowerCase(); }, area: function (x) { return x.c.area; }, year: function (x) { return x.r.year; },
      submitted: function (x) { return x.r.submitted; }, accepted: function (x) { return x.r.accepted; }, rate: function (x) { return x.r.rate; },
      growth: function (x) { return x.growth == null ? -1e9 : x.growth; } }[tableSort.key];
    rows.sort(function (a, b) { var A = keyFn(a), B = keyFn(b); return (A > B ? 1 : A < B ? -1 : 0) * tableSort.dir; });
    var cols = [["name", "Conference"], ["area", "Area"], ["year", "Year"], ["submitted", "Submitted"], ["accepted", "Accepted"], ["rate", "Acceptance"], ["growth", "Submission growth / yr"], ["trend", "Rate trend"]];
    var head = "<thead><tr>" + cols.map(function (c) {
      var s = tableSort.key === c[0] ? ' aria-sort="' + (tableSort.dir > 0 ? "ascending" : "descending") + '"' : "";
      return "<th data-k=\"" + c[0] + "\"" + s + ">" + c[1] + (s ? (tableSort.dir > 0 ? " ↑" : " ↓") : "") + "</th>";
    }).join("") + "</tr></thead>";
    var body = rows.map(function (x) {
      var pctv = (x.r.rate * 100).toFixed(1);
      var g = x.growth == null ? "—" : (x.growth >= 0 ? "+" : "") + (x.growth * 100).toFixed(0) + "%";
      return "<tr><td>" + (x.r.source ? '<a href="' + esc(x.r.source) + '" target="_blank" rel="noopener">' + esc(x.c.title) + "</a>" : esc(x.c.title)) + "</td><td>" + esc(x.c.area) +
        "</td><td>" + x.r.year + "</td><td>" + x.r.submitted.toLocaleString() + "</td><td>" + x.r.accepted.toLocaleString() +
        '</td><td class="rate"><b>' + pctv + '%</b><span class="bar" style="width:' + Math.round(x.r.rate * 120) + 'px"></span></td><td>' + g + "</td><td>" + spark(x.c.rates) + "</td></tr>";
    }).join("");
    t.innerHTML = head + "<tbody>" + body + "</tbody>";
    t.querySelectorAll("th").forEach(function (th) {
      if (th.dataset.k === "trend") return;
      th.addEventListener("click", function () {
        var k = th.dataset.k;
        tableSort = { key: k, dir: tableSort.key === k ? -tableSort.dir : (k === "name" || k === "area" || k === "rate" ? 1 : -1) };
        renderTable();
      });
    });
  }

  function renderStats() { renderPicker(); renderCharts(); renderTable(); }

  // ---------- Wiring ----------
  function setView(v) {
    document.getElementById("view-deadlines").hidden = v !== "deadlines";
    document.getElementById("view-stats").hidden = v !== "stats";
    document.querySelectorAll("nav.tabs button").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.view === v)); });
    if (v === "stats") renderStats();
    try { history.replaceState(null, "", "#" + v); } catch (e) {}
  }
  document.querySelectorAll("nav.tabs button").forEach(function (b) { b.addEventListener("click", function () { setView(b.dataset.view); }); });

  function pickArea(a) { state.area = a; renderChips(document.getElementById("area-chips"), a, pickArea); renderDeadlines(); }
  function pickStatsArea(a) { state.statsArea = a; renderChips(document.getElementById("stats-area-chips"), a, pickStatsArea); renderStats(); }
  renderChips(document.getElementById("area-chips"), state.area, pickArea);
  renderChips(document.getElementById("stats-area-chips"), state.statsArea, pickStatsArea);

  document.getElementById("search").addEventListener("input", function (e) { state.q = e.target.value; renderDeadlines(); });
  var proj = document.getElementById("show-projected");
  proj.checked = state.projected;
  proj.addEventListener("change", function () { state.projected = proj.checked; store("projected", proj.checked); renderDeadlines(); });

  if (DATA.generated) document.getElementById("updated").textContent = "Data last refreshed " + fmtDay.format(new Date(DATA.generated)) + ".";
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (!document.getElementById("view-stats").hidden) renderCharts(); });

  renderDeadlines();
  setView(location.hash === "#stats" ? "stats" : "deadlines");
  setInterval(tick, 1000);
})();
