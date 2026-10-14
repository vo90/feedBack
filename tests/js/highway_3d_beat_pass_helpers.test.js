// Baseline beat passes from b48c31230c103e5d8e2d3569636aca4493e95dca.
// Marker registration is replaced only by its unchanged sprite-center effect;
// registry removal and the intentional wave-cache changes are tested separately.
const ORIGINAL_BEAT_LINES = String.raw`
            if (beats) {
                const board = boardSpanX();
                const bw2 = board.width + 4 * K;
                for (const b of beats) {
                    if (b.time < t0 || b.time > t1) continue;
                    // Only explicit bar starts are bright. Ordinary beats use
                    // measure=-1, including the beat immediately after a bar.
                    const isMeasure = Number.isInteger(b.measure) && b.measure >= 0;
                    const bl2 = pBeat.get();
                    bl2.material = isMeasure ? mBeatM : mBeatQ;
                    bl2.scale.set(bw2, 1, 1);
                    bl2.position.set(board.min - 2 * K, S_BASE - NH / 2 - 1.5 * K, dZ(b.time - now));
                }
            }`;
const ORIGINAL_FRET_MARKERS = String.raw`
            if (beats && fretColumnMarkerCadence > 0) {
                // Prune stale wave cache entries (wave already past now).
                if (_fretMarkerWaveCache.size > 0) {
                    for (const k of _fretMarkerWaveCache.keys()) {
                        if (k < now) _fretMarkerWaveCache.delete(k);
                    }
                }
                const minStringY = Math.min(sY(0), sY(nStr - 1));
                const labelY = minStringY - S_GAP * 0.8;
                for (const b of beats) {
                    // Non-downbeats are encoded as measure=-1; only actual
                    // measure starts (measure >= 0) can spawn marker waves.
                    if (b.measure < 0) continue;
                    if (b.time < 0 || b.time > t1) continue;
                    if (b.time <= now) continue;
                    if ((b.measure | 0) % fretColumnMarkerCadence !== 0) continue;

                    // Snapshot the active-range gate at first sight of this
                    // wave. We scan notes/chords in a 2s window starting at
                    // b.time rather than activeFrets, because activeFrets only
                    // covers now+2s and waves first become visible up to
                    // AHEAD (3s) ahead — using activeFrets would cache
                    // {hasLow:false, hasHigh:false} for far waves and suppress
                    // the entire row for its full flight.
                    let cached = _fretMarkerWaveCache.get(b.time);
                    if (!cached) {
                        let hasLow = false, hasHigh = false;
                        const wT0 = b.time, wT1 = b.time + 2;
                        // notes and chords are time-sorted; binary-search to the
                        // first entry >= wT0, then break once past wT1 to avoid
                        // O(song_length) work per newly-seen wave.
                        if (notes) {
                            const startI = lowerBoundT(notes, wT0);
                            for (let i = startI; i < notes.length; i++) {
                                const n = notes[i];
                                if (n.t > wT1) break;
                                if (!validString(n.s) || !isPlayableFret(n.f) || n.f <= 0) continue;
                                if (n.f <= 12) hasLow = true; else hasHigh = true;
                                if (hasLow && hasHigh) break;
                            }
                        }
                        if ((!hasLow || !hasHigh) && chords) {
                            const startI = lowerBoundT(chords, wT0);
                            outer: for (let i = startI; i < chords.length; i++) {
                                const ch = chords[i];
                                if (ch.t > wT1) break outer;
                                if (!ch.notes) continue;
                                for (const cn of ch.notes) {
                                    if (!validString(cn.s) || !isPlayableFret(cn.f) || cn.f <= 0) continue;
                                    if (cn.f <= 12) hasLow = true; else hasHigh = true;
                                    if (hasLow && hasHigh) break outer;
                                }
                            }
                        }
                        const anc = anchors && anchors.length ? getChartAnchorAt(anchors, b.time) : null;
                        const anchorFret = anc != null ? Number(anc.fret) : NaN;
                        const anchorKeyed = Number.isFinite(anchorFret) && anchorFret >= 0;
                        const fretList = anchorKeyed
                            ? fretColumnMarkersForAnchor(anchorFret, DOTS)
                            : DOTS.slice();
                        cached = { hasLow, hasHigh, fretList, anchorKeyed };
                        _fretMarkerWaveCache.set(b.time, cached);
                    }
                    if (!cached.hasLow && !cached.hasHigh && !cached.anchorKeyed) continue;

                    const dt = b.time - now;
                    // Fade in over 0.35 s from the maximum lookahead distance so
                    // the label appears at its correct final size the moment it
                    // becomes visible, rather than gradually emerging as a tiny
                    // dim spec through scene fog (fog is disabled on the sprite
                    // material; this manual ramp replaces it).
                    const _colFadeIn = Math.min(1.0, (AHEAD - dt) / 0.35);
                    if (_colFadeIn <= 0) continue;

                    const z = dZ(dt);
                    // Sprite scale matches the per-note connector fret label
                    // (drawNote → pNoteFretLabel) so cadence markers read the
                    // same size at a given Z — no extra world-scale boost.
                    const clipMin = hwyLaneFretClipMin;
                    const clipMax = hwyLaneFretClipMax;
                    const fretList = cached.fretList || DOTS;
                    const anchorKeyedRow = !!cached.anchorKeyed;
                    for (const f of fretList) {
                        let show;
                        if (anchorKeyedRow) {
                            show = true;
                        } else {
                            if (f === 12) show = cached.hasLow || cached.hasHigh;
                            else if (f < 12) show = cached.hasLow;
                            else show = cached.hasHigh;
                        }
                        if (!show) continue;
                        if (!anchorKeyedRow && clipMin != null && (f <= clipMin || f > clipMax)) continue;
                        // Fixed colour — avoids mid-flight colour flips caused by
                        // activeFrets only covering now+2s while waves appear at
                        // AHEAD (3s), which made each marker start dark then
                        // suddenly jump to light when its note entered the 2s window.
                        const color = _highwayReferenceLabelColor('#888888');
                        const sp = pFretColMarker.get();
                        const m = txtMat(f, color, false, 'noteFret');
                        _setLabelMap(sp, m);
                        sp.center.set(0.5, 1);
                        sp.material.opacity = 0.85 * _colFadeIn;
                        sp.position.set(xFretMid(f), labelY, z);
                        // Z-proportional: sits between chord frame and note gem
                        // at the same depth, so chord frames never overdraw the
                        // marker and the marker never overdraws gems.
                        sp.renderOrder = renderOrderForLayerAtZ(z, 'FRET_COLUMN');
                        // Scale grows linearly from 2× at max lookahead to 1× at hit line,
                        // combined with natural perspective attenuation the label starts
                        // visibly larger and converges to the row-label size at z=0.
                        const sz = 7.0 * K * (1 + 0.4 * dt / AHEAD) * _textSizeMul * fretLabelScaleForFret(f);
                        sp.scale.set(sz, sz, 1);
                    }

                }
            }`;

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw Error(name);
}
const helperSource = extract('updateBeatLines') + '\n' + extract('updateFretColumnMarkers');
const lineCall = 'updateBeatLines(beats, now, t0, t1);';
const markerCall = 'updateFretColumnMarkers(beats, notes, chords, anchors, now, t1, hwyLaneFretClipMin, hwyLaneFretClipMax);';

function fixture(original) {
    const log = [], materials = new Map(), rows = { beat: [], marker: [] };
    const used = { beat: 0, marker: 0 }, state = { lefty: false, fail: null, hidden: [] };
    const decisions = [];
    const vec = label => ({ value: [0, 0, 0], set(x, y, z) {
        this.value = [x, y, z]; log.push([label, x, y, z]);
    } });
    const pool = kind => ({ get() {
        log.push(['get', kind, used[kind]]);
        if (state.fail === kind) throw new Error('pool failed: ' + kind);
        return rows[kind][used[kind]] ||= (() => {
            const index = used[kind];
            return { material: {}, position: vec(kind + index + '.position'),
                scale: vec(kind + index + '.scale'), center: vec(kind + index + '.center') };
        })();
    } });
    // Advance after get, including on reuse, without hiding its call order.
    const countingPool = kind => {
        const p = pool(kind);
        return { get() { const row = p.get(); used[kind]++; return row; } };
    };
    const env = {
        K: 1, S_BASE: 8, NH: 2, AHEAD: 3, S_GAP: 4,
        DOTS: [3, 5, 7, 9, 12, 15, 17, 19, 21, 24],
        FRET_COL_MARKER_ANCHOR_BACK: 2, FRET_COL_MARKER_ANCHOR_FWD: 3,
        mBeatM: { name: 'measure' }, mBeatQ: { name: 'beat' },
        pBeat: countingPool('beat'), pFretColMarker: countingPool('marker'),
        boardSpanX: () => { log.push(['board']); return { min: 2, width: 24 }; },
        dZ: t => -230 * t, sY: i => 8 + i * 4,
        isPlayableFret: f => Number.isFinite(f) && f >= 0 && f <= 24,
        _highwayReferenceLabelColor: c => { log.push(['color', c]); return c; },
        txtMat: (f, color, bold, role) => {
            log.push(['text', f, color, bold, role]);
            const key = [f, color, bold, role].join(':');
            if (!materials.has(key)) materials.set(key, { key });
            return materials.get(key);
        },
        _setLabelMap: (sp, material) => { log.push(['map', material.key]); sp.map = material; },
        _fretReferenceHiddenFrets: (time, frets) => { decisions.push({time,frets:frets.slice(),hidden:state.hidden.slice()}); return new Set(state.hidden); },
        xFretMid: f => (state.lefty ? -1 : 1) * f * 11,
        renderOrderForLayerAtZ: (z, layer) => { log.push(['order', z, layer]); return z + .5; },
        fretLabelScaleForFret: f => f === 12 ? .9 : 1,
        between: () => log.push(['between-passes']),
    };
    const h = new Function(...Object.keys(env), `
        let nStr=6, _textSizeMul=1, fretColumnMarkerCadence=1;
        const validString=s=>Number.isInteger(s)&&s>=0&&s<nStr;
        const _fretMarkerWaveCache=new Map();
        ${extract('lowerBoundT')}
        ${extract('getChartAnchorAt')}
        ${extract('fretColumnMarkersForAnchor')}
        ${original ? '' : helperSource}
        return { cache:_fretMarkerWaveCache,
            draw(beats, options) {
                const {now=132, t0=now-.5, t1=now+3, notes=[], chords=[], anchors=null,
                    hwyLaneFretClipMin=null, hwyLaneFretClipMax=null}=options;
                nStr=options.nStr ?? 6; _textSizeMul=options.textSize ?? 1;
                fretColumnMarkerCadence=options.cadence ?? 1;
                ${original ? ORIGINAL_BEAT_LINES : lineCall}
                between();
                ${original ? ORIGINAL_FRET_MARKERS : markerCall}
            }
        };
    `)(...Object.values(env));
    const snapshot = () => ({ log: log.slice(), cache: Array.from(h.cache.entries()).map(([k, v]) =>
        [k, { ...v, fretList: v.fretList.slice() }]),
        pools: Object.fromEntries(Object.entries(rows).map(([key, values]) => [key,
            values.slice(0, used[key]).map(row => ({ material: row.material.name,
                map: row.map?.key, opacity: row.material.opacity, f: row.f, t: row.t,
                position: row.position.value.slice(), scale: row.scale.value.slice(), center: row.center.value.slice(),
                renderOrder: row.renderOrder }))])) });
    return { log, cache: h.cache, snapshot, decisions, rows,
        draw(beats, options = {}) {
            log.length = 0; used.beat = used.marker = 0;
            state.lefty = !!options.lefty; state.fail = options.fail; state.hidden = options.hidden || [];
            h.draw(beats, options); return snapshot();
        } };
}

test('beat lines retain their original body and both helpers keep their update positions', () => {
    for (const [name, frozen] of [['updateBeatLines', ORIGINAL_BEAT_LINES]]) {
        const helper = extract(name);
        assert.equal(helper.slice(helper.indexOf('{') + 1, -1).replace(/\r\n/g, '\n').trim(), frozen.trim());
        assert.ok(source.indexOf('function ' + name + '(') < source.indexOf('function update(bundle)'));
    }
    const start = source.indexOf('function update(bundle)');
    const end = source.indexOf('function updateChordPhase(', start);
    const update = source.slice(start, end);
    assert.equal(update.split(lineCall).length, 2);
    assert.equal(update.split(markerCall).length, 2);
    assert.ok(update.indexOf(lineCall) < update.indexOf('const refs=[bundle.wah'));
    assert.ok(update.indexOf(markerCall) > update.indexOf('const refs=[bundle.wah'));
    assert.ok(update.indexOf(markerCall) < update.indexOf('let lockActive;'));
});

const output = snapshot => ({log:snapshot.log,pools:snapshot.pools});

test('unobstructed first-wave sprites retain baseline positioning, fade, scale and draw order', () => {
    const beats=[0,-1,1,-1,2,3,4,-1].map((measure,i)=>({time:131+i*.5,measure}));
    const configurations=[
        {notes:[{t:133,s:0,f:5},{t:134,s:5,f:17}]},
        {notes:[{t:133,s:0,f:5}],chords:[{t:134,notes:[{s:3,f:17}]}]},
        {notes:[{t:133,s:-1,f:5},{t:134,s:0,f:0}],chords:[{t:134},{t:134.5,notes:[]}]},
        {anchors:[{time:0,fret:7},{time:134,fret:17}]},
        {anchors:[{time:0,fret:'bad'}],chords:[{t:133,notes:[{s:0,f:12}]}]},
    ];
    for(const config of configurations) for(const cadence of [0,1,4])
    for(const now of [131.5,132,132.35,133,134])
    for(const variant of [{nStr:4,textSize:.5},{nStr:7,textSize:1.5,lefty:true,hwyLaneFretClipMin:5,hwyLaneFretClipMax:17}]) {
        const options={...config,...variant,now,cadence};
        assert.deepEqual(output(fixture(false).draw(beats,options)),output(fixture(true).draw(beats,options)));
    }
});

test('bounds, duplicates, unsorted and unusual beat values retain exact results and failures', () => {
    const grids = [null,undefined,[],[
        {time:135,measure:0},{time:131.5,measure:-1},{time:132,measure:0},
        {time:134.65,measure:4},{time:134.6500000001,measure:4},
        {time:134,measure:1},{time:134,measure:1},{time:-1,measure:0},
        ...[undefined,null,'3',true,1.5,NaN,Infinity,-Infinity].map(measure=>({time:133,measure})),
        ...[NaN,Infinity,-Infinity,-0].map(time=>({time,measure:0})),
    ]];
    for (const beats of grids) for (const cadence of [0,1,4]) {
        const pair = [fixture(true),fixture(false)];
        const options = {cadence,anchors:[{time:0,fret:7}]};
        assert.deepEqual(output(pair[1].draw(beats,options)),output(pair[0].draw(beats,options)));
    }
    for (const beats of [[null],[undefined],new Array(3)]) {
        const pair = [fixture(true),fixture(false)];
        for (const h of pair) assert.throws(()=>h.draw(beats),TypeError);
        assert.deepEqual(output(pair[1].snapshot()),output(pair[0].snapshot()));
    }
});

test('custom iterator yields, closure on abrupt completion, and observable callback order are preserved', () => {
    for (const fail of [null,'beat','marker']) {
        const results = [true,false].map(original => {
            const h=fixture(original), iteration=[];
            const beats = {
                *[Symbol.iterator]() {
                    iteration.push('open');
                    try {
                        for (const row of [{time:133,measure:0},{time:134,measure:1}]) {
                            iteration.push(['yield',row.time]); yield row;
                        }
                    } finally { iteration.push('close'); }
                }
            };
            let error;
            try { h.draw(beats,{fail,anchors:[{time:0,fret:7}]}); }
            catch (e) { error=e.message; }
            return {state:output(h.snapshot()),iteration,error};
        });
        assert.deepEqual(results[1],results[0]);
        assert.equal(results[1].iteration.at(-1),'close');
        assert.equal(results[1].error,fail?'pool failed: '+fail:undefined);
    }
});

const markerFrets = result => result.pools.marker.map(row=>Number(row.map.split(':')[0]));

test('a wave snapshots hidden frets before fade or allocation and retains them through camera/index changes', () => {
    const h=fixture(false),beat={time:220.673996,measure:165},anchors=[{time:0,fret:3}];
    const first=h.draw([beat],{now:beat.time-3,anchors,hidden:[3]});
    const cached=h.cache.get(beat.time),hidden=cached.hiddenFrets;
    assert.equal(first.pools.marker.length,0,'first lookahead frame has not faded in');
    assert.equal(h.decisions.length,1,'clearance is queried before any visible sprite');
    assert.equal(h.decisions[0].time,beat.time);
    assert.ok(hidden.has(3));
    for(const now of [beat.time-2.9,beat.time-1,beat.time-.01]) {
        const result=h.draw([beat],{now,anchors,hidden:[5],lefty:true,textSize:1.5,hwyLaneFretClipMin:7,hwyLaneFretClipMax:9});
        assert.equal(h.cache.get(beat.time),cached);
        assert.equal(cached.hiddenFrets,hidden);
        assert.equal(h.decisions.length,1,'midflight clearance is not recomputed');
        assert.ok(!markerFrets(result).includes(3),'hidden fret never allocates a sprite');
        assert.ok(markerFrets(result).includes(5),'retained fret cannot disappear midflight');
        assert.equal(result.log.filter(row=>row[0]==='get'&&row[1]==='marker').length,cached.fretList.length-1);
    }
});

test('no-anchor clipping is frozen per wave, then a new wave uses current gates and reuses sprites', () => {
    const h=fixture(false),notes=[{t:11,s:0,f:5},{t:12,s:0,f:5}];
    const first=h.draw([{time:11,measure:0}],{now:10,notes,hwyLaneFretClipMin:3,hwyLaneFretClipMax:9,hidden:[7]});
    assert.deepEqual(markerFrets(first),[5,9]);
    const row=h.rows.marker[0],cached=h.cache.get(11);
    const next=h.draw([{time:11,measure:0}],{now:10.5,notes,hwyLaneFretClipMin:7,hwyLaneFretClipMax:12,hidden:[5]});
    assert.deepEqual(markerFrets(next),[5,9]);
    assert.equal(h.cache.get(11),cached);
    const future=h.draw([{time:12,measure:1}],{now:11.1,notes,hwyLaneFretClipMin:7,hwyLaneFretClipMax:12,hidden:[9]});
    assert.deepEqual(markerFrets(future),[12]);
    assert.equal(h.cache.has(11),false,'expired wave is pruned');
    assert.equal(h.rows.marker[0],row,'new-wave marker reuses the old pool slot');
    assert.equal(future.pools.marker[0].center[1],1,'reused marker keeps the floor baseline');
    assert.equal(h.decisions.length,2);
});

test('backward seek prunes future decisions and returning waves are evaluated again', () => {
    const h=fixture(false),beat={time:20,measure:0},anchors=[{time:0,fret:3}];
    h.draw([beat],{now:18,anchors,hidden:[3]});
    const previous=h.cache.get(20);
    h.draw([beat],{now:10,anchors});
    assert.equal(h.cache.size,0,'future cache outside the new horizon is pruned');
    const result=h.draw([beat],{now:18,anchors,hidden:[5]});
    assert.notEqual(h.cache.get(20),previous);
    assert.equal(h.decisions.length,2);
    assert.ok(markerFrets(result).includes(3));
    assert.ok(!markerFrets(result).includes(5));
});
