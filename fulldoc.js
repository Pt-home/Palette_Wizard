/* ---------- Bridge with Photopea ---------- */
let awaitingPNG = false;

// Single global listener
window.addEventListener("message", async (e) => {
  // Ignore if we are not expecting data
  if (!awaitingPNG) return;

  if (e.data instanceof ArrayBuffer) {
    console.log("[PW] PNG received from Photopea (%d bytes)", e.data.byteLength);
    try {
      const blob = new Blob([e.data], { type: "image/png" });
      const img = await blobToImage(blob);
      drawPreview(img);
      const { data, width, height } = imageToImageData(img, 768);
      const pixels = rgbaToRgbArray(data, 1); // ignore alpha=0

      const diag = diagnose(pixels);
      document.getElementById("pvDiag").innerHTML =
        `<div>Non-transparent pixels: <b>${diag.count}</b></div>
         <div>Avg luminance: <b>${diag.avgY.toFixed(1)}</b></div>
         <div>Black ratio (&le;10): <b>${(diag.blackRate*100).toFixed(1)}%</b></div>`;

      if (diag.count >= 10) {
        runAllPalettes(data, width, height);
        setExport(true);
      } else {
        console.warn("[PW] PNG contained too few non-transparent pixels.");
      }
    } finally {
      awaitingPNG = false;
    }
  } else if (typeof e.data === "string" && e.data.startsWith("__ERR__")) {
    console.error("[PW] Photopea error:", e.data);
    awaitingPNG = false;
  }
});

// Optional ping (not awaited)
try {
  window.parent.postMessage("app.echoToOE('ping')", "*");
  console.log("[PW] Sent ping to Photopea");
} catch (e) {
  console.warn("[PW] Could not ping Photopea:", e);
}

/* ---------- UI ---------- */
document.getElementById("gen").addEventListener("click", () => {
  try { console.clear(); } catch (e) {}
  console.log("[PW] Generate clicked");

  setExport(false);
  clearPalettes();
  awaitingPNG = true;

  const script = script_FullDocument_AsIs();
  console.log("[PW] Sending export script to Photopea");
  try {
    window.parent.postMessage(script, "*");
  } catch (e) {
    console.error("[PW] Failed to send script:", e);
    awaitingPNG = false;
  }
});

document.querySelectorAll('button[data-export]').forEach(btn => {
  btn.addEventListener("click", () => {
    const key = btn.getAttribute("data-export");
    exportPalette(lastPalettes[key] || [], `Palette-${key.toUpperCase()}.png`);
  });
});

function setExport(v) {
  document.querySelectorAll('button[data-export]').forEach(b => b.disabled = !v);
}
function clearPalettes() {
  for (const key of ["freq", "bright", "chroma", "hue"]) {
    const sw = document.querySelector(`.swatches[data-swatches="${key}"]`);
    if (sw) sw.innerHTML = "";
    const hx = document.querySelector(`.hex[data-hex="${key}"]`);
    if (hx) hx.textContent = "";
  }
}

/* ---------- Photopea script (no visibility changes) ---------- */
function script_FullDocument_AsIs() {
  // Keep script tiny and free of problematic characters; join lines with \n
  return [
    '(function(){',
    '  var d = app.activeDocument;',
    '  if(!d){ app.echoToOE("__ERR__no_document"); return; }',
    '  try { d.saveToOE("png"); } catch(e) { app.echoToOE("__ERR__save_failed"); }',
    '})();'
  ].join('\n');
}

/* ---------- Preview & diagnostics ---------- */
function drawPreview(img) {
  document.getElementById("pvMeta").textContent =
    `Source: Full document • ${img.width}×${img.height}px`;

  const cv = document.getElementById("pvCanvas");
  const maxW = 320;
  const s = img.width > maxW ? maxW / img.width : 1;
  cv.width = Math.max(1, Math.round(img.width * s));
  cv.height = Math.max(1, Math.round(img.height * s));

  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.fillStyle = "#0a0c10";
  cx.fillRect(0, 0, cv.width, cv.height);
  cx.imageSmoothingEnabled = true;
  cx.drawImage(img, 0, 0, cv.width, cv.height);
}
function diagnose(pix) {
  let n = 0, sumY = 0, blacks = 0;
  for (const p of pix) {
    const y = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    if (y <= 10) blacks++;
    sumY += y;
    n++;
  }
  return { count: n, avgY: n ? sumY / n : 0, blackRate: n ? blacks / n : 1 };
}

/* ---------- Palettes ---------- */
const lastPalettes = { freq: [], bright: [], chroma: [], hue: [] };

function runAllPalettes(data, w, h) {
  const kRaw = parseInt(document.getElementById("k").value || "6", 10);
  const pixels = rgbaToRgbArray(data, 1);
  const k = Math.max(2, Math.min(16, Math.min(kRaw, pixels.length || 2)));

  const freq   = kmeans(pixels, k);            lastPalettes.freq   = freq;   render('freq',   freq);
  const bright = brightnessPalette(pixels, k);  lastPalettes.bright = bright; render('bright', bright);
  const chroma = chromaPalette(pixels, k);      lastPalettes.chroma = chroma; render('chroma', chroma);
  const hue    = huePalette(pixels, k);         lastPalettes.hue    = hue;    render('hue',    hue);
}
function render(key, colors) {
  const root = document.querySelector(`.swatches[data-swatches="${key}"]`);
  root.innerHTML = colors.map(c => {
    const h = hex(c);
    return `
      <div class="chip">
        <div class="sw" style="background:rgb(${c[0]},${c[1]},${c[2]})"></div>
        <div class="code">${h}</div>
      </div>
    `;
  }).join('');

  const hx = document.querySelector(`.hex[data-hex="${key}"]`);
  if (hx) hx.textContent = "";
}



/* ---------- Color / math ---------- */
function hex([r,g,b]) {
  const h = n => Math.max(0, Math.min(255, n|0)).toString(16).padStart(2, '0').toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}
function rgbaToRgbArray(rgba, alphaMin = 1) {
  const out = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < alphaMin) continue; // ignore fully transparent
    out.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  return out;
}
function rgbToHsl([r,g,b]) {
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h=0, s=0, l=(max+min)/2;
  if(max!==min){
    const d=max-min;
    s=l>0.5? d/(2-max-min): d/(max+min);
    switch(max){
      case r: h=(g-b)/d+(g<b?6:0); break;
      case g: h=(b-r)/d+2; break;
      default: h=(r-g)/d+4;
    }
    h/=6;
  }
  return [h*360, s, l];
}
function dist2(a,b){ const dx=a[0]-b[0],dy=a[1]-b[1],dz=a[2]-b[2]; return dx*dx+dy*dy+dz*dz; }
function avg(list){
  if(!list.length) return [0,0,0];
  let r=0,g=0,b=0;
  for(const p of list){ r+=p[0]; g+=p[1]; b+=p[2]; }
  const n=list.length;
  return [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
}
function sample(arr,n){
  if(arr.length<=n) return arr;
  const out=[], step=arr.length/n;
  for(let i=0;i<n;i++) out.push(arr[Math.floor(i*step)]);
  return out;
}

/* ---------- K-means & palette builders ---------- */
function kmeans(pixels, k){
  const S = sample(pixels, Math.min(40000, pixels.length));
  if(!S.length) return Array.from({length:k}, () => [0,0,0]);

  const centers=[], used=new Set();
  while(centers.length < Math.min(k, S.length)){
    const i = Math.floor(Math.random()*S.length);
    if(!used.has(i)){ used.add(i); centers.push(S[i].slice()); }
  }
  const assign=new Array(S.length).fill(0);

  for(let it=0; it<10; it++){
    for(let i=0;i<S.length;i++){
      let bi=0, bd=Infinity, p=S[i];
      for(let c=0;c<centers.length;c++){
        const d = dist2(p, centers[c]);
        if(d<bd){ bd=d; bi=c; }
      }
      assign[i]=bi;
    }
    const sum=Array.from({length:centers.length},()=>[0,0,0,0]);
    for(let i=0;i<S.length;i++){
      const a=assign[i], p=S[i];
      sum[a][0]+=p[0]; sum[a][1]+=p[1]; sum[a][2]+=p[2]; sum[a][3]++;
    }
    for(let c=0;c<centers.length;c++){
      if(sum[c][3]){
        centers[c][0]=Math.round(sum[c][0]/sum[c][3]);
        centers[c][1]=Math.round(sum[c][1]/sum[c][3]);
        centers[c][2]=Math.round(sum[c][2]/sum[c][3]);
      }
    }
  }
  const counts=centers.map(()=>0);
  for(const p of S){
    let bi=0,bd=Infinity;
    for(let c=0;c<centers.length;c++){
      const d=dist2(p,centers[c]);
      if(d<bd){ bd=d; bi=c; }
    }
    counts[bi]++;
  }
  return centers.map((c,i)=>({c,w:counts[i]})).sort((a,b)=>b.w-a.w).map(x=>x.c).slice(0,k);
}
function brightnessPalette(pixels,k){
  if(!pixels.length) return Array.from({length:k},()=>[0,0,0]);
  const arr=pixels.map(p=>({p,y:0.2126*p[0]+0.7152*p[1]+0.0722*p[2]})).sort((a,b)=>a.y-b.y);
  return fairBuckets(arr,k).map(b=>avg(b.map(x=>x.p)));
}
function chromaPalette(pixels,k){
  if(!pixels.length) return Array.from({length:k},()=>[0,0,0]);
  const arr=pixels.map(p=>({p,s:rgbToHsl(p)[1]})).sort((a,b)=>b.s-a.s);
  return fairBuckets(arr,k).map(b=>avg(b.map(x=>x.p)));
}
function huePalette(pixels,k){
  const bins=72, buckets=Array.from({length:bins},()=>[]);
  for(const p of pixels){
    const [h]=rgbToHsl(p);
    const bi=Math.floor(((h%360)+360)%360/(360/bins));
    buckets[bi].push(p);
  }
  const top=buckets.map((a,i)=>({i,n:a.length,a}))
                   .sort((A,B)=>B.n-A.n)
                   .slice(0,k)
                   .sort((A,B)=>A.i-B.i);
  return top.map(b=>avg(b.a.length?b.a:[[0,0,0]]));
}
function fairBuckets(arr,k){
  const n=arr.length, base=Math.floor(n/k), extra=n%k, out=[]; let idx=0;
  for(let i=0;i<k;i++){
    const size=Math.max(1, base+(i<extra?1:0));
    out.push(arr.slice(idx, idx+size));
    idx+=size;
  }
  return out;
}

/* ---------- Canvas & exporting helpers ---------- */
function blobToImage(blob){
  return new Promise(res=>{
    const img=new Image();
    img.onload=()=>res(img);
    img.src=URL.createObjectURL(blob);
  });
}
function imageToImageData(img, maxLong=768){
  const long=Math.max(img.width,img.height);
  const s=long>maxLong? maxLong/long : 1;
  const w=Math.max(1,Math.round(img.width*s));
  const h=Math.max(1,Math.round(img.height*s));
  const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
  const cx=cv.getContext("2d",{willReadFrequently:true}); // faster readback hint
  cx.drawImage(img,0,0,w,h);
  const id=cx.getImageData(0,0,w,h);
  return {data:id.data,width:w,height:h};
}
async function exportPalette(colors, filename){
  const sw=100,H=100,W=Math.max(1,colors.length*sw);
  const cv=document.createElement("canvas"); cv.width=W; cv.height=H;
  const cx=cv.getContext("2d");
  let x=0;
  for(const c of colors){
    cx.fillStyle=`rgb(${c[0]},${c[1]},${c[2]})`;
    cx.fillRect(x,0,sw,H);
    x+=sw;
  }
  const blob=await new Promise(res=>cv.toBlob(res,"image/png"));
  const ab=await blob.arrayBuffer();
  try{ window.parent.postMessage(ab,"*"); }catch(e){}
  setTimeout(()=>{ // optional rename
    try{ window.parent.postMessage(`if(app.activeDocument) app.activeDocument.name="${filename.replace(/"/g,'')}"`,"*"); }catch(e){}
  },300);
}
