# 提案簡報（由 tools/proposal-deck.mjs 呼叫）：公司樣板 zqdeck。前段是提案目標與可達到的功能，
# 最後的「附錄：內部評估」各頁設成隱藏（放映時跳過，編輯時看得到）。不放成本數字。
#   python -I proposal_deck.py <樣板資料夾> <資料.json> <輸出.pptx>
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")   # -I 會忽略 PYTHONIOENCODING
kit, data_file, out = sys.argv[1:4]
sys.path.insert(0, str(Path(kit) / "scripts"))
from zqdeck import Deck  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

d = json.loads(Path(data_file).read_text(encoding="utf-8"))
S = d["shots"]
deck = Deck()


def pic(title, key, caption):
    if S.get(key):
        deck.picture(title, S[key], caption=caption)


# ---------------------------------------------------------------- 前段：提案
deck.cover("晶圓表面 AOI 檢測方案提案", "單片晶圓停拍掃描｜同軸明場＋低角度暗場｜VisionSequence 檢測平台", d["date"].replace("-", "/"))
deck.kpi("提案目標", [tuple(m) for m in d["kpi"]], body=d["kpiBody"])

deck.section("方案配置", "設備、光學頭與平台", number="01")
pic("設備外觀", "machine", "單片晶圓 AOI：花崗岩基座、固定龍門光學頭、XYθ 平台、遮光外罩")
deck.two_column("設備組成與檢測流程", "設備組成", d["composition"], "檢測流程", d["flow"])
pic("光學頭：相機＋同軸明場＋低角度暗場", "optics", "1× 同軸遠心鏡頭、Z 調焦軸；Ø100 低角度環形光離晶圓 12 mm")
pic("XYθ 平台與真空吸盤", "stage", "XY 精密平台＋θ 微調台，拖鏈內走真空管路；HMI 與三色燈在操作側")
pic("遮光外罩與操作側", "front", "前側觀察窗與取放片口；外罩門鎖互鎖")

deck.section("檢測能力", "解析度、覆蓋、影像與演算", number="02")
deck.table("檢測能力（提案目標）", ["項目", "目標", "說明"], d["capability"], col_widths=[2.2, 3.4, 5], size=13)
pic("掃描路徑與即時覆蓋", "top", "蛇形停拍掃描；已取像、目前位置、候選即時顯示在晶圓上")
pic("整片掃描與 wafer map", "full", f"整片 {d['kpi'][1][2]}，候選位置標在 wafer map")

# 影像特寫拼圖
font = ImageFont.truetype("C:/Windows/Fonts/msjhbd.ttc", 22)
W, H = 900, 540
sheet = Image.new("RGB", (W * 2 + 30, (H + 54) * 2), (255, 255, 255)); dr = ImageDraw.Draw(sheet)
for k, (path, cap) in enumerate(d["closeups"][:4]):
    im = Image.open(path).convert("RGB"); sc = min(W / im.width, H / im.height)
    im = im.resize((int(im.width * sc), int(im.height * sc)), Image.LANCZOS)
    x, y = (k % 2) * (W + 30), (k // 2) * (H + 54)
    sheet.paste(im, (x + (W - im.width) // 2, y)); dr.text((x, y + H + 10), cap, font=font, fill=(30, 50, 80))
mont = Path(data_file).with_name("closeups.png"); sheet.save(mont)
deck.picture("檢測影像：明場與暗場", str(mont), caption="明場看反射與暗線，暗場看散射與顆粒；兩通道各自比對後合併")
deck.two_column("檢測演算與品質把關", "演算流程", d["algo"], "品質把關", d["guard"])

deck.section("檢測軟體平台：VisionSequence", "流程化建置、回歸驗證與產線介面", number="03")
deck.table("VisionSequence 工具對應", ["步驟", "VisionSequence 工具", "功能"], d["vs"], col_widths=[1.8, 4.4, 4.4], size=13)
pic("VisionSequence：晶圓檢測流程", "vsEditor", "流程編輯：取像、品質、陰影校正、良品差異比對、粒子分析、結果回報")
pic("VisionSequence：運行總覽", "vsBoard", "運行總覽：即時影像、候選、wafer map 與檢測資訊")

deck.section("節拍與擴充", "整片週期與升級路線", number="04")
deck.table("整片週期（20MP 面掃＋GigE）", ["項目", "時間"], d["cycle"], col_widths=[6, 3], size=13)
deck.table("節拍擴充路線", ["方案", "整片時間", "說明"], d["options"], col_widths=[3.6, 2.2, 5], size=13)
deck.cards("提案總結", [tuple(c) for c in d["summary"]])

# ---------------------------------------------------------------- 後段：內部評估（隱藏頁）
hidden = []
hidden.append(deck.section("附錄：內部評估（隱藏）", "未知事項、假設、風險、POC 與驗證界線", number="A"))
hidden.append(deck.table("客戶提供的資料與未知事項", ["類別", "內容"], d["facts"], col_widths=[2, 8.6], size=13))
asm = d["assumptions"]
for i in range(0, len(asm), 12):
    hidden.append(deck.table("假設值與來源" + (f"（{i // 12 + 1}）" if len(asm) > 12 else ""), ["參數", "本版值", "來源", "說明"], asm[i:i + 12], col_widths=[3, 2, 1.6, 4], size=11))
hidden.append(deck.table("風險與對策", ["風險", "等級", "對策"], d["risks"], col_widths=[5, 1, 4.6], size=13))
hidden.append(deck.two_column("POC 項目與待拍板事項", "POC 項目", d["poc"], "需要拍板", d["decisions"]))
hidden.append(deck.table("模擬、估算與實機驗證的界線", ["內容", "本版怎麼得到", "要怎麼確認"], d["boundary"], col_widths=[3, 4.6, 3], size=12))
hidden.append(deck.table("參數敏感度（無注入缺陷情境）", ["方案", "位置數", "待複檢", "資料量", "整片週期", "景深"], d["sensitivity"], col_widths=[2.6, 1.4, 1.4, 1.8, 1.8, 1.4], size=12,
                         sub="倍率 2× 時景深小於平面度假設 80 µm，邊緣大量位置待複檢；提高倍率要搭配即時自動對焦"))
hidden.append(deck.table("模擬驗證結果（演算法流程，不代表實機檢出率）", ["情境", "候選", "待複檢", "對照真值"], d["sim"], col_widths=[2.2, 1, 1.2, 6.2], size=11))
for s in hidden:
    s._element.set("show", "0")
deck.save(out)
print(f"✓ {out}（{len(list(deck.prs.slides))} 頁，其中隱藏 {len(hidden)} 頁）")
