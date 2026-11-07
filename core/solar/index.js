// core/solar 公開 API（說明見 README.md）。純 ES 模組、無套件、決定性。
export {
  D2R, R2D, solarPosition, spaTime, deltaT, deltaTAt, julianDay, unixFromLocal, daysFromCivil, civilFromDays, dayOfYear,
  aoiProjection, incidenceAngle, sunVector, surfaceNormal, vectorToAngles,
} from './spa.js';
export {
  singleAxis, fixedMount, mountOrientation, projectedZenith, surfaceOrientation, trackerNormal, trackerNormalENU,
  calcAxisTilt, calcCrossAxisTilt, rowShadedFraction1D,
} from './tracking.js';
export {
  extraRadiation, relativeAirmass, absoluteAirmass, altitudeToPressure, linkeTurbidityTW, ineichen, clearSky,
  clearnessIndex, erbs, disc, completeIrradiance, isotropicSky, groundDiffuse, beamComponent, haydavies, perez, PEREZ,
  poaIrradiance, iamPhysical, iamAshrae, iamMartinRuiz, iamMartinRuizDiffuse, iamFunction,
} from './irradiance.js';
export {
  createTriangleList, buildBVH, moduleLayout, shadeModule, shadeModules, createHorizon, horizonFromBVH, skyViewFactor, createSunBinCache,
} from './shading.js';
export {
  readEPW, readTMY3, readCSV, SAPM_TEMP, sapmCell, faimanCell, cellTemperature, pvwattsDC, pvwattsInverter, pvwattsLosses,
  bypassMismatch, stringIrradiance, prepareSolar, simulate,
} from './energy.js';
export { rearIrradiance, createRearModel } from './bifacial.js';
export { trackerArray, fixedArray, modulesToTriangles, modulesToPositions, winterSolsticePitch, azimuthVector, axisVector } from './layout.js';
export { hashFloat64 } from './hash.js';
