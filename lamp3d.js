/* 3D OM night lamps (Three.js r128). Each section that shows the lamp has its own small
   canvas, which scrolls with the page like any other content. All lamps share one animation
   loop, and a lamp only draws while its canvas is on screen.
   Exposes window.Lamps:
     create(canvas)   a lamp drawn in that canvas, or null when WebGL is unavailable:
       setPose(p)       ease toward {s, rx, ry, glow, room, spin, sway}
                        s: size (1 fills about half the canvas height), room: studio light (0..1),
                        spin: a steady turn in rad/s, sway: amplitude of a slow side-to-side turn
       snap()           jump straight to the current pose
       setArt(id, flip) show a design (see designs.js); with flip, the lamp turns once
                        and the art changes while it's edge-on
       power            0..1 multiplier on the glow
     focusPoint()     centre (CSS px) of the on-screen lamp nearest the middle of the screen, or null */
(function () {
  "use strict";

  const Art = window.LampArt;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const Perf = window.Perf || { lowEnd: false, level: 0, onChange() {} };
  const lite = Perf.lowEnd;
  const DPR = window.devicePixelRatio || 1;
  const TAU = Math.PI * 2;
  const ratioFor = (level) => Math.min(DPR, [2, 1.5, 1][level] || 1);
  const FOV = 30, DIST = 12;
  const W = 2.4, H = 2.9;

  /* ---------- Geometry, built once and shared by every lamp ---------- */
  const SEG = lite ? { bevel: 4, curve: 14, round: 16 } : { bevel: 8, curve: 28, round: 32 };
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
      { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: SEG.bevel, curveSegments: SEG.curve }
    );
    geo.center();
    geo.computeVertexNormals();
    return geo;
  }
  function roundedPlane(w, h, r) {
    const geo = new THREE.ShapeGeometry(roundedRectShape(w, h, r), SEG.curve);
    // map UVs to 0..1 across the plane
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    return geo;
  }

  const BODY_D = 0.42, BODY_B = 0.1;
  const FRONT_Z = BODY_D / 2 + BODY_B;
  const ART_W = 1.98, ART_H = 2.48;
  const MOD = 1.7, MOD_D = 0.42, MOD_B = 0.08;
  const MOD_Z = -FRONT_Z - 0.14 - (MOD_D / 2 + MOD_B);
  const BACK_Z = MOD_Z - (MOD_D / 2 + MOD_B);
  const PIN_L = 0.78;
  let G = null;
  function geometry() {
    if (G) return G;
    const pin = new THREE.CylinderGeometry(0.075, 0.075, PIN_L, SEG.round);
    pin.rotateX(Math.PI / 2);
    const collar = new THREE.CylinderGeometry(0.11, 0.11, 0.06, SEG.round);
    collar.rotateX(Math.PI / 2);
    G = {
      body: roundedSlab(W, H, 0.3, BODY_D, BODY_B),
      art: roundedPlane(ART_W, ART_H, 0.14),
      plate: roundedSlab(2.15, 2.6, 0.24, 0.08, 0.03),
      module: roundedSlab(MOD, MOD, 0.2, MOD_D, MOD_B),
      pin, collar,
      tip: new THREE.SphereGeometry(0.075, SEG.round * 0.75, SEG.round / 2),
      hole: new THREE.CircleGeometry(0.07, 24)
    };
    return G;
  }

  /* ---------- Shared textures ---------- */
  function canvasTexture(draw, size) {
    const c = document.createElement("canvas");
    c.width = size[0]; c.height = size[1];
    draw(c.getContext("2d"));
    return c;
  }
  // a soft warm studio, so plastic and metal read properly
  const envCanvas = canvasTexture((g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#5a4a3c");
    grad.addColorStop(0.45, "#2a2230");
    grad.addColorStop(1, "#0b0a10");
    g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
    [[140, 70, 70, "rgba(255,226,180,0.95)"], [390, 90, 50, "rgba(255,170,90,0.7)"]].forEach(([x, y, r, col]) => {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col); rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg; g.fillRect(0, 0, 512, 256);
    });
  }, [512, 256]);
  // neutral, so each design can tint it with its own colour
  const haloTex = new THREE.CanvasTexture(canvasTexture((g) => {
    const rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    rg.addColorStop(0, "rgba(255,255,255,0.9)");
    rg.addColorStop(0.25, "rgba(235,235,235,0.45)");
    rg.addColorStop(0.6, "rgba(210,210,210,0.12)");
    rg.addColorStop(1, "rgba(210,210,210,0)");
    g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
  }, [256, 256]));

  // A real artwork file in images/designs/<id>.webp (or .jpg), 4:5 portrait, replaces the drawn one.
  const artTextures = {};
  function artTexture(id) {
    if (artTextures[id]) return artTextures[id];
    const tex = new THREE.CanvasTexture(Art.canvas(id));
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = lite ? 4 : 8;
    artTextures[id] = tex;
    if (!Art.files) return tex;
    const img = new Image();
    img.addEventListener("load", () => { tex.image = img; tex.needsUpdate = true; wake(); });
    img.addEventListener("error", () => { if (img.src.endsWith(".webp")) img.src = `images/designs/${id}.jpg`; });
    img.src = `images/designs/${id}.webp`;
    return tex;
  }

  /* ---------- One lamp ---------- */
  const lamps = [];
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  let failed = false, fontsLoaded = false;

  function coated(opts) {
    if (!lite) return new THREE.MeshPhysicalMaterial(opts);
    delete opts.clearcoat; delete opts.clearcoatRoughness;
    return new THREE.MeshStandardMaterial(opts);
  }

  function create(canvas) {
    if (failed) return null;
    let renderer;
    try {
      // MSAA is wasted on dense screens, and costly on the phones that have them
      renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite && DPR < 1.5, alpha: true, powerPreference: "high-performance" });
    } catch (e) {
      failed = true;
      return null;
    }
    renderer.setPixelRatio(ratioFor(Perf.level));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    camera.position.set(0, 0, DIST);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = new THREE.CanvasTexture(envCanvas);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.encoding = THREE.sRGBEncoding;
    scene.environment = pmrem.fromEquirectangular(envTex).texture;
    envTex.dispose();
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(0xfff1dc, 0x1a1530, 0.35);
    const key = new THREE.DirectionalLight(0xffe6c4, 1.1);
    key.position.set(4, 5, 7);
    const rim = new THREE.DirectionalLight(0xff9a3c, 1.3);
    rim.position.set(-6, 2, -5);
    const fill = new THREE.DirectionalLight(0x9c8cff, 0.25);
    fill.position.set(-5, -3, 5);
    scene.add(hemi, key, rim, fill);

    const plastic = coated({
      color: 0xf1ece3, roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.35,
      emissive: new THREE.Color(0xffa94d), emissiveIntensity: 0
    });
    const plasticBack = coated({ color: 0xebe6dc, roughness: 0.5, clearcoat: 0.2 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xe6e1d8, metalness: 1, roughness: 0.22, envMapIntensity: 1.4 });
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x2a2622 });
    const artMat = new THREE.MeshStandardMaterial({
      roughness: 0.32, metalness: 0, transparent: true,
      emissive: new THREE.Color(0xffffff), emissiveIntensity: 0
    });
    // thin glossy cover over the print
    const coverMat = coated({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.08, clearcoat: 1, depthWrite: false });

    /* the model */
    const g = geometry();
    const root = new THREE.Group();   // scale
    const spin = new THREE.Group();   // rotation
    root.add(spin);
    scene.add(root);
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); spin.add(m); return m; };
    add(g.body, plastic, 0, 0, 0);
    add(g.art, artMat, 0, 0, FRONT_Z + 0.002);
    add(g.art, coverMat, 0, 0, FRONT_Z + 0.006);
    add(g.plate, plasticBack, 0, 0, -FRONT_Z - 0.07);
    add(g.module, plasticBack, 0, -0.12, MOD_Z);
    [-0.36, 0.36].forEach((x) => {
      add(g.pin, metal, x, -0.12, BACK_Z - PIN_L / 2 + 0.02);
      add(g.tip, metal, x, -0.12, BACK_Z - PIN_L + 0.02);
      add(g.collar, plasticBack, x, -0.12, BACK_Z - 0.02);
    });
    // screw holes on the module, as on the real product
    [0.42, -0.66].forEach((y) => { add(g.hole, holeMat, 0, y, BACK_Z - 0.002).rotation.y = Math.PI; });
    // centre the model's depth so it rotates around its middle
    spin.children.forEach((m) => { m.position.z += 0.45; });

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0
    }));
    halo.scale.set(4.6, 4.6, 1); // stays inside the canvas, so it never shows a hard edge
    halo.position.z = -1.2;
    root.add(halo);

    /* pose state */
    const target = { s: 1, rx: 0, ry: 0, glow: 0, room: 1, spin: 0, sway: 0 };
    const cur = Object.assign({}, target);
    const RATE = { s: 3.2, rx: 3, ry: 2.6, glow: 2.2, room: 2.2, spin: 1.6, sway: 1.6 };
    let turn = 0, shownArt = null, wantArt = "om", flipFrom = null, emit = 1;
    let visH = 1, visW = 1;

    function applyArt(id) {
      shownArt = id;
      flipFrom = null;
      const d = Art.DESIGNS[id];
      emit = d.emit || 1;
      const tex = artTexture(id);
      const first = !artMat.map;
      artMat.map = tex;
      artMat.emissiveMap = tex;
      if (first) artMat.needsUpdate = true;
      plastic.emissive.setHex(d.body);
      halo.material.color.setHex(d.halo);
    }

    const lamp = {
      canvas, visible: false, power: 1,
      setArt(id, flip) {
        if (!Art.DESIGNS[id]) return;
        wantArt = id;
        if (!fontsLoaded) return;
        if (id === shownArt) { flipFrom = null; return; }
        if (!flip || reduceMotion || !lamp.visible) { applyArt(id); wake(); return; }
        if (flipFrom === null) {
          flipFrom = cur.ry + turn;
          target.ry += TAU;
          wake();
        }
      },
      setPose(p) {
        if (flipFrom !== null) applyArt(wantArt); // a new pose cancels the turn, so swap now
        // fold the accumulated spin into the eased angle, then take the shortest way round
        cur.ry += turn; turn = 0;
        Object.assign(target, { s: 1, room: 1, spin: 0, sway: 0 }, p);
        target.ry += TAU * Math.round((cur.ry - target.ry) / TAU);
        wake();
      },
      snap() { turn = 0; Object.assign(cur, target); wake(); },
      fontsReady() { applyArt(wantArt); },
      resize(w, h) {
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        visH = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * DIST;
        visW = visH * camera.aspect;
        wake();
      },
      quality(level) { renderer.setPixelRatio(ratioFor(level)); lamp.resize(canvas.clientWidth, canvas.clientHeight); },
      frame(dt, t) {
        for (const p in target) cur[p] += (target[p] - cur[p]) * (reduceMotion ? 1 : 1 - Math.exp(-dt * RATE[p]));
        const motion = reduceMotion ? 0 : 1;
        turn = (turn + cur.spin * dt * motion) % TAU;
        if (flipFrom !== null && Math.abs(cur.ry + turn - flipFrom) > Math.PI / 2) applyArt(wantArt);

        // size to fit the canvas, whichever way it is narrower
        const fit = Math.min(visH, visW * (H / W) * 0.8);
        const scale = cur.s * 0.5 * fit / H;
        root.position.y = Math.sin(t * 1.1) * 0.012 * motion * visH;
        root.scale.setScalar(scale);
        const ry = cur.ry + turn + (Math.sin(t * 0.55) * cur.sway + pointer.sx * 0.22) * motion;
        spin.rotation.set(cur.rx + pointer.sy * 0.12 * motion, ry, 0);

        const room = Math.max(0.04, Math.min(1, cur.room));
        hemi.intensity = 0.35 * room; key.intensity = 1.1 * room;
        rim.intensity = 1.3 * (0.25 + 0.75 * room); fill.intensity = 0.25 * room;
        plastic.envMapIntensity = plasticBack.envMapIntensity = artMat.envMapIntensity = room;
        metal.envMapIntensity = 1.4 * room;

        const glow = Math.max(0, cur.glow) * lamp.power;
        const flicker = reduceMotion ? 1 : 1 + Math.sin(t * 2.3) * 0.015 + Math.sin(t * 5.1) * 0.01;
        artMat.emissiveIntensity = glow * 0.95 * flicker * emit;
        plastic.emissiveIntensity = glow * 0.16;
        // the halo fades when the lamp turns away
        halo.material.opacity = Math.min(1, glow * 0.95) * flicker * (0.35 + 0.65 * Math.max(0, Math.cos(ry)));

        renderer.render(scene, camera);
      }
    };

    // draw only while on screen; size the drawing buffer to the canvas, and only when it changes
    new IntersectionObserver((entries) => {
      lamp.visible = entries[entries.length - 1].isIntersecting;
      if (lamp.visible) wake();
    }, { rootMargin: "10% 0px" }).observe(canvas);
    new ResizeObserver((entries) => {
      const box = entries[entries.length - 1].contentRect;
      lamp.resize(Math.round(box.width), Math.round(box.height));
    }).observe(canvas);

    if (fontsLoaded) applyArt(wantArt);
    lamps.push(lamp);
    return lamp;
  }

  /* ---------- One loop for every lamp ---------- */
  let looping = false, last = 0;
  function wake() {
    if (looping || document.hidden) return;
    looping = true;
    last = 0;
    requestAnimationFrame(loop);
  }
  function loop(now) {
    if (document.hidden) { looping = false; return; }
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    const follow = 1 - Math.exp(-dt * 3);
    pointer.sx += (pointer.x - pointer.sx) * follow;
    pointer.sy += (pointer.y - pointer.sy) * follow;
    let drew = false;
    for (let i = 0; i < lamps.length; i++) {
      if (!lamps[i].visible) continue;
      lamps[i].frame(dt, now / 1000);
      drew = true;
    }
    if (!drew) { looping = false; return; }
    requestAnimationFrame(loop);
  }
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });
  Perf.onChange((level) => lamps.forEach((l) => l.quality(level)));

  Art.ready.then(() => {
    fontsLoaded = true;
    lamps.forEach((l) => l.fontsReady());
    wake();
  });

  window.Lamps = {
    create,
    focusPoint() {
      let best = null, bestD = Infinity;
      const mid = window.innerHeight / 2;
      for (let i = 0; i < lamps.length; i++) {
        if (!lamps[i].visible) continue;
        const r = lamps[i].canvas.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        const d = Math.abs(cy - mid);
        if (d < bestD) { bestD = d; best = [r.left + r.width / 2, cy]; }
      }
      return best;
    }
  };
})();
