# Camera continuity with calibrated viewpoints

The September 23 Standard-view calibration used a closer, differently tilted
viewpoint for rendering and the final visibility guard, while the zoom plan
still fitted the nominal viewpoint. Boston Lead, 10–29 seconds, exposed 44
camera distance changes over 0.01 world units. Presentation time advanced
normally; the apparent highway retreat was the camera moving.

Three mechanisms combined:

- The plan reserved the fixed fret row but omitted the lower, top-anchored
  incoming digits. Their arrival could force a last-moment distance change.
- Axis-aligned boxes around depth bins combined extrema from different
  objects. Crossing a bin boundary invented a new corner and changed the fit
  discontinuously.
- The final guard overwrote distance after smoothing without updating the
  narrowing controller. Its expired return repeatedly discarded that widening.

The lateral camera stops remain unchanged. Each region additionally reserves
the actual preset's view of the playing area and incoming digits. Near-region
visibility and the scheduled pan participate in the anticipated zoom target.
Preset pitch, yaw, pan and distance multipliers remain unchanged; the fitted
distance can be wider where those visible labels need room.

The calibrated visibility fit retains real support points for the five frustum
planes at current and predicted depth. The query directions depend on
the preset, aspect, margin and depth prediction, but not the distance or centre
being solved. At most 10 points therefore reproduce the fit of all collected
points without imaginary corners. Nominal composition keeps its conservative
depth bins; their requirements go through the zoom controller instead of the
final calibrated guard. Segment clipping also samples the two kinks
in predicted depth. Static box edges need no duplicate endpoint submissions
when their corners already lie inside the fully protected region.

Outward movement uses a critically damped response with velocity. A settling
period decelerates existing movement before the finite narrowing return.
Increasing requirements cancel that return, including when they remain below
the current distance. A necessary final visibility correction updates both
return state and velocity. Explicit seeks, preset changes and resize retain
their intentional reset behaviour; pause and Follow off hold the pose.

No audio transport, scoring, note timing, chart data or user camera preference
is changed by this implementation. The geometry collector and solver use
fixed-size storage; the region plan remains cached and its per-frame lookahead
is bounded. Camera work still costs CPU and should be measured on dense charts.

Tests compare reduced versus unreduced fitting, label arrival framing, zoom
velocity/settling, lifecycle controls, and actual renderer projections. The
browser harness accepts `--camera-fixture` for a local chart export, plus
`--camera-preset`, `--camera-rate`, `--camera-fps`, and viewport options. Its
synthetic fixture exercises the same arrival sequence without private chart
data. Clock monotonicity alone is not sufficient visual acceptance.

The regular dev integration backport retains its pre-calibration viewpoint.
Its visibility support and arrival reservation use the existing nominal basis;
the newer preset angles are not introduced by the backport.
