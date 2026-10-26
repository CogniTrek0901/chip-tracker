/* CogniTrek 小功能：亞當理論（擷取 K 線 → 左右翻轉 → 上下翻轉 → 對接到最新價） */
(() => {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (v) => (v == null ? "–" : Number(v).toLocaleString("zh-TW", { maximumFractionDigits: v < 100 ? 2 : 1 }));
  const ymd = (s) => `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}`;
  const store = {
    get(k, d) { try { return localStorage.getItem("ct:adam:" + k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("ct:adam:" + k, v); } catch { /* ignore */ } },
  };
  const SPAN = [["60", "3月"], ["125", "6月"], ["260", "1年"]];

  // 狀態
  let root = null, K = null, code = store.get("code", "2330"), span = +store.get("span", "125");
  let sel = null;        // {a, b}：可見範圍內的索引
  let seg = null;        // 擷取片段 [{d,o,h,l,c}]
  let stage = 0;         // 0 無、1 已擷取、2 已左右翻轉、3 已上下翻轉
  let docked = false;

  window.CTAdam = { render };

  function stocks() {
    const m = window.CT?.byCode;
    return m ? [...m.values()].map((r) => [r.code, r.name]) : [];
  }

  function render(el) {
    root = el;
    const list = stocks();
    el.innerHTML = `<div class="adam">
      <div class="adam-top">
        <form class="adam-search" id="adamForm" autocomplete="off">
          <input id="adamQ" list="adamList" placeholder="輸入代號或名稱，例如 2330 或 台積電" value="${esc(code)}">
          <button class="primary" type="submit">查詢</button>
          <datalist id="adamList">${list.map(([c, n]) => `<option value="${c} ${esc(n)}">`).join("")}</datalist>
        </form>
        <div class="adam-intro"><b>亞當理論（亞當翻）</b>：把過去一段走勢先「左右翻轉」（時間倒過來）、再「上下翻轉」（價格倒過來），接在今天的價格後面，
          當作未來可能路徑的參考圖，稱為「第二影像」。它是輔助判斷趨勢延續或反轉的視覺工具，不是預測保證。</div>
      </div>
      <div class="adam-main">
        <section class="adam-panel">
          <div class="adam-h"><h4 id="adamTitle">K 線圖</h4><div class="seg">${SPAN.map(([k, t]) => `<button data-span="${k}" class="${+k === span ? "on" : ""}">${t}</button>`).join("")}</div></div>
          <p class="adam-tip">在圖上<b>拖曳</b>選取範圍；拖曳範圍中間可左右移動，拖曳邊緣可調整長短。</p>
          <div class="adam-chart" id="adamChart"><p class="hint">載入中…</p></div>
          <div class="adam-btns">
            <button data-act="cap" class="ghost">① 擷取範圍</button>
            <button data-act="hf" class="ghost">② 左右翻轉</button>
            <button data-act="vf" class="ghost">③ 上下翻轉</button>
            <button data-act="reset" class="ghost sm">重設</button>
          </div>
          <div class="adam-tray" id="adamTray"></div>
        </section>
        <section class="adam-panel adam-dock" id="adamDock">
          <div class="adam-h"><h4>對接區</h4><span class="hint" id="adamDockHint"></span></div>
          <div class="adam-chart" id="adamDockChart"></div>
        </section>
      </div>
      <p class="hint">K 線資料：Yahoo 財經日線（近一年，每個交易日晚上更新）。翻轉規則：左右翻轉＝K 棒順序倒過來、開收盤互換；上下翻轉＝以擷取區最後一天的收盤價為中心，把價格鏡像。對接時把第一根接在最新收盤價。</p>
    </div>`;
    el.querySelector("#adamForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = el.querySelector("#adamQ").value.trim();
      const m = v.match(/^\d{4,6}[A-Z]?/i);
      let c = m ? m[0].toUpperCase() : "";
      if (!c) { const hit = stocks().find(([, n]) => n && v && n.includes(v)); if (hit) c = hit[0]; }
      if (!c) { el.querySelector("#adamChart").innerHTML = '<p class="empty">找不到這檔股票，請輸入代號或完整名稱。</p>'; return; }
      load(c);
    });
    if (!el.dataset.adam) { el.addEventListener("click", onClick); el.dataset.adam = "1"; }
    load(code);
  }

  async function load(c) {
    code = c; store.set("code", c);
    const box = root.querySelector("#adamChart");
    box.innerHTML = '<p class="hint">載入中…</p>';
    try {
      const r = await fetch(`data/k/${c}.json`, { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status === 404 ? "這檔還沒有 K 線資料（每天晚上補齊）" : "HTTP " + r.status);
      const j = await r.json();
      K = j.d.map(([d, o, h, l, cl, v]) => ({ d, o, h, l, c: cl, v }));
      root.querySelector("#adamTitle").innerHTML = `K 線圖 · <b>${esc(j.c)}</b> ${esc(j.n)}`;
      root.querySelector("#adamQ").value = `${j.c} ${j.n}`;
    } catch (e) {
      K = null;
      box.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
      return;
    }
    seg = null; stage = 0; docked = false; sel = null;
    drawMain(); drawTray(); drawDock();
  }

  function view() { return K ? K.slice(-span) : []; }

  // ---------------- K 線繪製 ----------------
  function geom(n, sm) {
    const W = sm ? 380 : 620, H = sm ? 250 : 320, P = { l: 6, r: sm ? 44 : 52, t: 10, b: 22 };
    const bw = (W - P.l - P.r) / Math.max(n, 1);
    return { W, H, P, bw, x: (i) => P.l + i * bw + bw / 2 };
  }
  function scale(bars, G, extra = []) {
    const vals = bars.flatMap((b) => [b.h, b.l]).concat(extra).filter((v) => v != null);
    let lo = Math.min(...vals), hi = Math.max(...vals); const p = (hi - lo) * 0.06 || 1; lo -= p; hi += p;
    return { lo, hi, y: (v) => G.P.t + ((hi - v) * (G.H - G.P.t - G.P.b)) / (hi - lo) };
  }
  function candles(bars, G, S, cls = "") {
    let s = "";
    const w = Math.max(1, G.bw * 0.68);
    bars.forEach((b, i) => {
      const up = b.c >= b.o, x = G.x(i);
      const top = S.y(Math.max(b.o, b.c)), bot = S.y(Math.min(b.o, b.c));
      s += `<g class="cd ${up ? "u" : "d"} ${cls}"><line x1="${x}" x2="${x}" y1="${S.y(b.h)}" y2="${S.y(b.l)}"/><rect x="${x - w / 2}" y="${top}" width="${w}" height="${Math.max(1, bot - top)}"/></g>`;
    });
    return s;
  }
  function axes(G, S, bars) {
    let s = "";
    for (let k = 0; k <= 4; k++) {
      const v = S.lo + ((S.hi - S.lo) * k) / 4, y = S.y(v);
      s += `<line class="gl" x1="${G.P.l}" x2="${G.W - G.P.r}" y1="${y}" y2="${y}"/><text class="ax" x="${G.W - G.P.r + 4}" y="${y + 4}">${fmt(+v.toFixed(v < 100 ? 2 : 0))}</text>`;
    }
    let lm = "";
    bars.forEach((b, i) => { if (!b.d) return; const m = b.d.slice(4, 6); if (m !== lm) { if (lm && i > 2) s += `<text class="ax" x="${G.x(i)}" y="${G.H - 6}" text-anchor="middle">${+m}月</text>`; lm = m; } });
    return s;
  }

  function drawMain() {
    const box = root.querySelector("#adamChart");
    const bars = view(); if (!bars.length) return;
    const sm = innerWidth < 640, G = geom(bars.length, sm), S = scale(bars, G);
    if (!sel) { const n = bars.length; sel = { a: Math.max(0, n - 40), b: n - 1 }; }
    box.innerHTML = `<svg viewBox="0 0 ${G.W} ${G.H}" width="100%">
      ${axes(G, S, bars)}
      <rect class="sel" id="adamSel"/>
      ${candles(bars, G, S)}
      <line class="cur" id="adamCur" y1="${G.P.t}" y2="${G.H - G.P.b}" style="display:none"/>
      <line class="curh" id="adamCurH" x1="${G.P.l}" x2="${G.W - G.P.r}" style="display:none"/>
      <rect class="hit" x="${G.P.l}" y="0" width="${G.W - G.P.l - G.P.r}" height="${G.H}"/>
    </svg><div class="rev-tip adam-tt" hidden></div>`;
    const svg = box.querySelector("svg"), tip = box.querySelector(".adam-tt");
    const selR = svg.querySelector("#adamSel"), cur = svg.querySelector("#adamCur"), curH = svg.querySelector("#adamCurH");
    const paint = () => {
      const x0 = G.x(sel.a) - G.bw / 2, x1 = G.x(sel.b) + G.bw / 2;
      selR.setAttribute("x", x0); selR.setAttribute("width", x1 - x0); selR.setAttribute("y", G.P.t); selR.setAttribute("height", G.H - G.P.t - G.P.b);
    };
    paint();
    const idxAt = (e) => {
      const rc = svg.getBoundingClientRect();
      const px = ((e.touches ? e.touches[0].clientX : e.clientX) - rc.left) * (G.W / rc.width);
      return { i: Math.max(0, Math.min(bars.length - 1, Math.floor((px - G.P.l) / G.bw))), px,
        py: ((e.touches ? e.touches[0].clientY : e.clientY) - rc.top) * (G.H / rc.height) };
    };
    const hover = (i, py) => {
      const b = bars[i], x = G.x(i);
      cur.setAttribute("x1", x); cur.setAttribute("x2", x); cur.style.display = "";
      if (py != null) { curH.setAttribute("y1", py); curH.setAttribute("y2", py); curH.style.display = ""; }
      tip.innerHTML = `<b>${ymd(b.d)}</b><span>開</span><em>${fmt(b.o)}</em><span>高</span><em>${fmt(b.h)}</em><span>低</span><em>${fmt(b.l)}</em><span>收</span><em>${fmt(b.c)}</em><span>選取</span><em>${sel.b - sel.a + 1} 根</em>`;
      tip.hidden = false;
      const pct = (x / G.W) * 100; tip.style.left = pct < 50 ? "auto" : "8px"; tip.style.right = pct < 50 ? "56px" : "auto";
    };
    let drag = null;
    svg.addEventListener("pointerdown", (e) => {
      const { i, px } = idxAt(e);
      const x0 = G.x(sel.a) - G.bw / 2, x1 = G.x(sel.b) + G.bw / 2, edge = Math.max(8, G.bw);
      if (Math.abs(px - x0) <= edge) drag = { m: "a" };
      else if (Math.abs(px - x1) <= edge) drag = { m: "b" };
      else if (px > x0 && px < x1) drag = { m: "move", i0: i, a0: sel.a, b0: sel.b };
      else { drag = { m: "new", i0: i }; sel = { a: i, b: i }; }
      svg.setPointerCapture(e.pointerId); paint(); hover(i);
    });
    svg.addEventListener("pointermove", (e) => {
      const { i, py } = idxAt(e);
      if (drag) {
        if (drag.m === "a") sel.a = Math.min(i, sel.b - 1);
        else if (drag.m === "b") sel.b = Math.max(i, sel.a + 1);
        else if (drag.m === "move") { const len = drag.b0 - drag.a0; let a = drag.a0 + (i - drag.i0); a = Math.max(0, Math.min(bars.length - 1 - len, a)); sel = { a, b: a + len }; }
        else sel = { a: Math.min(drag.i0, i), b: Math.max(drag.i0, i) };
        paint();
      }
      hover(i, py);
    });
    const end = () => { if (drag && sel.b - sel.a < 4) { sel.b = Math.min(bars.length - 1, sel.a + 4); paint(); } drag = null; };
    svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
    svg.addEventListener("pointerleave", () => { if (!drag) { cur.style.display = "none"; curH.style.display = "none"; tip.hidden = true; } });
  }

  // ---------------- 擷取片段（工作區） ----------------
  function drawTray() {
    const tray = root.querySelector("#adamTray");
    root.querySelectorAll(".adam-btns [data-act]").forEach((b) => {
      const a = b.dataset.act;
      b.classList.toggle("done", (a === "cap" && stage >= 1) || (a === "hf" && stage >= 2) || (a === "vf" && stage >= 3));
      b.disabled = (a === "hf" && stage < 1) || (a === "vf" && stage < 2);
    });
    if (!seg) { tray.innerHTML = '<p class="hint">選好範圍後按「① 擷取範圍」。</p>'; return; }
    const sm = innerWidth < 640, G = { ...geom(seg.length, sm) }; G.H = sm ? 120 : 140; G.P = { ...G.P, b: 6 };
    const S = scale(seg, G);
    const label = ["", "已擷取", "已左右翻轉", "已上下翻轉"][stage];
    tray.innerHTML = `<div class="adam-piece" id="adamPiece" title="拖曳到右邊對接區">
        <div class="adam-piece-h"><b>片段 ${seg.length} 根</b><span>${label}</span><span class="adam-grip">⠿ 拖曳到對接區</span></div>
        <svg viewBox="0 0 ${G.W} ${G.H}" width="100%">${candles(seg, G, S, stage >= 2 ? "pj" : "")}</svg>
      </div>
      <button class="primary adam-dockbtn" data-act="dock">④ 對接 →</button>`;
    bindDrag(root.querySelector("#adamPiece"));
  }

  function bindDrag(piece) {
    let ghost = null;
    piece.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      ghost = piece.cloneNode(true); ghost.classList.add("ghost-drag"); ghost.removeAttribute("id");
      ghost.style.width = piece.offsetWidth + "px";
      document.body.appendChild(ghost);
      move(e);
      piece.setPointerCapture(e.pointerId);
    });
    const move = (e) => { if (!ghost) return; ghost.style.left = e.clientX - ghost.offsetWidth / 2 + "px"; ghost.style.top = e.clientY - 20 + "px";
      const dz = root.querySelector("#adamDock").getBoundingClientRect();
      root.querySelector("#adamDock").classList.toggle("over", e.clientX >= dz.left && e.clientX <= dz.right && e.clientY >= dz.top && e.clientY <= dz.bottom); };
    piece.addEventListener("pointermove", move);
    piece.addEventListener("pointerup", (e) => {
      if (!ghost) return;
      ghost.remove(); ghost = null;
      const dock = root.querySelector("#adamDock"); dock.classList.remove("over");
      const dz = dock.getBoundingClientRect();
      if (e.clientX >= dz.left && e.clientX <= dz.right && e.clientY >= dz.top && e.clientY <= dz.bottom) doDock();
    });
  }

  function doDock() {
    if (!seg) return;
    docked = true; drawDock();
    if (innerWidth < 900) root.querySelector("#adamDock").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------- 對接區 ----------------
  function drawDock() {
    const box = root.querySelector("#adamDockChart"), hint = root.querySelector("#adamDockHint");
    if (!K) { box.innerHTML = ""; return; }
    if (!docked || !seg) {
      hint.textContent = "";
      box.innerHTML = `<div class="adam-drop"><p>把左邊的片段拖曳到這裡（或按「④ 對接」）</p><p class="hint">建議順序：① 擷取 → ② 左右翻轉 → ③ 上下翻轉 → 對接</p></div>`;
      return;
    }
    const last = K[K.length - 1];
    const n = seg.length, hist = K.slice(-Math.max(n, 30));
    const shift = last.c - seg[0].o;  // 把片段第一根的開盤接在最新收盤
    const proj = seg.map((b) => ({ d: "", o: b.o + shift, h: b.h + shift, l: b.l + shift, c: b.c + shift }));
    const all = hist.concat(proj);
    const sm = innerWidth < 640, G = geom(all.length, sm), S = scale(all, G);
    const jx = G.x(hist.length - 1) + G.bw / 2;
    const end = proj[proj.length - 1].c;
    hint.innerHTML = `${["", "原始片段", "左右翻轉", "左右＋上下翻轉"][stage]}・接在 ${ymd(last.d)} 收盤 ${fmt(last.c)}，片段終點 ${fmt(end)}（<span class="${end >= last.c ? "up" : "down"}">${end >= last.c ? "+" : ""}${((end / last.c - 1) * 100).toFixed(1)}%</span>）`;
    box.innerHTML = `<svg viewBox="0 0 ${G.W} ${G.H}" width="100%">
      ${axes(G, S, hist)}
      <rect class="pj-bg" x="${jx}" y="${G.P.t}" width="${G.W - G.P.r - jx}" height="${G.H - G.P.t - G.P.b}"/>
      <line class="ref" x1="${G.P.l}" x2="${G.W - G.P.r}" y1="${S.y(last.c)}" y2="${S.y(last.c)}"/>
      <line class="jn" x1="${jx}" x2="${jx}" y1="${G.P.t}" y2="${G.H - G.P.b}"/>
      <text class="ax" x="${jx + 4}" y="${G.P.t + 12}">今日 →</text>
      ${candles(hist, G, S)}
      <g transform="translate(${G.bw * hist.length},0)">${candles(proj, G, S, "pj")}</g>
    </svg>`;
  }

  // ---------------- 按鈕 ----------------
  function onClick(e) {
    const sp = e.target.closest("[data-span]");
    if (sp && root.contains(sp)) { span = +sp.dataset.span; store.set("span", span); sel = null;
      root.querySelectorAll("[data-span]").forEach((b) => b.classList.toggle("on", +b.dataset.span === span)); drawMain(); return; }
    const b = e.target.closest("[data-act]"); if (!b || !root.contains(b) || !K) return;
    const a = b.dataset.act, bars = view();
    if (a === "cap") { seg = bars.slice(sel.a, sel.b + 1).map((x) => ({ ...x })); stage = 1; docked = false; }
    else if (a === "hf" && seg) { seg = seg.slice().reverse().map((x) => ({ d: x.d, o: x.c, c: x.o, h: x.h, l: x.l })); stage = 2; }
    else if (a === "vf" && seg && stage >= 2) { const p = seg[0].o; seg = seg.map((x) => ({ d: x.d, o: 2 * p - x.o, c: 2 * p - x.c, h: 2 * p - x.l, l: 2 * p - x.h })); stage = 3; }
    else if (a === "reset") { seg = null; stage = 0; docked = false; sel = null; drawMain(); }
    else if (a === "dock") { doDock(); return; }
    if (docked) drawDock();
    drawTray();
  }
})();
