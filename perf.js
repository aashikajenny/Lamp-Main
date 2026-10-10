/* Quality tier shared by the 3D lamp and the light field.
   Perf.level: 0 full, 1 reduced, 2 minimal. Low-end hardware starts at 1, and the level
   steps down (never up, so it can't oscillate) when frames run slow for the display's own refresh
   rate, so 60, 90, 120 and 144 Hz screens are all judged fairly.
   Only sustained slowness counts: frames are judged in windows of about a second and a half, and
   it takes two slow windows in a row to step down. One-off stalls (the page setting itself up, a
   tab coming back, a resize) don't, so a capable device is never left on the plain version. */
(function () {
  "use strict";

  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  const lowEnd = cores <= 4 || memory <= 4;
  const listeners = [];
  const api = {
    lowEnd,
    level: lowEnd ? 1 : 0,
    onChange(fn) { listeners.push(fn); }
  };
  window.Perf = api;
  if (lowEnd) document.documentElement.classList.add("lite");

  const WINDOW = 90;        // frames per judging window
  const SLOW_SHARE = 0.2;   // a window is slow when more than this share of its frames ran late
  let prev = 0, avg = 0, best = Infinity, seen = 0;
  let n = 0, late = 0, slowWindows = 0;
  let judgeFrom = performance.now() + 4000; // not while the page is still setting itself up
  const pause = (ms) => { judgeFrom = Math.max(judgeFrom, performance.now() + ms); n = late = 0; };

  function watch(now) {
    const dt = now - prev;
    prev = now;
    if (dt > 0 && dt < 250) {
      // the display's refresh interval: the steadiest frame time seen (at most 1/60 s)
      avg = avg ? avg + (dt - avg) * 0.1 : dt;
      if (++seen > 30 && avg < best) best = avg;
      const budget = Math.min(best, 1000 / 60) * 1.6;
      if (now > judgeFrom) {
        n++;
        if (dt > budget) late++;
        if (n >= WINDOW) {
          slowWindows = late > WINDOW * SLOW_SHARE ? slowWindows + 1 : 0;
          n = late = 0;
          if (slowWindows >= 2 && api.level < 2) {
            slowWindows = 0;
            api.level++;
            document.documentElement.classList.add("lite");
            listeners.forEach((fn) => fn(api.level));
            pause(3000); // let the lighter version settle before judging it
          }
        }
      }
    }
    requestAnimationFrame(watch);
  }
  requestAnimationFrame(watch);
  document.addEventListener("visibilitychange", () => { prev = 0; pause(1500); });
  // a real resize (not a phone's address bar sliding away while scrolling) rebuilds the canvases
  let width = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth !== width) { width = window.innerWidth; pause(1500); }
  });
})();
