/* Background field: rings of light around the lamp, like the dotted mandala on its face,
   and motes drifting in its glow. The pointer brightens the rings it passes over and
   parts the motes; a click or tap sends out a ripple, and the lamp itself sends a slow
   one now and then.
   Everything is drawn on the GPU in one call: each dot is a point whose position, glow and
   size are worked out in the vertex shader, so the main thread does almost nothing per frame.
   Exposes window.Field = { level (0..1, how visible the field is), burst(strong) }. */
(function () {
  "use strict";

  const canvas = document.getElementById("field");
  const gl = canvas && (canvas.getContext("webgl", { alpha: true, antialias: false, depth: false, premultipliedAlpha: true }) ||
                        canvas.getContext("experimental-webgl"));
  if (!gl) {
    if (canvas) canvas.style.display = "none";
    window.Field = { level: 0, burst() {} };
    return;
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const Perf = window.Perf || { level: 0, onChange() {} };
  const TAU = Math.PI * 2;
  const RIPPLE_SPEED = 560, RIPPLE_LIFE = 1.7, MAX_RIPPLES = 6, FRONT_DOTS = 120;

  /* ---------- Shaders ---------- */
  // a: kind-specific data; b: more of it. kind 0 = ring dot, 1 = mote, 2 = ripple-front dot
  // highp: screen positions and the clock need it (vertex shaders always support it)
  const VS = `
    precision highp float;
    attribute vec4 a;
    attribute vec4 b;
    uniform vec2 res;
    uniform float dpr, time, shown, minDim;
    uniform vec2 centre;
    uniform vec3 pointer;
    uniform vec4 rip[${MAX_RIPPLES}];
    varying float vAlpha;
    varying float vSize;
    varying vec3 vColor;

    float rippleGlow(vec2 p) {
      float g = 0.0;
      for (int k = 0; k < ${MAX_RIPPLES}; k++) {
        float off = distance(p, rip[k].xy) - rip[k].z;
        g += exp(-(off * off) / 900.0) * rip[k].w;
      }
      return g;
    }

    void main() {
      float kind = b.w;
      vec2 p;
      float size;
      float alpha;
      if (kind < 0.5) {
        // ring dot: a = (angle, radius, size, spin speed)
        float ang = a.x + time * a.w;
        p = centre + vec2(cos(ang), sin(ang)) * a.y;
        vec2 d = p - pointer.xy;
        float glow = pointer.z * exp(-dot(d, d) / 16000.0) + rippleGlow(p);
        glow = min(glow, 1.0);
        size = a.z + glow * 1.4;
        alpha = 0.085 + 0.75 * glow;
        vColor = vec3(1.0, 0.835, 0.604);
      } else if (kind < 1.5) {
        // mote: a = (x 0..1, y phase 0..1, size, rise px/s), b = (sway phase, twinkle phase, -, kind)
        float h = res.y + 20.0;
        p = vec2(a.x * res.x + sin(time * 0.6 + b.x) * 6.0, mod(a.y * h - time * a.w, h) - 10.0);
        // pushed aside by the pointer and by passing ripples
        vec2 d = p - pointer.xy;
        float d2 = dot(d, d);
        if (pointer.z > 0.5 && d2 < 22000.0 && d2 > 1.0) p += normalize(d) * (1.0 - d2 / 22000.0) * 46.0;
        for (int k = 0; k < ${MAX_RIPPLES}; k++) {
          vec2 r = p - rip[k].xy;
          float len = max(length(r), 1.0);
          float off = len - rip[k].z;
          p += (r / len) * exp(-(off * off) / 1600.0) * rip[k].w * 34.0;
        }
        vec2 c = p - centre;
        float near = exp(-dot(c, c) / (minDim * minDim * 0.18));
        float twinkle = 0.55 + 0.45 * sin(time * 1.3 + b.y);
        size = a.z;
        alpha = (0.12 + 0.5 * near) * twinkle;
        vColor = vec3(1.0, 0.812, 0.541);
      } else {
        // ripple front: a = (angle, ripple index, -, -)
        vec4 r = rip[int(a.y)];
        p = r.xy + vec2(cos(a.x), sin(a.x)) * r.z;
        size = 1.0;
        alpha = 0.3 * r.w;
        vColor = vec3(1.0, 0.749, 0.451);
      }
      vAlpha = alpha * shown;
      vSize = size * 2.0 * dpr + 1.0;
      gl_PointSize = vSize;
      gl_Position = vec4(p.x / res.x * 2.0 - 1.0, 1.0 - p.y / res.y * 2.0, 0.0, 1.0);
      if (vAlpha < 0.004) gl_Position = vec4(2.0, 2.0, 0.0, 1.0); // skip invisible dots entirely
    }`;
  const FS = `
    precision mediump float;
    varying float vAlpha;
    varying float vSize;
    varying vec3 vColor;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      float a = vAlpha * (1.0 - smoothstep(1.0 - 2.0 / vSize, 1.0, d));
      gl_FragColor = vec4(vColor * a, a);
    }`;
  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    canvas.style.display = "none";
    window.Field = { level: 0, burst() {} };
    return;
  }
  gl.useProgram(prog);
  const U = {};
  ["res", "dpr", "time", "shown", "minDim", "centre", "pointer", "rip"].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
  const locA = gl.getAttribLocation(prog, "a"), locB = gl.getAttribLocation(prog, "b");
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(locA);
  gl.enableVertexAttribArray(locB);
  gl.vertexAttribPointer(locA, 4, gl.FLOAT, false, 32, 0);
  gl.vertexAttribPointer(locB, 4, gl.FLOAT, false, 32, 16);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  /* ---------- State ---------- */
  let looping = false, prev = 0, shown = 0, lastPulse = 0;
  const ripples = [];
  const ripData = new Float32Array(MAX_RIPPLES * 4);
  const centre = { x: 0, y: 0, ready: false };
  const pointer = { x: -9999, y: -9999, on: false };
  function addRipple(x, y, strong) {
    if (reduceMotion) return;
    ripples.push({ x, y, t: 0, strong });
    if (ripples.length > MAX_RIPPLES) ripples.shift();
    start();
  }
  const api = {
    level: 0,
    burst(strong = 1) { addRipple(centre.x, centre.y, strong); }
  };
  window.Field = api;

  /* ---------- Points: built once per size and quality level ---------- */
  let W = 0, H = 0, DPR = 1, count = 0;
  function build() {
    const level = Perf.level;
    DPR = Math.min(window.devicePixelRatio || 1, level ? 1 : 1.5);
    W = window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    gl.viewport(0, 0, canvas.width, canvas.height);

    const data = [];
    const push = (a0, a1, a2, a3, b0, b1, b2, kind) => data.push(a0, a1, a2, a3, b0, b1, b2, kind);
    const base = Math.min(W, H) * 0.24;
    const spacing = [1, 1.3, 1.6][level] || 1.6;
    [1, 1.42, 1.9, 2.45, 3.05, 3.7].forEach((m, i) => {
      const r = base * m;
      const n = Math.max(24, Math.round((TAU * r) / ((i % 2 ? 22 : 15) * spacing)));
      const speed = reduceMotion ? 0 : (0.012 + i * 0.004) * (i % 2 ? -1 : 1);
      for (let j = 0; j < n; j++) push((j / n) * TAU, r, i % 2 ? 1.6 : 1.2, speed, 0, 0, 0, 0);
    });
    const motes = Math.round((W < 768 ? 30 : 64) / ([1, 1.3, 1.8][level] || 1.8));
    for (let i = 0; i < motes; i++) {
      push(Math.random(), Math.random(), 0.7 + Math.random() * 1.7, reduceMotion ? 0 : 6 + Math.random() * 12,
        Math.random() * TAU, Math.random() * TAU, 0, 1);
    }
    for (let k = 0; k < MAX_RIPPLES; k++) {
      for (let j = 0; j < FRONT_DOTS; j++) push((j / FRONT_DOTS) * TAU, k, 0, 0, 0, 0, 0, 2);
    }
    count = data.length / 8;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.uniform2f(U.res, W, H);
    gl.uniform1f(U.dpr, DPR);
    gl.uniform1f(U.minDim, Math.min(W, H));
    start();
  }
  build();
  // the canvas is 100lvh, so the mobile URL bar showing or hiding doesn't rebuild it
  window.addEventListener("resize", () => {
    if (window.innerWidth !== W || (canvas.clientHeight || window.innerHeight) !== H) build();
  });
  Perf.onChange(build);

  window.addEventListener("pointermove", (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.on = e.pointerType === "mouse";
  }, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => { pointer.on = false; });
  window.addEventListener("pointerdown", (e) => {
    if (e.target.closest && e.target.closest("a, button, summary, input, label")) return;
    if (api.level < 0.2) return;
    addRipple(e.clientX, e.clientY, 1);
  }, { passive: true });

  /* ---------- Frame ---------- */
  function start() {
    if (looping || document.hidden) return;
    looping = true;
    prev = 0;
    requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange", start);
  function frame(now) {
    if (document.hidden) { looping = false; return; }
    requestAnimationFrame(frame);
    const dt = prev ? Math.max(0, Math.min((now - prev) / 1000, 0.05)) : 0;
    prev = now;
    const t = now / 1000;

    shown += (api.level - shown) * (1 - Math.exp(-dt * 3));

    // the rings follow whichever lamp is on screen, eased so they trail it softly
    const p = window.Lamps && window.Lamps.focusPoint();
    if (p) {
      if (!centre.ready) { centre.x = p[0]; centre.y = p[1]; centre.ready = true; }
      const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 2.2);
      centre.x += (p[0] - centre.x) * k;
      centre.y += (p[1] - centre.y) * k;
    }

    // the lamp's own slow pulse
    if (!reduceMotion && t - lastPulse > 6.5) {
      lastPulse = t;
      ripples.push({ x: centre.x, y: centre.y, t: 0, strong: 0.55 });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
    }
    ripData.fill(0);
    for (let i = ripples.length - 1; i >= 0; i--) {
      if ((ripples[i].t += dt) > RIPPLE_LIFE) ripples.splice(i, 1);
    }
    for (let i = 0; i < ripples.length; i++) {
      const rp = ripples[i];
      ripData[i * 4] = rp.x;
      ripData[i * 4 + 1] = rp.y;
      ripData[i * 4 + 2] = rp.t * RIPPLE_SPEED;
      ripData[i * 4 + 3] = (1 - rp.t / RIPPLE_LIFE) * rp.strong;
    }

    gl.clear(gl.COLOR_BUFFER_BIT);
    if (shown < 0.01) return;
    gl.uniform1f(U.time, reduceMotion ? 0 : t % 3600);
    gl.uniform1f(U.shown, shown);
    gl.uniform2f(U.centre, centre.x, centre.y);
    gl.uniform3f(U.pointer, pointer.x, pointer.y, pointer.on ? 1 : 0);
    gl.uniform4fv(U.rip, ripData);
    gl.drawArrays(gl.POINTS, 0, count);
  }
  start();
})();
