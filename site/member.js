/* CogniTrek 會員、留言板與瀏覽統計（Firebase） */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics, logEvent, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, updateProfile, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query, orderBy, limit,
  where, getDocs, onSnapshot, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBsbWgFtDo8QcB-uLJMURIzG4_HVq0OJeg",
  authDomain: "cognitrek-f0188.firebaseapp.com",
  projectId: "cognitrek-f0188",
  storageBucket: "cognitrek-f0188.firebasestorage.app",
  messagingSenderId: "149609857228",
  appId: "1:149609857228:web:71837d66c1494fab2a4269",
  measurementId: "G-K2HV07D0PR",
};
const ADMIN_EMAIL = "c5920111@gmail.com";
const CATS = ["籌碼思路", "產業趨勢", "個股討論", "網站建議"];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = "zh-TW";
const db = getFirestore(app);
let ga = null;
isSupported().then((ok) => { if (ok) ga = getAnalytics(app); }).catch(() => {});

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ls = {
  get(k) { try { return localStorage.getItem("ct:" + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem("ct:" + k, v); } catch { /* ignore */ } },
};
const tpeDate = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);

let user = null, profile = null, isAdmin = false, curTab = null, unsubPosts = null, registering = false;

// ======================= 瀏覽統計 =======================
(function track() {
  if (ls.get("noTrack") === "1") return;               // 版主自己的瀏覽不計
  let vid = ls.get("vid");
  if (!vid) { vid = Math.random().toString(36).slice(2) + Date.now().toString(36); ls.set("vid", vid); }
  let active = 0, since = document.visibilityState === "visible" ? Date.now() : 0, ref = null, lastSent = -1;
  const now = () => active + (since ? (Date.now() - since) / 1000 : 0);
  let r = ""; try { r = document.referrer ? new URL(document.referrer).hostname : ""; } catch { /* ignore */ }
  addDoc(collection(db, "visits"), {
    vid, d: tpeDate(), ts: serverTimestamp(), ref: r.slice(0, 80), m: matchMedia("(max-width: 700px)").matches, dur: 0,
  }).then((x) => { ref = x; }).catch(() => {});
  const flush = () => {
    const s = Math.min(86400, Math.round(now()));
    if (!ref || s <= lastSent) return;
    lastSent = s; updateDoc(ref, { dur: s }).catch(() => {});
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { if (since) { active += (Date.now() - since) / 1000; since = 0; } flush(); }
    else since = Date.now();
  });
  addEventListener("pagehide", flush);
  setInterval(() => { if (now() - lastSent >= 120) flush(); }, 30000);
})();

// ======================= 頁首帳號區 =======================
function renderAcct() {
  const box = $("#acct");
  if (!user) {
    box.innerHTML = '<button class="acct-btn" data-a="login">登入</button><button class="acct-btn solid" data-a="register">註冊</button>';
  } else {
    const name = profile?.nickname || user.displayName || user.email;
    box.innerHTML = `<button class="acct-me" data-a="menu">${esc(name)}${isAdmin ? '<span class="badge-admin">版主</span>' : ""} ▾</button>
      <div class="acct-menu" hidden>
        <button data-a="board">留言板</button>
        ${isAdmin ? '<button data-a="admin">後台統計</button>' : ""}
        <button data-a="profile">個人資料</button>
        <button data-a="logout">登出</button>
      </div>`;
  }
  const at = document.querySelector('.tab[data-tab="admin"]'); if (at) at.hidden = !isAdmin;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("#acct [data-a]");
  const menu = $("#acct .acct-menu");
  if (!b) { if (menu && !e.target.closest("#acct")) menu.hidden = true; return; }
  const a = b.dataset.a;
  if (a === "login" || a === "register") openAuth(a);
  if (a === "menu") { menu.hidden = !menu.hidden; return; }
  if (menu) menu.hidden = true;
  if (a === "board" || a === "admin") goTab(a);
  if (a === "profile") openAuth("profile");
  if (a === "logout") signOut(auth);
});
function goTab(t) { const btn = document.querySelector(`.tab[data-tab="${t}"]`); if (btn) { btn.click(); btn.scrollIntoView({ behavior: "smooth", block: "nearest" }); } }

// ======================= 登入／註冊視窗 =======================
const dlg = $("#authDlg");
function msg(t, ok) { const m = $("#authMsg"); m.textContent = t || ""; m.className = "auth-msg" + (ok ? " ok" : ""); }
function errText(e) {
  const c = e?.code || "";
  return ({
    "auth/invalid-email": "Email 格式不正確",
    "auth/email-already-in-use": "這個 Email 已經註冊過，請直接登入",
    "auth/weak-password": "密碼至少需要 8 個字元",
    "auth/invalid-credential": "帳號或密碼錯誤",
    "auth/wrong-password": "帳號或密碼錯誤",
    "auth/user-not-found": "找不到這個帳號",
    "auth/too-many-requests": "嘗試次數過多，請稍後再試",
    "auth/popup-closed-by-user": "已取消 Google 登入",
    "auth/popup-blocked": "瀏覽器擋住了登入視窗，請允許彈出視窗後再試",
    "auth/network-request-failed": "網路連線失敗，請稍後再試",
  })[c] || ("發生錯誤：" + (e?.message || c));
}
function openAuth(mode) {
  msg("");
  const v = $("#authBody");
  $("#authTabs").hidden = mode === "profile" || mode === "verify";
  document.querySelectorAll("#authTabs button").forEach((b) => b.classList.toggle("on", b.dataset.m === mode));
  const google = `<button class="g-btn" data-act="google" type="button"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>使用 Google 帳號${mode === "register" ? "快速註冊" : "登入"}</button>
    <div class="or"><span>或使用 Email</span></div>`;
  if (mode === "login") {
    v.innerHTML = google + `<form id="fLogin" novalidate>
      <label>Email<input name="email" type="email" autocomplete="email" placeholder="name@gmail.com" required></label>
      <label>密碼<input name="pw" type="password" autocomplete="current-password" required></label>
      <button class="primary" type="submit">登入</button>
      <p class="auth-foot"><a href="#" data-act="forgot">忘記密碼？</a>　還沒有帳號？<a href="#" data-act="toRegister">立即註冊</a></p></form>`;
  } else if (mode === "register") {
    v.innerHTML = google + `<form id="fReg" novalidate>
      <div class="row2"><label>姓名<input name="name" autocomplete="name" maxlength="30" required></label>
      <label>暱稱（留言時顯示）<input name="nick" maxlength="20" required></label></div>
      <label>Gmail<input name="email" type="email" autocomplete="email" placeholder="name@gmail.com" required></label>
      <label>手機<input name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="09xxxxxxxx" maxlength="10" required></label>
      <div class="row2"><label>密碼（至少 8 碼）<input name="pw" type="password" autocomplete="new-password" minlength="8" required></label>
      <label>確認密碼<input name="pw2" type="password" autocomplete="new-password" required></label></div>
      <label class="chk"><input name="agree" type="checkbox"> 我同意本站僅將以上資料用於會員身分與聯繫，不對外公開（暱稱除外）</label>
      <button class="primary" type="submit">註冊並寄送驗證信</button>
      <p class="auth-foot">已經有帳號？<a href="#" data-act="toLogin">登入</a></p></form>`;
  } else if (mode === "profile") {
    const p = profile || {};
    v.innerHTML = `<h3 class="auth-h">${profile ? "個人資料" : "完成會員資料"}</h3>
      ${profile ? "" : '<p class="auth-note">第一次登入，請補上以下資料即可開始使用留言板。</p>'}
      <form id="fProf" novalidate>
      <div class="row2"><label>姓名<input name="name" maxlength="30" value="${esc(p.name || user?.displayName || "")}" required></label>
      <label>暱稱（留言時顯示）<input name="nick" maxlength="20" value="${esc(p.nickname || "")}" required></label></div>
      <label>Gmail<input value="${esc(user?.email || "")}" disabled></label>
      <label>手機<input name="phone" type="tel" inputmode="numeric" placeholder="09xxxxxxxx" maxlength="10" value="${esc(p.phone || "")}" required></label>
      <button class="primary" type="submit">儲存</button></form>`;
  } else if (mode === "verify") {
    v.innerHTML = `<h3 class="auth-h">請到信箱完成驗證</h3>
      <p class="auth-note">驗證信已寄到 <b>${esc(user?.email || "")}</b>。點信中的連結完成驗證後，回到這裡按「我已完成驗證」。<br>沒收到？請看看垃圾郵件匣。</p>
      <button class="primary" data-act="verified" type="button">我已完成驗證</button>
      <button class="ghost wide" data-act="resend" type="button">重新寄送驗證信</button>`;
  }
  if (!dlg.open) dlg.showModal();
}
$("#authTabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-m]"); if (b) openAuth(b.dataset.m); });
$("#authX").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

dlg.addEventListener("click", async (e) => {
  const a = e.target.closest("[data-act]")?.dataset.act; if (!a) return;
  e.preventDefault();
  try {
    if (a === "google") { msg("登入中…", true); await signInWithPopup(auth, new GoogleAuthProvider()); }
    if (a === "toRegister") openAuth("register");
    if (a === "toLogin") openAuth("login");
    if (a === "forgot") {
      const em = $("#fLogin [name=email]").value.trim();
      if (!em) return msg("請先在上方輸入 Email，再按忘記密碼");
      await sendPasswordResetEmail(auth, em); msg("重設密碼信已寄出，請到信箱查看", true);
    }
    if (a === "resend") { await sendEmailVerification(auth.currentUser); msg("已重新寄出驗證信", true); }
    if (a === "verified") {
      await auth.currentUser.reload(); await auth.currentUser.getIdToken(true);
      if (auth.currentUser.emailVerified) { msg("驗證完成！", true); await refresh(); setTimeout(() => dlg.close(), 700); }
      else msg("還沒有驗證成功，請點信中的連結後再試一次");
    }
  } catch (err) { msg(errText(err)); }
});

const PHONE = /^09\d{8}$/;
dlg.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, v = (n) => (f.elements[n]?.value || "").trim();
  try {
    if (f.id === "fLogin") {
      if (!v("email") || !v("pw")) return msg("請輸入 Email 與密碼");
      msg("登入中…", true);
      await signInWithEmailAndPassword(auth, v("email"), f.elements.pw.value);
    }
    if (f.id === "fReg") {
      if (!v("name") || !v("nick")) return msg("請填寫姓名與暱稱");
      if (!/^\S+@\S+\.\S+$/.test(v("email"))) return msg("請填寫正確的 Gmail");
      if (!PHONE.test(v("phone"))) return msg("手機格式請填 09 開頭共 10 碼");
      if (f.elements.pw.value.length < 8) return msg("密碼至少需要 8 個字元");
      if (f.elements.pw.value !== f.elements.pw2.value) return msg("兩次輸入的密碼不一致");
      if (!f.elements.agree.checked) return msg("請勾選同意資料使用說明");
      msg("建立帳號中…", true);
      registering = true;
      const cred = await createUserWithEmailAndPassword(auth, v("email"), f.elements.pw.value);
      await updateProfile(cred.user, { displayName: v("nick") });
      await saveProfile(cred.user, { name: v("name"), nickname: v("nick"), phone: v("phone") });
      await sendEmailVerification(cred.user);
      registering = false;
      await refresh();
      openAuth("verify");
    }
    if (f.id === "fProf") {
      if (!v("name") || !v("nick")) return msg("請填寫姓名與暱稱");
      if (!PHONE.test(v("phone"))) return msg("手機格式請填 09 開頭共 10 碼");
      await saveProfile(user, { name: v("name"), nickname: v("nick"), phone: v("phone") });
      await updateProfile(user, { displayName: v("nick") });
      msg("已儲存", true); await refresh(); setTimeout(() => dlg.close(), 600);
    }
  } catch (err) { registering = false; msg(errText(err)); }
});

async function saveProfile(u, d) {
  const ref = doc(db, "users", u.uid);
  const old = await getDoc(ref);
  const data = { name: d.name, nickname: d.nickname, phone: d.phone, email: u.email || "",
    provider: u.providerData[0]?.providerId || "password" };
  if (old.exists()) await updateDoc(ref, data);
  else await setDoc(ref, { ...data, created: serverTimestamp() });
  profile = { ...(old.exists() ? old.data() : {}), ...data };
}

async function refresh() {
  user = auth.currentUser;
  isAdmin = !!(user && user.email === ADMIN_EMAIL && user.emailVerified);
  if (isAdmin) ls.set("noTrack", "1");
  profile = null;
  if (user) { try { const s = await getDoc(doc(db, "users", user.uid)); profile = s.exists() ? s.data() : null; } catch { profile = null; } }
  renderAcct();
  if (curTab) render(curTab);
}

onAuthStateChanged(auth, async (u) => {
  if (registering) { user = u; return; }
  await refresh();
  if (u && dlg.open) {
    if (!profile) openAuth("profile");
    else if (!u.emailVerified) openAuth("verify");
    else { msg("登入成功", true); setTimeout(() => dlg.close(), 500); }
  } else if (u && !profile) openAuth("profile");
});

// ======================= 分頁 =======================
document.addEventListener("ct:tab", (e) => { curTab = e.detail; render(curTab); if (ga) try { logEvent(ga, "select_content", { content_type: "tab", item_id: curTab }); } catch { /* ignore */ } });
function render(tab) {
  if (tab !== "board" && unsubPosts) { unsubPosts(); unsubPosts = null; }
  if (tab === "board") renderBoard();
  if (tab === "admin") renderAdmin();
}

// ======================= 留言板 =======================
const fmtTime = (ts) => {
  const d = ts?.toDate ? ts.toDate() : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
let filterCat = "";
function renderBoard() {
  const v = $("#boardView");
  if (!user) {
    v.innerHTML = `<div class="lock"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
      <h3>會員留言板</h3><p>登入後即可留言，與版主交流籌碼思路與產業趨勢。</p>
      <div class="lock-act"><button class="primary" data-a2="login">登入</button><button class="ghost" data-a2="register">免費註冊</button></div></div>`;
    return;
  }
  if (!profile) { v.innerHTML = '<div class="lock"><h3>請先完成會員資料</h3><div class="lock-act"><button class="primary" data-a2="profile">填寫資料</button></div></div>'; return; }
  const verified = user.emailVerified;
  v.innerHTML = `<div class="board">
    <form class="compose" id="fPost">
      ${verified ? "" : '<p class="warn">你的 Email 尚未驗證，驗證後才能發言。<button type="button" class="link" data-a2="verify">前往驗證</button></p>'}
      <div class="compose-top"><b>${esc(profile.nickname)}</b>${isAdmin ? '<span class="badge-admin">版主</span>' : ""}
        <select name="cat">${CATS.map((c) => `<option>${c}</option>`).join("")}</select></div>
      <textarea name="text" maxlength="2000" rows="3" placeholder="分享你的籌碼觀察、產業看法，或想問版主的問題…" ${verified ? "" : "disabled"}></textarea>
      <div class="compose-foot"><span class="hint">請理性討論，勿張貼個人資料或投資邀約。</span><button class="primary" type="submit" ${verified ? "" : "disabled"}>發表</button></div>
    </form>
    <div class="cat-filter">${["", ...CATS].map((c) => `<button type="button" data-cat="${c}" class="${c === filterCat ? "on" : ""}">${c || "全部"}</button>`).join("")}</div>
    <div id="posts"><p class="hint">載入中…</p></div></div>`;
  if (unsubPosts) unsubPosts();
  const q = query(collection(db, "posts"), orderBy("ts", "desc"), limit(100));
  unsubPosts = onSnapshot(q, (snap) => drawPosts(snap.docs), (err) => { $("#posts").innerHTML = `<p class="warn">讀取失敗：${esc(err.message)}</p>`; });
}
const repliesCache = new Map();
function drawPosts(docs) {
  const box = $("#posts"); if (!box) return;
  const list = docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => !filterCat || p.cat === filterCat);
  if (!list.length) { box.innerHTML = '<p class="empty">還沒有留言，來當第一個吧！</p>'; return; }
  box.innerHTML = list.map((p) => `<article class="post" data-id="${p.id}">
    <header><b>${esc(p.nick)}</b>${p.admin ? '<span class="badge-admin">版主</span>' : ""}<span class="cat">${esc(p.cat)}</span><time>${fmtTime(p.ts)}</time>
      ${p.uid === user.uid || isAdmin ? '<button class="del" data-del="post" title="刪除">刪除</button>' : ""}</header>
    <div class="txt">${esc(p.text)}</div>
    <div class="replies" id="r-${p.id}"></div>
    <form class="reply" data-id="${p.id}"><input name="text" maxlength="1000" placeholder="回覆…" ${user.emailVerified ? "" : "disabled"}><button class="ghost" type="submit" ${user.emailVerified ? "" : "disabled"}>回覆</button></form>
  </article>`).join("");
  list.forEach((p) => loadReplies(p.id));
}
async function loadReplies(pid) {
  try {
    const s = await getDocs(query(collection(db, "posts", pid, "replies"), orderBy("ts", "asc"), limit(100)));
    const el = document.getElementById("r-" + pid); if (!el) return;
    el.innerHTML = s.docs.map((d) => { const r = d.data(); return `<div class="rp" data-rid="${d.id}"><b>${esc(r.nick)}</b>${r.admin ? '<span class="badge-admin">版主</span>' : ""}<time>${fmtTime(r.ts)}</time>
      ${r.uid === user.uid || isAdmin ? '<button class="del" data-del="reply">刪除</button>' : ""}<div class="txt">${esc(r.text)}</div></div>`; }).join("");
  } catch { /* ignore */ }
}
document.addEventListener("click", async (e) => {
  const a2 = e.target.closest("[data-a2]")?.dataset.a2;
  if (a2) { openAuth(a2); return; }
  const cat = e.target.closest(".cat-filter [data-cat]");
  if (cat) { filterCat = cat.dataset.cat; renderBoard(); return; }
  const del = e.target.closest("[data-del]");
  if (del && confirmDel()) {
    const pid = del.closest(".post").dataset.id;
    try {
      if (del.dataset.del === "post") await deleteDoc(doc(db, "posts", pid));
      else { await deleteDoc(doc(db, "posts", pid, "replies", del.closest(".rp").dataset.rid)); loadReplies(pid); }
    } catch (err) { alertBox("刪除失敗：" + err.message); }
  }
});
function confirmDel() { return window.confirm("確定要刪除嗎？"); }
function alertBox(t) { const p = $("#posts"); if (p) p.insertAdjacentHTML("afterbegin", `<p class="warn">${esc(t)}</p>`); }
document.addEventListener("submit", async (e) => {
  const f = e.target;
  if (f.id === "fPost") {
    e.preventDefault();
    const text = f.elements.text.value.trim(); if (!text) return;
    f.querySelector("button[type=submit]").disabled = true;
    try {
      await addDoc(collection(db, "posts"), { uid: user.uid, nick: profile.nickname, cat: f.elements.cat.value, text, admin: isAdmin, ts: serverTimestamp() });
      f.elements.text.value = "";
    } catch (err) { alertBox("發表失敗：" + err.message); }
    f.querySelector("button[type=submit]").disabled = false;
  }
  if (f.classList.contains("reply")) {
    e.preventDefault();
    const text = f.elements.text.value.trim(), pid = f.dataset.id; if (!text) return;
    try {
      await addDoc(collection(db, "posts", pid, "replies"), { uid: user.uid, nick: profile.nickname, text, admin: isAdmin, ts: serverTimestamp() });
      f.elements.text.value = ""; loadReplies(pid);
    } catch (err) { alertBox("回覆失敗：" + err.message); }
  }
});

// ======================= 後台統計（僅版主） =======================
async function renderAdmin() {
  const v = $("#adminView");
  if (!isAdmin) { v.innerHTML = '<p class="empty">這裡只有版主看得到。</p>'; return; }
  v.innerHTML = '<p class="hint">統計中…</p>';
  try {
    const since = Timestamp.fromDate(new Date(Date.now() - 30 * 864e5));
    const [vs, us, ps] = await Promise.all([
      getDocs(query(collection(db, "visits"), where("ts", ">=", since), orderBy("ts", "desc"), limit(20000))),
      getDocs(query(collection(db, "users"), orderBy("created", "desc"), limit(500))),
      getDocs(query(collection(db, "posts"), orderBy("ts", "desc"), limit(500))),
    ]);
    const visits = vs.docs.map((d) => d.data());
    const today = tpeDate(), d7 = tpeDate(new Date(Date.now() - 6 * 864e5));
    const pick = (fn) => visits.filter(fn);
    const stat = (arr) => {
      const dur = arr.map((x) => x.dur || 0).filter((x) => x > 0);
      return { pv: arr.length, uv: new Set(arr.map((x) => x.vid)).size, avg: dur.length ? dur.reduce((a, b) => a + b, 0) / dur.length : 0 };
    };
    const S1 = stat(pick((x) => x.d === today)), S7 = stat(pick((x) => x.d >= d7)), S30 = stat(visits);
    const mmss = (s) => `${Math.floor(s / 60)} 分 ${String(Math.round(s % 60)).padStart(2, "0")} 秒`;
    const days = [...Array(30)].map((_, i) => tpeDate(new Date(Date.now() - (29 - i) * 864e5)));
    const byDay = days.map((d) => { const a = visits.filter((x) => x.d === d); return { d, pv: a.length, uv: new Set(a.map((x) => x.vid)).size }; });
    const max = Math.max(1, ...byDay.map((x) => x.pv));
    const mob = visits.filter((x) => x.m).length, refs = {};
    visits.forEach((x) => { const r = x.ref || "（直接進站）"; refs[r] = (refs[r] || 0) + 1; });
    const topRef = Object.entries(refs).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const card = (t, s) => `<div class="kpi"><h4>${t}</h4><p><b>${s.pv.toLocaleString()}</b><small>瀏覽人次</small></p><p><b>${s.uv.toLocaleString()}</b><small>不重複訪客</small></p><p><b>${mmss(s.avg)}</b><small>平均停留</small></p></div>`;
    v.innerHTML = `<div class="admin">
      <div class="kpis">${card("今天", S1)}${card("近 7 天", S7)}${card("近 30 天", S30)}
        <div class="kpi"><h4>會員與留言</h4><p><b>${us.size}</b><small>註冊會員</small></p><p><b>${ps.size}</b><small>留言數</small></p><p><b>${visits.length ? Math.round(mob * 100 / visits.length) : 0}%</b><small>手機瀏覽</small></p></div></div>
      <h4 class="sec">近 30 天每日瀏覽人次</h4>
      <div class="bars">${byDay.map((x) => `<div class="bar" title="${x.d}：${x.pv} 人次／${x.uv} 位訪客"><i style="height:${(x.pv / max) * 100}%"></i><span>${+x.d.slice(8)}</span></div>`).join("")}</div>
      <div class="admin-grid">
        <div><h4 class="sec">來源網站（近 30 天）</h4><table class="mini"><tbody>${topRef.map(([r, n]) => `<tr><td class="l">${esc(r)}</td><td>${n}</td></tr>`).join("") || '<tr><td class="l">尚無資料</td></tr>'}</tbody></table></div>
        <div><h4 class="sec">最新會員</h4><table class="mini"><thead><tr><th class="l">暱稱</th><th class="l">姓名</th><th class="l">Email</th><th class="l">手機</th><th>加入</th></tr></thead><tbody>
          ${us.docs.slice(0, 50).map((d) => { const u = d.data(); return `<tr><td class="l">${esc(u.nickname)}</td><td class="l">${esc(u.name)}</td><td class="l">${esc(u.email)}</td><td class="l">${esc(u.phone)}</td><td>${u.created ? fmtTime(u.created).slice(0, 10) : ""}</td></tr>`; }).join("") || '<tr><td class="l" colspan="5">尚無會員</td></tr>'}</tbody></table></div>
      </div>
      <p class="hint">這頁只有版主帳號看得到；版主自己的瀏覽不列入統計。更完整的分析（地區、裝置、即時人數）請到 <a href="https://analytics.google.com/" target="_blank" rel="noopener">Google Analytics</a>。</p></div>`;
  } catch (err) { v.innerHTML = `<p class="warn">讀取統計失敗：${esc(err.message)}</p>`; }
}

renderAcct();
{ const act = document.querySelector(".tab.active")?.dataset.tab; if (act === "board" || act === "admin") { curTab = act; render(act); } }
