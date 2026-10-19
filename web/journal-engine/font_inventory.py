"""Probe fixed font families with the actual XeTeX resolver, without substitution."""
from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile

PROFILES = {
    'cjk': {
        'fandol': ['FandolSong-Regular.otf', 'FandolSong-Bold.otf', 'FandolHei-Regular.otf', 'FandolHei-Bold.otf', 'FandolKai-Regular.otf', 'FandolFang-Regular.otf'],
        'source-han': ['Source Han Serif SC', 'Source Han Serif SC Bold', 'Source Han Sans SC', 'Source Han Sans SC Bold', 'FandolKai-Regular.otf'],
        'windows': ['SimSun', 'SimHei', 'KaiTi', 'FangSong', 'Microsoft YaHei', 'Microsoft YaHei Bold', 'LiSu', 'YouYuan'],
        'mac': ['Songti SC Regular', 'Songti SC Bold', 'Heiti SC Light', 'Heiti SC Medium', 'Kaiti SC', 'Kaiti SC Bold'],
    },
    'latin': {'tex-default': ['lmroman10-regular.otf'], 'times': ['Times New Roman', 'Times New Roman Bold', 'Times New Roman Italic', 'Times New Roman Bold Italic']},
    'math': {'tex-default': [], 'stix-two': ['STIX Two Math']},
    'bodyWeight': {'regular': [], 'light': ['Source Han Serif SC Light']},
}
# The text-symbol fallback is used by every Chinese font profile.
for _fonts in PROFILES['cjk'].values():
    _fonts.extend(n for n in ['FandolSong-Regular.otf', 'FandolSong-Bold.otf', 'FandolKai-Regular.otf'] if n not in _fonts)


def probe_fonts():
    from publishing import TEX_DEFAULT, resolve_font_set
    exe = shutil.which('xelatex') or (str(TEX_DEFAULT) if TEX_DEFAULT.exists() else None)
    if not exe:
        raise RuntimeError('FONT_PROBE_UNAVAILABLE')
    names = sorted({name for choices in PROFILES.values() for fonts in choices.values() for name in fonts})
    source = '\\documentclass{article}\n\\usepackage{fontspec}\n\\begin{document}\n'
    for i, name in enumerate(names):
        source += r'\IfFontExistsTF{' + name + r'}{\typeout{SHUYEFONT:' + str(i) + r':yes}}{\typeout{SHUYEFONT:' + str(i) + ':no}}\n'
    source += r'\end{document}'
    with tempfile.TemporaryDirectory(prefix='shuye-fonts-') as tmp:
        Path(tmp, 'fonts.tex').write_text(source, encoding='utf-8')
        env = {**os.environ, 'openin_any': 'p', 'openout_any': 'p', 'shell_escape': 'f', 'max_print_line': '1000'}
        result = subprocess.run([exe, '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', 'fonts.tex'], cwd=tmp, env=env, capture_output=True, timeout=45)
        found = {int(i): yes == 'yes' for i, yes in re.findall(r'SHUYEFONT:(\d+):(yes|no)', result.stdout.decode('utf-8', errors='replace'))}
    if result.returncode or len(found) != len(names):
        raise RuntimeError('FONT_PROBE_FAILED')
    available = {name: found[i] for i, name in enumerate(names)}
    profiles = {category: {key: {'available': all(available[n] for n in fonts), 'requiredFonts': fonts,
                                'missingFonts': [n for n in fonts if not available[n]]}
                           for key, fonts in choices.items()} for category, choices in PROFILES.items()}
    return {'resolver': 'XeLaTeX/fontspec', 'profiles': profiles, 'defaultCjkFontSet': resolve_font_set({}),
            'scope': 'installed families only; glyph coverage, font licences and layout require PDF validation'}
