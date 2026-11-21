# CT 甘特圖（一拍、穩態）輸出成 PNG，給 docs 文件用。
# 資料由 web/js/sequence.js 匯出（tools/plan.mjs 不負責）：
#   node --import ./core/tools/register.mjs -e "import('./project-site/MotorBodyAOI/web/js/sequence.js').then(S=>require('fs').writeFileSync('TEMP/mbaoi-gantt.json', JSON.stringify({ct:S.CT,xfer:S.XFER_TIME,lanes:S.LANES,rows:S.cycleGantt(),stations:S.STATION_TIMES})))"
#   python project-site/MotorBodyAOI/tools/gantt_png.py TEMP/mbaoi-gantt.json project-site/MotorBodyAOI/docs/images/ct_gantt.png
import json
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager

for f in ('C:/Windows/Fonts/msjh.ttc', 'C:/Windows/Fonts/msjhbd.ttc'):
    try:
        font_manager.fontManager.addfont(f)
    except Exception:
        pass
plt.rcParams['font.family'] = ['Microsoft JhengHei', 'sans-serif']

data = json.load(open(sys.argv[1], encoding='utf-8'))
ct, xfer, lanes, rows = data['ct'], data['xfer'], data['lanes'], data['rows']
color = {'move': '#4aa8ff', 'shot': '#f2c230', 'proc': '#9775fa'}
fig, ax = plt.subplots(figsize=(12, 6.0), dpi=150)
for i, lane in enumerate(lanes):
    y = len(lanes) - 1 - i
    for r in [r for r in rows if r['lane'] == lane]:
        ax.barh(y, max(r['dur'], .03), left=r['start'], height=.62, color=color[r['kind']], alpha=.55 if r['kind'] == 'proc' else .95, edgecolor='white', linewidth=.4)
        if r['dur'] >= .45:
            ax.text(r['start'] + r['dur'] / 2, y, r['name'], ha='center', va='center', fontsize=6.6, color='#0b1620', clip_on=True)
ax.set_yticks(range(len(lanes)))
ax.set_yticklabels(list(reversed(lanes)), fontsize=8.5)
ax.axvline(xfer, color='#888', ls='--', lw=.8)
ax.axvline(ct, color='#e03131', lw=1.2)
ax.text(xfer, len(lanes) - .3, f' 移載完 {xfer:.2f} s', fontsize=7.5, color='#555')
ax.text(ct, len(lanes) - .3, f' CT {ct:.2f} s', fontsize=8, color='#e03131')
ax.set_xlim(0, max(ct + 2.2, max(r['start'] + r['dur'] for r in rows) + .2))
ax.set_xlabel('一拍內的時間（s）；影像處理為管線化，跨到下一拍不佔 CT', fontsize=8.5)
ax.set_title(f'馬達本體 AOI：每拍動作甘特圖（穩態 CT {ct:.2f} s；規格 15 s、挑戰 12 s；時間為示意值）', fontsize=10.5)
for k, lab in (('move', '機構'), ('shot', '取像'), ('proc', '影像處理')):
    ax.barh(-5, 0, color=color[k], label=lab)
ax.set_ylim(-.7, len(lanes) - .1)
ax.legend(loc='upper center', bbox_to_anchor=(.5, -.09), fontsize=8, frameon=False, ncol=3)
ax.grid(axis='x', color='#ddd', lw=.5)
fig.tight_layout()
fig.savefig(sys.argv[2])
print(sys.argv[2])
