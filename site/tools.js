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
  const TABS = [["ft", "富台指換算"], ["margin", "融資維持率"], ["cape", "席勒本益比"], ["flow", "融資／外資"], ["alert", "期貨警示"], ["beta", "風險係數(β)"], ["adam", "亞當理論"]];
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
    if (!A.user) { v.innerHTML = lockHtml("小功能・登入後解鎖", "富台指換算、大盤融資維持率、席勒本益比、融資與外資未平倉、期貨警示、風險係數 β、亞當理論，登入會員即可使用。"); return; }
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
      else if (cur === "beta") await drawBeta(b, await getJSON("beta"));
      else if (cur === "adam") { if (window.CTAdam) window.CTAdam.render(b); else b.innerHTML = '<p class="hint">載入中…</p>'; }
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
    b.insertAdjacentHTML("beforeend", '<div id="smBox" class="sm-box"><p class="hint">個股融資維持率載入中…</p></div>');
    drawStockMargin();
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

  // ---------------- 2b. 個股融資維持率 ----------------
  let SM = null, GRP = null;
  const smState = { q: "", sort: store.get("smSort", "asc"), group: store.get("smGroup", "0") === "1", th: 150,
    view: store.get("smView", "all") };
  // AI 供應鏈預設＝本站產業鏈中這幾條；版主可再勾選增減（存在 Firestore config/lists）
  const AI_CHAINS = ["semi", "ai-server", "pcb", "optical"];
  const AI_DEF = new Set();
  // LST：ai＝目前 AI 名單、watch＝本人觀察清單、uid＝載入時的帳號、err＝讀取失敗訊息
  const LST = { ai: null, aiAdd: [], aiDel: [], watch: new Set(), uid: null, err: "", busy: false };
  async function groupMap() {
    if (GRP) return GRP;
    GRP = new Map();
    try {
      const t = await (await fetch("data/themes.json", { cache: "no-cache" })).json();
      for (const ch of t.chains || []) for (const st of ch.stages || []) for (const sg of st.segments || []) for (const c of sg.codes || []) {
        if (!GRP.has(c)) GRP.set(c, sg.name);
        if (AI_CHAINS.includes(ch.id)) AI_DEF.add(c);
      }
    } catch { /* ignore */ }
    return GRP;
  }
  const isAdm = () => !!window.CTAuth?.isAdmin;
  const aiSet = () => new Set([...AI_DEF, ...LST.aiAdd].filter((c) => !LST.aiDel.includes(c)));
  async function loadLists() {
    const uid = window.CTAuth?.user?.uid || null;
    if (LST.ai && LST.uid === uid) return;
    LST.uid = uid; LST.err = "";
    const L = window.CTLists;
    if (!L) { LST.ai = aiSet(); return; }
    const [a, w] = await Promise.allSettled([L.getAI(), L.getWatch()]);
    if (a.status === "fulfilled") { LST.aiAdd = a.value.aiAdd; LST.aiDel = a.value.aiDel; }
    if (w.status === "fulfilled") LST.watch = new Set(w.value);
    if (a.status === "rejected" || w.status === "rejected") {
      const e = (a.reason || w.reason || {});
      LST.err = e.code === "permission-denied" ? "清單功能尚未開通（資料庫權限還沒更新），目前 AI 供應鏈先用預設名單、觀察清單暫時無法儲存。" : "清單讀取失敗，請稍後重新整理。";
    }
    LST.ai = aiSet();
  }
  function smMsg(t, ok) { const m = $("#smMsg"); if (!m) return; m.textContent = t; m.className = "sm-msg" + (ok ? " ok" : ""); m.hidden = !t;
    clearTimeout(smMsg.t); if (t) smMsg.t = setTimeout(() => { m.hidden = true; }, 4000); }
  async function toggleWatch(c, on) {
    const prev = new Set(LST.watch);
    on ? LST.watch.add(c) : LST.watch.delete(c);
    smList(GRP); smCounts();
    try { await window.CTLists.setWatch([...LST.watch]); smMsg(on ? `已加入觀察清單：${c}` : `已移出觀察清單：${c}`, true); }
    catch (e) { LST.watch = prev; smList(GRP); smCounts(); smMsg(e.code === "permission-denied" ? "觀察清單尚未開通（資料庫權限還沒更新）。" : "儲存失敗：" + (e.message || e)); }
  }
  async function toggleAI(c, on) {
    const pa = [...LST.aiAdd], pd = [...LST.aiDel];
    LST.aiAdd = LST.aiAdd.filter((x) => x !== c); LST.aiDel = LST.aiDel.filter((x) => x !== c);
    if (on && !AI_DEF.has(c)) LST.aiAdd.push(c);
    if (!on && AI_DEF.has(c)) LST.aiDel.push(c);
    LST.ai = aiSet(); smList(GRP); smCounts();
    try { await window.CTLists.setAI(LST.aiAdd, LST.aiDel); smMsg(on ? `已加入 AI 供應鏈：${c}` : `已從 AI 供應鏈移除：${c}`, true); }
    catch (e) { LST.aiAdd = pa; LST.aiDel = pd; LST.ai = aiSet(); smList(GRP); smCounts();
      smMsg(e.code === "permission-denied" ? "AI 供應鏈名單尚未開通（資料庫權限還沒更新）。" : "儲存失敗：" + (e.message || e)); }
  }
  function smCounts() {
    const a = $('[data-smv="ai"] small'), w = $('[data-smv="watch"] small');
    if (a) a.textContent = LST.ai ? LST.ai.size : ""; if (w) w.textContent = LST.watch.size;
  }
  const kTxt = (c, m) => (c ? `${m}${c[0] === "init" ? "起點成本" : "成本"} × ${fmt(c[1], 3)}` : `${m}尚未校正`);
  async function drawStockMargin() {
    const box = $("#smBox"); if (!box) return;
    try { SM = SM || (await getJSON("stock_margin")); } catch { box.innerHTML = '<div class="lock"><h3>個股融資維持率準備中</h3><p>下一次每日更新（約晚上 9:50）後就會出現。</p></div>'; return; }
    const gm = await groupMap();
    await loadLists();
    const vb = (k, t) => `<button type="button" data-smv="${k}" class="${smState.view === k ? "on" : ""}">${t}</button>`;
    box.innerHTML = `<div class="sm-head"><h3>個股融資維持率（估算）<small>維持率低於 150% 的上市櫃個股</small></h3>
        <div class="seg sm-view">${vb("all", "全部")}${vb("ai", "AI供應鏈 <small></small>")}${vb("watch", "觀察清單 <small></small>")}</div>
        <div class="sm-ctl">
          <input id="smQ" type="search" placeholder="搜尋代號或名稱（可查任一檔）" value="${esc(smState.q)}">
          <select id="smSort"><option value="asc" ${smState.sort === "asc" ? "selected" : ""}>維持率 小 → 大</option><option value="desc" ${smState.sort === "desc" ? "selected" : ""}>維持率 大 → 小</option></select>
          <label class="sm-chk"><input type="checkbox" id="smGroup" ${smState.group ? "checked" : ""}> 同族群放一起</label>
        </div>
        <div class="sm-legend"><span class="rt r1">&lt; 130%</span> 已達追繳 <span class="rt r2">130～140%</span> 接近追繳 <span class="rt r3">140～150%</span> 偏低</div></div>
      <p class="sm-msg" id="smMsg" hidden></p>
      ${LST.err ? `<p class="sm-msg warn">${esc(LST.err)}</p>` : ""}
      <div id="smList"></div>
      <p class="hint">AI 供應鏈：預設取本站產業鏈中的半導體、AI 伺服器、PCB 與載板、光通訊與網通，另含版主增補；觀察清單：按 ☆ 加入，只有你自己看得到，不在列表上的可先用搜尋找出來再加入。<br>估算方式：每天以「融資買進 − 資券互抵」張數 × 當日均價，用移動平均推算融資平均成本（除權息、減資復牌日依參考價同步調整），維持率 ＝ 收盤價 ÷（平均成本 × 60%）。
        再以證交所、櫃買中心公布的融資金額總額校正成本，讓個股加總與官方大盤維持率一致（${kTxt(SM.k && SM.k["上市"], "上市")}、${kTxt(SM.k && SM.k["上櫃"], "上櫃")}）。
        融資成數依現行規定上市、上櫃皆以六成計；注意股、處置股與各券商實際成數可能較低，個人追繳依整戶維持率計算，本表僅供參考。上市資料至 ${SM.d ? `${SM.d.slice(4, 6)}/${SM.d.slice(6)}` : "–"}${SM.od ? `、上櫃至 ${SM.od.slice(4, 6)}/${SM.od.slice(6)}` : "（上櫃資料暫缺）"}；更新於 ${esc(SM.updated)}。</p>`;
    const re = () => { smState.q = $("#smQ").value.trim(); smState.sort = $("#smSort").value; smState.group = $("#smGroup").checked;
      store.set("smSort", smState.sort); store.set("smGroup", smState.group ? "1" : "0"); smList(gm); };
    $("#smQ").addEventListener("input", re); $("#smSort").addEventListener("change", re); $("#smGroup").addEventListener("change", re);
    box.querySelector(".sm-view").addEventListener("click", (e) => {
      const b = e.target.closest("[data-smv]"); if (!b) return;
      smState.view = b.dataset.smv; store.set("smView", smState.view);
      box.querySelectorAll("[data-smv]").forEach((x) => x.classList.toggle("on", x === b)); smList(gm);
    });
    const list = $("#smList");
    list.addEventListener("click", (e) => {
      const st = e.target.closest("[data-star]"), adm = e.target.closest(".sm-adm");
      if (!st && !adm) return;
      e.stopPropagation();  // 不要觸發整列的月營收圖
      if (st) { e.preventDefault(); if (!LST.busy) toggleWatch(st.dataset.star, !LST.watch.has(st.dataset.star)); }
    });
    list.addEventListener("change", (e) => {
      const i = e.target.closest("input[data-adm]"); if (!i) return;
      (i.dataset.adm === "ai" ? toggleAI : toggleWatch)(i.dataset.c, i.checked);
    });
    smCounts();
    smList(gm);
  }
  function smList(gm) {
    const q = smState.q, view = smState.view, adm = isAdm();
    let rows = (SM.rows || []).filter((r) => r[6] >= 90 && r[6] <= 500).map((r) => ({ c: r[0], n: r[1], m: r[2], i: r[3], cl: r[4], avg: r[5], ratio: r[6], bal: r[7], chg: r[8], g: gm.get(r[0]) || r[3] || "其他" }));
    const pick = view === "ai" ? LST.ai || new Set() : view === "watch" ? LST.watch : null;
    if (pick) {
      const have = new Set(rows.map((r) => r.c));
      rows = rows.filter((r) => pick.has(r.c));
      // 清單裡沒有融資資料的標的（沒融資、或估算失真被排除）也列出來，方便管理
      const by = window.CT?.byCode;
      for (const c of pick) if (!have.has(c)) { const x = by?.get(c); rows.push({ c, n: x?.name || "", m: x?.market || "", i: "", ratio: null, g: gm.get(c) || "其他", none: true }); }
    }
    if (q) rows = rows.filter((r) => r.c.includes(q) || r.n.includes(q));
    else if (!pick) rows = rows.filter((r) => r.ratio < smState.th);
    const dir = smState.sort === "asc" ? 1 : -1;
    rows.sort((a, b) => (!!a.none - !!b.none) || (a.ratio - b.ratio) * dir);
    if (smState.group) {
      const gs = new Map();
      rows.forEach((r) => { if (!gs.has(r.g)) gs.set(r.g, []); gs.get(r.g).push(r); });
      rows = [...gs.entries()].sort((a, b) => ((a[1][0].ratio ?? 999) - (b[1][0].ratio ?? 999)) * dir).flatMap(([g, rs]) => [{ hdr: g, n: rs.length }, ...rs]);
    }
    const cl = (v) => (v < 130 ? "r1" : v < 140 ? "r2" : v < 150 ? "r3" : "r4");
    const real = rows.filter((r) => !r.hdr), cnt = real.length;
    const lo = (t) => real.filter((r) => r.ratio != null && r.ratio < t).length;
    const name = view === "ai" ? "AI 供應鏈" : view === "watch" ? "觀察清單" : "";
    const head = q ? `${name ? name + "・" : ""}搜尋「${esc(q)}」：${cnt} 檔`
      : name ? `${name} ${cnt} 檔（低於 150%：${lo(150)} 檔、低於 140%：${lo(140)} 檔）` : `共 ${cnt} 檔低於 150%（低於 140%：${lo(140)} 檔）`;
    const ai = LST.ai || new Set();
    const star = (c) => adm ? "" : `<button type="button" class="sm-star${LST.watch.has(c) ? " on" : ""}" data-star="${c}" title="${LST.watch.has(c) ? "移出觀察清單" : "加入觀察清單"}" aria-label="觀察清單">${LST.watch.has(c) ? "★" : "☆"}</button>`;
    const admCell = (c) => adm ? `<td class="sm-admc"><label class="sm-adm"><input type="checkbox" data-adm="ai" data-c="${c}" ${ai.has(c) ? "checked" : ""}>AI</label>
        <label class="sm-adm"><input type="checkbox" data-adm="watch" data-c="${c}" ${LST.watch.has(c) ? "checked" : ""}>觀察</label></td>` : "";
    const ncol = adm ? 8 : 7;
    const empty = q ? "找不到這檔，或它目前沒有融資餘額。" : view === "watch" ? "觀察清單還是空的：在「全部」或搜尋結果裡按 ☆ 就能加入。"
      : view === "ai" ? "AI 供應鏈名單載入中或目前沒有資料。" : "目前沒有維持率低於 150% 的個股。";
    $("#smList").innerHTML = cnt ? `<p class="sm-cnt">${head}</p>
      <div class="table-wrap"><table class="tl-tbl sm-tbl"><thead><tr><th class="l">股票</th><th class="l">族群</th><th>維持率</th><th>收盤</th><th>融資成本</th><th>融資餘額<small>(張)</small></th><th>增減<small>(張)</small></th>${adm ? '<th class="sm-admc">版主勾選</th>' : ""}</tr></thead><tbody>
      ${rows.map((r) => r.hdr ? `<tr class="sm-g"><td colspan="${ncol}">${esc(r.hdr)}<small>${r.n} 檔</small></td></tr>` : r.none ? `<tr data-rev="${r.c}" data-m="${esc(r.m)}" class="sm-none">
        <td class="l">${star(r.c)}<b>${r.c}</b> ${esc(r.n)}${r.m === "上櫃" ? '<span class="tag">櫃</span>' : ""}</td><td class="l"><span class="g">${esc(r.g)}</span></td>
        <td colspan="5" class="l"><small>無融資資料（沒有融資餘額，或估算失真未列入）</small></td>${admCell(r.c)}</tr>` : `<tr data-rev="${r.c}" data-m="${esc(r.m)}">
        <td class="l">${star(r.c)}<b>${r.c}</b> ${esc(r.n)}${r.m === "上櫃" ? '<span class="tag">櫃</span>' : ""}</td><td class="l"><span class="g">${esc(r.g)}</span></td>
        <td><span class="rt ${cl(r.ratio)}">${fmt(r.ratio, 1)}%</span></td><td>${fmt(r.cl, r.cl < 100 ? 2 : 1)}</td><td>${fmt(r.avg, r.avg < 100 ? 2 : 1)}</td>
        <td>${fmt(r.bal)}</td><td class="${cls(r.chg)}">${sg(r.chg)}</td>${admCell(r.c)}</tr>`).join("")}</tbody></table></div>`
      : `<p class="empty">${empty}</p>`;
  }

  // ---------------- 2c. 風險係數 β ----------------
  const bState = { q: "", p: store.get("bP", "6m"), dir: store.get("bDir", "desc"), view: store.get("bView", "all"),
    group: store.get("bGroup", "0") === "1", all: false };
  let BD = null;
  async function drawBeta(b, d) {
    BD = d;
    const gm = await groupMap();
    await loadLists();
    const P = d.p || [];
    if (!P.some(([k]) => k === bState.p)) bState.p = "6m";
    const opts = P.flatMap(([k, t]) => [["desc", "高→低"], ["asc", "低→高"]].map(([dr, dt]) =>
      `<option value="${k}|${dr}" ${k === bState.p && dr === bState.dir ? "selected" : ""}>${t}β值 (${dt})</option>`)).join("");
    const vb = (k, t) => `<button type="button" data-bv="${k}" class="${bState.view === k ? "on" : ""}">${t}</button>`;
    b.innerHTML = `<div class="sm-box beta-box"><div class="sm-head"><h3>風險係數（β）<small>個股相對加權指數的波動倍數</small></h3>
        <div class="seg sm-view">${vb("all", "全部")}${vb("ai", `AI供應鏈 <small>${LST.ai ? LST.ai.size : ""}</small>`)}</div>
        <div class="sm-ctl">
          <input id="bQ" type="search" placeholder="搜尋代號或名稱" value="${esc(bState.q)}">
          <select id="bSort">${opts}</select>
          <label class="sm-chk"><input type="checkbox" id="bGroup" ${bState.group ? "checked" : ""}> 同族群放一起</label>
        </div>
        <div class="sm-legend"><span class="bt b1">≥ 1.5</span> 波動遠大於大盤 <span class="bt b2">1～1.5</span> 大於大盤 <span class="bt b3">0～1</span> 小於大盤 <span class="bt b4">&lt; 0</span> 與大盤反向</div></div>
      <div id="bList"></div>
      <p class="hint">β ＝ 個股日報酬與加權指數日報酬的共變異數 ÷ 加權指數日報酬的變異數。β ＝ 1.2 代表大盤漲跌 1% 時，這檔平均約漲跌 1.2%；β 越高波動越大、風險越高。
        個股用除權息還原後的收盤價，上市、上櫃都以加權指數為基準；5 日、10 日等短天期樣本少、變動大，僅供參考。
        區間以交易日計：一個月 20 日、三個月 60 日、半年 120 日、一年 240 日、二年 480 日、三年 720 日。資料至 ${d.d ? ymd(d.d) : "–"}；更新於 ${esc(d.updated)}。點標的可看月營收與股價。</p></div>`;
    const re = () => { bState.q = $("#bQ").value.trim(); [bState.p, bState.dir] = $("#bSort").value.split("|"); bState.group = $("#bGroup").checked; bState.all = false;
      store.set("bP", bState.p); store.set("bDir", bState.dir); store.set("bGroup", bState.group ? "1" : "0"); bList(gm); };
    $("#bQ").addEventListener("input", re); $("#bSort").addEventListener("change", re); $("#bGroup").addEventListener("change", re);
    b.querySelector(".sm-view").addEventListener("click", (e) => {
      const x = e.target.closest("[data-bv]"); if (!x) return;
      bState.view = x.dataset.bv; bState.all = false; store.set("bView", bState.view);
      b.querySelectorAll("[data-bv]").forEach((y) => y.classList.toggle("on", y === x)); bList(gm);
    });
    $("#bList").addEventListener("click", (e) => { if (e.target.closest("[data-bmore]")) { e.stopPropagation(); bState.all = true; bList(gm); } });
    bList(gm);
  }
  function bList(gm) {
    const d = BD, P = d.p || [], pi = Math.max(0, P.findIndex(([k]) => k === bState.p)), col = 5 + pi;
    const q = bState.q, dir = bState.dir === "asc" ? 1 : -1;
    let rows = (d.rows || []).map((r) => ({ c: r[0], n: r[1], m: r[2], i: r[3], cl: r[4], b: r.slice(5), v: r[col], g: gm.get(r[0]) || r[3] || "其他" }));
    if (bState.view === "ai") { const ai = LST.ai || new Set(); rows = rows.filter((r) => ai.has(r.c)); }
    if (q) rows = rows.filter((r) => r.c.includes(q) || r.n.includes(q));
    rows.sort((a, b) => ((a.v == null) - (b.v == null)) || (a.v - b.v) * dir);
    const total = rows.filter((r) => r.v != null).length;
    const LIM = 200;
    const cut = !bState.all && !q && rows.length > LIM;
    if (cut) rows = rows.slice(0, LIM);
    if (bState.group) {
      const gs = new Map();
      rows.forEach((r) => { if (!gs.has(r.g)) gs.set(r.g, []); gs.get(r.g).push(r); });
      rows = [...gs.entries()].sort((a, b) => ((a[1][0].v ?? (dir > 0 ? 99 : -99)) - (b[1][0].v ?? (dir > 0 ? 99 : -99))) * dir).flatMap(([g, rs]) => [{ hdr: g, n: rs.length }, ...rs]);
    }
    const bc = (v) => (v == null ? "" : v >= 1.5 ? "b1" : v >= 1 ? "b2" : v >= 0 ? "b3" : "b4");
    const bv = (v, on) => (v == null ? '<span class="muted">–</span>' : on ? `<span class="bt ${bc(v)}">${v.toFixed(2)}</span>` : v.toFixed(2));
    const name = bState.view === "ai" ? "AI 供應鏈" : "全部";
    const cnt = rows.filter((r) => !r.hdr).length;
    const ncol = 3 + P.length;
    $("#bList").innerHTML = cnt ? `<p class="sm-cnt">${name}${q ? `・搜尋「${esc(q)}」` : ""}：${P[pi][1]}β值${dir < 0 ? "由高至低" : "由低至高"}，共 ${total} 檔${cut ? `（先列前 ${LIM} 檔）` : ""}</p>
      <div class="table-wrap"><table class="tl-tbl sm-tbl beta-tbl"><thead><tr><th class="l">股票</th><th class="l">族群</th><th class="on">${P[pi][1]}β</th><th>收盤</th>
        ${P.map(([k, t], j) => (j === pi ? "" : `<th>${t}</th>`)).join("")}</tr></thead><tbody>
      ${rows.map((r) => r.hdr ? `<tr class="sm-g"><td colspan="${ncol}">${esc(r.hdr)}<small>${r.n} 檔</small></td></tr>` : `<tr data-rev="${r.c}" data-m="${esc(r.m)}">
        <td class="l"><b>${r.c}</b> ${esc(r.n)}${r.m === "上櫃" ? '<span class="tag">櫃</span>' : ""}</td><td class="l"><span class="g">${esc(r.g)}</span></td>
        <td class="on">${bv(r.v, true)}</td><td>${fmt(r.cl, r.cl < 100 ? 2 : 1)}</td>${r.b.map((v, j) => (j === pi ? "" : `<td>${bv(v, false)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>
      ${cut ? `<button type="button" class="ghost beta-more" data-bmore>顯示全部 ${total} 檔</button>` : ""}`
      : `<p class="empty">${q ? "找不到這檔，或它的交易資料不足。" : "目前沒有資料。"}</p>`;
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
