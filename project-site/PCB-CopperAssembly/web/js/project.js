// 專案介面（core 統一檢查與 main.js 共用）：建立整台機台、五片基板與一個節拍的排程，apply(t) 把場景放到時間 t。
// 規格見 core/README.md「專案介面」。機種配方由 recipe 指定（網頁取自 ?recipe=，未指定＝預設長圓孔 138）。
import { LAYOUT, PRODUCT, RECIPES, DEFAULT_RECIPE, setRecipe } from './layout.js';
import { createSim } from './sim.js';

import { sampleTimes } from '@core/anim/sampling.js';
import { solidMeshes as meshList } from '@core/electrical/cable-routing.js';

// 配線取樣間隔（秒）
const CABLE_INTERVAL = 0.1;
// project.json 的 variants 已經涵蓋的配方（electrical 檢查會整個再跑一次，配線取樣也在內）；其餘非預設配方由 cables.variants 補上
const PROJECT_VARIANT_RECIPES = new Set(['round-72']);

export function createProject({ scene, headless = false, recipe } = {}) {
  setRecipe(recipe);                                      // 先套配方（未指定＝預設），再建機台與排程
  const sim = createSim(scene), plan = sim.plan, machine = sim.machine, boards = sim.boards;
  const G = LAYOUT.gantry;

  // 非實體：地面、板面標示（貼圖文字平面）
  const isDecal = o => o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.material?.map;
  const floor = machine.floor;                             // core floor() 建的地坪（name 'floor'）

  return {
    // 標準排程介面：timeline（core createTimeline）、events（各站與每一趟的節點）、stationStart（S0–S4 開始作業時間）
    total: plan.total, timeline: plan.timeline, events: plan.events, stationStart: plan.stationStart, sim, plan, machine, boards, headless,
    /** 整台場景放到時間 t（只依 t 決定）；playing 只影響三色燈顏色 */
    apply(t, { playing = false } = {}) {
      const info = sim.apply(t);
      machine.tower.set(playing ? 'green' : 'yellow');
      return info;
    },
    layoutChecks() {
      const rows = [], add = (name, ok, value, note) => rows.push({ group: PRODUCT.recipe, name, ok, value, note });
      add('節拍 ≤ 60 s', plan.cycle <= 60, +plan.cycle.toFixed(2), 's');
      add('最大放置誤差 ≤ ±6 mil', plan.stats.maxErr <= PRODUCT.spec, +plan.stats.maxErr.toFixed(4), 'mm');
      add('孔數＝排程放置數', plan.log.filter(e => e.type === 'place').length === plan.holes.length, plan.holes.length);
      for (const H of ['A', 'B']) {
        const f = LAYOUT.feeder[H], u = LAYOUT.upCam[H];
        add(`供料盤 ${H} 在龍門 X 行程內`, Math.abs(f.x) + LAYOUT.feeder.w / 2 < G.railX - 35, f.x, 'mm');
        add(`仰視相機 ${H} 在龍門 X 行程內`, Math.abs(u.x) + LAYOUT.upCam.flySpan / 2 < G.railX - 35, u.x, 'mm');
      }
      add('配方存在', !!RECIPES[PRODUCT.recipe], PRODUCT.recipe);
      return rows;
    },
    verify: {
      skip: o => o === floor || isDecal(o),
      // 不另加 allow：拖鏈固定座與進線、主軸穿過鏜孔分別由 core 內建規則與 guide／on 標記處理
      // 配線動態檢查（core electrical）：與原本根目錄 tools/verify-cables.mjs（2026-10-04 退役） 的每配方情境等價
      cables: {
        interval: CABLE_INTERVAL,
        // 固定件 keepout、遮擋件、兩座放置龍門、上下料車、S1／S3 相機龍門、供料盤相機（不含線材）
        obstacles: () => [...machine.keepout, ...meshList(machine.occluders),
          ...Object.values(machine.heads).flatMap(h => meshList(h.beam)), ...Object.values(machine.loaders).flatMap(h => meshList(h.car)),
          ...Object.values(machine.scanners).flatMap(h => meshList(h.beam)), ...Object.values(machine.feeders).flatMap(h => meshList(h.cam.group))],
        // 整個節拍等間隔取樣，再加上 S0／S4 上下料、S1／S3 相機、兩座龍門各步驟的起訖點
        times: () => {
          const times = new Set(sampleTimes(0, plan.cycle, CABLE_INTERVAL));
          for (const tr of [plan.s0, plan.s4, plan.s1.tr, plan.s3.tr, ...Object.values(plan.heads).map(h => h.tr)])
            for (const s of tr.steps) { times.add(s.start); times.add(s.start + s.dur); }
          return [...times].sort((a, b) => a - b);
        },
        minRoutes: 5,
        // 預設配方與 project.json variants 以外的配方各建一個情境
        variants: Object.keys(RECIPES).filter(k => k !== DEFAULT_RECIPE && !PROJECT_VARIANT_RECIPES.has(k)).map(k => ({ name: k, params: { recipe: k } })),
      },
    },
  };
}
