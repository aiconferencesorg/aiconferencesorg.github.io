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
      var rulesLink = (DATA.policies || []).some(function (p) { return p.keys.indexOf(c.key) >= 0; })
        ? '<a class="badge rules" href="#rules" data-rules="' + esc(c.key) + '">Rules</a>' : "";
      var meta = [c.description, n.place].filter(Boolean).map(esc).join(" · ");
      row.appendChild(el("div", { class: "name" },
        '<h3><a href="' + esc(n.link) + '" target="_blank" rel="noopener">' + esc(c.title) + " " + n.year + "</a>" + rank + proj + rulesLink + "</h3><p>" + meta + "</p>"));

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
    document.querySelectorAll(".count[data-t]").forEach(function (cd) {
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

  // ---------- Jobs ----------
  var JOBS = window.JOBS_DATA || { jobs: [], boards: [], more_academic: [] };
  var jobState = { sector: load("sector", "academic"), type: "All", q: "", org: "" };
  var JOB_TYPES = { academic: ["All", "Faculty", "Postdoc", "PhD", "Research staff"], industry: ["All", "Research", "Engineering", "Internship"] };
  var fmtShort = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  function parseDay(s) { return s ? new Date(s + "T23:59:59") : null; }

  function jobsFor(sector) { return JOBS.jobs.filter(function (j) { return j.sector === sector; }); }

  function renderJobControls() {
    document.querySelectorAll(".seg-btn").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.sector === jobState.sector)); });
    document.getElementById("n-academic").textContent = jobsFor("academic").length;
    document.getElementById("n-industry").textContent = jobsFor("industry").length;
    var types = JOB_TYPES[jobState.sector];
    if (types.indexOf(jobState.type) < 0) jobState.type = "All";
    var chips = document.getElementById("job-type-chips");
    chips.innerHTML = "";
    types.forEach(function (t) {
      var count = t === "All" ? null : jobsFor(jobState.sector).filter(function (j) { return j.type === t; }).length;
      if (count === 0) return;
      var b = el("button", { class: "chip", type: "button", "aria-pressed": String(t === jobState.type) }, esc(t) + (count ? ' <span class="n">' + count + "</span>" : ""));
      b.addEventListener("click", function () { jobState.type = t; renderJobControls(); renderJobs(); });
      chips.appendChild(b);
    });
    var orgs = Array.from(new Set(jobsFor(jobState.sector).map(function (j) { return j.org; }))).sort();
    if (orgs.indexOf(jobState.org) < 0) jobState.org = "";
    var sel = document.getElementById("job-org");
    sel.innerHTML = '<option value="">All ' + (jobState.sector === "academic" ? "institutions" : "companies") + "</option>" +
      orgs.map(function (o) { return '<option value="' + esc(o) + '"' + (o === jobState.org ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("");
  }

  function renderJobs() {
    var list = document.getElementById("job-list");
    var q = jobState.q.trim().toLowerCase();
    var now = Date.now();
    var rows = jobsFor(jobState.sector)
      .filter(function (j) { return jobState.type === "All" || j.type === jobState.type; })
      .filter(function (j) { return !jobState.org || j.org === jobState.org; })
      .filter(function (j) { return !q || [j.title, j.org, j.dept, j.location, j.areas].join(" ").toLowerCase().indexOf(q) >= 0; });
    // Academic: soonest upcoming deadline first. Industry: newest first.
    rows.sort(function (a, b) {
      if (jobState.sector === "academic") {
        var A = a.deadline ? parseDay(a.deadline).getTime() : Infinity, B = b.deadline ? parseDay(b.deadline).getTime() : Infinity;
        if (A < now) A += 1e13; if (B < now) B += 1e13;  // passed "review begins" dates sink below upcoming ones
        if (A !== B) return A - B;
        return (b.posted || "").localeCompare(a.posted || "");  // undated feed postings: newest first
      }
      return (b.posted || "").localeCompare(a.posted || "");
    });

    list.innerHTML = "";
    if (!rows.length) {
      var pending = jobState.sector === "industry" && !(JOBS.boards || []).length;
      list.appendChild(el("div", { class: "empty" }, pending
        ? "Industry roles load from company job boards on the first daily refresh. Run <b>Refresh site data</b> from the repo's Actions tab to fill this in now."
        : "No jobs match. Clear the search or pick another filter."));
      return;
    }
    rows.forEach(function (j) {
      var urg = "calm", when = "", whenSub = "";
      if (j.deadline) {
        var ms = parseDay(j.deadline).getTime() - now, days = Math.ceil(ms / DAY);
        if (ms >= 0) {
          urg = days <= 7 ? "urgent" : days <= 30 ? "soon" : "calm";
          when = '<div class="days">' + days + "<small>days</small></div>";
        } else {
          urg = "open";
          when = '<div class="status">Open</div>';
        }
        whenSub = '<div class="hms">' + esc(j.deadline_label || "Apply by") + " " + fmtShort.format(parseDay(j.deadline)) + "</div>";
        if (ms < 0 && j.rolling) whenSub = '<div class="hms">until filled</div>';
      } else if (j.posted) {
        var age = Math.max(0, Math.floor((now - parseDay(j.posted).getTime()) / DAY) + 1);
        urg = age <= 7 ? "fresh" : "calm";
        when = '<div class="status">' + (age <= 1 ? "New" : age + "d ago") + "</div>";
        whenSub = '<div class="hms">posted ' + fmtShort.format(parseDay(j.posted)) + "</div>";
      }
      else { urg = "open"; when = '<div class="status">Open</div>'; whenSub = '<div class="hms">until filled</div>'; }
      var row = el("div", { class: "row job", "data-urgency": urg });
      row.appendChild(el("div", { class: "stripe" }));
      row.appendChild(el("div", { class: "name" },
        '<h3><a href="' + esc(j.url) + '" target="_blank" rel="noopener">' + esc(j.title) + "</a></h3>" +
        "<p><b>" + esc(j.org) + "</b>" + (j.dept ? " · " + esc(j.dept) : "") + "</p>"));
      row.appendChild(el("div", { class: "dates" },
        '<div class="lbl">' + esc(j.type) + "</div>" +
        '<div class="when">' + esc(j.location || "Location not listed") + "</div>" +
        (j.rank ? '<div class="others">' + esc(j.rank) + "</div>" : "") +
        (j.areas ? '<div class="note">' + esc(j.areas) + "</div>" : "")));
      row.appendChild(el("div", { class: "count" }, when + whenSub));
      list.appendChild(row);
    });
  }

  function renderJobFoot() {
    var src = document.getElementById("jobs-source"), more = document.getElementById("more-academic");
    var boards = JOBS.boards || [];
    var gen = JOBS.generated ? fmtShort.format(new Date(JOBS.generated)) : "";
    if (jobState.sector === "industry") {
      src.innerHTML = boards.length
        ? "Pulled " + esc(gen) + " from the public job boards of " + boards.map(function (b) { return esc(b.name); }).join(", ") +
          ". Only research, AI, robotics and autonomy roles are kept. Listings refresh daily."
        : "Company boards are fetched daily.";
      more.innerHTML = linkBlock("Search big-company career sites", JOBS.more_industry);
    } else {
      var srcs = (JOBS.academic_sources || []);
      src.textContent = (srcs.length
        ? "Faculty, postdoc and PhD openings in AI, ML, robotics and autonomy, pulled " + gen + " from " + srcs.join(", ") + " and refreshed daily. Postings drop off once they close or turn 120 days old, plus a few verified listings with deadlines."
        : "Faculty, postdoc and PhD openings in AI, ML, robotics and autonomy. The daily refresh pulls new postings automatically.") +
        " Always check the posting for current details.";
      more.innerHTML = linkBlock("More academic openings", JOBS.more_academic);
    }
  }

  function linkBlock(label, items) {
    if (!items || !items.length) return "";
    return '<span class="lbl">' + esc(label) + '</span><div class="links">' + items.map(function (m) {
      return '<a href="' + esc(m.url) + '" target="_blank" rel="noopener">' + esc(m.name) + "</a>"; }).join("") + "</div>";
  }

  function renderJobsView() { renderJobControls(); renderJobs(); renderJobFoot(); }

  document.querySelectorAll(".seg-btn").forEach(function (b) {
    b.addEventListener("click", function () { jobState.sector = b.dataset.sector; store("sector", jobState.sector); renderJobsView(); });
  });
  document.getElementById("job-search").addEventListener("input", function (e) { jobState.q = e.target.value; renderJobs(); });
  document.getElementById("job-org").addEventListener("change", function (e) { jobState.org = e.target.value; renderJobs(); });

  // ---------- Code & datasets ----------
  var RES = window.RESOURCES_DATA || { conferences: [], years: [] };
  var KINDS = [["all", "All"], ["code", "Code"], ["data", "Datasets & benchmarks"], ["real", "Real-world"], ["list", "Paper lists"]];
  var KIND_LABEL = { code: "Code", data: "Dataset / benchmark", list: "Paper list" };
  var resState = { area: "All", kind: "all", q: "", conf: load("res-conf", "cvpr") };

  function fmtStars(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n); }
  function kindOk(i) { return resState.kind === "all" || (resState.kind === "real" ? i.real : i.kind === resState.kind); }
  function resConfs() { return RES.conferences.filter(function (c) { return resState.area === "All" || c.area === resState.area; }); }
  function countItems(c) { var n = 0; Object.keys(c.years).forEach(function (y) { n += c.years[y].items.filter(kindOk).length; }); return n; }

  function itemHtml(i) {
    var parts = i.repo.split("/");
    var tags = '<span class="tag tag-' + i.kind + '">' + KIND_LABEL[i.kind] + "</span>" +
      (i.real ? '<span class="tag tag-real">Real-world</span>' : "") +
      (i.award ? '<span class="tag tag-award">' + esc(i.award) + "</span>" : "");
    return '<li class="res"><div class="res-top"><a href="https://github.com/' + esc(i.repo) + '" target="_blank" rel="noopener">' +
      '<span class="owner">' + esc(parts[0]) + "/</span>" + esc(parts[1]) + '</a><span class="stars" title="GitHub stars">★ ' + fmtStars(i.stars) + "</span></div>" +
      (i.desc ? "<p>" + esc(i.desc) + "</p>" : "") + '<div class="tags">' + tags + "</div></li>";
  }

  function renderResControls() {
    renderChips(document.getElementById("res-area-chips"), resState.area, function (a) { resState.area = a; renderResources(); });
    var kc = document.getElementById("res-kind-chips");
    kc.innerHTML = "";
    KINDS.forEach(function (k) {
      var b = el("button", { class: "chip", type: "button", "aria-pressed": String(k[0] === resState.kind) }, esc(k[1]));
      b.addEventListener("click", function () { resState.kind = k[0]; renderResources(); });
      kc.appendChild(b);
    });
  }

  function renderResources() {
    renderResControls();
    var picker = document.getElementById("res-conf-picker"), body = document.getElementById("res-body");
    var confs = resConfs();
    var q = resState.q.trim().toLowerCase();
    picker.hidden = !!q;
    if (q) {
      var hits = [];
      RES.conferences.forEach(function (c) {
        if (resState.area !== "All" && c.area !== resState.area) return;
        Object.keys(c.years).forEach(function (y) {
          c.years[y].items.forEach(function (i) {
            if (kindOk(i) && (i.repo + " " + i.desc).toLowerCase().indexOf(q) >= 0) hits.push({ c: c, y: y, i: i });
          });
        });
      });
      hits.sort(function (a, b) { return b.i.stars - a.i.stars; });
      body.innerHTML = hits.length
        ? '<p class="res-count">' + hits.length + " repositories match.</p><ul class=\"res-list res-search\">" + hits.slice(0, 150).map(function (h) {
            return itemHtml(h.i).replace('<div class="tags">', '<div class="tags"><span class="tag tag-venue">' + esc(h.c.title) + " " + h.y + "</span>");
          }).join("") + "</ul>"
        : '<div class="empty">No repositories match. Try a broader word, or clear the filters.</div>';
      return;
    }
    if (!confs.some(function (c) { return c.key === resState.conf; })) resState.conf = confs.length ? confs[0].key : "";
    picker.innerHTML = "";
    confs.forEach(function (c) {
      var b = el("button", { class: "chip", type: "button", "aria-pressed": String(c.key === resState.conf) }, esc(c.title) + ' <span class="n">' + countItems(c) + "</span>");
      b.addEventListener("click", function () { resState.conf = c.key; store("res-conf", c.key); renderResources(); });
      picker.appendChild(b);
    });
    var conf = RES.conferences.filter(function (c) { return c.key === resState.conf; })[0];
    if (!conf) { body.innerHTML = '<div class="empty">No conferences in this area.</div>'; return; }
    var cols = RES.years.map(function (y) {
      var cell = conf.years[y];
      var items = cell ? cell.items.filter(kindOk) : [];
      var head = '<div class="yr-head"><h3>' + esc(conf.title) + " " + y + "</h3>" +
        (cell && cell.link ? '<a href="' + esc(cell.link) + '" target="_blank" rel="noopener">Conference site</a>' : "") + "</div>";
      var list = !cell
        ? '<p class="res-none">No ' + esc(conf.title) + " in " + y + ".</p>"
        : items.length ? '<ul class="res-list">' + items.map(itemHtml).join("") + "</ul>"
        : '<p class="res-none">' + (cell.items.length ? "Nothing in this filter." : "No repositories tagged " + esc(conf.title) + " " + y + " yet.") + "</p>";
      return '<div class="yr-col">' + head + list + "</div>";
    }).join("");
    body.innerHTML = '<p class="res-desc">' + esc(conf.description) + '</p><div class="yr-grid">' + cols + "</div>";
  }

  function renderResFoot() {
    var gen = RES.generated ? fmtShort.format(new Date(RES.generated)) : "";
    document.getElementById("res-source").textContent =
      "The most-starred GitHub repositories tagged with each conference and year (for example “[CVPR 2025]”), refreshed daily" +
      (gen ? ", last on " + gen : "") + ". Labels come from each repo’s own description: “Real-world” marks real-robot, sim-to-real or in-the-wild results; awards are as the authors state them.";
  }

  document.getElementById("res-search").addEventListener("input", function (e) { resState.q = e.target.value; renderResources(); });

  // ---------- Calendar feeds ----------
  function feedUrl(slug) { try { return new URL("data/calendar/" + slug + ".ics", location.href).href; } catch (e) { return "data/calendar/" + slug + ".ics"; } }
  function renderCalBar() {
    var slug = document.getElementById("cal-feed").value, https = feedUrl(slug), webcal = https.replace(/^https?:/, "webcal:");
    document.getElementById("cal-webcal").href = webcal;
    document.getElementById("cal-google").href = "https://calendar.google.com/calendar/render?cid=" + encodeURIComponent(webcal);
    document.getElementById("cal-copy").dataset.url = https;
  }
  document.getElementById("cal-feed").addEventListener("change", function (e) { store("cal-feed", e.target.value); renderCalBar(); });
  document.getElementById("cal-copy").addEventListener("click", function (e) {
    var url = e.currentTarget.dataset.url, hint = document.getElementById("cal-hint");
    var done = function () { hint.textContent = "Link copied. Paste it into your calendar app's “Subscribe to calendar” option."; };
    try {
      navigator.clipboard.writeText(url).then(done, function () { hint.textContent = url; });
    } catch (err) { hint.textContent = url; }
  });
  (function () { var f = load("cal-feed", "all"); var sel = document.getElementById("cal-feed"); if (sel.querySelector('option[value="' + f + '"]')) sel.value = f; renderCalBar(); })();

  // ---------- Resubmit planner ----------
  var rsState = { area: "All", projected: true };
  var fmtLong = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

  function dayStart(iso) { var d = new Date(iso + "T00:00:00"); return d.getTime(); }
  function isoDay(t) { var d = new Date(t); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  function sources() {
    var now = Date.now(), out = [];
    CONFS.forEach(function (c) {
      c.editions.forEach(function (e) {
        (e.decisions || []).forEach(function (d) {
          var t = Date.parse(d.utc);
          if (t > now - 21 * DAY) out.push({ key: c.key, title: c.title, year: e.year, area: c.area, t: t, label: d.label, day: d.local.slice(0, 10) });
        });
      });
    });
    return out.sort(function (a, b) { return a.t - b.t; });
  }

  function slotsFor(c) {
    // One slot per submission round: the first required step (abstract) is the binding date.
    var slots = [];
    (c.planning || []).forEach(function (p) {
      var groups = {};
      p.deadlines.forEach(function (d) {
        var round = (d.label.split(" · ")[1] || "").replace(/^(ARR )?Submission$/i, "");
        (groups[round] = groups[round] || []).push(d);
      });
      Object.keys(groups).forEach(function (r) {
        var ds = groups[r].map(function (d) { return { d: d, t: Date.parse(d.utc) }; }).sort(function (a, b) { return a.t - b.t; });
        slots.push({ year: p.year, projected: p.projected, link: p.link, date: p.date, round: r,
                     bind: ds[0], paper: ds[ds.length - 1] });
      });
    });
    return slots.sort(function (a, b) { return a.bind.t - b.bind.t; });
  }

  function latestRate(c) { var r = c.rates[c.rates.length - 1]; return r ? (r.rate * 100).toFixed(1) + "% (" + r.year + ")" : "—"; }

  function renderResubmitForm() {
    var sel = document.getElementById("rs-source");
    if (!sel.options.length) {
      sources().forEach(function (s, i) {
        var o = document.createElement("option");
        o.value = String(i); o.textContent = s.title + " " + s.year + (s.label ? " (" + s.label + ")" : "") + " — decisions " + fmtShort.format(new Date(s.day + "T12:00:00"));
        o.dataset.key = s.key; o.dataset.year = s.year; o.dataset.day = s.day; o.dataset.area = s.area;
        sel.appendChild(o);
      });
      var custom = document.createElement("option"); custom.value = "custom"; custom.textContent = "Another venue (enter the date)"; sel.appendChild(custom);
      var saved = load("rs-source", null), pick = 0;
      for (var i = 0; i < sel.options.length; i++) if (sel.options[i].dataset.key + sel.options[i].dataset.year === saved) pick = i;
      if (!saved) for (var j = 0; j < sel.options.length; j++) if (sel.options[j].dataset.key === "cvpr") { pick = j; break; }
      sel.selectedIndex = pick;
      syncDateFromSource();
    }
    renderChips(document.getElementById("rs-area-chips"), rsState.area, function (a) { rsState.area = a; renderResubmit(); });
  }

  function syncDateFromSource() {
    var o = document.getElementById("rs-source").selectedOptions[0];
    if (o && o.dataset.day) document.getElementById("rs-date").value = o.dataset.day;
    else if (!document.getElementById("rs-date").value) document.getElementById("rs-date").value = isoDay(Date.now());
  }

  function rowHtml(r, start) {
    var c = r.c, s = r.slot, days = Math.round((s.bind.t - start) / DAY);
    var rank = c.core && c.core !== "N" ? '<span class="badge">CORE ' + esc(c.core) + "</span>" : "";
    var proj = s.projected ? '<span class="badge proj">Projected</span>' : "";
    var step = s.bind.d.label.split(" · ")[0];
    var paperLine = s.paper.t !== s.bind.t ? '<div class="others">Paper due ' + fmtShort.format(new Date(s.paper.t)) + "</div>" : "";
    return '<div class="row' + (s.projected ? " projected" : "") + '" data-urgency="' + (s.projected ? "projected" : days < 21 ? "soon" : "calm") + '">' +
      '<div class="stripe"></div>' +
      '<div class="name"><h3><a href="' + esc(s.link || (c.editions[c.editions.length - 1] || {}).link || "#") + '" target="_blank" rel="noopener">' + esc(c.title) + " " + s.year + "</a>" + rank + proj + "</h3>" +
      "<p>" + esc(c.area) + " · acceptance " + latestRate(c) + (s.date ? " · " + esc(s.date) : "") + "</p></div>" +
      '<div class="dates"><div class="lbl">' + esc(step) + (s.round ? " · " + esc(s.round) : "") + (/deadline/i.test(step + s.round) ? "" : " deadline") + "</div>" +
      '<div class="when">' + (s.projected ? "~" : "") + fmtLong.format(new Date(s.bind.t)) + "</div>" + paperLine + "</div>" +
      '<div class="count"><div class="days">' + days + "<small>days</small></div><div class=\"hms\">after decision</div></div></div>";
  }

  function renderResubmit() {
    renderResubmitForm();
    var sel = document.getElementById("rs-source"), o = sel.selectedOptions[0];
    var dateVal = document.getElementById("rs-date").value;
    var buffer = Math.max(0, Math.min(120, parseInt(document.getElementById("rs-buffer").value, 10) || 0));
    var list = document.getElementById("rs-list"), tightBox = document.getElementById("rs-tight"), summary = document.getElementById("rs-summary");
    if (!dateVal) { summary.textContent = "Pick a decision date to see where the paper can go next."; list.innerHTML = ""; tightBox.innerHTML = ""; return; }
    var start = dayStart(dateVal), ready = start + buffer * DAY, horizon = start + 365 * DAY;
    var srcKey = o && o.dataset.key, srcYear = o && +o.dataset.year;
    var fits = [], tight = [];
    CONFS.forEach(function (c) {
      if (rsState.area !== "All" && c.area !== rsState.area) return;
      var slots = slotsFor(c).filter(function (s) { return rsState.projected || !s.projected; })
        .filter(function (s) { return !(c.key === srcKey && s.year === srcYear); });
      var first = slots.filter(function (s) { return s.bind.t >= start && s.bind.t <= horizon; })[0];
      if (!first) return;
      if (first.bind.t >= ready) { fits.push({ c: c, slot: first }); return; }
      tight.push({ c: c, slot: first });
      var next = slots.filter(function (s) { return s.bind.t >= ready && s.bind.t <= horizon; })[0];
      if (next) fits.push({ c: c, slot: next });
    });
    fits.sort(function (a, b) { return a.slot.bind.t - b.slot.bind.t; });
    tight.sort(function (a, b) { return a.slot.bind.t - b.slot.bind.t; });
    var srcName = o && o.dataset.key ? o.textContent.split(" — ")[0] : "your venue";
    summary.innerHTML = "If " + esc(srcName) + " says no on <b>" + fmtLong.format(new Date(start)) + "</b>, you can be ready by <b>" +
      fmtLong.format(new Date(ready)) + "</b>. <b>" + fits.length + "</b> venue" + (fits.length === 1 ? "" : "s") + " fit in the following 12 months.";
    list.innerHTML = fits.length ? fits.map(function (r) { return rowHtml(r, start); }).join("")
      : '<div class="empty">Nothing fits in the next 12 months with these settings. Try fewer revision days or another area.</div>';
    tightBox.innerHTML = tight.length
      ? '<h3 class="rs-sub">Too tight for ' + buffer + " revision days</h3><div class=\"list muted-list\">" + tight.map(function (r) { return rowHtml(r, start); }).join("") + "</div>"
      : "";
  }

  document.getElementById("rs-source").addEventListener("change", function (e) {
    var o = e.target.selectedOptions[0];
    try { store("rs-source", o.dataset.key ? o.dataset.key + o.dataset.year : "custom"); } catch (err) {}
    syncDateFromSource(); renderResubmit();
  });
  document.getElementById("rs-date").addEventListener("input", renderResubmit);
  document.getElementById("rs-buffer").addEventListener("input", function (e) { store("rs-buffer", e.target.value); renderResubmit(); });
  document.getElementById("rs-projected").addEventListener("change", function (e) { rsState.projected = e.target.checked; renderResubmit(); });
  document.getElementById("rs-buffer").value = load("rs-buffer", 14);

  // ---------- Submission rules ----------
  var POLICIES = DATA.policies || [];
  var rulesState = { area: "All", q: "" };
  var RULE_FIELDS = [["pages", "Page limit"], ["llm", "AI / LLM use"], ["reviewing", "Reviewing duty"], ["preprints", "Preprints & anonymity"], ["dual", "Dual submission"], ["max", "Max papers per author"]];
  function confByKey(k) { return CONFS.filter(function (c) { return c.key === k; })[0]; }
  function policyFor(key) { return POLICIES.filter(function (p) { return p.keys.indexOf(key) >= 0; })[0]; }
  function policyArea(p) { var c = confByKey(p.keys[0]); return c ? c.area : ""; }

  function renderRules(focusKey) {
    renderChips(document.getElementById("rules-area-chips"), rulesState.area, function (a) { rulesState.area = a; renderRules(); });
    var q = rulesState.q.trim().toLowerCase(), grid = document.getElementById("rules-grid");
    var items = POLICIES.filter(function (p) { return rulesState.area === "All" || policyArea(p) === rulesState.area; })
      .filter(function (p) { return !q || JSON.stringify(p).toLowerCase().indexOf(q) >= 0; });
    if (!items.length) { grid.innerHTML = '<div class="empty">No rules match. Clear the search or pick another area.</div>'; return; }
    grid.innerHTML = items.map(function (p) {
      var titles = p.keys.map(function (k) { var c = confByKey(k); return c ? c.title : k.toUpperCase(); }).join(" · ");
      var rows = RULE_FIELDS.map(function (f) {
        var v = p[f[0]];
        return "<dt>" + f[1] + "</dt><dd" + (v ? "" : ' class="ns"') + ">" + (v ? esc(v) : "Not stated in the call") + "</dd>";
      }).join("");
      var checked = p.checked ? fmtShort.format(new Date(p.checked + "T12:00:00")) : "";
      return '<article class="rule-card" id="rules-' + esc(p.keys[0]) + '"><header><h3>' + esc(titles) + "</h3>" +
        '<p class="rule-ed">' + esc(p.edition) + (checked ? " · checked " + checked : "") + ' · <a href="' + esc(p.source) + '" target="_blank" rel="noopener">Official call</a></p></header>' +
        (p.watch ? '<div class="watch"><span>Watch out</span>' + esc(p.watch) + "</div>" : "") +
        "<dl>" + rows + "</dl></article>";
    }).join("");
    if (focusKey) {
      var card = document.getElementById("rules-" + focusKey);
      if (card) { card.classList.add("flash"); card.scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(function () { card.classList.remove("flash"); }, 1600); }
    }
  }
  document.getElementById("rules-search").addEventListener("input", function (e) { rulesState.q = e.target.value; renderRules(); });
  document.getElementById("deadline-list").addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("[data-rules]");
    if (!a) return;
    e.preventDefault();
    var p = policyFor(a.dataset.rules);
    rulesState.area = "All"; rulesState.q = "";
    document.getElementById("rules-search").value = "";
    setView("rules");
    renderRules(p ? p.keys[0] : null);
  });

  // ---------- Wiring ----------
  function setView(v) {
    document.getElementById("view-deadlines").hidden = v !== "deadlines";
    document.getElementById("view-stats").hidden = v !== "stats";
    document.getElementById("view-jobs").hidden = v !== "jobs";
    document.getElementById("view-resources").hidden = v !== "resources";
    document.getElementById("view-resubmit").hidden = v !== "resubmit";
    document.getElementById("view-rules").hidden = v !== "rules";
    document.querySelectorAll("nav.tabs button").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.view === v)); });
    if (v === "stats") renderStats();
    if (v === "jobs") renderJobsView();
    if (v === "resources") { renderResources(); renderResFoot(); }
    if (v === "resubmit") renderResubmit();
    if (v === "rules") renderRules();
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
  setView(location.hash === "#stats" ? "stats" : location.hash === "#jobs" ? "jobs" : location.hash === "#resources" ? "resources" : location.hash === "#resubmit" ? "resubmit" : location.hash === "#rules" ? "rules" : "deadlines");
  setInterval(tick, 1000);
})();
