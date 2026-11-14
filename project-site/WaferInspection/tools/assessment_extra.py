# 評估簡報補頁（由 tools/assessment-extra.mjs 呼叫）：用公司樣板（zqdeck）開啟已產生的簡報，在「附錄 A」之前插入本站的補充頁。
#   python -I assessment_extra.py <樣板資料夾> <資料.json> <簡報.pptx>
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")   # -I 會忽略 PYTHONIOENCODING

kit, data_file, pptx = sys.argv[1:4]
sys.path.insert(0, str(Path(kit) / "scripts"))
from zqdeck import Deck  # noqa: E402

d = json.loads(Path(data_file).read_text(encoding="utf-8"))
deck = Deck(template=pptx)
slides = list(deck.prs.slides)
deck._closing = slides[-1]                       # 已產生的簡報：最後一頁是「感謝聆聽指教」
before = len(slides)

def title_of(s):
    for sh in s.shapes:
        if sh.has_text_frame and sh.text_frame.text.strip():
            return sh.text_frame.text.strip()
    return ""

# 已經補過的簡報不再補（python-pptx 刪頁後再新增會撞到零件名稱）；assessment-extra.mjs 每次都先重新產生簡報
MARK = "【本站補充】"
if any(s.has_notes_slide and MARK in s.notes_slide.notes_text_frame.text for s in deck.prs.slides):
    print("✗ 這份簡報已經補過；請重新產生（tools/assessment-extra.mjs 會先執行 vs3d assess deck）")
    sys.exit(1)

new = []
new.append(deck.section("光學、掃描與檢測方式", "幾何估算與 SIM 流程；不代表實機檢出能力", number="04"))
if d.get("closeups"):                               # SIM 影像特寫拼圖（外觀參考客戶照片的程序圖樣）
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.truetype("C:/Windows/Fonts/msjhbd.ttc", 22)
    W, H = 900, 520
    sheet = Image.new("RGB", (W * 2 + 30, (H + 44) * 2 + 10), (255, 255, 255)); dr = ImageDraw.Draw(sheet)
    for k, (path, cap) in enumerate(d["closeups"][:4]):
        im = Image.open(path).convert("RGB"); sc = min(W / im.width, H / im.height); im = im.resize((int(im.width * sc), int(im.height * sc)), Image.LANCZOS)
        x, y = (k % 2) * (W + 30), (k // 2) * (H + 54)
        sheet.paste(im, (x + (W - im.width) // 2, y)); dr.text((x, y + H + 8), cap, font=font, fill=(30, 50, 80))
    tmp = Path(data_file).with_name("closeups.png"); sheet.save(tmp)
    new.append(deck.picture("晶圓外觀與缺陷特寫（SIM，外觀參考客戶照片的示意）", str(tmp),
                            caption="程序產生的示意圖樣與缺陷；缺陷寬度示意放大，不代表實機成像與檢出能力"))
s = deck.table("光學與掃描估算（展示參數）", ["項目", "估算", "依據"], d["optics"], col_widths=[3, 4, 4], size=12); new.append(s)
s = deck.table("整片週期分項（GigE、完整掃描、無複檢）", ["分項（關鍵路徑）", "秒"], d["breakdown"], col_widths=[6, 2], size=12); new.append(s)
s = deck.table("參數比較（無注入缺陷情境）", ["方案", "位置數", "待複檢", "資料量", "整片週期", "景深", "瓶頸"], d["variants"], col_widths=[3, 1.5, 1.5, 1.8, 1.8, 1.5, 2.6], size=12,
               sub="倍率 2× 時景深小於平面度假設 80 µm，邊緣大量位置判待複檢並回頭複拍；要改即時自動對焦。並行（不加總）：" + "；".join(f"{a} {b}" for a, b, _ in d["parallel"])); new.append(s)
s = deck.table("線掃描參數比較（不另建設備動畫）", ["方案", "掃描帶", "速度", "需要行頻", "掃描時間", "資料量"], d["lineScan"], col_widths=[2, 3, 2, 2, 2, 2], size=12,
               sub="同樣 2.4 µm/px、明暗場各掃一次；需等速平台＋編碼器觸發、動態對焦，亮度不足要 TDI；相機規格為示意"); new.append(s)
s = deck.two_column("檢測演算方式（SIM 流程示意）",
                    "本版畫面上的流程", ["停穩後拍同軸明場＋低角度暗場各一張（停拍互鎖）",
                                    "缺圖、失焦、照明不足 → 待複檢，不判良品",
                                    "明暗補正 → 與黃金樣本差異比對（門檻 max(6σ, 0.1)）",
                                    "連通區域 → B 候選；相鄰位置重疊者合併",
                                    "候選與待複檢位置回頭複拍 → C 待人工確認"],
                    "實機要另外做的", ["die-to-die 或設計圖比對、對位與尺度校正",
                                  "缺陷標註資料與分類（疑似線狀異常、顆粒、其他）",
                                  "允收規格、門檻調整、檢出率與誤判率驗證（MSA）",
                                  "疑似暗線不直接判裂紋；光學影像不判定晶體管、奈米線路或電性缺陷",
                                  "不顯示虛構的模型信心分數"]); new.append(s)
s = deck.table("檢測軟體平台：VisionSequence（自家視覺平台）", ["步驟", "VisionSequence 工具", "本版 SIM 做法", "實機要做"], [
    ["取像", "多光源取像（頻閃、曝光、通道）", "停穩後明場＋暗場各一張", "光源控制器與相機觸發整合"],
    ["影像品質", "區域指標量測（清晰度）、灰階統計", "清晰度、亮度對黃金樣本", "門檻依實拍設定"],
    ["明暗補正", "陰影校正", "8×6 分區亮度比", "白色參考影像校正"],
    ["差異比對", "良品影像差異比對／統計良品比對", "黃金樣本差異 max(6σ, 0.1)", "die-to-die 或多張良品樣板"],
    ["候選", "粒子分析、框操作", "≥ 3 px、外擴 1.2 mm 合併", "依缺陷規格設面積與分類"],
    ["驗證", "批次測試、Golden Set 回歸、驗收書", "四種 SIM 情境", "標註影像集＋MSA"],
    ["輸出", "結果回報、運行介面、HTTP／TCP／Modbus", "wafer map＋複檢清單", "MES 格式待確認"],
    ["進階", "良品學習異常檢測", "—", "POC 後評估（只需良品）"],
], col_widths=[1.6, 3.6, 3, 3], size=11, sub="流程在 VisionSequence 畫布上組成；工具名稱取自平台說明頁。晶圓流程尚未在平台實作，下兩頁是示意合成"); new.append(s)
for path, cap in d.get("vs", []):
    new.append(deck.picture("檢測軟體平台：VisionSequence（示意合成）", path, caption=cap))
s = deck.table("模擬、估算與實機驗證的界線", ["內容", "本版怎麼得到", "類別", "要怎麼確認"], [
    ["晶圓規格、缺陷規格、節拍", "展示假設（300 mm、10 µm）", "展示假設", "客戶提供"],
    ["視野、µm/px、缺陷像素、景深", "core/optics 公式", "幾何估算", "鏡頭型錄＋尺度校正"],
    ["位置數、覆蓋率、資料量", "掃描規劃逐點計算", "幾何估算", "確定倍率與重疊後重算"],
    ["整片週期", "時序模型（梯形速度、停穩、緩衝、傳輸）", "估算", "平台與相機實測"],
    ["明暗場分類", "core/optics L2（鏡面金屬近似）", "幾何近似", "打光 POC"],
    ["缺陷對比、檢出率、誤判率", "SIM 影像與示意演算法", "模擬（不代表實機）", "實拍 POC＋標註＋MSA"],
    ["客戶照片的紅色箭頭", "客戶人工標記", "客戶參考照片", "缺陷標註與允收規格"],
], col_widths=[3, 4, 2, 3], size=12); new.append(s)
for path, cap in d.get("shots", []):
    new.append(deck.picture("SIM 情境畫面", path, caption=cap))
for s in new:                                   # 備忘稿記號：重跑時先移除舊的補充頁
    s.notes_slide.notes_text_frame.text = MARK + "由 project-site/WaferInspection/tools/assessment-extra.mjs 補上；數字來自站的 spec.js 展示參數"

# 新頁插到「附錄 A」之前
lst = deck.prs.slides._sldIdLst
ids = list(lst)
new_ids = ids[-len(new):]
for el in new_ids:
    lst.remove(el)
anchor = next((i for i, s in enumerate(list(deck.prs.slides)) if title_of(s).startswith("附錄 A")), None)
pos = anchor if anchor is not None else len(list(lst)) - 1
for k, el in enumerate(new_ids):
    lst.insert(pos + k, el)

# 頁碼：先移除舊頁碼（右下角的小文字框）再重編
from pptx.util import Inches  # noqa: E402
for s in deck.prs.slides:
    for sh in list(s.shapes):
        if sh.has_text_frame and abs(sh.left - Inches(11.55)) < Inches(0.05) and abs(sh.top - Inches(6.82)) < Inches(0.05) and sh.text_frame.text.strip().isdigit():
            sh._element.getparent().remove(sh._element)
deck.save(pptx)
print(f"✓ 補上 {len(new)} 頁（共 {len(list(deck.prs.slides))} 頁）：{pptx}")
