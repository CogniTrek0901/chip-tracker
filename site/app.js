/* 大戶籌碼追蹤 — 前端篩選與呈現（無外部套件） */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const F = { b400: 0, b1000: 1, rPct: 2, rPpl: 3, tPpl: 4, p400: 5, p1000: 6 };
  const PAGE = 200;

  let D = null;          // summary
  let rows = [];         // 預先計算好的每檔指標
  let tab = "streak";
  let sort = null;       // {key, dir}
  let limit = PAGE;
  let current = [];      // 目前顯示的清單

  // ---------- 本機偏好（可能不可用，一律 try/catch） ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("chip:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("chip:" + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  let watch = new Set(store.get("watch", []));

  // ---------- 載入 ----------
  async function load() {
    if (window.__SUMMARY__) return window.__SUMMARY__;
    const r = await fetch("data/summary.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  function prep() {
    const L = D.dates.length - 1;
    rows = D.stocks.map((st) => {
      const s = st.s;
      const v = (i, f) => (i >= 0 && s[i] ? s[i][f] : null);
      const diff = (i, f) => { const a = v(i, f), b = v(i - 1, f); return a == null || b == null ? null : a - b; };
      const streak = (f, sign) => { let n = 0; for (let i = L; i > 0; i--) { const d = diff(i, f); if (d == null || !(d * sign > 0)) break; n++; } return n; };
      const avgAbs = (f, w = 12) => { let t = 0, n = 0; for (let i = L - 1; i > 0 && n < w; i--) { const d = diff(i, f); if (d != null) { t += Math.abs(d); n++; } } return n ? t / n : null; };
      const last = s[L];
      const rPplPrev = v(L - 1, F.rPpl), tPplPrev = v(L - 1, F.tPpl);
      return {
        st, code: st.c, name: st.n, market: st.m, ind: st.i, price: st.p,
        b400: last[F.b400], b1000: last[F.b1000], rPct: last[F.rPct], rPpl: last[F.rPpl], tPpl: last[F.tPpl],
        d400: diff(L, F.b400), d1000: diff(L, F.b1000), dR: diff(L, F.rPct),
        dRpplPct: rPplPrev ? (last[F.rPpl] - rPplPrev) * 100 / rPplPrev : null,
        dTpplPct: tPplPrev ? (last[F.tPpl] - tPplPrev) * 100 / tPplPrev : null,
        su400: streak(F.b400, 1), su1000: streak(F.b1000, 1),
        sdR: streak(F.rPct, -1), sdRppl: streak(F.rPpl, -1),
        avg400: avgAbs(F.b400), avg1000: avgAbs(F.b1000),
        chg: (f, m) => { const a = v(L, f), b = v(L - m, f); return a == null || b == null ? null : a - b; },
        hay: (st.c + " " + st.n + " " + st.i).toLowerCase(),
      };
    });
  }

  // ---------- 篩選條件 ----------
  const num = (id) => { const x = $(id).value.trim(); return x === "" ? null : Number(x); };
  function cfg() {
    return {
      N: +$("#streakN").value, big: $("#streakBig").value, retail: $("#streakRetail").value,
      M: +$("#cumM").value, cBig: num("#cumBig"), cBig1000: num("#cumBig1000"), cR: num("#cumRetail"),
      j400: num("#jump400"), j1000: num("#jump1000"), jX: num("#jumpX") || 0,
    };
  }
  const bigStreak = (r, c) => ({ 400: r.su400, 1000: r.su1000, either: Math.max(r.su400, r.su1000), both: Math.min(r.su400, r.su1000) }[c.big]);
  const retailStreak = (r, c) => ({ pct: r.sdR, ppl: r.sdRppl, both: Math.min(r.sdR, r.sdRppl), none: Infinity }[c.retail]);

  const pass = {
    streak: (r, c) => bigStreak(r, c) >= c.N && retailStreak(r, c) >= c.N,
    cum: (r, c) => {
      const a = r.chg(F.b400, c.M), b = r.chg(F.b1000, c.M), k = r.chg(F.rPct, c.M);
      if (a == null || k == null) return false;
      return (c.cBig == null || a >= c.cBig) && (c.cBig1000 == null || (b != null && b >= c.cBig1000)) && (c.cR == null || -k >= c.cR);
    },
    jump: (r, c) => {
      const ok4 = c.j400 != null && r.d400 != null && r.d400 >= c.j400 && (!c.jX || (r.avg400 && r.d400 / r.avg400 >= c.jX));
      const ok1 = c.j1000 != null && r.d1000 != null && r.d1000 >= c.j1000 && (!c.jX || (r.avg1000 && r.d1000 / r.avg1000 >= c.jX));
      return ok4 || ok1;
    },
  };
  pass.combo = (r, c) => (pass.streak(r, c) + pass.cum(r, c) + pass.jump(r, c)) >= 2;
  pass.watch = (r) => watch.has(r.code);
  pass.all = () => true;

  function baseFilter(r) {
    const q = $("#q").value.trim().toLowerCase();
    const m = $("#market").value, mp = +$("#minPrice").value || 0, mn = +$("#minPeople").value || 0;
    if (q && !r.hay.includes(q)) return false;
    if (m && r.market !== m) return false;
    if (mp && !(r.price >= mp)) return false;
    if (mn && !(r.tPpl >= mn)) return false;
    return true;
  }

  // ---------- 欄位 ----------
  const fmt = (x, d = 2) => (x == null || Number.isNaN(x) ? "–" : x.toFixed(d));
  const sgn = (x, d = 2, suffix = "") => x == null ? '<span class="d">–</span>' :
    `<span class="d ${x > 0 ? "up" : x < 0 ? "down" : ""}">${x > 0 ? "+" : ""}${x.toFixed(d)}${suffix}</span>`;
  const int = (x) => (x == null ? "–" : x.toLocaleString("zh-TW"));

  function cols(c) {
    return [
      { k: "star", t: "", cls: "star", html: (r) => watch.has(r.code) ? "★" : "☆", nosort: true },
      { k: "code", t: "股票", l: true, v: (r) => r.code, html: (r) => `<b>${r.code}</b> ${esc(r.name)}<small>${esc(r.ind)}</small>${r.market === "上櫃" ? '<span class="tag">櫃</span>' : ""}${tags(r, c)}`, cls: "name" },
      { k: "price", t: "股價", v: (r) => r.price, html: (r) => fmt(r.price, r.price >= 100 ? 1 : 2) },
      { k: "b400", t: "400張以上%", s: "週變化", v: (r) => r.d400, html: (r) => fmt(r.b400) + sgn(r.d400) },
      { k: "b1000", t: "1000張以上%", s: "週變化", v: (r) => r.d1000, html: (r) => fmt(r.b1000) + sgn(r.d1000) },
      { k: "rPct", t: `散戶${D.retailLabel}%`, s: "週變化", v: (r) => r.dR, html: (r) => fmt(r.rPct) + sgn(r.dR) },
      { k: "rPpl", t: "散戶人數", s: "週變化%", v: (r) => r.dRpplPct, html: (r) => int(r.rPpl) + sgn(r.dRpplPct, 1, "%") },
      { k: "tPpl", t: "總股東數", s: "週變化%", v: (r) => r.dTpplPct, html: (r) => int(r.tPpl) + sgn(r.dTpplPct, 1, "%") },
      { k: "su", t: "大戶連增", s: "400｜1000", v: (r) => r.su400 * 100 + r.su1000, html: (r) => `${r.su400}｜${r.su1000} 週` },
      { k: "sd", t: "散戶連減", s: "比例｜人數", v: (r) => r.sdR * 100 + r.sdRppl, html: (r) => `${r.sdR}｜${r.sdRppl} 週` },
      { k: "c400", t: `近${c.M}週 Δ400`, s: "百分點", v: (r) => r.chg(F.b400, c.M), html: (r) => sgn(r.chg(F.b400, c.M)) },
      { k: "c1000", t: `近${c.M}週 Δ1000`, s: "百分點", v: (r) => r.chg(F.b1000, c.M), html: (r) => sgn(r.chg(F.b1000, c.M)) },
      { k: "cR", t: `近${c.M}週 Δ散戶`, s: "百分點", v: (r) => r.chg(F.rPct, c.M), html: (r) => sgn(r.chg(F.rPct, c.M)) },
      { k: "spark", t: "400張%走勢", nosort: true, html: (r) => spark(r.st.s.map((x) => (x ? x[F.b400] : null)).slice(-12)) },
    ];
  }
  const defaultSort = { streak: { key: "su", dir: -1 }, cum: { key: "c400", dir: -1 }, jump: { key: "b400", dir: -1 }, combo: { key: "c400", dir: -1 }, watch: { key: "code", dir: 1 }, all: { key: "code", dir: 1 } };

  function tags(r, c) {
    let t = "";
    if (pass.streak(r, c)) t += '<span class="tag hot">連增</span>';
    if (pass.cum(r, c)) t += '<span class="tag hot">累積</span>';
    if (pass.jump(r, c)) t += '<span class="tag hot">跳升</span>';
    return t;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  function spark(arr) {
    const pts = arr.map((y, i) => [i, y]).filter((p) => p[1] != null);
    if (pts.length < 2) return "";
    const W = 80, H = 22, ys = pts.map((p) => p[1]);
    const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
    const x = (i) => 2 + (i * (W - 4)) / (arr.length - 1), y = (v) => H - 3 - ((v - lo) * (H - 6)) / span;
    const d = pts.map((p, j) => (j ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1)).join("");
    const lp = pts[pts.length - 1], up = lp[1] >= pts[0][1];
    return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="none" stroke="var(${up ? "--up" : "--down"})" stroke-width="1.5"/><circle cx="${x(lp[0])}" cy="${y(lp[1])}" r="2" fill="var(${up ? "--up" : "--down"})"/></svg>`;
  }

  // ---------- 繪製表格 ----------
  function render() {
    const c = cfg();
    // 分頁計數
    for (const k of ["streak", "cum", "jump", "combo", "watch"]) {
      const n = rows.filter((r) => baseFilter(r) && pass[k](r, c)).length;
      const el = document.querySelector(`[data-count="${k}"]`); if (el) el.textContent = n;
    }
    const cs = cols(c);
    const so = sort || defaultSort[tab];
    const col = cs.find((x) => x.k === so.key) || cs[1];
    current = rows.filter((r) => baseFilter(r) && pass[tab](r, c));
    const val = col.v || ((r) => r.code);
    current.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * so.dir || a.code.localeCompare(b.code);
    });

    $("#tbl thead").innerHTML = "<tr>" + cs.map((x) =>
      `<th class="${x.l ? "l" : ""} ${x.k === so.key ? "sorted" : ""}" data-k="${x.nosort ? "" : x.k}">${x.t}${x.k === so.key ? (so.dir > 0 ? " ▲" : " ▼") : ""}${x.s ? `<span class="sub2">${x.s}</span>` : ""}</th>`).join("") + "</tr>";
    const shown = current.slice(0, limit);
    $("#tbl tbody").innerHTML = shown.map((r) =>
      `<tr data-c="${r.code}">` + cs.map((x) => `<td class="${x.l ? "l " : ""}${x.cls || ""}${x.k === "star" && watch.has(r.code) ? " on" : ""}">${x.html(r)}</td>`).join("") + "</tr>").join("");
    $("#empty").hidden = current.length > 0;
    $("#more").hidden = current.length <= limit;
    $("#showMore").textContent = `顯示更多（還有 ${current.length - limit} 檔）`;
    saveSettings();
  }

  // ---------- 個股明細 ----------
  function chart(title, color, vals, dates, fmtY) {
    const W = 300, H = 140, P = { l: 50, r: 8, t: 22, b: 20 };
    const pts = vals.map((y, i) => [i, y]).filter((p) => p[1] != null);
    if (pts.length < 1) return "";
    const ys = pts.map((p) => p[1]);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
    const n = Math.max(vals.length - 1, 1);
    const x = (i) => P.l + (i * (W - P.l - P.r)) / n;
    const y = (v) => P.t + ((hi - v) * (H - P.t - P.b)) / (hi - lo);
    const d = pts.map((p, j) => (j ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1)).join("");
    const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
    const lastP = pts[pts.length - 1];
    return `<figure style="margin:0"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${title}">
      <text x="${P.l}" y="14" style="font-weight:600;fill:var(--ink)">${title}</text>
      <text x="${W - P.r}" y="14" text-anchor="end" style="fill:${color};font-weight:600">${fmtY(lastP[1])}</text>
      ${ticks.map((t) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${P.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmtY(t)}</text>`).join("")}
      <text x="${P.l}" y="${H - 6}">${dates[0].slice(4, 6)}/${dates[0].slice(6)}</text>
      <text x="${W - P.r}" y="${H - 6}" text-anchor="end">${dates[dates.length - 1].slice(4, 6)}/${dates[dates.length - 1].slice(6)}</text>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>
      ${pts.map((p) => `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="2.4" fill="${color}"><title>${dates[p[0]]}：${fmtY(p[1])}</title></circle>`).join("")}
    </svg></figure>`;
  }

  function openDetail(code) {
    const r = rows.find((x) => x.code === code); if (!r) return;
    const s = r.st.s, dates = D.dates, pr = r.st.pr || [];
    $("#dTitle").textContent = `${r.code} ${r.name}`;
    $("#dSub").textContent = `${r.market} · ${r.ind} · 股價 ${fmt(r.price)} · 大戶連增 ${r.su400}(400)/${r.su1000}(1000) 週 · 散戶連減 ${r.sdR} 週`;
    const col = (f) => s.map((x) => (x ? x[f] : null));
    const pct = (v) => v.toFixed(2) + "%";
    const grid = [
      chart("400張以上 持股%", "var(--c400)", col(F.b400), dates, pct),
      chart("1000張以上 持股%", "var(--c1000)", col(F.b1000), dates, pct),
      chart(`散戶${D.retailLabel} 持股%`, "var(--cretail)", col(F.rPct), dates, pct),
      chart(`散戶${D.retailLabel} 人數`, "var(--cretail)", col(F.rPpl), dates, (v) => Math.round(v).toLocaleString("zh-TW")),
      chart("總股東數", "var(--muted)", col(F.tPpl), dates, (v) => Math.round(v).toLocaleString("zh-TW")),
      pr.some((x) => x != null) ? chart("收盤價", "var(--ink)", pr, dates, (v) => v.toFixed(v >= 100 ? 0 : 2)) : "",
    ];
    $("#dChart").innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px 16px">${grid.join("")}</div>`;
    $("#dLegend").innerHTML = "點選圓點可看數值；股價僅有網站開始自動更新後的週次。";
    const lines = [];
    for (let i = dates.length - 1; i >= 0; i--) {
      const a = s[i], b = s[i - 1];
      if (!a) continue;
      const dd = (f) => (b ? sgn(a[f] - b[f]) : "");
      lines.push(`<tr><td class="l">${dates[i]}</td><td>${fmt(a[F.b400])}${dd(F.b400)}</td><td>${fmt(a[F.b1000])}${dd(F.b1000)}</td><td>${fmt(a[F.rPct])}${dd(F.rPct)}</td><td>${int(a[F.rPpl])}</td><td>${int(a[F.tPpl])}</td><td>${int(a[F.p400])}</td><td>${int(a[F.p1000])}</td><td>${fmt(pr[i])}</td></tr>`);
    }
    $("#dTable").innerHTML = `<table><thead><tr><th class="l">資料日期</th><th>400張以上%</th><th>1000張以上%</th><th>散戶%</th><th>散戶人數</th><th>總股東數</th><th>400張以上人數</th><th>1000張以上人數</th><th>股價</th></tr></thead><tbody>${lines.join("")}</tbody></table>`;
    $("#dLinks").innerHTML = `<a href="https://norway.twsthr.info/StockHolders.aspx?stock=${code}" target="_blank" rel="noopener">神秘金字塔</a><a href="https://www.tdcc.com.tw/portal/zh/smWeb/qryStock" target="_blank" rel="noopener">集保查詢</a><a href="https://tw.stock.yahoo.com/quote/${code}" target="_blank" rel="noopener">Yahoo股市</a>`;
    const dlg = $("#detail");
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }

  // ---------- CSV ----------
  function exportCsv() {
    const c = cfg();
    const head = ["代號", "名稱", "市場", "產業", "股價", "400張以上%", "400週變化", "1000張以上%", "1000週變化", "散戶%", "散戶週變化", "散戶人數", "總股東數", "400連增週", "1000連增週", "散戶比例連減週", "散戶人數連減週", `近${c.M}週Δ400`, `近${c.M}週Δ1000`, `近${c.M}週Δ散戶`];
    const r2 = (x) => (x == null ? "" : Math.round(x * 100) / 100);
    const lines = current.map((r) => [r.code, r.name, r.market, r.ind, r.price ?? "", r.b400, r2(r.d400), r.b1000, r2(r.d1000), r.rPct, r2(r.dR), r.rPpl, r.tPpl, r.su400, r.su1000, r.sdR, r.sdRppl, r2(r.chg(F.b400, c.M)), r2(r.chg(F.b1000, c.M)), r2(r.chg(F.rPct, c.M))]);
    const csv = "﻿" + [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `籌碼_${tab}_${D.dates[D.dates.length - 1]}.csv`;
    a.click();
  }

  // ---------- 設定保存 ----------
  const SETTING_IDS = ["streakN", "streakBig", "streakRetail", "cumM", "cumBig", "cumBig1000", "cumRetail", "jump400", "jump1000", "jumpX", "market", "minPrice", "minPeople"];
  function saveSettings() { const o = { tab }; SETTING_IDS.forEach((id) => (o[id] = $("#" + id).value)); store.set("settings", o); }
  function loadSettings() { const o = store.get("settings", null); if (!o) return; SETTING_IDS.forEach((id) => { if (o[id] != null) $("#" + id).value = o[id]; }); if (o.tab && pass[o.tab]) setTab(o.tab, false); }

  function setTab(t, draw = true) {
    tab = t; sort = null; limit = PAGE;
    $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
    $$(".rules").forEach((el) => (el.hidden = el.dataset.for !== t));
    if (draw) render();
  }

  // ---------- 事件 ----------
  function bind() {
    $$(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
    $$("input, select").forEach((el) => el.addEventListener("input", () => { limit = PAGE; render(); }));
    $("#tbl thead").addEventListener("click", (e) => {
      const th = e.target.closest("th"); if (!th || !th.dataset.k) return;
      const k = th.dataset.k, cur = sort || defaultSort[tab];
      sort = { key: k, dir: cur.key === k ? -cur.dir : (k === "code" ? 1 : -1) };
      render();
    });
    $("#tbl tbody").addEventListener("click", (e) => {
      const tr = e.target.closest("tr"); if (!tr) return;
      const code = tr.dataset.c;
      if (e.target.closest("td.star")) {
        watch.has(code) ? watch.delete(code) : watch.add(code);
        store.set("watch", [...watch]); render(); return;
      }
      openDetail(code);
    });
    $("#showMore").addEventListener("click", () => { limit += PAGE; render(); });
    $("#csv").addEventListener("click", exportCsv);
    $("#dClose").addEventListener("click", () => $("#detail").close());
    $("#detail").addEventListener("click", (e) => { if (e.target.id === "detail") $("#detail").close(); });
  }

  (async () => {
    try { D = await load(); } catch (e) {
      $("#stamp").textContent = "資料載入失敗：" + e.message; return;
    }
    $("#retailLabel").textContent = D.retailLabel;
    const last = D.dates[D.dates.length - 1];
    $("#stamp").innerHTML = `資料日期 <b>${last.slice(0, 4)}/${last.slice(4, 6)}/${last.slice(6)}</b> · 共 ${D.dates.length} 週 · ${D.stocks.length} 檔<br>更新於 ${D.updated}${D.demo ? '<span class="demo">示範資料</span>' : ""}`;
    prep(); bind(); loadSettings(); render();
  })();
})();
