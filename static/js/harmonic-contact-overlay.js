// Supplementary technique captions share this crisp screen-resolution layer.
// The highway keeps its adaptive backing resolution and existing gem geometry.
// One owner per default-renderer instance; no song data or scoring is changed.
export const techniqueCaptionStyle = Object.freeze({
    fontSize: 14,
    fontFamily: 'Arial, sans-serif',
    fontWeight: 'bold',
    color: '#ffffff',
    outlineColor: '#0a1018',
    outlineWidth: 2,
    lineHeight: 1.15,
    gap: 4,
});

export function placeContactLabel(anchor, width, height, obstacles, viewport) {
    const gap = techniqueCaptionStyle.gap;
    const margin = 2;
    const w = Math.min(width, Math.max(0, viewport.w - 2 * margin));
    const h = Math.min(height, Math.max(0, viewport.h - 2 * margin));
    const ideal = {x: anchor.x + anchor.w / 2 - w / 2, y: anchor.y - h - gap};
    const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
        * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const pending = [], seen = new Set();
    function add(x, y) {
        x = Math.max(margin, Math.min(viewport.w - w - margin, x));
        y = Math.max(margin, Math.min(viewport.h - h - margin, y));
        const key = `${x.toFixed(3)},${y.toFixed(3)}`;
        if (seen.has(key)) return;
        seen.add(key);
        pending.push({x, y, w, h, distance: (x - ideal.x) ** 2 + (y - ideal.y) ** 2});
    }
    add(ideal.x, ideal.y);
    let best, bestArea = Infinity, bestDistance = Infinity;
    // Expand only at obstructing edges. Sparse scenes take one candidate; the
    // bound keeps crowded passages from turning placement into an unbounded search.
    for (let attempts = 0; pending.length && attempts < 80; attempts++) {
        pending.sort((a, b) => a.distance - b.distance);
        const candidate = pending.shift();
        const hits = obstacles.filter(b => overlap(candidate, b) > 0);
        const area = hits.reduce((sum, b) => sum + overlap(candidate, b), 0);
        const {x, y, distance} = candidate;
        const box = {x, y, w, h};
        if (!area) return box;
        if (area < bestArea || (area === bestArea && distance < bestDistance)) {
            best = box; bestArea = area; bestDistance = distance;
        }
        for (const b of hits) {
            add(b.x - w - gap, y);
            add(b.x + b.w + gap, y);
            add(x, b.y - h - gap);
            add(x, b.y + b.h + gap);
        }
    }
    return best;
}

export function createHarmonicContactOverlay(canvas) {
    let layer = null, ctx = null, width = 0, height = 0, lefty = false;
    const gems = [];
    function clear() { if (layer) layer.style.display = 'none'; }
    return {
        beginFrame(w,h,mirrored) {width=w;height=h;lefty=mirrored;gems.length=0;clear();},
        addGem(gem) {gems.push(gem);},
        flush() {
            const labeled = g => g.label !== undefined && g.label !== null && String(g.label) !== ''
                && g.opacity !== 0;
            if (!gems.some(labeled) || !canvas.parentElement || !(width>0&&height>0)) return;
            const w=canvas.clientWidth, h=canvas.clientHeight;
            if (!(w>4&&h>4)) return;
            if (!layer) {
                layer=canvas.ownerDocument.createElement('canvas');
                layer.className='highway-harmonic-labels';
                layer.setAttribute('aria-hidden','true');
                Object.assign(layer.style,{position:'absolute',pointerEvents:'none',zIndex:'2'});
                canvas.parentElement.appendChild(layer);
                ctx=layer.getContext('2d');
            }
            if (!ctx) return;
            const ratio=Math.max(1,Math.min(2,canvas.ownerDocument.defaultView?.devicePixelRatio||1));
            Object.assign(layer.style,{left:canvas.offsetLeft+'px',top:canvas.offsetTop+'px',
                width:w+'px',height:h+'px',display:'block',visibility:canvas.style.visibility});
            if (layer.width!==Math.round(w*ratio)) layer.width=Math.round(w*ratio);
            if (layer.height!==Math.round(h*ratio)) layer.height=Math.round(h*ratio);
            ctx.setTransform(ratio,0,0,ratio,0,0);
            ctx.clearRect(0,0,w,h);
            const rx=w/width, ry=h/height;
            const bounds=gems.map(g=>({x:(lefty?width-g.x:g.x)*rx-g.rx*rx,
                y:(g.y-g.ry)*ry,w:2*g.rx*rx,h:2*g.ry*ry}));
            const obstacles=[...bounds];
            // Foreground instructions get first choice of space.
            const ordered=gems.map((g,i)=>({g,i})).filter(({g})=>labeled(g)).sort((a,b)=>b.g.y-a.g.y);
            const style=techniqueCaptionStyle;
            for (const {g,i} of ordered) {
                let font=Number.isFinite(g.fontSize)&&g.fontSize>0?g.fontSize*ry:style.fontSize;
                const lines=g.pm?['PM',String(g.label)]:[String(g.label)];
                // Measure ink, not the font's line box. Extra ascender/descender
                // padding otherwise makes the same nominal gap look detached.
                ctx.textAlign='center';ctx.textBaseline='alphabetic';
                const measure=()=>{
                    ctx.font=`${style.fontWeight} ${font}px ${style.fontFamily}`;
                    return lines.map(text=>{
                        const m=ctx.measureText(text);
                        return {width:m.width,
                            ascent:Number.isFinite(m.actualBoundingBoxAscent)?m.actualBoundingBoxAscent:font*.8,
                            descent:Number.isFinite(m.actualBoundingBoxDescent)?m.actualBoundingBoxDescent:font*.2};
                    });
                };
                let metrics=measure(),outline=style.outlineWidth*font/style.fontSize;
                let bw=Math.max(...metrics.map(m=>m.width))+outline;
                let lineHeight=font*style.lineHeight;
                let bh=metrics[0].ascent+(lines.length-1)*lineHeight+metrics.at(-1).descent+outline;
                // Preserve the requested text-size multiplier. Only impossible
                // viewport-sized captions need shrinking to remain readable on-screen.
                const fit=Math.min(1,(w-4)/bw,(h-4)/bh);
                if (fit<1) {
                    font*=fit;outline*=fit;lineHeight*=fit;metrics=measure();
                    bw=Math.max(...metrics.map(m=>m.width))+outline;
                    bh=metrics[0].ascent+(lines.length-1)*lineHeight+metrics.at(-1).descent+outline;
                }
                const box=placeContactLabel(bounds[i],bw,bh,obstacles,{w,h});
                obstacles.push(box);
                ctx.globalAlpha=Number.isFinite(g.opacity)?Math.max(0,Math.min(1,g.opacity)):1;
                const center=bounds[i].x+bounds[i].w/2;
                const idealY=bounds[i].y-bh-style.gap;
                const displacement=Math.hypot(box.x+bw/2-center,box.y-idealY);
                // A connector is reserved for collision-driven movement far
                // enough that a caption could otherwise belong to another note.
                if (displacement>font*1.5) {
                    const fromX=Math.max(bounds[i].x,Math.min(bounds[i].x+bounds[i].w,box.x+bw/2));
                    const fromY=Math.max(bounds[i].y,Math.min(bounds[i].y+bounds[i].h,box.y+bh/2));
                    const toX=Math.max(box.x,Math.min(box.x+bw,fromX));
                    const toY=Math.max(box.y,Math.min(box.y+bh,fromY));
                    ctx.strokeStyle=style.color;ctx.lineWidth=1;
                    ctx.globalAlpha*=.6;
                    ctx.beginPath();ctx.moveTo(fromX,fromY);ctx.lineTo(toX,toY);ctx.stroke();
                    ctx.globalAlpha=Number.isFinite(g.opacity)?Math.max(0,Math.min(1,g.opacity)):1;
                }
                ctx.lineJoin='round';
                ctx.lineWidth=outline;ctx.strokeStyle=style.outlineColor;ctx.fillStyle=style.color;
                lines.forEach((text,row)=>{
                    const x=box.x+bw/2,y=box.y+outline/2+metrics[0].ascent+row*lineHeight;
                    ctx.strokeText(text,x,y);
                    ctx.fillText(text,x,y);
                });
            }
            ctx.globalAlpha=1;
        },
        clear,
        destroy() {layer?.remove();layer=null;ctx=null;gems.length=0;},
    };
}
