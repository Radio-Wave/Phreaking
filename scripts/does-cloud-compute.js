/* -----------------------------------------------------------
   Pixel-cloud parallax — smooth + sparse + foreground
   ----------------------------------------------------------- */
(function(){
  const back  = document.getElementById('clouds-back');
  const front = document.getElementById('clouds-front');
  const fore  = document.getElementById('clouds-fore') || (function(){
    const c = document.createElement('canvas'); c.id='clouds-fore';
    document.body.appendChild(c); return c;
  })();

  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  const layers = [
    //   canvas , px,  count, speedX, speedY, alpha,   colour
    { cvs: back,  px: 16, count: 12, speedX:  3, speedY: 0, alpha: 0.10, color:'#5A6671' }, // big/far
    { cvs: front, px: 12, count:  8, speedX:  7, speedY: 0, alpha: 0.16, color:'#6a7782' }, // mid
    { cvs: fore,  px: 10, count:  5, speedX:  1, speedY: 0, alpha: 0.22, color:'#7d8892', foreground:true }, // small/near
  ];

  let W=0,H=0, scrollY=0, last=performance.now(), seeded=Math.random()*1000;

  function fit(){
    W=innerWidth; H=innerHeight;
    layers.forEach(L=>{
      L.ctx = L.cvs.getContext('2d');
      L.cvs.width  = W*DPR; L.cvs.height = H*DPR;
      L.cvs.style.width=W+'px'; L.cvs.style.height=H+'px';
      L.ctx.setTransform(DPR,0,0,DPR,0,0);
      seed(L);
    });
  }

  function rint(a,b){ return Math.floor(a + (Math.sin(seeded+=0.73)+1)/2 * (b-a+1)); }
  function rand(n){  return ((Math.sin(seeded+=0.51)+1)/2) * n; }

  function makeCloud(L, small=false){
    const blocks=[];
    const w = small ? rint(3,8)  : rint(6,18);
    const h = small ? rint(2,6)  : rint(4,12);
    const gap = small ? rint(0,1) : rint(0,2);

    for(let y=0;y<h;y++){
      const rowW = w - rint(0,Math.min(gap,2));
      for(let x=0;x<rowW;x++){
        if(Math.random()<0.07) continue;
        blocks.push({x,y});
      }
    }

    const scale = small ? rint(2,4) : rint(3,8);
    const px = L.px;
    const cloudW = (w*px)*scale;
    const cloudH = (h*px)*scale;
    const x0 = rand(W + cloudW) - cloudW;
    const y0 = rand(H - cloudH);
    return { blocks, scale, px, x:x0, y:y0, w:cloudW, h:cloudH, phaseX: rand(1000), phaseY: rand(1000) };
  }

  function seed(L){
    const small = !!L.foreground;
    L.items = Array.from({length:L.count}, ()=>makeCloud(L, small));
  }

  function updateAndDraw(L, dt){
    const ctx=L.ctx; ctx.clearRect(0,0,W,H); ctx.globalAlpha=L.alpha; ctx.fillStyle=L.color;

    // parallax offsets from scroll
    const sX = (scrollY * (L.foreground? 0.06 : 0.03));
    const sY = (scrollY * (L.foreground? 0.02 : 0.01));

    L.items.forEach(cl=>{
      // accumulate phase with small cap so paused rAF won't jump
      cl.phaseX += dt * L.speedX;
      cl.phaseY += dt * L.speedY;

      // wrap X smoothly
      let x = (cl.x + cl.phaseX + sX) % (W + cl.w);
      if(x < -cl.w) x += (W + cl.w);
      x -= cl.w; // start off-screen for wrap
      const y = cl.y + Math.sin((cl.phaseX+cl.phaseY)*0.08)*1 + sY;

      const s = cl.scale * cl.px;
      for(let i=0;i<cl.blocks.length;i++){
        const b=cl.blocks[i];
        ctx.fillRect((x + b.x*s)|0, (y + b.y*s)|0, s, s);
      }
    });
    ctx.globalAlpha=1;
  }

  function frame(now){
    // cap dt to avoid big jumps (e.g., during scrolling)
    let dt = (now - last)/1000; last = now;
    if(dt > 0.05) dt = 0.016;   // reset to ~1 frame if long pause

    layers.forEach(L => updateAndDraw(L, dt));
    requestAnimationFrame(frame);
  }

  addEventListener('resize', fit, {passive:true});
  addEventListener('scroll', ()=>{ scrollY = window.scrollY || 0; }, {passive:true});
  fit(); requestAnimationFrame(frame);
})();