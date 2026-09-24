// Only the compact AH/TH instructions use this crisp screen-resolution layer.
// The highway keeps its adaptive backing resolution and existing gem geometry.
// One owner per default-renderer instance; no song data or scoring is changed.
export function placeContactLabel(anchor, width, height, obstacles, viewport) {
    const gap = 5;
    const xs = [anchor.x + anchor.w / 2 - width / 2,
        anchor.x - width - gap, anchor.x + anchor.w + gap];
    const ys = [anchor.y + anchor.h + gap, anchor.y - height - gap];
    const overlap = (a,b) => Math.max(0, Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))
        * Math.max(0, Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
    let best, bestCost = Infinity;
    for (let row = 0; row < 5; row++) for (const baseY of ys) for (const x of xs) {
        const y = baseY < anchor.y ? baseY - row * (height + gap) : baseY + row * (height + gap);
        const box = {x:Math.max(2,Math.min(viewport.w-width-2,x)),
            y:Math.max(2,Math.min(viewport.h-height-2,y)),w:width,h:height};
        const area = obstacles.reduce((sum,b)=>sum+overlap(box,b),0);
        const distance = Math.abs(box.x + width/2 - (anchor.x+anchor.w/2))
            + Math.abs(box.y - (anchor.y+anchor.h+gap));
        const cost = area * 10000 + distance;
        if (cost < bestCost) {bestCost=cost;best=box;}
        if (cost === 0) return box;
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
            if (!gems.some(g=>g.label) || !canvas.parentElement || !(width>0&&height>0)) return;
            const w=canvas.clientWidth, h=canvas.clientHeight;
            if (!(w>0&&h>0)) return;
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
            const ordered=gems.map((g,i)=>({g,i})).filter(({g})=>g.label).sort((a,b)=>b.g.y-a.g.y);
            for (const {g,i} of ordered) {
                const font=Math.max(11,Math.min(18,g.fontSize*ry));
                ctx.font=`bold ${font}px sans-serif`;
                const lines=g.pm?['PM',g.label]:[g.label];
                const bw=Math.max(...lines.map(t=>ctx.measureText(t).width))+8;
                const lineHeight=font*1.2, bh=lineHeight*lines.length+4;
                const box=placeContactLabel(bounds[i],bw,bh,obstacles,{w,h});
                obstacles.push(box);
                const center=bounds[i].x+bounds[i].w/2;
                const moved=Math.abs(box.x+bw/2-center)>1 || Math.abs(box.y-(bounds[i].y+bounds[i].h+5))>1;
                if (moved) {
                    ctx.strokeStyle='rgba(255,255,255,.6)';ctx.lineWidth=1;
                    ctx.beginPath();ctx.moveTo(center,bounds[i].y+bounds[i].h/2);
                    ctx.lineTo(Math.max(box.x,Math.min(box.x+bw,center)),box.y>bounds[i].y?box.y:box.y+bh);ctx.stroke();
                }
                ctx.fillStyle='rgba(8,12,20,.88)';ctx.fillRect(box.x,box.y,bw,bh);
                ctx.textAlign='center';ctx.textBaseline='top';
                lines.forEach((text,row)=>{ctx.fillStyle=text==='PM'?'#bfc9d6':'#fff';
                    ctx.fillText(text,box.x+bw/2,box.y+2+row*lineHeight);});
            }
        },
        clear,
        destroy() {layer?.remove();layer=null;ctx=null;gems.length=0;},
    };
}
