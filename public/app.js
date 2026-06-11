/* ===================================================================
   Orbiter Cut Planner — blueprint → foam cut planner
   All geometry lives in INCHES (foam real-world space).
   Screen = inch * ppi + pan.  Trace polylines stored as normalized
   u,v (0..1) relative to the cropped image, so they survive moves.
=================================================================== */
'use strict';

const $ = (s) => document.querySelector(s);
const LS_KEY = 'orbiter_cut_projects_v1';

/* ---------- unit parsing / formatting (feet + inches + fractions) ---------- */
function parseLen(str){
  if(str==null) return NaN;
  let s = String(str).trim().toLowerCase().replace(/[, ]+/g,' ').trim();
  if(!s) return NaN;
  if(/^[\d.]+$/.test(s)) return parseFloat(s); // bare number = inches
  let inches = 0, matched = false;
  // feet:  3ft  3'  3 feet
  let fm = s.match(/(-?\d*\.?\d+)\s*(?:ft|feet|foot|')/);
  if(fm){ inches += parseFloat(fm[1])*12; matched = true; s = s.replace(fm[0],' '); }
  // inches with optional fraction: 4 1/2in, 4in, 4", 1/2"
  let im = s.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)\s*(?:in|inch|inches|")?/); // whole + frac
  if(im){ inches += parseFloat(im[1]) + parseFloat(im[2])/parseFloat(im[3]); matched = true; s = s.replace(im[0],' '); }
  let fr = s.match(/(\d+)\s*\/\s*(\d+)\s*(?:in|inch|inches|")?/); // lone fraction
  if(fr){ inches += parseFloat(fr[1])/parseFloat(fr[2]); matched = true; s = s.replace(fr[0],' '); }
  let wm = s.match(/(-?\d*\.?\d+)\s*(?:in|inch|inches|")/); // whole inches w/ unit
  if(wm){ inches += parseFloat(wm[1]); matched = true; s = s.replace(wm[0],' '); }
  if(!matched){
    let n = s.match(/(-?\d*\.?\d+)/); // leftover number after ft = inches
    if(n) inches += parseFloat(n[1]);
  }
  return inches>0||matched ? inches : NaN;
}
function fmtLen(inches){
  if(!isFinite(inches)) return '–';
  const neg = inches<0; inches = Math.abs(inches);
  let sixteenths = Math.round(inches*16);
  let ft = Math.floor(sixteenths/192);
  let rem = sixteenths - ft*192;
  let wholeIn = Math.floor(rem/16);
  let frac = rem%16;
  let parts = [];
  if(ft>0) parts.push(ft+"'");
  let inStr = '';
  if(frac>0){
    let g = gcd(frac,16); inStr = (wholeIn>0?wholeIn+' ':'') + (frac/g)+'/'+(16/g);
  } else {
    inStr = String(wholeIn);
  }
  if(wholeIn>0||frac>0||ft===0) parts.push(inStr+'"');
  return (neg?'-':'')+parts.join(' ');
}
function gcd(a,b){ while(b){ [a,b]=[b,a%b]; } return a||1; }

/* ===================================================================
   STORAGE
=================================================================== */
function loadProjects(){
  try{ return JSON.parse(localStorage.getItem(LS_KEY)||'[]'); }catch(e){ return []; }
}
function saveProjects(list){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify(list));
    return true;
  }catch(e){
    if(e && (e.name==='QuotaExceededError' || /quota/i.test(e.message||''))){
      toast('Storage full — image too large. Try a smaller crop.');
    } else { toast('Could not save: '+(e.message||e)); }
    return false;
  }
}
function uid(){ return 'p'+Math.abs((Date.now()^(performance.now()*1000|0))).toString(36)+(projects.length); }

let projects = loadProjects();

/* ===================================================================
   STATE
=================================================================== */
const state = {
  proj: null,          // active project object
  img: null,           // HTMLImageElement
  ppi: 6,              // pixels per inch (zoom)
  panX: 0, panY: 0,    // screen offset of inch-origin
  tool: 'select',
  dirty: false,
  hover: null,         // {len,angle,mx,my}
  cropRect: null,      // active crop drag (screen rect) when cropping
  // drag state
  drag: null,
};

/* Project shape:
  { id, name, createdAt, updatedAt, thumb,
    foam:{w,h},                         // inches
    image:{ src, cx,cy, wIn, rot, op, flip, crop:{x,y,w,h}|null },   // cx,cy,wIn in inches; crop in natural px
    trace:{ polys:[ [ [u,v],... ] ], visible, showOriginal, mode,thr,det,noise,invert },
    measures:[ {x1,y1,x2,y2} ],          // inches
    showCenter:true }
*/

/* ===================================================================
   VIEW SWITCH
=================================================================== */
function showView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $('#'+id).classList.add('active');
}

/* ===================================================================
   SAVES / GALLERY
=================================================================== */
function renderSaves(){
  const grid = $('#saves-grid');
  grid.innerHTML='';
  projects = loadProjects();
  $('#saves-empty').style.display = projects.length? 'none':'block';
  projects.slice().sort((a,b)=>b.updatedAt-a.updatedAt).forEach(p=>{
    const card = document.createElement('div');
    card.className='proj-card';
    const date = new Date(p.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
    card.innerHTML = `
      <div class="proj-thumb">${p.thumb?`<img src="${p.thumb}">`:'<span style="color:#46587a;font-size:13px">no preview</span>'}
        <button class="proj-del" title="Delete">✕</button></div>
      <div class="proj-meta">
        <h3>${escapeHtml(p.name)}</h3>
        <p>${fmtLen(p.foam.w)} × ${fmtLen(p.foam.h)} · ${date}</p>
      </div>`;
    card.querySelector('.proj-thumb').addEventListener('click',(e)=>{ if(e.target.classList.contains('proj-del'))return; openProject(p.id); });
    card.querySelector('.proj-meta').addEventListener('click',()=>openProject(p.id));
    card.querySelector('.proj-del').addEventListener('click',(e)=>{ e.stopPropagation();
      if(confirm('Delete "'+p.name+'"? This cannot be undone.')){
        projects = loadProjects().filter(x=>x.id!==p.id); saveProjects(projects); renderSaves();
      }});
    grid.appendChild(card);
  });
}
function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* ---------- new project modal ---------- */
$('#new-project-btn').addEventListener('click',()=>{ openNewModal(); });
function openNewModal(){
  $('#np-name').value=''; $('#np-w').value=''; $('#np-h').value='';
  $('#new-modal').classList.add('open'); $('#np-name').focus();
}
$('#np-cancel').addEventListener('click',()=>$('#new-modal').classList.remove('open'));
$('#new-modal').addEventListener('click',e=>{ if(e.target.id==='new-modal') $('#new-modal').classList.remove('open'); });
$('#np-create').addEventListener('click',()=>{
  const name = $('#np-name').value.trim() || 'Untitled Project';
  const w = parseLen($('#np-w').value), h = parseLen($('#np-h').value);
  if(!isFinite(w)||!isFinite(h)||w<=0||h<=0){ toast('Enter a valid foam size, e.g. "3ft 4in"'); return; }
  const p = {
    id:uid(), name, createdAt:Date.now(), updatedAt:Date.now(), thumb:null,
    foam:{w,h}, image:null,
    trace:{ polys:null, rawPolys:null, visible:true, showOriginal:true, mode:'edges', thr:50, det:2, noise:3, invert:false, smooth:45, snap:true, symmetry:'none' },
    measures:[], showCenter:true
  };
  projects = loadProjects(); projects.push(p); saveProjects(projects);
  $('#new-modal').classList.remove('open');
  openProject(p.id);
});

/* ===================================================================
   OPEN PROJECT → WORKSPACE
=================================================================== */
function openProject(id){
  const p = loadProjects().find(x=>x.id===id);
  if(!p) return;
  // migrate defaults
  p.trace = Object.assign({ polys:null, rawPolys:null, visible:true, showOriginal:true, mode:'edges', thr:50, det:2, noise:3, invert:false, smooth:45, snap:true, symmetry:'none' }, p.trace||{});
  p.measures = p.measures||[]; if(p.showCenter===undefined) p.showCenter=true;
  state.proj = p; state.img=null; state.hover=null; state.cropRect=null; state.drag=null;
  showView('workspace-view');
  $('#ws-name').value = p.name;
  $('#foam-w').value = fmtLen(p.foam.w);
  $('#foam-h').value = fmtLen(p.foam.h);
  syncImagePanel();
  syncTracePanel();
  setTool('select');
  resizeCanvas();
  if(p.image && p.image.src){
    loadImage(p.image.src, ()=>{ fitView(); markClean(); draw(); });
  } else { fitView(); markClean(); draw(); }
  refreshFoamReadout();
}

$('#back-btn').addEventListener('click',()=>{
  if(state.dirty && !confirm('Leave without saving? Unsaved changes will be lost.')) return;
  showView('saves-view'); renderSaves();
});

/* ===================================================================
   SAVE
=================================================================== */
function markDirty(){ state.dirty=true; $('#save-state').textContent='unsaved'; $('#save-state').classList.add('dirty'); }
function markClean(){ state.dirty=false; $('#save-state').textContent='saved'; $('#save-state').classList.remove('dirty'); }
$('#save-btn').addEventListener('click',saveCurrent);
function saveCurrent(){
  const p = state.proj; if(!p) return;
  p.name = $('#ws-name').value.trim()||'Untitled Project';
  p.updatedAt = Date.now();
  p.thumb = makeThumb();
  const list = loadProjects();
  const i = list.findIndex(x=>x.id===p.id);
  if(i>=0) list[i]=p; else list.push(p);
  saveProjects(list); projects=list;
  markClean(); toast('Project saved');
}
function makeThumb(){
  try{
    const tc = document.createElement('canvas'); tc.width=300; tc.height=190;
    const tx = tc.getContext('2d');
    tx.fillStyle='#0c1322'; tx.fillRect(0,0,300,190);
    const p=state.proj;
    const sc = Math.min(280/p.foam.w, 170/p.foam.h);
    const ox=(300-p.foam.w*sc)/2, oy=(190-p.foam.h*sc)/2;
    tx.strokeStyle='#2a3a5c'; tx.strokeRect(ox,oy,p.foam.w*sc,p.foam.h*sc);
    if(state.img && p.image){
      tx.save();
      const cx=ox+p.image.cx*sc, cy=oy+p.image.cy*sc;
      tx.translate(cx,cy); tx.rotate(p.image.rot*Math.PI/180);
      const cr=cropOrFull(); const wpx=p.image.wIn*sc, hpx=wpx*(cr.h/cr.w)*(p.image.flip?1:1);
      tx.globalAlpha=.9;
      tx.drawImage(state.img,cr.x,cr.y,cr.w,cr.h,-wpx/2,-hpx/2,wpx,hpx);
      tx.restore();
    }
    if(p.trace&&p.trace.polys&&p.trace.visible){
      tx.strokeStyle='#7c8cff'; tx.lineWidth=1;
      drawPolysTo(tx, ox,oy,sc);
    }
    return tc.toDataURL('image/jpeg',0.7);
  }catch(e){ return null; }
}
function drawPolysTo(tx,ox,oy,sc){
  const p=state.proj; tx.beginPath();
  p.trace.polys.forEach(poly=>{
    poly.forEach(([u,v],i)=>{ const pt=uvToInch(u,v); const x=ox+pt.x*sc,y=oy+pt.y*sc; i?tx.lineTo(x,y):tx.moveTo(x,y); });
  });
  tx.stroke();
}

/* ===================================================================
   CANVAS / RENDER
=================================================================== */
const canvas = $('#board');
const ctx = canvas.getContext('2d');
let DPR = Math.min(window.devicePixelRatio||1, 2);

function resizeCanvas(){
  const wrap = $('#canvas-wrap'); const r = wrap.getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio||1,2);
  canvas.width = r.width*DPR; canvas.height = r.height*DPR;
  canvas.style.width=r.width+'px'; canvas.style.height=r.height+'px';
}
window.addEventListener('resize',()=>{ if(state.proj){ resizeCanvas(); draw(); }});

function CW(){ return canvas.width/DPR; }
function CH(){ return canvas.height/DPR; }

function fitView(){
  const p=state.proj; if(!p) return;
  const pad=70;
  state.ppi = Math.min((CW()-pad)/p.foam.w, (CH()-pad)/p.foam.h);
  state.panX = (CW()-p.foam.w*state.ppi)/2;
  state.panY = (CH()-p.foam.h*state.ppi)/2;
}
function sx(ix){ return ix*state.ppi+state.panX; }
function sy(iy){ return iy*state.ppi+state.panY; }
function ix(s){ return (s-state.panX)/state.ppi; }
function iy(s){ return (s-state.panY)/state.ppi; }

function cropOrFull(){
  const im=state.proj.image;
  if(im && im.crop) return im.crop;
  return { x:0,y:0, w: state.img? state.img.naturalWidth:1, h: state.img? state.img.naturalHeight:1 };
}
// normalized u,v (rel. to crop) -> inch point, honoring placement+rotation+flip
function uvToInch(u,v){
  const im=state.proj.image, cr=cropOrFull();
  if(im.flip) u = 1-u;
  const hIn = im.wIn*(cr.h/cr.w);
  let lx=(u-0.5)*im.wIn, ly=(v-0.5)*hIn;
  const a=im.rot*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
  return { x: im.cx + lx*c - ly*s, y: im.cy + lx*s + ly*c };
}

function draw(){
  if(!state.proj) return;
  const p=state.proj;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.clearRect(0,0,CW(),CH());

  drawGrid();
  drawFoam();

  // image
  if(state.img && p.image && p.trace.showOriginal!==false){
    ctx.save();
    ctx.translate(sx(p.image.cx),sy(p.image.cy));
    ctx.rotate(p.image.rot*Math.PI/180);
    const cr=cropOrFull();
    const hIn=p.image.wIn*(cr.h/cr.w);
    const wpx=p.image.wIn*state.ppi, hpx=hIn*state.ppi;
    ctx.globalAlpha=(p.image.op==null?100:p.image.op)/100;
    if(p.image.flip) ctx.scale(-1,1);
    ctx.imageSmoothingQuality='high';
    ctx.drawImage(state.img,cr.x,cr.y,cr.w,cr.h,-wpx/2,-hpx/2,wpx,hpx);
    ctx.restore();
  }

  // trace
  if(p.trace.polys && p.trace.visible){
    drawTrace();
  }

  // center + axis
  if(p.showCenter) drawCenter();

  // measures
  drawMeasures();

  // selection handles for image
  if(state.img && p.image && (state.tool==='select')) drawImageHandles();
  // crop overlay
  if(state.tool==='crop' && state.img && p.image) drawCropUI();
}

function drawGrid(){
  // 1-foot grid in inch space
  const step=12*state.ppi;
  if(step<6) return;
  ctx.lineWidth=1;
  const x0=state.panX%step, y0=state.panY%step;
  ctx.strokeStyle='#16213a';
  ctx.beginPath();
  for(let x=x0;x<CW();x+=step){ ctx.moveTo(x,0); ctx.lineTo(x,CH()); }
  for(let y=y0;y<CH();y+=step){ ctx.moveTo(0,y); ctx.lineTo(CW(),y); }
  ctx.stroke();
}

function drawFoam(){
  const p=state.proj;
  const x=sx(0),y=sy(0),w=p.foam.w*state.ppi,h=p.foam.h*state.ppi;
  ctx.save();
  ctx.fillStyle='rgba(20,30,52,.55)';
  ctx.strokeStyle='#3a4d77';
  ctx.lineWidth=1.5;
  ctx.fillRect(x,y,w,h);
  ctx.strokeRect(x,y,w,h);
  // dimension labels
  ctx.fillStyle='#8aa0c8'; ctx.font='12px -apple-system,sans-serif';
  ctx.textAlign='center';
  ctx.fillText(fmtLen(p.foam.w), x+w/2, y-9);
  ctx.save(); ctx.translate(x-11,y+h/2); ctx.rotate(-Math.PI/2);
  ctx.fillText(fmtLen(p.foam.h),0,0); ctx.restore();
  ctx.restore();
}

function drawTrace(){
  const p=state.proj;
  ctx.save();
  ctx.lineJoin='round'; ctx.lineCap='round';
  ctx.strokeStyle='rgba(124,140,255,.92)';
  ctx.lineWidth=1.4;
  ctx.beginPath();
  p.trace.polys.forEach(poly=>{
    poly.forEach((pt,i)=>{ const q=uvToInch(pt[0],pt[1]); const X=sx(q.x),Y=sy(q.y); i?ctx.lineTo(X,Y):ctx.moveTo(X,Y); });
  });
  ctx.stroke();
  // highlight hovered segment
  if(state.hover && state.hover.seg){
    const a=uvToInch(state.hover.seg.a[0],state.hover.seg.a[1]);
    const b=uvToInch(state.hover.seg.b[0],state.hover.seg.b[1]);
    ctx.strokeStyle=getCss('--accent-2'); ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(sx(a.x),sy(a.y)); ctx.lineTo(sx(b.x),sy(b.y)); ctx.stroke();
    // endpoints
    ctx.fillStyle=getCss('--accent-2');
    [a,b].forEach(pt=>{ ctx.beginPath(); ctx.arc(sx(pt.x),sy(pt.y),3.5,0,7); ctx.fill(); });
  }
  ctx.restore();
}

function drawCenter(){
  const p=state.proj;
  // foam center axis
  const cx=sx(p.foam.w/2);
  ctx.save();
  ctx.strokeStyle='rgba(255,184,107,.5)'; ctx.lineWidth=1; ctx.setLineDash([7,6]);
  ctx.beginPath(); ctx.moveTo(cx,sy(0)); ctx.lineTo(cx,sy(p.foam.h)); ctx.stroke();
  ctx.setLineDash([]);
  // image bbox center, if trace present
  if(p.trace.polys && p.trace.visible){
    const bb=traceBBoxInch();
    if(bb){
      const mx=sx((bb.minx+bb.maxx)/2), my=sy((bb.miny+bb.maxy)/2);
      ctx.strokeStyle=getCss('--accent-warm'); ctx.lineWidth=1.4;
      ctx.beginPath(); ctx.moveTo(mx-9,my); ctx.lineTo(mx+9,my); ctx.moveTo(mx,my-9); ctx.lineTo(mx,my+9); ctx.stroke();
      ctx.beginPath(); ctx.arc(mx,my,5,0,7); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawMeasures(){
  const p=state.proj;
  ctx.save();
  ctx.font='11.5px -apple-system,sans-serif'; ctx.textAlign='center';
  p.measures.forEach((m,i)=>{
    const x1=sx(m.x1),y1=sy(m.y1),x2=sx(m.x2),y2=sy(m.y2);
    ctx.strokeStyle=getCss('--accent-warm'); ctx.lineWidth=1.8;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    // ticks
    drawTick(x1,y1,x2,y2); drawTick(x2,y2,x1,y1);
    const len=Math.hypot(m.x2-m.x1,m.y2-m.y1);
    const ang=segAngle(m.x1,m.y1,m.x2,m.y2);
    const mxx=(x1+x2)/2,myy=(y1+y2)/2;
    const label=fmtLen(len)+'  ·  '+ang.toFixed(1)+'°';
    ctx.font='11.5px -apple-system,sans-serif';
    const tw=ctx.measureText(label).width;
    ctx.fillStyle='rgba(11,17,30,.9)';
    roundRect(ctx,mxx-tw/2-6,myy-20,tw+12,17,5); ctx.fill();
    ctx.fillStyle=getCss('--accent-warm'); ctx.fillText(label,mxx,myy-8);
  });
  // active measure drag
  if(state.drag && state.drag.type==='measure'){
    const d=state.drag;
    ctx.strokeStyle=getCss('--accent-warm'); ctx.lineWidth=1.8; ctx.setLineDash([5,4]);
    ctx.beginPath(); ctx.moveTo(sx(d.x1),sy(d.y1)); ctx.lineTo(sx(d.cx),sy(d.cy)); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
function drawTick(x,y,ox,oy){
  const a=Math.atan2(oy-y,ox-x)+Math.PI/2;
  ctx.beginPath(); ctx.moveTo(x+Math.cos(a)*5,y+Math.sin(a)*5); ctx.lineTo(x-Math.cos(a)*5,y-Math.sin(a)*5); ctx.stroke();
}

/* ---------- image handles ---------- */
function imageCorners(){ // inch-space [tl,tr,br,bl]
  return [uvToInch(0,0),uvToInch(1,0),uvToInch(1,1),uvToInch(0,1)];
}
function drawImageHandles(){
  const c=imageCorners().map(pt=>({x:sx(pt.x),y:sy(pt.y)}));
  ctx.save();
  ctx.strokeStyle='rgba(124,140,255,.9)'; ctx.lineWidth=1.3; ctx.setLineDash([4,3]);
  ctx.beginPath(); ctx.moveTo(c[0].x,c[0].y); for(let i=1;i<4;i++)ctx.lineTo(c[i].x,c[i].y); ctx.closePath(); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle='#fff'; ctx.strokeStyle=getCss('--accent');
  c.forEach(pt=>{ ctx.beginPath(); ctx.rect(pt.x-5,pt.y-5,10,10); ctx.fill(); ctx.stroke(); });
  // rotate handle
  const rh=rotateHandlePos();
  const top={x:(c[0].x+c[1].x)/2,y:(c[0].y+c[1].y)/2};
  ctx.beginPath(); ctx.moveTo(top.x,top.y); ctx.lineTo(rh.x,rh.y); ctx.stroke();
  ctx.beginPath(); ctx.arc(rh.x,rh.y,6,0,7); ctx.fillStyle=getCss('--accent'); ctx.fill();
  ctx.restore();
}
function rotateHandlePos(){
  const c=imageCorners().map(pt=>({x:sx(pt.x),y:sy(pt.y)}));
  const top={x:(c[0].x+c[1].x)/2,y:(c[0].y+c[1].y)/2};
  const cen={x:sx(state.proj.image.cx),y:sy(state.proj.image.cy)};
  let dx=top.x-cen.x,dy=top.y-cen.y,m=Math.hypot(dx,dy)||1;
  return { x: top.x+dx/m*30, y: top.y+dy/m*30 };
}

/* ---------- crop UI ---------- */
function drawCropUI(){
  const r = state.cropRect || currentCropScreenRect();
  if(!r) return;
  ctx.save();
  ctx.fillStyle='rgba(8,12,20,.55)';
  ctx.fillRect(0,0,CW(),CH());
  ctx.clearRect(r.x,r.y,r.w,r.h);
  // redraw image inside hole
  // (simpler: just outline)
  ctx.strokeStyle=getCss('--accent-2'); ctx.lineWidth=1.5; ctx.setLineDash([6,4]);
  ctx.strokeRect(r.x,r.y,r.w,r.h); ctx.setLineDash([]);
  ctx.fillStyle=getCss('--accent-2');
  [[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]].forEach(([x,y])=>{ ctx.fillRect(x-4,y-4,8,8); });
  ctx.restore();
}
function currentCropScreenRect(){
  // axis-aligned screen bbox of unrotated image only sensible when rot==0; we crop in image space anyway
  return null;
}

/* ===================================================================
   GEOMETRY HELPERS
=================================================================== */
function segAngle(x1,y1,x2,y2){ // degrees from horizontal, 0..180
  let a=Math.atan2(-(y2-y1),(x2-x1))*180/Math.PI; // -y because screen y down
  if(a<0)a+=180; if(a>=180)a-=180; return a;
}
function traceBBoxInch(){
  const p=state.proj; if(!p.trace.polys)return null;
  let minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
  p.trace.polys.forEach(poly=>poly.forEach(pt=>{ const q=uvToInch(pt[0],pt[1]);
    if(q.x<minx)minx=q.x; if(q.x>maxx)maxx=q.x; if(q.y<miny)miny=q.y; if(q.y>maxy)maxy=q.y; }));
  return {minx,miny,maxx,maxy};
}
function getCss(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim()||'#7c8cff'; }
function roundRect(c,x,y,w,h,r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }

/* ===================================================================
   IMAGE LOAD / UPLOAD
=================================================================== */
$('#upload-btn').addEventListener('click',()=>$('#file-input').click());
$('#file-input').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f)return;
  const rd=new FileReader();
  rd.onload=()=>{ placeNewImage(rd.result); };
  rd.readAsDataURL(f);
  e.target.value='';
});
// Downscale big photos before storing so we stay under the localStorage quota.
function downscaleDataURL(src, maxDim, cb){
  const im=new Image();
  im.onload=()=>{
    const scale=Math.min(1, maxDim/Math.max(im.naturalWidth,im.naturalHeight));
    if(scale>=1){ cb(src); return; }
    const c=document.createElement('canvas');
    c.width=Math.round(im.naturalWidth*scale); c.height=Math.round(im.naturalHeight*scale);
    const x=c.getContext('2d'); x.imageSmoothingQuality='high';
    x.drawImage(im,0,0,c.width,c.height);
    try{ cb(c.toDataURL('image/jpeg',0.86)); }catch(e){ cb(src); }
  };
  im.onerror=()=>cb(src);
  im.src=src;
}
function placeNewImage(rawSrc){
  downscaleDataURL(rawSrc, 1700, (src)=>{
  loadImage(src,()=>{
    const p=state.proj;
    const ar=state.img.naturalWidth/state.img.naturalHeight;
    let wIn=p.foam.w*0.9, hIn=wIn/ar;
    if(hIn>p.foam.h*0.9){ hIn=p.foam.h*0.9; wIn=hIn*ar; }
    p.image={ src, cx:p.foam.w/2, cy:p.foam.h/2, wIn, rot:0, op:100, flip:false, crop:null };
    p.trace.polys=null;
    syncImagePanel(); syncTracePanel(); markDirty(); draw();
    toast('Image placed — scale & position it, then Vectorize');
  });
  });
}
function loadImage(src,cb){
  const im=new Image();
  im.onload=()=>{ state.img=im; $('#canvas-hint').style.display='none'; cb&&cb(); };
  im.onerror=()=>{ toast('Could not load image'); };
  im.src=src;
}

/* ---------- image panel controls ---------- */
function syncImagePanel(){
  const p=state.proj;
  const has=!!(p.image);
  $('#image-controls').classList.toggle('hidden',!has);
  $('#trace-panel').classList.toggle('hidden',!has);
  $('#canvas-hint').style.display = has? 'none':'block';
  if(has){
    $('#img-width').value=fmtLen(p.image.wIn);
    $('#img-rot').value=p.image.rot; $('#rot-val').textContent=Math.round(p.image.rot)+'°';
    $('#img-op').value=p.image.op==null?100:p.image.op; $('#op-val').textContent=(p.image.op==null?100:p.image.op)+'%';
    const pct=Math.round(p.image.wIn/p.foam.w*100);
    $('#img-size').value=Math.max(10,Math.min(320,pct)); $('#size-val').textContent=pct+'%';
  }
}
$('#img-size').addEventListener('input',e=>{ const pct=+e.target.value; state.proj.image.wIn=state.proj.foam.w*pct/100; $('#size-val').textContent=pct+'%'; $('#img-width').value=fmtLen(state.proj.image.wIn); markDirty(); draw(); });
$('#maximize-btn').addEventListener('click',()=>{
  const p=state.proj, cr=cropOrFull(); const ar=cr.w/cr.h;
  // cover the foam: largest size that still keeps the whole shape touching both edges
  let wIn=Math.max(p.foam.w, p.foam.h*ar);
  p.image.wIn=wIn; p.image.cx=p.foam.w/2; p.image.cy=p.foam.h/2;
  syncImagePanel(); markDirty(); draw(); toast('Maximized & centered');
});
$('#img-width').addEventListener('change',e=>{ const v=parseLen(e.target.value); if(isFinite(v)&&v>0){ state.proj.image.wIn=v; markDirty(); draw(); } e.target.value=fmtLen(state.proj.image.wIn); });
$('#img-rot').addEventListener('input',e=>{ state.proj.image.rot=parseFloat(e.target.value); $('#rot-val').textContent=Math.round(state.proj.image.rot)+'°'; markDirty(); draw(); });
$('#img-op').addEventListener('input',e=>{ state.proj.image.op=parseInt(e.target.value); $('#op-val').textContent=state.proj.image.op+'%'; markDirty(); draw(); });
$('#center-btn').addEventListener('click',()=>{ const p=state.proj; p.image.cx=p.foam.w/2; p.image.cy=p.foam.h/2; markDirty(); draw(); });
$('#orient-btn').addEventListener('click',()=>{ state.proj.image.rot=((state.proj.image.rot+90+180)%360)-180; syncImagePanel(); markDirty(); draw(); });
$('#flip-btn').addEventListener('click',()=>{ state.proj.image.flip=!state.proj.image.flip; markDirty(); draw(); });
$('#fitfoam-btn').addEventListener('click',()=>{
  const p=state.proj, cr=cropOrFull(); const ar=cr.w/cr.h;
  let wIn=p.foam.w, hIn=wIn/ar; if(hIn>p.foam.h){ hIn=p.foam.h; wIn=hIn*ar; }
  p.image.wIn=wIn; p.image.cx=p.foam.w/2; p.image.cy=p.foam.h/2; p.image.rot=0;
  syncImagePanel(); markDirty(); draw();
});
$('#del-image').addEventListener('click',()=>{
  if(!confirm('Remove the image and its trace?'))return;
  state.proj.image=null; state.proj.trace.polys=null; state.img=null;
  syncImagePanel(); syncTracePanel(); markDirty(); draw();
});

/* ---------- crop ---------- */
$('#crop-apply').addEventListener('click',applyCrop);
$('#crop-cancel').addEventListener('click',()=>{ state.cropRect=null; setTool('select'); });
$('#crop-reset').addEventListener('click',()=>{ state.proj.image.crop=null; state.proj.trace.polys=null; state.cropRect=null; markDirty(); draw(); toast('Crop reset'); });

function applyCrop(){
  const r=state.cropRect; const p=state.proj;
  if(!r||r.w<8||r.h<8){ toast('Drag a crop box over the image first'); return; }
  // convert screen rect corners -> image natural px (works for rot==0; for rotation we map via inverse transform)
  const corners=[[r.x,r.y],[r.x+r.w,r.y+r.h]].map(([X,Y])=>screenToImagePx(X,Y));
  let nx=Math.min(corners[0].x,corners[1].x), ny=Math.min(corners[0].y,corners[1].y);
  let nw=Math.abs(corners[1].x-corners[0].x), nh=Math.abs(corners[1].y-corners[0].y);
  const base=cropOrFull();
  // clamp to existing crop/image
  nx=Math.max(0,Math.min(nx,state.img.naturalWidth));
  ny=Math.max(0,Math.min(ny,state.img.naturalHeight));
  nw=Math.max(4,Math.min(nw,state.img.naturalWidth-nx));
  nh=Math.max(4,Math.min(nh,state.img.naturalHeight-ny));
  // preserve on-foam scale: keep cropped region roughly same size visually
  const oldHIn=p.image.wIn*(base.h/base.w);
  p.image.crop={x:nx,y:ny,w:nw,h:nh};
  // keep width-in proportional so visual size stays similar
  p.image.wIn = p.image.wIn*(nw/base.w);
  p.image.cx=p.foam.w/2; p.image.cy=p.foam.h/2; // recenter cropped piece
  p.trace.polys=null;
  state.cropRect=null;
  syncImagePanel(); markDirty(); setTool('select'); draw();
  toast('Cropped — re-center & vectorize');
}
function screenToImagePx(X,Y){
  // inverse of image draw transform
  const p=state.proj, im=p.image, cr=cropOrFull();
  let dx=ix(X)-im.cx, dy=iy(Y)-im.cy;
  const a=-im.rot*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  let lx=dx*c-dy*s, ly=dx*s+dy*c; // local inch centered
  const hIn=im.wIn*(cr.h/cr.w);
  let u=lx/im.wIn+0.5, v=ly/hIn+0.5;
  if(im.flip) u=1-u;
  return { x: cr.x+u*cr.w, y: cr.y+v*cr.h };
}

/* ===================================================================
   VECTORIZE
=================================================================== */
function syncTracePanel(){
  const t=state.proj.trace;
  $('#trace-mode').value=t.mode; $('#trace-thr').value=t.thr; $('#thr-val').textContent=t.thr;
  $('#trace-det').value=t.det; $('#det-val').textContent=['ultra','fine','med','coarse','blocky'][t.det];
  $('#trace-noise').value=t.noise; $('#noise-val').textContent=t.noise===0?'off':'lvl '+t.noise;
  $('#trace-invert').checked=!!t.invert;
  $('#show-original').checked=t.showOriginal!==false;
  $('#show-trace').checked=t.visible!==false;
  $('#show-center').checked=state.proj.showCenter!==false;
  $('#trace-toggles').style.display = t.polys? 'flex':'none';
  // refine controls
  $('#refine-block').classList.toggle('hidden', !t.polys);
  $('#smooth-str').value=t.smooth==null?45:t.smooth;
  $('#smooth-val').textContent=smoothLabel(t.smooth==null?45:t.smooth);
  $('#smooth-snap').checked=t.snap!==false;
  $('#smooth-sym').value=t.symmetry||'none';
}
function smoothLabel(v){ return v===0?'off':v<25?'light':v<55?'med':v<80?'strong':'max'; }
['trace-mode','trace-thr','trace-det','trace-noise','trace-invert'].forEach(id=>{
  $('#'+id).addEventListener('input',()=>{
    const t=state.proj.trace;
    t.mode=$('#trace-mode').value; t.thr=+$('#trace-thr').value; t.det=+$('#trace-det').value;
    t.noise=+$('#trace-noise').value; t.invert=$('#trace-invert').checked;
    $('#thr-val').textContent=t.thr; $('#det-val').textContent=['ultra','fine','med','coarse','blocky'][t.det];
    $('#noise-val').textContent=t.noise===0?'off':'lvl '+t.noise;
    markDirty();
  });
});
$('#show-original').addEventListener('change',e=>{ state.proj.trace.showOriginal=e.target.checked; markDirty(); draw(); });
$('#show-trace').addEventListener('change',e=>{ state.proj.trace.visible=e.target.checked; markDirty(); draw(); });
$('#show-center').addEventListener('change',e=>{ state.proj.showCenter=e.target.checked; markDirty(); draw(); });
$('#clear-measures').addEventListener('click',()=>{ state.proj.measures=[]; markDirty(); draw(); });

$('#vectorize-btn').addEventListener('click',()=>{
  if(!state.img){ toast('Upload an image first'); return; }
  $('#vector-overlay').classList.add('show');
  setTimeout(runVectorize, 40);
});

function runVectorize(){
  try{
    const t=state.proj.trace, cr=cropOrFull();
    // 1. draw cropped region to a working canvas, downscaled for speed
    const maxDim=820;
    let scale=Math.min(1, maxDim/Math.max(cr.w,cr.h));
    const tw=Math.max(2,Math.round(cr.w*scale)), th=Math.max(2,Math.round(cr.h*scale));
    const wc=document.createElement('canvas'); wc.width=tw; wc.height=th;
    const wx=wc.getContext('2d',{willReadFrequently:true});
    wx.drawImage(state.img,cr.x,cr.y,cr.w,cr.h,0,0,tw,th);
    let imgd=wx.getImageData(0,0,tw,th);

    // 2. preprocess -> binary line image
    const bin = (t.mode==='edges')? sobelBinary(imgd,t.thr,t.invert) : thresholdBinary(imgd,t.thr,t.invert);
    wx.putImageData(bin,0,0);

    // 3. ImageTracer
    const detMap=[ {ltres:.5,qtres:.5,pathomit:2},{ltres:1,qtres:1,pathomit:4},
                   {ltres:1.4,qtres:1.4,pathomit:8},{ltres:2.2,qtres:2.2,pathomit:14},{ltres:3.5,qtres:3.5,pathomit:24} ][t.det];
    const opts={
      ltres:detMap.ltres, qtres:detMap.qtres, pathomit:detMap.pathomit,
      pal:[{r:0,g:0,b:0,a:255},{r:255,g:255,b:255,a:255}],
      colorsampling:0, numberofcolors:2, mincolorratio:0, colorquantcycles:1,
      blurradius:t.det>=3?1:0, blurdelta:20, strokewidth:1, linefilter:true, roundcoords:1, scale:1
    };
    const td=ImageTracer.imagedataToTracedata(bin,opts);

    // 4. extract polylines from the dark (line) layer; filter noise by bbox size
    const minDim = t.noise===0?0 : (t.noise/100)*Math.max(tw,th)*1.5; // px
    const polys=[];
    td.layers.forEach((layer,li)=>{
      // layer 0 corresponds to first palette color (black lines)
      layer.forEach(path=>{
        if(!path.segments||path.segments.length<2) return;
        // bbox
        let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
        path.segments.forEach(sg=>{ [sg.x1,sg.x2,sg.x3].forEach(v=>{if(v!=null){if(v<mnx)mnx=v;if(v>mxx)mxx=v;}});
                                     [sg.y1,sg.y2,sg.y3].forEach(v=>{if(v!=null){if(v<mny)mny=v;if(v>mxy)mxy=v;}}); });
        if(Math.max(mxx-mnx,mxy-mny) < minDim) return; // drop small text/specks
        // build normalized polyline
        const poly=[];
        const push=(X,Y)=>poly.push([X/tw, Y/th]);
        push(path.segments[0].x1,path.segments[0].y1);
        path.segments.forEach(sg=>{
          if(sg.type==='Q'||sg.type==='C'){
            // sample quad/cubic
            const x0=sg.x1,y0=sg.y1;
            const steps=4;
            for(let s=1;s<=steps;s++){ const tt=s/steps;
              if(sg.type==='Q'){ const x=qbez(x0,sg.x2,sg.x3,tt),y=qbez(y0,sg.y2,sg.y3,tt); push(x,y); }
              else { push(sg.x4!=null?sg.x4:sg.x3, sg.y4!=null?sg.y4:sg.y3); }
            }
          } else { push(sg.x2,sg.y2); }
        });
        polys.push(poly);
      });
    });
    if(!polys.length){ toast('No lines found — try Invert or lower Sensitivity'); }
    t.rawPolys=polys.map(p=>p.map(q=>[q[0],q[1]]));
    t.visible=true;
    smoothTrace();          // apply current smoothing settings to the fresh raw trace
    syncTracePanel(); markDirty(); draw();
    updateTraceReadout();
    toast(polys.length+' paths traced & smoothed');
  }catch(err){
    console.error(err); toast('Trace failed: '+err.message);
  }finally{
    $('#vector-overlay').classList.remove('show');
  }
}
function qbez(a,b,c,t){ const m=1-t; return m*m*a+2*m*t*b+t*t*c; }

function thresholdBinary(imgd,thrPct,invert){
  const d=imgd.data, n=d.length; const out=new ImageData(imgd.width,imgd.height);
  const o=out.data; const thr=thrPct/100*255;
  for(let i=0;i<n;i+=4){
    const lum=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    let isLine = invert? lum>thr : lum<thr;
    const c=isLine?0:255;
    o[i]=o[i+1]=o[i+2]=c; o[i+3]=255;
  }
  return out;
}
function sobelBinary(imgd,thrPct,invert){
  const w=imgd.width,h=imgd.height,d=imgd.data;
  const lum=new Float32Array(w*h);
  for(let i=0,p=0;i<d.length;i+=4,p++) lum[p]=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
  const out=new ImageData(w,h); const o=out.data;
  // threshold maps 2..98 -> edge magnitude cutoff (lower pct = more sensitive)
  const cut = 20 + (thrPct/100)*180;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x);
    if(x===0||y===0||x===w-1||y===h-1){ o[i*4]=o[i*4+1]=o[i*4+2]=255;o[i*4+3]=255; continue; }
    const gx = -lum[i-w-1]-2*lum[i-1]-lum[i+w-1]+lum[i-w+1]+2*lum[i+1]+lum[i+w+1];
    const gy = -lum[i-w-1]-2*lum[i-w]-lum[i-w+1]+lum[i+w-1]+2*lum[i+w]+lum[i+w+1];
    const mag=Math.hypot(gx,gy);
    const isLine = mag>cut;
    const c=isLine?0:255;
    o[i*4]=o[i*4+1]=o[i*4+2]=c; o[i*4+3]=255;
  }
  return out; // invert not needed for edges (polarity-independent), but allow flip
}

function updateTraceReadout(){
  const bb=traceBBoxInch();
  const el=$('#trace-readout');
  if(!bb || !state.proj.trace.polys){ el.textContent=''; return; }
  el.innerHTML=`<b>${state.proj.trace.polys.length}</b> paths · bounds <b>${fmtLen(bb.maxx-bb.minx)}</b> × <b>${fmtLen(bb.maxy-bb.miny)}</b>`;
}

/* ===================================================================
   SMOOTH & STRAIGHTEN  (geometric refinement of the raw trace)
   Works in normalized u,v space (axis-aligned to the image).
=================================================================== */
function smoothTrace(){
  const t=state.proj.trace;
  if(!t.rawPolys){ t.rawPolys=(t.polys||[]).map(p=>p.map(q=>[q[0],q[1]])); }
  const s=t.smooth==null?45:t.smooth;
  const eps = lerp(0.0015, 0.028, s/100);          // Douglas–Peucker tolerance
  const chaikIters = s===0?0 : (s<30?1:s<65?2:3);
  let out=[];
  t.rawPolys.forEach(poly=>{
    let pts=poly.map(p=>({x:p[0],y:p[1]}));
    if(pts.length<2) return;
    if(s>0) pts=douglasPeucker(pts,eps);            // remove choppy jitter, straighten
    if(t.snap!==false) pts=snapAxis(pts, 5);        // crisp near-horizontal / vertical lines
    else if(chaikIters) pts=chaikin(pts,chaikIters);// gently round remaining curves
    if(pts.length>=2) out.push(pts.map(p=>[p.x,p.y]));
  });
  if(t.symmetry && t.symmetry!=='none') out=applySymmetry(out, t.symmetry);
  t.polys=out;
}
function lerp(a,b,t){ return a+(b-a)*t; }

function douglasPeucker(pts,eps){
  if(pts.length<3) return pts;
  let dmax=0,idx=0; const end=pts.length-1;
  for(let i=1;i<end;i++){ const d=perpDist(pts[i],pts[0],pts[end]); if(d>dmax){dmax=d;idx=i;} }
  if(dmax>eps){
    const l=douglasPeucker(pts.slice(0,idx+1),eps);
    const r=douglasPeucker(pts.slice(idx),eps);
    return l.slice(0,-1).concat(r);
  }
  return [pts[0],pts[end]];
}
function perpDist(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y; const l=Math.hypot(dx,dy);
  if(l===0) return Math.hypot(p.x-a.x,p.y-a.y);
  return Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx)/l;
}
function chaikin(pts,iters){
  let p=pts;
  for(let k=0;k<iters;k++){
    if(p.length<3) break;
    const np=[p[0]];
    for(let i=0;i<p.length-1;i++){
      const a=p[i],b=p[i+1];
      np.push({x:a.x*0.75+b.x*0.25, y:a.y*0.75+b.y*0.25});
      np.push({x:a.x*0.25+b.x*0.75, y:a.y*0.25+b.y*0.75});
    }
    np.push(p[p.length-1]); p=np;
  }
  return p;
}
function snapAxis(pts,tolDeg){
  if(pts.length<2) return pts;
  const tol=Math.tan(tolDeg*Math.PI/180);
  const out=pts.map(p=>({x:p.x,y:p.y}));
  for(let i=0;i<out.length-1;i++){
    const a=out[i],b=out[i+1];
    const dx=b.x-a.x,dy=b.y-a.y;
    if(dx===0&&dy===0) continue;
    if(Math.abs(dy)<Math.abs(dx)*tol){ const y=(a.y+b.y)/2; a.y=y; b.y=y; }       // ~horizontal
    else if(Math.abs(dx)<Math.abs(dy)*tol){ const x=(a.x+b.x)/2; a.x=x; b.x=x; }  // ~vertical
  }
  return out;
}
function applySymmetry(polys, axis){
  const out=polys.map(p=>p.map(q=>[q[0],q[1]]));
  polys.forEach(poly=>{
    out.push(poly.map(([u,v])=> axis==='vertical'? [1-u,v] : [u,1-v] ));
  });
  return out;
}

/* refine handlers */
$('#smooth-str').addEventListener('input',e=>{ const t=state.proj.trace; t.smooth=+e.target.value; $('#smooth-val').textContent=smoothLabel(t.smooth); smoothTrace(); markDirty(); draw(); updateTraceReadout(); });
$('#smooth-snap').addEventListener('change',e=>{ state.proj.trace.snap=e.target.checked; smoothTrace(); markDirty(); draw(); });
$('#smooth-sym').addEventListener('change',e=>{ state.proj.trace.symmetry=e.target.value; smoothTrace(); markDirty(); draw(); updateTraceReadout(); });
$('#smooth-btn').addEventListener('click',()=>{ smoothTrace(); markDirty(); draw(); updateTraceReadout(); toast('Outline smoothed'); });
$('#smooth-reset').addEventListener('click',()=>{ const t=state.proj.trace; if(t.rawPolys){ t.polys=t.rawPolys.map(p=>p.map(q=>[q[0],q[1]])); markDirty(); draw(); updateTraceReadout(); toast('Reset to raw trace'); } });

/* AI identify (beta) — uses the AI service when configured on the server */
$('#identify-btn').addEventListener('click',async ()=>{
  const t=state.proj.trace; if(!t.polys||!t.polys.length){ toast('Vectorize first'); return; }
  $('#identify-btn').textContent='🔎 Identifying…'; $('#identify-btn').disabled=true;
  try{
    const thumb=makeThumb();
    const res=await fetch('/api/identify',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ image:thumb })});
    if(res.ok){
      const data=await res.json();
      if(data.available){
        toast('Identified: '+(data.label||'shape')+' — refining');
        // strong cleanup tuned by the identification
        t.smooth=Math.max(t.smooth,60); t.snap=true;
        if(data.symmetry) t.symmetry=data.symmetry;
        smoothTrace(); syncTracePanel(); markDirty(); draw(); updateTraceReadout();
      } else {
        toast('AI service not enabled — applied best-effort cleanup');
        t.smooth=70; t.snap=true; smoothTrace(); syncTracePanel(); markDirty(); draw();
      }
    } else { throw new Error('unavailable'); }
  }catch(err){
    toast('AI service not enabled — applied best-effort cleanup');
    const t=state.proj.trace; t.smooth=70; t.snap=true; smoothTrace(); syncTracePanel(); markDirty(); draw();
  }finally{
    $('#identify-btn').textContent='🔎 Identify shape with AI (beta)'; $('#identify-btn').disabled=false;
  }
});

/* ===================================================================
   TOOLS + POINTER
=================================================================== */
function setTool(t){
  state.tool=t;
  document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));
  $('#crop-actions').classList.toggle('hidden',t!=='crop');
  if(t==='crop' && !state.img){ toast('Upload an image to crop'); }
  canvas.style.cursor = t==='pan'?'grab': t==='measure'?'crosshair': t==='crop'?'crosshair':'default';
  if(t!=='crop') state.cropRect=null;
  draw();
}
document.querySelectorAll('.tool').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));

document.addEventListener('keydown',e=>{
  if(!state.proj || document.activeElement.tagName==='INPUT'||document.activeElement.tagName==='SELECT'||document.activeElement.tagName==='TEXTAREA') return;
  const k=e.key.toLowerCase();
  if(k==='v')setTool('select'); else if(k==='i')setTool('inspect'); else if(k==='m')setTool('measure');
  else if(k==='c')setTool('crop'); else if(k===' '){ setTool('pan'); e.preventDefault(); }
  else if((k==='s')&&(e.metaKey||e.ctrlKey)){ e.preventDefault(); saveCurrent(); }
});

let pointerDown=false;
canvas.addEventListener('pointerdown',onDown);
canvas.addEventListener('pointermove',onMove);
window.addEventListener('pointerup',onUp);

function onDown(e){
  if(!state.proj)return;
  canvas.setPointerCapture(e.pointerId); pointerDown=true;
  const m=mousePos(e);
  if(state.tool==='pan'){ state.drag={type:'pan',sx:e.clientX,sy:e.clientY,px:state.panX,py:state.panY}; canvas.style.cursor='grabbing'; return; }
  if(state.tool==='measure'){ const p={x:ix(m.x),y:iy(m.y)}; state.drag={type:'measure',x1:p.x,y1:p.y,cx:p.x,cy:p.y}; return; }
  if(state.tool==='crop' && state.img){ state.drag={type:'crop',x:m.x,y:m.y}; state.cropRect={x:m.x,y:m.y,w:0,h:0}; return; }
  if(state.tool==='select' && state.img && state.proj.image){
    // hit test handles
    const h=hitImageHandle(m);
    if(h){ state.drag=h; return; }
    if(pointInImage(m)){ state.drag={type:'move',startMx:m.x,startMy:m.y,ocx:state.proj.image.cx,ocy:state.proj.image.cy}; return; }
  }
  // default: pan with any tool on empty space
  state.drag={type:'pan',sx:e.clientX,sy:e.clientY,px:state.panX,py:state.panY}; canvas.style.cursor='grabbing';
}

function onMove(e){
  if(!state.proj)return;
  const m=mousePos(e);
  if(state.drag){
    const d=state.drag;
    if(d.type==='pan'){ state.panX=d.px+(e.clientX-d.sx); state.panY=d.py+(e.clientY-d.sy); draw(); return; }
    if(d.type==='move'){ const im=state.proj.image; im.cx=d.ocx+(ix(m.x)-ix(d.startMx)); im.cy=d.ocy+(iy(m.y)-iy(d.startMy)); markDirty(); draw(); return; }
    if(d.type==='scale'){ const im=state.proj.image;
      const cen={x:im.cx,y:im.cy}; const now=Math.hypot(ix(m.x)-cen.x,iy(m.y)-cen.y);
      let f=now/d.startDist; im.wIn=Math.max(0.5,d.startW*f); syncImagePanel(); markDirty(); draw(); return; }
    if(d.type==='rotate'){ const im=state.proj.image;
      const ang=Math.atan2(iy(m.y)-im.cy, ix(m.x)-im.cx)*180/Math.PI;
      im.rot=normDeg(d.startRot + (ang - d.startAng)); syncImagePanel(); markDirty(); draw(); return; }
    if(d.type==='measure'){ const p={x:ix(m.x),y:iy(m.y)}; if(e.shiftKey){ // constrain
        const dx=p.x-d.x1,dy=p.y-d.y1; if(Math.abs(dx)>Math.abs(dy))p.y=d.y1; else p.x=d.x1; }
      d.cx=p.x; d.cy=p.y; draw(); return; }
    if(d.type==='crop'){ const r=state.cropRect; r.x=Math.min(d.x,m.x); r.y=Math.min(d.y,m.y); r.w=Math.abs(m.x-d.x); r.h=Math.abs(m.y-d.y); draw(); return; }
  }
  // hover inspect
  if(state.tool==='inspect'){ doHover(m,e); }
  else if(state.hover){ state.hover=null; $('#hover-tip').style.display='none'; draw(); }
  // cursor hint over handles
  if(state.tool==='select' && state.img && state.proj.image && !state.drag){
    canvas.style.cursor = hitImageHandle(m)? 'pointer' : (pointInImage(m)?'move':'default');
  }
}

function onUp(e){
  pointerDown=false;
  if(state.drag){
    if(state.drag.type==='measure'){
      const d=state.drag; const len=Math.hypot(d.cx-d.x1,d.cy-d.y1);
      if(len>0.3){ state.proj.measures.push({x1:d.x1,y1:d.y1,x2:d.cx,y2:d.cy}); markDirty(); }
    }
    const wasPan=state.drag.type==='pan';
    state.drag=null;
    if(state.tool==='pan'||wasPan) canvas.style.cursor= state.tool==='pan'?'grab':'default';
    draw();
  }
}

function mousePos(e){ const r=canvas.getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top}; }
function normDeg(d){ d=((d+180)%360+360)%360-180; return d; }

function pointInImage(m){
  const c=imageCorners();
  return pointInQuad(ix(m.x),iy(m.y),c);
}
function pointInQuad(px,py,q){
  let inside=false;
  for(let i=0,j=3;i<4;j=i++){
    const xi=q[i].x,yi=q[i].y,xj=q[j].x,yj=q[j].y;
    if(((yi>py)!=(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
function hitImageHandle(m){
  const im=state.proj.image;
  const rh=rotateHandlePos();
  if(Math.hypot(m.x-rh.x,m.y-rh.y)<10){
    return {type:'rotate',startRot:im.rot,startAng:Math.atan2(iy(m.y)-im.cy,ix(m.x)-im.cx)*180/Math.PI};
  }
  const c=imageCorners();
  for(let i=0;i<4;i++){ const X=sx(c[i].x),Y=sy(c[i].y);
    if(Math.hypot(m.x-X,m.y-Y)<10){
      return {type:'scale',startDist:Math.hypot(c[i].x-im.cx,c[i].y-im.cy),startW:im.wIn}; }
  }
  return null;
}

/* ---------- hover inspect over traced segments ---------- */
function doHover(m,e){
  const p=state.proj;
  if(!p.trace.polys||!p.trace.visible){ if(state.hover){state.hover=null;$('#hover-tip').style.display='none';draw();} return; }
  let best=null,bestD=10; // px
  const mx=m.x,my=m.y;
  p.trace.polys.forEach(poly=>{
    for(let i=1;i<poly.length;i++){
      const a=uvToInch(poly[i-1][0],poly[i-1][1]), b=uvToInch(poly[i][0],poly[i][1]);
      const ax=sx(a.x),ay=sy(a.y),bx=sx(b.x),by=sy(b.y);
      const d=distToSeg(mx,my,ax,ay,bx,by);
      if(d<bestD){ bestD=d; best={a:poly[i-1],b:poly[i],ai:a,bi:b}; }
    }
  });
  if(best){
    const len=Math.hypot(best.bi.x-best.ai.x, best.bi.y-best.ai.y);
    const ang=segAngle(best.ai.x,best.ai.y,best.bi.x,best.bi.y);
    state.hover={seg:best,len,ang};
    const tip=$('#hover-tip');
    tip.innerHTML=`<b>${fmtLen(len)}</b> &nbsp; ∠ ${ang.toFixed(1)}°`;
    tip.style.display='block';
    tip.style.left=(m.x+14)+'px'; tip.style.top=(m.y+14)+'px';
    updateReadout(len,ang,best);
    draw();
  } else if(state.hover){ state.hover=null; $('#hover-tip').style.display='none'; draw(); }
}
function distToSeg(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1; const l2=dx*dx+dy*dy;
  let t=l2?((px-x1)*dx+(py-y1)*dy)/l2:0; t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-(x1+t*dx), py-(y1+t*dy));
}
function updateReadout(len,ang,seg){
  const bb=traceBBoxInch();
  const cx=bb?(bb.minx+bb.maxx)/2:0, cy=bb?(bb.miny+bb.maxy)/2:0;
  const el=$('#readout');
  el.innerHTML=`
    <div class="big">${fmtLen(len)}</div>
    <div class="row"><span class="k">Angle from horizontal</span><span class="v">${ang.toFixed(1)}°</span></div>
    <div class="row"><span class="k">Δ horizontal</span><span class="v">${fmtLen(Math.abs(seg.bi.x-seg.ai.x))}</span></div>
    <div class="row"><span class="k">Δ vertical</span><span class="v">${fmtLen(Math.abs(seg.bi.y-seg.ai.y))}</span></div>
    ${bb?`<div class="row"><span class="k">Drawing center X</span><span class="v">${fmtLen(cx)} from left</span></div>
    <div class="row"><span class="k">Drawing center Y</span><span class="v">${fmtLen(cy)} from top</span></div>`:''}`;
}

function refreshFoamReadout(){
  const p=state.proj;
  $('#foam-readout').innerHTML=`Board: <b>${fmtLen(p.foam.w)}</b> × <b>${fmtLen(p.foam.h)}</b><br>Center at <b>${fmtLen(p.foam.w/2)}</b> from left, <b>${fmtLen(p.foam.h/2)}</b> from top.`;
}
$('#foam-w').addEventListener('change',e=>{ const v=parseLen(e.target.value); if(isFinite(v)&&v>0){ state.proj.foam.w=v; markDirty(); fitView(); draw(); refreshFoamReadout(); } e.target.value=fmtLen(state.proj.foam.w); });
$('#foam-h').addEventListener('change',e=>{ const v=parseLen(e.target.value); if(isFinite(v)&&v>0){ state.proj.foam.h=v; markDirty(); fitView(); draw(); refreshFoamReadout(); } e.target.value=fmtLen(state.proj.foam.h); });
$('#ws-name').addEventListener('input',()=>markDirty());

/* ---------- zoom ---------- */
canvas.addEventListener('wheel',e=>{
  if(!state.proj)return; e.preventDefault();
  const m=mousePos(e); const before={x:ix(m.x),y:iy(m.y)};
  const f=Math.exp(-e.deltaY*0.0015);
  state.ppi=Math.max(0.4,Math.min(200,state.ppi*f));
  state.panX=m.x-before.x*state.ppi; state.panY=m.y-before.y*state.ppi;
  draw();
},{passive:false});
$('#zoom-in').addEventListener('click',()=>zoomBtn(1.2));
$('#zoom-out').addEventListener('click',()=>zoomBtn(1/1.2));
$('#zoom-fit').addEventListener('click',()=>{ fitView(); draw(); });
function zoomBtn(f){ const cx=CW()/2,cy=CH()/2; const b={x:ix(cx),y:iy(cy)};
  state.ppi=Math.max(0.4,Math.min(200,state.ppi*f)); state.panX=cx-b.x*state.ppi; state.panY=cy-b.y*state.ppi; draw(); }

/* ===================================================================
   PREVIEW  &  TILED 1:1 PRINT
=================================================================== */
const PAPERS={ letter:{pw:8.5,ph:11,name:'Letter'}, a4:{pw:8.27,ph:11.69,name:'A4'} };
let printMode='board';

function tracePathD(ox,oy){
  const t=state.proj.trace; let d='';
  if(!t.polys) return d;
  t.polys.forEach(poly=>{
    poly.forEach((pt,i)=>{ const q=uvToInch(pt[0],pt[1]); d += (i?'L':'M')+(q.x-ox).toFixed(3)+' '+(q.y-oy).toFixed(3)+' '; });
  });
  return d;
}

$('#print-btn').addEventListener('click',()=>openPrint('board'));
$('#pt-close').addEventListener('click',()=>{ $('#print-overlay').classList.remove('open'); document.body.classList.remove('printing'); });
$('#pt-board').addEventListener('click',()=>{ printMode='board'; renderPrint(); });
$('#pt-tiles').addEventListener('click',()=>{ printMode='tiles'; renderPrint(); });
$('#pt-paper').addEventListener('change',()=>renderPrint());
$('#pt-print').addEventListener('click',()=>window.print());
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ $('#print-overlay').classList.remove('open'); document.body.classList.remove('printing'); } });

function openPrint(mode){
  if(!state.proj){ return; }
  printMode=mode;
  $('#print-overlay').classList.add('open');
  document.body.classList.add('printing');
  renderPrint();
}
function renderPrint(){
  $('#pt-board').classList.toggle('active',printMode==='board');
  $('#pt-tiles').classList.toggle('active',printMode==='tiles');
  const pages=$('#print-pages');
  pages.classList.toggle('tiles',printMode==='tiles');
  pages.innerHTML='';
  if(printMode==='board') buildBoardPreview(); else buildTiles();
}

function svgEl(html){ const d=document.createElement('div'); d.innerHTML=html; return d.firstElementChild; }

function buildBoardPreview(){
  const p=state.proj, W=p.foam.w, H=p.foam.h;
  const scale=Math.min(700/W, 560/H, 96);   // px per inch for screen fit
  const pw=W*scale, ph=H*scale;
  const d=tracePathD(0,0);
  const bb=traceBBoxInch();
  const sw=Math.max(0.02, 1.2/scale);        // ~1.2px line on screen
  const page=document.createElement('div');
  page.className='board-page';
  page.style.width=pw+'px'; page.style.height=ph+'px';
  page.innerHTML=`<svg width="${pw}" height="${ph}" viewBox="0 0 ${W} ${H}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff" stroke="#c8ccd6" stroke-width="${sw}"/>
    <line x1="${W/2}" y1="0" x2="${W/2}" y2="${H}" stroke="#e3a14d" stroke-width="${sw*0.7}" stroke-dasharray="${sw*6} ${sw*5}"/>
    <line x1="0" y1="${H/2}" x2="${W}" y2="${H/2}" stroke="#e3a14d" stroke-width="${sw*0.7}" stroke-dasharray="${sw*6} ${sw*5}"/>
    ${d?`<path d="${d}" fill="none" stroke="#10131a" stroke-width="${sw*1.6}" stroke-linejoin="round" stroke-linecap="round"/>`:''}
  </svg>`;
  $('#print-pages').appendChild(page);
  const ob = bb? ` · outline ${fmtLen(bb.maxx-bb.minx)} × ${fmtLen(bb.maxy-bb.miny)}`:'';
  $('#pt-info').textContent=`Board ${fmtLen(W)} × ${fmtLen(H)}${ob}`;
  $('#print-hint').innerHTML = d? `This is how your foam board will look with the cut outline. Switch to <b>Printable tiles</b> to print it full-size.`
    : `Add and <b>Vectorize</b> an image to see the cut outline here.`;
}

function buildTiles(){
  const t=state.proj.trace, bb=traceBBoxInch();
  const info=$('#pt-info');
  if(!t.polys || !bb){ $('#print-hint').innerHTML='Vectorize an outline first — nothing to print yet.'; info.textContent=''; return; }
  const W=bb.maxx-bb.minx, H=bb.maxy-bb.miny;
  const pap=PAPERS[$('#pt-paper').value]||PAPERS.letter;
  const margin=0.5, overlap=0.5;
  const printW=+(pap.pw-2*margin).toFixed(3), printH=+(pap.ph-2*margin).toFixed(3);
  const stepX=printW-overlap, stepY=printH-overlap;
  const cols=Math.max(1,Math.ceil((W-overlap)/stepX)), rows=Math.max(1,Math.ceil((H-overlap)/stepY));
  const d=tracePathD(bb.minx,bb.miny);
  const sw=0.025;
  const pagesEl=$('#print-pages');
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const offX=c*stepX, offY=r*stepY;
      const page=document.createElement('div');
      page.className='print-page';
      page.style.width=printW+'in'; page.style.height=printH+'in';
      // outline layer (full outline, shifted so this tile's region shows)
      const outline=`<svg style="position:absolute;left:${-offX}in;top:${-offY}in" width="${W}in" height="${H}in" viewBox="0 0 ${W} ${H}">
        <path d="${d}" fill="none" stroke="#000" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
      // guides layer (tile-local)
      let guides=`<svg style="position:absolute;left:0;top:0" width="${printW}in" height="${printH}in" viewBox="0 0 ${printW} ${printH}">`;
      guides+=`<rect x="0" y="0" width="${printW}" height="${printH}" fill="none" stroke="#cfd3dc" stroke-width="0.012"/>`;
      if(c<cols-1) guides+=`<line x1="${stepX}" y1="0" x2="${stepX}" y2="${printH}" stroke="#7c8cff" stroke-width="0.012" stroke-dasharray="0.12 0.08"/>`;
      if(r<rows-1) guides+=`<line x1="0" y1="${stepY}" x2="${printW}" y2="${stepY}" stroke="#7c8cff" stroke-width="0.012" stroke-dasharray="0.12 0.08"/>`;
      [[0,0],[stepX,0],[0,stepY],[stepX,stepY]].forEach(([x,y])=>{
        guides+=`<path d="M${x-0.1} ${y} L${x+0.1} ${y} M${x} ${y-0.1} L${x} ${y+0.1}" stroke="#888" stroke-width="0.01"/>`; });
      if(r===0&&c===0){ // calibration square
        guides+=`<rect x="0.25" y="0.25" width="1" height="1" fill="none" stroke="#d33" stroke-width="0.012"/>`;
        guides+=`<text x="0.32" y="0.72" font-size="0.16" fill="#d33" font-family="sans-serif">1 in</text>`;
      }
      guides+=`</svg>`;
      page.innerHTML=outline+guides+
        `<div class="pp-label">Row ${r+1} · Col ${c+1} &nbsp;(grid ${rows}×${cols})</div>`+
        (r===0&&c===0?`<div class="pp-cal" style="left:1.4in">← verify this box prints 1 inch</div>`:'');
      pagesEl.appendChild(page);
    }
  }
  info.textContent=`Outline ${fmtLen(W)} × ${fmtLen(H)} · ${rows*cols} sheets (${cols}×${rows}) at 1:1 · ${pap.name}`;
  $('#print-hint').innerHTML=`Full-size across <b>${rows*cols} sheets</b>. In the print dialog set scale to <b>100% / Actual size</b> (not “Fit to page”), print, trim the white margin, and tape along the <b style="color:#7c8cff">blue dashed seams</b> (½" overlap). Check the red 1-inch box on sheet 1.`;
}

/* ===================================================================
   TOAST + INIT
=================================================================== */
let toastT;
function toast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('show'),2400); }

renderSaves();
