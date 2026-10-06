"""
產生 docs/vision-items.xlsx：只負責機器視覺時要採購的品項表（相機、鏡頭、光源、電腦、螢幕、鍵鼠、網路、電力、線材、備品），
另把即時錄影與遠端訓練的設備列為「延伸」，分開小計。

    python tools/build_vision_items.py

和成本表重複的品項，單價取自 3D工作室平台上本站的成本表（BOM @RecycleSorter，「對應成本表」欄是它的編號），兩份不會對不上。
成本表本身改在平台上維護與匯出（2026-10-06 起；原本的 build_integration_cost.py 已退役），所以要先有平台的元件資料庫：
    node studio/vs3d.mjs parts bom @RecycleSorter        # 看平台上的成本表
只列硬體與授權，不含工程人日。藍字是可以改的數量與單價；金額是內部預算估計，不是供應商報價。
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

OUT = Path(__file__).resolve().parents[1] / "docs" / "vision-items.xlsx"
REPO = Path(__file__).resolve().parents[3]


def platform_bom(project: str = "@RecycleSorter") -> dict:
    """平台上本站的成本表（vs3d parts bom --json）：每行的編號、折合新台幣的單價、稅率。"""
    r = subprocess.run(["node", str(REPO / "studio" / "vs3d.mjs"), "parts", "bom", project, "--json"], cwd=REPO, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        sys.exit(f"讀不到平台的成本表（{project}）：{(r.stderr or r.stdout).strip()}\n先在本庫執行 node studio/vs3d.mjs parts bom-import --project RecycleSorter")
    return json.loads(r.stdout)


BOM = platform_bom()
COST = {l["line"]: l["unit_twd"] for l in BOM["lines"]}   # 成本表編號 → 單價（新台幣）
TAX = BOM["settings"]["tax"]

BASE, SPARE, EXT = "基本", "備品", "延伸"
# (編號, 類別, 品項, 規格, 建議選型, 前段數量, 後段數量, 共用數量, 單位, 單價或成本表編號, 範圍, 備註)
ROWS = [
    # ---------------------------------------------------------------- 取像
    ("V-01", "1 取像", "工業相機", "500 萬畫素、2/3 吋、全域快門、彩色、GigE PoE、硬體觸發輸入", "Basler ace 2／HIKROBOT CS 系列同級", 2, 2, 0, "台", "2-01", BASE, "每站 2 台組成立體對；四台同型號"),
    ("V-02", "1 取像", "鏡頭", "500 萬畫素級 C 接環定焦，8 或 12 mm，可鎖固光圈與對焦", "同級品", 2, 2, 0, "顆", "2-02", BASE, "焦距在光學設計時定案；8 mm 時雙眼重疊約 580 mm"),
    ("V-03", "1 取像", "鏡頭保護鏡／偏光鏡", "配合鏡頭口徑", "同級品", 2, 2, 0, "片", 1500, BASE, "保護鏡方便清潔；瓶身反光嚴重時換偏光鏡"),
    ("V-04", "1 取像", "條形頻閃光源", "500 mm 白光、可頻閃、IP65", "同級品", 2, 2, 0, "支", "2-03", BASE, "每站 2 支低角度打光"),
    ("V-05", "1 取像", "頻閃光源控制器", "2 通道、外部觸發、過驅動", "同級品", 1, 1, 0, "台", "2-04", BASE, ""),
    ("V-06", "1 取像", "相機防塵罩", "IP65、光學視窗、氣簾接頭", "同級品", 2, 2, 0, "組", "2-05", BASE, "回收場粉塵與液體飛濺"),
    ("V-07", "1 取像", "相機與光源安裝支架", "滑座、角度調整、鎖固", "自製", 1, 1, 0, "式", 12000, BASE, "基線 300 mm 的立體對要能微調後鎖死"),
    ("V-08", "1 取像", "前段取像門型架與遮光罩", "跨 600 mm 皮帶的鋁擠門型架、遮光板", "自製", 1, 0, 0, "式", "2-06", BASE, "後段的相機架裝在後段機台上，不在本表"),
    ("V-09", "1 取像", "校正板與校正件", "立體校正板、手臂對相機的標定件", "鋁複合板棋盤格", 0, 0, 1, "式", "2-07", BASE, "兩站共用"),
    ("V-10", "1 取像", "觸發介面", "光耦隔離分配板、端子；一個觸發訊號分給兩台相機與光源控制器", "同級品", 1, 1, 0, "組", 6000, BASE, "觸發訊號由手臂的追蹤介面提供"),
    # ---------------------------------------------------------------- 線材
    ("V-11", "2 線材與耗材", "高柔 GigE 網路線", "Cat6A、鎖固接頭、5～10 m", "同級品", 2, 2, 0, "條", 1800, BASE, "相機到交換器"),
    ("V-12", "2 線材與耗材", "相機觸發 I/O 線", "相機原廠接頭、5～10 m", "相機原廠", 2, 2, 0, "條", 1200, BASE, ""),
    ("V-13", "2 線材與耗材", "光源延長線", "5 m", "光源原廠", 2, 2, 0, "條", 800, BASE, ""),
    ("V-14", "2 線材與耗材", "網路跳線", "Cat6A、1～3 m", "同級品", 0, 0, 8, "條", 200, BASE, "主機、交換器、路由器之間"),
    ("V-15", "2 線材與耗材", "安裝耗材", "線槽、束帶、線號標籤、鏡頭清潔用品", "—", 0, 0, 1, "式", 3200, BASE, ""),
    # ---------------------------------------------------------------- 電腦與操作周邊
    ("V-16", "3 電腦與操作周邊", "邊緣推論主機", "工業級 x86＋12～16 GB 顯示記憶體的 GPU，或 Jetson AGX Orin 64 GB 同級；3 個網路埠", "工業 GPU 電腦", 1, 1, 0, "台", "3-01", BASE, "兩台同規格，一台故障時另一台接手兩站"),
    ("V-17", "3 電腦與操作周邊", "主機影像暫存碟", "2 TB NVMe", "同級品", 1, 1, 0, "顆", "4-04", BASE, "網路中斷時先存本機"),
    ("V-18", "3 電腦與操作周邊", "作業系統授權", "Windows 11 IoT 企業版 LTSC", "—", 1, 1, 0, "套", 6000, BASE, "改用 Ubuntu 時數量改成 0"),
    ("V-19", "3 電腦與操作周邊", "螢幕", "24 吋、1920 × 1080", "同級品", 0, 0, 1, "台", 6000, BASE, "調機與維護用；現場既有的 15.6 吋螢幕可以沿用當操作畫面"),
    ("V-20", "3 電腦與操作周邊", "鍵盤滑鼠組", "有線或無線", "同級品", 0, 0, 1, "組", 1200, BASE, ""),
    ("V-21", "3 電腦與操作周邊", "KVM 切換器", "2 埠、HDMI 或 DisplayPort", "同級品", 0, 0, 1, "台", 2500, BASE, "一組螢幕鍵鼠控制兩台主機"),
    ("V-22", "3 電腦與操作周邊", "螢幕與 KVM 線材", "影像線 ×3、USB 線 ×2", "同級品", 0, 0, 1, "式", 1500, BASE, ""),
    # ---------------------------------------------------------------- 網路與電力
    ("V-23", "4 網路與電力", "工業 PoE 交換器", "8 埠 GbE、PoE+、網管型、巨型封包", "同級品", 0, 0, 1, "台", "3-02", BASE, "4 台相機＋主機"),
    ("V-24", "4 網路與電力", "工業路由器", "VPN、防火牆、4G／5G 備援", "同級品", 0, 0, 1, "台", "3-03", BASE, "遠端維護與資料上傳；手臂控制器不直接對外"),
    ("V-25", "4 網路與電力", "不斷電系統", "在線式 1.5 kVA", "同級品", 0, 0, 1, "台", "3-04", BASE, "主機、交換器、路由器"),
    ("V-26", "4 網路與電力", "24 V 電源供應器", "導軌式 240 W", "明緯 NDR-240-24 同級", 0, 0, 1, "台", 3500, BASE, "光源控制器與觸發介面用；不和既有盤內電源共用"),
    ("V-27", "4 網路與電力", "盤內安裝件", "導軌、端子台、斷路器、主機固定架", "—", 0, 0, 1, "式", 8000, BASE, "裝在兩站共用的電控櫃內"),
    # ---------------------------------------------------------------- 備品
    ("S-01", "5 備品", "工業相機備品", "同 V-01", "同 V-01", 0, 0, 1, "台", "2-01", SPARE, "相機故障時該站無法辨識"),
    ("S-02", "5 備品", "鏡頭備品", "同 V-02", "同 V-02", 0, 0, 1, "顆", "2-02", SPARE, ""),
    ("S-03", "5 備品", "GigE 網路線備品", "同 V-11", "同 V-11", 0, 0, 1, "條", 1800, SPARE, ""),
    # ---------------------------------------------------------------- 延伸：即時錄影與遠端訓練
    ("X-01", "6 延伸：即時錄影與儲存", "全景網路攝影機", "400 萬畫素、H.265、PoE、IP67", "同級品", 1, 1, 1, "台", "4-01", EXT, "共用的那一台看皮帶末端的漏抓"),
    ("X-02", "6 延伸：即時錄影與儲存", "網路儲存設備", "4 槽、支援攝影機錄影", "Synology DS 系列同級", 0, 0, 1, "台", "4-02", EXT, ""),
    ("X-03", "6 延伸：即時錄影與儲存", "儲存設備硬碟", "8 TB 監控／NAS 級", "同級品", 0, 0, 4, "顆", "4-03", EXT, "RAID 5，可用約 21.8 TB"),
    ("X-04", "7 延伸：遠端訓練", "訓練工作站", "32 GB 顯示記憶體的 GPU 1 張、128 GB 記憶體、4 TB NVMe", "RTX 5090 級工作站", 0, 0, 1, "台", "5-01", EXT, "放在辦公室"),
    ("X-05", "7 延伸：遠端訓練", "訓練端資料儲存", "4 槽儲存設備＋硬碟", "同級品", 0, 0, 1, "式", "5-02", EXT, ""),
    ("X-06", "7 延伸：遠端訓練", "訓練工作站螢幕", "27 吋、2560 × 1440", "同級品", 0, 0, 1, "台", 8000, EXT, "標註影像時畫面大一點比較好用"),
    ("X-07", "7 延伸：遠端訓練", "訓練工作站鍵盤滑鼠組", "有線或無線", "同級品", 0, 0, 1, "組", 1200, EXT, ""),
]

FONT = "Microsoft JhengHei"
BASEF, BOLD, BLUE = Font(name=FONT, size=10), Font(name=FONT, size=10, bold=True), Font(name=FONT, size=10, color="0000FF")
GREEN = Font(name=FONT, size=10, color="008000")
FILL, KEY = PatternFill("solid", fgColor="E8EEF6"), PatternFill("solid", fgColor="FFF7D6")
MONEY, WRAP = '#,##0', Alignment(wrap_text=True, vertical="top")


def style(ws, widths):
    for row in ws.iter_rows():
        for c in row:
            if c.font.color is None and not c.font.bold: c.font = BASEF
            c.alignment = WRAP
    for k, w in enumerate(widths, start=1): ws.column_dimensions[get_column_letter(k)].width = w


def main() -> None:
    wb = Workbook()
    # ================================================================ 品項表
    ws = wb.active; ws.title = "品項表"
    ws.append(["編號", "類別", "品項", "規格", "建議選型（同級品可）", "前段 ABB 站", "後段 DENSO 站", "兩站共用", "數量合計", "單位", "單價 NT$", "小計 NT$", "範圍", "對應成本表", "備註"])
    for c in ws[1]: c.font = BOLD; c.fill = FILL
    for i, (code, cat, name, spec, model, qf, qr, qs, unit, price, scope, note) in enumerate(ROWS, start=2):
        ref = price if isinstance(price, str) else ""
        ws.append([code, cat, name, spec, model, qf, qr, qs, f"=F{i}+G{i}+H{i}", unit, COST[price] if ref else price, f"=I{i}*K{i}", scope, ref or "本表新增", note])
        for col in "FGHK": ws[f"{col}{i}"].font = BLUE
        for col in "KL": ws[f"{col}{i}"].number_format = MONEY
    n = len(ROWS) + 1
    style(ws, [7, 22, 22, 44, 30, 9, 9, 9, 9, 6, 12, 13, 7, 11, 46])
    ws.freeze_panes = "D2"

    # ================================================================ 摘要
    s = wb.create_sheet("摘要", 0)
    s["A1"] = "機器視覺品項表（兩站：前段 ABB、後段 DENSO）"; s["A1"].font = Font(name=FONT, size=13, bold=True)
    s["A2"] = "編製日 2026-10-05。新台幣、未稅；只列硬體與授權，不含工程人日。金額是內部預算估計，未詢價。"
    s["A3"] = "範圍：只負責機器視覺——取像、辨識運算、操作周邊、網路與電力。手臂、追蹤介面與編碼器、機台、氣動都不在本表。"
    s["A5"] = "營業稅率"; s["B5"] = TAX; s["B5"].font = BLUE; s["B5"].number_format = "0%"
    for col, text in zip("ABCD", ["範圍", "品項數", "金額 NT$", "說明"]): s[f"{col}7"] = text; s[f"{col}7"].font = BOLD; s[f"{col}7"].fill = FILL
    rows = [(BASE, "做辨識一定要有的"), (SPARE, "建議備在現場"), (EXT, "即時錄影與遠端訓練；只做辨識可以先不買")]
    for k, (scope, note) in enumerate(rows, start=8):
        s[f"A{k}"] = scope
        s[f"B{k}"] = f'=COUNTIF(品項表!$M$2:$M${n},A{k})'
        s[f"C{k}"] = f'=SUMIFS(品項表!$L$2:$L${n},品項表!$M$2:$M${n},A{k})'
        s[f"D{k}"] = note
    s["A11"], s["B11"], s["C11"], s["D11"] = "基本＋備品（未稅）", "=B8+B9", "=C8+C9", "只做機器視覺的採購金額"
    s["A12"], s["B12"], s["C12"], s["D12"] = "全部（未稅）", "=B8+B9+B10", "=C8+C9+C10", "含即時錄影與遠端訓練"
    s["A13"], s["C13"], s["D13"] = "基本＋備品（含稅）", "=C11*(1+$B$5)", ""
    s["A14"], s["C14"], s["D14"] = "全部（含稅）", "=C12*(1+$B$5)", ""
    for k in range(8, 15): s[f"C{k}"].number_format = MONEY
    for k in (11, 12): s[f"A{k}"].font = BOLD; s[f"C{k}"].font = BOLD
    s["C11"].fill = KEY
    s["A16"] = "各類別小計"; s["A16"].font = BOLD
    for col, text in zip("ABC", ["類別", "品項數", "金額 NT$"]): s[f"{col}17"] = text; s[f"{col}17"].font = BOLD; s[f"{col}17"].fill = FILL
    cats = list(dict.fromkeys(r[1] for r in ROWS))
    for k, cat in enumerate(cats, start=18):
        s[f"A{k}"] = cat
        s[f"B{k}"] = f'=COUNTIF(品項表!$B$2:$B${n},A{k})'
        s[f"C{k}"] = f'=SUMIFS(品項表!$L$2:$L${n},品項表!$B$2:$B${n},A{k})'
        s[f"C{k}"].number_format = MONEY
    e = 18 + len(cats) + 1
    s[f"A{e}"] = "說明"; s[f"A{e}"].font = BOLD
    for k, text in enumerate([
        "藍字是可以改的數量與單價；數量分成前段、後段、兩站共用三欄，合計與小計是公式。",
        "「對應成本表」欄有編號的品項，單價與 integration-cost.xlsx 相同；標「本表新增」的是成本表沒有細列的周邊（螢幕、鍵鼠、切換器、支架、電源、盤內安裝件等）。",
        "線材 V-11～V-15 合計 20,000，就是成本表 2-08「線材」一式的展開。",
        "兩台主機共用一組螢幕與鍵鼠，用切換器切換；現場既有的 15.6 吋螢幕可以沿用當操作畫面。",
        "觸發訊號與皮帶位置由手臂的追蹤介面提供（前段是 ABB 追蹤模組），不在機器視覺的採購範圍內；本表只列視覺這一端的接線介面。",
        "相機、鏡頭的型號與焦距要等光學設計定案；單價等級與上下限幅度見 integration-cost.xlsx。",
    ], start=e + 1): s[f"A{k}"] = text
    style(s, [34, 10, 16, 60])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)

    # ---------------------------------------------------------------- 用 Python 再算一次，和 Excel 的結果對照
    tot, cnt = {}, {}
    for code, cat, name, spec, model, qf, qr, qs, unit, price, scope, note in ROWS:
        sub = (qf + qr + qs) * (COST[price] if isinstance(price, str) else price)
        tot[scope] = tot.get(scope, 0) + sub; cnt[scope] = cnt.get(scope, 0) + 1
    print(f"已輸出 {OUT}")
    for scope in (BASE, SPARE, EXT): print(f"{scope}：{cnt[scope]} 項，{tot[scope]:,.0f}")
    core = tot[BASE] + tot[SPARE]
    print(f"基本＋備品：{core:,.0f}（含稅 {core * (1 + TAX):,.0f}）｜全部：{sum(tot.values()):,.0f}（含稅 {sum(tot.values()) * (1 + TAX):,.0f}）")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")   # Windows 主控台預設不是 UTF-8
    main()
