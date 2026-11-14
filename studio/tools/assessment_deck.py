"""評估簡報產生器（studio/lib/deck.mjs 呼叫，core/SITE-RULES.md「評估簡報與成本表」）。

    python -I studio/tools/assessment_deck.py <樣板資料夾> <資料.json> <輸出.pptx>

樣板資料夾是公司的 zq-work-deck（assets/template.pptx＋scripts/zqdeck.py，只留本機、不進版控）。
資料由 deck.mjs 從資料庫整理好（提案、可行性分析、成本表、AOI 方案、3D 截圖），文字已遮掉用戶名稱。
版面照 zqdeck 的規範：正文每頁一個主張，一頁至多 5 個要點，細節（BOM 明細、假設值）放附錄。
"""
import json
import re
import sys
from pathlib import Path


def chunks(items, n):
    return [items[i:i + n] for i in range(0, len(items), n)] or [[]]


def clip(s, n):
    s = "" if s is None else str(s)
    return s if len(s) <= n else s[: n - 1] + "…"


def money(v):
    return "—" if v is None else f"{round(v):,}"


def wan(v):
    """萬元，KPI 用（大數字放不下）"""
    return f"{v / 10000:,.0f}" if v >= 100000 else f"{v / 10000:,.1f}"


def main(kit, data_file, out_file):
    sys.path.insert(0, str(Path(kit) / "scripts"))
    from zqdeck import Deck, RISK, WARN, OK  # noqa: E402

    d = json.loads(Path(data_file).read_text(encoding="utf-8"))
    title, date, cost = d["title"], d["date"], d.get("cost")
    src_cost = f"資料來源：3D工作室元件庫的成本表{('「' + cost['name'] + '」') if cost and cost.get('name') else ''}（{cost['updated'] if cost else date}）；估價行以正式報價為準"
    src_feas = "資料來源：" + "、".join(d.get("versions") or ["3D工作室的評估資料"])
    deck = Deck()

    # 封面
    verdict = d.get("verdict") or "評估中"
    sub = f"結論：{verdict}" + (f"｜總計（未稅）NT$ {money(cost['total'])}" if cost else "")
    deck.cover(f"{title} 可行性評估", sub, f"3D工作室自動產生 ｜ {date.replace('-', '/')}")

    # 結論與關鍵數字
    # 卡片的數值字很大（34 pt），「有條件可行」放不下：數值寫「有條件」，完整結論在標題與標籤
    metrics = [({"有條件可行": "有條件"}.get(verdict, verdict), f"評估結論（{verdict}）" if verdict == "有條件可行" else "評估結論")]
    if cost:
        metrics.append((wan(cost["total"]), "總計（萬元，未稅）", f"範圍 {wan(cost['low'])}～{wan(cost['high'])} 萬"))
    cyc = d.get("cycle") or {}
    if cyc.get("estimate") is not None:
        metrics.append((f"{cyc['estimate']} s", "估算節拍", f"目標 {cyc['target']} s" if cyc.get("target") is not None else None))
    if d.get("risks"):
        high = sum(1 for r in d["risks"] if "高" in (r.get("level") or ""))
        metrics.append((str(len(d["risks"])), "主要風險", f"其中高風險 {high} 項" if high else None))
    body = [clip(d.get("summary"), 90)] if d.get("summary") else []
    body += [(clip(c, 80), 1) for c in d.get("conditions", [])[:3]]
    s = deck.kpi(f"評估結論：{verdict}", [tuple(x for x in m if x is not None) for m in metrics], body=body or None,
                 notes=d.get("summary") or None)
    deck.source(s, src_feas)

    # 01 需求與配置
    deck.section("需求與配置", "製程、站位、設備選型與 3D 配置", number="01")
    if d.get("requirement"):
        deck.bullets("需求摘要與量化指標", d["requirement"][:5])
    if d.get("metrics"):
        for i, part in enumerate(chunks(d["metrics"], 8)):
            deck.table("量化指標的目標與估算" + (f"（{i + 1}）" if len(d["metrics"]) > 8 else ""), ["指標", "目標", "估算"],
                       [[clip(m["name"], 30), clip(m["target"], 24), clip(m["estimate"], 24)] for m in part], col_widths=[4, 3, 3])
    if d.get("process") or d.get("layout"):
        deck.two_column("製程流程與站位配置", "製程流程", d.get("process", [])[:5] or ["（提案未列）"],
                        "站位配置", d.get("layout", [])[:5] or ["（提案未列）"])
    if d.get("equipment"):
        deck.bullets("主要設備選型", d["equipment"][:5],
                     notes="\n".join(d["equipment"][5:]) or None)
    for shot in d.get("shots", []):
        deck.picture(f"3D 配置：{shot['caption']}", shot["path"], caption="3D 動畫截圖（示意，尺寸與外觀以正式設計為準）")

    # 02 可行性與風險
    if d.get("risks") or d.get("decisions") or d.get("poc"):
        deck.section("可行性與風險", "風險、對策、POC 與待拍板事項", number="02")
    risks = d.get("risks", [])
    for i, part in enumerate(chunks(risks, 6) if risks else []):
        rows = [[clip(r["risk"], 36), r.get("level") or "—", clip(r["mitigation"], 44)] for r in part]
        s = deck.table("風險與對策" + (f"（{i + 1}／{len(chunks(risks, 6))}）" if len(risks) > 6 else ""), ["風險", "等級", "對策"], rows, col_widths=[4, 1, 5])
        deck.source(s, src_feas)
    if d.get("decisions") or d.get("poc"):
        deck.two_column("開工前要拍板與驗證的事", "需要拍板", [clip(x, 46) for x in d.get("decisions", [])[:5]] or ["（無）"],
                        "POC 驗證項目", [clip(p["item"] + (f"：{p['why']}" if p.get("why") else ""), 46) for p in d.get("poc", [])[:5]] or ["（無）"])

    # 03 成本
    if cost:
        deck.section("成本分析", "子系統小計、總計與估價等級", number="03")
        secs = sorted([x for x in cost["sections"] if x["subtotal"] > 0], key=lambda x: -x["subtotal"])      # 小計 0 的（選配數量 0）不畫
        total_sec = sum(x["subtotal"] for x in secs) or 1
        top = secs[0] if secs else None
        claim = f"成本最大宗是「{clip(re.sub(r'^[0-9.]+\s*', '', top['name']), 14)}」，約佔 {top['subtotal'] * 100 / total_sec:.0f}%" if top else "成本分布"
        bars = list(reversed(secs[:10]))      # 橫條圖由下往上畫：反過來讓最大的在最上面
        s = deck.chart(claim, [clip(x["name"], 16) for x in bars], {"小計（萬元）": [round(x["subtotal"] / 10000, 1) for x in bars]},
                       kind="hbar", number_format="#,##0.0")
        deck.source(s, src_cost)
        rows = [["設備與材料", money(cost["equipment"])], [f"工程人日（{cost['laborDays']} 人日）", money(cost["labor"])]]
        if cost.get("option"):
            rows.append(["選配", money(cost["option"])])
        if cost.get("contingencyRate") is not None:
            rows.append([f"預備費（{round(cost['contingencyRate'] * 100)}%）", money(cost["contingency"])])
        rows += [["總計（未稅）", money(cost["total"])], ["估價範圍", f"{money(cost['low'])} ～ {money(cost['high'])}"]]
        if cost.get("taxRate") is not None:
            rows.append([f"含稅（{round(cost['taxRate'] * 100)}%）", money(cost["taxed"])])
        fl = cost.get("flags") or {}
        notes = "；".join(x for x in [fl.get("estimate") and f"{fl['estimate']} 行是估價（C 級）", fl.get("pending") and f"{fl['pending']} 行的元件待確認",
                                      fl.get("expired") and f"{fl['expired']} 行報價過期", fl.get("noPrice") and f"{fl['noPrice']} 行沒有單價"] if x) or "所有行都有單價"
        s = deck.table(f"總計 NT$ {money(cost['total'])}（未稅）", ["項目", "金額（NT$）"], rows, col_widths=[3, 2], sub=notes)
        deck.source(s, src_cost)

    # AOI 方案（有選用的才放）
    for a in d.get("aoi", []):
        s = deck.table(f"AOI 方案：{clip(a['name'], 24)}", ["項目", "數值", "判定", "說明"],
                       [[clip(r["label"], 18), clip(r["value"], 16), {"ok": "通過", "warn": "注意", "fail": "不通過"}.get(r["status"], "—"), clip(r["note"], 30)] for r in a["rows"]],
                       col_widths=[3, 2, 1, 4])
        deck.source(s, "資料來源：3D工作室光學工作台（L1 計算＋L2 近似模擬）")

    # 附錄
    lines = d.get("lines", [])
    parts = chunks(lines, 12) if lines else []
    for i, part in enumerate(parts):
        rows = [[l["line"], clip(l["name"], 22) + (f"（{l['code']}）" if l["code"] else ""), clip(l["spec"], 22), f"{l['qty']} {l['unit']}".strip(), money(l["subtotal"]), l["grade"] or "—"] for l in part]
        s = deck.table("附錄 A：成本明細" + (f"（{i + 1}／{len(parts)}）" if len(parts) > 1 else ""), ["行", "名稱（元件編號）", "型號／規格", "數量", "小計", "等級"], rows,
                       col_widths=[1, 4, 4, 1.4, 1.6, 0.8], size=10)
        deck.source(s, src_cost)
    asm = d.get("assumptions", [])
    for i, part in enumerate(chunks(asm, 6) if asm else []):
        deck.bullets("附錄 B：假設值" + (f"（{i + 1}／{len(chunks(asm, 6))}）" if len(asm) > 6 else ""), [clip(x, 70) for x in part], size=14)

    deck.save(out_file)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("用法：python -I studio/tools/assessment_deck.py <樣板資料夾> <資料.json> <輸出.pptx>")
        sys.exit(2)
    main(*sys.argv[1:])
