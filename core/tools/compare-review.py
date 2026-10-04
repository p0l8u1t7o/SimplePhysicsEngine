"""比對兩組 review/*.json（遷移前後）：忽略時間、耗時、雜湊等每次都會變的欄位，只列出結果不同處。

    python core/tools/compare-review.py <基準資料夾>    # 基準資料夾結構：<專案>/<檔名>.json（對照 project-site/<專案>/review/；core、tools 對照根目錄的 review/）
"""
import json, os, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VOLATILE = re.compile(r'(seconds|generated|startedat|finishedat|^at$|time$|hash|sha256|duration|elapsed|^ms$|date|source)', re.I)


def walk(a, b, path, out):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if not VOLATILE.search(k):
                walk(a.get(k), b.get(k), f'{path}.{k}', out)
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            walk(x, y, f'{path}[{i}]', out)
    elif a != b:
        out.append(f'{path}: {str(a)[:90]} -> {str(b)[:90]}')


def main():
    base = Path(sys.argv[1]).resolve()
    changed = 0
    for f in sorted(base.rglob('*.json')):
        rel = f.relative_to(base)
        top = rel.parts[0]                                                # core／tools 在根目錄，各站在 project-site/
        cur = (ROOT if top in ('core', 'tools') else ROOT / 'project-site') / rel.parent / 'review' / rel.name
        if not cur.exists():
            print('缺少', cur.relative_to(ROOT)); changed += 1; continue
        out = []
        walk(json.loads(f.read_text(encoding='utf-8')), json.loads(cur.read_text(encoding='utf-8')), '', out)
        if out:
            changed += 1
            print('==', cur.relative_to(ROOT))
            for o in out[:10]:
                print('  ', o)
    print('結果不同的檔案：', changed)
    sys.exit(1 if changed else 0)


if __name__ == '__main__':
    main()
