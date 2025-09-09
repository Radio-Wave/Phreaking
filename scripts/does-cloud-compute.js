/* -----------------------------------------------------------
   Blocky cloud parallax (two pixel canvases + subtle drift)
   ----------------------------------------------------------- */
(function(){
  const back = document.getElementById('clouds-back');
  const front = document.getElementById('clouds-front');
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  const layers = [
    { cvs: back,  ctx: back.getContext('2d'),  px: 16, count: 26, speedX: 0.03, speedY: 0.00, alpha: 0.10 },
    { cvs: front, ctx: front.getContext('2d'), px: 12, count: 20, speedX: 0.06, speedY: 0.00, alpha: 0.16 },
  ];

  let W=0, H=0, t=0, mouseX=0, mouseY=0;

  function fit(){
    W = window.innerWidth; H = window.innerHeight;
    layers.forEach(L=>{
      L.cvs.width  = W * DPR;
      L.cvs.height = H * DPR;
      L.cvs.style.width  = W + 'px';
      L.cvs.style.height = H + 'px';
      L.ctx.setTransform(DPR,0,0,DPR,0,0);
      seed(L);
    });
  }

  function rand(n){ return Math.random()*n; }
  function rint(a,b){ return Math.floor(a+Math.random()*(b-a+1)); }

  function makeCloud(L){
    // random chunky rectangle cloud made of pixel blocks
    const blocks = [];
    const w = rint(6, 18), h = rint(4, 12);          // cloud footprint in blocks
    const gap = rint(0, 2);                          // jaggedness
    for(let y=0;y<h;y++){
      const rowWidth = w - rint(0,Math.min(gap,3));
      for(let x=0; x<rowWidth; x++){
        if(Math.random()<0.08) continue;             // holes
        blocks.push({x, y});
      }
    }
    const scale = rint(3, 8);
    const px = L.px;
    const cloudW = (w*px)*scale;
    const cloudH = (h*px)*scale;
    const x0 = rand(W + cloudW) - cloudW;
    const y0 = rand(H - cloudH);
    return { blocks, scale, px, x:x0, y:y0, w:cloudW, h:cloudH, off: rand(1000) };
  }

  function seed(L){
    L.items = Array.from({length:L.count}, ()=>makeCloud(L));
  }

  function drawLayer(L, time){
    const ctx = L.ctx;
    ctx.clearRect(0,0,W,H);
    ctx.globalAlpha = L.alpha;

    const mx = (mouseX/W - 0.5) * 20;  // subtle mouse parallax
    const my = (mouseY/H - 0.5) * 12;

    L.items.forEach(cl => {
      const drift = (time*L.speedX) + cl.off;
      let x = cl.x + (drift % (W + cl.w)) - cl.w; // wrap horizontally
      let y = cl.y + Math.sin(drift*0.15)*2;

      // depth offset (foreground moves more with mouse)
      x += mx * (L === layers[1] ? 1.2 : 0.6);
      y += my * (L === layers[1] ? 1.0 : 0.5);

      // draw blocks
      ctx.fillStyle = '#5A6671'; // pixel clouds colour (subtle)
      const s = cl.scale * cl.px;
      cl.blocks.forEach(b=>{
        ctx.fillRect(Math.floor(x + b.x*s), Math.floor(y + b.y*s), s, s);
      });
    });

    ctx.globalAlpha = 1;
  }

  function frame(tms){
    t = tms/1000;
    layers.forEach(L => drawLayer(L, t));
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', fit, {passive:true});
  window.addEventListener('mousemove', e=>{ mouseX = e.clientX; mouseY = e.clientY; }, {passive:true});
  fit(); requestAnimationFrame(frame);
})();

/* -----------------------------------------------------------
   “Add to Calendar” — generates a simple ICS download.
   Update the data-start/data-end attributes in HTML once dates are fixed.
   ----------------------------------------------------------- */
(function(){
  const btn = document.getElementById('addCal');
  if(!btn) return;

  btn.addEventListener('click', ()=>{
    const title = btn.dataset.summary || document.title;
    const loc   = btn.dataset.location || '';
    const start = new Date(btn.dataset.start); // ISO
    const end   = new Date(btn.dataset.end);

    // guard if dates are still TBA
    if(isNaN(start.getTime()) || isNaN(end.getTime())){
      alert('Dates are TBA — update the button’s data-start/data-end in the HTML when confirmed.');
      return;
    }

    function dt(d){ // YYYYMMDDTHHMMSSZ (UTC)
      const pad = n => String(n).padStart(2,'0');
      return d.getUTCFullYear()
        + pad(d.getUTCMonth()+1)
        + pad(d.getUTCDate())
        + 'T'
        + pad(d.getUTCHours())
        + pad(d.getUTCMinutes())
        + pad(d.getUTCSeconds())
        + 'Z';
    }

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Phreaking Collective//DCCP//EN',
      'BEGIN:VEVENT',
      `UID:dccp-${Date.now()}@phreaking.co.uk`,
      `DTSTAMP:${dt(new Date())}`,
      `DTSTART:${dt(start)}`,
      `DTEND:${dt(end)}`,
      `SUMMARY:${title}`,
      `LOCATION:${loc}`,
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([ics], {type:'text/calendar'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'does-cloud-compute.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
})();