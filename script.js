/* =========================================================
   1. Name "collapses" out of superposition
   ========================================================= */
const GLYPHS = "01|⟩⟨ψφ+−×↕↔";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Each letter keeps its real width; a symbol flickers on top of it, so nothing shifts.
function collapse(el, delay) {
  const final = el.dataset.text;
  el.textContent = "";
  const spans = [...final].map(ch => {
    const s = document.createElement("span");
    s.className = "ch scr";
    s.textContent = ch;
    s.dataset.g = GLYPHS[(Math.random() * GLYPHS.length) | 0];
    el.appendChild(s);
    return s;
  });
  el.classList.add("ready");
  let frame = -delay;
  const end = final.length * 3 + 14;
  (function tick() {
    spans.forEach((s, i) => {
      if (frame >= i * 3 + 12) s.classList.remove("scr");
      else if (frame % 2 === 0) s.dataset.g = GLYPHS[(Math.random() * GLYPHS.length) | 0];
    });
    if (++frame < end) requestAnimationFrame(tick);   // letters stay in place when done
  })();
}
function startName() {
  if (startName.done) return; startName.done = true;
  document.querySelectorAll(".scramble").forEach((el, i) => {
    if (reduceMotion) { el.classList.add("ready"); return; }
    collapse(el, i * 10);
  });
}
// wait for the web fonts so the name doesn't re-render mid-animation (max 1.5 s)
(document.fonts ? document.fonts.ready : Promise.resolve()).then(startName);
setTimeout(startName, 1500);

/* =========================================================
   2. Interactive Bloch sphere (real single-qubit simulation)
   ========================================================= */
const cv = document.getElementById("bloch");
const ctx = cv.getContext("2d");
let W = 0, H = 0;
let yaw = -0.55, pitch = 0.3, dragging = false, lastX = 0, lastY = 0, idle = 0;

// amplitudes α, β as [re, im]
let A = [1, 0], B = [0, 0];
let vec = [0, 0, 1];            // displayed Bloch vector
let anim = null;                // current animation
const queue = [];
const trail = [];

let C = {};
function readColors() {
  const s = getComputedStyle(document.documentElement);
  C = { ink: s.getPropertyValue("--ink").trim(), ink2: s.getPropertyValue("--ink-2").trim(),
        rule: s.getPropertyValue("--rule").trim(), sig: s.getPropertyValue("--sig").trim(),
        blue: s.getPropertyValue("--blue").trim(), paper: s.getPropertyValue("--paper").trim() };
}
readColors();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColors);

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = cv.clientWidth; H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener("resize", resize);
resize();

// --- complex helpers ---
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const csub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cs = (a, k) => [a[0] * k, a[1] * k];
const abs2 = a => a[0] * a[0] + a[1] * a[1];
const R2 = Math.SQRT1_2;

function blochFromAmps() {
  // x = 2Re(α*β), y = 2Im(α*β), z = |α|²−|β|²
  const ab = cmul([A[0], -A[1]], B);
  return [2 * ab[0], 2 * ab[1], abs2(A) - abs2(B)];
}

// gate = amplitude update + equivalent Bloch rotation (axis, angle) for animation
const GATES = {
  H: { f: () => { const a = A; A = cs(cadd(a, B), R2); B = cs(csub(a, B), R2); }, axis: [R2, 0, R2], ang: Math.PI },
  X: { f: () => { [A, B] = [B, A]; }, axis: [1, 0, 0], ang: Math.PI },
  Y: { f: () => { const a = A; A = cmul([0, -1], B); B = cmul([0, 1], a); }, axis: [0, 1, 0], ang: Math.PI },
  Z: { f: () => { B = cs(B, -1); }, axis: [0, 0, 1], ang: Math.PI },
  S: { f: () => { B = cmul([0, 1], B); }, axis: [0, 0, 1], ang: Math.PI / 2 },
  T: { f: () => { B = cmul([R2, R2], B); }, axis: [0, 0, 1], ang: Math.PI / 4 },
};

function rotate(v, k, t) { // Rodrigues
  const c = Math.cos(t), s = Math.sin(t);
  const cross = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  const dot = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [0, 1, 2].map(i => v[i] * c + cross[i] * s + k[i] * dot * (1 - c));
}
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function applyGate(g) { queue.push({ type: "gate", g }); }
function measure() { queue.push({ type: "measure" }); }
function reset() { queue.length = 0; anim = null; A = [1, 0]; B = [0, 0]; vec = [0, 0, 1]; trail.length = 0; updateReadout("state reset to <b>|0⟩</b>"); }

function startNext() {
  const job = queue.shift();
  if (!job) return;
  if (job.type === "gate") {
    const G = GATES[job.g];
    G.f();
    anim = { kind: "rot", from: vec.slice(), axis: G.axis, ang: G.ang, f: 0, n: reduceMotion ? 1 : 42, label: job.g };
  } else {
    const p0 = abs2(A);
    const out = Math.random() < p0 ? 0 : 1;
    A = out ? [0, 0] : [1, 0]; B = out ? [1, 0] : [0, 0];
    anim = { kind: "collapse", from: vec.slice(), to: [0, 0, out ? -1 : 1], f: 0, n: reduceMotion ? 1 : 26, out, p: out ? 1 - p0 : p0 };
  }
}

function step() {
  if (!anim) { startNext(); if (!anim) return; }
  anim.f++;
  const t = ease(Math.min(anim.f / anim.n, 1));
  if (anim.kind === "rot") vec = rotate(anim.from, anim.axis, anim.ang * t);
  else {
    const v = anim.from.map((x, i) => x + (anim.to[i] - x) * t);
    const n = Math.hypot(...v) || 1;
    vec = v.map(x => x / n);
  }
  if (anim.f % 2 === 0) { trail.push(vec.slice()); if (trail.length > 140) trail.shift(); }
  if (anim.f >= anim.n) {
    vec = blochFromAmps();
    if (anim.kind === "rot") updateReadout(`applied <b>${anim.label}</b>`);
    else updateReadout(`measured → <b>|${anim.out}⟩</b> (p = ${(anim.p * 100).toFixed(1)}%)`);
    anim = null;
  }
}

function fmtC(c) {
  const r = Math.abs(c[0]) < 5e-4 ? 0 : c[0], i = Math.abs(c[1]) < 5e-4 ? 0 : c[1];
  const f = x => (+x.toFixed(3)).toString();
  if (!r && !i) return "0";
  if (!i) return f(r);
  if (!r) return f(i) + "i";
  return f(r) + (i < 0 ? " − " : " + ") + f(Math.abs(i)) + "i";
}
function updateReadout(msg) {
  document.getElementById("alpha").textContent = fmtC(A);
  document.getElementById("beta").textContent = fmtC(B);
  const p = abs2(A) * 100;
  document.getElementById("p0").textContent = p.toFixed(1) + "%";
  document.getElementById("pbar").style.width = p + "%";
  if (msg) document.getElementById("log").innerHTML = msg;
}

// --- projection ---
function proj(p) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x1 = p[0] * cy - p[1] * sy, y1 = p[0] * sy + p[1] * cy;
  const y2 = y1 * cp - p[2] * sp, z2 = y1 * sp + p[2] * cp;
  const R = Math.min(W, H) * 0.36;
  return { x: W / 2 + R * x1, y: H / 2 - R * z2, back: y2 > 0.001 };
}

function curve(fn, color, width) {
  const N = 96;
  let prev = proj(fn(0));
  for (let i = 1; i <= N; i++) {
    const cur = proj(fn((i / N) * Math.PI * 2));
    ctx.beginPath();
    ctx.setLineDash(cur.back ? [3, 4] : []);
    ctx.globalAlpha = cur.back ? 0.45 : 1;
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.moveTo(prev.x, prev.y); ctx.lineTo(cur.x, cur.y); ctx.stroke();
    prev = cur;
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}

function label(p, txt, color) {
  const q = proj(p);
  ctx.fillStyle = color; ctx.globalAlpha = q.back ? 0.5 : 1;
  ctx.fillText(txt, q.x, q.y); ctx.globalAlpha = 1;
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  const R = Math.min(W, H) * 0.36;

  // sphere silhouette
  ctx.beginPath(); ctx.arc(W / 2, H / 2, R, 0, Math.PI * 2);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke();

  // great circles
  curve(t => [Math.cos(t), Math.sin(t), 0], C.ink, 1.2);           // equator
  curve(t => [Math.cos(t), 0, Math.sin(t)], C.ink2, 0.8);          // x-z meridian
  curve(t => [0, Math.cos(t), Math.sin(t)], C.ink2, 0.8);          // y-z meridian

  // axes
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(a => {
    const p = proj(a.map(x => x * 1.12)), m = proj(a.map(x => -x * 1.12));
    ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = C.ink2; ctx.lineWidth = 0.7; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);
  });

  ctx.font = "500 13px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  label([0, 0, 1.27], "|0⟩", C.ink);
  label([0, 0, -1.27], "|1⟩", C.ink);
  label([1.3, 0, 0], "|+⟩", C.ink2);
  label([-1.3, 0, 0], "|−⟩", C.ink2);
  label([0, 1.3, 0], "|+i⟩", C.ink2);
  label([0, -1.3, 0], "|−i⟩", C.ink2);

  // trail
  for (let i = 1; i < trail.length; i++) {
    const a = proj(trail[i - 1]), b = proj(trail[i]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = C.sig; ctx.globalAlpha = (i / trail.length) * 0.55; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // projection of state onto equator
  const o = proj([0, 0, 0]), tip = proj(vec), foot = proj([vec[0], vec[1], 0]);
  ctx.setLineDash([4, 4]); ctx.strokeStyle = C.blue; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(foot.x, foot.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
  ctx.setLineDash([]);

  // state vector
  ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(tip.x, tip.y);
  ctx.strokeStyle = C.sig; ctx.lineWidth = 3; ctx.stroke();
  ctx.beginPath(); ctx.arc(tip.x, tip.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = C.sig; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = C.paper; ctx.stroke();
  ctx.beginPath(); ctx.arc(o.x, o.y, 3, 0, Math.PI * 2); ctx.fillStyle = C.ink; ctx.fill();
}

function loop() {
  step();
  if (!dragging && !reduceMotion && ++idle > 60) yaw += 0.0022;
  draw();
  requestAnimationFrame(loop);
}

cv.addEventListener("pointerdown", e => { dragging = true; lastX = e.clientX; lastY = e.clientY; cv.setPointerCapture(e.pointerId); });
cv.addEventListener("pointermove", e => {
  if (!dragging) return;
  yaw += (e.clientX - lastX) * 0.01;
  pitch = Math.max(-1.3, Math.min(1.3, pitch + (e.clientY - lastY) * 0.01));
  lastX = e.clientX; lastY = e.clientY; idle = 0;
});
["pointerup", "pointercancel"].forEach(ev => cv.addEventListener(ev, () => { dragging = false; idle = 0; }));

document.querySelectorAll("[data-g]").forEach(b => b.addEventListener("click", () => applyGate(b.dataset.g)));
document.getElementById("measure").addEventListener("click", measure);
document.getElementById("reset").addEventListener("click", reset);
updateReadout();
loop();

/* =========================================================
   3. BB84 quantum key distribution demo
   ========================================================= */
const N = 24;
const rb = () => (Math.random() < 0.5 ? 0 : 1);
const BASIS = ["+", "×"];
const POL = [["↔", "↕"], ["⤢", "⤡"]];   // [basis][bit]

function runBB84() {
  const eve = document.getElementById("eve").checked;
  const rows = [];
  for (let i = 0; i < N; i++) {
    const aBit = rb(), aBase = rb();
    let phBit = aBit, phBase = aBase, eBase = null;
    if (eve) {                                   // intercept-resend attack
      eBase = rb();
      phBit = eBase === phBase ? phBit : rb();
      phBase = eBase;
    }
    const bBase = rb();
    const bBit = bBase === phBase ? phBit : rb();
    const keep = aBase === bBase;
    rows.push({ aBit, aBase, eBase, bBase, bBit, keep, err: keep && aBit !== bBit });
  }

  const cell = (i, txt, cls = "") => `<td class="${cls}" style="--d:${i * 35}ms">${txt}</td>`;
  const line = (name, fn) => `<tr><th>${name}</th>${rows.map((r, i) => fn(r, i)).join("")}</tr>`;
  let html = "";
  html += line("Alice bit", (r, i) => cell(i, r.aBit, r.keep ? "keep" : ""));
  html += line("Alice basis", (r, i) => cell(i, BASIS[r.aBase], (r.aBase ? "b1 " : "") + (r.keep ? "keep" : "")));
  html += line("Photon sent", (r, i) => cell(i, POL[r.aBase][r.aBit], "ph " + (r.keep ? "keep" : "")));
  if (eve) html += line("Eve basis", (r, i) => cell(i, BASIS[r.eBase], (r.eBase ? "b1 " : "") + (r.keep ? "keep" : "")));
  html += line("Bob basis", (r, i) => cell(i, BASIS[r.bBase], (r.bBase ? "b1 " : "") + (r.keep ? "keep" : "")));
  html += line("Bob bit", (r, i) => cell(i, r.bBit, r.err ? "err" : r.keep ? "keep" : "dim"));
  html += line("Sifted", (r, i) => cell(i, r.keep ? "✓" : "·", r.err ? "err" : r.keep ? "keep" : "dim"));
  document.getElementById("bbTable").innerHTML = html;

  const sifted = rows.filter(r => r.keep);
  const errs = sifted.filter(r => r.err).length;
  const qber = sifted.length ? errs / sifted.length : 0;
  const key = sifted.map(r => r.aBit).join("");
  const res = document.getElementById("bbResult");
  const head = `sifted ${sifted.length}/${N} bits · errors ${errs} · QBER ${(qber * 100).toFixed(1)}% → `;
  res.innerHTML = qber > 0.11
    ? head + `<span class="bad">eavesdropper detected, key discarded</span>`
    : head + `<span class="ok">secure key established</span> <code>${key}</code>` +
      (eve ? ` <span style="color:var(--ink-2)">(Eve got lucky this time; run again)</span>` : "");
}
document.getElementById("bbRun").addEventListener("click", runBB84);
document.getElementById("eve").addEventListener("change", runBB84);
document.getElementById("bbTable").innerHTML = '<tr><td class="bb-empty" style="opacity:1;animation:none;text-align:left">// waiting for photons…</td></tr>';

/* =========================================================
   4. Misc
   ========================================================= */
document.getElementById("year").textContent = new Date().getFullYear();
const io = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
}), { threshold: 0.12 });
document.querySelectorAll(".reveal").forEach(el => io.observe(el));

// size the CNOT control line so it reaches the target gate on q2
function sizeCnot() {
  const c = document.querySelector(".g.ctrl"), t = document.querySelectorAll(".qrow .g")[2];
  if (!c || !t) return;
  const d = (t.getBoundingClientRect().top + t.offsetHeight / 2) - (c.getBoundingClientRect().top + c.offsetHeight / 2);
  c.style.setProperty("--cnot", d + "px");
}
addEventListener("resize", sizeCnot);
addEventListener("load", sizeCnot);
document.querySelectorAll(".qrow").forEach(r => r.addEventListener("transitionend", sizeCnot));

// BibTeX: show the entry and copy it to the clipboard
document.querySelectorAll(".bibbtn").forEach(btn => btn.addEventListener("click", () => {
  const pre = btn.closest(".paper").querySelector("pre.bib");
  pre.hidden = !pre.hidden;
  if (!pre.hidden && navigator.clipboard) {
    navigator.clipboard.writeText(pre.textContent).then(() => {
      btn.textContent = "copied ✓";
      setTimeout(() => (btn.textContent = "bibtex"), 1600);
    }).catch(() => {});
  }
}));
