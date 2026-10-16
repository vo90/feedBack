const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`), open = source.indexOf('{', start);
    assert.ok(start >= 0, name);
    let depth = 1, end = open + 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0, name);
    return source.slice(start, end);
}

// Frozen pre-optimization search. It deliberately knows nothing about the
// candidate's direct plane bounds, so both widening and the unchanged movable
// centre/fallback paths are checked against their previous behavior.
function legacySolve(preferredX, baseDistance, prediction, margin, fixedCentre, points, count, basis, intervalAt) {
    let low = baseDistance, high = low;
    const fixed = fixedCentre ? preferredX : null;
    let interval = intervalAt(high, prediction, margin, fixed, points, count, basis);
    if (!interval.valid) {
        for (let i = 0; i < 10 && !interval.valid; i++) {
            high *= 1.5;
            interval = intervalAt(high, prediction, margin, fixed, points, count, basis);
        }
        for (let i = 0; i < 16; i++) {
            const mid = (low + high) / 2;
            if (intervalAt(mid, prediction, margin, fixed, points, count, basis).valid) high = mid;
            else low = mid;
        }
        interval = intervalAt(high, prediction, margin, fixed, points, count, basis);
    }
    return { x: Math.max(interval.min, Math.min(interval.max, preferredX)), distance: high };
}

function harness() {
    return new Function('legacySolve', `
        const STABLE_CAMERA_FOV=60, STABLE_CAMERA_SHIFT=.48, TS=230;
        const cam={aspect:16/9}, _stableInterval={}, _stableFit={};
        let intervalCalls=0;
        ${extract('stableConstrain')}
        ${extract('stableIntervalAt').replace('{', '{ intervalCalls++;')}
        ${extract('stableSolve')}
        return {
            solve(points, o) {
                cam.aspect=o.aspect; intervalCalls=0;
                const result={...stableSolve(o.centre,o.base,o.prediction,o.margin,o.fixed!==false,
                    points,o.count??points.length,o.basis)};
                return {...result,intervalCalls};
            },
            legacy(points, o) {
                cam.aspect=o.aspect;
                return legacySolve(o.centre,o.base,o.prediction,o.margin,o.fixed!==false,
                    points,o.count??points.length,o.basis,stableIntervalAt);
            },
            fits(points, o, distance) {
                cam.aspect=o.aspect;
                return stableIntervalAt(distance,o.prediction,o.margin,o.centre,
                    points,o.count??points.length,o.basis).valid;
            }
        };
    `)(legacySolve);
}

function basis(preset, calibrated, lefty = false) {
    const sign = lefty ? -1 : 1;
    const yaw = preset === 'angled' ? sign * 14 * Math.PI / 180 : 0;
    const pitch = 25 * Math.PI / 180 - (calibrated ? Math.atan2(preset === 'straight' ? 9 : -1, 100) : 0);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    return {
        bx: Math.sin(yaw) * cp, by: sp, bz: Math.cos(yaw) * cp,
        rx: Math.cos(yaw), rz: -Math.sin(yaw),
        ux: -Math.sin(yaw) * sp, uy: cp, uz: -Math.cos(yaw) * sp,
        x: calibrated && preset === 'angled' ? -4 * sign : 0,
        y: 13 + (calibrated ? preset === 'straight' ? 10 : 3 : 0),
        distanceMul: calibrated ? preset === 'straight' ? .87 : .9 : 1,
    };
}
const options = extra => ({centre:35,base:100,prediction:.15,margin:.96,aspect:16/9,
    basis:basis('straight',true),...extra});
function random(seed) {
    return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test('fixed fit preserves empty and sufficient base views exactly, without interval searches', () => {
    const h = harness();
    for (const preset of ['straight', 'angled']) for (const calibrated of [false, true]) {
        const o = options({basis:basis(preset,calibrated)});
        for (const points of [[], [o.centre + o.basis.x,o.basis.y,0]]) {
            const actual = h.solve(points,o);
            assert.deepEqual(actual,{x:o.centre,distance:o.base,intervalCalls:0});
            assert.deepEqual(h.legacy(points,o),{x:o.centre,distance:o.base});
        }
    }
});

test('fixed fit agrees with frozen bisection across projections, handedness, prediction and random geometry', () => {
    const h = harness(), next = random(0x981ac3);
    let widened = 0;
    for (const preset of ['straight','angled']) for (const calibrated of [false,true]) {
        for (const lefty of [false,true]) for (const aspect of [.5,16/9,2.6,32/9]) {
            for (const prediction of [0,.15,.5]) for (const margin of [.82,.9,.96]) {
                for (let trial=0;trial<12;trial++) {
                    const o=options({basis:basis(preset,calibrated,lefty),aspect,prediction,margin,
                        centre:(next()-.5)*180,base:70+next()*80});
                    const points=Float64Array.from(Array.from({length:3*(1+Math.floor(next()*30))},(_,i)=>
                        i%3===0?(next()-.5)*400:i%3===1?(next()-.5)*100:-next()*400+8));
                    const actual=h.solve(points,o), old=h.legacy(points,o);
                    assert.equal(actual.x,o.centre);
                    assert.equal(actual.intervalCalls,0);
                    assert.ok(h.fits(points,o,actual.distance),'direct fit must satisfy the original constraints');
                    assert.ok(actual.distance<=old.distance+1e-9,'direct fit must not exceed the bisection bracket');
                    // The old search starts with an upper bracket up to 1.5
                    // times the answer, then bisects that bracket 16 times.
                    assert.ok(old.distance-actual.distance<=1.5*old.distance/65536+1e-8,
                        `difference exceeds old search resolution: ${JSON.stringify({actual,old,o})}`);
                    if (actual.distance>o.base) {
                        widened++;
                        assert.ok(!h.fits(points,o,actual.distance*(1-1e-7)),
                            'a meaningfully smaller distance must violate a plane');
                    }
                }
            }
        }
    }
    assert.ok(widened>1000,'exercise actual widening, not only sufficient bases');
});

test('fixed fit protects the near plane, ignores unused storage, and leaves point storage unchanged', () => {
    const h=harness(), b=basis('angled',true,true), o=options({basis:b,base:10,prediction:0});
    // A point directly toward the camera makes near depth, rather than a side,
    // the limiting plane. Its unused buffer tail must not affect framing.
    const points=Object.freeze([o.centre+b.x+b.bx*250,b.y+b.by*250,b.bz*250,1e10,1e10,1e10]);
    o.count=3;
    const result=h.solve(points,o);
    assert.ok(h.fits(points,o,result.distance));
    assert.ok(Math.abs(result.distance-(250+.02)/b.distanceMul)<1e-9);
    assert.equal(result.intervalCalls,0);
    assert.equal(points[3],1e10);
});

test('movable centres and unsupported projection coefficients retain the original solver', () => {
    const h=harness(), points=[-180,-15,0,160,85,-40];
    for (const overrides of [{fixed:false},{margin:0},{margin:-.2},{aspect:0},
        {basis:{...basis('angled',true),distanceMul:0}}]) {
        const o=options(overrides), actual=h.solve(points,o), old=h.legacy(points,o);
        assert.ok(actual.intervalCalls>0,'unsupported inputs use the original interval search');
        assert.deepEqual({x:actual.x,distance:actual.distance},old);
    }
});

test('fixed fits project inside the actual Three camera for both calibrated and nominal presets', async () => {
    const T=await import(pathToFileURL(path.join(__dirname,'../../static/vendor/three/three.module.min.js')).href);
    const h=harness(), next=random(0x923ff1);
    for (const preset of ['straight','angled']) for (const calibrated of [false,true]) {
        for (const lefty of [false,true]) for (const aspect of [.55,16/9,2.6]) {
            for (const prediction of [0,.15,.5]) {
                const b=basis(preset,calibrated,lefty), o=options({basis:b,aspect,prediction,margin:.82});
                const points=Array.from({length:90},(_,i)=>i%3===0?(next()-.5)*400:
                    i%3===1?(next()-.5)*90:8-next()*300);
                const result=h.solve(points,o), distance=result.distance*b.distanceMul;
                const camera=new T.PerspectiveCamera(60,aspect,.01,1e6);
                camera.position.set(o.centre+b.x+b.bx*distance,b.y+b.by*distance,b.bz*distance);
                camera.lookAt(o.centre+b.x,b.y,0);
                camera.updateMatrixWorld();
                camera.projectionMatrix.elements[9]=.48;
                for (let i=0;i<points.length;i+=3) {
                    const z=Math.max(points[i+2],Math.min(0,points[i+2]+prediction*230));
                    const p=new T.Vector3(points[i],points[i+1],z).project(camera);
                    assert.ok(Math.abs(p.x)<=o.margin+1e-10,`horizontal clip ${p.x}`);
                    assert.ok(Math.abs(p.y)<=Math.max(.9,o.margin)+1e-10,`vertical clip ${p.y}`);
                    assert.ok(p.z>=-1&&p.z<=1,`depth clip ${p.z}`);
                }
            }
        }
    }
});
