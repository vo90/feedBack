const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

function extractFunction(name, input = source) {
    const source = input;
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 1, end = open + 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0, name);
    return source.slice(start, end);
}

// The algorithm modules are imported intact. Only the renderer-owned geometry
// adapter still needs its existing controlled fixture environment below.
function cameraApi({onRenderableNote} = {}) {
    const {createCameraSemantics} = require('../../plugins/highway_3d/src/camera-semantics.mjs');
    const {createCameraMotion} = require('../../plugins/highway_3d/src/camera-motion.mjs');
    const predicates = new Function(`const NFRETS=24;
        ${['isPlayableFret','isPlainDeadNote','isUnpitchedMute','isRenderableNote'].map(name=>extractFunction(name)).join('\n')}
        return {isRenderableNote,isUnpitchedMute};
    `)();
    if (onRenderableNote) {
        const renderable = predicates.isRenderableNote;
        predicates.isRenderableNote = (...args) => {
            onRenderableNote();
            return renderable(...args);
        };
    }
    return {...createCameraSemantics({NFRETS:24,...predicates}),...createCameraMotion(predicates)};
}

// Preserve the old tests' positional calls while exercising production module
// functions. Obsolete composition callbacks deliberately have no effect.
function legacyCameraApi() {
    const api = cameraApi();
    return {...api,
        hwyBuildCameraTimeline: (regions,context=null,excursionThreshold=500) =>
            api.hwyBuildCameraTimeline(regions,{context,excursionThreshold}),
        hwyBuildCameraStops: (regions,rate,canHold,sharedCentre,dominantInterval,attacks,context=null,excursionThreshold=500) =>
            api.hwyBuildCameraStops(regions,{context,excursionThreshold}),
        // Old fixtures still pass the retired minimum-fret gate in the slot
        // now used by manual preparation. Keep their original Auto behavior.
        hwyBuildCameraMotion: (stops,rate,smoothing,delay,extra,settling) =>
            api.hwyBuildCameraMotion(stops,rate,smoothing,delay,extra,settling),
        hwyCameraPlanAt: (stops,now,rate,smoothing,out,delay,extra,settling) =>
            api.hwyCameraPlanAt(stops,now,rate,smoothing,out,delay,extra,settling),
    };
}

function harness(subject = source, three = null) {
    const source = subject;
    const extract = name => extractFunction(name, subject);
    const constants = ['STABLE_CAMERA_FOV', 'STABLE_CAMERA_PITCH', 'STABLE_CAMERA_YAW', 'STABLE_CAMERA_SHIFT', 'STABLE_CAMERA_VIEWS']
        .map(name => source.match(new RegExp(`const ${name} = [^;]+;`))[0]).join('\n');
    const stateStart = source.indexOf('const _stableCam = {');
    const stateEnd = source.indexOf('function stableAddPoint(', stateStart);
    assert.ok(stateStart >= 0 && stateEnd > stateStart);
    const api = cameraApi();
    const {createCameraController} = require('../../plugins/highway_3d/src/camera-controller.mjs');
    return new Function('Three', 'cameraApi', 'createCameraController', `
        const K = 1, TS = 230, AHEAD = 3, CAM_LOCK_CENTER_FRET = 6, NFRETS = 24;
        ${['isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'isRenderableNote'].map(extract).join('\n')}
        const rawPoints = [];
        ${constants}
        ${source.slice(stateStart, stateEnd).replace('function stableSupportReset() {', 'function stableSupportReset() { rawPoints.length = 0;')}
        let _stableCameraResetSerial = 0, stableCameraPreset = 'straight', stableCameraFollow = true;
        let stableCameraDepartureDelay = 0, stableCameraTravelExtra = 0, stableCameraSettleLimit = 0;
        let stableCameraPreparationMode = 'auto', stableCameraPreparationMs = 700;
        let stableCameraExcursionThreshold = 500, stableCameraLongSwitchFrets = 5;
        let _leftyCached = false, _songKey = 'song', nStr = 6, cameraSmoothing = .5, zoomSmoothing = .5;
        let wall = 0, fixturePoints = [], fixtureObjects = null, segmentCalls = 0, depthCalls = 0,
            regionFixture = null, regionRows = null, lastRegionTime = NaN, curX = 60;
        const S_GAP = 4, NH = 3, _textSizeMul = 1, _frameNow = 0;
        const pNote = {forEachActive(visitor) { fixtureObjects?.forEach(visitor); }},
            pSus = null, pSusRibbon = null, pChordBox = null,
            pRsChordFrame = null, pArpBracket = null, pSusRail = null, pTechPlane = null;
        const _incomingFloorLabelCount = 0, _incomingFloorLabels = [];
        let _incomingFixedFretLabels = {};
        let ctl = null, tgtX = 0, curDist = 0, tgtDist = 0, _fretRowFitBoost = 1;
        const highwayCanvas = {}, _freeCamFor = () => ctl;
        const cam = { aspect: 16 / 9, fov: STABLE_CAMERA_FOV,
            projectionMatrix: {elements: Object.assign([], {9: STABLE_CAMERA_SHIFT})},
            position: {set(...values) { this.values = values; }}, up: {set() {}},
            lookAt(...values) { this.target = values; }, updateMatrixWorld() {} };
        const T = Three || { Vector3: class {} }; // sprite-only tests need no vector methods
        const performance = { now: () => wall * 1000 };
        ${extract('createPresentationClock')}
        const _presentationClock = createPresentationClock();
        const sY = string => (3 + (nStr - 1 - string) * 4) * K;
        const xFretMid = fret => fret * 10 - 5, xFret = fret => fret * 10;
        const fretLabelScaleForFret = () => 1;
        const _stablePlan = {rows:null,key:'',stops:[],revision:0,result:{}};
        let stableMotionController = null;
        let mockRegionKey='', mockRegionAnchors=[];
        const dZ = time => { depthCalls++; return -time * TS; };
        ${extract('stableAddPoint').replace('_stablePointSamples++;', 'rawPoints.push([x,y,z]); _stablePointSamples++;')}
        ${extract('stableAddSegment').replace('{', '{ segmentCalls++;')}
        ${extract('stableCollectObject')}
        ${extract('stableConstrain')}
        ${extract('stableIntervalAt')}
        ${extract('stableSolve')}
        const {${Object.keys(api).join(',')}} = cameraApi;
        ${['stableRegionFitDistance','stableRegionFootprint','stableRegionFraming','stableRegionViewDistance','stableCameraPlan','stableSampleCameraPlan','stableCamUpdate'].map(extract).join('\n')}
        ${extract('stableCollectGeometry').replace('function stableCollectGeometry(', 'function collectRealRegionGeometry(')}
        function stableCollectGeometry(region) {
            if (fixtureObjects) return collectRealRegionGeometry(region);
            stableSupportReset();
            _stableCam.pointCount = fixturePoints.length * 3;
            _stableCam.viewPointCount = fixturePoints.length ? _stableViewPoints.length : 0;
            _stableCam.minX = Infinity; _stableCam.maxX = -Infinity;
            fixturePoints.forEach((point, index) => {
                _stablePoints.set(point, index * 3);
                ${extract('stableCollectViewPoint').startsWith('function stableCollectViewPoint(point)')
                    ? '_stablePointInput.set(point); stableCollectViewPoint(_stablePointInput);'
                    : 'stableCollectViewPoint(...point);'}
                _stableCam.minX = Math.min(_stableCam.minX, point[0]);
                _stableCam.maxX = Math.max(_stableCam.maxX, point[0]);
            });
        }
        // Resolver behavior is covered separately; these fixtures isolate the
        // controller's playing-area target from secondary note geometry.
        function stablePlayingRegion(bundle, renderTime) {
            lastRegionTime = renderTime;
            if (regionRows?.length) {
                let region = regionRows[0];
                for (const row of regionRows) if (row.time <= renderTime) region = row;
                return region;
            }
            if (regionFixture) return regionFixture;
            const minX = Math.min(...fixturePoints.map(p => p[0]));
            const maxX = Math.max(...fixturePoints.map(p => p[0]));
            return { valid: fixturePoints.length > 0, x: (minX + maxX) / 2, minX, maxX,
                dMin: minX / 10, dMax: maxX / 10, time: 0, source: 'fixture', row: null };
        }
        function stableRegionAnchors() {
            const regions = regionRows || (regionFixture ? (regionFixture.valid ? [regionFixture] : [])
                : fixturePoints.length ? [{time:0,minX:Math.min(...fixturePoints.map(p=>p[0])),maxX:Math.max(...fixturePoints.map(p=>p[0]))}] : []);
            const key=JSON.stringify(regions.map(r=>[r.time,r.minX,r.maxX]));
            if(key!==mockRegionKey){mockRegionKey=key;mockRegionAnchors=regions.map(r=>({time:r.time,fret:r.minX/10+1,width:(r.maxX-r.minX)/10}));}
            return mockRegionAnchors;
        }
        function stableApplyPose() { curX = _stableCam.x; }
        ${extract('stableApplyPose').replace('function stableApplyPose(', 'function applyRealPose(')}
        const bundle = { currentTime: 0, isPlaying: true, notes: [], chords: [], anchors: [] };
        return {
            setObjects(objects) { fixtureObjects = objects; },
            collection() {
                return { raw:rawPoints.map(p=>p.slice()), points:Array.from(_stablePoints.slice(0,_stableCam.pointCount)),
                    view:Array.from(_stableViewPoints), maxima:_stableSupport.map(q=>Array.from(q.maxima)),
                    bins:_stableBins.map(b=>({...b})), sampleCount:_stablePointSamples,
                    pointCount:_stableCam.pointCount, viewPointCount:_stableCam.viewPointCount,
                    minX:_stableCam.minX, maxX:_stableCam.maxX };
            },
            collectObjects() {
                segmentCalls = depthCalls = 0; collectRealRegionGeometry(null);
                return {segmentCalls, depthCalls};
            },
            setPoints(points) { fixturePoints = points; },
            setRegion(minX, maxX, time = 0) {
                regionFixture = { valid: true, x: (minX + maxX) / 2, minX, maxX,
                    dMin: minX / 10, dMax: maxX / 10, time, source: 'anchor',
                    row: { time, dMin: minX / 10, dMax: maxX / 10 } };
            },
            setRegionTimeline(rows) {
                regionRows = rows.map(({time,minX,maxX}) => ({valid:true,time,minX,maxX,x:(minX+maxX)/2,
                    dMin:minX/10,dMax:maxX/10,source:'anchor',row:null}));
            },
            regionLookupTime() { return lastRegionTime; },
            setFocus(x, minX = x, maxX = x) {
                regionFixture = {valid:true,x,minX,maxX,dMin:minX/10,dMax:maxX/10,time:0,source:'fixture',row:null};
            },
            noRegion() { regionFixture = {valid:false,x:0,minX:Infinity,maxX:-Infinity,time:0,row:null}; },
            replaceAnchors(rows = []) { bundle.anchors = rows; },
            appendAnchor(row) { bundle.anchors.push(row); },
            settings(values) {
                if ('follow' in values) stableCameraFollow = values.follow;
                if ('preset' in values) stableCameraPreset = values.preset;
                if ('lefty' in values) _leftyCached = values.lefty;
                if ('aspect' in values) cam.aspect = values.aspect;
                if ('strings' in values) nStr = values.strings;
                if ('pan' in values) cameraSmoothing = values.pan;
                if ('rate' in values) bundle.playbackRate = values.rate;
                if ('epoch' in values) bundle.transport = {epoch: values.epoch};
                if ('departureDelay' in values) stableCameraDepartureDelay = values.departureDelay;
                if ('travelExtra' in values) stableCameraTravelExtra = values.travelExtra;
                if ('settleLimit' in values) stableCameraSettleLimit = values.settleLimit;
                if ('preparationMode' in values) stableCameraPreparationMode = values.preparationMode;
                if ('preparationMs' in values) stableCameraPreparationMs = values.preparationMs;
                if ('excursionThreshold' in values) stableCameraExcursionThreshold = values.excursionThreshold;
                if ('longSwitchFrets' in values) stableCameraLongSwitchFrets = values.longSwitchFrets;
            },
            planCache() { return _stablePlan; },
            frame(time, elapsed = 1 / 60, playing = true, frameTime) {
                wall += elapsed; bundle.currentTime = time; bundle.isPlaying = playing;
                stableCamUpdate(bundle, frameTime); return { ..._stableCam };
            },
            clockFrame(raw, wallMs, timestamp, options = {}, frameTime) {
                wall = wallMs / 1000;
                bundle.currentTime = raw;
                bundle.transport = options.transport === null ? null : {
                    epoch: 1, generation: 1, state: 'playing', rate: 1,
                    position: raw, sampledAt: wallMs, freshAt: wallMs,
                    endTime: Infinity, ...options,
                };
                bundle.isPlaying = !bundle.transport || bundle.transport.state === 'playing';
                const time = bundle.transport
                    ? _presentationClock.sample(raw, wallMs, bundle.transport, timestamp) : raw;
                stableCamUpdate(bundle, frameTime ?? time);
                return {state: {..._stableCam}, time, motionDt: _presentationClock.frameMotionDelta()};
            },
            resetClock() { _presentationClock.reset(); },
            solve(x, distance, prediction = 0, margin = .90, fixed = false) {
                stableCollectGeometry(); return { ...stableSolve(x, distance, prediction, margin, fixed) };
            },
            interval(distance, prediction = 0, margin = .90, fixed = null) {
                stableCollectGeometry(); return { ...stableIntervalAt(distance, prediction, margin, fixed) };
            },
            renderedPose(bridge = null) {
                ctl = bridge; applyRealPose();
                return {position: cam.position.values, target: cam.target, fov: cam.fov};
            },
            viewFits(point, state) {
                const p = Float64Array.from(point);
                return stableIntervalAt(state.distance, 0, .96, state.x, p, 3, _stableViewBasis).valid;
            },
            compareSupportedGeometry(points) {
                stableSupportReset();
                for(const point of points) {
                    ${extract('stableAddPoint').startsWith('function stableAddPoint(input)')
                        ? '_stablePointInput.set(point); stableAddPoint(_stablePointInput);'
                        : 'stableAddPoint(...point);'}
                }
                const all=Float64Array.from(rawPoints.flat());
                const selected=_stableViewPoints.slice();
                const prediction=Math.min(AHEAD,.15*_stableCam.rate);
                return [[prediction,.96,_stableViewBasis],[0,.96,_stableViewBasis]]
                    .flatMap(([prediction,margin,basis])=>[false,true].map(fixed=>({
                        exact:{...stableSolve(35,100,prediction,margin,fixed,all,all.length,basis)},
                        reduced:{...stableSolve(35,100,prediction,margin,fixed,selected,selected.length,basis)},
                        selectedCount:selected.length/3,inputCount:all.length/3,
                    })));
            },
            collectRegion(region, labels = []) {
                _incomingFixedFretLabels = {};
                for (const {fret, x, y, z, size} of labels) {
                    _incomingFixedFretLabels[fret] = { visible: true, isSprite: true, userData: {},
                        material: {opacity: 1}, center: {x: .5, y: 1}, updateWorldMatrix() {},
                        matrixWorld: {elements: [size,0,0,0,0,size,0,0,0,0,1,0,x,y,z,1]} };
                }
                collectRealRegionGeometry(region);
                return rawPoints.map(p=>p.slice());
            },
            spritePoints({ x, y, z, size, centerY }) {
                stableSupportReset();
                stableCollectObject({ visible: true, isSprite: true, userData: {}, material: { opacity: 1 },
                    center: { x: .5, y: centerY }, updateWorldMatrix() {},
                    matrixWorld: { elements: [size, 0, 0, 0, 0, size, 0, 0, 0, 0, 1, 0, x, y, z, 1] } });
                return rawPoints.map(p=>p.slice());
            },
            segmentPoints(a, b) {
                stableSupportReset();
                ${extract('stableAddSegment').startsWith('function stableAddSegment(points,')
                    ? 'stableAddSegment(Float64Array.from([...a, ...b]), 0, 3);'
                    : 'stableAddSegment(...a, ...b);'}
                return rawPoints.map(([x,y,z])=>({minX:x,maxX:x,minY:y,maxY:y,minZ:z,maxZ:z}));
            },
            projected(point, x, distance, prediction = 0) {
                const b = _stableBasis, dx = point[0] - x - b.x, y = point[1] - b.y;
                const z = Math.max(point[2], Math.min(0, point[2] + prediction * TS));
                const depth = distance - b.bx * dx - b.by * y - b.bz * z;
                const tangent = Math.tan(STABLE_CAMERA_FOV * Math.PI / 360);
                return { x: (b.rx * dx + b.rz * z) / (depth * tangent * cam.aspect),
                    y: (b.ux * dx + b.uy * y + b.uz * z) / (depth * tangent) - STABLE_CAMERA_SHIFT,
                    depth };
            },
            reset() { ++_stableCameraResetSerial; },
            changeSong() { _songKey += '-next'; bundle.notes = []; bundle.chords = []; bundle.anchors = []; },
        };
    `)(three, api, createCameraController);
}

module.exports = { source, extractFunction, cameraApi, legacyCameraApi, harness };
