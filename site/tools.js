/* CogniTrek 小功能：富台指換算、融資維持率、席勒本益比、融資與外資未平倉、期貨警示（登入後解鎖） */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (v, d = 0) => (v == null || Number.isNaN(v) ? "–" : Number(v).toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sg = (v, d = 0, suf = "") => (v == null ? "–" : (v > 0 ? "+" : "") + fmt(v, d) + suf);
  const cls = (v) => (v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : "");
  const ymd = (s) => `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}`;
  const md = (s) => `${+s.slice(4, 6)}/${+s.slice(6, 8)}`;
  const store = {
    get(k, d) { try { return localStorage.getItem("ct:tools:" + k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("ct:tools:" + k, v); } catch { /* ignore */ } },
  };
  const TABS = [["ft", "富台指換算"], ["margin", "融資維持率"], ["cape", "席勒本益比"], ["flow", "融資／外資"], ["alert", "期貨警示"]];
  let cur = store.get("sub", "ft"), onTab = false;
  const cache = {};
  async function getJSON(name) {
    if (cache[name]) return cache[name];
    const r = await fetch(`data/tools/${name}.json`, { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return (cache[name] = await r.json());
  }

  document.addEventListener("ct:tab", (e) => { onTab = e.detail === "tools"; if (onTab) show(); });
  document.addEventListener("ct:auth", () => { if (onTab) show(); });

  function lockHtml(title, text) {
    return `<div class="lock lock-mid"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
      <h3>${title}</h3><p>${text}</p>
      <div class="lock-act"><button class="primary" data-a2="login">登入</button><button class="ghost" data-a2="register">免費註冊</button></div></div>`;
  }
  window.CTLock = lockHtml;

  function show() {
    const v = $("#toolsView");
    const A = window.CTAuth;
    if (!A) { v.innerHTML = '<p class="hint">確認登入狀態中…</p>'; return; }
    if (!A.user) { v.innerHTML = lockHtml("小功能・登入後解鎖", "富台指換算、大盤融資維持率、席勒本益比、融資與外資未平倉、期貨警示，登入會員即可使用。"); return; }
    v.innerHTML = `<div class="tools">
      <div class="seg tools-nav" role="tablist">${TABS.map(([k, t]) => `<button data-sub="${k}" class="${k === cur ? "on" : ""}">${t}</button>`).join("")}</div>
      <div id="toolBody"><p class="hint">載入中…</p></div></div>`;
    draw();
  }

  async function draw() {
    const b = $("#toolBody"); if (!b) return;
    try {
      if (cur === "ft") b.innerHTML = ftHtml(await getJSON("ft"));
      else if (cur === "margin") drawMargin(b, await getJSON("margin"));
      else if (cur === "cape") drawCape(b, await getJSON("cape"));
      else if (cur === "flow") b.innerHTML = flowHtml(await getJSON("flow"));
      else if (cur === "alert") b.innerHTML = alertHtml(await getJSON("futalert"));
    } catch (e) {
      b.innerHTML = `<div class="lock"><h3>資料準備中</h3><p>這項資料會在下一次自動更新後出現（${esc(e.message)}）。</p></div>`;
    }
  }

  document.addEventListener("click", (e) => {
    const s = e.target.closest("#toolsView [data-sub]");
    if (s) { cur = s.dataset.sub; store.set("sub", cur); show(); return; }
    const r = e.target.closest("#toolsView [data-rng]");
    if (r) { store.set("rng:" + cur, r.dataset.rng); draw(); }
  });

  // ---------------- 1. 富台指換算 ----------------
  function ftHtml(d) {
    const up = d.chg >= 0;
    const hist = (d.hist || []).slice().reverse().slice(0, 8);
    return `<div class="ft-grid">
      <div class="ft-card"><span class="ft-tag dark">SGX 延遲報價</span><p class="ft-lab">富台指（FTSE Taiwan 期貨 ${esc(d.ft.sym)}）</p>
        <div class="ft-num">${fmt(d.ft.last, 2)}</div>
        <p class="ft-sub ${cls(d.ft.chg)}">${sg(d.ft.chg, 2)}（較 ${fmt(d.ft.ref, 2)}）</p>
        <p class="ft-time">報價時間 ${esc(d.ft.t)}</p></div>
      <div class="ft-card hl"><span class="ft-tag">換算</span><p class="ft-lab">預估台指期價格</p>
        <div class="ft-num big">${fmt(d.est)}</div>
        <p class="ft-sub ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${sg(d.chg)}（${sg(d.pct, 2, "%")}）</p>
        <p class="ft-time">與 ${md(d.tx.d)} 台指期收盤比較 · 基準 TX ${fmt(d.tx.close)}（${esc(d.tx.m)}）／ FT ${fmt(d.ft.ref, 2)}</p></div>
    </div>
    ${hist.length > 1 ? `<div class="table-wrap"><table class="tl-tbl"><thead><tr><th class="l">報價時間</th><th>富台指</th><th>預估台指期</th></tr></thead><tbody>
      ${hist.map((h) => `<tr><td class="l">${esc(h.t)}</td><td>${fmt(h.ft, 2)}</td><td>${fmt(h.est)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <p class="hint">算法：預估台指期 ＝ 台指期近月收盤 × 富台指最新價 ÷ 富台指日盤結算價。台股收盤後、隔天開盤前參考用；
      富台指為新加坡交易所網站的延遲報價，本站每天約 17:00、00:00、05:30、08:15 更新，不是即時報價。資料更新於 ${esc(d.updated)}。</p>`;
  }

  // ---------------- 共用：雙軸折線圖（含十字線） ----------------
  const RNG = [["1y", "1年", 1], ["3y", "3年", 3], ["5y", "5年", 5], ["10y", "10年", 10]];
  function rangeBar(def) {
    const r = store.get("rng:" + cur, def);
    return { r, html: `<div class="seg rng">${RNG.map(([k, t]) => `<button data-rng="${k}" class="${k === r ? "on" : ""}">${t}</button>`).join("")}</div>` };
  }
  function cutRows(rows, r, monthly) {
    const yrs = (RNG.find((x) => x[0] === r) || RNG[3])[2];
    const now = new Date(); const y = now.getFullYear() - yrs, m = now.getMonth() + 1;
    const key = monthly ? `${y}${String(m).padStart(2, "0")}` : `${y}${String(m).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    return rows.filter((x) => x[0] >= key);
  }
  /** opt: { x:[label...], L:{name,vals,color,fmt}, R:{...}, B:{name,vals,color,fmt} (下方柱狀), refR:[{v,label}], xLab:(s)=>..., tip:(i)=>html } */
  function chart(el, opt) {
    const sm = innerWidth < 600, W = sm ? 380 : 900, H1 = sm ? 220 : 300, HB = opt.B ? (sm ? 70 : 90) : 0, gap = opt.B ? 16 : 0;
    const P = { l: sm ? 40 : 56, r: sm ? 40 : 56, t: 14, b: 22 };
    const H = P.t + H1 + gap + HB + P.b, n = opt.x.length;
    const x = (i) => P.l + (n <= 1 ? 0 : (i * (W - P.l - P.r)) / (n - 1));
    const rng = (vals, pad = 0.06) => { const v = vals.filter((a) => a != null); let lo = Math.min(...v), hi = Math.max(...v); const p = (hi - lo) * pad || 1; return [lo - p, hi + p]; };
    const mk = (vals, lo, hi, top, h) => (v) => top + ((hi - v) * h) / (hi - lo || 1);
    let s = "";
    const [lLo, lHi] = rng(opt.L.vals), [rLo0, rHi0] = rng(opt.R.vals);
    let rLo = rLo0, rHi = rHi0;
    (opt.refR || []).forEach((r) => { rLo = Math.min(rLo, r.v - 5); });
    const yl = mk(opt.L.vals, lLo, lHi, P.t, H1), yr = mk(opt.R.vals, rLo, rHi, P.t, H1);
    for (let k = 0; k <= 4; k++) {
      const yy = P.t + (k * H1) / 4, lv = lHi - ((lHi - lLo) * k) / 4, rv = rHi - ((rHi - rLo) * k) / 4;
      s += `<line class="gl" x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}"/>`;
      s += `<text class="ax" x="${P.l - 5}" y="${yy + 4}" text-anchor="end">${opt.L.axis ? opt.L.axis(lv) : fmt(lv)}</text>`;
      s += `<text class="ax" x="${W - P.r + 5}" y="${yy + 4}">${opt.R.axis ? opt.R.axis(rv) : fmt(rv)}</text>`;
    }
    (opt.refR || []).forEach((r) => { const yy = yr(r.v); s += `<line class="ref" x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}"/><text class="reft" x="${W - P.r - 4}" y="${yy - 4}" text-anchor="end">${esc(r.label)}</text>`; });
    let lastY = "";
    opt.x.forEach((d, i) => { const y = d.slice(0, 4); if (y !== lastY && (i > 0 || d.slice(4, 6) === "01")) { if (i > 0) s += `<text class="ax" x="${x(i)}" y="${H - 6}" text-anchor="middle">${y}</text>`; lastY = y; } else if (!lastY) lastY = y; });
    const path = (vals, yf) => { let d = "", pen = false; vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + yf(v).toFixed(1); pen = true; }); return d; };
    if (opt.B) {
      const bv = opt.B.vals, bhi = Math.max(...bv.filter((a) => a != null)) * 1.05, top = P.t + H1 + gap;
      const bw = Math.max(0.6, (W - P.l - P.r) / n - 0.2);
      s += `<text class="ax" x="${P.l - 5}" y="${top + 10}" text-anchor="end">${opt.B.axis ? opt.B.axis(bhi) : fmt(bhi)}</text>`;
      s += `<path class="tl-bar" style="fill:${opt.B.color}" d="${bv.map((v, i) => (v == null ? "" : `M${(x(i) - bw / 2).toFixed(1)} ${(top + HB).toFixed(1)}V${(top + HB - (v / bhi) * HB).toFixed(1)}h${bw.toFixed(1)}V${(top + HB).toFixed(1)}Z`)).join("")}"/>`;
    }
    s += `<path class="tl-line" style="stroke:${opt.L.color}" d="${path(opt.L.vals, yl)}"/>`;
    s += `<path class="tl-line main" style="stroke:${opt.R.color}" d="${path(opt.R.vals, yr)}"/>`;
    s += `<line class="cur" x1="0" x2="0" y1="${P.t}" y2="${P.t + H1 + gap + HB}" style="display:none"/><circle class="dot" r="3.5" style="display:none;fill:${opt.R.color}"/>`;
    s += `<rect class="hit" x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}"/>`;
    el.innerHTML = `<div class="tl-legend"><span><i style="background:${opt.L.color}"></i>${esc(opt.L.name)}（左軸）</span><span><i style="background:${opt.R.color}"></i>${esc(opt.R.name)}（右軸）</span>${opt.B ? `<span><i class="sq" style="background:${opt.B.color}"></i>${esc(opt.B.name)}（下方）</span>` : ""}</div>
      <div class="tl-chart"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(opt.R.name)}與${esc(opt.L.name)}">${s}</svg><div class="rev-tip" hidden></div><div class="rev-xl" hidden></div></div>`;
    const svg = el.querySelector("svg"), tip = el.querySelector(".rev-tip"), xl = el.querySelector(".rev-xl");
    const ln = svg.querySelector(".cur"), dot = svg.querySelector(".dot");
    const at = (i) => {
      i = Math.max(0, Math.min(n - 1, i));
      const cx = x(i); ln.setAttribute("x1", cx); ln.setAttribute("x2", cx); ln.style.display = "";
      const rv = opt.R.vals[i]; if (rv != null) { dot.setAttribute("cx", cx); dot.setAttribute("cy", yr(rv)); dot.style.display = ""; } else dot.style.display = "none";
      tip.innerHTML = opt.tip(i); tip.hidden = false;
      xl.textContent = opt.xLab(opt.x[i]); xl.hidden = false;
      const pct = (cx / W) * 100;
      xl.style.left = `${Math.min(88, Math.max(12, pct))}%`;
      tip.style.left = pct < 50 ? "auto" : "10%"; tip.style.right = pct < 50 ? "8%" : "auto";
    };
    const move = (e) => {
      const rc = svg.getBoundingClientRect();
      const cx = ((e.touches ? e.touches[0].clientX : e.clientX) - rc.left) * (W / rc.width);
      at(Math.round(((cx - P.l) / (W - P.l - P.r)) * (n - 1)));
    };
    svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move);
    svg.addEventListener("touchmove", move, { passive: true });
    at(n - 1);
  }

  // ---------------- 2. 融資維持率 ----------------
  function drawMargin(b, d) {
    const { r, html } = rangeBar("3y");
    const rows = cutRows(d.d || [], r, false).filter((x) => x[4] != null);
    const last = (d.d || [])[d.d.length - 1] || [];
    const prev = (d.d || [])[d.d.length - 2] || [];
    const total = (d.d || []).length;
    b.innerHTML = `<div class="tl-head"><div class="tkpis">
        <div class="tkpi"><span>融資維持率</span><b>${fmt(last[4], 2)}%</b><em class="${cls(last[4] - prev[4])}">${sg(last[4] - prev[4], 2)}</em></div>
        <div class="tkpi"><span>融資餘額</span><b>${fmt(last[2], 0)} 億</b><em class="${cls(last[2] - prev[2])}">${sg(last[2] - prev[2], 1)} 億</em></div>
        <div class="tkpi"><span>加權指數</span><b>${fmt(last[1], 2)}</b><em>${last[0] ? ymd(last[0]) : ""}</em></div></div>${html}</div>
      <div id="tlChart"></div>
      <p class="hint">融資維持率 ＝ 上市股票融資餘額的市值 ÷ 融資金額（本站以每日收盤價估算，與券商公布值可能略有差異）。
        個人維持率低於 130% 會被追繳，大盤維持率跌近 140%～150% 時常伴隨斷頭賣壓。資料：證交所，共 ${fmt(total)} 個交易日${total < 2000 ? "（10 年歷史資料陸續補齊中）" : ""}；更新於 ${esc(d.updated)}。</p>`;
    if (rows.length < 2) { $("#tlChart").innerHTML = '<p class="empty">資料累積中。</p>'; return; }
    chart($("#tlChart"), {
      x: rows.map((x) => x[0]),
      L: { name: "加權指數", vals: rows.map((x) => x[1]), color: "#8a97a8" },
      R: { name: "融資維持率 %", vals: rows.map((x) => x[4]), color: "#f0a73a", axis: (v) => v.toFixed(0) },
      B: { name: "融資餘額（億）", vals: rows.map((x) => x[2]), color: "rgba(10,158,153,.35)" },
      refR: [{ v: 130, label: "130% 追繳線" }],
      xLab: ymd,
      tip: (i) => { const x = rows[i]; return `<b>${ymd(x[0])}</b><span>維持率</span><em>${fmt(x[4], 2)}%</em><span>融資餘額</span><em>${fmt(x[2], 0)} 億</em><span>加權指數</span><em>${fmt(x[1], 0)}</em>`; },
    });
  }

  // ---------------- 3. 席勒本益比 ----------------
  function drawCape(b, d) {
    const { r, html } = rangeBar("10y");
    const rows = cutRows(d.m || [], r, true);
    const all = d.m || [];
    const last = all[all.length - 1] || [];
    const cp = all.map((x) => x[2]);
    const avg = cp.length ? cp.reduce((a, c) => a + c, 0) / cp.length : null;
    const ym = (s) => `${s.slice(0, 4)}/${s.slice(4, 6)}`;
    b.innerHTML = `<div class="tl-head"><div class="tkpis">
        <div class="tkpi"><span>席勒本益比</span><b>${fmt(last[2], 2)}</b><em>${last[0] ? ym(last[0]) : ""}</em></div>
        <div class="tkpi"><span>近 10 年平均</span><b>${fmt(avg, 2)}</b><em class="${cls(last[2] - avg)}">${avg ? sg(((last[2] / avg) - 1) * 100, 1, "%") : ""}</em></div>
        <div class="tkpi"><span>一般本益比</span><b>${fmt(last[3], 2)}</b><em>近四季盈餘</em></div></div>${html}</div>
      <div id="tlChart"></div>
      <p class="hint">席勒本益比（CAPE）＝ 加權指數 ÷ 過去 10 年${d.real ? "經通膨調整後" : ""}的平均盈餘，用長期平均盈餘消除景氣循環的影響，數值越高代表相對長期獲利越貴。
        本站以證交所上市普通股的市值與本益比推算大盤盈餘${d.real ? "，並以主計總處 CPI 調整通膨" : "（尚未取得 CPI，暫用名目值）"}，每月底取一點；與其他網站的算法可能不同，僅供趨勢參考。更新於 ${esc(d.updated)}。</p>`;
    if (rows.length < 2) { $("#tlChart").innerHTML = '<p class="empty">資料累積中（需要 20 年月資料，首次補齊約需一天）。</p>'; return; }
    chart($("#tlChart"), {
      x: rows.map((x) => x[0]),
      L: { name: "加權指數", vals: rows.map((x) => x[1]), color: "#8a97a8" },
      R: { name: "席勒本益比", vals: rows.map((x) => x[2]), color: "#e0603a", axis: (v) => v.toFixed(0) },
      xLab: ym,
      tip: (i) => { const x = rows[i]; return `<b>${ym(x[0])}</b><span>席勒本益比</span><em>${fmt(x[2], 2)}</em><span>本益比</span><em>${fmt(x[3], 2)}</em><span>加權指數</span><em>${fmt(x[1], 0)}</em>`; },
    });
  }

  // ---------------- 4. 融資與外資未平倉 ----------------
  function flowHtml(d) {
    const rows = d.rows || [];
    if (rows.length < 2) return '<div class="lock"><h3>資料累積中</h3><p>需要至少兩個交易日的資料。</p></div>';
    const show = rows.slice(1).reverse();
    const pi = (r) => rows[rows.indexOf(r) - 1];
    const dlt = (a, b, d = 0, suf = "") => (a == null || b == null ? "" : `<small class="${cls(a - b)}">${sg(a - b, d, suf)}</small>`);
    const f5 = rows[rows.length - 1], f0 = rows[0];
    const sum = [];
    if (f5.mAmt != null && f0.mAmt != null) sum.push(`融資餘額 ${rows.length - 1} 日 <b class="${cls(f5.mAmt - f0.mAmt)}">${sg(f5.mAmt - f0.mAmt, 1)} 億</b>`);
    if (f5.fN != null && f0.fN != null) sum.push(`外資台指期淨部位 ${rows.length - 1} 日 <b class="${cls(f5.fN - f0.fN)}">${sg(f5.fN - f0.fN)} 口</b>`);
    if (f5.fN != null) sum.push(`目前外資${f5.fN < 0 ? "淨空單" : "淨多單"} <b>${fmt(Math.abs(f5.fN))} 口</b>`);
    return `<div class="flow-sum">${sum.map((x) => `<span>${x}</span>`).join("")}</div>
      <div class="table-wrap"><table class="tl-tbl flow-tbl"><thead><tr>
        <th class="l">日期</th><th>加權指數</th><th>融資餘額<small>(億)</small></th><th>融資<small>(張)</small></th><th>融券<small>(張)</small></th><th>維持率</th>
        <th>外資多單<small>(口)</small></th><th>外資空單<small>(口)</small></th><th>外資淨部位<small>(口)</small></th><th>投信淨<small>(口)</small></th><th>自營淨<small>(口)</small></th>
      </tr></thead><tbody>${show.map((r) => { const p = pi(r); return `<tr>
        <td class="l"><b>${md(r.d)}</b></td><td>${fmt(r.taiex, 0)}${dlt(r.taiex, p.taiex)}</td>
        <td>${fmt(r.mAmt, 1)}${dlt(r.mAmt, p.mAmt, 1)}</td><td>${fmt(r.mLots)}${dlt(r.mLots, p.mLots)}</td><td>${fmt(r.sLots)}${dlt(r.sLots, p.sLots)}</td>
        <td>${fmt(r.ratio, 1)}%</td>
        <td>${fmt(r.fL)}${dlt(r.fL, p.fL)}</td><td>${fmt(r.fS)}${dlt(r.fS, p.fS)}</td><td class="${cls(r.fN)}"><b>${sg(r.fN)}</b>${dlt(r.fN, p.fN)}</td>
        <td class="${cls(r.it)}">${sg(r.it)}</td><td class="${cls(r.dl)}">${sg(r.dl)}</td></tr>`; }).join("")}</tbody></table></div>
      <p class="hint">融資、融券為上市市場合計（證交所）；外資／投信／自營為臺股期貨（大台）未平倉口數（期交所），小字為較前一交易日增減。更新於 ${esc(d.updated)}。</p>`;
  }

  // ---------------- 5. 期貨警示 ----------------
  function alertHtml(d) {
    const items = d.items || [];
    const hist = Object.entries(d.hist || {}).filter(([k]) => k !== d.d).reverse().slice(0, 5);
    const card = (x) => `<tr data-rev="${x.c}" data-m="${esc(x.m)}">
      <td class="l"><b>${x.c}</b> ${esc(x.n)}<small>${esc(x.ind)}</small></td>
      <td>${fmt(x.spot, 2)}</td><td class="l">${esc(x.fut)}<small>${esc(x.ym)}</small></td>
      <td>${fmt(x.last, 2)}</td><td class="${cls(x.dev)}"><b>${sg(x.dev, 2, "%")}</b></td>
      <td>${fmt(x.settle, 2)}<small class="${cls(x.sdev)}">${sg(x.sdev, 2, "%")}</small></td><td>${fmt(x.vol)}</td></tr>`;
    const tbl = (list) => `<div class="table-wrap"><table class="tl-tbl alert-tbl"><thead><tr><th class="l">現貨標的</th><th>現貨收盤</th><th class="l">期貨契約</th><th>期貨收盤</th><th>價差</th><th>期貨結算價</th><th>成交量(口)</th></tr></thead><tbody>${list.map(card).join("")}</tbody></table></div>`;
    return `${items.length ? `<div class="alert-on"><b>⚠ ${ymd(d.d)}：${items.length} 檔電子／半導體個股期貨與現貨價差超過 ±${d.th}%</b>
        <p>期貨明顯低於現貨，常見於大盤急跌、市場預期隔日續弱時（也可能是成交稀少的最後一筆，請一併看結算價）。</p></div>${tbl(items)}`
      : `<div class="alert-off"><b>✓ ${d.d ? ymd(d.d) : ""} 無極端價差</b><p>電子／半導體類 ${fmt(d.n)} 檔個股期貨中，沒有收盤價與現貨相差超過 ±${d.th}% 的標的。</p></div>`}
      ${hist.length ? `<h4 class="alert-h">近期曾觸發</h4>${hist.map(([k, v]) => `<details class="alert-past"><summary>${ymd(k)}・${v.length} 檔</summary>${tbl(v)}</details>`).join("")}` : ""}
      <p class="hint">條件：半導體、電子零組件、光電、電腦週邊、通信網路、電子通路、資訊服務、其他電子等產業的個股期貨（含小型），近月合約有成交，且期貨收盤價與現貨收盤價相差 ±${d.th}% 以上。
        除權息前期貨會預先反映股利而低於現貨，也可能出現價差。點標的可看月營收。更新於 ${esc(d.updated)}。</p>`;
  }
})();
