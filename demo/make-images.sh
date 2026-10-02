#!/bin/sh
# Makes the demo prints the README screenshots show: run it in a session that
# loads darkroom, and the grey line appears under the command's result.
set -e
cd "$(dirname "$0")"
mkdir -p prints
cd prints

magick -size 1280x640 gradient:'#ff9a3c'-'#3b1d6e' \
  -fill '#ffe9a8' -draw 'circle 860,300 860,390' \
  -fill '#2a1650' -draw 'polygon 0,640 0,450 180,330 360,470 560,300 760,460 960,360 1280,480 1280,640' \
  -fill '#120a26' -draw 'polygon 0,640 0,560 240,470 460,580 660,500 940,600 1120,530 1280,580 1280,640' \
  sunset.png

magick -size 1200x720 xc:'#16181d' \
  -fill '#e6e6e6' -font DejaVu-Sans-Bold -pointsize 34 -annotate +60+80 'Weekly builds' \
  -fill '#8a8f98' -font DejaVu-Sans -pointsize 22 -annotate +60+120 'passed, by day' \
  -stroke '#2c3038' -strokewidth 2 -draw 'line 60,620 1140,620' -stroke none \
  -fill '#4fc3f7' -draw 'roundrectangle 100,380 220,620 10,10' \
  -fill '#81c784' -draw 'roundrectangle 260,300 380,620 10,10' \
  -fill '#ce93d8' -draw 'roundrectangle 420,420 540,620 10,10' \
  -fill '#f5a623' -draw 'roundrectangle 580,220 700,620 10,10' \
  -fill '#4fc3f7' -draw 'roundrectangle 740,340 860,620 10,10' \
  -fill '#81c784' -draw 'roundrectangle 900,260 1020,620 10,10' \
  -fill '#8a8f98' -pointsize 20 \
  -annotate +140+660 'Mon' -annotate +300+660 'Tue' -annotate +460+660 'Wed' \
  -annotate +620+660 'Thu' -annotate +780+660 'Fri' -annotate +940+660 'Sat' \
  dashboard.png

cat > aperture.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="-256 -256 512 512">
  <rect x="-256" y="-256" width="512" height="512" fill="#141414"/>
  <circle r="180" fill="#f5a623"/>
  <g fill="#141414">
    <polygon points="0,-60 52,-30 120,-140 40,-176"/>
    <polygon points="52,-30 52,30 176,40 160,-90"/>
    <polygon points="52,30 0,60 40,176 140,120"/>
    <polygon points="0,60 -52,30 -120,140 -40,176"/>
    <polygon points="-52,30 -52,-30 -176,-40 -160,90"/>
    <polygon points="-52,-30 0,-60 -40,-176 -140,-120"/>
  </g>
</svg>
SVG

magick -size 640x960 gradient:'#0b1026'-'#2b3a67' \
  \( -size 640x960 xc:black -seed 7 +noise Random -channel G -separate +channel -threshold 99.7% \) -compose screen -composite \
  -fill '#f4f1de' -draw 'circle 470,200 470,260' \
  -fill '#0a0d1c' -draw 'polygon 0,960 0,700 80,700 80,620 170,620 170,760 260,760 260,560 360,560 360,720 450,720 450,640 560,640 560,780 640,780 640,960' \
  night.jpg

magick -size 900x900 -seed 42 plasma:fractal -blur 0x2 -modulate 100,150 texture.webp

magick -size 64x64 xc:none -fill '#f5a623' -draw 'circle 32,32 32,4' -fill '#141414' -draw 'circle 32,32 32,18' icon.png

ls -1d "$PWD"/*
