# 檢測軟體頁的示意合成（由 tools/vs-composite.mjs 呼叫）：以自家視覺平台 VisionSequence 的介面截圖為底，
# 把影像區、步驟清單與資訊卡換成本站的 SIM 晶圓影像與晶圓檢測流程。輸出兩張：流程編輯器、運行總覽。
# 合成圖一律在畫面上標「示意合成」：不是 VisionSequence 實際執行晶圓流程的畫面。
#   python -I vs_composite.py <資料.json> <輸出資料夾>
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8")
d = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
FONT = "C:/Windows/Fonts/msjh.ttc"; BOLD = "C:/Windows/Fonts/msjhbd.ttc"
f = lambda size, bold=False: ImageFont.truetype(BOLD if bold else FONT, size)
GREEN, TEXT, MUTE, ORANGE, RED = (16, 122, 101), (33, 37, 41), (110, 117, 125), (255, 154, 60), (230, 70, 60)


def fit(img, box, bg=(0, 0, 0)):
    """把影像等比縮放貼進 box（x0, y0, x1, y1），回傳實際貼上的位置與比例"""
    x0, y0, x1, y1 = box; w, h = x1 - x0, y1 - y0
    k = min(w / img.width, h / img.height); nw, nh = int(img.width * k), int(img.height * k)
    tile = Image.new("RGB", (w, h), bg); tile.paste(img.resize((nw, nh), Image.LANCZOS), ((w - nw) // 2, (h - nh) // 2))
    return tile, (x0 + (w - nw) // 2, y0 + (h - nh) // 2, k)


def boxes(dr, place, items, scale_mm, origin, color, label_fn):
    """候選外框（晶圓座標 mm）畫到貼上的影像上；外框小於 14 px 時放大到 14 px（示意放大）"""
    px0, py0, k = place; (x0, y0), s = origin, scale_mm * k
    for i, b in enumerate(items):
        X0, X1 = px0 + (b[0] - x0) * s, px0 + (b[2] - x0) * s
        Y0, Y1 = py0 + (y0 - b[3]) * s, py0 + (y0 - b[1]) * s
        cx, cy, hw, hh = (X0 + X1) / 2, (Y0 + Y1) / 2, max(7, (X1 - X0) / 2 + 3), max(7, (Y1 - Y0) / 2 + 3)
        dr.rectangle([cx - hw, cy - hh, cx + hw, cy + hh], outline=color, width=2)
        if i == 0:
            t = label_fn(len(items), b); tw = dr.textlength(t, font=f(13, True))
            dr.rectangle([cx - hw - 2, cy - hh - 22, cx - hw + tw + 4, cy - hh - 3], fill=(20, 24, 32)); dr.text((cx - hw + 1, cy - hh - 21), t, font=f(13, True), fill=color)


CLEAN, SUF = d.get("clean", False), d.get("suffix", "")


def stamp(img, text):
    if CLEAN: return
    dr = ImageDraw.Draw(img); w, h = img.size
    dr.rectangle([0, h - 30, w, h], fill=(255, 211, 77)); dr.text((14, h - 26), text, font=f(15, True), fill=(40, 30, 0))


tile = {k: Image.open(v).convert("RGB") for k, v in d["tiles"].items()}

# ---------------------------------------------------------------- 1. 流程編輯器
ed = Image.open(d["editor"]).convert("RGB"); dr = ImageDraw.Draw(ed)
dr.rectangle([370, 8, 900, 38], fill=(255, 255, 255)); dr.text((380, 13), d["flowName"], font=f(14), fill=TEXT)   # 麵包屑
dr.rectangle([226, 56, 1235, 98], fill=(255, 255, 255))                       # 標題列與試執行通知
dr.text((232, 62), d["flowName"], font=f(17, True), fill=TEXT)
tw = dr.textlength(d["flowName"], font=f(17, True))
dr.rounded_rectangle([240 + tw, 63, 240 + tw + 92, 85], 4, fill=(255, 241, 214)); dr.text((248 + tw, 64), d["status"], font=f(13, True), fill=(176, 106, 0))
dr.text((346 + tw, 65), d["statusNote"], font=f(14), fill=MUTE)
dr.rectangle([222, 144, 1308, 180], fill=(227, 241, 251))                     # 草稿提示列 → 示意說明（乾淨版：流程說明）
dr.text((232, 152), "流程：多光源取像 → 品質檢查 → 陰影校正 → 良品差異比對 → 粒子分析 → 結果回報" if CLEAN else "示意合成：VisionSequence 介面截圖＋本站 SIM 晶圓影像，不是實際執行晶圓流程的畫面", font=f(14, True), fill=(20, 80, 140))
dr.rectangle([224, 330, 408, 586], fill=(255, 255, 255))                      # 步驟清單
dr.text((232, 334), f"步驟清單 ({len(d['steps'])})", font=f(14, True), fill=TEXT)
for i, (name, sid) in enumerate(d["steps"][:9]):
    y = 362 + i * 24
    if i == d.get("stepSel", 4): dr.rounded_rectangle([228, y - 3, 402, y + 20], 4, fill=(225, 245, 239))
    dr.ellipse([236, y + 5, 242, y + 11], fill=(40, 180, 120))
    dr.text((250, y), name, font=f(13), fill=TEXT)
for box, key, cap in [((442, 251, 833, 544), "before", "執行前"), ((878, 232, 1291, 543), "after", "執行後")]:
    t, place = fit(tile[key], box); ed.paste(t, box[:2])
    if key == "after": boxes(dr, place, d["blobs"], d["pxPerMm"], d["origin"], ORANGE, lambda n, b: f"B1 候選（明場 {n} 個差異區塊）")
dr.rectangle([476, 219, 600, 238], fill=(46, 52, 64)); dr.text((480, 220), "明場" if CLEAN else "SIM・明場", font=f(12, True), fill=(230, 235, 240))
dr.rectangle([1186, 194, 1300, 212], fill=(46, 52, 64)); dr.text((1190, 195), "明場＋標記" if CLEAN else "SIM・明場＋標記", font=f(12, True), fill=(230, 235, 240))
dr.rectangle([1312, 226, 1598, 300], fill=(255, 255, 255))                    # 右側工具說明
dr.text((1323, 228), d["tool"]["title"], font=f(15, True), fill=TEXT)
y = 252
for line in d["tool"]["desc"]:
    dr.text((1323, y), line, font=f(12), fill=MUTE); y += 16
dr.rectangle([1326, 380, 1584, 408], fill=(255, 255, 255)); dr.text((1336, 384), d["tool"]["name"], font=f(15), fill=TEXT)
dr.rectangle([1478, 188, 1510, 208], fill=(255, 255, 255)); dr.text((1480, 190), "待確認", font=f(12, True), fill=(176, 106, 0))
dr.rectangle([222, 590, 1308, 968], fill=(247, 247, 247))                      # 畫布：本站流程的節點鏈（示意）
for i in range(0, 1086, 24):
    for j in range(0, 378, 24): dr.point((222 + i, 590 + j), fill=(215, 218, 222))
nodes = d["steps"]; nw, gap, y0 = 100, 14, 700
for i, (name, sid) in enumerate(nodes):
    x = 246 + i * (nw + gap)
    sel = i == d.get("stepSel", 4)
    dr.rounded_rectangle([x, y0, x + nw, y0 + 64], 6, fill=(255, 255, 255), outline=(16, 122, 101) if sel else (205, 210, 216), width=2 if sel else 1)
    dr.ellipse([x + 8, y0 + 10, x + 14, y0 + 16], fill=(40, 180, 120))
    dr.text((x + 20, y0 + 5), sid, font=f(11, True), fill=MUTE)
    line, yy = "", y0 + 26                                   # 依寬度換行（最多兩行）
    for ch in name:
        if dr.textlength(line + ch, font=f(12)) > nw - 14 and yy < y0 + 43: dr.text((x + 8, yy), line, font=f(12), fill=TEXT); line, yy = "", yy + 17
        line += ch
    dr.text((x + 8, yy), line, font=f(12), fill=TEXT)
    if i: dr.line([x - gap, y0 + 32, x, y0 + 32], fill=(90, 140, 210), width=2)
dr.rounded_rectangle([246, 800, 700, 868], 6, fill=(255, 244, 222), outline=(235, 210, 160))
dr.text((256, 808), "註解：明場與暗場各跑一次差異比對；品質不足或缺圖", font=f(12), fill=TEXT)
dr.text((256, 828), "直接判待複檢，不找缺陷也不判良品。" + ("" if CLEAN else "（SIM 示意流程）"), font=f(12), fill=TEXT)
stamp(ed, "示意合成（VisionSequence 介面＋本站 SIM 影像）；影像為模擬，不代表實機檢出能力")
ed.save(out / f"vs-editor{SUF}.png")

# ---------------------------------------------------------------- 2. 運行總覽
db = Image.open(d["dashboard"]).convert("RGB"); dr = ImageDraw.Draw(db)
dr.rectangle([222, 48, 1600, 84], fill=(225, 245, 239))
dr.text((240, 56), "晶圓表面 AOI 運行中：明場＋暗場停拍掃描，結果即時寫入 wafer map" if CLEAN else "示意合成：運行總覽套用本站 SIM 結果（精簡展示 75／777 個位置），不是實際運行畫面", font=f(14, True), fill=GREEN)
dr.rectangle([240, 256, 1579, 320], fill=(243, 234, 225))
dr.text((258, 268), d["alert"]["title"], font=f(15, True), fill=TEXT); dr.text((258, 292), d["alert"]["sub"], font=f(13), fill=MUTE)
dr.rectangle([238, 334, 560, 1000], fill=(247, 247, 247))                    # 流程卡
for i, c in enumerate(d["cards"]):
    y = 338 + i * 112
    dr.rounded_rectangle([240, y, 556, y + 100], 8, fill=(255, 255, 255), outline=(40, 180, 120) if c.get("on") else (225, 228, 232), width=2)
    dr.text((256, y + 14), c["name"], font=f(15, True), fill=TEXT)
    col = {"OK": (40, 160, 100), "待確認": (176, 106, 0), "待複檢": (200, 120, 20)}.get(c["badge"], MUTE)
    dr.rounded_rectangle([256, y + 44, 256 + 12 + dr.textlength(c["badge"], font=f(12, True)), y + 64], 6, fill=(240, 244, 242))
    dr.text((262, y + 46), c["badge"], font=f(12, True), fill=col)
    dr.text((256 + 26 + dr.textlength(c["badge"], font=f(12, True)), y + 46), c["meta"], font=f(13), fill=MUTE)
    dr.text((540 - dr.textlength(c["right"], font=f(13)), y + 72), c["right"], font=f(13), fill=MUTE)
panel = (576, 337, 1263, 1000)
dr.rectangle(panel, fill=(28, 34, 48))
dr.text((596, 352), d["board"]["title"], font=f(18, True), fill=(235, 240, 245))
dr.rounded_rectangle([1090, 346, 1250, 382], 6, fill=(60, 48, 18)); dr.text((1102, 352), d["board"]["verdict"], font=f(18, True), fill=(255, 196, 70))
t, place = fit(tile["after"], (596, 396, 1243, 830), (12, 16, 24)); db.paste(t, (596, 396))
boxes(dr, place, d["blobs"], d["pxPerMm"], d["origin"], ORANGE, lambda n, b: f"B1（明場 {n} 區塊）")
wm = Image.open(d["tiles"]["map"]).convert("RGB").resize((150, 150), Image.LANCZOS); db.paste(wm, (1093, 842))
y = 846
for line in d["board"]["lines"]:
    dr.text((600, y), line, font=f(14), fill=(200, 210, 222)); y += 24
dr.rectangle([1281, 338, 1579, 640], fill=(255, 255, 255), outline=(225, 228, 232))
dr.text((1294, 350), "即時檢測資訊" if CLEAN else "即時檢測資訊（SIM）", font=f(14, True), fill=TEXT)
y = 380
for k, v in d["info"]:
    dr.text((1294, y), k, font=f(13), fill=MUTE); dr.text((1566 - dr.textlength(v, font=f(13, True)), y), v, font=f(13, True), fill=TEXT); y += 26
stamp(db, "示意合成（VisionSequence 介面＋本站 SIM 結果）；數字來自展示參數與模擬，不是客戶規格或實機資料")
db.save(out / f"vs-dashboard{SUF}.png")
print(f"✓ {out / ('vs-editor' + SUF + '.png')}\n✓ {out / ('vs-dashboard' + SUF + '.png')}")
