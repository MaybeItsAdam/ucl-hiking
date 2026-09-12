"use client";

import { useEffect, useRef, useState } from "react";

export function ZoomedLogoHero() {
  const desktopTextRef = useRef<SVGTextElement>(null);
  const mobileTextRef = useRef<SVGTextElement>(null);

  // Accurate text bounding coordinates measured dynamically on client
  const [desktopBounds, setDesktopBounds] = useState({
    startX: 330,
    endX: 1270,
    baselineY: 425,
  });

  const [mobileBounds, setMobileBounds] = useState({
    startX: 70,
    endX: 530,
    baselineY: 365,
  });

  useEffect(() => {
    try {
      if (desktopTextRef.current && desktopTextRef.current.getBBox) {
        const bbox = desktopTextRef.current.getBBox();
        if (bbox && bbox.width > 0) {
          setDesktopBounds({
            startX: Math.round(bbox.x),
            endX: Math.round(bbox.x + bbox.width),
            baselineY: Math.round(bbox.y + bbox.height + 18),
          });
        }
      }
    } catch {
      // Safe fallback to default initial bounds
    }

    try {
      if (mobileTextRef.current && mobileTextRef.current.getBBox) {
        const bbox = mobileTextRef.current.getBBox();
        if (bbox && bbox.width > 0) {
          setMobileBounds({
            startX: Math.round(bbox.x),
            endX: Math.round(bbox.x + bbox.width),
            baselineY: Math.round(bbox.y + bbox.height + 14),
          });
        }
      }
    } catch {
      // Safe fallback to default initial bounds
    }
  }, []);

  // Desktop winding trail: underlines UCL Hiking, then peels off the end of the underline
  // and switchbacks down the slope the way a real path would — right, back across to the
  // left, then round to the centre — before running straight down so TrailInviteSection can
  // pick the line up again at its own top centre.
  //
  // Every curve stays inside the viewBox and every join is tangent-continuous (each pair of
  // control points either side of an anchor is colinear with it), so there are no corners and
  // no off-screen excursions.
  //
  // Two details make that join seam-proof at every viewport size:
  //  - The descent is at x = 800, the exact middle of the viewBox. Under `xMid…` that
  //    is the one x coordinate guaranteed to land on the element's horizontal centre
  //    no matter how the viewBox is scaled or letterboxed.
  //  - The tail overshoots far past y = 900 (the viewBox floor). Because the stage uses
  //    `meet`, a tall narrow viewport letterboxes the content and y = 900 stops short of
  //    the section's bottom edge; the overshoot covers that gap and `.zoomed-logo-hero`
  //    clips it back to exactly the section edge. See globals.css for the matching
  //    `overflow: visible` that lets the overshoot escape the SVG viewport.
  const dTrail = desktopBounds;
  const desktopTrailPath = `M ${dTrail.startX} ${dTrail.baselineY} L ${dTrail.endX} ${dTrail.baselineY} C ${dTrail.endX + 130} ${dTrail.baselineY}, 1400 ${dTrail.baselineY + 18}, 1442 ${dTrail.baselineY + 84} C 1484 596, 1372 646, 1186 668 C 968 694, 754 672, 596 706 C 446 738, 348 806, 396 856 C 452 892, 618 872, 722 856 C 768 849, 800 866, 800 900 L 800 1500`;

  // Mobile winding trail: Proportioned for portrait viewports, descending at x = 300
  // (the horizontal middle of the 600-wide mobile viewBox) for the same reasons.
  const mTrail = mobileBounds;
  const mobileTrailPath = `M ${mTrail.startX} ${mTrail.baselineY} L ${mTrail.endX} ${mTrail.baselineY} C ${mTrail.endX + 55} ${mTrail.baselineY}, 536 ${mTrail.baselineY + 12}, 548 ${mTrail.baselineY + 56} C 562 468, 470 496, 372 516 C 268 538, 160 540, 116 592 C 74 642, 128 700, 212 722 C 268 737, 300 762, 292 800 C 288 830, 300 860, 300 900 L 300 1500`;

  return (
    <section className="zoomed-logo-hero" aria-label="UCL Hiking Club banner">
      {/* 1. Panoramic Zoomed-In Logo Mountains Background (Flat Brand Colors, No Gradients, No Shadows)
          xMidYMin pins the viewBox's TOP edge to the element's top edge. On a wide, short hero
          `slice` has to discard a lot of vertical space, and anchoring anywhere else spends that
          budget on the sky above the peaks — YMax in particular put all of it there and
          decapitated the leftmost summit. Anchoring the top instead spends it at the bottom,
          which is solid mountain fill, so the peaks survive at every aspect ratio.
          That works because everything below y = 755 is uniformly #2c3e50: the ridge's lowest
          dip sits at y = 754, and the compass is lifted clear of the band (see below). So
          wherever the bottom edge lands, the seam with TrailInviteSection is the same navy. */}
      <svg
        className="zoomed-hero-svg-bg"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMin slice"
        aria-hidden="true"
      >
        {/* Flat Teal Sky */}
        <rect width="1600" height="900" fill="#01a2a6" />

        {/* Topographic Elevation Contours */}
        <g className="hero-topo-layer" stroke="rgba(255, 255, 255, 0.16)" strokeWidth="1.5" fill="none">
          <path d="M -100 160 Q 350 90 850 140 T 1750 110" />
          <path d="M -100 240 Q 450 170 950 220 T 1750 190" />
          <path d="M -100 320 Q 380 260 880 300 T 1750 270" />
          <path d="M -100 400 Q 500 330 1000 380 T 1750 350" />
        </g>

        {/* Distant Mountain Ridge */}
        <path
          className="hero-distant-mountains"
          d="M -150 560 L 180 390 L 420 490 L 760 300 L 1080 470 L 1380 350 L 1750 500 L 1750 950 L -150 950 Z"
          fill="#1c525a"
        />

        {/* Authentic Logo SVG Mountains & Elements.
            NOTE: .hero-mountains-layer's `mountainsRise` keyframes re-declare this transform and
            run `forwards`, so the CSS wins over this attribute — the two must be kept in sync. */}
        <g className="hero-mountains-layer" transform="translate(150, -60) scale(1.08)">
          <g transform="matrix(1,0,0,-1,0,1465)">
            {/* Mountain Silhouette (Flat Slate Navy) */}
            <path
              d="M -350 -100 L -350 650 L 45.3 1340 L 550.7431 710.8974 L 426.4083 953.4609 L 573.3354 1114.259 L 941.7825 710.8974 L 865.5399 856.2174 L 993.7746 997.602 L 1225.323 752.2914 L 1750 650 L 1750 -100 Z"
              fill="#2c3e50"
            />

            {/* Peak 1 Snowcap (Flat Pure White) */}
            <path d="M90 1205V1008.821L139.6498 1026.043 279.7185 980.1043 90 1205Z" fill="#ffffff" />

            {/* Peak 2 Snowcap (Flat Pure White) */}
            <path d="M573.2136 1040 482 943.9113 547.8142 958.3193 701.3324 913.6109 573.2136 1040Z" fill="#ffffff" />

            {/* Peak 3 Snowcap (Flat Pure White) */}
            <path d="M993.6628 935 929 864.9629 984.7515 882.0308 1080.297 848.7525 993.6628 935Z" fill="#ffffff" />

            {/* Trail from Logo (Flat Pure White) */}
            <path d="M100.1647 847.2853 103.2505 843.3512C107.5113 837.9193 115.3687 836.9698 120.8006 841.2305 126.2325 845.4912 127.1819 853.3487 122.9212 858.7806L119.8353 862.7147C115.5746 868.1466 107.7172 869.096 102.2853 864.8353 96.85341 860.5746 95.90397 852.7172 100.1647 847.2853ZM137.1952 800.0758 140.281 796.1416C144.5417 790.7097 152.3991 789.7603 157.831 794.021 163.2629 798.2817 164.2124 806.1391 159.9517 811.571L156.8658 815.5051C152.6051 820.937 144.7477 821.8865 139.3158 817.6258 133.8839 813.3651 132.9345 805.5077 137.1952 800.0758ZM174.2257 752.8662 177.3115 748.9321C181.5722 743.5002 189.4296 742.5507 194.8615 746.8114 200.2934 751.0721 201.2429 758.9295 196.9822 764.3614L193.8963 768.2956C189.6356 773.7275 181.7782 774.6769 176.3463 770.4162 170.9144 766.1555 169.9649 758.2981 174.2257 752.8662ZM211.2561 705.6566 214.342 701.7225C218.6027 696.2906 226.4601 695.3412 231.892 699.6019 237.3239 703.8626 238.2734 711.72 234.0127 717.1519L230.9268 721.086C226.6661 726.5179 218.8087 727.4673 213.3768 723.2066 207.9449 718.9459 206.9954 711.0885 211.2561 705.6566ZM240.8782 657.9384C241.4429 656.4915 241.9909 655.0315 242.5209 653.562 244.863 647.0679 252.0262 643.702 258.5203 646.0442 265.0144 648.3863 268.3803 655.5495 266.0381 662.0436 265.4349 663.7162 264.8109 665.3787 264.1675 667.0274 261.6576 673.4585 254.4095 676.6374 247.9784 674.1275 241.5472 671.6176 238.3684 664.3695 240.8782 657.9384ZM251.6939 604.0439V599.0439C251.6939 592.1403 257.2903 586.5439 264.1939 586.5439 271.0975 586.5439 276.6939 592.1403 276.6939 599.0439V604.0439C276.6939 610.9474 271.0975 616.5439 264.1939 616.5439 257.2903 616.5439 251.6939 610.9474 251.6939 604.0439ZM251.6939 544.0439V539.0439C251.6939 532.1403 257.2903 526.5439 264.1939 526.5439 271.0975 526.5439 276.6939 532.1403 276.6939 539.0439V544.0439C276.6939 550.9474 271.0975 556.5439 264.1939 556.5439 257.2903 556.5439 251.6939 550.9474 251.6939 544.0439ZM251.6939 484.0439V479.0439C251.6939 472.1403 257.2903 466.5439 264.1939 466.5439 271.0975 466.5439 276.6939 472.1403 276.6939 479.0439V484.0439C276.6939 490.9474 271.0975 496.5439 264.1939 496.5439 257.2903 496.5439 251.6939 490.9474 251.6939 484.0439ZM282.3452 421.507C284.1377 420.4428 285.983 419.4685 287.8745 418.5884 294.1336 415.6758 301.5687 418.3888 304.4812 424.6479 307.3937 430.907 304.6808 438.342 298.4217 441.2546 297.2888 441.7817 296.1828 442.3657 295.1078 443.0039 289.1716 446.5282 281.5024 444.573 277.9781 438.6368 274.4538 432.7006 276.409 425.0313 282.3452 421.507ZM347.3977 412.7805H352.3957C359.2992 412.7805 364.8957 418.3769 364.8957 425.2805 364.8957 432.1841 359.2992 437.7805 352.3957 437.7805H347.3977C340.4941 437.7805 334.8977 432.1841 334.8977 425.2805 334.8977 418.3769 340.4941 412.7805 347.3977 412.7805ZM407.3976 412.7805H412.3973C419.3009 412.7805 424.8973 418.3769 424.8973 425.2805 424.8973 432.1841 419.3009 437.7805 412.3973 437.7805H407.3976C400.494 437.7805 394.8976 432.1841 394.8976 425.2805 394.8976 418.3769 400.494 412.7805 407.3976 412.7805ZM467.3961 412.7805H472.3961C479.2997 412.7805 484.8961 418.3769 484.8961 425.2805 484.8961 432.1841 479.2997 437.7805 472.3961 437.7805H467.3961C460.4925 437.7805 454.8961 432.1841 454.8961 425.2805 454.8961 418.3769 460.4925 412.7805 467.3961 412.7805ZM527.3961 412.7805H532.3961C539.2997 412.7805 544.8961 418.3769 544.8961 425.2805 544.8961 432.1841 539.2997 437.7805 532.3961 437.7805H527.3961C520.4925 437.7805 514.8961 432.1841 514.8961 425.2805 514.8961 418.3769 520.4925 412.7805 527.3961 412.7805ZM587.3961 412.7805H592.3961C599.2997 412.7805 604.8961 418.3769 604.8961 425.2805 604.8961 432.1841 599.2997 437.7805 592.3961 437.7805H587.3961C580.4925 437.7805 574.8961 432.1841 574.8961 425.2805 574.8961 418.3769 580.4925 412.7805 587.3961 412.7805ZM647.3961 412.7805H652.3961C659.2997 412.7805 664.8961 418.3769 664.8961 425.2805 664.8961 432.1841 659.2997 437.7805 652.3961 437.7805H647.3961C640.4925 437.7805 634.8961 432.1841 634.8961 425.2805 634.8961 418.3769 640.4925 412.7805 647.3961 412.7805ZM707.3961 412.7805H712.3961C719.2997 412.7805 724.8961 418.3769 724.8961 425.2805 724.8961 432.1841 719.2997 437.7805 712.3961 437.7805H707.3961C700.4925 437.7805 694.8961 432.1841 694.8961 425.2805 694.8961 418.3769 700.4925 412.7805 707.3961 412.7805ZM767.3961 412.7805H772.3961C779.2997 412.7805 784.8961 418.3769 784.8961 425.2805 784.8961 432.1841 779.2997 437.7805 772.3961 437.7805H767.3961C760.4925 437.7805 754.8961 432.1841 754.8961 425.2805 754.8961 418.3769 760.4925 412.7805 767.3961 412.7805ZM827.3961 412.7805H831.5335C831.8606 412.7796 831.8606 412.7796 832.1862 412.775 839.0887 412.6578 844.7794 418.1585 844.8965 425.061 845.0137 431.9636 839.513 437.6542 832.6105 437.7714 832.0726 437.779 832.0726 437.779 831.5335 437.7805H827.3961C820.4925 437.7805 814.8961 432.1841 814.8961 425.2805 814.8961 418.3769 820.4925 412.7805 827.3961 412.7805ZM864.3237 390.9667C864.7805 389.8298 865.1784 388.6663 865.5155 387.4799 867.4023 380.8392 874.3151 376.9853 880.9559 378.8721 887.5966 380.7588 891.4505 387.6717 889.5637 394.3125 888.9867 396.3433 888.3048 398.3374 887.521 400.2878 884.9471 406.6936 877.6676 409.7999 871.2618 407.2259 864.856 404.652 861.7497 397.3725 864.3237 390.9667ZM872.6701 331.2756C873.6256 329.3919 874.6794 327.5622 875.8267 325.7937 879.5841 320.0022 887.325 318.3532 893.1164 322.1106 898.9079 325.8679 900.5569 333.6088 896.7995 339.4003 896.1333 340.4272 895.5213 341.4899 894.9661 342.5844 891.8433 348.7413 884.3206 351.2008 878.1638 348.078 872.0069 344.9552 869.5473 337.4325 872.6701 331.2756ZM934.1901 298.5399H939.1901C946.0936 298.5399 951.6901 304.1364 951.6901 311.0399 951.6901 317.9435 946.0936 323.5399 939.1901 323.5399H934.1901C927.2865 323.5399 921.6901 317.9435 921.6901 311.0399 921.6901 304.1364 927.2865 298.5399 934.1901 298.5399Z" fill="#ffffff" />

            {/* Navy floor. Guarantees the hero's bottom band is uniformly #2c3e50 so that
                wherever `xMidYMin slice` puts the bottom edge, it meets TrailInviteSection in
                the same colour. It buries the logo trail's lower dots, which are painted on top
                of the mountain fill and would otherwise show as white specks at the seam, and it
                extends the fill sideways past the silhouette's own edges.
                Its top lands at y = 730 in final coordinates. That value is chosen to fall in
                the gap between two of the trail's dot clusters (they end at y ≈ 720 and resume
                at y ≈ 737) so the floor never slices a dot in half. It sits ~24 units above the
                ridge's lowest dip at y = 754, so all it does inside the frame is shallow out the
                two valley notches slightly. Coordinates here are in the y-flipped space. */}
            <rect x="-1300" y="-2000" width="3800" height="2733" fill="#2c3e50" />

              {/* Compass Rose Emblem, lifted ~190 units up the slope and nudged ~40 to the right
                  (this space is y-flipped, so +y is up). Its lime disc hung to y ≈ 909, below the
                  navy floor, and was the one mark that would have shown at the seam as a lime
                  stub; it now stops at y ≈ 719, above the floor, and is drawn after the rect so
                  it stays visible. The sideways nudge keeps its circular edge off the dotted
                  trail's line — overlapping it bit crescents out of the dots it crossed.
                  The translate lives on a wrapper because .hero-compass-hover's own CSS
                  animations set `transform` and would override an attribute on that element. */}
              <g transform="translate(37, 176)">
              <g className="hero-compass-hover">
                <path d="M183.6396 594.0812C148.4924 629.2284 148.4924 686.2132 183.6396 721.3604 218.7868 756.5076 275.7716 756.5076 310.9188 721.3604 346.066 686.2132 346.066 629.2284 310.9188 594.0812 275.7716 558.934 218.7868 558.934 183.6396 594.0812Z" fill="#2c3e50" />
                <path d="M197.7817 608.2233C225.1184 580.8866 269.44 580.8866 296.7767 608.2233 324.1134 635.56 324.1134 679.8816 296.7767 707.2183 269.44 734.555 225.1184 734.555 197.7817 707.2183 170.445 679.8816 170.445 635.56 197.7817 608.2233Z" fill="#bdf271" />
                <path d="M235.5706 661.339 250.8975 646.0122 220.2438 630.6853 235.5706 661.339ZM261.0265 644.3685 233.9269 671.468 206.8274 617.2689 261.0265 644.3685Z" fill="#263e53" />
                <path d="M260.829 644.171 233.7294 671.2706 287.9286 698.3701 260.829 644.171Z" fill="#263e53" />
              </g>
            </g>
          </g>
        </g>
      </svg>

      {/* 2. Interactive Stage: Grand White Title & Continuous Winding Trail Underline */}
      <div className="zoomed-hero-stage">
        {/* Desktop Interactive SVG (viewBox 1600 x 900, matching background) */}
        <svg
          className="hero-interactive-svg hero-desktop-stage"
          viewBox="0 0 1600 900"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {/* Continuous Winding Trail */}
          <g className="hero-trail-group">
            {/* Pulsing Trailhead Waypoint at the start of 'UCL' */}
            {/* Throwaway patch matching the mountain fill so the pulse never bleeds across the ridge seam behind it */}
            <circle cx={dTrail.startX} cy={dTrail.baselineY} r="16" fill="#2c3e50" />
            <circle cx={dTrail.startX} cy={dTrail.baselineY} r="7.5" className="trailhead-pulse-marker" />
            <circle cx={dTrail.startX} cy={dTrail.baselineY} r="3" fill="#ffffff" />

            {/* Smooth continuous trail path */}
            <path
              d={desktopTrailPath}
              fill="none"
              stroke="#bdf271"
              className="hero-winding-trail"
            />
          </g>

          {/* Grand White Title: "UCL Hiking" */}
          <g className="hero-title-group" aria-label="UCL Hiking">
            {/* Crisp white stroke sketch entrance */}
            <text
              x="800"
              y="365"
              textAnchor="middle"
              className="hero-title-stroke"
              fill="none"
              stroke="#ffffff"
              style={{
                fontFamily: "var(--font-display), 'Avenir Next', Avenir, 'Segoe UI', sans-serif",
                fontWeight: 800,
              }}
            >
              UCL Hiking
            </text>

            {/* Solid pure white fill reveal */}
            <text
              ref={desktopTextRef}
              x="800"
              y="365"
              textAnchor="middle"
              className="hero-title-fill"
              fill="#ffffff"
              style={{
                fill: "#ffffff",
                opacity: 1,
                fontFamily: "var(--font-display), 'Avenir Next', Avenir, 'Segoe UI', sans-serif",
                fontWeight: 800,
              }}
            >
              UCL Hiking
            </text>
          </g>
        </svg>

        {/* Mobile Interactive SVG (viewBox 600 x 900) */}
        <svg
          className="hero-interactive-svg hero-mobile-stage"
          viewBox="0 0 600 900"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {/* Mobile Continuous Winding Trail */}
          <g className="hero-trail-group">
            <circle cx={mTrail.startX} cy={mTrail.baselineY} r="13" fill="#2c3e50" />
            <circle cx={mTrail.startX} cy={mTrail.baselineY} r="6" className="trailhead-pulse-marker" />
            <circle cx={mTrail.startX} cy={mTrail.baselineY} r="2.5" fill="#ffffff" />
            <path
              d={mobileTrailPath}
              fill="none"
              stroke="#bdf271"
              className="hero-winding-trail"
            />
          </g>

          {/* Mobile Grand White Title */}
          <g className="hero-title-group" aria-label="UCL Hiking">
            <text
              x="300"
              y="320"
              textAnchor="middle"
              className="hero-title-stroke"
              fill="none"
              stroke="#ffffff"
              style={{
                fontFamily: "var(--font-display), 'Avenir Next', Avenir, 'Segoe UI', sans-serif",
                fontWeight: 800,
              }}
            >
              UCL Hiking
            </text>
            <text
              ref={mobileTextRef}
              x="300"
              y="320"
              textAnchor="middle"
              className="hero-title-fill"
              fill="#ffffff"
              style={{
                fill: "#ffffff",
                opacity: 1,
                fontFamily: "var(--font-display), 'Avenir Next', Avenir, 'Segoe UI', sans-serif",
                fontWeight: 800,
              }}
            >
              UCL Hiking
            </text>
          </g>
        </svg>
      </div>
    </section>
  );
}
