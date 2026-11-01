/* STIKAP Anywhere · every real DOM element can become a restickable sticker.
 * We MOVE the original nodes, rather than leaving interactive facsimiles behind.
 * A temporary visual ghost is used only while lifting the corner. No duplicate
 * is ever left in the page after lifting or pressing the sticker down.
 */
(() => {
  'use strict';
  const reset = document.getElementById('resetSticker');
  const heroSticker = document.getElementById('heroSticker');
  if (!reset) return;
  reset.textContent = '↶ ВЕРНУТЬ ВСЁ НАЗАД';
  reset.setAttribute('aria-label', 'Вернуть все отклеенные элементы на исходные места');
  document.body.append(reset); // One reset control, globally accessible from any section.

  const moved = new Map();
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const touchDelay = 380;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const selector = 'img,video,figure,article,blockquote,h1,h2,h3,h4,h5,h6,p,a,button,summary,li,label,output,input,textarea,select,canvas,span,strong,em,small,nav,section,footer,header,div,ul,ol';
  let pending = null;
  let lifting = null;
  let returnTimer = 0;
  let resetInProgress = false;
  let suppressClickUntil = 0;

  function refreshReset() {
    const logoMoved = !!heroSticker?.classList.contains('detached');
    reset.hidden = !logoMoved && moved.size === 0;
    reset.textContent = '↶ ВЕРНУТЬ ВСЁ НАЗАД';
  }
  if (heroSticker) {
    const logoObserver = new MutationObserver(refreshReset);
    logoObserver.observe(heroSticker, { attributes: true, attributeFilter: ['class'] });
  }

  function interactive(element) {
    return !!element.closest('input,textarea,select,option,[contenteditable=""],[contenteditable="true"],.cutout-board,canvas,[role="slider"]');
  }
  function chooseTarget(node, event) {
    if (!(node instanceof Element) || node.closest('.intro,.sprite,.stikap-peel-ghost,.stikap-peel-placeholder,.stikap-nopeel,#resetSticker,#heroSticker')) return null;
    if ((interactive(node) || node.closest('#previewStage')) && !event.altKey) return null;
    // Moving the full editor by its title/background retains its exact live state.
    const builder = node.closest('#builder');
    if (builder && !event.shiftKey && !event.altKey) return builder;
    // Holding Shift chooses a larger piece: card, section or group.
    if (event.shiftKey) {
      const group = node.closest('#builder,.benefit-card,.gallery-card,.about-photos,.hero-text,.reviews-layout,.faq-list,section,footer,.site-header');
      if (group) return group;
    }
    const nearestControl = node.closest('button,a,summary');
    if (nearestControl && !nearestControl.closest('#heroSticker')) return nearestControl;
    const nearest = node.closest(selector);
    if (!nearest || ['HTML', 'BODY', 'MAIN'].includes(nearest.tagName)) return null;
    // A long touch on the empty page must never peel a full-width layout
    // container. That used to leave a cream strip on the right and shift the
    // document after someone merely tried to scroll. Actual content remains
    // individually peelable; the whole working editor is handled above.
    if (event.pointerType === 'touch' && nearest.matches(
      'section,header,footer,nav,ul,ol,.hero-main,.hero-visual,.hero-text,.hero-social-line,' +
      '.hero-cta-group,.ticker,.ticker-track,.about-grid,.about-copy,.benefits-top,' +
      '.constructor-heading,.constructor-title-row,.builder-preview-area,' +
      '.builder-controls,.footer-middle,.footer-bottom,.site-header'
    )) return null;
    // Select a whole visible chip/label rather than an empty icon or text fragment.
    if (nearest.tagName === 'SPAN' && nearest.closest('h1,h2,h3,h4,h5,h6,p,button,a,figure')) {
      return nearest.closest('h1,h2,h3,h4,h5,h6,p,button,a,figure');
    }
    if (nearest.tagName === 'DIV' && !nearest.getBoundingClientRect().width) return null;
    return nearest;
  }

  function dropPendingTimer() {
    if (pending?.holdTimer) clearTimeout(pending.holdTimer);
  }

  function ghostFor(item) {
    const ghost = document.createElement('div');
    ghost.className = 'stikap-peel-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    const face = document.createElement('div');
    face.className = 'stikap-peel-face';
    const clone = item.node.cloneNode(true);
    clone.classList.remove('stikap-source-hidden','stikap-detached','stikap-resticking','stikap-is-moving');
    clone.removeAttribute('aria-describedby');
    clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    clone.removeAttribute('id');
    clone.querySelectorAll('input,textarea,select').forEach((input) => input.setAttribute('tabindex', '-1'));
    clone.style.setProperty('width',item.rect.width+'px','important');
    clone.style.setProperty('height',item.rect.height+'px','important');
    clone.style.setProperty('margin','0','important');
    clone.style.setProperty('position','relative','important');
    clone.style.setProperty('max-width','none','important');
    clone.style.setProperty('transform','none','important');
    // Cloned <canvas> elements are blank by default. Copy their actual current pixels.
    const sourceCanvases = item.node.querySelectorAll('canvas');
    const clonedCanvases = clone.querySelectorAll('canvas');
    sourceCanvases.forEach((source, i) => {
      const destination = clonedCanvases[i];
      if (!destination) return;
      destination.width=source.width;
      destination.height=source.height;
      try { destination.getContext('2d')?.drawImage(source, 0, 0); } catch (_) {}
    });
    face.append(clone);
    const bend = document.createElement('div');
    bend.className='stikap-peel-back';
    const seam = document.createElement('div');
    seam.className='stikap-peel-seam';
    ghost.append(face,bend,seam);
    ghost.style.left=item.rect.left+'px';
    ghost.style.top=item.rect.top+'px';
    ghost.style.width=item.rect.width+'px';
    ghost.style.height=item.rect.height+'px';
    document.body.append(ghost);
    return { ghost, face, bend, seam };
  }

  function foldVisual(item, value, animate=false) {
    const p=clamp(value,0,1), w=item.rect.width, h=item.rect.height;
    const x=w*clamp(p*.70,0,.70), y=h*clamp(p*.78,0,.78);
    const left=item.corner.startsWith('left'), bottom=item.corner.endsWith('bottom');
    let polygon, tipX,tipY,creaseAngle;
    if (!left && !bottom) { // top right
      polygon=`polygon(0 0,calc(100% - ${x}px) 0,100% ${y}px,100% 100%,0 100%)`;
      tipX=w-x*.62;tipY=y*.56;creaseAngle=-42;
      item.visual.bend.style.clipPath=`polygon(${w-x}px 0,${w}px ${y}px,${tipX}px ${tipY}px)`;
      item.visual.seam.style.left=(w-x*.58)+'px';item.visual.seam.style.top=(y*.25)+'px';
    } else if (left && !bottom) { // top left
      polygon=`polygon(${x}px 0,100% 0,100% 100%,0 100%,0 ${y}px)`;
      tipX=x*.62;tipY=y*.56;creaseAngle=42;
      item.visual.bend.style.clipPath=`polygon(${x}px 0,0 ${y}px,${tipX}px ${tipY}px)`;
      item.visual.seam.style.left=(x*.2)+'px';item.visual.seam.style.top=(y*.25)+'px';
    } else if (!left && bottom) { // bottom right
      polygon=`polygon(0 0,100% 0,100% calc(100% - ${y}px),calc(100% - ${x}px) 100%,0 100%)`;
      tipX=w-x*.62;tipY=h-y*.56;creaseAngle=42;
      item.visual.bend.style.clipPath=`polygon(${w}px ${h-y}px,${w-x}px ${h}px,${tipX}px ${tipY}px)`;
      item.visual.seam.style.left=(w-x*.58)+'px';item.visual.seam.style.top=(h-y*.25)+'px';
    } else { // bottom left
      polygon=`polygon(0 0,100% 0,100% 100%,${x}px 100%,0 calc(100% - ${y}px))`;
      tipX=x*.62;tipY=h-y*.56;creaseAngle=-42;
      item.visual.bend.style.clipPath=`polygon(0 ${h-y}px,${x}px ${h}px,${tipX}px ${tipY}px)`;
      item.visual.seam.style.left=(x*.2)+'px';item.visual.seam.style.top=(h-y*.25)+'px';
    }
    item.visual.ghost.classList.toggle('is-releasing',animate);
    item.visual.face.style.clipPath=polygon;
    item.visual.bend.style.opacity=String(clamp(p*1.5,0,1));
    item.visual.bend.style.filter=`drop-shadow(0 ${p*9}px ${p*13}px rgba(4,6,17,.50))`;
    item.visual.seam.style.opacity=String(p*.7);
    item.visual.seam.style.transform=`translate(-50%,-50%) rotate(${creaseAngle}deg) scaleY(${1+p})`;
    item.visual.ghost.style.filter=`drop-shadow(0 ${p*9}px ${4+p*14}px rgba(0,0,0,.35))`;
  }

  function lift(item) {
    if (pending!==item || item.started) return;
    item.started=true;
    item.visual=ghostFor(item);
    // Only one visible representation at any given time: hide the source while
    // the short-lived peeling visualization replaces it, never over it.
    item.node.classList.add('stikap-source-hidden');
    foldVisual(item,0);
    lifting=item;
    document.body.classList.add('stikap-peel-running');
    try { window.getSelection()?.removeAllRanges(); } catch (_) {}
  }

  function placeholderFor(item) {
    const p = document.createElement(item.inline?'span':'div');
    p.className='stikap-peel-placeholder';
    p.setAttribute('aria-hidden','true');
    p.style.width=item.rect.width+'px';p.style.height=item.rect.height+'px';
    p.style.display=item.inline?'inline-block':item.computed.display;
    p.style.margin=item.computed.margin;
    p.style.flex=item.computed.flex;
    p.style.gridArea=item.computed.gridArea;
    p.style.alignSelf=item.computed.alignSelf;
    p.style.justifySelf=item.computed.justifySelf;
    p.style.verticalAlign=item.computed.verticalAlign;
    if (item.computed.position==='absolute' || item.computed.position==='fixed') {
      // Out-of-flow originals should leave no visible ghost or phantom box.
      p.style.display='none';
    }
    return p;
  }

  // Detached elements are absolute in document coordinates, but must not
  // expand the mobile page or force horizontal scrolling while dragging.
  function safePageLeft(desired, width) {
    const viewport = document.documentElement.clientWidth;
    if (viewport > 850) return desired;
    if (width >= viewport - 12) return window.scrollX;
    return clamp(desired, window.scrollX + 6,
      window.scrollX + Math.max(6, viewport - width - 6));
  }

  function detach(item, event) {
    if (item.detached) return;
    const node=item.node;
    const existing=moved.get(node);
    if(!existing) {
      item.placeholder=placeholderFor(item);
      node.before(item.placeholder);
      moved.set(node, {placeholder:item.placeholder, oldStyle:item.oldStyle});
    }
    item.visual?.ghost.remove();item.visual=null;
    node.classList.remove('stikap-source-hidden');
    const bounds=item.rect;
    document.body.append(node);
    node.style.setProperty('position','absolute','important');
    node.style.setProperty('left',safePageLeft(event.pageX-item.grabX,bounds.width)+'px','important');
    node.style.setProperty('top',(event.pageY-item.grabY)+'px','important');
    node.style.setProperty('width',bounds.width+'px','important');
    node.style.setProperty('height',bounds.height+'px','important');
    node.style.setProperty('max-width','none','important');
    node.style.setProperty('min-width','0','important');
    node.style.setProperty('margin','0','important');
    node.style.setProperty('z-index','210','important');
    node.style.setProperty('transform','none','important');
    node.classList.add('stikap-detached','stikap-is-moving');
    item.detached=true;
    item.dragged=true;
    refreshReset();
  }

  function moveFloating(item, event) {
    const node=item.node;
    node.style.left=safePageLeft(event.pageX-item.grabX,item.rect.width)+'px';
    node.style.top=(event.pageY-item.grabY)+'px';
    const tilt=clamp((event.clientX-item.startX)*.023,-9,9);
    node.style.setProperty('--stikap-tilt',tilt+'deg');
  }

  function finishGesture(event, cancel=false) {
    const item=pending;
    if (!item || (event && event.pointerId!==item.pointerId)) return;
    if (item.holdTimer) clearTimeout(item.holdTimer);
    pending=null;
    lifting=null;
    document.body.classList.remove('stikap-peel-running');
    if (item.detached) {
      // A normal click on an already attached floating editor must still work.
      if (!item.dragged) return;
      suppressClickUntil = performance.now()+450;
      item.node.classList.remove('stikap-is-moving');
      item.node.classList.add('stikap-resticking');
      item.node.style.removeProperty('--stikap-tilt');
      setTimeout(()=>item.node.classList.remove('stikap-resticking'),media.matches?0:480);
      refreshReset();
      return;
    }
    if (item.started && item.visual) {
      suppressClickUntil = performance.now()+450;
      foldVisual(item,0,!media.matches);
      const saved=item.visual;
      const done=()=>{
        saved.ghost.remove();
        item.node.classList.remove('stikap-source-hidden');
      };
      if(media.matches) done();
      else setTimeout(done,270);
    }
  }

  function resetAll() {
    resetInProgress=true;
    if (pending) finishGesture(null,true);
    // Restore in reverse detach order to support dragging a child and its parent.
    for (const [node,info] of [...moved.entries()].reverse()) {
      node.classList.remove('stikap-detached','stikap-is-moving','stikap-resticking','stikap-source-hidden');
      if (info.placeholder.isConnected) info.placeholder.replaceWith(node);
      if (info.oldStyle === null) node.removeAttribute('style');
      else node.setAttribute('style',info.oldStyle);
      info.placeholder.remove();
    }
    moved.clear();
    resetInProgress=false;
    // Also recover from any old browser viewport offset without jumping vertically.
    if (window.scrollX) window.scrollTo({left:0,top:window.scrollY,behavior:'instant'});
    // The logo's original engine also listens to this one button and restores it.
    queueMicrotask(refreshReset);
  }

  document.addEventListener('click', (event)=>{
    if(performance.now()<suppressClickUntil && !event.target.closest('#resetSticker')) {
      event.preventDefault();event.stopImmediatePropagation();
    }
  },true);

  // Reset is the ONLY site-wide restoration button.
  reset.addEventListener('click', resetAll);

  document.addEventListener('pointerdown',(event)=>{
    if (event.defaultPrevented || event.button!==0 || pending || resetInProgress) return;
    if (event.target.closest('#heroSticker')) return; // keep the tailored 3D canvas peel for the brand logo
    const node=chooseTarget(event.target,event);
    if (!node) return;
    const rect=node.getBoundingClientRect();
    if (rect.width<4 || rect.height<4) return;
    const rePeel=moved.get(node);
    const style=getComputedStyle(node);
    const gx=clamp(event.clientX-rect.left,0,rect.width);
    const gy=clamp(event.clientY-rect.top,0,rect.height);
    const corner=(gx>rect.width*.5?'right':'left')+'-'+(gy>rect.height*.5?'bottom':'top');
    const item={node, pointerId:event.pointerId, startX:event.clientX,startY:event.clientY,
      grabX:gx,grabY:gy,corner,rect,computed:style,oldStyle:rePeel?.oldStyle??node.getAttribute('style'),
      inline:style.display==='inline', detached:!!rePeel, dragged:false, started:false, visual:null,
      threshold:clamp(Math.min(rect.width*.38,rect.height*.60),58,180),holdTimer:0};
    pending=item;
    if (event.pointerType==='touch') {
      item.holdTimer=setTimeout(()=>{
        if(pending!==item) return;
        if(navigator.vibrate) navigator.vibrate(14);
        if(item.detached) {item.node.classList.add('stikap-is-moving');lifting=item;}
        else lift(item);
      },touchDelay);
    }
  },{passive:true});

  document.addEventListener('pointermove',(event)=>{
    const item=pending;
    if (!item || event.pointerId!==item.pointerId) return;
    const distance=Math.hypot(event.clientX-item.startX,event.clientY-item.startY);
    // Until touch hold is complete, the gesture is native scrolling, not peeling.
    if (event.pointerType==='touch' && !lifting) {
      if (distance>12) {dropPendingTimer();pending=null;}
      return;
    }
    if(!item.started && !item.detached && distance>12) lift(item);
    if(!item.started && !item.detached) return;
    if (event.cancelable) event.preventDefault();
    if(!item.detached) {
      foldVisual(item,distance/item.threshold);
      if(distance>=item.threshold) detach(item,event);
    }
    if(item.detached) {
      if (!item.dragged && distance<12) return;
      item.dragged=true;
      item.node.classList.add('stikap-is-moving');
      moveFloating(item,event);
    }
  },{passive:false});

  window.addEventListener('pointerup',(event)=>finishGesture(event));
  window.addEventListener('pointercancel',(event)=>finishGesture(event,true));
  document.addEventListener('touchmove',(event)=>{
    if(lifting && event.cancelable) event.preventDefault();
  },{passive:false});
  window.addEventListener('keydown',(event)=>{
    if(event.key==='Escape' && pending) {event.preventDefault();finishGesture(null,true);}
    // Keyboard alternative for most visible, focused text/actions: Alt+Shift+arrows.
    if(!(event.altKey&&event.shiftKey) || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    const node=chooseTarget(document.activeElement,{shiftKey:false});
    if (!node || node===heroSticker) return;
    event.preventDefault();
    if(!moved.has(node)) {
      const r=node.getBoundingClientRect(),s=getComputedStyle(node);
      const item={node,rect:r,grabX:r.width/2,grabY:r.height/2,
        oldStyle:node.getAttribute('style'),computed:s,inline:s.display==='inline',
        detached:false,visual:null};
      item.placeholder=placeholderFor(item);
      node.before(item.placeholder);
      moved.set(node,{placeholder:item.placeholder,oldStyle:item.oldStyle});
      document.body.append(node);
      node.style.cssText+=';position:absolute!important;left:'+ (r.left+scrollX)+'px!important;top:'+(r.top+scrollY)+'px!important;width:'+r.width+'px!important;height:'+r.height+'px!important;margin:0!important;max-width:none!important;z-index:210!important;transform:none!important';
      node.classList.add('stikap-detached');
    }
    const by=event.key==='ArrowDown'?24:event.key==='ArrowUp'?-24:0;
    const bx=event.key==='ArrowRight'?24:event.key==='ArrowLeft'?-24:0;
    node.style.left=(parseFloat(node.style.left)+bx)+'px';
    node.style.top=(parseFloat(node.style.top)+by)+'px';
    refreshReset();
  });
  window.StikapAnywhere={ restoreAll:resetAll, get movedCount(){return moved.size;} };
  refreshReset();
})();
