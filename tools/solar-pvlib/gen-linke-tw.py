# 從 pvlib 的 LinkeTurbidities.h5（1/12° 全球網格、每月）切出台灣範圍，產生 core/solar/linke-tw.js（只有範圍或 pvlib 資料要更新時）
import os, base64, h5py, numpy as np, pvlib
from pvlib.clearsky import _degrees_to_index
LAT = (26.5, 21.5); LON = (118.0, 122.5)     # 北界、南界；西界、東界
i0, i1 = _degrees_to_index(LAT[0], 'latitude'), _degrees_to_index(LAT[1], 'latitude')
j0, j1 = _degrees_to_index(LON[0], 'longitude'), _degrees_to_index(LON[1], 'longitude')
f = os.path.join(os.path.dirname(pvlib.__file__), 'data', 'LinkeTurbidities.h5')
with h5py.File(f, 'r') as h:
    a = np.asarray(h['LinkeTurbidity'][i0:i1 + 1, j0:j1 + 1, :], dtype=np.uint8)
ni, nj = a.shape[:2]
b64 = base64.b64encode(a.tobytes()).decode()
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'core', 'solar', 'linke-tw.js')
src = f'''// 台灣範圍的每月 Linke 濁度（Linke turbidity）：由 gen-linke-tw.py 從 pvlib 的 LinkeTurbidities.h5 切出，勿手改。
// 原始資料：SoDa / Remund et al. (2003) 全球 1/12° 網格；值 = TL × 20（uint8），依 [緯度列][經度欄][月] 排列。
// 範圍：北緯 {LAT[1]}～{LAT[0]}、東經 {LON[0]}～{LON[1]}（含本島、澎湖、金門、馬祖）。
export const LINKE_TW = {{ i0: {i0}, j0: {j0}, ni: {ni}, nj: {nj}, data: '{b64}' }};
'''
open(out, 'w', encoding='utf-8', newline='\n').write(src)
print(out, a.shape, a.min(), a.max(), len(src))
