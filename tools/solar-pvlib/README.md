# core/solar 與 pvlib 交叉驗證

`core/solar`（太陽位置 SPA、追日與回溯、晴空與斜面日射、雙面背面、全年發電）的每一項都和 pvlib 比對。pvlib 只在這裡用，網頁與 core 不需要 Python。

```powershell
.venv\Scripts\python.exe tools\solar-pvlib\validate.py                       # 產生參考值到 TEMP\solar-pvlib-ref\（約 15 MB，只留本機）
node --import ./core/tools/register.mjs tools/solar-pvlib/compare.mjs          # 比對，印出各項最大誤差與門檻
.venv\Scripts\python.exe tools\solar-pvlib\gen-spa-tables.py                 # 重產 core/solar/spa-tables.js（只有 SPA 週期項表要更新時）
```

需要 `requirements.txt` 的 pvlib（0.16.1，會一起裝 pandas、scipy、h5py）。2026-11-07 的結果：SPA 39,000 筆最大差 2.6e-12°、追日 66,225 筆 5.8e-11°、Perez 2.3e-13 W/m²、全年發電相對誤差 3e-15、雙面背面（uniform）對 `infinite_sheds` 0.56 W/m²。天候檔是合成的台南 EPW（晴空 × 決定性雲量）與 pvlib 內附的美國 TMY3，不是台灣實測氣候。
