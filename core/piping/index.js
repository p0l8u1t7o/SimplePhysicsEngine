// core/piping：配管路徑（直管＋彎，依管徑的最小彎曲半徑）、切長與配件、坡度與對地淨空、導線管與電纜槽、
// 1D 管網水力（Darcy–Weisbach＋局部損失＋高程，樹狀與迴路）、組串與交流電壓降。
// 純計算（sizes、route、hydraulics、cable、checks）不依賴 three；3D 在 build.js。
export { PIPE_SCH40, CONDUIT_EMT, TRAY, CABLE_PV, INCH, size, minBendRadius } from './sizes.js';
export { routePipe, pathPoints, arcPoints, groundClearance, routeToLink } from './route.js';
export { G, lpm, m3h, toLpm, water, K_FITTINGS, CRANE_BEND, reynolds, fTurbulent, swameeJain, colebrook, frictionFactor, kBend, pipeLoss, linkK, solveNetwork } from './hydraulics.js';
export { CONDUCTOR, ohmPerM, dcDrop, acDrop, stringDrop } from './cable.js';
export { routeChecks, hydraulicChecks, voltageDropChecks } from './checks.js';
export { PIPE_MAT, ArcCurve3, routeCurve, routeTube, createPipeBatch, trayGeometry, routeTray } from './build.js';
