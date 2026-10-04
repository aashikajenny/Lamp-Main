/* 3D OM night lamp (Three.js r128).
   Exposes window.Lamp:
     Lamp.target  - pose the scene eases toward {x, y, z, s, rx, ry, glow, room, wall, dx, dy, ds}
                    x/y are fractions of the viewport (-0.5..0.5), s is relative size,
                    z is the distance out from the wall socket in lamp units (0 = plugged in),
                    room is the studio light (0..1), wall is the room wall's opacity (0..1)
                    dx/dy/ds place the wall socket; the lamp plugs in when x/y/s match them
     Lamp.power   - 0..1 multiplier on the glow (the mains switch)
     Lamp.rocker  - 0..1 position of the wall switch rocker
     Lamp.kick()  - a small jolt, for the moment the plug seats
     Lamp.ready (Promise) / Lamp.screenPoint() */
(function () {
  "use strict";

  const canvas = document.getElementById("stage");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    canvas.style.display = "none";
    window.Lamp = { target: {}, power: 1, rocker: 0, kick() {}, screenPoint: () => [window.innerWidth / 2, window.innerHeight / 2], ready: Promise.resolve(), failed: true };
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const FOV = 30;
  const DIST = 12;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, DIST);

  /* ---------- Environment: a soft warm studio so plastic and metal read properly ---------- */
  const pmrem = new THREE.PMREMGenerator(renderer);
  (function buildEnv() {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#5a4a3c");
    grad.addColorStop(0.45, "#2a2230");
    grad.addColorStop(1, "#0b0a10");
    g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
    // two soft "softboxes" for highlights
    [[140, 70, 70, "rgba(255,226,180,0.95)"], [390, 90, 50, "rgba(255,170,90,0.7)"]].forEach(([x, y, r, col]) => {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col); rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg; g.fillRect(0, 0, 512, 256);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;
    scene.environment = pmrem.fromEquirectangular(tex).texture;
    tex.dispose();
  })();

  const hemi = new THREE.HemisphereLight(0xfff1dc, 0x1a1530, 0.35);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe6c4, 1.1);
  key.position.set(4, 5, 7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff9a3c, 1.3);
  rim.position.set(-6, 2, -5);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x9c8cff, 0.25);
  fill.position.set(-5, -3, 5);
  scene.add(fill);

  /* ---------- Geometry helpers ---------- */
  function roundedRectShape(w, h, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  // Rounded slab centred on the origin; total thickness = depth + 2 * bevel
  function roundedSlab(w, h, r, depth, bevel) {
    const geo = new THREE.ExtrudeGeometry(
      roundedRectShape(w - 2 * bevel, h - 2 * bevel, Math.max(r - bevel, 0.02)),
      { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 8, curveSegments: 28 }
    );
    geo.center();
    geo.computeVertexNormals();
    return geo;
  }
  function roundedPlane(w, h, r) {
    const geo = new THREE.ShapeGeometry(roundedRectShape(w, h, r), 28);
    // map UVs to 0..1 across the plane
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    return geo;
  }

  /* ---------- Materials ---------- */
  const plastic = new THREE.MeshPhysicalMaterial({
    color: 0xf1ece3, roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.35,
    emissive: new THREE.Color(0xffa94d), emissiveIntensity: 0
  });
  const plasticBack = new THREE.MeshPhysicalMaterial({ color: 0xebe6dc, roughness: 0.5, clearcoat: 0.2 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xe6e1d8, metalness: 1, roughness: 0.22, envMapIntensity: 1.4 });
  const hole = new THREE.MeshBasicMaterial({ color: 0x2a2622 });

  const artMat = new THREE.MeshStandardMaterial({
    roughness: 0.32, metalness: 0, transparent: true,
    emissive: new THREE.Color(0xffffff), emissiveIntensity: 0
  });
  // thin glossy cover over the print
  const coverMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.08, clearcoat: 1, depthWrite: false
  });

  /* ---------- Build the lamp ---------- */
  const W = 2.4, H = 2.9;
  const BODY_D = 0.42, BODY_B = 0.1;
  const FRONT_Z = BODY_D / 2 + BODY_B;

  const root = new THREE.Group();   // position + scale
  const spin = new THREE.Group();   // rotation
  root.add(spin);
  scene.add(root);

  const body = new THREE.Mesh(roundedSlab(W, H, 0.3, BODY_D, BODY_B), plastic);
  spin.add(body);

  const ART_W = 1.98, ART_H = 2.48;
  const art = new THREE.Mesh(roundedPlane(ART_W, ART_H, 0.14), artMat);
  art.position.z = FRONT_Z + 0.002;
  spin.add(art);
  const cover = new THREE.Mesh(roundedPlane(ART_W, ART_H, 0.14), coverMat);
  cover.position.z = FRONT_Z + 0.006;
  spin.add(cover);

  // stepped back plate + plug module
  const plate = new THREE.Mesh(roundedSlab(2.15, 2.6, 0.24, 0.08, 0.03), plasticBack);
  plate.position.z = -FRONT_Z - 0.07;
  spin.add(plate);

  const MOD = 1.7, MOD_D = 0.42, MOD_B = 0.08;
  const modZ = -FRONT_Z - 0.14 - (MOD_D / 2 + MOD_B);
  const module = new THREE.Mesh(roundedSlab(MOD, MOD, 0.2, MOD_D, MOD_B), plasticBack);
  module.position.set(0, -0.12, modZ);
  spin.add(module);
  const backZ = modZ - (MOD_D / 2 + MOD_B);

  // two-pin plug
  const PIN_L = 0.78;
  const pinGeo = new THREE.CylinderGeometry(0.075, 0.075, PIN_L, 32);
  pinGeo.rotateX(Math.PI / 2);
  const tipGeo = new THREE.SphereGeometry(0.075, 24, 16);
  const collarGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.06, 32);
  collarGeo.rotateX(Math.PI / 2);
  [-0.36, 0.36].forEach((x) => {
    const pin = new THREE.Mesh(pinGeo, metal);
    pin.position.set(x, -0.12, backZ - PIN_L / 2 + 0.02);
    const tip = new THREE.Mesh(tipGeo, metal);
    tip.position.set(x, -0.12, backZ - PIN_L + 0.02);
    const collar = new THREE.Mesh(collarGeo, plasticBack);
    collar.position.set(x, -0.12, backZ - 0.02);
    spin.add(pin, tip, collar);
  });
  // screw holes on the module, as on the real product
  const holeGeo = new THREE.CircleGeometry(0.07, 24);
  [0.42, -0.66].forEach((y) => {
    const h = new THREE.Mesh(holeGeo, hole);
    h.position.set(0, y, backZ - 0.002);
    h.rotation.y = Math.PI;
    spin.add(h);
  });

  // centre the model's depth so it rotates around its middle
  spin.children.forEach((m) => { m.position.z += 0.45; });

  /* ---------- Glow halo (not rotated, always faces camera) ---------- */
  function haloTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    rg.addColorStop(0, "rgba(255,214,150,0.9)");
    rg.addColorStop(0.25, "rgba(255,170,80,0.45)");
    rg.addColorStop(0.6, "rgba(242,120,40,0.12)");
    rg.addColorStop(1, "rgba(242,120,40,0)");
    g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0
  }));
  halo.scale.set(9, 9, 1);
  halo.position.z = -1.2;
  root.add(halo);

  // the lamp's light falling on the wall around it (only while the room wall is in view)
  const spill = new THREE.PointLight(0xffa24a, 0, 9, 1.6);
  spill.position.set(0, 0.1, FRONT_Z + 0.45 + 0.9);
  root.add(spill);

  /* ---------- The room: a painted wall and an Indian modular switchboard ----------
     Built in the lamp's own units, so when the lamp's pose matches the dock its pins
     sit exactly in the socket's two lower holes. */
  const PLUG_FACE = backZ + 0.45;        // the lamp's back face, in lamp-local z
  const dock = new THREE.Group();
  scene.add(dock);

  function plasterTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const img = g.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 214 + Math.random() * 26;
      img.data[i] = v; img.data[i + 1] = v * 0.93; img.data[i + 2] = v * 0.84; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(14, 10);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xa69a8e, map: plasterTexture(), roughness: 0.95, metalness: 0, transparent: true });
  const boardMat = new THREE.MeshPhysicalMaterial({ color: 0xf6f2ea, roughness: 0.34, clearcoat: 0.4, clearcoatRoughness: 0.3, transparent: true });
  const recessMat = new THREE.MeshStandardMaterial({ color: 0xe4ddd1, roughness: 0.5, transparent: true });
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x15110f, transparent: true });
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x5a1a10, emissive: new THREE.Color(0xff3a1a), emissiveIntensity: 0, transparent: true });
  const roomMats = [wallMat, boardMat, recessMat, holeMat, ledMat];

  const wall = new THREE.Mesh(new THREE.PlaneGeometry(80, 50), wallMat);
  wall.position.z = PLUG_FACE - 0.27;
  dock.add(wall);

  const BOARD_X = 1.25, SW_X = 2.78, MOD_Y = 0.16;
  const board = new THREE.Mesh(roundedSlab(5.7, 3.5, 0.26, 0.16, 0.05), boardMat);
  board.position.set(BOARD_X, -0.1, PLUG_FACE - 0.13);
  dock.add(board);

  // socket module: a shallow square recess, two pin holes and the larger earth hole above
  const socketFace = new THREE.Mesh(roundedPlane(1.78, 1.86, 0.16), recessMat);
  socketFace.position.set(0, MOD_Y, PLUG_FACE + 0.002);
  dock.add(socketFace);
  [[-0.36, -0.12, 0.085], [0.36, -0.12, 0.085], [0, 0.56, 0.13]].forEach(([x, y, r]) => {
    const h = new THREE.Mesh(new THREE.CircleGeometry(r, 28), holeMat);
    h.position.set(x, y, PLUG_FACE + 0.004);
    dock.add(h);
  });

  // switch module with a rocker that tips when switched on, and its red indicator
  const switchFace = new THREE.Mesh(roundedPlane(1.5, 1.86, 0.16), recessMat);
  switchFace.position.set(SW_X, MOD_Y, PLUG_FACE + 0.002);
  dock.add(switchFace);
  const rockerPivot = new THREE.Group();
  rockerPivot.position.set(SW_X, MOD_Y - 0.08, PLUG_FACE + 0.1);
  dock.add(rockerPivot);
  const rocker = new THREE.Mesh(roundedSlab(0.62, 1.08, 0.09, 0.1, 0.04), boardMat);
  rockerPivot.add(rocker);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 12), ledMat);
  led.position.set(SW_X, MOD_Y + 0.68, PLUG_FACE + 0.03);
  dock.add(led);

  // a dim cool night light, so the room reads before the lamp is on
  const moon = new THREE.HemisphereLight(0x8a9cd8, 0x120e16, 0);
  scene.add(moon);

  /* ---------- Artwork textures ---------- */
  const TEX_W = 800, TEX_H = 1000;
  function clipRounded(g, r) {
    g.beginPath();
    g.moveTo(r, 0); g.arcTo(TEX_W, 0, TEX_W, TEX_H, r); g.arcTo(TEX_W, TEX_H, 0, TEX_H, r);
    g.arcTo(0, TEX_H, 0, 0, r); g.arcTo(0, 0, TEX_W, 0, r); g.closePath();
    g.clip();
  }

  function drawOM() {
    const c = document.createElement("canvas");
    c.width = TEX_W; c.height = TEX_H;
    const g = c.getContext("2d");
    clipRounded(g, 56);
    const cx = TEX_W / 2, cy = 450;

    const bg = g.createRadialGradient(cx, cy, 10, cx, cy, 640);
    bg.addColorStop(0, "#fff6d8");
    bg.addColorStop(0.16, "#ffd977");
    bg.addColorStop(0.42, "#f59a2e");
    bg.addColorStop(0.72, "#b53f1d");
    bg.addColorStop(1, "#4a1424");
    g.fillStyle = bg; g.fillRect(0, 0, TEX_W, TEX_H);

    // sun rays
    g.save(); g.translate(cx, cy);
    for (let i = 0; i < 64; i++) {
      g.rotate((Math.PI * 2) / 64);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(-9, -720); g.lineTo(9, -720); g.closePath();
      g.fillStyle = i % 2 ? "rgba(255,248,220,0.10)" : "rgba(255,230,170,0.05)";
      g.fill();
    }
    g.restore();

    // lotus petals and dotted mandala rings
    g.save(); g.translate(cx, cy);
    g.strokeStyle = "rgba(255,244,215,0.55)"; g.lineWidth = 3;
    for (let i = 0; i < 16; i++) {
      g.rotate((Math.PI * 2) / 16);
      g.beginPath(); g.ellipse(0, -255, 34, 78, 0, 0, Math.PI * 2); g.stroke();
    }
    [[318, 48, 5], [348, 72, 3.2], [212, 36, 3]].forEach(([r, n, d]) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, d, 0, Math.PI * 2);
        g.fillStyle = "rgba(255,246,222,0.75)"; g.fill();
      }
    });
    g.beginPath(); g.arc(0, 0, 196, 0, Math.PI * 2);
    g.strokeStyle = "rgba(255,246,222,0.6)"; g.lineWidth = 2; g.stroke();
    g.restore();

    // the OM
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = '400 400px "Tiro Devanagari Sanskrit", "Noto Sans Devanagari", serif';
    g.shadowColor = "rgba(255,236,190,0.95)"; g.shadowBlur = 50;
    const og = g.createLinearGradient(0, cy - 200, 0, cy + 200);
    og.addColorStop(0, "#8a2414"); og.addColorStop(1, "#4a0d12");
    g.fillStyle = og;
    g.fillText("ॐ", cx, cy + 30);
    g.shadowBlur = 0;
    g.lineWidth = 4; g.strokeStyle = "rgba(255,214,140,0.9)";
    g.strokeText("ॐ", cx, cy + 30);

    // lotus base + shanti
    g.save(); g.translate(cx, 880);
    g.fillStyle = "rgba(255,226,170,0.85)";
    for (let i = -3; i <= 3; i++) {
      g.save(); g.rotate(i * 0.32);
      g.beginPath(); g.ellipse(0, -46, 20, 52, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    g.restore();
    g.font = '400 54px "Tiro Devanagari Sanskrit", serif';
    g.fillStyle = "#fff3d8";
    g.fillText("शान्ति", cx, 940);

    // inner border
    g.lineWidth = 6; g.strokeStyle = "rgba(255,228,170,0.7)";
    g.beginPath();
    if (g.roundRect) g.roundRect(22, 22, TEX_W - 44, TEX_H - 44, 40); else g.rect(22, 22, TEX_W - 44, TEX_H - 44);
    g.stroke();
    return c;
  }

  function toTexture(c) {
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  const textures = {};
  function applyArt(name) {
    const tex = textures[name];
    if (!tex) return;
    artMat.map = tex;
    artMat.emissiveMap = tex;
    artMat.needsUpdate = true;
  }

  const fontReady = (document.fonts && document.fonts.load)
    ? document.fonts.load('400 100px "Tiro Devanagari Sanskrit"', "ॐ").catch(() => {})
    : Promise.resolve();
  const ready = fontReady.then(() => {
    textures.om = toTexture(drawOM());
    applyArt("om");
  });

  /* ---------- Pose state ---------- */
  const target = { x: 0, y: 0, z: 0, s: 1, rx: 0, ry: 0, glow: 0, room: 0, wall: 1, dx: 0, dy: 0, ds: 1 };
  const cur = Object.assign({}, target);
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  let shake = 0;
  const api = {
    target, power: 0, rocker: 0,
    ready,
    snap() { Object.assign(cur, target); },
    kick() { if (!reduceMotion) shake = 1; },
    screenPoint() {
      camera.updateMatrixWorld();
      const v = root.position.clone().project(camera);
      return [(v.x + 1) / 2 * window.innerWidth, (1 - v.y) / 2 * (canvas.clientHeight || window.innerHeight)];
    }
  };
  window.Lamp = api;

  window.addEventListener("pointermove", (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  /* ---------- Resize ---------- */
  let visH = 1, visW = 1;
  function resize() {
    const w = window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    visH = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * DIST;
    visW = visH * camera.aspect;
  }
  window.addEventListener("resize", resize);
  resize();

  /* ---------- Render loop ---------- */
  const clock = new THREE.Clock();
  let running = true;
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) { clock.getDelta(); requestAnimationFrame(tick); }
  });

  function tick() {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 5);
    for (const p in target) cur[p] += (target[p] - cur[p]) * k;
    pointer.sx += (pointer.x - pointer.sx) * (1 - Math.exp(-dt * 3));
    pointer.sy += (pointer.y - pointer.sy) * (1 - Math.exp(-dt * 3));

    // a lamp seated in the socket stays still; free in the air it floats and follows the pointer
    const wallA = Math.max(0, Math.min(1, cur.wall));
    const free = reduceMotion ? 0 : Math.min(1, Math.max(0, cur.z / 1.2) + (1 - wallA));
    const float = Math.sin(t * 1.1) * 0.012 * free;
    const unit = (visH * 0.42) / H;
    const scale = cur.s * unit;
    root.position.set(cur.x * visW, (cur.y + float) * visH, Math.max(0, cur.z) * scale);
    root.scale.setScalar(scale);
    spin.rotation.set(
      cur.rx + pointer.sy * 0.12 * free,
      cur.ry + (pointer.sx * 0.22 + Math.sin(t * 0.6) * 0.04) * free,
      0
    );

    // the room wall and switchboard
    dock.visible = wallA > 0.004;
    if (dock.visible) {
      dock.position.set(cur.dx * visW, cur.dy * visH, 0);
      dock.scale.setScalar(cur.ds * unit);
      for (let i = 0; i < roomMats.length; i++) roomMats[i].opacity = wallA;
      wallMat.depthWrite = boardMat.depthWrite = wallA > 0.98;
      rockerPivot.rotation.x = -0.2 + 0.4 * api.rocker;
      ledMat.emissiveIntensity = 2.2 * api.rocker;
    }

    // the plug seating: a brief jolt of the camera
    if (shake > 0.001) {
      shake *= Math.exp(-dt * 9);
      camera.position.set(Math.sin(t * 71) * 0.03 * shake, Math.cos(t * 57) * 0.03 * shake, DIST);
    } else if (shake) { shake = 0; camera.position.set(0, 0, DIST); }

    // studio light for the product; a dim cool night light while the room is in view
    const room = Math.max(0.04, Math.min(1, cur.room));
    hemi.intensity = 0.35 * room; key.intensity = 1.1 * room;
    rim.intensity = 1.3 * (0.25 + 0.75 * room); fill.intensity = 0.25 * room;
    plastic.envMapIntensity = plasticBack.envMapIntensity = artMat.envMapIntensity = room;
    metal.envMapIntensity = 1.4 * room;
    moon.intensity = 0.2 * wallA * (1 - room);

    const g = Math.max(0, cur.glow) * api.power;
    const flicker = reduceMotion ? 1 : 1 + Math.sin(t * 2.3) * 0.015 + Math.sin(t * 5.1) * 0.01;
    artMat.emissiveIntensity = g * 0.95 * flicker;
    plastic.emissiveIntensity = g * 0.16;
    halo.material.opacity = Math.min(1, g * 0.95) * flicker;
    // the halo fades when the lamp turns away
    const facing = Math.max(0, Math.cos(spin.rotation.y));
    halo.material.opacity *= 0.35 + 0.65 * facing;
    halo.position.z = -1.2 + 0.68 * wallA; // in front of the wall while the room is in view
    spill.intensity = g * 1.35 * wallA * flicker;

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
