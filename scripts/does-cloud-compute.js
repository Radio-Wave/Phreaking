/* Smooth, steady pixel clouds — no Y jitter, gentle X parallax + cursor */
(function(){
  const back  = document.getElementById('clouds-back');
  const front = document.getElementById('clouds-front');
  const fore  = document.getElementById('clouds-fore') || (()=>{
    const c = document.createElement('canvas'); c.id='clouds-fore';
    document.body.appendChild(c); return c;
  })();

  const DPR = Math.min(devicePixelRatio || 1, 2);

  // Layer config — very few items + tiny foreground parallax
  const layers = [
    { cvs: back,  px: 16, count: 20, speed:  3, alpha: 0.10, color:'#5A6671', depth: 0.25 },
    { cvs: front, px: 12, count: 15, speed:  6, alpha: 0.16, color:'#6A7782', depth: 0.50 },
    { cvs: fore,  px: 10, count:  5,  speed:  1, alpha: 0.18, color:'#7D8892', depth: 0.08 },
  ];

  // Smoothed inputs
  let W=0,H=0, last=performance.now();
  let scrollTargetX=0, scrollX=0;
  let mouseTargetX=0, mouseTargetY=0, mouseX=0, mouseY=0;

  // Seeded RNG so clouds don’t change mid-scroll
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}}
  const rnd = mulberry32(0xC10ED5); // valid hex seed
  const ri = (a,b)=>Math.floor(a + rnd()*(b-a+1));

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

  function makeCloud(L, small=false){
    const blocks=[];
    const w = small ? ri(3,7) : ri(6,15);
    const h = small ? ri(2,5) : ri(4,10);
    for(let y=0;y<h;y++){
      const rowW = w - ri(0,2);
      for(let x=0;x<rowW;x++){
        if(rnd()<0.08) continue;
        blocks.push({x,y});
      }
    }
    const scale = small ? ri(2,3) : ri(3,7);
    const px = L.px;
    const cloudW = (w*px)*scale;
    const cloudH = (h*px)*scale;
    const x0 = rnd()*(W + cloudW) - cloudW;
    const y0 = rnd()*(H - cloudH);
    return { blocks, scale, px, x:x0, y:y0, w:cloudW, h:cloudH, t: rnd()*1000 };
  }

  function seed(L){
    const small = L === layers[2];
    L.items = Array.from({length:L.count}, ()=>makeCloud(L, small));
  }

  function lerp(a,b,k){ return a + (b-a)*k; }

  function updateInputs(dt){
    // smooth scroll → X offset only (no Y parallax)
    scrollX = lerp(scrollX, scrollTargetX, 1 - Math.pow(0.001, dt*60));
    // smooth mouse
    mouseX  = lerp(mouseX,  mouseTargetX,  1 - Math.pow(0.0015, dt*60));
    mouseY  = lerp(mouseY,  mouseTargetY,  1 - Math.pow(0.0015, dt*60));
  }

  function drawLayer(L, dt){
    const ctx=L.ctx; ctx.clearRect(0,0,W,H); ctx.globalAlpha=L.alpha; ctx.fillStyle=L.color;

    const mouseOffsetX = (mouseX - W/2) * 0.02 * L.depth; // subtle cursor parallax
    const baseScrollX  = scrollX * L.depth;

    L.items.forEach(cl=>{
      cl.t += dt * L.speed;

      // X movement: slow drift + smoothed scroll + slight cursor
      let x = (cl.x + cl.t + baseScrollX + mouseOffsetX) % (W + cl.w);
      if(x < -cl.w) x += (W + cl.w);
      x -= cl.w; // start off-screen for wrap

      // Y is FIXED — no scroll Y influence (kills twitch)
      const y = cl.y + Math.sin(cl.t*0.05)*0.5; // tiny breathing only

      const s = cl.scale*cl.px;
      for(let i=0;i<cl.blocks.length;i++){
        const b=cl.blocks[i];
        ctx.fillRect((x + b.x*s)|0, (y + b.y*s)|0, s, s);
      }
    });

    ctx.globalAlpha=1;
  }

  function frame(now){
    let dt = (now-last)/1000; last = now;
    if(dt>0.05) dt = 0.016;          // cap big pauses
    updateInputs(dt);
    layers.forEach(L=>drawLayer(L, dt));
    requestAnimationFrame(frame);
  }

  // INPUTS
  addEventListener('resize', fit, {passive:true});
  addEventListener('mousemove', e=>{
    mouseTargetX = e.clientX;
    mouseTargetY = e.clientY;
  }, {passive:true});

  // map page scroll to a small X offset; scale keeps it minimal
  const SCROLL_SCALE = 0.12; // reduce this for even less parallax
  addEventListener('scroll', ()=>{
    // don’t use raw value directly — store as target, we’ll lerp toward it
    scrollTargetX = (window.scrollY || 0) * SCROLL_SCALE;
  }, {passive:true});

  fit();
  requestAnimationFrame(frame);
})();