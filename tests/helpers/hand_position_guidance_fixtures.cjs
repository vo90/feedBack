// Minimal, time-shifted passages capturing independent guidance cases.
// These contain only the few events needed to establish each behavior.
const template = (frets, extra = {}) => ({ frets, ...extra });
const position = (time, fret, width = 4) => ({ time, fret, width, guidanceOrigin: 'unknown' });
const shape = (chord_id, start_time = 10, end_time = 12, extra = {}) =>
    ({ chord_id, start_time, end_time, ...extra });
const chord = (t, id, members, extra = {}) =>
    ({ t, id, notes: members.map(([s, f]) => ({ s, f })), ...extra });

function containingPowerChord() {
    return {
        notes: [],
        chords: [chord(10, 0, [[0, 3], [1, 5]])],
        anchors: [position(0, 2)],
        handShapes: [shape(0)],
        chordTemplates: [template([3, 5, -1, -1, -1, -1])],
    };
}

function pickedWideGrip() {
    return {
        notes: [
            { t: 10, s: 1, f: 3 }, { t: 10.15, s: 2, f: 5 },
            { t: 10.3, s: 3, f: 7 }, { t: 10.45, s: 2, f: 5 },
            { t: 11, s: 1, f: 3 },
        ],
        chords: [],
        anchors: [position(0, 3), position(11, 3)],
        handShapes: [shape(0, 10, 10.6)],
        chordTemplates: [template([-1, 3, 5, 7, -1, -1])],
    };
}

function stalePowerGrip() {
    return {
        notes: [],
        chords: [
            chord(9, 0, [[2, 5], [3, 7]]),
            chord(10, 1, [[2, 7], [3, 9]]),
            chord(10.5, 1, [[2, 7], [3, 9]]),
            chord(11, 1, [[2, 7], [3, 9]]),
        ],
        anchors: [position(0, 5), position(10, 7)],
        handShapes: [shape(0)],
        chordTemplates: [
            template([-1, -1, 5, 7, -1, -1]),
            template([-1, -1, 7, 9, -1, -1]),
        ],
    };
}

function staleFullGrip() {
    return {
        notes: [],
        chords: [
            chord(9, 0, [[1, 8], [2, 10], [3, 10], [4, 10], [5, 12]]),
            chord(10, 1, [[1, 7], [2, 9], [3, 9], [4, 9], [5, 10]]),
            chord(10.5, 1, [[1, 7], [2, 9], [3, 9], [4, 9], [5, 10]]),
        ],
        anchors: [position(0, 8, 5), position(10, 7)],
        handShapes: [shape(0)],
        chordTemplates: [
            template([-1, 8, 10, 10, 10, 12]),
            template([-1, 7, 9, 9, 9, 10]),
        ],
    };
}

function slideIntoArpeggio() {
    return {
        notes: [
            { t: 10, s: 2, f: 2, sus: 0.151, sl: 5 },
            { t: 10.303, s: 3, f: 4 }, { t: 10.601, s: 4, f: 5 },
        ],
        chords: [],
        anchors: [position(0, 1), position(10.152, 4)],
        handShapes: [
            shape(0, 10, 10.676, { arp: true }),
            shape(1, 10.152, 10.825, { arp: true }),
        ],
        chordTemplates: [
            template([-1, -1, 5, 4, 5, -1], { arp: true }),
            template([3, 2, 2, -1, -1, -1], { arp: true }),
        ],
    };
}

function partialChordInFullGrip() {
    return {
        notes: [{ t: 10, s: 1, f: 3 }, { t: 10.2, s: 2, f: 5 }],
        chords: [chord(10.4, 1, [[3, 7], [4, 5]])],
        anchors: [position(0, 3)],
        handShapes: [shape(0, 10, 10.8)],
        chordTemplates: [
            template([-1, 3, 5, 7, 5, -1]),
            template([-1, -1, -1, 7, 5, -1]),
        ],
    };
}

function disjointSustainedContacts() {
    const lower = chord(10.5, 1, [[0, 3], [1, 5]]);
    lower.notes.forEach(n => { n.sus = 0.8; });
    return {
        notes: [
            { t: 10, s: 4, f: 15, sus: 2 },
            { t: 10.2, s: 5, f: 17, sus: 1.8 },
        ],
        chords: [lower],
        anchors: [position(0, 15), position(10.5, 3)],
        handShapes: [shape(0)],
        chordTemplates: [
            template([-1, -1, -1, -1, 15, 17]),
            template([3, 5, -1, -1, -1, -1]),
        ],
    };
}

module.exports = {
    containingPowerChord, pickedWideGrip, stalePowerGrip, staleFullGrip,
    slideIntoArpeggio, partialChordInFullGrip, disjointSustainedContacts,
};
