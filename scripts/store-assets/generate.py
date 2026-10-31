#!/usr/bin/env python3
"""Render store graphics and layouts around genuine native app captures.

Requires rsvg-convert and ImageMagick. Missing captures produce clearly labelled
templates in a separate directory, never upload images with invented interfaces.
"""
import base64
import html
import json
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / 'assets/store'
# Captures come from scripts/store-assets/capture.mjs: the real app, run
# locally on invented demo walks and kit, never against the club database.
SCREENS = [
    ('01-events', ['London out.', 'Wild in.'], 'Every walk and social, with what’s next up top.'),
    ('02-walk', ['Know the route', 'before you go.'], 'The map, the climb and the plan for the day.'),
    ('03-year-map', ['See where', 'we walked.'], 'Every club walk this year, on one map.'),
    ('04-kit', ['Borrow the kit.', 'Skip the shop.'], 'Tents, poles and waterproofs from the club store.'),
    ('05-navigator', ['Read the', 'Navigator.'], 'Every issue of the club magazine, in your pocket.'),
]
FORMATS = {
    'ios/iphone-6.9': (1320, 2868, 'ios', 132, 484, 1056, 92, 40),
    'ios/ipad-13': (2064, 2752, 'ipad', 282, 620, 1500, 104, 45),
    'android/phone': (1080, 1920, 'android', 113, 326, 854, 64, 26),
    'android/tablet-7': (1200, 1920, 'android-tablet-7', 170, 450, 860, 64, 28),
    'android/tablet-10': (1600, 2560, 'android-tablet-10', 227, 600, 1147, 85, 37),
}
# The app icon's seed in scripts/logo/generate.mjs (branding/app_icons/).
ICON_SEED = 7
FEATURE_ALT = 'UCL Hiking Club: Your hiking club, in your pocket. Walks, routes, kit hire and the club magazine. Snow-capped peaks with a lime dashed trail, as on the app icon.'
manifest = []


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def render(svg, png, width, height):
    svg.parent.mkdir(parents=True, exist_ok=True)
    run('rsvg-convert', '-w', str(width), '-h', str(height), str(svg), '-o', str(png))
    run('magick', str(png), '-alpha', 'off', '-type', 'TrueColor', str(png))


def record(file, status, kind, width, height, **extra):
    manifest.append(dict(file=str(file.relative_to(STORE)), status=status,
                         kind=kind, width=width, height=height, **extra))


def screenshot(format_name, spec, screen):
    w, h, source_name, x, y, sw, title_size, subtitle_size = spec
    name, lines, subtitle = screen
    capture = STORE / 'captures' / source_name / (name + '.png')
    ready = capture.exists()
    folder = STORE / format_name / 'screenshots' if ready else STORE / 'templates' / format_name
    folder.mkdir(parents=True, exist_ok=True)
    old_folder = STORE / 'templates' / format_name if ready else STORE / format_name / 'screenshots'
    for suffix in ['.svg', '.png']:
        (old_folder / (name + suffix)).unlink(missing_ok=True)
    svg, png = folder / (name + '.svg'), folder / (name + '.png')
    ratio = (w / h) if source_name != 'android' else (9 / 16)
    sh = round(sw / ratio)
    if ready:
        cw, ch = map(int, run('magick', 'identify', '-format', '%w %h', str(capture)).split())
        if (cw, ch) != (w, h):
            raise ValueError(f'{capture}: expected {w} × {h}, got {cw} × {ch}. Capture the correct native device size.')
        uri = 'data:image/png;base64,' + base64.b64encode(capture.read_bytes()).decode()
        # A plain device frame: the screen with rounded corners in a dark bezel.
        radius, bezel = round(sw * (.07 if 'ipad' not in source_name and 'tablet' not in source_name else .035)), round(sw * .018)
        slot = f'''<defs><clipPath id="screen"><rect x="{x}" y="{y}" width="{sw}" height="{sh}" rx="{radius}"/></clipPath></defs>
          <rect x="{x-bezel}" y="{y-bezel}" width="{sw+2*bezel}" height="{sh+2*bezel}" rx="{radius+bezel}" fill="#18232e"/>
          <image href="{uri}" x="{x}" y="{y}" width="{sw}" height="{sh}" preserveAspectRatio="none" clip-path="url(#screen)"/>'''
    else:
        cx, cy = x + sw / 2, y + sh / 2
        slot = f'''<rect x="{x}" y="{y}" width="{sw}" height="{sh}" fill="#edf4f3"/>
          <rect x="{x+20}" y="{y+20}" width="{sw-40}" height="{sh-40}" fill="none" stroke="#01a2a6" stroke-width="5" stroke-dasharray="18 18"/>
          <text x="{cx}" y="{cy-32}" text-anchor="middle" fill="#2c3e50" font-size="{w*.034}">NATIVE APP CAPTURE</text>
          <text x="{cx}" y="{cy+24}" text-anchor="middle" fill="#2c3e50" font-size="{w*.024}">{html.escape(name[3:].replace('-', ' ').title())}</text>
          <text x="{cx}" y="{cy+82}" text-anchor="middle" fill="#087f83" font-size="{w*.022}">TEMPLATE — DO NOT UPLOAD</text>'''
    label_y = round(w * .058)
    title_y = round(w * .143) if source_name != 'ipad' else 236
    line_gap = round(title_size * 1.18)
    subtitle_y = y - round(w * .072)
    if source_name == 'android':
        subtitle_y = y - 43
    text_lines = ''.join(f'<tspan x="{x}" y="{title_y+i*line_gap}">{html.escape(line)}</tspan>' for i, line in enumerate(lines))
    svg.write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
      <rect width="{w}" height="{h}" fill="#2c3e50"/>
      <path d="M{w*.66} 0H{w}V{y*.85}L{w*.86} {y*.38}l-{w*.08} {y*.15}Z" fill="#01a2a6"/>
      <path d="M{w*.86} {y*.38}l{w*.046} {y*.155}-{w*.049} {y*.055}-{w*.026} {y*.02}Z" fill="#fff"/>
      <path d="M{x*.42} {y+sh*.08}C{x*.95} {y+sh*.31} {x*.02} {y+sh*.48} {x*.45} {y+sh*.64}S{x*.95} {h-20} {x*.2} {h+30}" fill="none" stroke="#bdf271" stroke-width="{w*.007}" stroke-linecap="round" stroke-dasharray="1 {w*.035}"/>
      <g font-family="Arial, Helvetica, sans-serif">
        <text x="{x}" y="{label_y}" fill="#bdf271" font-size="{w*.022}" font-weight="700" letter-spacing="{w*.0024}">UCL HIKING CLUB</text>
        <text fill="#fff" font-size="{title_size}" font-weight="800">{text_lines}</text>
        <text x="{x}" y="{subtitle_y}" fill="#dbe7e7" font-size="{subtitle_size}">{html.escape(subtitle)}</text>
        {slot}
      </g>
    </svg>''')
    render(svg, png, w, h)
    record(png, 'ready' if ready else 'template', 'screenshot', w, h,
           platform=format_name, capture=str(capture.relative_to(STORE)) if ready else None)


def feature():
    svg = STORE / 'google-play-feature.svg'
    # The mountains are the app icon's own: seed 7 of scripts/logo/generate.mjs,
    # its foreground layer (peaks, snow caps, lime trail) set on the right with
    # the rock running off the bottom edge.
    mark = run('node', str(ROOT / 'scripts/logo/generate.mjs'), '--seed', str(ICON_SEED), '--layer', 'foreground')
    mark = re.sub(r'^<svg[^>]*>|</svg>$', '', mark.strip())
    svg.write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
      <rect width="1024" height="500" fill="#01a2a6"/>
      <g transform="translate(560 10) scale(.52)">{mark}</g>
      <g font-family="Arial, Helvetica, sans-serif" fill="#fff">
        <text x="94" y="112" font-size="23" font-weight="700" letter-spacing="2.4">UCL HIKING CLUB</text>
        <text x="90" y="190" font-size="56" font-weight="800">Your hiking club,</text>
        <text x="90" y="252" font-size="56" font-weight="800">in your pocket.</text>
        <text x="94" y="301" font-size="22">Walks, routes, kit hire and the club magazine.</text>
      </g>
    </svg>''')
    png = STORE / 'google-play-feature.png'
    render(svg, png, 1024, 500)
    target = STORE / 'android/feature-graphic.png'
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(png, target)
    record(target, 'ready', 'feature-graphic', 1024, 500,
           alt=FEATURE_ALT)


def gallery():
    groups = []
    for platform in FORMATS:
        items = [item for item in manifest if item.get('platform') == platform]
        cards = ''.join(f'''<a href="{html.escape(item['file'])}"><img src="{html.escape(item['file'])}" alt="{html.escape(Path(item['file']).stem)}" loading="lazy"><span>{html.escape(Path(item['file']).stem)} · {item['status']}</span></a>''' for item in items)
        groups.append(f'<section><h2>{platform}</h2><div class="row">{cards}</div></section>')
    (STORE / 'preview.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UCL Hiking Club store assets</title>
    <style>body{margin:0;padding:40px;background:#edf4f3;color:#2c3e50;font:16px Arial,sans-serif}h1{margin:0 0 12px}p{line-height:1.6;max-width:850px}.feature{max-width:1024px;width:100%;margin:20px 0;border-radius:12px}.row{display:flex;gap:20px;overflow:auto;padding:12px 0 24px}a{flex:0 0 210px;color:inherit;text-decoration:none}a img{width:210px;display:block;box-shadow:0 5px 18px #2c3e5020}a span{display:block;font-size:13px;padding-top:10px}h2{font-size:20px;margin-top:36px}</style>
    <h1>UCL Hiking Club store assets</h1><p>Screenshots frame captures of the real app running locally on invented demo walks and kit (scripts/store-assets/capture.mjs). Click an asset to open it at full size.</p><img class="feature" src="android/feature-graphic.png" alt="Mountain range with UCL Hiking Club adventure message">''' + ''.join(groups) + '</html>')


def archive():
    files = sorted(file for file in STORE.rglob('*') if file.is_file() and file.suffix != '.zip')
    with zipfile.ZipFile(STORE / 'ucl-hiking-store-assets.zip', 'w', zipfile.ZIP_DEFLATED) as bundle:
        for file in files:
            bundle.write(file, 'ucl-hiking-store-assets/' + str(file.relative_to(STORE)))


def sync_fastlane():
    fastlane = ROOT / 'fastlane'
    if not fastlane.exists():
        return

    copy_dir = STORE / 'copy'

    # 1. iOS App Store Metadata (Deliver)
    meta = fastlane / 'metadata'
    en_gb = meta / 'en-GB'
    review = meta / 'review_information'
    en_gb.mkdir(parents=True, exist_ok=True)
    review.mkdir(parents=True, exist_ok=True)

    if (copy_dir / 'copyright.txt').exists():
        (meta / 'copyright.txt').write_text((copy_dir / 'copyright.txt').read_text().strip())
    (meta / 'primary_category.txt').write_text('Sports')
    (meta / 'secondary_category.txt').write_text('Lifestyle')

    field_map = {
        'name.txt': 'app-name.txt',
        'subtitle.txt': 'apple-subtitle.txt',
        'description.txt': 'description.txt',
        'keywords.txt': 'apple-keywords.txt',
        'promotional_text.txt': 'apple-promotional-text.txt',
        'release_notes.txt': 'first-release-notes.txt',
        'support_url.txt': 'support-url.txt',
        'marketing_url.txt': 'marketing-url.txt',
        'privacy_url.txt': 'privacy-policy-url.txt',
    }
    for target_name, source_name in field_map.items():
        src = copy_dir / source_name
        if src.exists():
            (en_gb / target_name).write_text(src.read_text().strip())

    reviewer_notes_file = copy_dir / 'reviewer-notes.md'
    if reviewer_notes_file.exists():
        reviewer_text = reviewer_notes_file.read_text()
        notes_match = re.search(r'## Notes to paste.*?\n(.*?)(?=^## |\Z)', reviewer_text, re.MULTILINE | re.DOTALL)
        if notes_match:
            (review / 'notes.txt').write_text(notes_match.group(1).strip())
    (review / 'demo_user.txt').write_text('apple@adamscampustoolbox.org.uk')

    # 2. iOS Screenshots (Deliver)
    screenshots_dir = fastlane / 'screenshots' / 'en-GB'
    screenshots_dir.mkdir(parents=True, exist_ok=True)
    for old_img in screenshots_dir.glob('*.png'):
        old_img.unlink()

    for device, prefix in [('iphone-6.9', 'iphone_6.9'), ('ipad-13', 'ipad_13')]:
        dev_screens = STORE / 'ios' / device / 'screenshots'
        if dev_screens.exists():
            for i, p in enumerate(sorted(dev_screens.glob('*.png')), 1):
                shutil.copyfile(p, screenshots_dir / f'{i}_{prefix}_{p.name}')

    # 3. Android Metadata & Graphics (Supply)
    android_meta = fastlane / 'metadata' / 'android' / 'en-GB'
    android_meta.mkdir(parents=True, exist_ok=True)
    if (copy_dir / 'app-name.txt').exists():
        (android_meta / 'title.txt').write_text((copy_dir / 'app-name.txt').read_text().strip())
    if (copy_dir / 'google-short-description.txt').exists():
        (android_meta / 'short_description.txt').write_text((copy_dir / 'google-short-description.txt').read_text().strip())
    if (copy_dir / 'description.txt').exists():
        (android_meta / 'full_description.txt').write_text((copy_dir / 'description.txt').read_text().strip())

    images_dir = android_meta / 'images'
    images_dir.mkdir(parents=True, exist_ok=True)
    if (STORE / 'android/app-icon.png').exists():
        shutil.copyfile(STORE / 'android/app-icon.png', images_dir / 'icon.png')
    if (STORE / 'android/feature-graphic.png').exists():
        shutil.copyfile(STORE / 'android/feature-graphic.png', images_dir / 'featureGraphic.png')

    for store_folder, supply_folder in [
        ('phone', 'phoneScreenshots'),
        ('tablet-7', 'sevenInchScreenshots'),
        ('tablet-10', 'tenInchScreenshots')
    ]:
        target_dir = images_dir / supply_folder
        target_dir.mkdir(parents=True, exist_ok=True)
        for old in target_dir.glob('*.png'):
            old.unlink()
        source_dir = STORE / 'android' / store_folder / 'screenshots'
        if source_dir.exists():
            for i, p in enumerate(sorted(source_dir.glob('*.png')), 1):
                shutil.copyfile(p, target_dir / f'{i}_{p.name}')


if __name__ == '__main__':
    feature()
    for source, destination, size in [('apple-app-icon.png', 'ios/app-icon.png', 1024), ('google-play-icon.png', 'android/app-icon.png', 512)]:
        out = STORE / destination
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(STORE / source, out)
        record(out, 'ready', 'app-icon', size, size)
    # Screens dropped from SCREENS (and their old templates) leave no stale files to upload.
    names = {name for name, _, _ in SCREENS}
    for format_name in FORMATS:
        for folder in [STORE / format_name / 'screenshots', STORE / 'templates' / format_name]:
            for old in folder.glob('*'):
                if old.suffix in ('.png', '.svg') and old.stem not in names:
                    old.unlink()
    for folder in sorted((STORE / 'templates').glob('**/*'), reverse=True):
        if folder.is_dir() and not any(folder.iterdir()):
            folder.rmdir()
    if (STORE / 'templates').exists() and not any((STORE / 'templates').iterdir()):
        (STORE / 'templates').rmdir()
    for format_name, spec in FORMATS.items():
        for screen in SCREENS:
            screenshot(format_name, spec, screen)
    gallery()
    (STORE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    archive()
    sync_fastlane()
    print(f'Generated {sum(a["status"] == "ready" for a in manifest)} ready assets and {sum(a["status"] == "template" for a in manifest)} templates. Synced to fastlane. Open assets/store/preview.html.')
