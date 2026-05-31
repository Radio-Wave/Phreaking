/* Spiral growth animation — Can We Start Again?
   Layers:
   1. Body CSS  — dark charcoal + SVG fractal noise grain
   2. cwsa-stars — JS grain tile + static military grid + scattered stars (drawn once)
   3. cwsa-paths — organic growth arms + cosmic-ray tracks (animated, trail-fade)
*/
(function () {
  'use strict';

  const starCanvas = document.getElementById('cwsa-stars');
  const pathCanvas = document.getElementById('cwsa-paths');
  if (!starCanvas || !pathCanvas) return;

  const sCx = starCanvas.getContext('2d');
  const pCx = pathCanvas.getContext('2d');

  const DPR     = Math.min(window.devicePixelRatio || 1, 1.5);
  const mobile  = window.innerWidth < 768;

  const MAX_ARMS  = mobile ? 5 : 9;
  const MAX_RAYS  = mobile ? 3 : 5;
  const FADE_RATE = 0.003; // destination-out per frame

  let W = 0, H = 0;
  let stars = [], arms = [], cosmicRays = [];
  let lastTime = 0, spawnTimer = 0, cosmicTimer = 5000 + Math.random() * 10000;
  let grainPattern = null;

  // ===== Grain tile — generated once =====
  function makeGrainTile() {
    const SZ = 280;
    const t = document.createElement('canvas');
    t.width = t.height = SZ;
    const cx = t.getContext('2d');
    const id = cx.createImageData(SZ, SZ);
    const d  = id.data;
    const bgR = 22, bgG = 22, bgB = 20, amt = 16;
    for (let i = 0; i < d.length; i += 4) {
      const n = ((Math.random() - 0.5) * amt) | 0;
      d[i]   = Math.max(0, Math.min(255, bgR + n));
      d[i+1] = Math.max(0, Math.min(255, bgG + n));
      d[i+2] = Math.max(0, Math.min(255, bgB + n));
      d[i+3] = 255;
    }
    cx.putImageData(id, 0, 0);
    return t;
  }

  // ===== Military grid — drawn once onto star canvas =====
  function drawGrid() {
    const spacing = Math.round(Math.min(W, H) / 11); // ~75–90 px
    const offX    = ((W % spacing) / 2) | 0; // centre the grid
    const offY    = ((H % spacing) / 2) | 0;

    sCx.save();
    sCx.strokeStyle = 'rgba(88,108,66,0.055)';
    sCx.lineWidth   = 0.5;

    for (let x = offX; x <= W; x += spacing) {
      sCx.beginPath(); sCx.moveTo(x, 0); sCx.lineTo(x, H); sCx.stroke();
    }
    for (let y = offY; y <= H; y += spacing) {
      sCx.beginPath(); sCx.moveTo(0, y); sCx.lineTo(W, y); sCx.stroke();
    }

    // Sparse tick/crosshair markers at some intersections
    // Deterministic selection via grid-index hash — stable across frames
    const tickLen = 4;
    sCx.strokeStyle = 'rgba(100,125,75,0.10)';
    sCx.lineWidth   = 0.5;

    for (let x = offX; x <= W; x += spacing) {
      for (let y = offY; y <= H; y += spacing) {
        const ix = Math.round((x - offX) / spacing);
        const iy = Math.round((y - offY) / spacing);
        const h  = (ix * 7 + iy * 13 + ix * iy * 3) % 100;
        if (h > 22) continue; // ~22 % of intersections get a tick

        sCx.beginPath();
        sCx.moveTo(x - tickLen, y); sCx.lineTo(x + tickLen, y);
        sCx.moveTo(x, y - tickLen); sCx.lineTo(x, y + tickLen);
        sCx.stroke();
      }
    }

    // One slightly brighter reference crosshair near screen centre
    const cx = (Math.round(W / 2 / spacing) * spacing + offX);
    const cy = (Math.round(H / 2 / spacing) * spacing + offY);
    sCx.strokeStyle = 'rgba(110,135,80,0.16)';
    sCx.lineWidth   = 0.5;
    const rl = 10;
    sCx.beginPath();
    sCx.moveTo(cx - rl, cy); sCx.lineTo(cx + rl, cy);
    sCx.moveTo(cx, cy - rl); sCx.lineTo(cx, cy + rl);
    sCx.stroke();

    sCx.restore();
  }

  // ===== Stars =====
  function initStars() {
    const count = Math.min(Math.floor(W * H / (mobile ? 8000 : 6000)), 140);
    stars = Array.from({ length: count }, () => ({
      x:    Math.random() * W,
      y:    Math.random() * H,
      r:    Math.random() * 0.7 + 0.15,
      a:    Math.random() * 0.28 + 0.08,
      warm: Math.random() > 0.3,
    }));
  }

  function drawStarsOnce() {
    sCx.clearRect(0, 0, W, H);

    // Grain layer
    if (!grainPattern) grainPattern = sCx.createPattern(makeGrainTile(), 'repeat');
    sCx.save();
    sCx.globalAlpha = 0.45;
    sCx.fillStyle   = grainPattern;
    sCx.fillRect(0, 0, W, H);
    sCx.restore();

    // Military grid (on top of grain, under stars)
    drawGrid();

    // Stars
    sCx.save();
    for (const s of stars) {
      sCx.globalAlpha = s.a;
      sCx.fillStyle   = s.warm ? 'rgb(230,226,198)' : 'rgb(200,218,228)';
      sCx.beginPath();
      sCx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      sCx.fill();
    }
    sCx.restore();
  }

  // ===== Resize =====
  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    for (const cvs of [starCanvas, pathCanvas]) {
      cvs.width  = W * DPR;
      cvs.height = H * DPR;
      cvs.style.width  = W + 'px';
      cvs.style.height = H + 'px';
    }
    sCx.setTransform(DPR, 0, 0, DPR, 0, 0);
    pCx.setTransform(DPR, 0, 0, DPR, 0, 0);

    grainPattern = null;
    initStars();
    drawStarsOnce();
    pCx.clearRect(0, 0, W, H);
  }

  // ===== Organic arm palettes =====
  const PALETTES = [
    { line: '#688c1e', tip: '#aad430' },
    { line: '#578018', tip: '#94c425' },
    { line: '#7a9428', tip: '#c2e03a' },
    { line: '#4e7c14', tip: '#86c020' },
    { line: '#5e8220', tip: '#a0ca2a' },
  ];
  const DATA_PAL = { line: '#2e7a94', tip: '#6ecce0' };

  // ===== Organic Arm =====
  class Arm {
    constructor(x, y, angle, opts) {
      opts = opts || {};
      this.x     = x; this.y = y; this.angle = angle;
      this.speed = (mobile ? 8 : 11) + Math.random() * 18;
      this.curvature = this.targetCurvature = (Math.random() - 0.5) * 0.010;
      this.age    = 0;
      this.maxAge = opts.maxAge || 18000 + Math.random() * 28000;
      this.alive  = true;
      this.nextCurveChange = 3000 + Math.random() * 7000;
      this.inSpiral = false;
      this.nextBranch = 5000 + Math.random() * 12000;
      this.nextSnap   = 9000 + Math.random() * 18000;
      this.isData = opts.isData || Math.random() < 0.10;
      this.pal    = this.isData ? DATA_PAL : PALETTES[Math.floor(Math.random() * PALETTES.length)];
      this.lineWidth = opts.lineWidth || 0.45 + Math.random() * 0.55;
      this.baseAlpha = 0.45 + Math.random() * 0.30;
      this._first = true;
    }

    step(dt) {
      this.age += dt * 1000;
      const margin = 220;
      if (this.x < -margin || this.x > W+margin || this.y < -margin || this.y > H+margin ||
          this.age > this.maxAge) { this.alive = false; return null; }

      this.nextCurveChange -= dt * 1000;
      if (this.nextCurveChange <= 0) {
        this.inSpiral = !this.inSpiral;
        this.targetCurvature = this.inSpiral
          ? (Math.random() > 0.5 ? 1 : -1) * (0.022 + Math.random() * 0.038)
          : (Math.random() - 0.5) * 0.010;
        this.nextCurveChange = this.inSpiral ? 5000 + Math.random()*10000 : 3000 + Math.random()*7000;
      }

      this.nextSnap -= dt * 1000;
      if (this.nextSnap <= 0 && this.isData) {
        this.targetCurvature += (Math.random() - 0.5) * 0.045;
        this.nextSnap = 6000 + Math.random() * 12000;
      }

      this.curvature += (this.targetCurvature - this.curvature) * Math.min(dt * 1.2, 0.07);
      this.angle += this.curvature;
      const nx = this.x + Math.cos(this.angle) * this.speed * dt;
      const ny = this.y + Math.sin(this.angle) * this.speed * dt;

      const r = this.age / this.maxAge;
      const env = r < 0.08 ? r / 0.08 : r > 0.82 ? Math.max(0, (1-r)/0.18) : 1;

      if (!this._first) this._draw(nx, ny, env);
      this._first = false;
      this.x = nx; this.y = ny;

      let branch = null;
      this.nextBranch -= dt * 1000;
      if (this.nextBranch <= 0 && arms.length < MAX_ARMS) {
        const s = Math.random() > 0.5 ? 1 : -1;
        branch = new Arm(nx, ny, this.angle + s * (0.35 + Math.random() * 0.65), {
          maxAge:    this.maxAge * (0.25 + Math.random() * 0.35),
          isData:    this.isData,
          lineWidth: this.lineWidth * (0.6 + Math.random() * 0.45),
        });
        branch.pal   = this.pal;
        branch.speed = this.speed * (0.40 + Math.random() * 0.60);
        this.nextBranch = 6000 + Math.random() * 14000;
      }
      return branch;
    }

    _draw(nx, ny, env) {
      const a = this.baseAlpha * env;
      if (a < 0.005) return;
      pCx.save();
      pCx.lineCap = pCx.lineJoin = 'round';
      pCx.globalAlpha = a * 0.80;
      pCx.strokeStyle = this.pal.line;
      pCx.lineWidth   = this.lineWidth;
      pCx.shadowBlur  = 0;
      pCx.beginPath(); pCx.moveTo(this.x, this.y); pCx.lineTo(nx, ny); pCx.stroke();
      const dotR = Math.min(this.lineWidth * 0.9, 0.9);
      if (dotR > 0.1) {
        pCx.globalAlpha  = a * 0.88;
        pCx.fillStyle    = this.pal.tip;
        pCx.shadowBlur   = 4;
        pCx.shadowColor  = this.pal.tip;
        pCx.beginPath(); pCx.arc(nx, ny, dotR, 0, Math.PI * 2); pCx.fill();
      }
      pCx.restore();
    }
  }

  // ===== CosmicRay — fast cloud-chamber / shooting-star tracks =====
  // Drawn at low alpha so they fade via the existing FADE_RATE within 3–8 s.
  const RAY_COLORS = [
    { line: 'rgba(210,215,185,1)', tip: '#e8e8cc' }, // pale cream (muon)
    { line: 'rgba(195,210,170,1)', tip: '#d8e8b8' }, // pale green (low energy)
    { line: 'rgba(215,200,155,1)', tip: '#eed8a0' }, // warm straw (heavy particle)
    { line: 'rgba(160,215,215,1)', tip: '#aadddd' }, // cool teal (energetic)
  ];

  class CosmicRay {
    constructor(xIn, yIn, ang) {
      // Spawn from screen edge if not provided
      if (xIn === undefined) {
        const side = Math.floor(Math.random() * 4);
        const m = 10;
        if      (side === 0) { this.x = Math.random()*W; this.y = -m; ang = Math.PI*0.5 + (Math.random()-0.5)*0.9; }
        else if (side === 1) { this.x = W+m; this.y = Math.random()*H; ang = Math.PI + (Math.random()-0.5)*0.9; }
        else if (side === 2) { this.x = Math.random()*W; this.y = H+m; ang = -Math.PI*0.5 + (Math.random()-0.5)*0.9; }
        else                  { this.x = -m; this.y = Math.random()*H; ang = (Math.random()-0.5)*0.9; }
      } else {
        this.x = xIn; this.y = yIn;
      }

      this.angle   = ang;
      this.prevX   = this.x;
      this.prevY   = this.y;

      const heavy  = Math.random() < 0.12; // alpha-particle style
      this.speed   = heavy ? 80 + Math.random()*120 : 180 + Math.random()*340; // px/s
      this.maxAge  = heavy ? 0.4 + Math.random()*0.6 : 0.6 + Math.random()*2.0; // s

      // Slight curvature — simulates weak magnetic deflection
      this.curvature = (Math.random() - 0.5) * (heavy ? 0.005 : 0.002);

      this.age     = 0;
      this.alive   = true;
      this.hasFork = false;

      const ci     = heavy ? 2 : Math.floor(Math.random() * RAY_COLORS.length);
      this.col     = RAY_COLORS[ci];
      this.lineWidth = heavy ? 1.1 + Math.random()*0.6 : 0.4 + Math.random()*0.5;

      // Alpha drawn LOW — these fade naturally via FADE_RATE
      // Heavy: higher base so Bragg-peak feel; light: very subtle
      this.baseAlpha = heavy ? 0.38 + Math.random()*0.25 : 0.18 + Math.random()*0.20;
      this.heavy     = heavy;

      // Grain cluster spacing along track (ionisation trail texture)
      this.clusterEvery = heavy ? 3 : 6; // px between ionisation dots
    }

    step(dt) {
      this.age += dt;
      if (this.age > this.maxAge ||
          this.x < -150 || this.x > W+150 || this.y < -150 || this.y > H+150) {
        this.alive = false; return null;
      }

      this.angle += this.curvature;
      this.prevX  = this.x;
      this.prevY  = this.y;
      this.x     += Math.cos(this.angle) * this.speed * dt;
      this.y     += Math.sin(this.angle) * this.speed * dt;

      // Life envelope — flash in quickly, linger, fade out
      const r   = this.age / this.maxAge;
      const env = r < 0.06 ? r / 0.06 : r > 0.70 ? Math.max(0, (1-r)/0.30) : 1;

      this._draw(env);

      // Rare delta-ray fork
      let fork = null;
      if (!this.hasFork && Math.random() < 0.007 * this.speed * dt) {
        this.hasFork = true;
        const s = Math.random() > 0.5 ? 1 : -1;
        fork = new CosmicRay(this.x, this.y,
          this.angle + s * (0.5 + Math.random() * 0.9));
        fork.speed    = this.speed * (0.15 + Math.random() * 0.4);
        fork.maxAge   = this.maxAge * (0.2 + Math.random() * 0.35);
        fork.lineWidth = this.lineWidth * 0.55;
        fork.baseAlpha = this.baseAlpha * 0.7;
        fork.curvature = (Math.random() - 0.5) * 0.012;
        fork.hasFork  = true; // no second-order forks
      }
      return fork;
    }

    _draw(env) {
      const a = this.baseAlpha * env;
      if (a < 0.004) return;

      const dx  = this.x - this.prevX;
      const dy  = this.y - this.prevY;
      const len = Math.hypot(dx, dy);

      pCx.save();
      pCx.lineCap  = 'round';
      pCx.lineJoin = 'round';
      pCx.shadowBlur = 0;

      // Core track line
      pCx.globalAlpha = a;
      pCx.strokeStyle = this.col.line;
      pCx.lineWidth   = this.lineWidth;
      pCx.beginPath();
      pCx.moveTo(this.prevX, this.prevY);
      pCx.lineTo(this.x, this.y);
      pCx.stroke();

      // Ionisation grain clusters along the track
      if (len > 1) {
        const steps = Math.max(1, Math.floor(len / this.clusterEvery));
        const ux = dx / len, uy = dy / len; // unit vector
        // Perpendicular for scatter
        const px = -uy, py = ux;

        for (let i = 0; i < steps; i++) {
          const t  = (i + 0.5) / steps;
          const cx = this.prevX + ux * len * t;
          const cy = this.prevY + uy * len * t;
          // Random transverse scatter (Gaussian-ish approximation)
          const scatter = (Math.random() + Math.random() - 1) * 1.4;
          const gx = cx + px * scatter;
          const gy = cy + py * scatter;
          pCx.globalAlpha = a * (0.25 + Math.random() * 0.45);
          pCx.fillStyle   = this.col.line;
          pCx.beginPath();
          pCx.arc(gx, gy, 0.45 + Math.random() * 0.5, 0, Math.PI * 2);
          pCx.fill();
        }
      }

      // Leading-edge bright node (the "ionising particle" head)
      pCx.globalAlpha  = a * 0.92;
      pCx.fillStyle    = this.col.tip;
      pCx.shadowBlur   = this.heavy ? 6 : 3;
      pCx.shadowColor  = this.col.tip;
      const dotR = this.heavy ? 1.4 : 0.8;
      pCx.beginPath();
      pCx.arc(this.x, this.y, dotR, 0, Math.PI * 2);
      pCx.fill();

      pCx.restore();
    }
  }

  // ===== Arm spawn =====
  function spawnArm() {
    const m = 30, sp = Math.PI * 0.55;
    const side = Math.floor(Math.random() * 4);
    let x, y, a;
    if      (side === 0) { x = m + Math.random()*(W-m*2); y = -m;  a = Math.PI/2+(Math.random()-0.5)*sp; }
    else if (side === 1) { x = W+m; y = m+Math.random()*(H-m*2);   a = Math.PI +(Math.random()-0.5)*sp; }
    else if (side === 2) { x = m + Math.random()*(W-m*2); y = H+m; a = -Math.PI/2+(Math.random()-0.5)*sp; }
    else                  { x = -m; y = m+Math.random()*(H-m*2);   a = (Math.random()-0.5)*sp; }
    return new Arm(x, y, a);
  }

  // ===== Frame =====
  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.04);
    lastTime = now;

    // Fade all path traces
    pCx.save();
    pCx.globalCompositeOperation = 'destination-out';
    pCx.fillStyle = `rgba(0,0,0,${FADE_RATE})`;
    pCx.fillRect(0, 0, W, H);
    pCx.restore();

    // --- Organic arms ---
    const newBranches = [];
    arms = arms.filter(arm => {
      const b = arm.step(dt);
      if (b) newBranches.push(b);
      return arm.alive;
    });
    arms.push(...newBranches);

    spawnTimer -= dt * 1000;
    if (arms.length < 2 || (arms.length < MAX_ARMS && spawnTimer <= 0)) {
      arms.push(spawnArm());
      spawnTimer = 6000 + Math.random() * 8000;
    }

    // --- Cosmic rays ---
    const newForks = [];
    cosmicRays = cosmicRays.filter(ray => {
      const f = ray.step(dt);
      if (f) newForks.push(f);
      return ray.alive;
    });
    cosmicRays.push(...newForks);

    cosmicTimer -= dt * 1000;
    if (cosmicTimer <= 0 && cosmicRays.length < MAX_RAYS) {
      cosmicRays.push(new CosmicRay());
      // Occasionally fire two at once (shower event)
      if (Math.random() < 0.15 && cosmicRays.length < MAX_RAYS) {
        cosmicRays.push(new CosmicRay());
      }
      cosmicTimer = 7000 + Math.random() * 14000;
    }

    requestAnimationFrame(frame);
  }

  // ===== Init =====
  window.addEventListener('resize', resize, { passive: true });
  resize();

  for (let i = 0; i < (mobile ? 2 : 3); i++) arms.push(spawnArm());

  requestAnimationFrame(ts => { lastTime = ts; requestAnimationFrame(frame); });
})();
