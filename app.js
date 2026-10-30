/* Stikap — dependency-free client-side interactions. */
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const formatMoney = (n) => new Intl.NumberFormat('ru-RU').format(n);
  const telegramManager = 'https://t.me/Glivcharsky';
  let toastTimeout;

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => el.classList.remove('visible'), 4600);
  }

  // All written mentions use a consistent coral, ink-outlined brand treatment.
  // Header and footer use the exact supplied logo artwork.
  const textWalker = document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{
    acceptNode(node) {
      if (!/stikap/i.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
      if (node.parentElement.closest('script,style,svg,textarea,button.brand-ignore,.brand-word')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const brandNodes=[];while(textWalker.nextNode())brandNodes.push(textWalker.currentNode);
  for(const node of brandNodes) {
    const pieces=node.nodeValue.split(/(stikap)/gi);
    if(pieces.length<2)continue;
    const frag=document.createDocumentFragment();
    for (const piece of pieces) {
      if (/^stikap$/i.test(piece)) {
        const brand=document.createElement('span');brand.className='brand-word';brand.textContent='Stikap';frag.append(brand);
      } else frag.append(document.createTextNode(piece));
    }
    node.replaceWith(frag);
  }

  // INTRO: A sheet of sticker backing paper peels away at first visit per tab.
  const intro = $('#intro');
  const skipIntro = $('#introSkip');
  let introDone = false;
  const finishIntro = () => {
    if (introDone) return;
    introDone = true;
    intro.classList.add('is-leaving');
    try { sessionStorage.setItem('stikap-intro-seen', '1'); } catch (_) { /* storage disabled */ }
    window.setTimeout(() => { intro.classList.add('gone'); intro.remove(); }, reduceMotion ? 0 : 1350);
  };
  let seenIntro = false;
  try { seenIntro = sessionStorage.getItem('stikap-intro-seen') === '1'; } catch (_) { /* storage disabled */ }
  if (reduceMotion || seenIntro) {
    intro.remove();
  } else {
    skipIntro.addEventListener('click', finishIntro);
    intro.addEventListener('click', (event) => {
      if (event.target.closest('.intro-paper')) finishIntro();
    });
    window.setTimeout(finishIntro, 1750);
  }

  const header = $('#siteHeader');
  const setHeader = () => header.classList.toggle('scrolled', window.scrollY > 45);
  setHeader();
  window.addEventListener('scroll', setHeader, { passive: true });

  const menuToggle = $('#menuToggle');
  const menu = $('#primaryNav');
  const closeMenu = () => {
    menu.classList.remove('open');
    menuToggle.classList.remove('is-open');
    menuToggle.setAttribute('aria-expanded', 'false');
  };
  menuToggle.addEventListener('click', () => {
    const isOpen = menu.classList.toggle('open');
    menuToggle.classList.toggle('is-open', isOpen);
    menuToggle.setAttribute('aria-expanded', String(isOpen));
  });
  $$('#primaryNav a').forEach((link) => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  // Animate actual sections as the user reaches them.
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -25px 0px' });
    $$('[data-reveal]').forEach((node) => observer.observe(node));
  } else {
    $$('[data-reveal]').forEach((node) => node.classList.add('revealed'));
  }

  $('#footerYear').textContent = String(new Date().getFullYear());

  // Peel/drag/restick engine lives in peel-physics.js (canvas mesh + touch support).

  // BUILDER. Price is calculated from bounding rectangle area, not irregular contour.
  const widthRange = $('#widthRange');
  const heightRange = $('#heightRange');
  const zoomRange = $('#zoomRange');
  const previewStage = $('#previewStage');
  const previewObject = $('#previewObject');
  const previewImage = $('#previewImage');
  const showOutline = $('#showOutline');
  const uploadZone = $('#uploadZone');
  const fileInput = $('#fileInput');
  let selectedFile = null;
  let sourceCanvas = null;
  let outputCanvas = null;
  let processingID = 0;
  let angleX = -12;
  let angleY = -16;
  let angleZ = 4;
  let zoom = 100;

  function updateSliderLook(input) {
    const percent = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
    input.style.setProperty('--progress', `${percent}%`);
  }

  function updatePrice() {
    const width = Number(widthRange.value);
    const height = Number(heightRange.value);
    const area = width * height;
    $('#widthOutput').textContent = `${width} см`;
    $('#heightOutput').textContent = `${height} см`;
    $('#previewSize').textContent = `${width} × ${height} CM`;
    $('#priceTotal').textContent = `${formatMoney(area * 30)} ₽`;
    $('#priceFormula').textContent = `${width} × ${height} = ${area} см² · 30 ₽ / см²`;
    [widthRange, heightRange].forEach(updateSliderLook);
    $$('.size-preset').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.width) === width && Number(button.dataset.height) === height);
    });
  }
  [widthRange, heightRange].forEach((input) => input.addEventListener('input', updatePrice));
  $$('.size-preset').forEach((button) => button.addEventListener('click', () => {
    widthRange.value = button.dataset.width;
    heightRange.value = button.dataset.height;
    updatePrice();
  }));
  updatePrice();

  // 3D: live transform, touch/mouse drag, zoom slider & mouse wheel.
  const rotateView = () => {
    previewObject.style.setProperty('--rx', `${angleX}deg`);
    previewObject.style.setProperty('--ry', `${angleY}deg`);
    previewObject.style.setProperty('--rz', `${angleZ}deg`);
    previewObject.style.setProperty('--scale', `${zoom / 100}`);
    zoomRange.value = String(zoom);
    $('#zoomOutput').textContent = `${zoom}%`;
    updateSliderLook(zoomRange);
  };
  let viewDrag = null;
  previewStage.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    viewDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    previewStage.setPointerCapture(event.pointerId);
    previewStage.classList.add('dragging');
  });
  previewStage.addEventListener('pointermove', (event) => {
    if (!viewDrag || event.pointerId !== viewDrag.pointerId) return;
    angleY = clamp(angleY + (event.clientX - viewDrag.x) * .55, -80, 80);
    angleX = clamp(angleX - (event.clientY - viewDrag.y) * .52, -75, 75);
    viewDrag.x = event.clientX;
    viewDrag.y = event.clientY;
    rotateView();
  });
  function finishViewDrag() { viewDrag = null; previewStage.classList.remove('dragging'); }
  previewStage.addEventListener('pointerup', finishViewDrag);
  previewStage.addEventListener('pointercancel', finishViewDrag);
  previewStage.addEventListener('lostpointercapture', finishViewDrag);
  previewStage.addEventListener('dblclick', () => { resetView(); });
  previewStage.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoom = clamp(zoom + (event.deltaY < 0 ? 5 : -5), 65, 160);
    rotateView();
  }, { passive: false });
  function resetView() { angleX = -12; angleY = -16; angleZ = 4; zoom = 100; rotateView(); }
  $('#resetRotation').addEventListener('click', resetView);
  $('#rotateLeft').addEventListener('click', () => { angleZ -= 15; rotateView(); });
  $('#rotateRight').addEventListener('click', () => { angleZ += 15; rotateView(); });
  zoomRange.addEventListener('input', () => { zoom = Number(zoomRange.value); rotateView(); });
  rotateView();
  showOutline.addEventListener('change', () => previewObject.classList.toggle('no-outline', !showOutline.checked));

  // File upload, clipboard paste and drag-and-drop.
  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) loadFile(fileInput.files[0]);
  });
  ['dragenter', 'dragover'].forEach((name) => uploadZone.addEventListener(name, (event) => {
    event.preventDefault(); uploadZone.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((name) => uploadZone.addEventListener(name, (event) => {
    event.preventDefault(); uploadZone.classList.remove('is-over');
  }));
  uploadZone.addEventListener('drop', (event) => {
    const files = Array.from(event.dataTransfer?.files || []);
    if (files[0]) loadFile(files[0]);
  });
  document.addEventListener('paste', (event) => {
    // Don't intercept paste inside text-entry elements, if any are added later.
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) return;
    const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.type.startsWith('image/'));
    if (item) {
      const file = item.getAsFile();
      if (file) { event.preventDefault(); loadFile(file); }
    }
  });

  const openImageFile = (file) => new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Невозможно прочитать картинку')); };
    image.src = objectUrl;
  });

  function imageToCanvas(image) {
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const fraction = Math.min(1, 1100 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * fraction));
    canvas.height = Math.max(1, Math.round(sourceHeight * fraction));
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function loadFile(file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast('Нужен файл PNG, JPG или WEBP.'); return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast('Файл слишком большой. Максимальный размер — 12 МБ.'); return;
    }
    const run = ++processingID;
    $('#fileName').textContent = 'Обрабатываем изображение…';
    try {
      const image = await openImageFile(file);
      if (run !== processingID) return;
      const canvas = imageToCanvas(image);
      sourceCanvas = canvas;
      selectedFile = file;
      $('#fileName').textContent = file.name;
      $('#resetImage').hidden = false;
      $('#uploadHeading').textContent = 'ЗАМЕНИТЬ КАРТИНКУ';
      outputCanvas = null;
      previewImage.src = canvas.toDataURL('image/png');
      enterCutEditor();
    } catch (error) {
      $('#fileName').textContent = 'Сейчас в превью: стикер Stikap';
      toast('Не получилось открыть файл. Попробуй другое изображение.');
    }
  }

  // Cut out a uniform background connected to the image borders. The code
  // deliberately does not claim to perform AI person/object segmentation.
  function clearUniformBorderBackground(canvas) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const cornerIndexes = [0, w - 1, (h - 1) * w, h * w - 1];
    const corners = cornerIndexes.map((pixel) => [data[pixel * 4], data[pixel * 4 + 1], data[pixel * 4 + 2]]);
    const distSq = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    const pairDistances = corners.flatMap((c, i) => corners.slice(i + 1).map((d) => Math.sqrt(distSq(c, d))));
    const spread = Math.max(...pairDistances);
    // On complex photos different corners represent different objects:
    // doing nothing is safer than cutting away someone's hair or clothes.
    if (spread > 85) return { changed: false, reason: 'complex' };

    const thresholdSq = 53 * 53;
    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0, removed = 0;
    const matches = (index) => {
      const i = index * 4;
      if (data[i + 3] === 0) return true;
      for (const corner of corners) {
        const d0 = data[i] - corner[0], d1 = data[i + 1] - corner[1], d2 = data[i + 2] - corner[2];
        if (d0 * d0 + d1 * d1 + d2 * d2 < thresholdSq) return true;
      }
      return false;
    };
    const enqueue = (index) => {
      if (!visited[index] && matches(index)) { visited[index] = 1; queue[tail++] = index; }
    };
    for (let x = 0; x < w; x++) { enqueue(x); enqueue((h - 1) * w + x); }
    for (let y = 1; y < h - 1; y++) { enqueue(y * w); enqueue(y * w + w - 1); }
    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % w, y = Math.floor(pixel / w);
      const alphaIndex = pixel * 4 + 3;
      if (data[alphaIndex]) { data[alphaIndex] = 0; removed++; }
      if (x > 0) enqueue(pixel - 1);
      if (x + 1 < w) enqueue(pixel + 1);
      if (y > 0) enqueue(pixel - w);
      if (y + 1 < h) enqueue(pixel + w);
    }
    if (removed < w * h * .018) return { changed: false, reason: 'nothing' };
    // Soften pixels immediately inside the cut edge to avoid visible color fringe.
    // A copy of the visited mask is required for correct neighbor checks.
    const clearMask = visited;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const index = y * w + x;
      if (clearMask[index]) continue;
      const touch = clearMask[index - 1] + clearMask[index + 1] + clearMask[index - w] + clearMask[index + w];
      if (touch > 0) data[index * 4 + 3] = Math.round(data[index * 4 + 3] * (touch > 2 ? .5 : .78));
    }
    ctx.putImageData(imageData, 0, 0);
    return { changed: true };
  }

  function cropTransparentPadding(canvas) {
    const w = canvas.width, h = canvas.height;
    const alpha = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (alpha[(y * w + x) * 4 + 3] < 20) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxX < minX) return canvas;
    const pad = 12;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w, maxX + pad + 1); maxY = Math.min(h, maxY + pad + 1);
    if (minX === 0 && minY === 0 && maxX === w && maxY === h) return canvas;
    const cropped = document.createElement('canvas');
    cropped.width = maxX - minX; cropped.height = maxY - minY;
    cropped.getContext('2d').drawImage(canvas, minX, minY, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    return cropped;
  }

  // CUTOUT STUDIO V3: local portrait AI + reusable alpha mask with brush correction.
  const cutoutEditor = $('#cutoutEditor');
  const cutoutResult = $('#cutoutResult');
  const cutCanvas = $('#cutoutCanvas');
  const cutCtx = cutCanvas.getContext('2d');
  const cutBusy = $('#cutoutBusy');
  const cutApply = $('#cutApply');
  const cutGuide = $('#cutoutGuide');
  const cutModes = $$('.cut-mode');
  const cutBrushTools = $('#cutBrushTools');
  const cutBrushCursor = $('#cutBrushCursor');
  const cutRefineMode = $('#cutRefineMode');
  const cutUndo = $('#cutUndo');
  const cutRedo = $('#cutRedo');
  const cutClear = $('#cutClear');
  const brushSize = $('#brushSize');
  const maskCanvas = document.createElement('canvas');
  const maskCtx = maskCanvas.getContext('2d', {willReadFrequently: true});
  const overlayCanvas = document.createElement('canvas');
  const overlayCtx = overlayCanvas.getContext('2d');
  let cutMode = 'person';
  let cutPoints = [];
  let freeDrawing = false;
  let movedPoint = -1;
  let cutReady = false;
  let hasMask = false;
  let brushAction = 'add';
  let brushPainting = false;
  let brushLast = null;
  let showMaskPreview = false;
  let maskBase = null;
  let maskUndo = [];
  let maskRedo = [];
  let aiRequestID = 0;
  let segmenterPromise = null;
  let activeSegmenter = null;

  function setMaskSize(width,height) {
    maskCanvas.width=overlayCanvas.width=width;
    maskCanvas.height=overlayCanvas.height=height;
    maskCtx.clearRect(0,0,width,height);
  }
  function snapshotMask() {
    const pixels=maskCtx.getImageData(0,0,maskCanvas.width,maskCanvas.height).data;
    const alpha=new Uint8Array(maskCanvas.width*maskCanvas.height);
    for(let p=0;p<alpha.length;p++)alpha[p]=pixels[p*4+3];
    return alpha;
  }
  function restoreMask(alpha) {
    if(!alpha)return;
    const data=maskCtx.createImageData(maskCanvas.width,maskCanvas.height);
    for(let p=0;p<alpha.length;p++) {
      const i=p*4;data.data[i]=data.data[i+1]=data.data[i+2]=255;data.data[i+3]=alpha[p];
    }
    maskCtx.putImageData(data,0,0);
  }
  function recordMask() {
    maskUndo.push(snapshotMask());
    if(maskUndo.length>12)maskUndo.shift();
    maskRedo=[];
    updateHistoryButtons();
  }
  function updateHistoryButtons() {
    cutUndo.disabled = cutMode==='refine'?maskUndo.length===0:(cutMode==='points'||cutMode==='free'?cutPoints.length===0:true);
    cutRedo.disabled = cutMode!=='refine' || maskRedo.length===0;
  }
  function activateMask(mask, label) {
    if(!sourceCanvas)return;
    setMaskSize(sourceCanvas.width,sourceCanvas.height);
    maskCtx.drawImage(mask,0,0);
    const alpha=snapshotMask();
    if(alpha.reduce((sum,v,index)=>sum+(index%17===0&&v>128?1:0),0)<sourceCanvas.width*sourceCanvas.height/17*.005) {
      toast('Не удалось получить контур. Попробуй другой способ.');return;
    }
    hasMask=true;maskBase=alpha;maskUndo=[];maskRedo=[];
    cutRefineMode.hidden=false;
    setCutMode('refine');
    cutGuide.textContent=`${label}. Подправь края кистью или нажми «ГОТОВО» — получишь стикер с прозрачным фоном.`;
    toast('Контур найден! Если надо, дорисуй или сотри лишнее.');
  }
  function enterCutEditor() {
    if (!sourceCanvas) return;
    aiRequestID++;
    cutoutEditor.hidden=false;
    cutoutResult.hidden=true;
    cutReady=false;hasMask=false;maskBase=null;maskUndo=[];maskRedo=[];
    cutPoints=[];showMaskPreview=false;
    cutRefineMode.hidden=true;
    cutCanvas.width=sourceCanvas.width;cutCanvas.height=sourceCanvas.height;
    setMaskSize(sourceCanvas.width,sourceCanvas.height);
    setCutMode('person');
    $('#processingHint').textContent='ИИ попробует выделить человека автоматически. Поправь результат кистью и нажми «Готово».';
    if(cutoutEditor.getBoundingClientRect().bottom>innerHeight){
      cutoutEditor.scrollIntoView({behavior:reduceMotion?'instant':'smooth',block:'center'});
    }
    // Start the local portrait model automatically after the upload settles.
    const uploadID=processingID;
    requestAnimationFrame(()=>{
      if(sourceCanvas&&processingID===uploadID&&cutMode==='person')runPersonAI();
    });
  }
  function setCutMode(mode) {
    if(mode==='refine'&&!hasMask)return;
    ++aiRequestID;cutBusy.hidden=true;
    cutMode=mode;
    cutPoints=[];freeDrawing=false;brushPainting=false;showMaskPreview=false;
    cutBrushCursor.hidden=true;
    cutBrushTools.hidden=mode!=='refine';
    cutCanvas.classList.toggle('is-refining',mode==='refine');
    cutModes.forEach(button=>{
      const active=button.dataset.cutmode===mode;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
    });
    const descriptions={
      person:'ИИ автоматически вырежет человека. Для других объектов выбери точки, рисунок от руки или простой фон.',
      refine:'Оранжевым показано, что удалится. Кистью «Вернуть» добавляй участки, «Стереть» убирай лишнее.',
      points:'Ставь точки по краю объекта. Перемещай их пальцем или мышью, затем нажми «ПО СИЛУЭТУ».',
      free:'Обведи объект одним движением. После этого можно будет поправить край кистью.',
      background:'Подходит только для ровного однотонного фона. Сложный фон лучше вырезать ИИ или по точкам.'
    };
    cutGuide.textContent=descriptions[mode];
    cutApply.textContent=({person:'✦ ВЫДЕЛИТЬ ЧЕЛОВЕКА',refine:'✓ ГОТОВО — СОЗДАТЬ СТИКЕР',points:'ВЫРЕЗАТЬ ПО ТОЧКАМ',free:'ВЫРЕЗАТЬ ПО КОНТУРУ',background:'УБРАТЬ ФОН'})[mode];
    cutClear.textContent=mode==='refine'?'СБРОСИТЬ ПРАВКИ':'СБРОСИТЬ КОНТУР';
    updateHistoryButtons();renderCutEditor();
  }
  cutModes.forEach(button=>button.addEventListener('click',()=>setCutMode(button.dataset.cutmode)));
  function editorPoint(event) {
    const rect=cutCanvas.getBoundingClientRect();
    return {x:clamp((event.clientX-rect.left)*cutCanvas.width/rect.width,0,cutCanvas.width),
      y:clamp((event.clientY-rect.top)*cutCanvas.height/rect.height,0,cutCanvas.height)};
  }
  function editorHitRadius(){return Math.max(10,cutCanvas.width/Math.max(1,cutCanvas.clientWidth)*13);}
  function renderCutEditor() {
    if(!sourceCanvas)return;
    const w=cutCanvas.width,h=cutCanvas.height;
    cutCtx.clearRect(0,0,w,h);
    if(cutMode==='refine'&&hasMask) {
      if(showMaskPreview) {
        cutCtx.drawImage(maskCanvas,0,0);
        cutCtx.globalCompositeOperation='source-in';
        cutCtx.drawImage(sourceCanvas,0,0);
        cutCtx.globalCompositeOperation='source-over';
      } else {
        cutCtx.drawImage(sourceCanvas,0,0);
        overlayCtx.clearRect(0,0,w,h);
        overlayCtx.fillStyle='rgba(255,79,53,.48)';
        overlayCtx.fillRect(0,0,w,h);
        overlayCtx.globalCompositeOperation='destination-out';
        overlayCtx.drawImage(maskCanvas,0,0);
        overlayCtx.globalCompositeOperation='source-over';
        cutCtx.drawImage(overlayCanvas,0,0);
      }
      return;
    }
    cutCtx.drawImage(sourceCanvas,0,0,w,h);
    if(cutMode!=='points'&&cutMode!=='free')return;
    cutCtx.save();
    if(cutPoints.length>1) {
      cutCtx.beginPath();cutCtx.moveTo(cutPoints[0].x,cutPoints[0].y);
      for(const p of cutPoints.slice(1))cutCtx.lineTo(p.x,p.y);
      if(cutMode==='free'&&!freeDrawing)cutCtx.closePath();
      cutCtx.strokeStyle='#fff';cutCtx.lineWidth=Math.max(3,w/230);
      cutCtx.shadowColor='#101327';cutCtx.shadowBlur=Math.max(5,w/140);cutCtx.stroke();
      if(!freeDrawing&&cutPoints.length>=3){cutCtx.shadowBlur=0;cutCtx.fillStyle='rgba(255,105,76,.17)';cutCtx.fill();}
    }
    if(cutMode==='points') {
      const size=editorHitRadius()*.55;cutCtx.shadowBlur=0;
      for(let i=0;i<cutPoints.length;i++){
        const p=cutPoints[i];cutCtx.beginPath();cutCtx.arc(p.x,p.y,size,0,Math.PI*2);
        cutCtx.fillStyle=i===0?'#ffe66a':'#ff694e';cutCtx.fill();
        cutCtx.strokeStyle='#fff';cutCtx.lineWidth=Math.max(2,w/350);cutCtx.stroke();
      }
    }
    cutCtx.restore();
  }
  function brushRadius(){return Number(brushSize.value)/2;}
  function updateCursor(event) {
    if(cutMode!=='refine'||showMaskPreview||event.pointerType==='touch'){cutBrushCursor.hidden=true;return;}
    const board=$('#cutoutBoard').getBoundingClientRect();
    const canvasBox=cutCanvas.getBoundingClientRect();
    cutBrushCursor.hidden=false;
    cutBrushCursor.classList.toggle('erase',brushAction==='erase');
    cutBrushCursor.style.left=`${event.clientX-board.left}px`;
    cutBrushCursor.style.top=`${event.clientY-board.top}px`;
    const diameter=Number(brushSize.value)*canvasBox.width/cutCanvas.width;
    cutBrushCursor.style.width=cutBrushCursor.style.height=`${diameter}px`;
  }
  function stampBrush(x,y) {
    const radius=brushRadius();
    // Feather the last 22% for smoother hair/skin contours.
    const gradient=maskCtx.createRadialGradient(x,y,radius*.78,x,y,radius);
    gradient.addColorStop(0,'rgba(255,255,255,1)');
    gradient.addColorStop(1,'rgba(255,255,255,0)');
    maskCtx.save();
    maskCtx.globalCompositeOperation=brushAction==='erase'?'destination-out':'source-over';
    maskCtx.fillStyle=gradient;
    maskCtx.beginPath();maskCtx.arc(x,y,radius,0,Math.PI*2);maskCtx.fill();
    maskCtx.restore();
  }
  function strokeBrush(a,b) {
    const distance=Math.hypot(b.x-a.x,b.y-a.y);
    const steps=Math.max(1,Math.ceil(distance/Math.max(1,brushRadius()*.30)));
    for(let i=1;i<=steps;i++){const t=i/steps;stampBrush(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t);}
  }
  cutCanvas.addEventListener('pointerdown',event=>{
    if(!sourceCanvas||!['points','free','refine'].includes(cutMode))return;
    if(event.pointerType==='mouse'&&event.button!==0)return;
    event.preventDefault();cutCanvas.setPointerCapture(event.pointerId);
    const point=editorPoint(event);
    if(cutMode==='refine'){
      if(showMaskPreview)return;
      recordMask();brushPainting=true;brushLast=point;stampBrush(point.x,point.y);
    } else if(cutMode==='free'){freeDrawing=true;cutPoints=[point];}
    else {
      movedPoint=cutPoints.findIndex(p=>Math.hypot(p.x-point.x,p.y-point.y)<editorHitRadius());
      if(movedPoint<0)cutPoints.push(point);
    }
    updateHistoryButtons();renderCutEditor();updateCursor(event);
  });
  cutCanvas.addEventListener('pointermove',event=>{
    updateCursor(event);
    if(!sourceCanvas)return;
    if(cutMode==='refine'&&brushPainting){
      const point=editorPoint(event);strokeBrush(brushLast,point);brushLast=point;renderCutEditor();
    } else if(cutMode==='free'&&freeDrawing){
      const point=editorPoint(event),prev=cutPoints[cutPoints.length-1];
      if(Math.hypot(prev.x-point.x,prev.y-point.y)>Math.max(2,cutCanvas.width/500)){
        cutPoints.push(point);renderCutEditor();
      }
    } else if(cutMode==='points'&&movedPoint>=0){cutPoints[movedPoint]=editorPoint(event);renderCutEditor();}
  });
  function finishCutPointer(){brushPainting=false;brushLast=null;freeDrawing=false;movedPoint=-1;renderCutEditor();updateHistoryButtons();}
  cutCanvas.addEventListener('pointerup',finishCutPointer);
  cutCanvas.addEventListener('pointercancel',finishCutPointer);
  cutCanvas.addEventListener('pointerleave',()=>{if(!brushPainting)cutBrushCursor.hidden=true;});
  cutCanvas.addEventListener('lostpointercapture',finishCutPointer);
  const setBrushAction=(action)=>{
    brushAction=action;
    for(const [id,value] of [['brushAdd','add'],['brushErase','erase']]){
      const button=$(`#${id}`);button.classList.toggle('active',action===value);button.setAttribute('aria-pressed',String(action===value));
    }
    cutBrushCursor.classList.toggle('erase',action==='erase');
  };
  $('#brushAdd').addEventListener('click',()=>setBrushAction('add'));
  $('#brushErase').addEventListener('click',()=>setBrushAction('erase'));
  brushSize.addEventListener('input',()=>{$('#brushSizeOutput').textContent=`${brushSize.value} px`;});
  $('#cutPreviewToggle').addEventListener('click',()=>{
    if(cutMode!=='refine')return;
    showMaskPreview=!showMaskPreview;
    const button=$('#cutPreviewToggle');
    button.classList.toggle('active',showMaskPreview);
    button.setAttribute('aria-pressed',String(showMaskPreview));
    button.textContent=showMaskPreview?'◉ ПОПРАВИТЬ':'◉ РЕЗУЛЬТАТ';
    cutBrushCursor.hidden=true;renderCutEditor();
  });
  cutUndo.addEventListener('click',()=>{
    if(cutMode==='refine'&&maskUndo.length){maskRedo.push(snapshotMask());restoreMask(maskUndo.pop());}
    else if(['free','points'].includes(cutMode))cutPoints.pop();
    updateHistoryButtons();renderCutEditor();
  });
  cutRedo.addEventListener('click',()=>{
    if(cutMode==='refine'&&maskRedo.length){maskUndo.push(snapshotMask());restoreMask(maskRedo.pop());}
    updateHistoryButtons();renderCutEditor();
  });
  cutClear.addEventListener('click',()=>{
    if(cutMode==='refine'&&maskBase){recordMask();restoreMask(maskBase);}
    else cutPoints=[];
    updateHistoryButtons();renderCutEditor();
  });
  function maskFromPoints(points) {
    const canvas=document.createElement('canvas');canvas.width=sourceCanvas.width;canvas.height=sourceCanvas.height;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';
    ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);
    for(const p of points.slice(1))ctx.lineTo(p.x,p.y);
    ctx.closePath();ctx.fill();return canvas;
  }
  function maskFromAlpha(canvas) {
    const mask=document.createElement('canvas');mask.width=canvas.width;mask.height=canvas.height;
    const src=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;
    const ctx=mask.getContext('2d');const dest=ctx.createImageData(mask.width,mask.height);
    for(let i=0;i<src.length;i+=4){dest.data[i]=dest.data[i+1]=dest.data[i+2]=255;dest.data[i+3]=src[i+3];}
    ctx.putImageData(dest,0,0);return mask;
  }
  function applyMaskToSource() {
    const canvas=document.createElement('canvas');canvas.width=sourceCanvas.width;canvas.height=sourceCanvas.height;
    const ctx=canvas.getContext('2d');
    ctx.drawImage(maskCanvas,0,0);
    ctx.globalCompositeOperation='source-in';ctx.drawImage(sourceCanvas,0,0);
    ctx.globalCompositeOperation='source-over';
    return cropTransparentPadding(canvas);
  }
  function showCutout(result,method) {
    outputCanvas=result;
    previewImage.src=outputCanvas.toDataURL('image/png');
    cutReady=true;
    cutoutEditor.hidden=true;cutoutResult.hidden=false;
    cutoutResult.querySelector('span').textContent=`✓ ВЫРЕЗАНО: ${method}`;
    $('#processingHint').textContent='Готово! Стикер можно вращать, увеличить, заказать или скачать PNG. Контур ещё можно поправить.';
    toast('Стикер готов! Покрути его и выбери размер.');
  }
  function loadSegmentationScript() {
    if(window.SelfieSegmentation)return Promise.resolve();
    if(!segmenterPromise)segmenterPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const timer=window.setTimeout(()=>reject(new Error('AI library timeout')),13000);
      script.src='https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/selfie_segmentation.js';
      script.crossOrigin='anonymous';
      script.onload=()=>{clearTimeout(timer);window.SelfieSegmentation?resolve():reject(new Error('Segmentation unavailable'));};
      script.onerror=()=>{clearTimeout(timer);reject(new Error('AI library blocked'));};
      document.head.append(script);
    }).catch(error=>{segmenterPromise=null;throw error;});
    return segmenterPromise;
  }
  async function segmentPersonMask(source) {
    await loadSegmentationScript();
    const w=source.width,h=source.height;
    return new Promise(async(resolve,reject)=>{
      let model,settled=false;
      const timer=setTimeout(()=>finish(null,new Error('AI timeout')),25000);
      function finish(value,error){
        if(settled)return;settled=true;clearTimeout(timer);
        // The model is only used for this static image. Free the resources.
        try{model?.close?.();}catch(_){ /* Some versions lack close() */ }
        if(error)reject(error);else resolve(value);
      }
      try {
        model=new window.SelfieSegmentation({locateFile:file=>`https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/${file}`});
        model.setOptions({modelSelection:0,selfieMode:false});
        model.onResults(results=>{
          try {
            const decoded=document.createElement('canvas');decoded.width=w;decoded.height=h;
            const mc=decoded.getContext('2d',{willReadFrequently:true});
            mc.drawImage(results.segmentationMask,0,0,w,h);
            const original=mc.getImageData(0,0,w,h).data;
            // MediaPipe normally provides the person's confidence in the alpha
            // channel. Some renderers expose a grayscale RGB texture instead.
            let lowA=255,highA=0,lowR=255,highR=0;
            for(let i=0;i<original.length;i+=Math.max(4,Math.floor(original.length/3200/4)*4)){
              lowA=Math.min(lowA,original[i+3]);highA=Math.max(highA,original[i+3]);
              lowR=Math.min(lowR,original[i]);highR=Math.max(highR,original[i]);
            }
            const useAlpha=highA-lowA>16 || highR-lowR<16;
            const normalized=mc.createImageData(w,h);
            let foreground=0,examined=0;
            for(let i=0;i<original.length;i+=4){
              const confidence=(useAlpha?original[i+3]:original[i])/255;
              // Preserve partially-transparent boundary for smoother hair.
              const v=Math.round(255*clamp((confidence-.08)/.82,0,1));
              normalized.data[i]=normalized.data[i+1]=normalized.data[i+2]=255;
              normalized.data[i+3]=v;
              if(i%64===0){examined++;if(v>128)foreground++;}
            }
            const share=foreground/Math.max(1,examined);
            if(share<.008||share>.985){finish(null,new Error('No confident person found'));return;}
            mc.putImageData(normalized,0,0);
            finish(decoded);
          }catch(error){finish(null,error);}
        });
        await model.send({image:source});
      }catch(error){finish(null,error);}
    });
  }
  async function runPersonAI() {
    if(!sourceCanvas)return;
    const uploadID=processingID;
    const job=++aiRequestID;
    cutBusy.hidden=false;cutApply.disabled=true;
    try {
      const mask=await segmentPersonMask(sourceCanvas);
      if(job!==aiRequestID||uploadID!==processingID||!sourceCanvas)return;
      activateMask(mask,'ИИ выделил человека');
    }catch(error){
      if(job!==aiRequestID||uploadID!==processingID)return;
      cutGuide.textContent='ИИ сейчас недоступен или не нашёл человека. Выдели объект по точкам или от руки — без интернета. Потом поправь кистью.';
      toast('Не получилось автоматически выделить человека. Попробуй точки или рисование.');
      console.warn('[Stikap] Person segmentation:',error);
    }finally {
      if(job===aiRequestID){cutBusy.hidden=true;cutApply.disabled=false;}
    }
  }
  cutApply.addEventListener('click',async()=>{
    if(!sourceCanvas)return;
    if(cutMode==='refine') {
      const result=applyMaskToSource();
      showCutout(result,'с корректировкой');return;
    }
    if(cutMode==='points'||cutMode==='free') {
      if(cutPoints.length<3){toast('Сначала обведи объект минимум тремя точками.');return;}
      const points=cutPoints.slice();
      const area=Math.abs(points.reduce((acc,p,i)=>{const next=points[(i+1)%points.length];return acc+p.x*next.y-next.x*p.y;},0))/2;
      if(area<sourceCanvas.width*sourceCanvas.height*.002){toast('Контур слишком маленький. Обведи побольше.');return;}
      activateMask(maskFromPoints(points),cutMode==='points'?'Контур построен по точкам':'Контур нарисован');return;
    }
    if(cutMode==='background') {
      const canvas=document.createElement('canvas');canvas.width=sourceCanvas.width;canvas.height=sourceCanvas.height;
      canvas.getContext('2d').drawImage(sourceCanvas,0,0);
      const result=clearUniformBorderBackground(canvas);
      if(!result.changed){toast('Этот фон слишком сложный. Попробуй ИИ или точки.');return;}
      activateMask(maskFromAlpha(canvas),'Фон удалён');return;
    }
    if(cutMode==='person')await runPersonAI();
  });
  $('#editCutout').addEventListener('click',()=>{
    cutReady=false;cutoutEditor.hidden=false;cutoutResult.hidden=true;
    if(hasMask)setCutMode('refine');else setCutMode('person');
    cutoutEditor.scrollIntoView({behavior:reduceMotion?'instant':'smooth',block:'center'});
  });
  function resetUploadedImage() {
    processingID++;aiRequestID++;
    sourceCanvas=null;outputCanvas=null;selectedFile=null;cutReady=false;
    hasMask=false;maskUndo=[];maskRedo=[];maskBase=null;
    cutBusy.hidden=true;fileInput.value='';cutPoints=[];
    cutoutEditor.hidden=true;cutoutResult.hidden=true;cutRefineMode.hidden=true;
    previewImage.src='assets/stikap-logo.webp';
    $('#fileName').textContent='Сейчас в превью: стикер Stikap';
    $('#resetImage').hidden=true;
    $('#uploadHeading').textContent='ПЕРЕТАЩИ ФОТО СЮДА';
    $('#processingHint').textContent='Сначала загрузи фото, затем вырежи стикер удобным способом.';
  }
  $('#resetImage').addEventListener('click',resetUploadedImage);

  // Export a transparent PNG with a crisp, rounded white sticker outline.
  function createOutlinedStickerCanvas(source, includeOutline = true) {
    const maxImage = 900;
    const ratio = Math.min(1, maxImage / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * ratio));
    const height = Math.max(1, Math.round(source.height * ratio));
    const margin = includeOutline ? 26 : 8;
    const imageLayer = document.createElement('canvas');
    imageLayer.width = width; imageLayer.height = height;
    imageLayer.getContext('2d').drawImage(source, 0, 0, width, height);
    const result = document.createElement('canvas');
    result.width = width + margin * 2; result.height = height + margin * 2;
    const ctx = result.getContext('2d');
    if (includeOutline) {
      const silhouette = document.createElement('canvas');
      silhouette.width = width; silhouette.height = height;
      const mask = silhouette.getContext('2d');
      mask.drawImage(imageLayer, 0, 0);
      mask.globalCompositeOperation = 'source-in';
      mask.fillStyle = '#ffffff';
      mask.fillRect(0, 0, width, height);
      const thickness = clamp(Math.round(Math.max(width, height) * .013), 5, 12);
      for (let a = 0; a < 360; a += 9) {
        const radians = a * Math.PI / 180;
        ctx.drawImage(silhouette, margin + Math.cos(radians) * thickness, margin + Math.sin(radians) * thickness);
      }
    }
    ctx.drawImage(imageLayer, margin, margin);
    return result;
  }
  async function getCurrentStickerCanvas() {
    if (outputCanvas) return outputCanvas;
    // Avoid using a cross-origin image: default demo is bundled with this site.
    if (!previewImage.complete) await new Promise((res) => previewImage.addEventListener('load', res, { once: true }));
    return imageToCanvas(previewImage);
  }
  $('#savePreview').addEventListener('click', async () => {
    if (sourceCanvas && !cutReady) {toast('Сначала вырежи стикер из фото.');return;}
    const button = $('#savePreview');
    button.disabled = true;
    try {
      const artwork = await getCurrentStickerCanvas();
      const result = createOutlinedStickerCanvas(artwork, showOutline.checked);
      const link = document.createElement('a');
      link.download = `stikap-${widthRange.value}x${heightRange.value}-preview.png`;
      link.href = result.toDataURL('image/png');
      document.body.append(link);
      link.click();
      link.remove();
      toast('PNG-превью сохранено. Это эскиз, не готовый производственный макет.');
    } catch (_) {
      toast('Не удалось сохранить превью. Попробуй открыть сайт через локальный сервер.');
    } finally { button.disabled = false; }
  });

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed'; field.style.left = '-9999px';
    document.body.append(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error('clipboard unavailable'));
  }
  $('#orderButton').addEventListener('click', () => {
    if (sourceCanvas && !cutReady) {toast('Сначала вырежи стикер из загруженной фотографии.');cutoutEditor.scrollIntoView({behavior:'smooth',block:'center'});return;}
    const w = Number(widthRange.value), h = Number(heightRange.value);
    const message = [
      'Привет! Хочу заказать стикер Stikap ✳',
      `Размер: ${w} × ${h} см (${w * h} см²).`,
      `Предварительная стоимость: ${formatMoney(w * h * 30)} ₽ при цене 30 ₽/см².`,
      `Изображение: ${selectedFile ? selectedFile.name : 'пример Stikap (обсудим свой дизайн)'}.`,
      `Белый контур в эскизе: ${showOutline.checked ? 'да' : 'нет'}.`,
      'Прикреплю фото/эскиз в чат. Подскажите финальную цену и условия заказа.'
    ].join('\n');
    // Open on the user gesture, before any awaited clipboard request: popup safe.
    const opened = window.open(telegramManager, '_blank', 'noopener,noreferrer');
    copyText(message).then(() => {
      toast('Параметры скопированы! Вставь текст в чат и прикрепи фото.');
    }).catch(() => {
      toast('Открываем менеджера. Напиши размер и прикрепи свою картинку в чат.');
    });
    if (!opened) {
      // Browsers may return null with noopener even when the new tab did open.
      // The link below remains available as a fallback.
      console.info('If Telegram did not open, use the manager link in the footer.');
    }
  });
})();
