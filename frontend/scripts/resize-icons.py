from PIL import Image
import os

ICON_SOURCE = r'e:\一遍过\frontend\app-icons\icon3.jpg'
MIPMAP_BASE = r'e:\一遍过\frontend\android\app\src\main\res'

DENSITIES = {
    'mdpi': 48,
    'hdpi': 72,
    'xhdpi': 96,
    'xxhdpi': 144,
    'xxxhdpi': 192,
}

img = Image.open(ICON_SOURCE)
print(f'Source: {ICON_SOURCE} ({img.size})')

# Ensure image is square by cropping to center
if img.width != img.height:
    size = min(img.width, img.height)
    left = (img.width - size) // 2
    top = (img.height - size) // 2
    img = img.crop((left, top, left + size, top + size))

for density, dp_size in DENSITIES.items():
    resized = img.resize((dp_size, dp_size), Image.LANCZOS)
    
    for name in ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground']:
        mipmap_dir = os.path.join(MIPMAP_BASE, f'mipmap-{density}')
        os.makedirs(mipmap_dir, exist_ok=True)
        out_path = os.path.join(mipmap_dir, f'{name}.png')
        resized.save(out_path, 'PNG')
        print(f'  {out_path}  ({dp_size}x{dp_size})')

# Update background color XML
bg_color = '#DC2626'  # red-600
bg_xml = '''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#DC2626</color>
</resources>
'''

bg_path = os.path.join(MIPMAP_BASE, 'values', 'ic_launcher_background.xml')
os.makedirs(os.path.dirname(bg_path), exist_ok=True)
with open(bg_path, 'w', encoding='utf-8') as f:
    f.write(bg_xml)
print(f'  {bg_path}  (background color: {bg_color})')

# Also update drawable background XML
drawable_bg_path = os.path.join(MIPMAP_BASE, 'drawable', 'ic_launcher_background.xml')
os.makedirs(os.path.dirname(drawable_bg_path), exist_ok=True)
with open(drawable_bg_path, 'w', encoding='utf-8') as f:
    f.write('''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="#DC2626" />
</shape>
''')
print(f'  {drawable_bg_path}')

print('\nDone!')
