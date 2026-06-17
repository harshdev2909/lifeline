import { clsx } from "clsx";

/**
 * The Lifeline mark: one heartbeat pulse whose tail resolves into a connected
 * mesh of nodes — the pulse and the network are the same line. Two-tone and
 * theme-adaptive: the mesh uses `currentColor` (so it inherits the surrounding
 * text color in either theme) and the live pulse + active node use the jade
 * accent. The square mark doubles as the app icon; see public/favicon.svg for
 * the bolder 16px-legible single-tone variant.
 */
export function LogoMark({
  size = 28,
  className,
  title = "Lifeline",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={(size * 34) / 32}
      height={size}
      viewBox="0 0 34 32"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
    >
      {/* Mesh edges + outer nodes — inherit text color. */}
      <g
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      >
        <path d="M18 16 L25 9 M25 9 L31 15 M31 15 L26 23 M26 23 L18 16 M25 9 L26 23" />
      </g>
      <g fill="currentColor">
        <circle cx="25" cy="9" r="2" />
        <circle cx="31" cy="15" r="2" />
        <circle cx="26" cy="23" r="2" />
      </g>

      {/* The live heartbeat pulse + its junction node — jade accent. */}
      <path
        d="M2 16 H8 l1.7 -1.2 l1.5 4 l2.3 -11 l2.5 13 l1.6 -5 H18"
        stroke="var(--accent)"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="18" cy="16" r="2.4" fill="var(--accent)" />
    </svg>
  );
}

/** Horizontal lockup: the mark + "Lifeline" set in Geist with optical spacing. */
export function Wordmark({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={clsx("inline-flex items-center gap-2.5 text-fg", className)}>
      <LogoMark size={size} />
      <span
        className="font-sans font-semibold tracking-tightish"
        style={{ fontSize: size * 0.74, lineHeight: 1 }}
      >
        Lifeline
      </span>
    </span>
  );
}
