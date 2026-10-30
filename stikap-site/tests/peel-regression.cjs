/* Regression tests for the interactive sticker. Run: node tests/peel-regression.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
assert(!css.includes('background:url(\'assets/stikap-logo.webp\')'), 'Old duplicate sticker background still exists');
assert.match(css, /\.sticker-home::before\s*\{content:none!important\}/);
assert.match(css, /\.hero-sticker\.mesh-active>img\{visibility:hidden\}/);
assert.match(css, /\.hero-sticker:not\(\.mesh-active\)>img\{visibility:visible;opacity:1\}/);
class ClassList {
  constructor(){this.value=new Set();}
  add(...names){names.forEach(n=>this.value.add(n));}
  remove(...names){names.forEach(n=>this.value.delete(n));}
  contains(name){return this.value.has(name);}
}
const elements={}, windowListeners={};
function element() {
  const e={classList:new ClassList(),style:{setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}},dataset:{},
    appendChild(n){n.parentElement=this;},append(n){n.parentElement=this;},hidden:true,offsetWidth:500,offsetHeight:300,
    addEventListener(name,cb){(this.listeners??={})[name]=cb;},removeAttribute(name){if(name==='style')this.style={setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}};},
    setAttribute(){},setPointerCapture(){},releasePointerCapture(){},remove(){},
    getBoundingClientRect(){return {left:700,top:250,right:1200,bottom:550,width:500,height:300};}};
  return e;
}
const sticker=element(),home=element(),restore=element(),img={complete:true,naturalWidth:600,naturalHeight:300,addEventListener(){}};
sticker.querySelector=()=>img;home.append(sticker);
const drawing=['setTransform','clearRect','drawImage','save','restore','translate','scale','beginPath','moveTo','lineTo','closePath','fill','stroke','clip','transform','quadraticCurveTo','fillRect'];
const contexts=[];
function context(){const g={createLinearGradient(){return {addColorStop(){}}},clearCount:0};for(const name of drawing)g[name]=()=>{if(name==='clearRect')g.clearCount++};contexts.push(g);return g;}
const document={getElementById(id){return {heroSticker:sticker,stickerHome:home,resetSticker:restore}[id];},
  createElement(tag){const e=element();if(tag==='canvas'){e.width=0;e.height=0;e.getContext=()=>context();}return e;},body:element()};
const rafQueue=new Map(),timers=new Map();let rafId=0,timerId=0,now=0;
const sandbox={document,window:{addEventListener(name,fn){windowListeners[name]=fn;},scrollBy(){}},
  matchMedia:()=>({matches:false}),devicePixelRatio:1,innerHeight:900,innerWidth:1440,scrollX:0,scrollY:0,
  requestAnimationFrame(fn){rafQueue.set(++rafId,fn);return rafId;},cancelAnimationFrame(id){rafQueue.delete(id);},
  setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},
  performance:{now:()=>now},Math,console};
vm.runInNewContext(fs.readFileSync(path.join(root,'peel-physics.js'),'utf8'),sandbox);
function flush(ms=16){now+=ms;const jobs=[...rafQueue.values()];rafQueue.clear();for(const run of jobs)run(now);}
function settleFrames(ms=400){for(let i=0;i<Math.ceil(ms/20);i++)flush(20);}
function timersRun(){const jobs=[...timers.values()];timers.clear();for(const run of jobs)run();}
function event(x,y){return {pointerId:7,pointerType:'mouse',button:0,clientX:x,clientY:y,pageX:x,pageY:y,preventDefault(){}};}
function down(x,y){sticker.listeners.pointerdown(event(x,y));}
function move(x,y){windowListeners.pointermove(event(x,y));flush();}
function up(x,y){windowListeners.pointerup(event(x,y));}
function flat(){assert(!sticker.classList.contains('mesh-active'));assert(!sticker.querySelector('canvas'));}
function state(){return {canvas:sticker.classList.contains('mesh-active'),peeling:sticker.classList.contains('peeling'),detached:sticker.classList.contains('detached'),curl:sticker.classList.contains('peel-returning')};}
// Half peel has a single mesh, and does not detach prematurely.
down(1070,320);move(1015,367);
assert(sticker.classList.contains('peeling'));
assert(sticker.classList.contains('mesh-active'));
assert(!sticker.classList.contains('detached'));
// Letting go below the tear threshold restores the original image.
up(1015,367);settleFrames(500);
assert(!sticker.classList.contains('mesh-active'));assert(!sticker.classList.contains('peeling'));
// Take sticker off and move it: canvas stops and original logo returns.
down(1070,320);move(1015,370);move(874,456);
assert(sticker.classList.contains('detached'));
assert(!sticker.classList.contains('mesh-active'));
assert(!sticker.classList.contains('peeling'));
assert(!home.classList.contains('peel-mark'));
assert.equal(sticker.parentElement,document.body);
up(874,456);timersRun();
assert(!sticker.classList.contains('mesh-active'));assert(!sticker.classList.contains('sticking'));
// Once stuck in a new place, a user can pull it again without a ghost.
down(1070,320);move(970,370);up(970,370);timersRun();
assert(!sticker.classList.contains('mesh-active'));assert(!home.classList.contains('peel-mark'));
// Reset home must restore one flat sticker and remove inline transformations.
restore.listeners.click();
assert.equal(sticker.parentElement,home);
assert(!sticker.classList.contains('detached'));assert(!sticker.classList.contains('mesh-active'));
// Starting another gesture before an old rebound finishes must cancel it.
down(1070,320);move(1040,338);up(1040,338);flush(60);
down(1070,320);move(870,467);up(870,467);settleFrames(500);timersRun();
assert(!sticker.classList.contains('mesh-active'));assert(!sticker.classList.contains('peel-returning'));
console.log('PASS: no ghost logo, one visible rendering, release, press, reset, repeated gesture and cancelled rebound');
