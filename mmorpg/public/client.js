'use strict';
let ZOOM=2;const TS=32;const $=id=>document.getElementById(id);
const cv=$('game');let ctx=cv.getContext('2d');const lightCv=document.createElement('canvas');const lctx=lightCv.getContext('2d');
let W=480,H=270;
function resize(){ZOOM=innerWidth>=1500?3:2;W=Math.ceil(innerWidth/ZOOM);H=Math.ceil(innerHeight/ZOOM);cv.width=W;cv.height=H;lightCv.width=W;lightCv.height=H;ctx.imageSmoothingEnabled=false;}
resize();addEventListener('resize',resize);

function rng(seed){let a=seed>>>0;return function(){a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function mk(w,h,fn){const c=document.createElement('canvas');c.width=w;c.height=h;fn(c.getContext('2d'));return c;}
function rc(g,x,y,w,h,c){g.fillStyle=c;g.fillRect(x,y,w,h);}
function ell(g,cx,cy,rx,ry,c){g.fillStyle=c;for(let dy=-ry;dy<=ry;dy++){const h=Math.round(rx*Math.sqrt(Math.max(0,1-(dy*dy)/(ry*ry+0.01))));g.fillRect(cx-h,cy+dy,Math.max(1,h*2),1);}}
const PAL={grass:['#33572e','#2b4d27','#3d6636','#8fc45e'],forest:['#223f26','#1a3320','#2b4d2e','#4a8a4a'],snow:['#dce8ef','#c3d4df','#f4f9fc','#aac4d6'],cave:['#2c2842','#231f36','#38335a','#8a7fe0'],path:['#a58a5c','#8c7449','#bda171','#6e5a38'],water:['#2b5d99','#244f85','#3b78b8','#a8d8ff']};
function groundTex(name,seed,frame){const p=PAL[name],r=rng(seed*977+name.length*131);return mk(TS,TS,g=>{rc(g,0,0,TS,TS,p[0]);
for(let y=0;y<TS;y+=2)for(let x=0;x<TS;x+=2){const v=r();if(v<0.16)rc(g,x,y,2,2,p[1]);else if(v<0.28)rc(g,x,y,2,2,p[2]);}
if(name==='grass'||name==='forest'){for(let i=0;i<5;i++){const x=Math.floor(r()*TS),y=Math.floor(r()*(TS-3));rc(g,x,y,1,3,r()<0.5?p[2]:p[3]);}if(name==='grass'&&r()<0.12){rc(g,Math.floor(r()*28)+2,Math.floor(r()*28)+2,2,2,r()<0.5?'#f2e36a':'#f08fb0');}}
if(name==='snow'){for(let i=0;i<4;i++)rc(g,Math.floor(r()*TS),Math.floor(r()*TS),1,1,p[3]);}
if(name==='cave'&&r()<0.2){const x=Math.floor(r()*26)+2,y=Math.floor(r()*26)+2;rc(g,x,y,2,4,p[3]);rc(g,x+2,y+2,2,2,p[3]);}
if(name==='path'){for(let i=0;i<4;i++){const x=Math.floor(r()*26),y=Math.floor(r()*26);rc(g,x,y,5,3,p[2]);rc(g,x,y+3,5,1,p[3]);}}
if(name==='water'){for(let i=0;i<4;i++){const x=Math.floor(r()*24),y=(Math.floor(r()*28)+frame*2)%TS;rc(g,x,y,6,1,p[3]);rc(g,x+2,y+1,3,1,p[2]);}}
});}
function treeTex(kind,seed){const r=rng(seed*31+kind.length*7);return mk(40,52,g=>{
if(kind==='grass'){rc(g,17,36,6,15,'#4a2f18');rc(g,17,36,2,15,'#6b4726');const o=seed%2;ell(g,20,22,18,17,'#173d1c');ell(g,20,22,17,16,'#235a29');ell(g,17+o,19,12,10,'#2f7433');ell(g,14+o,15,6,5,'#4a9a48');for(let i=0;i<14;i++){rc(g,6+Math.floor(r()*28),6+Math.floor(r()*26),2,2,r()<0.5?'#3f8a3c':'#1b4a21');}}
else{rc(g,18,42,4,9,'#4a2f18');const snow=kind==='snow';for(let i=0;i<4;i++){const y0=3+i*9;for(let dy=0;dy<14;dy++){const half=Math.round(2+dy*0.9+i*1.2);rc(g,20-half,y0+dy,half*2,1,dy%4===3?'#143a22':'#1d4a2a');rc(g,20,y0+dy,half,1,'#173f25');if(snow&&dy<4){const hh=Math.max(1,half-1);rc(g,20-hh,y0+dy,hh*2,1,'#f4f9fc');}}}}
});}
function rockTex(kind,seed){const r=rng(seed*57+kind.length);const b=kind==='cave'?['#3d3858','#575080','#2a2640']:kind==='snow'?['#8d98a3','#b8c4ce','#5f6a75']:['#6f7378','#9aa0a6','#4a4e53'];return mk(32,26,g=>{ell(g,16,17,14,9,b[2]);ell(g,16,16,13,8,b[0]);ell(g,12,13,7,4,b[1]);for(let i=0;i<8;i++)rc(g,Math.floor(r()*26)+3,Math.floor(r()*14)+8,2,1,b[r()<0.5?1:2]);if(kind==='cave'){rc(g,20,4,3,8,'#9a7bd6');rc(g,23,7,2,5,'#b79cf0');rc(g,8,6,2,6,'#8a6bc6');}});}
const GT={};for(const n of ['grass','forest','snow','cave','path']){GT[n]=[];for(let v=0;v<4;v++)GT[n].push(groundTex(n,v+1,0));}
GT.water=[[],[]];for(let f=0;f<2;f++)for(let v=0;v<2;v++)GT.water[f].push(groundTex('water',v+1,f));
const TT={grass:[],forest:[],snow:[]};for(const k in TT)for(let v=0;v<3;v++)TT[k].push(treeTex(k,v+1));
const RT={grass:[],forest:[],snow:[],cave:[]};for(const k in RT)for(let v=0;v<3;v++)RT[k].push(rockTex(k,v+1));
const GKN=['grass','forest','snow','cave'];

let camX=0,camY=0,FLASH=0;const shCache=new Map();
function shade(h,f){if(h[0]!=='#')return h;const k=h+f;let v=shCache.get(k);if(v)return v;if(h.length===4)h='#'+h[1]+h[1]+h[2]+h[2]+h[3]+h[3];const n=parseInt(h.slice(1),16);let r=n>>16,g=(n>>8)&255,b=n&255;if(f>=0){r+=(255-r)*f;g+=(255-g)*f;b+=(255-b)*f;}else{r*=1+f;g*=1+f;b*=1+f;}v='rgb('+(r|0)+','+(g|0)+','+(b|0)+')';shCache.set(k,v);return v;}
function C(c){if(!FLASH||c[0]!=='#')return c;return shade(c,FLASH);}
function R(x,y,w,h,c){ctx.fillStyle=C(c);ctx.fillRect(Math.round(x-camX),Math.round(y-camY),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));}
function E(cx,cy,rx,ry,c){ctx.fillStyle=C(c);const sx=Math.round(cx-camX),sy=Math.round(cy-camY);rx=Math.max(1,rx);ry=Math.max(1,ry);const ri=Math.round(ry);for(let dy=-ri;dy<=ri;dy++){const h=Math.round(rx*Math.sqrt(Math.max(0,1-(dy*dy)/(ry*ry))));ctx.fillRect(sx-h,sy+dy,Math.max(1,h*2),1);}}
function L(x0,y0,x1,y1,w,c){ctx.fillStyle=C(c);const n=Math.max(1,Math.ceil(Math.hypot(x1-x0,y1-y0)));for(let i=0;i<=n;i++){const t=i/n;ctx.fillRect(Math.round(x0+(x1-x0)*t-camX-w/2),Math.round(y0+(y1-y0)*t-camY-w/2),w,w);}}
function ring(x,y,r,c,th){const n=Math.max(12,Math.round(r*1.3));ctx.fillStyle=c;for(let i=0;i<n;i++){const a=Math.PI*2*i/n;ctx.fillRect(Math.round(x+Math.cos(a)*r-camX),Math.round(y+Math.sin(a)*r-camY),th,th);}}

const LOOK={warrior:{body:'#c0392b',legs:'#4a3b32',hat:'helm',wpn:'sword'},mage:{body:'#8e44ad',legs:'#3b2a4a',hat:'wizard',wpn:'staff'},archer:{body:'#27ae60',legs:'#5a4a2a',hat:'hood',hc:'#1e7a45',wpn:'bow'},cleric:{body:'#ecf0f1',legs:'#c9b458',hat:'halo',hc:'#f1c40f',wpn:'staff'},rogue:{body:'#34495e',legs:'#222b33',hat:'dark',wpn:'dagger'}};
const CLS_UI=[{id:'warrior',name:'Prajurit',color:'#c0392b',desc:'Petarung jarak dekat dengan HP dan pertahanan tinggi.'},{id:'mage',name:'Penyihir',color:'#8e44ad',desc:'Sihir api dan es dengan damage area besar, tetapi rapuh.'},{id:'archer',name:'Pemanah',color:'#27ae60',desc:'Serangan jarak jauh cepat dengan peluang kritikal tinggi.'},{id:'cleric',name:'Pendeta',color:'#f1c40f',desc:'Penyembuh andalan party, juga mampu menyerang dengan sihir suci.'},{id:'rogue',name:'Pembunuh',color:'#34495e',desc:'Serangan cepat berdarah dingin dengan kritikal mematikan.'}];

function human(x,y,o){const b=y+7,dir=o.dir>=0?1:-1,wk=Math.floor(o.walk||0)%2,bob=o.moving?(wk?-1:0):0;
E(x,b,6,2,'rgba(0,0,0,0.3)');
R(x-4,b-4-(o.moving&&wk?1:0),3,4,o.legs);R(x+1,b-4-(o.moving&&!wk?1:0),3,4,o.legs);
R(x-7,b-10+bob,2,5,shade(o.body,-0.2));R(x+5,b-10+bob,2,5,shade(o.body,-0.2));
R(x-5,b-11+bob,10,7,o.body);R(x-5,b-5+bob,10,1,shade(o.body,-0.35));R(x-5,b-11+bob,10,1,shade(o.body,0.25));
R(x-4,b-17+bob,8,6,o.skin||'#f0c89a');
const hc=o.hc||'#5a3b1f';
switch(o.hat){
case 'helm':R(x-5,b-19+bob,10,5,'#9aa3ad');R(x-5,b-15+bob,2,3,'#9aa3ad');R(x+3,b-15+bob,2,3,'#9aa3ad');R(x-1,b-22+bob,2,3,'#c0392b');break;
case 'wizard':R(x-7,b-18+bob,14,2,'#6c3483');R(x-4,b-22+bob,8,4,'#8e44ad');R(x-2,b-26+bob,4,4,'#8e44ad');R(x-4,b-20+bob,8,1,'#f1c40f');break;
case 'hood':R(x-5,b-19+bob,10,5,hc);R(x-5,b-15+bob,2,5,hc);R(x+3,b-15+bob,2,5,hc);break;
case 'halo':R(x-4,b-18+bob,8,3,hc);R(x-3,b-21+bob,6,1,'#ffe66a');break;
case 'dark':R(x-5,b-19+bob,10,5,'#2c3e50');R(x-5,b-15+bob,2,5,'#2c3e50');R(x+3,b-15+bob,2,5,'#2c3e50');R(x-4,b-13+bob,8,2,'#1b2631');break;
case 'skull':R(x-3,b-16+bob,2,3,'#222');R(x+1,b-16+bob,2,3,'#222');R(x-1,b-13+bob,2,1,'#222');break;
default:R(x-4,b-18+bob,8,3,hc);}
if(o.hat!=='skull'){const ex=dir>0?0:-3;R(x+ex,b-15+bob,1,2,'#222');R(x+ex+2,b-15+bob,1,2,'#222');}
if(o.wpn){const hx=x+dir*6,hy=b-8+bob,wc=o.wcol||'#c9ced6';const swing=o.atk>=0&&o.atk<1;let a;
if(swing){a=(o.wpn==='sword'||o.wpn==='dagger')?o.f-1+o.atk*2:o.f;}else a=dir>0?-0.9:-(Math.PI-0.9);
const ux=Math.cos(a),uy=Math.sin(a);
if(o.wpn==='sword'){L(hx,hy,hx+ux*13,hy+uy*13,2,wc);L(hx-uy*3,hy+ux*3,hx+uy*3,hy-ux*3,1,'#d4a84a');}
else if(o.wpn==='dagger'){L(hx,hy,hx+ux*7,hy+uy*7,2,wc);}
else if(o.wpn==='staff'){const s=swing?o.f:(-Math.PI/2+0.2*dir),sx=Math.cos(s),sy=Math.sin(s);L(hx-sx*5,hy-sy*5,hx+sx*13,hy+sy*13,2,'#7a4a1e');E(hx+sx*15,hy+sy*15,3,3,wc);R(hx+sx*15-1,hy+sy*15-1,1,1,'#fff');}
else if(o.wpn==='bow'){const s=swing?o.f:(dir>0?-0.3:-(Math.PI-0.3)),sx=Math.cos(s),sy=Math.sin(s),cx=hx+sx*3,cy=hy+sy*3,px=-sy*8,py=sx*8;L(cx+px,cy+py,cx+sx*3,cy+sy*3,2,'#7a4a1e');L(cx+sx*3,cy+sy*3,cx-px,cy-py,2,'#7a4a1e');L(cx+px,cy+py,cx-px,cy-py,1,'#ddd');if(swing)L(cx,cy,cx+sx*10,cy+sy*10,1,wc);}
}}

function drawPlayer(p,now){const lk=LOOK[p.cls]||LOOK.warrior;const it=p.w&&DEFS.items[p.w];const wc=it?shade(DEFS.rarities[it.rarity].color,0.15):(lk.wpn==='staff'?DEFS.classes[p.cls].color:'#b8bec6');
if(p.dead){R(p.x-4,p.y-6,8,12,'#7d858c');R(p.x-4,p.y-8,8,2,'#9aa3aa');R(p.x-1,p.y-4,2,6,'#4a5056');R(p.x-3,p.y-2,6,2,'#4a5056');return;}
FLASH=(now-p.hitAt)<110?0.5:0;const ap=(now-p.atkAt)/220;
human(p.x,p.y,{dir:Math.cos(p.f)>=0?1:-1,moving:p.moving,walk:p.walk,body:lk.body,legs:lk.legs,hat:lk.hat,hc:lk.hc,wpn:lk.wpn,wcol:wc,atk:ap>=0&&ap<1?ap:-1,f:p.f});FLASH=0;if(p.sw){ctx.globalAlpha=0.65;E(p.x,p.y+4,9,5,'#2b5d99');ctx.globalAlpha=0.9;ring(p.x,p.y+6,7+Math.sin(now/180)*1.5,'#a8d8ff',1);ctx.globalAlpha=1;}}

function drawMonster(e,def,isBoss,now){const r=def.radius,col=def.color,t=now/1000+e.ph;let x=e.x,y=e.y;
const ap=(now-e.atkAt)/280;if(ap>=0&&ap<1){const off=Math.sin(ap*Math.PI)*(isBoss?8:5);x+=Math.cos(e.f)*off;y+=Math.sin(e.f)*off;}
FLASH=(now-e.hitAt)<110?0.6:0;
if(e.dead){const p=Math.min(1,(now-e.deadAt)/(isBoss?2500:1100));ctx.globalAlpha=Math.max(0,1-p);y+=p*r*0.4;}
const aggro=isBoss?(e.st===1||e.st===2):(e.st===2||e.st===3);const dir=Math.cos(e.f)>=0?1:-1;
switch(def.shape){
case 'slime':{const sq=1+0.07*Math.sin(t*5);const rx=r*1.15*sq,ry=r*0.95/sq,cy=y+r*0.25;E(x,y+r*0.9,rx*0.9,r*0.3,'rgba(0,0,0,0.3)');E(x,cy,rx,ry,shade(col,-0.25));E(x,cy-1,rx-1,ry-1,col);E(x-rx*0.35,cy-ry*0.45,Math.max(1,rx*0.25),Math.max(1,ry*0.2),shade(col,0.5));R(x-rx*0.45,cy-ry*0.1,2,3,'#12301a');R(x+rx*0.2,cy-ry*0.1,2,3,'#12301a');if(e.key==='king_slime'){R(x-7,cy-ry-3,14,3,'#f1c40f');R(x-7,cy-ry-6,3,3,'#f1c40f');R(x-1,cy-ry-7,3,4,'#f1c40f');R(x+4,cy-ry-6,3,3,'#f1c40f');R(x-1,cy-ry-5,2,2,'#e74c3c');}break;}
case 'beast':{const wk=e.moving?Math.floor(e.walk)%2:0;const dk=shade(col,-0.3);E(x,y+r*0.7,r*1.2,r*0.3,'rgba(0,0,0,0.3)');R(x-r*0.8,y+r*0.35+wk,2,r*0.5,dk);R(x-r*0.3,y+r*0.35-wk,2,r*0.5,dk);R(x+r*0.3,y+r*0.35+wk,2,r*0.5,dk);R(x+r*0.8-2,y+r*0.35-wk,2,r*0.5,dk);L(x-dir*r*1.1,y-r*0.2,x-dir*r*1.7,y-r*0.7+Math.sin(t*6)*2,2,shade(col,-0.2));E(x,y,r*1.2,r*0.7,col);E(x,y+r*0.3,r*0.9,r*0.28,shade(col,0.2));E(x+dir*r*1.05,y-r*0.3,r*0.55,r*0.5,col);R(x+dir*r*1.45-(dir<0?3:0),y-r*0.15,3,2,dk);R(x+dir*r*0.9-1,y-r*0.95,2,3,shade(col,-0.2));R(x+dir*r*1.25-1,y-r*0.95,2,3,shade(col,-0.2));R(x+dir*r*1.2,y-r*0.45,2,2,aggro?'#ff3030':'#111');if(e.key==='alpha_wolf')R(x-r,y-r*0.7,r*2,2,shade(col,0.25));break;}
case 'undead':human(x,y,{dir,moving:e.moving,walk:e.walk,body:'#cfcab8',legs:'#a9a590',skin:'#e8e4d0',hat:'skull',wpn:'sword',wcol:'#8a8f98',atk:ap>=0&&ap<1?ap:-1,f:e.f});break;
case 'bat':{const fl=Math.sin(t*16)*5;const hy=y-6+Math.sin(t*3)*2;E(x,y+4,5,2,'rgba(0,0,0,0.25)');const wc=shade(col,-0.25);L(x-2,hy,x-13,hy-4+fl,3,wc);L(x-13,hy-4+fl,x-7,hy+4,2,wc);L(x+2,hy,x+13,hy-4+fl,3,wc);L(x+13,hy-4+fl,x+7,hy+4,2,wc);E(x,hy,4,5,col);R(x-3,hy-7,2,3,col);R(x+1,hy-7,2,3,col);R(x-2,hy-2,1,1,'#ff4040');R(x+1,hy-2,1,1,'#ff4040');break;}
case 'golem':{const sw=e.moving?Math.floor(e.walk)%2:0;const a=ap>=0&&ap<1?Math.sin(ap*Math.PI)*r*0.8:0;const eye=aggro?'#ff6a3a':'#9fd8ff';E(x,y+r,r*1.3,r*0.3,'rgba(0,0,0,0.3)');R(x-r*0.8,y+r*0.2+sw,r*0.6,r*0.8,shade(col,-0.3));R(x+r*0.2,y+r*0.2-sw,r*0.6,r*0.8,shade(col,-0.3));R(x-r,y-r*0.9,r*2,r*1.3,col);R(x-r,y-r*0.9,r*2,2,shade(col,0.3));R(x-r*1.5,y-r*0.9-a,r*0.55,r*1.0,shade(col,-0.15));R(x+r*0.95,y-r*0.9-a,r*0.55,r*1.0,shade(col,-0.15));R(x-r*0.5,y-r*1.5,r,r*0.65,shade(col,0.12));R(x-r*0.3,y-r*1.25,2,2,eye);R(x+r*0.15,y-r*1.25,2,2,eye);R(x-r*1.4,y-r*1.4-a,3,r*0.6,shade(col,0.55));R(x+r*1.1,y-r*1.4-a,3,r*0.6,shade(col,0.55));R(x-2,y-r*0.5,4,4,shade(col,0.5));break;}
case 'dragon':{const fl=Math.sin(t*3.5)*r*0.35;E(x,y+r*0.8,r*1.5,r*0.3,'rgba(0,0,0,0.3)');const wc=shade(col,-0.25);const rx0=x-dir*r*0.1,ry0=y-r*0.3,tipx=x-dir*r*1.5,tipy=y-r*1.7+fl;for(let i=0;i<=6;i++)L(rx0,ry0,tipx+dir*i*r*0.22,tipy+i*r*0.28,3,wc);L(x-dir*r*1.0,y+r*0.1,x-dir*r*2.1,y+r*0.45+Math.sin(t*3)*3,Math.max(3,Math.round(r*0.3)),col);R(x-r*0.7,y+r*0.35,r*0.3,r*0.5,shade(col,-0.3));R(x+r*0.4,y+r*0.35,r*0.3,r*0.5,shade(col,-0.3));E(x,y,r*1.1,r*0.7,col);E(x,y+r*0.3,r*0.8,r*0.25,shade(col,0.3));L(x+dir*r*0.7,y-r*0.3,x+dir*r*1.2,y-r*1.0,Math.max(4,Math.round(r*0.4)),col);E(x+dir*r*1.45,y-r*1.1,r*0.5,r*0.32,col);R(x+dir*r*1.45-1,y-r*1.55,3,5,shade(col,0.4));R(x+dir*r*1.7-(dir<0?2:0),y-r*1.2,2,2,aggro?'#ff3030':'#ffe08a');break;}
default:E(x,y,r,r,col);}
ctx.globalAlpha=1;FLASH=0;}

const iconCache={};
function lineG(g,x0,y0,x1,y1,w,c){g.fillStyle=c;const n=Math.max(1,Math.ceil(Math.hypot(x1-x0,y1-y0)));for(let i=0;i<=n;i++){const t=i/n;g.fillRect(Math.round(x0+(x1-x0)*t),Math.round(y0+(y1-y0)*t),w,w);}}
function drawIcon(g,id,d){const c=DEFS.rarities[d.rarity].color;
if(d.type==='equip'){
if(d.slot==='weapon'){
if(d.weaponType==='sword'){lineG(g,3,13,12,4,2,'#d8dee6');lineG(g,2,14,4,12,2,'#7a4a1e');lineG(g,4,9,8,13,2,c);}
else if(d.weaponType==='staff'){lineG(g,3,14,11,6,2,'#8b5a2b');ell(g,12,4,3,3,c);rc(g,11,3,1,1,'#fff');}
else if(d.weaponType==='bow'){lineG(g,10,2,5,6,2,'#8b5a2b');lineG(g,5,6,5,10,2,'#8b5a2b');lineG(g,5,10,10,14,2,'#8b5a2b');lineG(g,10,2,10,14,1,'#ddd');lineG(g,5,8,13,8,1,c);}
else{lineG(g,4,12,11,5,2,'#cfd6de');lineG(g,3,13,5,11,2,'#7a4a1e');rc(g,2,14,2,2,c);}}
else if(d.slot==='helm'){ell(g,8,8,5,4,c);rc(g,3,9,10,3,c);rc(g,5,9,6,2,'#111');}
else if(d.slot==='armor'){rc(g,3,3,10,11,c);rc(g,1,3,3,5,shade(c,-0.3));rc(g,12,3,3,5,shade(c,-0.3));rc(g,7,3,2,11,shade(c,0.3));}
else if(d.slot==='boots'){rc(g,2,5,4,7,c);rc(g,2,10,5,3,c);rc(g,9,5,4,7,c);rc(g,9,10,5,3,c);rc(g,2,13,5,1,'#222');rc(g,9,13,5,1,'#222');}
else{for(let a=0;a<24;a++){const an=a/24*Math.PI*2;rc(g,Math.round(8+Math.cos(an)*4.5),Math.round(10+Math.sin(an)*4.5),2,2,'#e8c46a');}rc(g,7,3,3,3,c);}}
else if(d.type==='consumable'){const red=id.indexOf('hp')===0;const pc=red?'#e0483a':'#4a8be2';rc(g,6,2,4,2,'#aaa');rc(g,7,4,2,3,'#cde');ell(g,8,11,5,4,pc);rc(g,5,9,2,2,shade(pc,0.5));}
else{if(id==='slime_gel'){ell(g,8,10,5,4,'#5ec26a');rc(g,6,8,2,2,'#b9f0c0');}
else if(id==='wolf_fang'){lineG(g,4,3,8,13,3,'#f0ece0');lineG(g,8,13,9,14,1,'#f0ece0');}
else if(id==='bone_shard'){lineG(g,3,12,12,4,3,'#e8e4d0');rc(g,2,11,3,3,'#e8e4d0');rc(g,11,3,3,3,'#e8e4d0');}
else{const cc=id==='frost_core'?'#8fd4ff':id==='dragon_scale'?'#ff6a4a':'#9a7bd6';for(let y=0;y<7;y++){const h=y+1;rc(g,8-h,2+y,h*2,1,cc);}for(let y=0;y<7;y++){const h=7-y;rc(g,8-h,9+y,h*2,1,shade(cc,-0.25));}rc(g,6,5,2,2,'#fff');}}}
function iconUrl(id){let u=iconCache[id];if(u)return u;const d=DEFS.items[id];const c=document.createElement('canvas');c.width=16;c.height=16;drawIcon(c.getContext('2d'),id,d);u=iconCache[id]=c.toDataURL();return u;}

let ws=null,myId=0,CFG=null,DEFS=null,WORLD=null,TILES=null,GK=null,tod=0.3,inv=[],st=null,selCls='warrior';
const players=new Map(),mons=new Map(),bosses=new Map(),loot=new Map();
let fx=[],parts=[],texts=[],tags=[],cdLocal={},cdSeen={},deadInfo=null,shake=0,shopNpc=null,uiDirty=true,hbSlots=[],hbBuilt=false,mini=null,miniBase=null,autoPause=0;
const lootTry=new Map();
function send(o){if(ws&&ws.readyState===1)ws.send(JSON.stringify(o));}
let toastTimer=0;function toast(msg){const t=$('toast');t.textContent=msg;t.style.opacity=1;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.style.opacity=0;},1800);}
function log(msg,c){const d=document.createElement('div');d.textContent=msg;if(c)d.style.color=c;const Lg=$('log');Lg.appendChild(d);while(Lg.children.length>7)Lg.removeChild(Lg.firstChild);setTimeout(()=>{if(d.parentNode)d.parentNode.removeChild(d);},7200);}
function addChat(e){const d=document.createElement('div');const b=document.createElement('b');b.textContent='['+e.lv+'] '+e.name+': ';const s=document.createElement('span');s.textContent=e.text;d.append(b,s);const cl=$('chatlog');cl.appendChild(d);while(cl.children.length>8)cl.removeChild(cl.firstChild);}
const ERR={quest_sudah:'Quest sudah diambil/selesai',quest_prereq:'Selesaikan quest sebelumnya dulu',quest_belum:'Target quest belum selesai',quest_tidak_ada:'Quest tidak ditemukan',poin_kurang:'Poin skill tidak cukup',rank_maks:'Rank skill sudah maksimal',skill_tidak_ada:'Skill tidak ditemukan',level_kurang:'Level belum cukup',senjata_tidak_cocok:'Senjata tidak cocok dengan class-mu',inventaris_penuh:'Tas penuh!',mp_kurang:'MP tidak cukup',gold_kurang:'Emas tidak cukup',terlalu_jauh:'Terlalu jauh',bukan_milikmu:'Item itu milik pemain lain',tidak_perlu:'HP/MP sudah penuh',bukan_equipment:'Bukan perlengkapan',tidak_dijual:'Tidak dijual'};
const BUFFN={roar:'Raungan',focus:'Fokus',bless:'Berkah',poison:'Racun'};

function authErr(m){$('autherr').textContent=m||'';}
function openSocket(cb){if(ws&&ws.readyState===1){cb();return;}ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host);ws.onopen=cb;ws.onmessage=e=>{try{onMsg(JSON.parse(e.data));}catch(err){console.error(err);}};
ws.onclose=()=>{const was=!!WORLD;WORLD=null;ws=null;players.clear();mons.clear();bosses.clear();loot.clear();$('hud').classList.add('hide');$('auth').classList.remove('hide');authErr(was?'Koneksi terputus. Silakan masuk lagi.':'Tidak bisa terhubung ke server.');};ws.onerror=()=>{};}
function doAuth(type){const name=$('nm').value.trim(),pass=$('pw').value;if(!name||!pass){authErr('Isi nama dan password.');return;}authErr('Menghubungkan...');localStorage.setItem('tl_name',name);localStorage.setItem('tl_cls',selCls);openSocket(()=>send({t:type,name,pass,cls:selCls}));}
function selectCls(id){selCls=id;const c=CLS_UI.find(x=>x.id===id);for(const el of $('classes').children)el.classList.toggle('sel',el.dataset.id===id);$('clsdesc').textContent=c.desc;}
function buildClassCards(){const box=$('classes');CLS_UI.forEach(c=>{const d=document.createElement('div');d.className='cls';const cn=document.createElement('canvas');cn.width=28;cn.height=28;const g=cn.getContext('2d');const sv=ctx,sx=camX,sy=camY;ctx=g;camX=0;camY=0;const lk=LOOK[c.id];human(14,19,{dir:1,moving:false,walk:0,body:lk.body,legs:lk.legs,hat:lk.hat,hc:lk.hc,wpn:lk.wpn,wcol:lk.wpn==='staff'?c.color:'#c9ced6',atk:-1,f:0});ctx=sv;camX=sx;camY=sy;d.appendChild(cn);const s=document.createElement('div');s.textContent=c.name;d.appendChild(s);d.onclick=()=>selectCls(c.id);d.dataset.id=c.id;box.appendChild(d);});selectCls(localStorage.getItem('tl_cls')||'warrior');$('nm').value=localStorage.getItem('tl_name')||'';}

function onMsg(m){switch(m.t){case 'autherr':authErr(m.msg);break;case 'init':onInit(m);break;case 'snap':onSnap(m);break;case 'board':showBoard(m.rows);break;default:break;}}
function zoneAt(x,y){let best=null,ba=1e18;for(const z of DEFS.zones){const r=z.rect;if(x<r.x||y<r.y||x>=r.x+r.w||y>=r.y+r.h)continue;const a=r.w*r.h;if(a<ba){ba=a;best=z;}}return best;}
function onInit(m){myId=m.id;CFG=m.cfg;DEFS=m.defs;const bin=atob(m.world.tiles);TILES=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)TILES[i]=bin.charCodeAt(i);WORLD={w:m.world.w,h:m.world.h};
GK=new Uint8Array(WORLD.w*WORLD.h);for(let ty=0;ty<WORLD.h;ty++)for(let tx=0;tx<WORLD.w;tx++){const z=zoneAt((tx+0.5)*TS,(ty+0.5)*TS);GK[ty*WORLD.w+tx]=z?(z.id==='forest'?1:z.id==='tundra'?2:z.id==='cave'?3:0):0;}
players.clear();mons.clear();bosses.clear();loot.clear();setAuto(false);fx=[];parts=[];texts=[];inv=[];st=null;hbBuilt=false;cdLocal={};cdSeen={};deadInfo=null;
buildMini();$('auth').classList.add('hide');$('hud').classList.remove('hide');authErr('');uiDirty=true;log('Selamat datang di Tanah Legenda!','#ffd95e');}
function buildMini(){if(!mini){mini=document.createElement('canvas');mini.width=128;mini.height=128;mini.style.cssText='position:fixed;top:6px;right:6px;border:2px solid #2d3d33;border-radius:8px;background:#0b100c;image-rendering:pixelated;width:128px;height:128px';$('hud').appendChild(mini);$('log').style.top='146px';}
const GC=[[0x33,0x57,0x2e],[0x22,0x3f,0x26],[0xdc,0xe8,0xef],[0x3a,0x35,0x50]];miniBase=mk(WORLD.w,WORLD.h,g=>{const id=g.createImageData(WORLD.w,WORLD.h);for(let i=0;i<WORLD.w*WORLD.h;i++){const t=TILES[i];let c;if(t===3)c=[0x2b,0x5d,0x99];else if(t===1)c=[0x17,0x3d,0x1c];else if(t===2)c=[0x6f,0x73,0x78];else if(t===7||t===4)c=[0xa5,0x8a,0x5c];else c=GC[GK[i]];id.data[i*4]=c[0];id.data[i*4+1]=c[1];id.data[i*4+2]=c[2];id.data[i*4+3]=255;}g.putImageData(id,0,0);});}

function findEnt(id){return players.get(id)||mons.get(id)||bosses.get(id);}
function setMon(s,now){let e=mons.get(s.id);if(!e){e={x:s.x,y:s.y,walk:0,atkAt:-1e9,hitAt:-1e9,deadAt:0,dead:false,ph:Math.random()*6};mons.set(s.id,e);}e.id=s.id;e.type=s.ty;e.gx=s.x;e.gy=s.y;e.f=s.f;e.hp=s.hp;e.mhp=s.mhp;e.st=s.st;if(s.st===5&&!e.dead){e.dead=true;e.deadAt=now;}}
function onSnap(m){if(!WORLD)return;const now=performance.now();tod=m.tod;const seen=new Set();
for(const s of m.pl){seen.add(s.id);let e=players.get(s.id);if(!e){e={x:s.x,y:s.y,walk:0,atkAt:-1e9,hitAt:-1e9};players.set(s.id,e);}e.id=s.id;e.name=s.name;e.cls=s.cls;e.lv=s.lv;e.gx=s.x;e.gy=s.y;e.f=s.f;e.hp=s.hp;e.mhp=s.mhp;e.dead=s.dead;e.w=s.w;e.sw=s.sw;}
for(const id of Array.from(players.keys()))if(!seen.has(id))players.delete(id);
if(m.m){for(const s of m.m.a)setMon(s,now);for(const s of m.m.u)setMon(s,now);for(const id of m.m.d)mons.delete(id);}
const sb=new Set();if(m.b)for(const s of m.b){sb.add(s.id);let e=bosses.get(s.id);if(!e){e={x:s.x,y:s.y,walk:0,atkAt:-1e9,hitAt:-1e9,deadAt:0,dead:false,ph:Math.random()*6};bosses.set(s.id,e);}e.id=s.id;e.key=s.key;e.name=s.name;e.lv=s.lv;e.gx=s.x;e.gy=s.y;e.f=s.f;e.hp=s.hp;e.mhp=s.mhp;e.st=s.st;e.phase=s.ph;e.cast=s.cast;if(s.st===4&&!e.dead){e.dead=true;e.deadAt=now;}else if(s.st!==4)e.dead=false;}
for(const id of Array.from(bosses.keys()))if(!sb.has(id))bosses.delete(id);
if(m.l){for(const s of m.l.a)loot.set(s.id,{id:s.id,it:s.it,n:s.n,x:s.x,y:s.y,mine:s.mine});for(const id of m.l.d){loot.delete(id);lootTry.delete(id);}}
if(m.ev)for(const e of m.ev)onEv(e,now);
if(m.inv){inv=m.inv;uiDirty=true;}if(m.st){st=m.st;uiDirty=true;}
if(m.cd){for(const id in m.cd){if(cdSeen[id]!==m.cd[id]){cdSeen[id]=m.cd[id];const sk=skillById(id);cdLocal[id]={start:now,dur:sk?sk.cooldownMs:1000};}}}}
function skillById(id){const me=players.get(myId);if(!me)return null;const c=DEFS.classes[me.cls];return c?c.skills.find(s=>s.id===id):null;}
function spark(x,y,c,n){const now=performance.now();for(let i=0;i<n;i++)parts.push({x,y,vx:(Math.random()-0.5)*90,vy:-Math.random()*70-10,g:160,born:now,life:400+Math.random()*300,c,s:Math.random()<0.5?1:2});}
function killProj(own,x,y){for(const f of fx){if(f.k!=='proj'||f.own!==own)continue;const d=(performance.now()-f.born)/1000*f.sp;if(Math.hypot(f.x+Math.cos(f.f)*d-x,f.y+Math.sin(f.f)*d-y)<40){f.born=-1e12;break;}}}
function onEv(e,now){switch(e.t){
case 'dmg':{const tg=findEnt(e.id);if(tg)tg.hitAt=now;let c='#ffffff',txt=String(e.v),big=false;if(e.heal){c='#6aff8a';txt='+'+e.v;}else if(e.me){c='#ff5a4a';}else if(e.crit){c='#ffd23a';txt=e.v+'!';big=true;}else if(e.by!==myId){c='#cfd8d0';}texts.push({x:e.x+(Math.random()*10-5),y:e.y-14,t:txt,c,big,born:now});if(!e.heal)spark(e.x,e.y,e.me?'#ff5a4a':'#fff3b0',e.crit?7:3);if(e.by)killProj(e.by,e.x,e.y);if(e.me&&e.id===myId)shake=Math.max(shake,e.v>200?4:2);break;}
case 'swing':{const p=players.get(e.id);if(p)p.atkAt=now;fx.push({k:'swing',x:e.x,y:e.y,f:e.f,r:e.r,a:e.a,fxn:e.fx,born:now,dur:200});break;}
case 'shoot':{const p=players.get(e.id);if(p)p.atkAt=now;fx.push({k:'proj',own:e.id,x:e.x,y:e.y,f:e.f,c:e.c,sp:e.sp,rg:e.rg,born:now});break;}
case 'boom':fx.push({k:'boom',x:e.x,y:e.y,r:e.r,c:e.c,born:now,dur:350});spark(e.x,e.y,e.c,8);break;
case 'warn':fx.push({k:'tele',x:e.x,y:e.y,r:e.r,c:e.c,born:now,dur:e.ms});break;
case 'bcast':fx.push({k:'tele',x:e.x,y:e.y,r:e.ty==='summon'?60:e.r,c:e.ty==='summon'?'#b45fe0':'#ff3a2a',born:now,dur:e.ms});log(e.name+'!','#ff9a6a');break;
case 'bhit':fx.push({k:'boom',x:e.x,y:e.y,r:e.r,c:'#ff5a3a',born:now,dur:450});shake=Math.max(shake,6);break;
case 'bphase':log(e.name+' memasuki fase '+e.phase+'!','#ff9a6a');toast(e.name+' - Fase '+e.phase);shake=Math.max(shake,8);break;
case 'bsummon':fx.push({k:'ring',x:e.x,y:e.y,r:70,c:'#b45fe0',born:now,dur:600});break;
case 'bdie':fx.push({k:'boom',x:e.x,y:e.y,r:90,c:'#ffd95e',born:now,dur:800});spark(e.x,e.y,'#ffd95e',30);shake=Math.max(shake,8);break;
case 'heal':fx.push({k:'ring',x:e.x,y:e.y,r:e.r||30,c:'#6aff8a',born:now,dur:600});for(let i=0;i<5;i++)spark(e.x+(Math.random()-0.5)*20,e.y,'#6aff8a',1);break;
case 'buff':fx.push({k:'ring',x:e.x,y:e.y,r:e.r||24,c:e.c||'#fff',born:now,dur:700});break;
case 'dash':fx.push({k:'ring',x:e.x,y:e.y,r:16,c:'#9aa3ad',born:now,dur:300});spark(e.x,e.y,'#9aa3ad',6);break;
case 'mdie':{const mm=mons.get(e.id);spark(e.x,e.y,mm&&DEFS.monsters[mm.type]?DEFS.monsters[mm.type].color:'#ccc',12);break;}
case 'pdie':spark(e.x,e.y,'#ff5a4a',12);break;
case 'levelup':if(e.id!==undefined){fx.push({k:'ring',x:e.x,y:e.y,r:34,c:'#ffd95e',born:now,dur:900});texts.push({x:e.x,y:e.y-26,t:'LEVEL UP!',c:'#ffd95e',big:true,born:now});spark(e.x,e.y,'#ffd95e',16);log(e.name+' naik ke level '+e.lv+'!','#ffd95e');}else toast('Level naik! Sekarang level '+e.level);break;
case 'announce':log(e.msg,'#ffd95e');break;
case 'chat':addChat(e);{const cp=players.get(e.id);if(cp)cp.bubble={t:String(e.text).slice(0,120),at:now};}break;
case 'matk':{const t=mons.get(e.id)||bosses.get(e.id);if(t)t.atkAt=now;break;}
case 'died':deadInfo={by:e.by,loss:e.loss,until:now+e.ms};break;
case 'respawn':deadInfo=null;break;
case 'xp':{const me=players.get(myId);if(me)texts.push({x:me.x,y:me.y-22,t:'+'+e.v+' XP',c:'#e0c040',born:now});break;}
case 'got':{const d=DEFS.items[e.item];if(d)log('Mendapat '+d.name+' x'+e.n,DEFS.rarities[d.rarity].color);break;}
case 'raidreward':log('Hadiah raid '+e.boss+': '+e.share+'% - +'+e.xp+' XP, +'+e.gold+' emas','#ffd95e');toast('Raid selesai! +'+e.xp+' XP, +'+e.gold+' emas');break;
case 'qaccept':toast('Quest diterima: '+e.name);log('Quest diterima: '+e.name,'#9fd8ff');break;
case 'qready':toast('Quest siap diklaim: '+e.name);log('Quest siap diklaim: '+e.name,'#ffd95e');break;
case 'qdone':toast('Quest selesai: '+e.name);log('Quest selesai: '+e.name+' (+'+e.xp+' XP, +'+e.gold+' emas)','#ffd95e');break;
case 'err':if(e.code==='inventaris_penuh')autoPause=now+4000;if(ERR[e.code])toast(ERR[e.code]);break;
default:break;}}

const keys=new Set();let mx=0,my=0,aimMode='move',moveF=0,lastMouseAt=0,mouseDown=false,lastAtk=0,lastIn={dx:9,dy:9,f:9},lastInAt=0,lastAuto=0,lastHud=0,lastT=performance.now();
function aim(){const me=players.get(myId);if(!me)return{f:0,x:0,y:0};if(aimMode==='mouse'){const wx=mx+camX,wy=my+camY;return{f:Math.atan2(wy-me.y,wx-me.x),x:wx,y:wy};}
let best=null,bd=260*260;for(const m of mons.values()){if(m.dead)continue;const d=(m.x-me.x)**2+(m.y-me.y)**2;if(d<bd){bd=d;best=m;}}for(const b of bosses.values()){if(b.dead)continue;const d=(b.x-me.x)**2+(b.y-me.y)**2;if(d<bd){bd=d;best=b;}}
if(best)return{f:Math.atan2(best.y-me.y,best.x-me.x),x:best.x,y:best.y};return{f:moveF,x:me.x+Math.cos(moveF)*120,y:me.y+Math.sin(moveF)*120};}
function doAttack(){const me=players.get(myId);if(!me||me.dead)return;send({t:'attack',facing:aim().f});}
function doSkill(i){const me=players.get(myId);if(!me||me.dead)return;const sk=DEFS.classes[me.cls].skills[i];if(!sk)return;if(st&&st.lv<sk.level){toast('Skill ini butuh level '+sk.level);return;}const a=aim();send({t:'skill',i,facing:a.f,x:a.x,y:a.y});}
function potSlots(kind){const out=[];for(let i=0;i<inv.length;i++){const s=inv[i];if(!s)continue;const d=DEFS.items[s.id];if(d&&d.type==='consumable'&&d.effect&&d.effect[kind])out.push({i,v:d.effect[kind],n:s.n});}return out;}
function usePot(kind){if(!st)return;const l=potSlots(kind);if(!l.length){toast('Tidak ada ramuan '+(kind==='hp'?'HP':'MP'));return;}const miss=kind==='hp'?st.mhp-st.hp:st.mmp-st.mp;l.sort((a,b)=>a.v-b.v);let pick=l[l.length-1];for(const c of l)if(c.v>=miss){pick=c;break;}send({t:'use',slot:pick.i});}
function sendInput(now){const me=players.get(myId);if(!me)return;if(me.dead){lastIn.dx=9;return;}let dx=0,dy=0;if(keys.has('a')||keys.has('arrowleft'))dx-=1;if(keys.has('d')||keys.has('arrowright'))dx+=1;if(keys.has('w')||keys.has('arrowup'))dy-=1;if(keys.has('s')||keys.has('arrowdown'))dy+=1;
if(!dx&&!dy&&AUTO.on){dx=AUTO.dx;dy=AUTO.dy;}
if(dx||dy){moveF=Math.atan2(dy,dx);if(aimMode==='mouse'&&now-lastMouseAt>4000)aimMode='move';}
const f=Math.round((AUTO.on&&AUTO.fac!==null?AUTO.fac:aim().f)*20)/20;const mc=dx!==lastIn.dx||dy!==lastIn.dy;if(mc||(now-lastInAt>80&&f!==lastIn.f)||now-lastInAt>1000){send({t:'input',dx,dy,facing:f});lastIn={dx,dy,f};lastInAt=now;}}
function nearNpc(me){let best=null,bd=1e9;for(const n of DEFS.npcs){const d=Math.hypot(n.x-me.x,n.y-me.y);if(d<=90&&d<bd){bd=d;best=n;}}return best;}
function interact(){const me=players.get(myId);if(!me||me.dead)return;const n=nearNpc(me);if(n){if(n.role==='shop')openShop(n);else if(n.role==='healer'){send({t:'heal_npc'});toast(n.greeting+' (biaya '+Math.round(me.lv*2)+' emas)');}return;}let c=0;for(const l of loot.values()){if(l.mine&&Math.hypot(l.x-me.x,l.y-me.y)<=40&&c<5){send({t:'pickup',id:l.id});c++;}}if(!c)toast('Tidak ada yang bisa diambil di sini');}
function autoPick(now){const me=players.get(myId);if(!me||me.dead||now<autoPause)return;let c=0;for(const l of loot.values()){if(!l.mine||c>=3)continue;if(Math.hypot(l.x-me.x,l.y-me.y)>34)continue;if(now-(lootTry.get(l.id)||0)<900)continue;lootTry.set(l.id,now);send({t:'pickup',id:l.id});c++;}}

const AUTO={on:false,dx:0,dy:0,fac:null,target:null,anchor:null,lastAtk:0,lastPot:0,lastAnySk:0,lastSk:{}};
function setAuto(on){AUTO.on=on;AUTO.dx=0;AUTO.dy=0;AUTO.fac=null;AUTO.target=null;AUTO.anchor=null;const b=$('bAuto');if(b){b.textContent='Auto (T): '+(on?'ON':'OFF');b.style.background=on?'#f5c842':'';b.style.color=on?'#1a1a10':'';}}
function toggleAuto(){const me=players.get(myId);if(!me||me.dead)return;const on=!AUTO.on;setAuto(on);if(on)AUTO.anchor={x:me.x,y:me.y};toast(on?'Auto battle AKTIF (T untuk mematikan)':'Auto battle MATI');}
function autoPickTarget(me){let best=null,bd=1e18;for(const m of mons.values()){if(m.dead)continue;const d=DEFS.monsters[m.type];if(!d)continue;if(st&&d.level>st.lv+6)continue;if(Math.hypot(m.x-AUTO.anchor.x,m.y-AUTO.anchor.y)>380)continue;let nb=false;for(const b of bosses.values())if(!b.dead&&Math.hypot(b.x-m.x,b.y-m.y)<320){nb=true;break;}if(nb)continue;const dd=(m.x-me.x)**2+(m.y-me.y)**2;if(dd<bd){bd=dd;best=m;}}return best;}
function autoTick(now){AUTO.dx=0;AUTO.dy=0;AUTO.fac=null;if(!AUTO.on)return;const me=players.get(myId);if(!me||!st||!DEFS)return;
if(me.dead){setAuto(false);toast('Auto battle berhenti karena kamu gugur');return;}
if(!AUTO.anchor)AUTO.anchor={x:me.x,y:me.y};
if(now-AUTO.lastPot>1200){if(st.hp<st.mhp*0.45&&potSlots('hp').length){AUTO.lastPot=now;usePot('hp');}else if(st.mp<st.mmp*0.2&&potSlots('mp').length){AUTO.lastPot=now;usePot('mp');}else if(st.hp<st.mhp*0.25&&!potSlots('hp').length){setAuto(false);toast('HP rendah dan ramuan habis - auto battle dihentikan');return;}}
let t=AUTO.target;if(!t||t.dead||mons.get(t.id)!==t||Math.hypot(t.x-AUTO.anchor.x,t.y-AUTO.anchor.y)>480)t=AUTO.target=autoPickTarget(me);
if(!t){const d=Math.hypot(AUTO.anchor.x-me.x,AUTO.anchor.y-me.y);if(d>40){AUTO.dx=(AUTO.anchor.x-me.x)/d;AUTO.dy=(AUTO.anchor.y-me.y)/d;}return;}
const cls=DEFS.classes[me.cls],basic=cls.basic||{};const ddx=t.x-me.x,ddy=t.y-me.y,dist=Math.hypot(ddx,ddy),tr=(DEFS.monsters[t.type]||{}).radius||8;const f=Math.atan2(ddy,ddx);AUTO.fac=f;
const ranged=basic.type==='projectile';const hold=ranged?(basic.range||200)*0.7:Math.max(10,(basic.range||40)*0.6)+tr;
if(dist>hold){AUTO.dx=ddx/dist;AUTO.dy=ddy/dist;}
const reach=(basic.range||40)+tr;
if(dist<=reach+4&&now-AUTO.lastAtk>150){AUTO.lastAtk=now;send({t:'attack',facing:f});}
if(now-AUTO.lastAnySk<350)return;
for(let i=cls.skills.length-1;i>=0;i--){const s=cls.skills[i];if(st.lv<s.level)continue;if(now-(AUTO.lastSk[s.id]||0)<500)continue;const c=cdLocal[s.id];if(c&&now-c.start<c.dur)continue;if(st.mp<s.mp)continue;
let use=false;if(s.type==='heal_aoe')use=st.hp<st.mhp*0.6;else if(s.type==='buff'||s.type==='buff_aoe')use=dist<=reach+60;else if(s.type==='aoe')use=dist<=(s.radius||60)+tr;else if(s.type==='dash')use=false;else use=dist<=(s.range||basic.range||40)+tr;
if(!use)continue;AUTO.lastSk[s.id]=now;AUTO.lastAnySk=now;send({t:'skill',i,facing:f,x:t.x,y:t.y});break;}}
function toggleWin(id){const el=$(id);const open=el.classList.contains('hide');el.classList.toggle('hide');if(open){uiDirty=true;if(id==='boardwin')send({t:'board'});}if(id==='shopwin'&&!open)shopNpc=null;}
function closeWins(){for(const id of ['invwin','shopwin','boardwin','profwin','questwin','skillwin','mapwin'])$(id).classList.add('hide');shopNpc=null;}
function openChat(){const c=$('chatin');c.classList.remove('hide');c.focus();}
function closeChat(){const c=$('chatin');c.value='';c.classList.add('hide');c.blur();}
addEventListener('keydown',e=>{if(!WORLD)return;const k=e.key.toLowerCase();if(document.activeElement===$('chatin')){if(k==='enter'){const t=$('chatin').value.trim();if(t)send({t:'chat',text:t});closeChat();}else if(k==='escape')closeChat();return;}
if(k==='enter'){openChat();e.preventDefault();return;}if(k==='escape'){closeWins();return;}
keys.add(k);if(k===' '||k.indexOf('arrow')===0)e.preventDefault();
if(e.repeat)return;if(k==='1'||k==='2'||k==='3')doSkill(Number(k)-1);else if(k==='q')usePot('hp');else if(k==='e')usePot('mp');else if(k==='f')interact();else if(k==='i')toggleWin('invwin');else if(k==='l')toggleWin('boardwin');else if(k==='p')toggleWin('profwin');else if(k==='j')toggleWin('questwin');else if(k==='k')toggleWin('skillwin');else if(k==='t')toggleAuto();else if(k==='n'&&mini)mini.style.display=mini.style.display==='none'?'block':'none';else if(k==='m')toggleWin('mapwin');});
addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));addEventListener('blur',()=>{keys.clear();mouseDown=false;});
cv.addEventListener('mousemove',e=>{mx=e.clientX/innerWidth*W;my=e.clientY/innerHeight*H;aimMode='mouse';lastMouseAt=performance.now();});
cv.addEventListener('mousedown',e=>{mx=e.clientX/innerWidth*W;my=e.clientY/innerHeight*H;aimMode='mouse';lastMouseAt=performance.now();if(e.button===2){doSkill(0);return;}const wx=mx+camX,wy=my+camY;for(const l of loot.values()){if(Math.hypot(l.x-wx,l.y-wy)<14){send({t:'pickup',id:l.id});return;}}mouseDown=true;});
addEventListener('mouseup',()=>{mouseDown=false;});cv.addEventListener('contextmenu',e=>e.preventDefault());

function buildHotbar(me){const hb=$('hotbar');hb.innerHTML='';hbSlots=[];const cls=DEFS.classes[me.cls];
const add=o=>{const el=document.createElement('div');el.className='slot';const k=document.createElement('span');k.className='key';k.textContent=o.key;const cd=document.createElement('div');cd.className='cd';const q=document.createElement('span');q.className='qty';if(o.pot){el.style.backgroundImage='url('+iconUrl(o.pot==='hp'?'hp_potion_s':'mp_potion_s')+')';el.style.backgroundSize='70%';el.style.backgroundRepeat='no-repeat';el.style.backgroundPosition='center';el.style.imageRendering='pixelated';}else{const n=document.createElement('span');n.className='nm';n.textContent=o.name;el.appendChild(n);}el.appendChild(k);el.appendChild(cd);el.appendChild(q);el.title=o.title||o.name;el.onclick=o.act;hb.appendChild(el);hbSlots.push({el,cd,qty:q,sk:o.sk,pot:o.pot});};
add({key:'Spasi',name:'Serang',title:'Serangan dasar (Spasi / klik)',act:doAttack});
cls.skills.forEach((s,i)=>add({key:String(i+1),name:s.name,sk:s,title:s.name+' - MP '+s.mp+' - CD '+(s.cooldownMs/1000)+'s - Lv '+s.level,act:()=>doSkill(i)}));
add({key:'Q',name:'Ramuan HP',pot:'hp',act:()=>usePot('hp')});add({key:'E',name:'Ramuan MP',pot:'mp',act:()=>usePot('mp')});hbBuilt=true;}
function updateHotbar(now){for(const s of hbSlots){let rem=0,lock=false;if(s.sk){const c=cdLocal[s.sk.id];if(c)rem=Math.max(0,1-(now-c.start)/c.dur);lock=st?st.lv<s.sk.level:false;}if(s.pot){let n=0;for(const p of potSlots(s.pot))n+=p.n;s.qty.textContent=n||'';lock=!n;}s.cd.style.height=(rem*100)+'%';s.el.classList.toggle('lock',lock);}}
function pad(n){return n<10?'0'+n:''+n;}
function updateHud(now){const me=players.get(myId);if(!st||!me)return;
$('hpf').style.width=Math.max(0,Math.min(100,st.hp/st.mhp*100))+'%';$('hptxt').textContent='HP '+st.hp+' / '+st.mhp;$('mpf').style.width=Math.max(0,Math.min(100,st.mp/st.mmp*100))+'%';$('mptxt').textContent='MP '+st.mp+' / '+st.mmp;
$('xpf').style.width=(st.xpn>0?Math.min(100,st.xp/st.xpn*100):100)+'%';$('xptxt').textContent=st.xpn>0?('XP '+st.xp+' / '+st.xpn):'LEVEL MAKS';
let bf='';for(const b of st.buffs||[])bf+=' ['+(BUFFN[b.id]||b.id)+' '+Math.ceil(b.ms/1000)+'s]';
$('lvl').textContent='Lv '+st.lv+' '+(DEFS.classes[me.cls]?DEFS.classes[me.cls].name:'')+bf;$('gold').textContent=st.gold.toLocaleString('id-ID');
const z=zoneAt(me.x,me.y);$('zone').innerHTML=z?('<b>'+z.name+'</b> Lv '+z.levelRange[0]+'-'+z.levelRange[1]):'<b>Dataran Liar</b>';
$('coord').textContent=Math.round((me.x-CFG.spawn.x)/TS)+', '+Math.round((me.y-CFG.spawn.y)/TS);
const h=tod*24,hh=Math.floor(h),mm=Math.floor((h-hh)*60);$('clock').textContent=pad(hh)+':'+pad(mm)+' WIB - '+((tod>=CFG.nightStart&&tod<CFG.nightEnd)?'Malam':'Siang');$('online').textContent=players.size+' pemain di sekitar';
let bb=null,bdist=800;for(const b of bosses.values()){if(b.dead||b.st===4)continue;const d=Math.hypot(b.x-me.x,b.y-me.y);if(d<bdist&&(b.st>0||b.hp<b.mhp)){bdist=d;bb=b;}}
if(bb){$('bossbar').classList.remove('hide');$('bossname').textContent=bb.name+' (Lv '+bb.lv+') - Fase '+bb.phase;$('bossf').style.width=(bb.hp/bb.mhp*100)+'%';$('bosstxt').textContent=bb.hp.toLocaleString('id-ID')+' / '+bb.mhp.toLocaleString('id-ID');}else $('bossbar').classList.add('hide');
if(me.dead){$('dead').classList.remove('hide');$('deadinfo').textContent=deadInfo?('Dikalahkan oleh '+deadInfo.by+'. XP hilang '+deadInfo.loss+'. Bangkit dalam '+Math.max(0,Math.ceil((deadInfo.until-now)/1000))+' detik'):'Menunggu kebangkitan...';}else $('dead').classList.add('hide');
if(shopNpc&&Math.hypot(shopNpc.x-me.x,shopNpc.y-me.y)>130){$('shopwin').classList.add('hide');shopNpc=null;}
if(uiDirty){uiDirty=false;if(!$('invwin').classList.contains('hide'))renderInv();if(!$('shopwin').classList.contains('hide'))renderShop();if(!$('profwin').classList.contains('hide'))safeRender('profbody',renderProf);if(!$('questwin').classList.contains('hide'))safeRender('questbody',renderQuest);if(!$('skillwin').classList.contains('hide'))safeRender('skillbody',renderSkill);}}

const SLOTN={weapon:'Senjata',helm:'Helm',armor:'Zirah',boots:'Sepatu',ring:'Cincin'},STN={atk:'ATK',matk:'MATK',def:'DEF',mdef:'MDEF',hp:'HP',mp:'MP',crit:'Krit',speed:'Kecepatan'};
function tipHtml(id){const d=DEFS.items[id],r=DEFS.rarities[d.rarity];let h='<b style=color:'+r.color+'>'+d.name+'</b> <span style=color:#7d9486>('+r.name+')</span><br>';
if(d.type==='equip'){h+=SLOTN[d.slot]+(d.weaponType?' - '+d.weaponType:'')+'<br>';const bad=st&&st.lv<d.reqLevel;h+='<span style=color:'+(bad?'#ff7a6a':'#9fb3a4')+'>Butuh Lv '+d.reqLevel+'</span><br>';for(const k in d.stats){const v=d.stats[k];h+=STN[k]+' +'+(k==='crit'?(v*100).toFixed(1)+'%':k==='speed'?Math.round(v*100)+'%':v)+'<br>';}}
else if(d.type==='consumable'){const e=d.effect||{};if(e.hp)h+='Pulihkan HP '+e.hp+'<br>';if(e.mp)h+='Pulihkan MP '+e.mp+'<br>';}else h+='Bahan<br>';
return h+'Harga '+d.price+' emas - jual '+Math.floor(d.price*CFG.sellRatio);}
function cell(id,n){const d=document.createElement('div');d.className='it';if(id){const def=DEFS.items[id];d.title=def.name;d.style.borderColor=DEFS.rarities[def.rarity].color;d.style.backgroundImage='url('+iconUrl(id)+')';d.style.backgroundSize='70%';d.style.backgroundRepeat='no-repeat';d.style.backgroundPosition='center';d.style.imageRendering='pixelated';if(n>1){const q=document.createElement('span');q.className='qty';q.textContent=n;d.appendChild(q);}d.onmouseenter=()=>{$('tip').innerHTML=tipHtml(id);};}return d;}
function renderInv(){const EQ=['weapon','helm','armor','boots','ring'];const eg=$('eqgrid');eg.innerHTML='';EQ.forEach(s=>{const id=st&&st.equip?st.equip[s]:null;const d=cell(id,1);if(id){d.onclick=()=>send({t:'unequip',slot:s});}else{d.textContent=SLOTN[s];d.style.color='#58695e';}eg.appendChild(d);});
const ig=$('invgrid');ig.innerHTML='';for(let i=0;i<CFG.slots;i++){const s=inv[i];const d=cell(s?s.id:null,s?s.n:0);if(s){const def=DEFS.items[s.id];d.onclick=()=>{if(def.type==='equip')send({t:'equip',slot:i});else if(def.type==='consumable')send({t:'use',slot:i});};d.oncontextmenu=e=>{e.preventDefault();if(DEFS.rarities[def.rarity].mul>=1.5&&!confirm('Buang '+def.name+'?'))return;send({t:'drop',slot:i});};}ig.appendChild(d);}
if(st){const me=players.get(myId);const cn=me&&DEFS.classes[me.cls]?DEFS.classes[me.cls].name:'';$('stats').innerHTML='<b>'+cn+'</b> Lv '+st.lv+'<br>ATK '+st.atk+' - MATK '+st.matk+'<br>DEF '+st.def+' - MDEF '+st.mdef+'<br>Krit '+st.crit+'% - Kec '+st.spd+'%<br>Bunuh '+st.kills+' - Mati '+st.deaths;}}
function openShop(n){shopNpc=n;$('shoptitle').textContent=n.name;$('shopgreet').textContent=n.greeting;$('shopwin').classList.remove('hide');renderShop();}
function renderShop(){if(!shopNpc)return;const sl=$('shoplist');sl.innerHTML='';for(const id of shopNpc.stock||[]){const def=DEFS.items[id];const row=document.createElement('div');row.className='shoprow';const ic=cell(id,1);ic.style.width='32px';ic.style.flex='none';const nm=document.createElement('span');nm.style.flex='1';nm.style.color=DEFS.rarities[def.rarity].color;nm.textContent=def.name+(def.reqLevel?' (Lv '+def.reqLevel+')':'');const b=document.createElement('button');b.className='btn sm';b.textContent=def.price+' G';b.onclick=e=>send({t:'buy',item:id,n:(e.shiftKey&&def.stack>1)?10:1});row.append(ic,nm,b);sl.appendChild(row);}
const sg=$('sellgrid');sg.innerHTML='';for(let i=0;i<CFG.slots;i++){const s=inv[i];const d=cell(s?s.id:null,s?s.n:0);if(s)d.onclick=e=>send({t:'sell',slot:i,n:e.shiftKey?s.n:1});sg.appendChild(d);}}
function safeRender(bodyId,fn){const b=$(bodyId);try{if(!DEFS.quests)throw new Error('Server belum mengirim data quest (DEFS.quests kosong). Server MMORPG masih versi lama, restart dulu.');fn();}catch(err){console.error(err);b.innerHTML='';const d=document.createElement('div');d.style.cssText='color:#ff7a6a;font-size:12px;white-space:pre-wrap';d.textContent='Error: '+(err&&err.message?err.message:err)+(err&&err.stack?'\n'+String(err.stack).split('\n').slice(0,3).join('\n'):'');b.appendChild(d);}}
function fmtTime(s){s=s||0;return Math.floor(s/3600)+'j '+Math.floor(s%3600/60)+'m';}
function rewardTxt(r){const t=[];if(r.xp)t.push(r.xp.toLocaleString('id-ID')+' XP');if(r.gold)t.push(r.gold.toLocaleString('id-ID')+' emas');for(const k in (r.items||{})){const d=DEFS.items[k];t.push((d?d.name:k)+' x'+r.items[k]);}return t.join(', ');}
function invCount(id){let n=0;for(const s of inv)if(s&&s.id===id)n+=s.n;return n;}
function renderProf(){const b=$('profbody');b.innerHTML='';if(!st){b.textContent='Memuat...';return;}const me=players.get(myId);const cn=me&&DEFS.classes[me.cls]?DEFS.classes[me.cls].name:'';
const rows=[['Nama',me?me.name:'-'],['Class',cn],['Level',st.lv],['XP',st.xpn>0?st.xp+' / '+st.xpn:'MAKS'],['HP',st.hp+' / '+st.mhp],['MP',st.mp+' / '+st.mmp],['ATK',st.atk],['MATK',st.matk],['DEF',st.def],['MDEF',st.mdef],['Krit',st.crit+'%'],['Kecepatan',st.spd+'%'],['Emas',st.gold.toLocaleString('id-ID')],['Monster dibunuh',st.kills],['Boss dikalahkan',st.bossKills||0],['Kematian',st.deaths],['Quest selesai',(st.qdone||[]).length+' / '+DEFS.quests.length],['Poin skill',st.sp],['Waktu main',fmtTime(st.playTime)]];
for(const r of rows){const d=document.createElement('div');d.className='prow';const a=document.createElement('span');a.textContent=r[0];const c=document.createElement('b');c.textContent=r[1];d.append(a,c);b.appendChild(d);}}
function qStatus(q){const done=st.qdone||[],act=st.qact||{};if(done.includes(q.id))return 'done';if(act[q.id]!==undefined)return 'active';if(st.lv>=q.minLevel&&(!q.prereq||done.includes(q.prereq)))return 'open';return 'lock';}
function renderQuest(){const b=$('questbody');b.innerHTML='';if(!st)return;const act=st.qact||{};let nd=0,shownLock=false;const rows=[];
for(const q of DEFS.quests){const s=qStatus(q);if(s==='done'){nd++;continue;}if(s==='lock'){if(shownLock)continue;shownLock=true;}rows.push({q,s});}
const hd=document.createElement('div');hd.style.cssText='font-size:11px;color:#9fb3a4;margin-bottom:6px';hd.textContent='Selesai: '+nd+' / '+DEFS.quests.length;b.appendChild(hd);
if(!rows.length){const d=document.createElement('div');d.textContent='Semua quest sudah selesai. Kamu pahlawan Tanah Legenda!';b.appendChild(d);return;}
for(const {q,s} of rows){const cur=q.type==='collect'?Math.min(q.count,invCount(q.target)):Math.min(q.count,act[q.id]||0);const ready=s==='active'&&cur>=q.count;const row=document.createElement('div');row.className='qrow'+(ready?' ready':'')+(s==='lock'?' lock':'');
const n=document.createElement('div');n.className='qn';n.textContent=q.name+' (Lv '+q.minLevel+')'+(q.type==='boss'?' [RAID]':'');const d=document.createElement('div');d.className='qd';d.textContent=q.desc;row.append(n,d);
if(s==='active'){const bar=document.createElement('div');bar.className='qbar';const i=document.createElement('i');i.style.width=(cur/q.count*100)+'%';bar.appendChild(i);row.appendChild(bar);}
const p=document.createElement('div');p.className='qp';const rw=document.createElement('span');rw.textContent='Hadiah: '+rewardTxt(q.reward);p.appendChild(rw);
if(s==='active'){const bt=document.createElement('button');bt.className='btn sm';bt.textContent=ready?'Klaim':cur+' / '+q.count;bt.disabled=!ready;bt.onclick=()=>send({t:'quest_claim',id:q.id});p.appendChild(bt);}
else if(s==='open'){const bt=document.createElement('button');bt.className='btn sm';bt.textContent='Terima';bt.onclick=()=>send({t:'quest_accept',id:q.id});p.appendChild(bt);}
else{const lk=document.createElement('span');lk.style.color='#ff7a6a';const pq=q.prereq?DEFS.quests.find(x=>x.id===q.prereq):null;lk.textContent='Terkunci: Lv '+q.minLevel+(pq?' + selesaikan "'+pq.name+'"':'');p.appendChild(lk);}
row.appendChild(p);b.appendChild(row);}}
function renderSkill(){const b=$('skillbody');b.innerHTML='';if(!st)return;const me=players.get(myId);if(!me||!DEFS.classes[me.cls])return;const cls=DEFS.classes[me.cls];const ranks=st.ranks||{},max=st.maxRank||5;
const hd=document.createElement('div');hd.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:12px';const sp=document.createElement('span');sp.innerHTML='Poin skill: <b style=color:#f5c842>'+st.sp+'</b> (1 poin per level)';const rs=document.createElement('button');rs.className='btn sm alt';const cost=st.lv*50;rs.textContent='Reset ('+cost+' G)';rs.onclick=()=>{if(confirm('Reset semua poin skill? Biaya '+cost+' emas.'))send({t:'skill_reset'});};hd.append(sp,rs);b.appendChild(hd);
cls.skills.forEach((s,i)=>{const r=ranks[s.id]||0;const row=document.createElement('div');row.className='qrow'+(st.lv<s.level?' lock':'');const top=document.createElement('div');top.className='sk';const nm=document.createElement('span');nm.className='qn';nm.textContent='['+(i+1)+'] '+s.name;const pips=document.createElement('div');pips.className='pips';for(let k=0;k<max;k++){const pi=document.createElement('i');if(k<r)pi.className='on';pips.appendChild(pi);}
const bt=document.createElement('button');bt.className='btn sm';bt.textContent='+';bt.disabled=!(st.sp>0&&st.lv>=s.level&&r<max);bt.onclick=()=>send({t:'skill_up',id:s.id});top.append(nm,pips,bt);
const d=document.createElement('div');d.className='qd';d.textContent=(st.lv<s.level?'Terbuka di Lv '+s.level+'. ':'')+'Rank '+r+'/'+max+' - Damage +'+(r*12)+'%, MP -'+(r*4)+'%, Cooldown -'+(r*3)+'% (per rank: +12% / -4% / -3%)';row.append(top,d);b.appendChild(row);});}
function showBoard(rows){const b=$('board');b.innerHTML='';if(!rows||!rows.length){b.textContent='Belum ada data.';return;}rows.forEach((r,i)=>{const d=document.createElement('div');const a=document.createElement('span');a.textContent=(i+1)+'. '+(r.name||r.n||'?');const c=document.createElement('span');const lv=r.level!==undefined?r.level:r.lv;const cl=r.cls&&DEFS.classes[r.cls]?DEFS.classes[r.cls].name:(r.cls||'');c.textContent='Lv '+lv+' '+cl;d.append(a,c);b.appendChild(d);});}

function darkness(t){const a=CFG.nightStart,b=CFG.nightEnd,r=0.05;if(t<a)return Math.max(0,Math.min(1,(t-(a-r))/r));if(t<=b)return 1;return Math.max(0,1-(t-b)/r);}
function lerpEnt(e,dt){const dx=e.gx-e.x,dy=e.gy-e.y;if(Math.abs(dx)+Math.abs(dy)>120){e.x=e.gx;e.y=e.gy;e.moving=false;return;}const k=1-Math.exp(-dt*16);e.x+=dx*k;e.y+=dy*k;e.moving=Math.hypot(dx,dy)>1.2;if(e.moving)e.walk+=dt*10;}
function update(dt,now){for(const e of players.values())lerpEnt(e,dt);for(const e of mons.values())lerpEnt(e,dt);for(const e of bosses.values())lerpEnt(e,dt);
const me=players.get(myId);if(me&&!hbBuilt)buildHotbar(me);
autoTick(now);sendInput(now);if(me&&!me.dead&&(mouseDown||keys.has(' '))&&now-lastAtk>150){lastAtk=now;doAttack();}
if(now-lastAuto>250){lastAuto=now;autoPick(now);}
fx=fx.filter(f=>f.k==='proj'?((now-f.born)/1000*f.sp<f.rg):((now-f.born)<f.dur));texts=texts.filter(t=>now-t.born<900);
parts=parts.filter(p=>now-p.born<p.life);for(const p of parts){p.x+=p.vx*dt;p.vy+=p.g*dt;p.y+=p.vy*dt;}
shake*=0.86;if(shake<0.2)shake=0;
if(hbBuilt)updateHotbar(now);if(now-lastHud>100){lastHud=now;updateHud(now);}}

function drawGroundFx(now){for(const f of fx){if(f.k!=='tele')continue;const p=Math.min(1,(now-f.born)/f.dur);ctx.globalAlpha=0.1+0.22*p;E(f.x,f.y,f.r,f.r,f.c);ctx.globalAlpha=0.35;E(f.x,f.y,f.r*p,f.r*p,f.c);ctx.globalAlpha=0.9;ring(f.x,f.y,f.r,f.c,2);}ctx.globalAlpha=1;}
function drawAirFx(now){for(const f of fx){const p=Math.min(1,(now-f.born)/(f.dur||1));
if(f.k==='swing'){const half=f.a*Math.PI/360,a0=f.f-half,a1=a0+(half*2)*Math.min(1,p*2.2);ctx.globalAlpha=1-p;const col=f.fxn==='stab'?'#cfe3ff':'#fff6c8';ctx.fillStyle=col;const steps=Math.max(6,Math.round(f.r/3));for(let i=0;i<=steps;i++){const a=a0+(a1-a0)*i/steps;ctx.fillRect(Math.round(f.x+Math.cos(a)*f.r-camX),Math.round(f.y+Math.sin(a)*f.r-camY),2,2);ctx.fillRect(Math.round(f.x+Math.cos(a)*(f.r-4)-camX),Math.round(f.y+Math.sin(a)*(f.r-4)-camY),1,1);}ctx.globalAlpha=1;}
else if(f.k==='proj'){const t=(now-f.born)/1000,d=f.sp*t,x=f.x+Math.cos(f.f)*d,y=f.y+Math.sin(f.f)*d;if(f.sp>=400){L(x-Math.cos(f.f)*8,y-Math.sin(f.f)*8,x,y,1,f.c);R(x,y,2,2,'#fff');}else{ctx.globalAlpha=0.4;E(x,y,5,5,f.c);ctx.globalAlpha=1;E(x,y,3,3,f.c);R(x-1,y-1,2,2,'#fff');for(let i=1;i<=3;i++){ctx.globalAlpha=0.5/i;R(x-Math.cos(f.f)*i*4,y-Math.sin(f.f)*i*4,2,2,f.c);}ctx.globalAlpha=1;}}
else if(f.k==='boom'){const r=f.r*(0.4+0.6*p);ctx.globalAlpha=0.35*(1-p);E(f.x,f.y,r,r,f.c);ctx.globalAlpha=1-p;ring(f.x,f.y,r,f.c,2);ctx.globalAlpha=1;}
else if(f.k==='ring'){const r=f.r*(0.3+0.7*p);ctx.globalAlpha=1-p;ring(f.x,f.y,r,f.c,2);ctx.globalAlpha=1;}}
for(const p of parts){ctx.globalAlpha=1-(now-p.born)/p.life;R(p.x,p.y,p.s,p.s,p.c);}ctx.globalAlpha=1;}
function drawLight(now,me){const d=darkness(tod);if(d<=0.01)return;lctx.globalCompositeOperation='source-over';lctx.clearRect(0,0,W,H);lctx.fillStyle='rgba(6,10,40,'+(0.64*d).toFixed(3)+')';lctx.fillRect(0,0,W,H);lctx.globalCompositeOperation='destination-out';
const hole=(x,y,r,a)=>{const sx=x-camX,sy=y-camY;if(sx<-r||sy<-r||sx>W+r||sy>H+r)return;const g=lctx.createRadialGradient(sx,sy,r*0.15,sx,sy,r);g.addColorStop(0,'rgba(0,0,0,'+a+')');g.addColorStop(1,'rgba(0,0,0,0)');lctx.fillStyle=g;lctx.fillRect(sx-r,sy-r,r*2,r*2);};
if(me)hole(me.x,me.y-4,105,1);for(const n of DEFS.npcs)hole(n.x,n.y-6,55,0.85);for(const f of fx)if(f.k==='boom')hole(f.x,f.y,f.r*1.3,0.7*Math.max(0,1-(now-f.born)/f.dur));
ctx.drawImage(lightCv,0,0);}
function drawLoot(l,now,me){const d=DEFS.items[l.it];const c=DEFS.rarities[d.rarity].color;const bob=Math.sin(now/300+l.id)*1.5;const rank=DEFS.rarities[d.rarity].mul;if(rank>=1.9&&l.mine){ctx.globalAlpha=0.35;R(l.x-1,l.y-34,3,30,c);ctx.globalAlpha=1;}E(l.x,l.y+3,5,2,'rgba(0,0,0,0.3)');E(l.x,l.y-1,4,3,l.mine?'#8a6a3a':'#555');R(l.x-1,l.y-5,2,2,'#c9a45a');const tw=Math.floor(now/200+l.id)%4;ctx.globalAlpha=l.mine?1:0.5;R(l.x-5+tw*3,l.y-8+bob,2,2,c);ctx.globalAlpha=1;if(me&&Math.hypot(me.x-l.x,me.y-l.y)<70)tags.push({x:l.x,y:l.y-12,txt:d.name+(l.n>1?' x'+l.n:''),c:l.mine?c:'#888'});}
const bubbles=[];
function drawBubbles(now){ctx.font='bold 8px monospace';ctx.textAlign='center';ctx.textBaseline='alphabetic';for(const b of bubbles){const age=now-b.at;const fade=age>4400?Math.max(0,1-(age-4400)/600):1;const lines=[];let cur='';for(let w of b.t.split(' ')){while(w.length>16){if(cur){lines.push(cur);cur='';}lines.push(w.slice(0,16));w=w.slice(16);}const t=cur?cur+' '+w:w;if(cur&&ctx.measureText(t).width>96){lines.push(cur);cur=w;}else cur=t;}if(cur)lines.push(cur);const shown=lines.slice(0,4);let mw=0;for(const l of shown)mw=Math.max(mw,ctx.measureText(l).width);const bw=Math.ceil(mw)+8,bh=shown.length*9+5;const sx=Math.round(b.x-camX),by=Math.round(b.y-camY)-bh-6;ctx.globalAlpha=fade;ctx.fillStyle='#1a1a10';ctx.fillRect(sx-Math.floor(bw/2)-1,by-1,bw+2,bh+2);ctx.fillStyle='#fffbe8';ctx.fillRect(sx-Math.floor(bw/2),by,bw,bh);ctx.fillStyle='#1a1a10';ctx.fillRect(sx-2,by+bh+1,4,2);ctx.fillStyle='#fffbe8';ctx.fillRect(sx-1,by+bh,2,2);ctx.fillStyle='#1a1a10';for(let i=0;i<shown.length;i++)ctx.fillText(shown[i],sx,by+8+i*9);}ctx.globalAlpha=1;bubbles.length=0;}
function drawTags(){ctx.textAlign='center';ctx.font='bold 8px monospace';for(const t of tags){const sx=Math.round(t.x-camX),sy=Math.round(t.y-camY);let y=sy;if(t.bar!==undefined){const w=t.bw||20;ctx.fillStyle='#000';ctx.fillRect(sx-Math.floor(w/2)-1,y-1,w+2,5);ctx.fillStyle='#401010';ctx.fillRect(sx-Math.floor(w/2),y,w,3);ctx.fillStyle=t.bc||'#e0483a';ctx.fillRect(sx-Math.floor(w/2),y,Math.max(0,Math.round(w*t.bar)),3);y-=3;}if(t.txt){ctx.lineWidth=3;ctx.strokeStyle='rgba(0,0,0,0.85)';ctx.strokeText(t.txt,sx,y);ctx.fillStyle=t.c||'#fff';ctx.fillText(t.txt,sx,y);}}tags.length=0;}
function drawTexts(now){ctx.textAlign='center';for(const t of texts){const p=(now-t.born)/900;ctx.globalAlpha=Math.max(0,1-p*p);ctx.font=(t.big?'bold 11px':'bold 9px')+' monospace';const sx=Math.round(t.x-camX),sy=Math.round(t.y-camY-p*20);ctx.lineWidth=3;ctx.strokeStyle='#000';ctx.strokeText(t.t,sx,sy);ctx.fillStyle=t.c;ctx.fillText(t.t,sx,sy);}ctx.globalAlpha=1;}
function drawMini(me){if(!mini||mini.style.display==='none')return;const g=mini.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(miniBase,0,0,128,128);const k=128/(WORLD.w*TS);for(const n of DEFS.npcs){g.fillStyle='#f5c842';g.fillRect(n.x*k-1,n.y*k-1,3,3);}for(const b of bosses.values()){if(b.dead)continue;g.fillStyle='#ff3a2a';g.fillRect(b.x*k-2,b.y*k-2,4,4);}for(const p of players.values()){if(p.id===myId)continue;g.fillStyle='#6ac0ff';g.fillRect(p.x*k-1,p.y*k-1,2,2);}if(me){g.fillStyle=(Math.floor(performance.now()/300)%2)?'#fff':'#f5c842';g.fillRect(me.x*k-2,me.y*k-2,4,4);}}

function drawFullMap(me){const w=$('mapwin');if(!w||w.classList.contains('hide')||!miniBase)return;const cvm=$('mapcv');const S=cvm.width;const g=cvm.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(miniBase,0,0,S,S);const k=S/(WORLD.w*TS);
g.font='bold 11px monospace';g.textAlign='center';for(const z of DEFS.zones){const r=z.rect;g.strokeStyle='rgba(255,255,255,0.45)';g.lineWidth=1;g.strokeRect(r.x*k,r.y*k,r.w*k,r.h*k);g.fillStyle='#fff';g.strokeStyle='#000';g.lineWidth=3;const tx=(r.x+r.w/2)*k,ty=(r.y+r.h/2)*k;g.strokeText(z.name,tx,ty);g.fillText(z.name,tx,ty);}
for(const n of DEFS.npcs){g.fillStyle='#f5c842';g.fillRect(n.x*k-2,n.y*k-2,5,5);}
for(const b of bosses.values()){if(b.dead)continue;g.fillStyle='#ff3a2a';g.fillRect(b.x*k-3,b.y*k-3,6,6);}
for(const p of players.values()){if(p.id===myId)continue;g.fillStyle='#6ac0ff';g.fillRect(p.x*k-2,p.y*k-2,4,4);}
if(me){g.fillStyle=(Math.floor(performance.now()/300)%2)?'#fff':'#f5c842';g.fillRect(me.x*k-3,me.y*k-3,7,7);g.strokeStyle='#000';g.lineWidth=1;g.strokeRect(me.x*k-3,me.y*k-3,7,7);}}
function render(now){const me=players.get(myId);const pw=WORLD.w*TS,ph=WORLD.h*TS;
if(me){camX=Math.round(Math.max(0,Math.min(pw-W,me.x-W/2))+(shake?(Math.random()-0.5)*shake*2:0));camY=Math.round(Math.max(0,Math.min(ph-H,me.y-H/2))+(shake?(Math.random()-0.5)*shake*2:0));}
ctx.fillStyle='#0b100c';ctx.fillRect(0,0,W,H);
const x0=Math.max(0,Math.floor(camX/TS)),x1=Math.min(WORLD.w-1,Math.floor((camX+W)/TS)),y0=Math.max(0,Math.floor(camY/TS)),y1=Math.min(WORLD.h-1,Math.floor((camY+H)/TS));
const wf=Math.floor(now/600)%2;const objs=[];
for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++){const i=ty*WORLD.w+tx,t=TILES[i],gk=GK[i],h=((tx*73856093)^(ty*19349663))>>>0;let tex;
if(t===3)tex=GT.water[wf][h&1];else if(t===7||t===4)tex=GT.path[h&3];else tex=GT[GKN[gk]][h&3];
ctx.drawImage(tex,tx*TS-camX,ty*TS-camY);
if(t===1)objs.push({y:ty*TS+TS-4,k:'tree',tx,ty,gk,v:h%3});else if(t===2)objs.push({y:ty*TS+TS-6,k:'rock',tx,ty,gk,v:h%3});}
drawGroundFx(now);
for(const l of loot.values())objs.push({y:l.y-400,k:'loot',e:l});
for(const n of DEFS.npcs)if(n.x>camX-40&&n.x<camX+W+40&&n.y>camY-60&&n.y<camY+H+40)objs.push({y:n.y,k:'npc',e:n});
for(const e of mons.values()){if(e.x<camX-60||e.x>camX+W+60||e.y<camY-80||e.y>camY+H+60)continue;objs.push({y:e.dead?e.y-500:e.y,k:'mon',e});}
for(const e of bosses.values()){if(e.x<camX-140||e.x>camX+W+140||e.y<camY-160||e.y>camY+H+100)continue;if(e.dead&&now-e.deadAt>2600)continue;objs.push({y:e.dead?e.y-500:e.y,k:'boss',e});}
for(const p of players.values()){if(p.x<camX-40||p.x>camX+W+40||p.y<camY-60||p.y>camY+H+40)continue;objs.push({y:p.dead?p.y-500:p.y,k:'pl',e:p});}
objs.sort((a,b)=>a.y-b.y);
for(const o of objs){switch(o.k){
case 'tree':ctx.drawImage(TT[o.gk===3?'grass':GKN[o.gk]][o.v],o.tx*TS-4-camX,o.ty*TS+TS-52-camY);break;
case 'rock':ctx.drawImage(RT[GKN[o.gk]][o.v],o.tx*TS-camX,o.ty*TS+TS-26-camY);break;
case 'loot':drawLoot(o.e,now,me);break;
case 'npc':{const n=o.e;const dir=me&&me.x<n.x?-1:1;human(n.x,n.y,{dir,moving:false,walk:0,body:n.color,legs:'#4a3b32',hat:n.role==='healer'?'halo':'hair',hc:n.role==='healer'?'#f6e7b0':'#5a3b1f',wpn:null,atk:-1,f:0});const bob=Math.sin(now/250)*1.5;if(n.role==='shop'){R(n.x-3,n.y-34+bob,6,6,'#f5c842');R(n.x-1,n.y-33+bob,2,4,'#a07a10');}else{R(n.x-1,n.y-35+bob,2,6,'#6aff8a');R(n.x-3,n.y-33+bob,6,2,'#6aff8a');}tags.push({x:n.x,y:n.y-26,txt:n.name,c:n.color});if(me&&Math.hypot(me.x-n.x,me.y-n.y)<=90)tags.push({x:n.x,y:n.y-38,txt:'[F] '+(n.role==='shop'?'Dagang':'Sembuhkan'),c:'#ffe27a'});break;}
case 'mon':{const e=o.e,def=DEFS.monsters[e.type];if(!def)break;drawMonster(e,def,false,now);if(!e.dead&&e.hp<e.mhp){const me2=me?me.lv:1;tags.push({x:e.x,y:e.y-def.radius*1.6-8,txt:'Lv'+def.level+' '+def.name,c:def.level>me2+5?'#ff7a6a':'#ffffff',bar:e.hp/e.mhp,bw:Math.max(18,def.radius*2)});}break;}
case 'boss':{const e=o.e,def=DEFS.bosses[e.key];if(!def)break;drawMonster(e,def,true,now);if(!e.dead)tags.push({x:e.x,y:e.y-def.radius*1.9-8,txt:e.name,c:'#ff9a6a'});break;}
case 'pl':{const p=o.e;drawPlayer(p,now);if(p.bubble&&now-p.bubble.at<5000)bubbles.push({x:p.x,y:p.y-32,t:p.bubble.t,at:p.bubble.at});if(!p.dead)tags.push({x:p.x,y:p.y-25,txt:'Lv'+p.lv+' '+p.name,c:p.id===myId?'#ffe27a':'#ffffff',bar:p.hp/p.mhp,bw:22,bc:'#5ec26a'});else tags.push({x:p.x,y:p.y-12,txt:p.name,c:'#aaa'});break;}
default:break;}}
drawAirFx(now);drawLight(now,me);drawTexts(now);drawTags();drawBubbles(now);drawMini(me);drawFullMap(me);}

function frame(){requestAnimationFrame(frame);if(!WORLD||!DEFS)return;const now=performance.now();const dt=Math.min(0.05,(now-lastT)/1000);lastT=now;try{update(dt,now);render(now);}catch(err){console.error(err);}}

for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>{$(b.dataset.close).classList.add('hide');if(b.dataset.close==='shopwin')shopNpc=null;};
$('bInv').onclick=()=>toggleWin('invwin');$('bProf').onclick=()=>toggleWin('profwin');if($('bAuto'))$('bAuto').onclick=toggleAuto;if($('bMap'))$('bMap').onclick=()=>toggleWin('mapwin');$('bQuest').onclick=()=>toggleWin('questwin');$('bSkill').onclick=()=>toggleWin('skillwin');$('bBoard').onclick=()=>toggleWin('boardwin');
$('btnLogin').onclick=()=>doAuth('login');$('btnReg').onclick=()=>doAuth('register');
$('pw').addEventListener('keydown',e=>{if(e.key==='Enter')doAuth('login');});$('nm').addEventListener('keydown',e=>{if(e.key==='Enter')$('pw').focus();});
buildClassCards();requestAnimationFrame(frame);
