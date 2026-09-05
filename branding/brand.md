# 🏔️ UCL Hiking Club — Brand & Style Guide

This document outlines the visual brand identity for the **University College London (UCL) Hiking Club**, including color specifications, typography hierarchy, logo mark variants, icon sub-components, and converted vector SVG assets.

---

## 🎨 Visual Previews

```carousel
![Pointed Shield Logo](/Users/adam/.gemini/antigravity-cli/brain/7ec8a53a-0746-4c4b-a25e-93d4539f6cb0/previews/logo_pointed_preview.png)
<!-- slide -->
![Rounded Shield Logo](/Users/adam/.gemini/antigravity-cli/brain/7ec8a53a-0746-4c4b-a25e-93d4539f6cb0/previews/logo_rounded_preview.png)
<!-- slide -->
![Black Monochrome Logo](/Users/adam/.gemini/antigravity-cli/brain/7ec8a53a-0746-4c4b-a25e-93d4539f6cb0/previews/logo_black_preview.png)
<!-- slide -->
![White Monochrome Logo](/Users/adam/.gemini/antigravity-cli/brain/7ec8a53a-0746-4c4b-a25e-93d4539f6cb0/previews/logo_white_preview.png)
<!-- slide -->
![UCL Portico Dome Emblem](/Users/adam/.gemini/antigravity-cli/brain/7ec8a53a-0746-4c4b-a25e-93d4539f6cb0/previews/ucl_portico_preview.png)
<!-- slide -->
![Compass Icon](/Users/adam/.gemini/antigravity-cli/brain/7ec8a53a-0746-4c4b-a25e-93d4539f6cb0/previews/compass_icon_preview.png)
<!-- slide -->
![Header Banner Graphic](/Users/adam/.gemini/antigravity-cli/brain/7ec8a53a-0746-4c4b-a25e-93d4539f6cb0/previews/banner_simple_preview.png)
```

---

## 🎨 Color Palette

| Swatch | Color Name | Hex Code | RGB | Usage |
| :---: | :--- | :--- | :--- | :--- |
| 🟦 | **Brand Teal** | `#01A2A6` | `rgb(1, 162, 166)` | Primary brand background fill for shield, banners, key accents |
| ⬛ | **Slate Navy** | `#2C3E50` | `rgb(44, 62, 80)` | Mountain silhouettes, outer canvas background, body text |
| 🟩 | **Trail Lime** | `#BDF271` | `rgb(189, 242, 113)` | Compass badge fill, trail highlights, call-out accents |
| ⬜ | **Pure White** | `#FFFFFF` | `rgb(255, 255, 255)` | Snowcaps, primary text ("HIKING"), Portico dome, trail dots |
| 🟦 | **Deep Slate** | `#263E53` | `rgb(38, 62, 83)` | Compass needle shading, secondary mountain stroke |
| ⬛ | **Monochrome Black** | `#000000` | `rgb(0, 0, 0)` | Print / single-color black logo variant |

> [!NOTE]
> - **Primary Pair**: Teal (`#01A2A6`) and Slate Navy (`#2C3E50`) form the core brand contrast.
> - **Accent Touch**: Lime Green (`#BDF271`) is used sparingly for interactive highlights, icons, or trail markers.

---

## 🔤 Typography & Font Hierarchy

### 1. Primary Wordmark — "HIKING"
- **Style**: Sans-Serif, All-Caps, Heavy/Bold
- **Font Stack**: `Helvetica Neue Bold`, `Helvetica Bold`, `Arial Black`, `system-ui`
- **Weight**: 800 - 900 (Extra Bold)
- **Tracking / Letter Spacing**: Tight to Medium (0px - 2px)
- **Usage**: Main title inside the shield logo and primary header graphics.

### 2. Secondary Subtitle — "CLUB"
- **Style**: Sans-Serif, All-Caps, Ultra Light / Thin
- **Font Stack**: `Helvetica Neue Thin`, `Helvetica Neue Light`, `sans-serif-thin`
- **Weight**: 200 - 300 (Light / Thin)
- **Tracking / Letter Spacing**: Wide / Expanded (+4px to +12px)
- **Usage**: Subtitle positioned underneath "HIKING" to create weight contrast.

### 3. Institutional Monogram — "UCL"
- **Style**: Sans-Serif, All-Caps, Semi-Bold
- **Font Stack**: `Helvetica Neue`, `Arial`, `UCL Institutional Font`
- **Weight**: 700 (Bold)
- **Usage**: Directly under the UCL Portico dome icon in the top right of the shield.

### 4. Recommended Web & App Font Family
```css
font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
```

---

## 📐 Iconography & Graphic Elements

1. **The Shield Crest**:
   - Coat-of-arms outline unifying all elements. Available with flat/pointed top corners or rounded top corners.
2. **The Mountain Peaks**:
   - Three ascending geometric mountain ridges in Slate Navy (`#2C3E50`) topped with solid white snowcaps (`#FFFFFF`).
3. **The UCL Portico Dome**:
   - Iconic silhouette of the University College London Wilkins Building dome and colonnade in solid white (`#FFFFFF`).
4. **The Trail & Compass**:
   - Dotted white hiking trail path curving through the mountains, marked by a bright Lime Green (`#BDF271`) circular compass badge with a dark needle.

---

## 📂 Converted Vector SVG Asset Suite

All assets have been rendered to clean, high-precision SVG vector format and are stored in `/Users/adam/Downloads/branding/svgs/`:

- 🛡️ [logo.svg](file:///Users/adam/Downloads/branding/svgs/logo.svg) — Primary Shield Logo (Pointed top corners)
- 🛡️ [logo_rounded.svg](file:///Users/adam/Downloads/branding/svgs/logo_rounded.svg) — Primary Shield Logo (Rounded top corners)
- ⬛ [logo_black.svg](file:///Users/adam/Downloads/branding/svgs/logo_black.svg) — Monochrome Black Shield Logo
- ⬜ [logo_white.svg](file:///Users/adam/Downloads/branding/svgs/logo_white.svg) — Monochrome White Shield Logo
- 🏛️ [ucl_portico_dome.svg](file:///Users/adam/Downloads/branding/svgs/ucl_portico_dome.svg) — Standalone UCL Portico Dome Emblem
- 🧭 [compass_icon.svg](file:///Users/adam/Downloads/branding/svgs/compass_icon.svg) — Standalone Compass Badge Icon
- 🖼️ [banner_simple.svg](file:///Users/adam/Downloads/branding/svgs/banner_simple.svg) — Full Vector Header Banner (1656x630)
- ⚡ [logo_master.svg](file:///Users/adam/Downloads/branding/svgs/logo_master.svg) — Master Vector Source File

---

## 📏 Usage & Clear Space Guidelines

- **Minimum Size**:
  - Full Shield Logo: `24px x 28px` (digital), `10mm x 11.5mm` (print).
  - Standalone Compass Icon: `16px x 16px`.
- **Clear Space**: Maintain a minimum margin equal to the height of the "UCL" monogram around the outer perimeter of the shield.
- **Backgrounds**: Use Brand Teal (`#01A2A6`) or Slate Navy (`#2C3E50`) for dark theme backgrounds, or Pure White (`#FFFFFF`) for light theme placement.
