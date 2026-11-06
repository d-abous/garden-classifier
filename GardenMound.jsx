/**
 * GardenMound — floating garden island SVG component.
 *
 * @param {object}  props
 * @param {string}  [props.width="100%"]      SVG width attribute
 * @param {string}  [props.height="100%"]     SVG height attribute
 * @param {string}  [props.className=""]      Extra class names on the <svg>
 * @param {object}  [props.colors]            Override any of the default palette keys
 * @param {string}  [props.colors.highlight]  Brightest highlight green
 * @param {string}  [props.colors.main]       Main surface green
 * @param {string}  [props.colors.mid]        Mid-tone green
 * @param {string}  [props.colors.dark]       Dark edge / depth green
 * @param {string}  [props.colors.shadow]     Deepest shadow green
 */

import React from 'react';

const DEFAULT_COLORS = {
  highlight: '#a8d45a',
  main: '#7aba5c',
  mid: '#5a9d3c',
  dark: '#3d7d2c',
  shadow: '#2d5a20',
};

/* Blade base positions: [cx, cy] — 800×480 coordinate space */
const TUFT_POSITIONS = [
  // Back row
  [340, 238], [416, 218], [498, 238],
  // Mid-back row
  [238, 290], [322, 270], [412, 260], [502, 270], [582, 288],
  // Mid row
  [180, 338], [278, 318], [392, 308], [502, 318], [600, 332],
  // Front row
  [316, 378], [440, 370], [556, 360],
];

/** Three-blade grass tuft */
function GrassTuft({ cx, cy, dark, mid, shadow }) {
  return (
    <g>
      <path
        d={`M ${cx},${cy} Q ${cx - 2},${cy - 16} ${cx - 5},${cy - 27}`}
        stroke={dark}
        strokeWidth="1.9"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d={`M ${cx + 3},${cy} Q ${cx + 5},${cy - 15} ${cx + 8},${cy - 26}`}
        stroke={mid}
        strokeWidth="1.7"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d={`M ${cx - 3},${cy} Q ${cx - 7},${cy - 14} ${cx - 10},${cy - 23}`}
        stroke={shadow}
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}

/* ─── Paths ─────────────────────────────────────────────────────────────── */

// Organic top surface — rolling hill silhouette
const SURFACE =
  'M 96,390 C 70,358 58,312 74,268 C 90,224 136,196 198,180 ' +
  'C 256,165 320,158 396,156 C 468,154 534,162 590,182 ' +
  'C 646,202 692,234 714,270 C 736,306 728,346 706,378 ' +
  'C 682,410 636,430 572,442 C 504,454 428,458 352,456 ' +
  'C 270,454 190,442 136,422 C 106,410 90,400 96,390 Z';

// Visible thickness strip along the front/bottom edge
const DEPTH =
  'M 96,390 C 90,400 106,410 136,422 C 190,442 270,454 352,456 ' +
  'C 428,458 504,454 572,442 C 636,430 682,410 706,378 ' +
  'L 706,408 C 682,444 636,464 572,474 ' +
  'C 504,484 428,488 352,486 C 270,484 190,472 136,452 ' +
  'C 106,440 90,430 96,420 Z';

/* ─── Component ─────────────────────────────────────────────────────────── */

export function GardenMound({
  width = '100%',
  height = '100%',
  className = '',
  colors: overrides = {},
}) {
  const c = { ...DEFAULT_COLORS, ...overrides };

  return (
    <svg
      viewBox="0 0 800 480"
      width={width}
      height={height}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        {/* Soft drop shadow for the ellipse underneath */}
        <filter id="gm-shadow" x="-40%" y="-80%" width="180%" height="280%">
          <feGaussianBlur stdDeviation="16" />
        </filter>

        {/* Gentle blur for the central garden-path glow */}
        <filter id="gm-glow" x="-20%" y="-30%" width="140%" height="160%">
          <feGaussianBlur stdDeviation="10" />
        </filter>

        {/* Very subtle organic wobble — hand-drawn feel */}
        <filter id="gm-wobble" x="-3%" y="-3%" width="106%" height="106%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.018 0.022"
            numOctaves="3"
            seed="7"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="2.5"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* Surface gradient: light from top-left */}
        <radialGradient
          id="gm-surface-grad"
          gradientUnits="userSpaceOnUse"
          cx="292"
          cy="262"
          r="340"
        >
          <stop offset="0%" stopColor={c.highlight} />
          <stop offset="48%" stopColor={c.main} />
          <stop offset="100%" stopColor={c.mid} />
        </radialGradient>

        {/* Highlight overlay (light sheen top-left) */}
        <radialGradient
          id="gm-light"
          gradientUnits="userSpaceOnUse"
          cx="238"
          cy="228"
          r="210"
        >
          <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>

        {/* Depth strip gradient */}
        <linearGradient id="gm-depth-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.dark} />
          <stop offset="100%" stopColor={c.shadow} />
        </linearGradient>

        {/* Clip path so grass blades stay inside the mound */}
        <clipPath id="gm-surface-clip">
          <path d={SURFACE} />
        </clipPath>
      </defs>

      {/* ── Floating shadow ── */}
      <ellipse
        cx="406"
        cy="470"
        rx="278"
        ry="20"
        fill="rgba(28,50,16,0.34)"
        filter="url(#gm-shadow)"
      />

      {/* ── Everything with the hand-drawn wobble ── */}
      <g filter="url(#gm-wobble)">
        {/* Depth / mound thickness strip */}
        <path d={DEPTH} fill="url(#gm-depth-grad)" />

        {/* Main top surface */}
        <path d={SURFACE} fill="url(#gm-surface-grad)" />

        {/* Surface light sheen */}
        <path d={SURFACE} fill="url(#gm-light)" />

        {/* Central garden-path clearing (subtle radial glow) */}
        <ellipse
          cx="400"
          cy="342"
          rx="175"
          ry="76"
          fill="rgba(164,210,82,0.22)"
          filter="url(#gm-glow)"
        />

        {/* Grass blade tufts */}
        <g clipPath="url(#gm-surface-clip)" opacity="0.88">
          {TUFT_POSITIONS.map(([cx, cy], i) => (
            <GrassTuft
              key={i}
              cx={cx}
              cy={cy}
              dark={c.dark}
              mid={c.mid}
              shadow={c.shadow}
            />
          ))}
        </g>

        {/* Very faint rim highlight along the top edge */}
        <path
          d={SURFACE}
          fill="none"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth="3"
        />
      </g>
    </svg>
  );
}

export default GardenMound;
