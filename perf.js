/* Quality tier shared by the 3D lamp and the light field.
   Perf.level: 0 full, 1 reduced, 2 minimal. Low-end hardware starts at 1, and the level
   steps down (never up, so it can't oscillate) whenever frames run consistently slow
   for the display's own refresh rate, so 60, 90, 120 and 144 Hz screens are all judged fairly. */
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

  let prev = 0, avg = 0, best = Infinity, frames = 0, holdUntil = 0;
  function watch(now) {
    const dt = now - prev;
    prev = now;
    if (dt > 0 && dt < 120) {
      avg = avg ? avg + (dt - avg) * 0.05 : dt;
      frames++;
      if (frames > 30 && avg < best) best = avg;
      // the refresh interval is at most 1/60 s; anything 60% slower than it means dropped frames
      const budget = Math.min(best, 1000 / 60) * 1.6;
      if (frames > 120 && now > holdUntil && api.level < 2 && avg > budget) {
        api.level++;
        holdUntil = now + 3000;
        document.documentElement.classList.add("lite");
        listeners.forEach((fn) => fn(api.level));
      }
    }
    requestAnimationFrame(watch);
  }
  requestAnimationFrame(watch);
  document.addEventListener("visibilitychange", () => { prev = 0; });
})();
