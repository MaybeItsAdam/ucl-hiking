#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
master="$root/branding/app_icons/app-icon.svg"
foreground="$root/branding/app_icons/app-icon-foreground.svg"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

render() {
  local source size output
  source=$1
  size=$2
  output=$3
  rsvg-convert -w "$size" -h "$size" "$source" -o "$work/render.png"
  magick "$work/render.png" -alpha off -type TrueColor "$output"
}

render_alpha() {
  local source size output
  source=$1
  size=$2
  output=$3
  rsvg-convert -w "$size" -h "$size" "$source" -o "$output"
}

render_round() {
  local source size output
  source=$1
  size=$2
  output=$3
  rsvg-convert -w "$size" -h "$size" "$source" -o "$work/round.png"
  magick "$work/round.png" -alpha on \
    \( -size "${size}x${size}" xc:black -fill white -draw "circle $((size / 2)),$((size / 2)) $((size / 2)),0" -alpha off \) \
    -compose CopyOpacity -composite "$output"
}

# Store, installed iOS app, Next metadata and PWA icons.
render "$master" 1024 "$root/assets/store/apple-app-icon.png"
render "$master" 512 "$root/assets/store/google-play-icon.png"
magick "$root/assets/store/google-play-icon.png" -alpha set "PNG32:$root/assets/store/google-play-icon.png"
render "$master" 1024 "$root/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
render "$master" 512 "$root/src/app/icon.png"
render "$master" 180 "$root/src/app/apple-icon.png"
render "$master" 512 "$root/public/icon-512.png"
render "$master" 192 "$root/public/icon-192.png"
cp "$master" "$root/public/icon.svg"

# Reusable web and cross-platform branding exports.
render "$master" 512 "$root/branding/app_icons/web/icon-512.png"
render "$master" 192 "$root/branding/app_icons/web/icon-192.png"
render "$master" 180 "$root/branding/app_icons/web/apple-touch-icon.png"
render "$master" 1024 "$root/branding/app_icons/flutter_react_native/app_icon.png"
render "$master" 512 "$root/branding/app_icons/android/playstore-icon.png"
magick "$root/branding/app_icons/android/playstore-icon.png" -alpha set "PNG32:$root/branding/app_icons/android/playstore-icon.png"
magick "$root/branding/app_icons/web/icon-192.png" -define icon:auto-resize=48,32,16 "$root/branding/app_icons/web/favicon.ico"
cp "$root/branding/app_icons/web/favicon.ico" "$root/src/app/favicon.ico"

# iOS source set retained for projects that use the complete legacy catalog.
for spec in \
  'Icon-App-20x20@1x.png:20' 'Icon-App-20x20@2x-ipad.png:40' 'Icon-App-20x20@2x.png:40' 'Icon-App-20x20@3x.png:60' \
  'Icon-App-29x29@1x.png:29' 'Icon-App-29x29@2x-ipad.png:58' 'Icon-App-29x29@2x.png:58' 'Icon-App-29x29@3x.png:87' \
  'Icon-App-40x40@1x.png:40' 'Icon-App-40x40@2x-ipad.png:80' 'Icon-App-40x40@2x.png:80' 'Icon-App-40x40@3x.png:120' \
  'Icon-App-60x60@2x.png:120' 'Icon-App-60x60@3x.png:180' 'Icon-App-76x76@1x.png:76' \
  'Icon-App-76x76@2x.png:152' 'Icon-App-83.5x83.5@2x.png:167' 'Icon-App-1024x1024@1x.png:1024'
do
  name=${spec%%:*}
  size=${spec##*:}
  render "$master" "$size" "$root/branding/app_icons/ios/AppIcon.appiconset/$name"
done

# Android adaptive foregrounds use the central safe zone; legacy icons use the
# complete scene. The OS supplies the teal adaptive background and final mask.
for spec in 'mdpi:48:108' 'hdpi:72:162' 'xhdpi:96:216' 'xxhdpi:144:324' 'xxxhdpi:192:432'
do
  density=${spec%%:*}
  sizes=${spec#*:}
  legacy=${sizes%%:*}
  adaptive=${sizes##*:}
  actual="$root/android/app/src/main/res/mipmap-$density"
  source_dir="$root/branding/app_icons/android/res/mipmap-$density"
  render "$master" "$legacy" "$actual/ic_launcher.png"
  render_round "$master" "$legacy" "$actual/ic_launcher_round.png"
  render_alpha "$foreground" "$adaptive" "$actual/ic_launcher_foreground.png"
  render "$master" "$legacy" "$source_dir/ic_launcher.png"
  render_round "$master" "$legacy" "$source_dir/ic_launcher_round.png"
  render_alpha "$foreground" "$adaptive" "$source_dir/ic_launcher_foreground.png"
done

magick -size 1024x1024 'xc:#01A2A6' -alpha off -type TrueColor "$root/branding/app_icons/flutter_react_native/app_icon_background.png"
render_alpha "$foreground" 1024 "$root/branding/app_icons/flutter_react_native/app_icon_foreground.png"
render "$master" 1024 "$root/branding/app_icons/previews/ios_preview.png"
render_alpha "$foreground" 1024 "$work/adaptive-foreground.png"
magick -size 1024x1024 'xc:#01A2A6' "$work/adaptive-foreground.png" -compose Over -composite \
  -crop 682x682+171+171 +repage -resize 1024x1024 "$work/adaptive-visible.png"
magick "$work/adaptive-visible.png" -alpha on \
  \( -size 1024x1024 xc:black -fill white -draw 'circle 512,512 512,0' -alpha off \) \
  -compose CopyOpacity -composite "$root/branding/app_icons/previews/android_circle_preview.png"
magick "$work/adaptive-visible.png" -alpha on \
  \( -size 1024x1024 xc:black -fill white -draw 'roundrectangle 0,0 1024,1024 225,225' -alpha off \) \
  -compose CopyOpacity -composite "$root/branding/app_icons/previews/android_squircle_preview.png"
