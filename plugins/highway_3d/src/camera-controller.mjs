/** Lateral lifecycle correction around an already cached camera schedule.
 * Each renderer owns one controller. samplePlan(time, out) samples that
 * renderer's current schedule; it must reuse out and must not scan the chart.
 * The renderer still owns pause, Follow, seek, fit, and last-plan bookkeeping.
 */
export function createCameraController({ samplePlan, hwyCameraJoinAt, hwyCameraResumeAt }) {
    if ([samplePlan, hwyCameraJoinAt, hwyCameraResumeAt].some(fn => typeof fn !== 'function')) {
        throw new TypeError('Camera controller requires plan, join, and resume samplers');
    }
    const previousSample = {};

    function diagnostics(s) {
        return s.motionDiagnostics || (s.motionDiagnostics = {
            mode: 'holding', plannedX: s.x, actualX: s.x,
            plannedVelocity: 0, actualVelocity: 0,
            arrivalTime: Infinity, correctionEnd: -Infinity,
            timing: null, journey: null,
        });
    }

    // Mark renderer-owned lifecycle states without changing the camera pose.
    function setMode(s, mode) {
        s.motionMode = mode;
        const report = diagnostics(s);
        report.mode = mode;
        report.actualX = s.x;
        report.actualVelocity = 0;
        return s;
    }

    // Return a correction to the current cached path, also used by the
    // renderer's visibility preview. Follow recovery blends from the held
    // pose into that path instead of cancelling its initial velocity with
    // a fixed offset: the latter can backtrack when the plan stops first.
    function sampleJoin(s, plan, frameTime, motionRate, out, plannedX = plan.x) {
        const recovering = s.followRecovery;
        const plannedVelocity = plan.velocity || 0;
        hwyCameraJoinAt(recovering ? s.followStartX - plannedX : s.rejoinStartOffset || 0,
            recovering ? s.followStartVelocity : s.rejoinStartVelocity || 0,
            s.rejoinStart || 0, s.rejoinEnd ?? -Infinity, frameTime, motionRate, out);
        if (recovering && frameTime < s.rejoinEnd) {
            const u = Math.max(0, Math.min(1, (frameTime - s.rejoinStart) / (s.rejoinEnd - s.rejoinStart)));
            const blend = u * u * u * (10 + u * (-15 + 6 * u));
            // The offset's origin includes today's plan position. Account
            // for its derivative so the actual camera starts at rest and
            // rejoins the plan's velocity, including after live edits.
            out.velocity -= (1 - blend) * plannedVelocity;
        }
        return out;
    }

    function update(s, plan, frameTime, motionRate, fallbackX) {
        const plannedX = plan.valid ? plan.x : fallbackX;
        const revised = s.planMotionRevision !== plan.motionRevision;
        let changed = s.planRevision !== plan.revision;
        if (changed && s.following && Number.isFinite(s.planTime)) {
            const previousPlan = samplePlan(s.planTime, previousSample);
            changed = Math.abs(previousPlan.x - s.planX) > 1e-8
                || Math.abs(previousPlan.velocity - s.planVelocity) > 1e-8;
        }
        // Equal instantaneous samples do not prove an active resume
        // still targets the new future path. Rejoin from the actual
        // pose whenever a revision arrives during a correction.
        if (revised && (frameTime < s.resumeUntil || frameTime < s.rejoinEnd)) changed = true;
        if ((frameTime < s.resumeUntil || frameTime < s.rejoinEnd) && s.joinRate !== motionRate) changed = true;
        if (changed || !s.following || s.followResumePending) {
            const followRecovery = s.followResumePending
                || (s.followRecovery && (frameTime < s.rejoinEnd || frameTime < s.resumeUntil));
            const continuingResume = frameTime < s.resumeUntil;
            const previousArrivalTime = continuingResume ? s.resumeUntil : s.planArrivalTime;
            const previousArrivalX = continuingResume ? s.resumeTarget : s.planArrivalX;
            const previousArrivalLaneTime = continuingResume ? s.resumeLaneTime : s.planArrivalLaneTime;
            const actualVelocity = s.following && !s.followResumePending ? s.planVelocity + s.rejoinVelocity : 0;
            s.rejoinStartOffset = s.x - plannedX;
            s.rejoinStartVelocity = actualVelocity - (plan.velocity || 0);
            s.rejoinStart = frameTime;
            s.joinRate = motionRate;
            s.rejoinEnd = frameTime + 0.7 * motionRate;
            s.resumeUntil = -Infinity;
            s.followResumePending = false;
            s.followRecovery = !!followRecovery;
            if (followRecovery) {
                s.followStartX = s.x;
                s.followStartVelocity = actualVelocity;
            }
            // The scheduled arrival includes a tuned settling tail.
            // Removing tuning during that tail still finishes the
            // current destination continuously before rejoining.
            let arrivalTime = plan.arrivalTime, arrivalX = plan.arrivalX;
            let arrivalLaneTime = plan.arrivalLaneTime;
            const sameDirectDestination = previousArrivalLaneTime === arrivalLaneTime
                && Math.abs(previousArrivalX - arrivalX) <= 1e-8;
            // A local correction can move while the nominal plan is
            // holding. Its distant next arrival is not a pending pan.
            let resumeDirect = !plan.transit && (continuingResume || !s.planTransit)
                && (plan.moving || (sameDirectDestination && (continuingResume || s.planMoving)));
            // Legacy tuning could remove a settling tail while the next move
            // still waited. New modes can already start/retarget before that
            // old arrival: extending its resume would then jump onto the new
            // path at the old deadline. Rejoin the new schedule instead.
            if (!plan.timing?.movementMode && s.following && (continuingResume || (!s.planTransit && s.planMoving))
                && previousArrivalTime > frameTime && previousArrivalTime < arrivalTime
                && Math.abs(previousArrivalX - plannedX) <= 1e-8) {
                arrivalTime = previousArrivalTime; arrivalX = previousArrivalX;
                arrivalLaneTime = previousArrivalLaneTime;
                resumeDirect = true;
            }
            // A pending direct recovery can be ahead of its newly delayed
            // nominal path. Keep its valid destination without backing up,
            // provided no later move starts inside the recovery window.
            let preservePendingDestination = followRecovery && continuingResume
                && sameDirectDestination && !plan.transit;
            if (preservePendingDestination && arrivalTime < s.rejoinEnd) {
                // One cached sample at the arrival selects the next segment;
                // looking only at the window's end could miss an out-and-back.
                const next = samplePlan(arrivalTime, previousSample);
                preservePendingDestination = next.valid && !next.moving
                    && Math.abs(next.x - arrivalX) <= 1e-8
                    && (next.timing ? next.timing.start >= s.rejoinEnd : next.arrivalTime === Infinity);
                if (preservePendingDestination) arrivalTime = s.rejoinEnd;
            }
            // An imminent arrival cannot compress Follow recovery. Ordinary
            // live-edit deadlines stay unchanged.
            if ((!followRecovery || preservePendingDestination)
                && Number.isFinite(arrivalTime) && arrivalTime > frameTime) {
                s.rejoinEnd = Math.min(s.rejoinEnd, arrivalTime);
                // A chain's final arrival can be many seconds away.
                // Keep its intermediate waypoints by fading the local
                // offset into the moving plan, rather than replacing
                // the whole chain with one destination-only curve.
                if (resumeDirect && (continuingResume || Math.abs(actualVelocity) > 1e-8 || Math.abs(plan.velocity) > 1e-8)) {
                    const delta = arrivalX - s.x;
                    let duration = (arrivalTime - frameTime) / motionRate;
                    // With zero terminal velocity, these Bernstein
                    // derivative controls stay nonnegative. A rapid
                    // slowdown can finish early, then hold until
                    // the deadline instead of falling back behind.
                    if (delta * actualVelocity > 0) duration = Math.min(duration,
                        2.5 * Math.abs(delta / actualVelocity));
                    s.resumeStart = frameTime; s.resumeEnd = frameTime + duration * motionRate;
                    s.resumeUntil = arrivalTime; s.resumeRate = motionRate;
                    s.resumeLaneTime = arrivalLaneTime;
                    s.resumeFrom = s.x; s.resumeTarget = arrivalX; s.resumeVelocity = actualVelocity;
                }
            }
        }
        const sample = s.rejoinSample || (s.rejoinSample = {});
        if (frameTime < s.resumeUntil) {
            hwyCameraResumeAt(s, frameTime, sample);
            s.rejoinOffset = sample.x - plannedX; s.rejoinVelocity = sample.velocity - (plan.velocity || 0);
            s.x = sample.x; s.targetX = s.resumeTarget;
        } else {
            sampleJoin(s, plan, frameTime, motionRate, sample, plannedX);
            s.rejoinOffset = sample.x; s.rejoinVelocity = sample.velocity;
            s.x = plannedX + sample.x; s.targetX = plannedX;
        }
        if (frameTime >= s.rejoinEnd && frameTime >= s.resumeUntil) s.followRecovery = false;
        const report = diagnostics(s);
        const mode = s.followRecovery ? 'follow-rejoin' : frameTime < s.resumeUntil
            ? frameTime < s.resumeEnd ? 'direct-resume' : 'arrival-hold'
            : frameTime < s.rejoinEnd ? 'local-rejoin'
                : plan.moving ? 'following' : 'holding';
        s.motionMode = report.mode = mode;
        report.plannedX = plannedX;
        report.actualX = s.x;
        report.plannedVelocity = plan.velocity || 0;
        report.actualVelocity = (plan.velocity || 0) + s.rejoinVelocity;
        report.arrivalTime = frameTime < s.resumeUntil ? s.resumeUntil : plan.arrivalTime;
        report.correctionEnd = frameTime < s.resumeUntil ? s.resumeEnd : s.rejoinEnd;
        report.timing = plan.timing ?? null;
        report.journey = plan.journey ?? null;
        return s;
    }

    return { update, setMode, sampleJoin };
}
