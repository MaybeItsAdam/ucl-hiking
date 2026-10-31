#!/usr/bin/env bash
# Renders the native launch splash from the adaptive-icon foreground: the peaks,
# snow caps and trail standing on a flat base (the rock cut off by a straight
# line just under the trailhead), centred on a flat brand-teal field.
#
#   scripts/generate-splash.sh                     # rewrite the iOS and Android splash images
#   scripts/generate-splash.sh --preview out.png   # ...then also write a phone-size preview
#
# Needs rsvg-convert and magick, like scripts/generate-app-icons.sh.
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
foreground="$root/branding/app_icons/app-icon-foreground.svg"
res="$root/android/app/src/main/res"
ios="$root/ios/App/App/Assets.xcassets/Splash.imageset"

# Brand teal: the icon's sky and @color/ic_launcher_background. Keep it in step
# with @color/splash_background in android/app/src/main/res/values/colors.xml.
background="#01A2A6"

# Mark width. iOS draws one 2732 square aspect-fill, so a phone shows only a
# slice of it: 16% of the square is ~35% of an iPhone's width and ~21% of an
# iPad's short side. Android centres the mark unscaled (drawable/splash.xml),
# so it has a fixed size: 120dp is 30% of a typical 400dp phone width.
ios_share=0.16
android_mark_dp=120

# Gap between the trailhead and the base, in the foreground's 1024 units.
base_gap=24

preview=""
if [[ ${1:-} == "--preview" ]]; then
  preview=${2:?usage: generate-splash.sh [--preview out.png]}
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The foreground's shapes without the outer <svg> element.
inner=$(sed -e 's/^<svg[^>]*>//' -e 's/<\/svg>$//' "$foreground")

# The trail is the only path whose d comes first; its M is the trailhead.
trailhead_y=$(sed -n 's/.*<path d="M[-0-9.]* \([-0-9.]*\)C.*/\1/p' "$foreground")
[[ -n $trailhead_y ]] || { echo "generate-splash: no trailhead in $foreground" >&2; exit 1; }
base_y=$(awk -v y="$trailhead_y" -v g="$base_gap" 'BEGIN { print y + g }')

# mark_svg VIEWBOX: the scene clipped at the base, with nothing behind it.
mark_svg() {
  cat <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="$1">
<defs><clipPath id="base"><rect x="-4096" y="-4096" width="8192" height="$(awk -v b="$base_y" 'BEGIN { print b + 4096 }')"/></clipPath></defs>
<g clip-path="url(#base)">$inner</g>
</svg>
SVG
}

# Find the mark's bounding box once: render a wide window at 4px per unit and trim.
mark_svg "-1024 0 3072 1024" > "$work/probe.svg"
rsvg-convert -w 12288 -h 4096 "$work/probe.svg" -o "$work/probe.png"
read -r px_w px_h px_x px_y < <(magick "$work/probe.png" -format '%@\n' info: | tr 'x+' '  ')
viewbox=$(awk -v w="$px_w" -v h="$px_h" -v x="$px_x" -v y="$px_y" \
  'BEGIN { printf "%.2f %.2f %.2f %.2f", x / 4 - 1024, y / 4, w / 4, h / 4 }')
aspect=$(awk -v w="$px_w" -v h="$px_h" 'BEGIN { print h / w }')
mark_svg "$viewbox" > "$work/mark.svg"

# mark WIDTH OUTPUT: the transparent mark, WIDTH pixels wide.
mark() {
  local height
  height=$(awk -v w="$1" -v a="$aspect" 'BEGIN { printf "%d", w * a + 0.5 }')
  rsvg-convert -w "$1" -h "$height" "$work/mark.svg" -o "$2"
}

# iOS: one universal 2732 square, listed three times in Contents.json.
mark "$(awk -v s="$ios_share" 'BEGIN { printf "%d", 2732 * s + 0.5 }')" "$work/ios-mark.png"
magick -size 2732x2732 "xc:$background" "$work/ios-mark.png" -gravity center -composite \
  -alpha off -type TrueColor -depth 8 -strip "$ios/splash-2732x2732.png"
cp "$ios/splash-2732x2732.png" "$ios/splash-2732x2732-1.png"
cp "$ios/splash-2732x2732.png" "$ios/splash-2732x2732-2.png"

# Android before 12: drawable/splash.xml layers @color/splash_background with
# this mark centred, so it keeps its shape on any screen and orientation.
for spec in 'mdpi:1' 'hdpi:1.5' 'xhdpi:2' 'xxhdpi:3' 'xxxhdpi:4'
do
  density=${spec%%:*}
  scale=${spec##*:}
  mkdir -p "$res/drawable-$density"
  mark "$(awk -v d="$android_mark_dp" -v s="$scale" 'BEGIN { printf "%d", d * s + 0.5 }')" "$work/mark.png"
  magick "$work/mark.png" -strip "PNG32:$res/drawable-$density/splash_mark.png"
done

if [[ -n $preview ]]; then
  # How each splash lands on a real phone, shown at a third of device pixels:
  # iOS aspect-fills the square onto an iPhone 15 (1179x2556); Android before 12
  # fills a 1080x2400 xxhdpi screen with teal and centres the xxhdpi mark, either
  # way up.
  magick "$ios/splash-2732x2732.png" -resize 2556x2556 -gravity center -crop 1179x2556+0+0 +repage \
    -resize 393x852 "$work/ios.png"
  magick -size 1080x2400 "xc:$background" "$res/drawable-xxhdpi/splash_mark.png" -gravity center \
    -composite -resize 360x800 "$work/port.png"
  magick -size 2400x1080 "xc:$background" "$res/drawable-xxhdpi/splash_mark.png" -gravity center \
    -composite -resize 800x360 "$work/land.png"
  # Android 12+ draws its own splash: the adaptive icon (teal background plus
  # this foreground) on a 288dp canvas, masked to a 192dp circle, on
  # @color/splash_background. Mimicked here at xxhdpi so all three sit together.
  rsvg-convert -w 864 -h 864 "$foreground" -o "$work/fg12.png"
  magick -size 864x864 "xc:$background" "$work/fg12.png" -composite \
    \( -size 864x864 xc:black -fill white -draw 'circle 432,432 432,144' \) \
    -alpha off -compose CopyOpacity -composite "$work/icon12.png"
  magick -size 1080x2400 "xc:$background" "$work/icon12.png" -gravity center \
    -composite -resize 360x800 "$work/a12.png"
  magick -background '#f7f7f3' \
    \( "$work/ios.png" -bordercolor '#2d4153' -border 2 \) \
    \( "$work/port.png" -bordercolor '#2d4153' -border 2 \) \
    \( "$work/a12.png" -bordercolor '#2d4153' -border 2 \) \
    \( "$work/land.png" -bordercolor '#2d4153' -border 2 \) \
    -bordercolor '#f7f7f3' -border 24 -gravity center +append +repage "$preview"
fi
