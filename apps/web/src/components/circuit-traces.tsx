// Circuit linework taken from the Theory6 Apps badge. Geometry only, drawn once on load.
const traces = [
  { d: "M1200 70 H1060 L1010 120 H930", end: [930, 120] },
  { d: "M1200 150 H1110 L1080 180 V250", end: [1080, 250] },
  { d: "M1200 430 H1120 L1070 380 H990", end: [990, 380] },
  { d: "M1200 500 H1000 L960 460 V420", end: [960, 420] },
  { d: "M760 0 V40 L800 80 H860", end: [860, 80] },
  { d: "M700 520 V480 L740 440 H820", end: [820, 440] },
  { d: "M0 470 H120 L160 510 V520", end: null },
  { d: "M380 520 V500 L420 460 H520", end: [520, 460] },
] as const;

export function CircuitTraces({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1200 520"
      preserveAspectRatio="xMaxYMid slice"
      fill="none"
      className={className}
    >
      {traces.map((trace, index) => (
        <g key={trace.d} style={{ "--trace-index": index } as React.CSSProperties}>
          <path
            d={trace.d}
            pathLength={1}
            className="circuit-trace"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {trace.end ? (
            <circle
              className="circuit-node"
              cx={trace.end[0]}
              cy={trace.end[1]}
              r="6"
              stroke="currentColor"
              strokeWidth="2"
              fill="var(--navy)"
            />
          ) : null}
        </g>
      ))}
    </svg>
  );
}
