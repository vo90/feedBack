const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

function fn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i=open;i<src.length;i++) {
        if (src[i]==='{') depth++;
        else if (src[i]==='}' && --depth===0) return src.slice(start,i+1);
    }
    throw new Error('Unclosed function ' + name);
}
const themesStart=src.indexOf('const BG_THEMES = {');
const themesEnd=src.indexOf('const BG_THEME_IDS',themesStart);
assert.ok(themesStart>=0 && themesEnd>themesStart);
const rsTheme=src.match(/const RSPLUS_DEFAULT_HIGHWAY = Object\.freeze\([\s\S]*?\);/)[0];
function harness() {
    return new Function(`
        ${src.slice(themesStart,themesEnd)}
        ${rsTheme}
        const HWY_LANE_STRIPE_ODD_HEX=0x103B5C, HWY_LANE_STRIPE_EVEN_HEX=0x08283C;
        ${src.match(/const FRET_LABEL_RS_IDLE_HEX = .*?;/)[0]}
        const HWY_LANE_STRIPE_OP_BASE=1, HWY_LANE_STRIPE_OP_INT=0, VENUE_LANE_OP_BOOST=1.3;
        let rsPlusNotation=false, hwThemeId='default', bgThemeId='default', _venueSceneOverride=false;
        const color=()=>({hex:0,setHex(hex){this.hex=hex;return this;}});
        const mat=()=>({color:color(),opacity:1,userData:{}});
        const T={Color:function(hex){return color().setHex(hex);}};
        const _boardPlaneMat=mat(), _boardDotMat=mat(), mLaneOdd=mat(), mLaneEven=mat();
        const mLaneDivider=mat(), mLaneDividerExt=mat();
        const scene={fog:{color:color()}}, ren={setClearColor(hex,alpha){this.clear=hex;this.alpha=alpha;}};
        const _bcActive=()=>false;
        let _laneTargetColor=null;
        ${fn('_bgThemeColors')}
        ${fn('_bgBackgroundColors')}
        ${fn('_bgHighwayColors')}
        ${fn('_usesRsDefaultHighway')}
        ${fn('_highwayReferenceLabelColor')}
        ${fn('_highwayLaneOpacity')}
        ${fn('_applyBgTheme')}
        return {
            ids:Object.keys(BG_THEMES),
            apply(style,highway='default',background='default',venue=false) {
                rsPlusNotation=style;hwThemeId=highway;bgThemeId=background;_venueSceneOverride=venue;
                _applyBgTheme();
                return {board:_boardPlaneMat.color.hex,lane:mLaneOdd.color.hex,laneDim:mLaneEven.color.hex,
                    inlay:_boardDotMat.color.hex,inlayAlpha:_boardDotMat.opacity,
                    ext:mLaneDividerExt.color.hex,dividerAlpha:mLaneDivider.opacity,
                    laneAlpha:_highwayLaneOpacity(.6),clear:ren.clear,fog:scene.fog.color.hex};
            },
            opacity(intensity,venue=false){_venueSceneOverride=venue;return _highwayLaneOpacity(intensity);},
            referenceColor(currentHex){return _highwayReferenceLabelColor(currentHex);},
            setDividerAlpha(value){mLaneDivider.opacity=value;},
            refs:{board:_boardPlaneMat,dot:_boardDotMat,odd:mLaneOdd,even:mLaneEven},
        };
    `)();
}

test('RS+ default floor is neutral and translucent while explicit background colors remain independent', () => {
    const h=harness(), before=h.apply(false,'default','deeppurple');
    const rs=h.apply(true,'default','deeppurple');
    assert.equal(before.lane,0x103B5C);
    assert.equal(rs.board,0x08090a);
    assert.equal(rs.lane,0x34373c);
    assert.equal(rs.laneDim,0x292c31);
    assert.equal(rs.laneAlpha,.55);
    assert.equal(rs.clear,before.clear);
    assert.equal(rs.fog,before.fog);
    for (const intensity of [0,.5,1]) for (const venue of [false,true]) assert.equal(h.opacity(intensity,venue),.55);
    assert.equal(rs.inlay,0x4b4e54);
    assert.equal(rs.inlayAlpha,.55);
});

test('every named highway theme preserves its colors and opacity in RS+ style', () => {
    const h=harness();
    for (const id of h.ids.filter(id=>id!=='default')) {
        const current=h.apply(false,id,'forest'), rs=h.apply(true,id,'forest');
        assert.deepEqual(rs,current,id+' is a user color choice');
    }
});

test('live Current / RS+ / Current restores existing shared materials and divider opacity per panel', () => {
    const h=harness(), other=harness();
    h.setDividerAlpha(.12);
    const current=h.apply(false), unrelated=other.apply(false,'midnight'), refs={...h.refs};
    h.apply(true);
    assert.deepEqual(h.apply(false),current);
    assert.deepEqual(h.refs,refs,'style changes reuse board and lane materials');
    assert.deepEqual(other.apply(false,'midnight'),unrelated,'another panel is untouched');
    h.apply(true);
    const themed=h.apply(true,'forest');
    assert.deepEqual(themed,h.apply(false,'forest'),'leaving default restores ordinary dot and divider styling');
});

test('both lane layouts keep cyan boundaries and select grey only for RS+ default interior dividers', () => {
    const assignments=[...src.matchAll(/div\.material = _usesRsDefaultHighway\(\)[\s\S]*?;/g)].map(m=>m[0]);
    assert.equal(assignments.length,2,'anchor segments and fallback lane must share the rule');
    for (const assignment of assignments) {
        const choose=new Function('rsPlusNotation','hwThemeId','f',`
            ${fn('_usesRsDefaultHighway')}
            const fDiv0=2,fDiv1=6,fDivA=2,fDivB=6;
            const div={},mLaneDivider='cyan',mRsLaneDivider='grey';
            ${assignment}
            return div.material;
        `);
        for (let f=2;f<=6;f++) {
            assert.equal(choose(true,'default',f),f===2||f===6?'cyan':'grey');
            assert.equal(choose(false,'default',f),'cyan');
            assert.equal(choose(true,'forest',f),'cyan');
        }
    }
});

test('the additional divider uses cached shared ownership and is released on teardown', () => {
    assert.ok(/_ownedSharedMats\.push\(mLaneDivider, mLaneDividerArp, mLaneDividerExt, mRsLaneDivider\)/.test(src));
    assert.ok(/for \(const m of _ownedSharedMats\) m\?\.dispose\?\.\(\)/.test(src));
    assert.ok(/mLaneDividerArp = mRsLaneDivider = gLanePlane/.test(src));
});

test('idle and scrolling reference numbers are light grey only for the RS+ default highway', () => {
    const h=harness();
    for (const currentHex of ['#9ab8cc','#888888']) {
        h.apply(false);
        assert.equal(h.referenceColor(currentHex),currentHex);
        h.apply(true);
        assert.equal(h.referenceColor(currentHex),'#c0c3c7');
        h.apply(true,'forest');
        assert.equal(h.referenceColor(currentHex),currentHex);
        h.apply(false);
        assert.equal(h.referenceColor(currentHex),currentHex);
    }
    // Active and incoming gold labels use their original cache keys and colors;
    // this neutral-reference helper never affects chord names or active digits.
    assert.ok(/isInAnchor \? FRET_LABEL_GOLD_HEX : _highwayReferenceLabelColor\(FRET_LABEL_IDLE_HEX\)/.test(src));
    assert.ok(/const color = _highwayReferenceLabelColor\('#888888'\)/.test(src));
    assert.ok(/const FRET_LABEL_GOLD_HEX = '#D8A636'/.test(src));
});
