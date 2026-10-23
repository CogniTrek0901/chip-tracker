/* CogniTrek 強勢族群（每日漲停／漲幅 ≥ 8%）與月營收圖表 */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtN = (v, d = 0) => (v == null || Number.isNaN(v) ? "–" : Number(v).toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sgnCls = (v) => (v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : "");
  const sgnTxt = (v, d = 1) => (v == null ? "–" : (v > 0 ? "+" : "") + Number(v).toFixed(d));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("ct:hot:" + k); return v == null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("ct:hot:" + k, v); } catch { /* ignore */ } },
  };

  let IDX = null, DAY = null, mode = store.get("mode", "all"), grp = "", curDate = "";

  async function getJSON(u) { const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }

  let onHot = false;
  document.addEventListener("ct:tab", (e) => { onHot = e.detail === "hot"; if (onHot) show(); });
  document.addEventListener("ct:auth", () => { if (onHot) show(); });

  async function show() {
    const v = $("#hotView");
    // 登入後解鎖
    const A = window.CTAuth;
    if (!A) { v.innerHTML = '<p class="hint">確認登入狀態中…</p>'; return; }
    if (!A.user) {
      v.innerHTML = window.CTLock ? window.CTLock("強勢族群・登入後解鎖", "每日漲停與漲幅 ≥ 8% 個股、所屬族群、近期新聞與月營收圖表，登入會員即可查看。")
        : '<div class="lock lock-mid"><h3>強勢族群・登入後解鎖</h3><div class="lock-act"><button class="primary" data-a2="login">登入</button></div></div>';
      return;
    }
    if (!IDX) {
      v.innerHTML = '<p class="hint">載入中…</p>';
      try { IDX = await getJSON("data/daily/index.json"); } catch { IDX = { dates: [] }; }
    }
    if (!IDX.dates.length) { v.innerHTML = '<div class="lock"><h3>強勢族群資料準備中</h3><p>每個交易日收盤後自動更新，第一份資料產生後就會出現在這裡。</p></div>'; return; }
    if (!curDate) curDate = IDX.dates[0];
    if (!DAY || DAY.d !== curDate) {
      v.innerHTML = '<p class="hint">載入中…</p>';
      try { DAY = await getJSON(`data/daily/${curDate}.json`); } catch (e) { v.innerHTML = `<p class="warn">讀取失敗：${esc(e.message)}</p>`; return; }
    }
    draw();
  }

  function chipTags(code) {
    const CT = window.CT; if (!CT) return "";
    const r = CT.byCode.get(code); if (!r) return "";
    const c = CT.cfg();
    return (CT.pass.streak(r, c) ? '<span class="tag hot">連增</span>' : "") + (CT.pass.cum(r, c) ? '<span class="tag hot">累積</span>' : "") + (CT.pass.jump(r, c) ? '<span class="tag hot">跳升</span>' : "");
  }

  function draw() {
    const v = $("#hotView"), d = DAY.d;
    const all = DAY.items || [];
    const base = all.filter((x) => mode === "lu" ? x.lu : true);
    const counts = new Map();
    base.forEach((x) => (x.grp || []).forEach((g) => counts.set(g, (counts.get(g) || 0) + 1)));
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (grp && !counts.has(grp)) grp = "";
    const list = base.filter((x) => !grp || (x.grp || []).includes(grp));
    const lu = all.filter((x) => x.lu).length;
    const date = (s) => `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6)}`;
    v.innerHTML = `<div class="hot">
      <div class="hot-head">
        <div><h2>強勢族群</h2><p class="hint">漲停 ${lu} 檔 · 漲幅 ≥ 8% 共 ${all.length} 檔 · 點族群標籤篩選 · 點個股看月營收與股價</p></div>
        <div class="hot-ctl">
          <select id="hotDate" aria-label="日期">${IDX.dates.map((x) => `<option value="${x}" ${x === d ? "selected" : ""}>${date(x)}</option>`).join("")}</select>
          <div class="seg" role="group" aria-label="篩選">
            <button data-mode="lu" class="${mode === "lu" ? "on" : ""}">漲停</button>
            <button data-mode="all" class="${mode === "all" ? "on" : ""}">漲幅 ≥ 8%</button>
          </div>
        </div>
      </div>
      <div class="grp-chips"><button data-grp="" class="${grp ? "" : "on"}">全部 <b>${base.length}</b></button>${groups.map(([g, n]) => `<button data-grp="${esc(g)}" class="${g === grp ? "on" : ""}">${esc(g)} <b>${n}</b></button>`).join("")}</div>
      ${list.length ? `<div class="table-wrap"><table class="hot-tbl"><thead><tr>
        <th>所</th><th class="l">代號 名稱</th><th class="l">族群</th><th>漲幅</th><th>收盤</th><th>量(張)</th><th>外資</th><th>投信</th><th>自營</th><th class="l ai">上漲理由／近期新聞</th>
      </tr></thead><tbody>${list.map(row).join("")}</tbody></table></div>` : '<p class="empty">這天沒有符合條件的個股。</p>'}
      <p class="hint">${DAY.ai ? "理由由 Gemini 依近期新聞標題摘要；" : ""}近期新聞取自 Google 新聞（近 7 天，點標題看原文），僅供參考，非投資建議。　資料更新於 ${esc(DAY.updated || "")}</p>
    </div>`;
  }
  function row(x) {
    const inst = x.inst || [null, null, null];
    return `<tr data-rev="${x.c}" data-m="${esc(x.m)}">
      <td><span class="mk ${x.m === "上櫃" ? "otc" : ""}">${x.m === "上櫃" ? "櫃" : "市"}</span></td>
      <td class="l name"><b>${x.c}</b> ${esc(x.n)}${x.lu ? '<span class="tag lu">漲停</span>' : ""}${chipTags(x.c)}</td>
      <td class="l grp">${(x.grp || []).map((g) => `<span class="g">${esc(g)}</span>`).join("")}</td>
      <td class="up b">+${x.pct.toFixed(2)}%</td>
      <td class="up" data-l="收盤">${fmtN(x.close, x.close < 100 ? 2 : 1)}</td>
      <td data-l="量(張)">${fmtN(x.vol)}</td>
      ${inst.map((n, k) => `<td class="${sgnCls(n)}" data-l="${["外資", "投信", "自營"][k]}">${n == null ? "–" : (n > 0 ? "+" : "") + fmtN(n)}</td>`).join("")}
      <td class="l ai">${aiCell(x)}</td>
    </tr>`;
  }

  function aiCell(x) {
    const news = (x.news || []).map(([t, src, url, d]) => `<a class="nw" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(src)}">${esc(d)} ${esc(t)}</a>`);
    if (x.reason) return `${esc(x.reason)}${x.event ? `<small>${esc(x.event)}</small>` : ""}${news.length ? `<small>${news[0]}</small>` : ""}`;
    if (news.length) return news.map((n, i) => (i ? `<small>${n}</small>` : n)).join("");
    return '<span class="muted">–</span>';
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("a.nw")) { e.stopPropagation(); return; }
    if (!e.target.closest("#hotView")) return;
    const m = e.target.closest("[data-mode]"); if (m) { mode = m.dataset.mode; store.set("mode", mode); grp = ""; draw(); return; }
    const g = e.target.closest("[data-grp]"); if (g) { grp = g.dataset.grp; draw(); return; }
  });
  document.addEventListener("change", (e) => { if (e.target.id === "hotDate") { curDate = e.target.value; grp = ""; show(); } });

  // ======================= 月營收圖表 =======================
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-rev]"); if (!t) return;
    e.preventDefault();
    openRev(t.dataset.rev, t.dataset.m || "");
  });

  let REV = null, PRICE = null, revTab = "rev";
  async function openRev(code, market) {
    const dlg = $("#revDlg");
    const it = (DAY?.items || []).find((x) => x.c === code);
    const r = window.CT?.byCode.get(code);
    const name = it?.n || r?.name || "";
    $("#revTitle").innerHTML = `<b>${code}</b> ${esc(name)}`;
    const close = it?.close ?? r?.price, pct = it?.pct;
    $("#revSub").innerHTML = `${close != null ? `<span class="px ${sgnCls(pct)}">${fmtN(close, close < 100 ? 2 : 1)}</span>` : ""}${pct != null ? `<span class="${sgnCls(pct)}">${sgnTxt(pct, 2)}%</span>` : ""}
      <span class="muted">${esc(it?.m || r?.market || market || "")} · ${esc(it?.ind || r?.ind || "")}</span>`;
    $("#revBody").innerHTML = '<p class="hint">載入中…</p>';
    if (!dlg.open) dlg.showModal();
    REV = null; PRICE = null;
    try { REV = await getJSON(`data/rev/${code}.json`); } catch { REV = null; }
    try { PRICE = await getJSON(`data/price/${code}.json`); } catch { PRICE = null; }
    drawRev();
  }
  function drawRev() {
    const b = $("#revBody");
    if (!REV || !REV.m?.length) { b.innerHTML = '<p class="empty">尚無月營收資料（資料每月 10 日前陸續更新）。</p>'; return; }
    const tabs = [["rev", "月營收"], ["mom", "月增率"], ["yoy", "年增率"]];
    b.innerHTML = `<div class="seg rev-tabs">${tabs.map(([k, t]) => `<button data-rt="${k}" class="${revTab === k ? "on" : ""}">${t}</button>`).join("")}</div>
      <div class="rev-legend"><span class="lg bar"></span>${revTab === "rev" ? "營收（億元）" : revTab === "mom" ? "月增率 %" : "年增率 %"}${PRICE ? '<span class="lg line"></span>股價（月收盤）' : ""}</div>
      <div class="rev-chart">${chart()}<div class="rev-tip" hidden></div><div class="rev-xl" hidden></div></div>
      <div class="rev-tbl-wrap"><table class="rev-tbl"><thead><tr><th class="l">日期</th><th>月營收<small>(億元)</small></th><th>MoM<small>(%)</small></th><th>YoY<small>(%)</small></th><th>累計 YoY<small>(%)</small></th></tr></thead><tbody>
      ${[...REV.m].reverse().map(([ym, v, mom, yoy, cum]) => `<tr><td class="l">${ym.slice(0, 4)}/${ym.slice(4)}</td><td>${fmtN(v, 2)}</td><td class="${sgnCls(mom)}">${sgnTxt(mom)}</td><td class="${sgnCls(yoy)}">${sgnTxt(yoy)}</td><td class="${sgnCls(cum)}">${sgnTxt(cum)}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="hint">資料來源：公開資訊觀測站月營收彙總表、Yahoo 財經月收盤價。</p>`;
    hoverAt(GEO.n - 1);
  }
  let GEO = null;
  function hoverAt(i) {
    const box = $("#revBody .rev-chart"); if (!box || !GEO) return;
    i = Math.max(0, Math.min(GEO.n - 1, i));
    const r = GEO.rows[i], cx = GEO.x(i) + GEO.bw / 2;
    const ln = box.querySelector(".cur"); if (ln) { ln.setAttribute("x1", cx); ln.setAttribute("x2", cx); ln.style.display = ""; }
    const v = GEO.vals[i], p = GEO.pm?.get(r[0]);
    const lab = revTab === "rev" ? "月營收" : revTab === "mom" ? "月增率" : "年增率";
    const val = v == null ? "–" : revTab === "rev" ? `${fmtN(v, 2)} 億元` : `${sgnTxt(v)}%`;
    const tip = box.querySelector(".rev-tip");
    tip.innerHTML = `<b>${r[0].slice(0, 4)}/${r[0].slice(4)}</b><span>${lab}</span><em>${val}</em>${GEO.pm ? `<span>股價</span><em>${p == null ? "–" : fmtN(p, p < 100 ? 2 : 1)}</em>` : ""}`;
    tip.hidden = false;
    const xl = box.querySelector(".rev-xl");
    xl.textContent = `${r[0].slice(0, 4)}/${r[0].slice(4)}`; xl.hidden = false;
    const pct = (cx / GEO.W) * 100;
    xl.style.left = `${Math.min(88, Math.max(12, pct))}%`;
    tip.style.left = pct < 50 ? "auto" : "12%"; tip.style.right = pct < 50 ? "12%" : "auto";
  }
  function onMove(e) {
    const svg = e.target.closest?.("#revBody .rev-chart svg"); if (!svg || !GEO) return;
    const rc = svg.getBoundingClientRect();
    const px = ((e.touches ? e.touches[0].clientX : e.clientX) - rc.left) * GEO.W / rc.width;
    hoverAt(Math.floor((px - GEO.P.l) / GEO.bw));
  }
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerdown", onMove);
  document.addEventListener("touchmove", onMove, { passive: true });
  document.addEventListener("click", (e) => { const t = e.target.closest("[data-rt]"); if (t) { revTab = t.dataset.rt; drawRev(); } });

  function chart() {
    const rows = REV.m.slice(-60);
    const sm = innerWidth < 600, W = sm ? 420 : 720, H = sm ? 260 : 300, P = { l: sm ? 34 : 52, r: sm ? 38 : 56, t: 22, b: 26 };
    const n = rows.length, bw = (W - P.l - P.r) / n;
    const idx = revTab === "rev" ? 1 : revTab === "mom" ? 2 : 3;
    const vals = rows.map((r) => r[idx]);
    const nums = vals.filter((x) => x != null);
    let lo = revTab === "rev" ? 0 : Math.min(0, ...nums), hi = Math.max(...nums, revTab === "rev" ? 1 : 0);
    if (revTab !== "rev") { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = Math.max(lo, -m); hi = m; lo = Math.min(lo, 0); }
    const pad = (hi - lo) * 0.08; hi += pad; if (revTab !== "rev") lo -= pad;
    const y = (v) => P.t + (hi - v) * (H - P.t - P.b) / (hi - lo || 1);
    const x = (i) => P.l + i * bw;
    const maxI = revTab === "rev" ? vals.indexOf(Math.max(...nums)) : -1;
    let s = "";
    for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4; s += `<line class="gl" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(revTab === "rev" ? (hi < 20 ? 1 : 0) : 0)}</text>`; }
    const z = y(Math.max(lo, 0));
    rows.forEach((r, i) => {
      const v = vals[i]; if (v == null) return;
      const top = Math.min(y(v), z), h = Math.max(1, Math.abs(y(v) - z));
      const cls = revTab === "rev" ? "rb" : v >= 0 ? "rb pos" : "rb neg";
      s += `<rect class="${cls}" x="${(x(i) + bw * 0.12).toFixed(1)}" y="${top.toFixed(1)}" width="${(bw * 0.76).toFixed(1)}" height="${h.toFixed(1)}"/>`;
      if (r[0].endsWith("01")) s += `<text class="ax" x="${x(i) + bw / 2}" y="${H - 8}" text-anchor="start">${r[0].slice(0, 4)}</text>`;
    });
    if (maxI >= 0) { const cx = x(maxI) + bw / 2, cy = y(vals[maxI]); s += `<g class="maxtag"><rect x="${cx - 17}" y="${cy - 22}" width="34" height="16" rx="3"/><text x="${cx}" y="${cy - 10}" text-anchor="middle">最高</text></g>`; }
    const pm = PRICE?.m?.length ? new Map(PRICE.m) : null;
    GEO = { rows, vals, n, bw, W, H, P, x, pm };
    if (pm) {
      const pts = rows.map((r, i) => [i, pm.get(r[0])]).filter((p) => p[1] != null);
      if (pts.length > 1) {
        const pv = pts.map((p) => p[1]); let plo = Math.min(...pv), phi = Math.max(...pv); const pp = (phi - plo) * 0.1 || 1; plo = Math.max(0, plo - pp); phi += pp * 1.6;
        const py = (v) => P.t + (phi - v) * (H - P.t - P.b) / (phi - plo);
        s += `<path class="pl" d="${pts.map((p, j) => (j ? "L" : "M") + (x(p[0]) + bw / 2).toFixed(1) + " " + py(p[1]).toFixed(1)).join("")}"/>`;
        for (let k = 0; k <= 4; k++) { const v = plo + (phi - plo) * k / 4; s += `<text class="ax" x="${W - P.r + 6}" y="${py(v) + 4}">${v.toFixed(v < 100 ? 1 : 0)}</text>`; }
      }
    }
    s += `<line class="cur" x1="0" x2="0" y1="${P.t - 6}" y2="${H - P.b}" style="display:none"/><rect class="hit" x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}"/>`;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="近五年月營收與股價">${s}</svg>`;
  }
  $("#revX")?.addEventListener("click", () => $("#revDlg").close());
  $("#revDlg")?.addEventListener("click", (e) => { if (e.target.id === "revDlg") e.target.close(); });
})();
