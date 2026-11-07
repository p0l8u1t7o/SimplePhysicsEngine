# 從 pvlib.spa 取出 NREL SPA 週期項表，產生 core/solar/spa-tables.js（只需執行一次）
import os
from pvlib import spa
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'core', 'solar', 'spa-tables.js')
def flat(a):
    return ','.join(repr(float(v)) if not float(v).is_integer() else str(int(v)) for v in a.ravel())
names = ['L0','L1','L2','L3','L4','L5','B0','B1','R0','R1','R2','R3','R4']
lines = ['// NREL SPA（Reda & Andreas 2004/2008）週期項表：由 gen-spa-tables.py 從 pvlib.spa 自動產生，勿手改。',
         '// 地球日心經度 L0～L5、緯度 B0～B1、距離 R0～R4：每列 [A, B, C]，項值 A·cos(B + C·JME)。',
         '// 章動：NUT_Y 每列 5 個 Y 係數、NUT_ABCD 每列 [a, b, c, d]。']
for n in names:
    a = getattr(spa, n)
    lines.append(f'export const {n} = new Float64Array([{flat(a)}]);')
lines.append(f'export const NUT_Y = new Float64Array([{flat(spa.NUTATION_YTERM_ARRAY)}]);')
lines.append(f'export const NUT_ABCD = new Float64Array([{flat(spa.NUTATION_ABCD_ARRAY)}]);')
open(out, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')
print('written', out, {n: getattr(spa, n).shape for n in names}, spa.NUTATION_YTERM_ARRAY.shape)
