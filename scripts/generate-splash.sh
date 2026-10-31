#!/usr/bin/env bash
# Renders the native launch splash screens from the adaptive-icon foreground:
# a flat brand-teal field with the peaks-and-trail mark centred inside the same
# circle Android 12+ shows on its own system splash, so every platform matches.
#
#   scripts/generate-splash.sh                     # rewrite the iOS and Android splash PNGs
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

# Mark diameter as a share of the image's short side. Android's port and land
# images are already phone-shaped, so 30% is what the user sees. iOS draws one
# 2732 square aspect-fill, so a phone shows only a slice of it: 16% of the
# square is ~35% of an iPhone's width and ~21% of an iPad's short side.
android_share=0.30
ios_share=0.16

preview=""
if [[ ${1:-} == "--preview" ]]; then
  preview=${2:?usage: generate-splash.sh [--preview out.png]}
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The foreground's shapes without the outer <svg> element.
inner=$(sed -e 's/^<svg[^>]*>//' -e 's/<\/svg>$//' "$foreground")

# splash WIDTH HEIGHT SHARE OUTPUT
splash() {
  local width height share output transform
  width=$1
  height=$2
  share=$3
  output=$4
  # The foreground is a 1024 design space; Android 12 shows the circle of
  # radius 1024/3 around its centre, and that circle becomes the mark.
  transform=$(awk -v w="$width" -v h="$height" -v s="$share" 'BEGIN {
    short = (w < h) ? w : h
    scale = (s * short) / (2 * 1024 / 3)
    printf "translate(%.3f %.3f) scale(%.6f) translate(-512 -512)", w / 2, h / 2, scale
  }')
  cat > "$work/splash.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="$width" height="$height" viewBox="0 0 $width $height">
<defs><clipPath id="mark"><circle cx="512" cy="512" r="341.333"/></clipPath></defs>
<rect width="$width" height="$height" fill="$background"/>
<g transform="$transform"><g clip-path="url(#mark)">$inner</g></g>
</svg>
SVG
  rsvg-convert -w "$width" -h "$height" "$work/splash.svg" -o "$work/render.png"
  magick "$work/render.png" -alpha off -type TrueColor -strip "$output"
}

# iOS: one universal 2732 square, listed three times in Contents.json.
splash 2732 2732 "$ios_share" "$ios/splash-2732x2732.png"
cp "$ios/splash-2732x2732.png" "$ios/splash-2732x2732-1.png"
cp "$ios/splash-2732x2732.png" "$ios/splash-2732x2732-2.png"

# Android (pre-12 window background, and the brief flash before the app theme).
splash 480 320 "$android_share" "$res/drawable/splash.png"
for spec in 'mdpi:320:480' 'hdpi:480:800' 'xhdpi:720:1280' 'xxhdpi:960:1600' 'xxxhdpi:1280:1920'
do
  density=${spec%%:*}
  sizes=${spec#*:}
  short=${sizes%%:*}
  long=${sizes##*:}
  splash "$short" "$long" "$android_share" "$res/drawable-port-$density/splash.png"
  splash "$long" "$short" "$android_share" "$res/drawable-land-$density/splash.png"
done

if [[ -n $preview ]]; then
  # How each splash lands on a real phone: iOS aspect-fills the square onto an
  # iPhone 15 (1179x2556); Android stretches the window background to the screen
  # (1080x2400 portrait, 2400x1080 landscape). Shown at a third of device pixels.
  magick "$ios/splash-2732x2732.png" -resize 2556x2556 -gravity center -crop 1179x2556+0+0 +repage \
    -resize 393x852 "$work/ios.png"
  magick "$res/drawable-port-xxhdpi/splash.png" -resize '1080x2400!' -resize 360x800 "$work/port.png"
  magick "$res/drawable-land-xxhdpi/splash.png" -resize '2400x1080!' -resize 800x360 "$work/land.png"
  magick -background '#f7f7f3' \
    \( "$work/ios.png" -bordercolor '#2d4153' -border 2 \) \
    \( "$work/port.png" -bordercolor '#2d4153' -border 2 \) \
    \( "$work/land.png" -bordercolor '#2d4153' -border 2 \) \
    -bordercolor '#f7f7f3' -border 24 -gravity center +append +repage "$preview"
fi
