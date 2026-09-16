#!/usr/bin/env python3
"""Render store graphics and layouts around genuine native app captures.

Requires rsvg-convert and ImageMagick. Missing captures produce clearly labelled
templates in a separate directory, never upload images with invented interfaces.
"""
import base64
import html
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / 'assets/store'
SCREENS = [
    ('01-home', ['London out.', 'Wild in.'], 'Meet UCL Hiking Club.'),
    ('02-join', ['The trail', 'starts here.'], 'Connect with your hiking club.'),
    ('03-signin', ['Your club.', 'Your UCL sign-in.'], 'Access depends on your club membership.'),
    ('04-kit-catalogue', ['Find kit for', 'your next hike.'], 'Browse club equipment and availability.'),
    ('05-kit-request', ['Plan your trip.', 'Request your kit.'], 'Choose dates and send a loan request.'),
    ('06-my-requests', ['Keep track', 'of your kit.'], 'Check your requests and loan status.'),
]
FORMATS = {
    'ios/iphone-6.9': (1320, 2868, 'ios', 132, 484, 1056, 92, 40),
    'ios/ipad-13': (2064, 2752, 'ipad', 282, 620, 1500, 104, 45),
    'android/phone': (1080, 1920, 'android', 113, 326, 854, 64, 26),
}
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
        slot = f'<image href="{uri}" x="{x}" y="{y}" width="{sw}" height="{sh}"/>'
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
    svg.write_text('''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
      <rect width="1024" height="500" fill="#01a2a6"/>
      <path d="M-20 448 140 412 300 450 450 424 560 452 720 190 810 448 890 316 1044 448V520H-20Z" fill="#2c3e50"/>
      <path d="M720 190 666 279 706 268 761 309Z" fill="#fff"/>
      <path d="M890 316 863 361 893 348 936 356Z" fill="#fff"/>
      <path d="M-20 486C130 468 230 488 340 478s190-6 270-26c40-10 65-24 80-42" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-dasharray="1 26"/>
      <g fill="#fff" transform="translate(856 70) scale(.478)">
        <path d="M97 26h6v20h-6z"/>
        <path d="M89 40h22v7H89z"/>
        <path d="M58 104c0-46 20-62 42-62s42 16 42 62z"/>
        <path d="M52 104h96v11H52z"/>
        <path d="M38 115h124l20 28H18z"/>
        <path d="M22 143h156v13H22z"/>
        <path d="M41 156h12v64H41zm21.2 0h12v64h-12zm21.2 0h12v64h-12zm21.2 0h12v64h-12zm21.2 0h12v64h-12zM147 156h12v64h-12z"/>
        <path d="M24 220h152v15H24z"/>
        <path d="M10 235h180v18H10z"/>
      </g>
      <g transform="translate(735 372)">
        <circle r="46" fill="#2c3e50"/>
        <circle r="38" fill="#bdf271"/>
        <path fill="#2c3e50" fill-rule="evenodd" transform="scale(.5)" d="m-40 43 25-69 69-28-28 69-66 28Zm16-15 30-13-20-20-10 33Z"/>
      </g>
      <g font-family="Arial, Helvetica, sans-serif" fill="#fff">
        <text x="94" y="112" font-size="23" font-weight="700" letter-spacing="2.4">UCL HIKING CLUB</text>
        <text x="90" y="190" font-size="56" font-weight="800">Ready for</text>
        <text x="90" y="252" font-size="56" font-weight="800">the next adventure.</text>
        <text x="94" y="301" font-size="22">Your club equipment, in one place.</text>
      </g>
    </svg>''')
    png = STORE / 'google-play-feature.png'
    render(svg, png, 1024, 500)
    target = STORE / 'android/feature-graphic.png'
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(png, target)
    record(target, 'ready', 'feature-graphic', 1024, 500,
           alt='UCL Hiking Club: Ready for the next adventure. Your club equipment, in one place. A mountain range and dotted trail.')


def gallery():
    groups = []
    for platform in FORMATS:
        items = [item for item in manifest if item.get('platform') == platform]
        cards = ''.join(f'''<a href="{html.escape(item['file'])}"><img src="{html.escape(item['file'])}" alt="{html.escape(Path(item['file']).stem)}" loading="lazy"><span>{html.escape(Path(item['file']).stem)} · {item['status']}</span></a>''' for item in items)
        groups.append(f'<section><h2>{platform}</h2><div class="row">{cards}</div></section>')
    (STORE / 'preview.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UCL Hiking Club store assets</title>
    <style>body{margin:0;padding:40px;background:#edf4f3;color:#2c3e50;font:16px Arial,sans-serif}h1{margin:0 0 12px}p{line-height:1.6;max-width:850px}.feature{max-width:1024px;width:100%;margin:20px 0;border-radius:12px}.row{display:flex;gap:20px;overflow:auto;padding:12px 0 24px}a{flex:0 0 210px;color:inherit;text-decoration:none}a img{width:210px;display:block;box-shadow:0 5px 18px #2c3e5020}a span{display:block;font-size:13px;padding-top:10px}h2{font-size:20px;margin-top:36px}</style>
    <h1>UCL Hiking Club store assets</h1><p>Finished public screenshots use genuine native app captures. Member templates have labelled slots and must be filled before upload. Click an asset to open it at full size.</p><img class="feature" src="android/feature-graphic.png" alt="Mountain range with UCL Hiking Club adventure message">''' + ''.join(groups) + '</html>')


def archive():
    files = sorted(file for file in STORE.rglob('*') if file.is_file() and file.suffix != '.zip')
    with zipfile.ZipFile(STORE / 'ucl-hiking-store-assets.zip', 'w', zipfile.ZIP_DEFLATED) as bundle:
        for file in files:
            bundle.write(file, 'ucl-hiking-store-assets/' + str(file.relative_to(STORE)))


if __name__ == '__main__':
    feature()
    for source, destination, size in [('apple-app-icon.png', 'ios/app-icon.png', 1024), ('google-play-icon.png', 'android/app-icon.png', 512)]:
        out = STORE / destination
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(STORE / source, out)
        record(out, 'ready', 'app-icon', size, size)
    for format_name, spec in FORMATS.items():
        for screen in SCREENS:
            screenshot(format_name, spec, screen)
    gallery()
    (STORE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    archive()
    print(f'Generated {sum(a["status"] == "ready" for a in manifest)} ready assets and {sum(a["status"] == "template" for a in manifest)} templates. Open assets/store/preview.html.')
