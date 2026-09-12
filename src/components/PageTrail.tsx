export function PageTrail() {
  return (
    <svg
      className="page-trail-svg"
      viewBox="0 0 40 1000"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M 6 0 C 6 20, 34 30, 34 50 S 6 80, 6 100 S 34 130, 34 150 S 6 180, 6 200 S 34 230, 34 250 S 6 280, 6 300 S 34 330, 34 350 S 6 380, 6 400 S 34 430, 34 450 S 6 480, 6 500 S 34 530, 34 550 S 6 580, 6 600 S 34 630, 34 650 S 6 680, 6 700 S 34 730, 34 750 S 6 780, 6 800 S 34 830, 34 850 S 6 880, 6 900 S 34 930, 34 950 S 6 980, 6 1000"
        fill="none"
        className="page-trail-line"
      />
      <circle cx="6" cy="1000" r="9" fill="var(--lime)" />
      <polygon points="1,996 11,996 6,1006" fill="var(--ink)" />
    </svg>
  );
}
