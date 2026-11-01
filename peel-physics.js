/* STIKAP Peel Lab · physically-inspired, alpha-aware, corner-to-half sticker curl.
 * The artwork is never sent to a server. The lifted flap is an alpha-masked
 * triangular mesh, so it follows the real silhouette (including transparency).
 */
(() => {
  'use strict';
  const sticker = document.getElementById('heroSticker');
  const home = document.getElementById('stickerHome');
  const restore = document.getElementById('resetSticker');
  if (!sticker || !home || !restore) return;
  const img = sticker.querySelector('img');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const canvas = document.createElement('canvas');
  canvas.className = 'sticker-peel-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  sticker.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });
  const backing = document.createElement('canvas');
  const backCtx = backing.getContext('2d', { alpha: true });
  const flap = document.createElement('canvas');
  const flapCtx = flap.getContext('2d', { alpha: true });
  let w = 1, h = 1, ratio = 1, drag = null, detached = false;
  let paintFrame = 0, progress = 0, corner = 'right-top', scrollFrame = 0;
  let lastSide = 'right-top';
  let motionToken = 0; // Invalidates old rebound frames when a new gesture begins.
  let stickTimer = 0, liftTimer = 0;
  const orientedBacks = new Map();

  // Individual triangle: affine-map image triangle into a bent surface triangle.
  // Clip in destination coordinates to prevent spill into adjacent mesh strips.
  function mapTriangle(g, texture, S, D) {
    const [s0,s1,s2] = S, [d0,d1,d2] = D;
    const det = (s1[0]-s0[0])*(s2[1]-s0[1]) - (s2[0]-s0[0])*(s1[1]-s0[1]);
    if (Math.abs(det) < .0001) return;
    const a = ((d1[0]-d0[0])*(s2[1]-s0[1]) - (d2[0]-d0[0])*(s1[1]-s0[1]))/det;
    const b = ((d1[1]-d0[1])*(s2[1]-s0[1]) - (d2[1]-d0[1])*(s1[1]-s0[1]))/det;
    const c = ((d2[0]-d0[0])*(s1[0]-s0[0]) - (d1[0]-d0[0])*(s2[0]-s0[0]))/det;
    const d = ((d2[1]-d0[1])*(s1[0]-s0[0]) - (d1[1]-d0[1])*(s2[0]-s0[0]))/det;
    const e = d0[0] - a*s0[0] - c*s0[1];
    const f = d0[1] - b*s0[0] - d*s0[1];
    g.save();
    g.beginPath();
    g.moveTo(d0[0],d0[1]);g.lineTo(d1[0],d1[1]);g.lineTo(d2[0],d2[1]);g.closePath();
    g.clip();
    g.transform(a,b,c,d,e,f);
    g.drawImage(texture,0,0,w,h);
    g.restore();
  }

  function resizeBuffers() {
    const realW = sticker.offsetWidth || 520;
    const realH = sticker.offsetHeight || 300;
    if (Math.abs(realW-w) < .3 && Math.abs(realH-h) < .3 && canvas.width) return;
    w=realW; h=realH;
    // Limit expensive pixel work on high-DPI phones; the artwork is already anti-aliased.
    ratio = Math.max(1,Math.min(devicePixelRatio||1,1.75,1100/Math.max(w,h)));
    for (const surface of [canvas,backing,flap]) {
      surface.width=Math.round(w*ratio);
      surface.height=Math.round(h*ratio);
    }
    canvas.style.width=w+'px';canvas.style.height=h+'px';
    orientedBacks.clear();
    // The reverse is a cream-coloured, satin backing with no mirrored print.
    backCtx.setTransform(ratio,0,0,ratio,0,0);
    backCtx.clearRect(0,0,w,h);
    if (!img.complete || !img.naturalWidth) return;
    backCtx.drawImage(img,0,0,w,h);
    backCtx.globalCompositeOperation='source-in';
    const grad=backCtx.createLinearGradient(w*.22,h*.1,w,h);
    grad.addColorStop(0,'#fefbf1');grad.addColorStop(.33,'#e2e3e9');
    grad.addColorStop(.56,'#aeb4c0');grad.addColorStop(.76,'#faf9f5');
    grad.addColorStop(1,'#fdfaf5');
    backCtx.fillStyle=grad;backCtx.fillRect(0,0,w,h);
    backCtx.globalCompositeOperation='source-over';
  }

  function undersideFor(left,bottom) {
    const key = (left?'L':'R')+(bottom?'B':'T');
    if (!left && !bottom) return backing;
    if (orientedBacks.has(key)) return orientedBacks.get(key);
    const oriented=document.createElement('canvas');
    oriented.width=backing.width;oriented.height=backing.height;
    const g=oriented.getContext('2d');
    g.setTransform(ratio,0,0,ratio,0,0);
    g.translate(left?w:0,bottom?h:0);
    g.scale(left?-1:1,bottom?-1:1);
    g.drawImage(backing,0,0,w,h);
    orientedBacks.set(key,oriented);
    return oriented;
  }

  function renderPeel(amount, which) {
    if (!img.complete || !img.naturalWidth) return;
    resizeBuffers();
    if (amount<=0.002) {
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,canvas.width,canvas.height);
      canvas.classList.remove('active');
      sticker.classList.remove('mesh-active');
      return;
    }
    const p=clamp(amount,0,1);
    const left=which.startsWith('left'), bottom=which.endsWith('bottom');
    const flipX=left?-1:1, flipY=bottom?-1:1;
    const backTexture=undersideFor(left,bottom);
    const ox=left?w:0, oy=bottom?h:0;
    const A=[w,0], B=[w-w*p,0], C=[w,h*p];
    const fold=clamp(.28 + p*.53,.3,.81); // Gradually turn the lifted corner over.
    const tip=[w-fold*p*w,fold*p*h];
    const lift=Math.min(14,w*.03)*p;
    const point=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
    const warp=(edge,t)=>{
      const s=t + .072*Math.sin(Math.PI*t);
      const pos=point(edge,tip,s);
      const bend=lift*Math.sin(Math.PI*t);
      return [pos[0]+bend*.58,pos[1]-bend*.64];
    };
    const g=ctx;
    g.setTransform(ratio,0,0,ratio,0,0);
    g.clearRect(0,0,w,h);
    g.drawImage(img,0,0,w,h);
    // Remove only the folded triangular piece of the front surface.
    g.save();g.translate(ox,oy);g.scale(flipX,flipY);
    g.globalCompositeOperation='destination-out';
    g.beginPath();g.moveTo(...B);g.lineTo(...A);g.lineTo(...C);g.closePath();
    g.fillStyle='#000';g.fill();g.restore();

    // The crease shade sits ON the sticker, not on the transparent page.
    g.save();g.translate(ox,oy);g.scale(flipX,flipY);
    g.globalCompositeOperation='source-atop';
    const crease=g.createLinearGradient(B[0]-10,B[1]+17,C[0]-10,C[1]+17);
    crease.addColorStop(0,'rgba(3,9,31,0)');crease.addColorStop(.55,'rgba(0,3,17,.34)');crease.addColorStop(1,'rgba(3,9,31,0)');
    g.shadowColor='rgba(1,5,18,.52)';g.shadowBlur=10+18*p;g.shadowOffsetX=-5*p;g.shadowOffsetY=7*p;
    g.strokeStyle=crease;g.lineWidth=3+8*p;
    g.beginPath();g.moveTo(...B);g.quadraticCurveTo(w-p*w*.16,h*p*.30,...C);g.stroke();
    g.restore();

    // Render the flexible back as an alpha-masked triangular mesh.
    const f=flapCtx;
    f.setTransform(ratio,0,0,ratio,0,0);f.clearRect(0,0,w,h);
    f.save();f.translate(ox,oy);f.scale(flipX,flipY);
    const bands=16;
    for (let i=0;i<bands;i++) {
      const t0=i/bands,t1=(i+1)/bands;
      const S0=point(B,A,t0),S1=point(C,A,t0);
      const S2=point(B,A,t1),S3=point(C,A,t1);
      const D0=warp(B,t0),D1=warp(C,t0),D2=warp(B,t1),D3=warp(C,t1);
      mapTriangle(f,backTexture,[S0,S1,S2],[D0,D1,D2]);
      mapTriangle(f,backTexture,[S1,S3,S2],[D1,D3,D2]);
    }
    // Subtle sheen that sweeps along the bend; only printed where substrate exists.
    f.globalCompositeOperation='source-atop';
    const shine=f.createLinearGradient(B[0],B[1],tip[0],tip[1]);
    shine.addColorStop(0,'rgba(9,14,27,.52)');
    shine.addColorStop(.20,'rgba(226,226,236,.20)');
    shine.addColorStop(.50,'rgba(255,255,255,.65)');
    shine.addColorStop(.80,'rgba(190,201,219,.23)');
    shine.addColorStop(1,'rgba(14,20,42,.17)');
    f.fillStyle=shine;f.fillRect(0,0,w,h);
    f.restore();

    // Cast shadow respects the actual alpha of the sticker silhouette.
    g.save();
    g.shadowColor='rgba(4,6,19,.70)';g.shadowBlur=6+22*p;
    g.shadowOffsetX=(left?-1:1)*(4+15*p);
    g.shadowOffsetY=(bottom?-1:1)*(5+15*p);
    g.drawImage(flap,0,0,w,h);
    g.restore();
    g.drawImage(flap,0,0,w,h);
    // The front image and peeled mesh are mutually exclusive, even for one frame.
    // A mesh frame contains the entire (partly folded) logo, not an overlay on it.
    canvas.classList.add('active');
    sticker.classList.add('mesh-active');
  }

  function paint(amount,which) {
    progress=amount;corner=which;
    if (paintFrame) return;
    paintFrame=requestAnimationFrame(()=>{paintFrame=0;renderPeel(progress,corner);});
  }
  function stopPeel() {
    cancelAnimationFrame(paintFrame);paintFrame=0;
    progress = 0;
    canvas.classList.remove('active');
    sticker.classList.remove('mesh-active');
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    sticker.classList.remove('peeling','peel-returning');
    sticker.style.removeProperty('--peel');
    sticker.style.removeProperty('--bend-x');
    sticker.style.removeProperty('--bend-y');
  }
  function safeHeroLeft(left, width) {
    const viewport=document.documentElement.clientWidth;
    if (viewport>850) return left;
    // Keep room for the 9° rotation: its corners extend beyond layout width.
    const spare=viewport-width;
    if (spare<=32) return window.scrollX+Math.max(0,spare/2);
    return clamp(left,window.scrollX+16,
      window.scrollX+spare-16);
  }
  function scrollAlongEdge() {
    if (!drag || !drag.detached) {scrollFrame=0;return;}
    const y=drag.clientY, edge=70;
    const v=y>innerHeight-edge?Math.min(15,(y-(innerHeight-edge))*.25):
      y<edge?-Math.min(15,(edge-y)*.25):0;
    if(v){window.scrollBy(0,v);sticker.style.top=(drag.clientY+scrollY-drag.grabY)+'px';}
    scrollFrame=requestAnimationFrame(scrollAlongEdge);
  }
  function setDetached(clientX,clientY) {
    if(detached) return;
    const ww=sticker.offsetWidth,hh=sticker.offsetHeight;
    const rect=sticker.getBoundingClientRect();
    const cx=Number.isFinite(clientX)?clientX:(rect.left+ww/2);
    const cy=Number.isFinite(clientY)?clientY:(rect.top+hh/2);
    // Prevent teleporting: keep the finger anchored at the exact gripped corner.
    // Stop drawing, restore the ONE flat logo before relocating it.
    stopPeel();
    sticker.dataset.adhesion='free';
    sticker.style.position='absolute';
    sticker.style.left=safeHeroLeft(cx-(drag?.grabX??ww*.5)+scrollX,ww)+'px';
    sticker.style.top=(cy-(drag?.grabY??hh*.5)+scrollY)+'px';
    sticker.style.setProperty('width',ww+'px','important');sticker.style.height=hh+'px';
    sticker.style.maxWidth='none';sticker.style.margin='0';
    sticker.style.zIndex='180';
    // Move into the body WITHOUT changing its visible screen coordinates.
    document.body.append(sticker);
    sticker.classList.add('detached','lifted');
    detached=true;restore.hidden=false;
    // The empty home MUST stay empty: no image, impression or ghost behind the sticker.
    clearTimeout(liftTimer);
    liftTimer=setTimeout(()=>sticker.classList.remove('lifted'),480);
  }
  function restoreHome() {
    motionToken++;
    clearTimeout(stickTimer);
    clearTimeout(liftTimer);
    stopPeel();
    sticker.classList.remove('detached','dragging','sticking','peeling','peel-returning','mesh-active','lifted');
    if(detached) home.append(sticker);
    sticker.removeAttribute('style');
    sticker.dataset.adhesion='stuck';
    restore.hidden=true;detached=false;drag=null;
    if(scrollFrame){cancelAnimationFrame(scrollFrame);scrollFrame=0;}
  }

  sticker.addEventListener('pointerdown', event=>{
    if(event.pointerType==='mouse'&&event.button!==0) return;
    // Discard any prior return-to-flat animation before a new peel starts.
    motionToken++;
    clearTimeout(stickTimer);
    clearTimeout(liftTimer);
    stopPeel();
    sticker.classList.remove('sticking','lifted');
    const bounds=sticker.getBoundingClientRect();
    // Transform rotates the hero logo; layout dimensions keep finger tracking stable.
    const gx=clamp(event.clientX-bounds.left,0,bounds.width);
    const gy=clamp(event.clientY-bounds.top,0,bounds.height);
    // Base tilt gives a slightly rotated bounding box, but closest corner is intuitive.
    const side=(gx>bounds.width/2?'right':'left')+'-'+(gy>bounds.height/2?'bottom':'top');
    lastSide=side;
    drag={id:event.pointerId,grabX:gx,grabY:gy,startX:event.clientX,startY:event.clientY,
      clientY:event.clientY,detached,corner:side,threshold:clamp(Math.min(bounds.width*.46,bounds.height*.72),110,265),
      lastX:event.clientX,lastY:event.clientY,hasMoved:false};
    sticker.dataset.corner=side;
    if(!detached){
      resizeBuffers();
      sticker.classList.add('peeling');
      sticker.style.setProperty('--peel','0');
    } else sticker.classList.add('dragging');
    event.preventDefault();
    try {sticker.setPointerCapture(event.pointerId);}catch(_){/* if detached DOM move causes capture release, use window listeners */}
  });
  const move=(event)=>{
    if(!drag||drag.id!==event.pointerId)return;
    drag.clientY=event.clientY;
    const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;
    const distance=Math.hypot(dx,dy);
    drag.lastX=event.clientX;drag.lastY=event.clientY;
    if(!drag.detached){
      const pull=reduceMotion?distance/45:distance/drag.threshold;
      // The seam grows from the dragged corner until a full diagonal half is peeled.
      const p=clamp(pull,0,1);
      sticker.style.setProperty('--peel',p.toFixed(3));
      sticker.style.setProperty('--bend-x',clamp(-dy*.055,-11,11)+'deg');
      sticker.style.setProperty('--bend-y',clamp(dx*.055,-12,12)+'deg');
      paint(p,drag.corner);
      if(distance<drag.threshold) return;
      setDetached(event.clientX,event.clientY);
      drag.detached=true;
      sticker.classList.add('dragging');
      if(!scrollFrame)scrollFrame=requestAnimationFrame(scrollAlongEdge);
    }
    drag.hasMoved=true;
    // Measuring grab position relative to the layout avoids page jumps on attachment.
    sticker.style.left=safeHeroLeft(event.pageX-drag.grabX,sticker.offsetWidth)+'px';
    sticker.style.top=(event.pageY-drag.grabY)+'px';
    sticker.style.setProperty('--sticker-rotate',clamp(dx*.027-9,-20,19)+'deg');
    sticker.style.setProperty('--sticker-lean',clamp(dy*.028,-9,9)+'deg');
  };
  const finish=(event)=>{
    if(!drag||drag.id!==event.pointerId)return;
    try{sticker.releasePointerCapture(event.pointerId);}catch(_){}
    const wasDetached=drag.detached;
    drag=null;
    if(scrollFrame){cancelAnimationFrame(scrollFrame);scrollFrame=0;}
    sticker.classList.remove('dragging');
    if(!wasDetached){
      // Let the paper flex back instead of snapping flat immediately.
      const p=progress;
      if(p>.03&&!reduceMotion){
        sticker.classList.add('peel-returning');
        const token=++motionToken;
        const started=performance.now(),duration=360;
        function rebound(now){
          if(token!==motionToken || drag || detached) return;
          const t=clamp((now-started)/duration,0,1);
          const ease=Math.pow(1-t,2)*(1+.15*Math.sin(t*Math.PI));
          paint(p*ease,lastSide);
          if(t<1)requestAnimationFrame(rebound);
          else stopPeel();
        }
        requestAnimationFrame(rebound);
      }else stopPeel();
      return;
    }
    stopPeel();
    sticker.dataset.adhesion='stuck';
    sticker.classList.remove('peeling','peel-returning','mesh-active','lifted');
    sticker.classList.add('sticking');
    sticker.style.setProperty('--sticker-rotate','-9deg');
    sticker.style.setProperty('--sticker-lean','0deg');
    // A short pressure ripple makes the surface look freshly attached.
    const r=sticker.getBoundingClientRect();
    const pulse=document.createElement('span');pulse.className='sticker-adhesion-pulse';
    pulse.style.left=(r.left+r.width/2+scrollX)+'px';
    pulse.style.top=(r.top+r.height/2+scrollY)+'px';
    document.body.append(pulse);
    clearTimeout(stickTimer);
    stickTimer=setTimeout(()=>{
      pulse.remove();
      sticker.classList.remove('sticking');
      // When pressing ends, only the original, flat image can be visible.
      stopPeel();
    },reduceMotion?0:770);
  };
  // Window listeners survive reparenting the sticker into document.body.
  window.addEventListener('pointermove',move,{passive:false});
  window.addEventListener('pointerup',finish);
  window.addEventListener('pointercancel',finish);
  restore.addEventListener('click',restoreHome);
  sticker.addEventListener('keydown',event=>{
    if(event.key==='Escape'){restoreHome();return;}
    const keys=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
    if(!keys.includes(event.key))return;
    event.preventDefault();
    if(!detached)setDetached();
    const delta=event.shiftKey?65:22;
    const x=event.key==='ArrowRight'?delta:event.key==='ArrowLeft'?-delta:0;
    const y=event.key==='ArrowDown'?delta:event.key==='ArrowUp'?-delta:0;
    sticker.style.left=(parseFloat(sticker.style.left)+x)+'px';
    sticker.style.top=(parseFloat(sticker.style.top)+y)+'px';
    sticker.classList.remove('sticking');void sticker.offsetWidth;
    sticker.classList.add('sticking');
    setTimeout(()=>sticker.classList.remove('sticking'),720);
  });
  img.addEventListener('load',()=>{if(drag&&!detached)paint(progress,corner);});
})();
