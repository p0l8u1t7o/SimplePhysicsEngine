# core/solar 的 pvlib 交叉驗證：產生參考值 JSON（ref/*.json），由 compare.mjs 比對。
# 執行：.venv\Scripts\python.exe tools\solar-pvlib\validate.py
# 需要 pvlib（0.16）、pandas、numpy、h5py。亂數用固定種子，重跑結果相同。
import json, os, math
import numpy as np, pandas as pd, pvlib
from pvlib import solarposition, tracking, irradiance, iam, temperature, pvsystem, inverter, atmosphere, clearsky, shading, iotools

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, '..', '..', 'TEMP', 'solar-pvlib-ref'); os.makedirs(REF, exist_ok=True)   # 參考值約 15 MB，只留本機
rng = np.random.default_rng(20261107)
def dump(name, obj):
    def conv(o):
        if isinstance(o, (np.ndarray, pd.Series, pd.Index)): return [None if (isinstance(v, float) and math.isnan(v)) else v for v in np.asarray(o, dtype=float).tolist()]
        if isinstance(o, (np.floating,)): return float(o)
        if isinstance(o, (np.integer,)): return int(o)
        raise TypeError(type(o))
    with open(os.path.join(REF, name), 'w', encoding='utf-8') as f: json.dump(obj, f, default=conv)
    print('wrote', name)
unix = lambda idx: (idx.tz_convert('UTC').tz_localize(None) - pd.Timestamp('1970-01-01')) / pd.Timedelta('1s')

# ------------------------------------------------------------------ 1. SPA
SITES = [  # 名稱, 緯度, 經度, 海拔 m
    ('taipei', 25.0330, 121.5654, 10), ('taichung', 24.1477, 120.6736, 80), ('tainan', 22.9997, 120.2270, 15),
    ('kaohsiung', 22.6273, 120.3014, 10), ('hengchun', 22.0040, 120.7440, 20), ('hualien', 23.9872, 121.6015, 20),
    ('alishan', 23.5100, 120.8050, 2216), ('kinmen', 24.4490, 118.3770, 30),
    ('golden', 39.742476, -105.1786, 1830.14), ('sydney', -33.8688, 151.2093, 40), ('tromso', 69.6492, 18.9553, 10),
    ('quito', -0.1807, -78.4678, 2850), ('longyearbyen', 78.2232, 15.6267, 10)]
spa = []
for name, lat, lon, alt in SITES:
    # 1990～2040 年的隨機時刻（每地 1500 筆）＋固定的節氣中午
    t = pd.Timestamp('1990-01-01', tz='UTC') + pd.to_timedelta(rng.uniform(0, 50 * 365.25 * 86400, 1500).round(3), unit='s')
    t = pd.DatetimeIndex(sorted(t))
    for dT, P, T in [(69.2, 101325.0, 12.0), (None, 95000.0, 30.0)]:
        sp = solarposition.spa_python(t, lat, lon, alt, pressure=P, temperature=T, delta_t=dT)
        dts = pvlib.spa.calculate_deltat(t.year, t.month) if dT is None else np.full(len(t), dT)
        spa.append(dict(site=name, lat=lat, lon=lon, alt=alt, pressure=P, temperature=T, deltaT=dts, deltaTAuto=dT is None,
                        unix=unix(t), apparent_zenith=sp.apparent_zenith, zenith=sp.zenith, azimuth=sp.azimuth, eot=sp.equation_of_time))
dump('spa.json', spa)

# ------------------------------------------------------------------ 2. 追日
lat, lon, alt = 23.0, 120.2, 15
times = pd.date_range('2025-01-01 00:30', '2025-12-31 23:30', freq='1h', tz='Etc/GMT-8')
sp = solarposition.spa_python(times, lat, lon, alt, delta_t=69.2)
slopes = [(0, 0), (8, 90), (6, 200)]   # (坡度, 坡向)
cases = []
for (axis_az, max_angle, gcr, backtrack) in [(180, 60, 0.35, True), (180, 60, 0.35, False), (170, (-50, 60), 0.45, True), (0, 55, 0.3, True), (200, 60, 0.5, True)]:
    for slope_tilt, slope_az in slopes:
        axis_tilt = float(tracking.calc_axis_tilt(slope_az, slope_tilt, axis_az)) if slope_tilt else 0.0
        cat = float(tracking.calc_cross_axis_tilt(slope_az, slope_tilt, axis_az, axis_tilt)) if slope_tilt else 0.0
        r = tracking.singleaxis(sp.apparent_zenith, sp.azimuth, axis_tilt=axis_tilt, axis_azimuth=axis_az, max_angle=max_angle, backtrack=backtrack, gcr=gcr, cross_axis_tilt=cat)
        cases.append(dict(axis_azimuth=axis_az, axis_tilt=axis_tilt, max_angle=list(max_angle) if isinstance(max_angle, tuple) else max_angle,
                          gcr=gcr, backtrack=backtrack, cross_axis_tilt=cat, slope_tilt=slope_tilt, slope_azimuth=slope_az,
                          theta=r.tracker_theta, surface_tilt=r.surface_tilt, surface_azimuth=r.surface_azimuth, aoi=r.aoi))
# 1D 排間遮陰（真追日，不回溯）
sf = []
for axis_az, gcr in [(180, 0.4), (170, 0.5)]:
    r = tracking.singleaxis(sp.apparent_zenith, sp.azimuth, axis_azimuth=axis_az, max_angle=60, backtrack=False, gcr=gcr)
    f = shading.shaded_fraction1d(sp.apparent_zenith, sp.azimuth, axis_az, r.tracker_theta.fillna(0), collector_width=2.0, pitch=2.0 / gcr)
    sf.append(dict(axis_azimuth=axis_az, gcr=gcr, theta=r.tracker_theta, fraction=f))
dump('tracking.json', dict(zenith=sp.apparent_zenith, azimuth=sp.azimuth, cases=cases, shaded1d=sf))

# ------------------------------------------------------------------ 3. 日射
N = 3000
zen = rng.uniform(0, 89.5, N); saz = rng.uniform(0, 360, N)
tilt = rng.uniform(0, 90, N); taz = rng.uniform(0, 360, N)
ghi_cs = 1100 * np.cos(np.radians(zen)) ** 1.15
kt = rng.uniform(0.05, 1.0, N)
ghi = ghi_cs * kt
doy = rng.integers(1, 366, N)
er = irradiance.erbs(ghi, zen, doy)
dni, dhi = np.asarray(er['dni']), np.asarray(er['dhi'])
dni_extra = irradiance.get_extra_radiation(doy)
am = atmosphere.get_relative_airmass(zen)
albedo = rng.uniform(0.1, 0.35, N)
tot = {m: irradiance.get_total_irradiance(tilt, taz, zen, saz, dni, ghi, dhi, dni_extra=dni_extra, airmass=am, albedo=albedo, model=m) for m in ['perez', 'haydavies', 'isotropic']}
pz = irradiance.perez(tilt, taz, dhi, dni, dni_extra, zen, saz, am, return_components=True)
dc = irradiance.disc(ghi, zen, doy, pressure=101325)
aoi_grid = np.linspace(0, 90, 181)
tl_times = pd.date_range('2025-01-01 04:00', '2025-12-31 04:00', freq='5D', tz='UTC')
tl = {n: clearsky.lookup_linke_turbidity(tl_times, la, lo) for n, la, lo, _ in SITES[:8]}
ine_z = np.linspace(0, 89, 90); ine = []
for alt_ in [0, 500, 2200]:
    for tl_ in [2.0, 3.5, 5.0]:
        amr = atmosphere.get_relative_airmass(ine_z); ama = atmosphere.get_absolute_airmass(amr, atmosphere.alt2pres(alt_))
        r = clearsky.ineichen(ine_z, ama, tl_, altitude=alt_)
        ine.append(dict(alt=alt_, tl=tl_, ghi=r['ghi'], dni=r['dni'], dhi=r['dhi'], amAbs=ama))
poa_g = rng.uniform(0, 1200, 500); t_air = rng.uniform(-5, 40, 500); ws = rng.uniform(0, 10, 500)
p = temperature.TEMPERATURE_MODEL_PARAMETERS['sapm']['open_rack_glass_glass']
pdc = rng.uniform(0, 1.3, 500) * 1000
dump('irradiance.json', dict(
    zenith=zen, sun_azimuth=saz, tilt=tilt, surface_azimuth=taz, ghi=ghi, dni=dni, dhi=dhi, kt=er['kt'], doy=doy, dni_extra=dni_extra,
    airmass=am, albedo=albedo, disc_dni=dc['dni'],
    poa={m: dict(globl=v['poa_global'], direct=v['poa_direct'], sky=v['poa_sky_diffuse'], ground=v['poa_ground_diffuse']) for m, v in tot.items()},
    perez_components=dict(isotropic=pz['poa_isotropic'], circumsolar=pz['poa_circumsolar'], horizon=pz['poa_horizon']),
    aoi=aoi_grid, iam_physical=iam.physical(aoi_grid), iam_ashrae=iam.ashrae(aoi_grid), iam_martin_ruiz=iam.martin_ruiz(aoi_grid),
    mr_diffuse_tilt=np.linspace(0, 180, 37), mr_diffuse=iam.martin_ruiz_diffuse(np.linspace(0, 180, 37)),
    linke=dict(unix=unix(tl_times), sites={n: dict(lat=la, lon=lo, tl=tl[n]) for n, la, lo, _ in SITES[:8]}),
    ineichen=dict(zenith=ine_z, cases=ine),
    temp=dict(poa=poa_g, t_air=t_air, ws=ws, sapm=temperature.sapm_cell(poa_g, t_air, ws, **p), faiman=temperature.faiman(poa_g, t_air, ws)),
    pvwatts=dict(pdc=pdc, ac=inverter.pvwatts(pdc, 1000.0), dc=pvsystem.pvwatts_dc(poa_g, t_air, 1000.0, -0.0035), losses=pvsystem.pvwatts_losses()),
))

# ------------------------------------------------------------------ 4. 全年發電
def write_epw(path, lat, lon, tz, elev, df):
    """寫出最小可用的 EPW（pvlib.iotools.read_epw 讀得回來）"""
    head = [f'LOCATION,Synthetic Tainan,TN,TWN,core-solar synthetic,000000,{lat},{lon},{tz},{elev}',
            'DESIGN CONDITIONS,0', 'TYPICAL/EXTREME PERIODS,0', 'GROUND TEMPERATURES,0', 'HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0',
            'COMMENTS 1,synthetic clear-sky x deterministic cloud factor (seed 20261107)', 'COMMENTS 2,for validation only',
            'DATA PERIODS,1,1,Data,Sunday, 1/ 1,12/31']
    rows = []
    for ts, r in df.iterrows():
        h = ts.hour + 1   # 小時結束
        f = [ts.year, ts.month, ts.day, h, 60, 'A7A7A7A7*0?9?9?9?9?9?9?9A7A7A7A7A7A7*0E8*0*0',
             f'{r.temp_air:.1f}', f'{r.temp_air - 5:.1f}', 75, int(r.pressure), 9999, 9999, 400,
             int(round(r.ghi)), int(round(r.dni)), int(round(r.dhi)), 999999, 999999, 999999, 9999,
             180, f'{r.wind_speed:.1f}', 5, 5, 20, 77777, 9, 999999999, 30, 0.1, 0, 88, 0.2, 0, 0]
        rows.append(','.join(str(v) for v in f))
    open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(head + rows) + '\n')

lat, lon, tz, elev = 23.0, 120.2, 8, 15
idx = pd.date_range('2023-01-01 00:00', '2023-12-31 23:00', freq='1h', tz='Etc/GMT-8')
mid = idx + pd.Timedelta('30min')
spm = solarposition.spa_python(mid, lat, lon, elev, delta_t=69.2)
tlm = clearsky.lookup_linke_turbidity(mid, lat, lon)
amr = atmosphere.get_relative_airmass(spm.apparent_zenith)
cs = clearsky.ineichen(spm.apparent_zenith, atmosphere.get_absolute_airmass(amr), tlm, altitude=elev)
# 決定性的雲量因子：日尺度 AR(1) × 時尺度擾動
day_cf = np.clip(0.75 + 0.25 * np.sin(np.arange(366) * 1.3) * rng.uniform(0.2, 1.0, 366) - rng.uniform(0, 0.35, 366), 0.15, 1.0)
cf = np.clip(day_cf[idx.dayofyear - 1] * rng.uniform(0.85, 1.05, len(idx)), 0.1, 1.0)
ghi_s = (cs['ghi'] * cf).fillna(0).clip(lower=0).round()
dec = irradiance.erbs(ghi_s, spm.apparent_zenith, mid)
syn = pd.DataFrame(dict(ghi=ghi_s.values, dni=dec['dni'].round().values, dhi=dec['dhi'].round().values,
                        temp_air=(24 + 5 * np.sin((idx.dayofyear - 110) / 365 * 2 * np.pi) + 3 * np.sin((idx.hour - 9) / 24 * 2 * np.pi)).round(1),
                        wind_speed=(2 + 1.5 * rng.uniform(0, 1, len(idx))).round(1), pressure=np.full(len(idx), 101000.0)), index=idx)
epw_path = os.path.join(REF, 'synthetic-tainan.epw')
write_epw(epw_path, lat, lon, tz, elev, syn)

def run_chain(w, lat, lon, elev, tz, system, year_label_end=True):
    """手動串 pvlib：SPA（區間中點）→ 姿態 → 斜面（Perez）→ IAM（physical，只乘直達）→ SAPM 溫度 → PVWatts DC → 損失 → PVWatts 變流器"""
    t = w.index - pd.Timedelta('30min') if year_label_end else w.index
    sp = solarposition.spa_python(t, lat, lon, elev, pressure=w['pressure'].values, temperature=w['temp_air'].values, delta_t=69.2)
    z, az = sp.apparent_zenith.values, sp.azimuth.values
    if system['mount'] == 'fixed':
        st, sa = np.full(len(t), system['tilt']), np.full(len(t), system['azimuth'])
        ok = np.ones(len(t), bool)
    else:
        r = tracking.singleaxis(sp.apparent_zenith, sp.azimuth, axis_tilt=0, axis_azimuth=system['axis_azimuth'], max_angle=system['max_angle'], backtrack=True, gcr=system['gcr'])
        st, sa = r.surface_tilt.values, r.surface_azimuth.values
        ok = ~np.isnan(st)
        st = np.nan_to_num(st); sa = np.nan_to_num(sa)
    de = irradiance.get_extra_radiation(t.dayofyear)
    am = atmosphere.get_relative_airmass(z)
    alb = system['albedo']
    tot = irradiance.get_total_irradiance(st, sa, z, az, w['dni'].values, w['ghi'].values, w['dhi'].values, dni_extra=np.asarray(de), airmass=am, albedo=alb, model='perez')
    a = irradiance.aoi(st, sa, z, az)
    eff = np.asarray(tot['poa_direct']) * iam.physical(a) + np.asarray(tot['poa_diffuse'])
    poa = np.asarray(tot['poa_global'])
    mask = ok & (z < 90)
    eff = np.where(mask, np.nan_to_num(eff), 0); poa = np.where(mask, np.nan_to_num(poa), 0)
    tc = temperature.sapm_cell(poa, w['temp_air'].values, w['wind_speed'].values, **temperature.TEMPERATURE_MODEL_PARAMETERS['sapm']['open_rack_glass_glass'])
    dc = pvsystem.pvwatts_dc(eff, tc, system['pdc0'], system['gamma']) * (1 - pvsystem.pvwatts_losses() / 100)
    ac = inverter.pvwatts(dc, system['inv_pdc0'])
    return dict(poa_kwhm2=poa.sum() / 1000, dc_kwh=dc.sum() / 1000, ac_kwh=ac.sum() / 1000,
                monthly_ac=pd.Series(ac, index=w.index).groupby(w.index.month).sum().values / 1000, hourly_ac=ac, hourly_poa=poa)

SYSTEMS = [dict(name='fixed20', mount='fixed', tilt=20, azimuth=180, pdc0=1e6, gamma=-0.0035, inv_pdc0=1e6 / 1.25, albedo=0.2),
           dict(name='tracker', mount='singleAxis', axis_azimuth=180, max_angle=60, gcr=0.4, pdc0=1e6, gamma=-0.0035, inv_pdc0=1e6 / 1.25, albedo=0.2)]
energy = {}
epw, meta = iotools.read_epw(epw_path)
epw.index = idx   # read_epw 的索引是小時結束；統一成「區間開始」再於 run_chain 內 −30 分 → 改用 idx + 1h 標記
w_epw = epw.copy(); w_epw.index = idx + pd.Timedelta('1h'); w_epw['pressure'] = epw['atmospheric_pressure'].astype(float)
energy['synthetic-tainan'] = {s['name']: run_chain(w_epw, lat, lon, elev, tz, s) for s in SYSTEMS}
# pvlib 自帶的 TMY3（美國 Greensboro NC）：年份統一成 2023
tmy, m = iotools.read_tmy3(os.path.join(os.path.dirname(pvlib.__file__), 'data', '723170TYA.CSV'), coerce_year=2023, map_variables=True)
tmy = tmy.rename(columns={'pressure': 'pressure_mbar'}); tmy['pressure'] = tmy['pressure_mbar'] * 100
energy['tmy3-723170'] = {s['name']: run_chain(tmy, m['latitude'], m['longitude'], m['altitude'], m['TZ'], s) for s in SYSTEMS}
for k, v in energy.items():
    for s, r in v.items(): print(k, s, 'POA %.1f kWh/m2, AC %.1f MWh' % (r['poa_kwhm2'], r['ac_kwh'] / 1000))
dump('energy.json', dict(systems=SYSTEMS, results=energy, tmy3_year=2023, pvlib=pvlib.__version__))

# ------------------------------------------------------------------ 5. 雙面背面日射（pvlib infinite_sheds，等向天空）
from pvlib.bifacial import infinite_sheds
NB = 120
b_tilt = rng.uniform(0, 60, NB); b_saz = np.where(rng.uniform(0, 1, NB) < 0.5, 180.0, 90.0)
b_zen = rng.uniform(5, 80, NB); b_az = rng.uniform(60, 300, NB)
b_gcr = rng.uniform(0.25, 0.6, NB); b_h = rng.uniform(1.0, 2.5, NB)   # 中心高（m），板寬 2 m
b_ghi_cs = 1000 * np.cos(np.radians(b_zen)); b_kt = rng.uniform(0.2, 0.9, NB)
b_ghi = b_ghi_cs * b_kt; b_doy = rng.integers(1, 366, NB)
b_er = irradiance.erbs(b_ghi, b_zen, b_doy)
b_alb = rng.uniform(0.15, 0.4, NB)
rows = []
for i in range(NB):
    r = infinite_sheds.get_irradiance(b_tilt[i], b_saz[i], b_zen[i], b_az[i], b_gcr[i], b_h[i], 2.0 / b_gcr[i], b_ghi[i], float(b_er['dhi'][i]), float(b_er['dni'][i]), b_alb[i],
                                      model='isotropic', bifaciality=1.0, shade_factor=0.0, transmission_factor=0.0, npoints=200)
    rows.append(dict(tilt=b_tilt[i], saz=b_saz[i], zen=b_zen[i], az=b_az[i], gcr=b_gcr[i], height=b_h[i], ghi=b_ghi[i], dni=float(b_er['dni'][i]), dhi=float(b_er['dhi'][i]), albedo=b_alb[i],
                     back=float(np.ravel(r['poa_back'])[0]), front=float(np.ravel(r['poa_front'])[0])))
dump('bifacial.json', rows)
