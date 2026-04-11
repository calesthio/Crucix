
// === DATA ===
let D = window.__CRUCIX_DATA__ || null;
const L = window.__CRUCIX_LOCALE__ || {};
function t(keyPath, fallback) {
  const keys = keyPath.split('.');
  let value = L;
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      return fallback || keyPath;
    }
  }
  return typeof value === 'string' ? value : (fallback || keyPath);
}

// === GLOBALS ===
let globe = null;
let globeInitialized = false;
let flightsVisible = true;
let lowPerfMode = localStorage.getItem('crucix_low_perf') === 'true';
let isFlat = shouldStartFlat();
let aircraftMode = false;
let adsbMode = false;
let adsbInterval = null;
let adsbAircraft = [];
let currentRegion = 'world';
let flatSvg, flatProjection, flatPath, flatG, flatZoom, flatW, flatH;
const signalGuideItems = [
  {
    term:'No Callsign',
    category:'Air',
    meaning:'OpenSky received an aircraft track without a usable callsign or flight ID in that record.',
    matters:'Useful as an opacity signal. A cluster of missing callsigns can indicate incomplete transponder metadata or less transparent traffic.',
    notMeaning:'Not proof of military, covert, or hostile activity on its own.',
    example:'South China Sea: No Callsign 6 of 152 means 6 tracks in that theater had no usable callsign in the feed.'
  },
  {
    term:'High Altitude',
    category:'Air',
    meaning:'Aircraft above 12,000 meters, roughly 39,000 feet, in the current OpenSky snapshot.',
    matters:'Separates cruise-level traffic from lower-altitude local or regional movement.',
    notMeaning:'Not a danger score and not inherently unusual. Commercial jets commonly operate here.',
    example:'High Altitude 2 means only 2 tracked aircraft in that hotspot were above the cruise threshold at that snapshot.'
  },
  {
    term:'Top Countries',
    category:'Air',
    meaning:'The most common OpenSky origin_country values among aircraft in that hotspot.',
    matters:'Useful for understanding the rough composition of traffic flowing through a theater.',
    notMeaning:'Not who is controlling the aircraft right now and not a direct indicator of military ownership.',
    example:'China (61), Philippines (39), Taiwan (17) means those were the top registered origin countries in the snapshot.'
  },
  {
    term:'FRP',
    category:'Thermal',
    meaning:'Fire Radiative Power. This is the intensity of one specific FIRMS hotspot, measured in megawatts.',
    matters:'Higher FRP usually means a hotter, larger, or more energetic fire event at that exact point.',
    notMeaning:'Not the intensity of the whole region and not automatic proof of conflict activity.',
    example:'Sudan / Horn of Africa: FRP 92.3 MW describes that one hotspot, while Total 1,451 describes the entire regional detection count.'
  },
  {
    term:'Total Detections',
    category:'Thermal',
    meaning:'The total number of FIRMS thermal detections in the entire region bucket for the current sweep.',
    matters:'Useful for spotting unusually active fire clusters, especially when compared with historical baselines or night activity.',
    notMeaning:'Not a count for the single map point you clicked and not necessarily a conflict count.',
    example:'Total 1,451 means the whole Sudan / Horn of Africa bucket had 1,451 detections in that sweep.'
  },
  {
    term:'Night Detections',
    category:'Thermal',
    meaning:'Thermal detections tagged as occurring at night inside the broader FIRMS region bucket.',
    matters:'Nighttime heat can be more noteworthy because it is less likely to be routine daytime land burning.',
    notMeaning:'Not a direct combat indicator. It still needs context from location, baseline, and corroborating sources.',
    example:'Night 140 means 140 of the 1,451 regional detections were nighttime detections in that sweep.'
  },
  {
    term:'Chokepoint',
    category:'Maritime',
    meaning:'A strategic maritime corridor or passage where trade and energy flows can be delayed, diverted, or disrupted.',
    matters:'These nodes matter because a disruption here can affect shipping costs, transit times, and commodity pricing globally.',
    notMeaning:'Not proof that disruption is happening now. It is a strategic watch location.',
    example:'Bab el-Mandeb or the Strait of Hormuz matter because shipping and energy flows concentrate there.'
  },
  {
    term:'SDR Receiver',
    category:'Signals',
    meaning:'A publicly reachable software-defined radio receiver in or near a region of interest.',
    matters:'Dense receiver coverage can give you more ability to monitor communications or signal activity in a theater.',
    notMeaning:'Not evidence of hostile emissions or a threat by itself. It is an observation and monitoring layer.',
    example:'South China Sea SDR count means publicly accessible KiwiSDR receivers are available in or near that zone.'
  },
  {
    term:'CPM',
    category:'Radiation',
    meaning:'Counts per minute from a radiation monitoring source, used here for relative radiation status at a site.',
    matters:'Useful for spotting anomalies against the site’s normal range or comparing consecutive readings.',
    notMeaning:'Not a direct safety verdict on its own. Interpretation depends on local baseline and trend, not the raw number alone.',
    example:'A site reading 33 CPM can be normal if that location’s usual background level is in the same range.'
  },
  {
    term:'HY Spread',
    category:'Macro',
    meaning:'High-yield credit spread, shown here as a stress proxy from FRED credit data.',
    matters:'When spreads widen, markets are usually pricing more credit stress and tighter financial conditions.',
    notMeaning:'Not a recession call by itself. It is one stress signal among many.',
    example:'A rising HY Spread alongside higher VIX and weaker equities is a stronger risk-off pattern than HY alone.'
  },
  {
    term:'VIX',
    category:'Macro',
    meaning:'The CBOE Volatility Index, commonly used as a market-implied fear or volatility gauge.',
    matters:'Higher VIX often means more expected equity volatility and more defensive market positioning.',
    notMeaning:'Not a direct forecast of a crash and not a geopolitical indicator by itself.',
    example:'VIX above 20 with widening HY spreads is a stronger stress pattern than VIX alone.'
  },
  {
    term:'GSCPI',
    category:'Macro',
    meaning:'The Global Supply Chain Pressure Index, a broad indicator of global supply-chain strain.',
    matters:'It helps translate geopolitical or weather disruptions into likely pressure on shipping, inventory, and pricing.',
    notMeaning:'Not a live market price and not a company-specific supply-chain score by itself.',
    example:'A higher GSCPI makes route or energy shocks more likely to spill into broader cost pressure.'
  },
  {
    term:'WHO Alert',
    category:'Health',
    meaning:'A WHO Disease Outbreak News item or outbreak-related bulletin surfaced in the health layer.',
    matters:'Useful for watching outbreaks that could affect travel, supply chains, humanitarian stress, or regional operating conditions.',
    notMeaning:'Not a pandemic declaration and not automatically high severity.',
    example:'A WHO alert in a port-heavy region matters more if it overlaps shipping, border controls, or local instability signals.'
  },
  {
    term:'Sweep Delta',
    category:'Platform',
    meaning:'The change summary between the current sweep and the previous one, including new, escalated, and de-escalated signals.',
    matters:'Useful for spotting what changed recently instead of re-reading the full dashboard from scratch.',
    notMeaning:'Not a full risk model. It is a directional change layer on top of the raw signals.',
    example:'A delta marked risk-off with several new and escalated items means the latest sweep materially worsened the signal mix.'
  }
];
const regionPOV = {
  world: { lat: 20, lng: 20, altitude: 1.8 },
  americas: { lat: 35, lng: -95, altitude: 1.0 },
  europe: { lat: 50, lng: 15, altitude: 1.0 },
  middleEast: { lat: 28, lng: 45, altitude: 1.1 },
  asiaPacific: { lat: 25, lng: 110, altitude: 1.2 },
  africa: { lat: 5, lng: 20, altitude: 1.2 }
};

if(lowPerfMode) document.body.classList.add('low-perf');

function isWeakMobileDevice(){
  const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const memory = navigator.deviceMemory || 0;
  const cores = navigator.hardwareConcurrency || 0;
  return reducedMotion || (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4);
}

function shouldStartFlat(){
  if(!isMobileLayout()) return true;
  return lowPerfMode || isWeakMobileDevice();
}

function setMapLoading(show, text='Initializing 3D Globe'){
  const overlay = document.getElementById('mapLoading');
  const label = document.getElementById('mapLoadingText');
  if(!overlay || !label) return;
  label.textContent = text;
  overlay.classList.toggle('show', show);
}

function togglePerfMode(){
  lowPerfMode = !lowPerfMode;
  localStorage.setItem('crucix_low_perf', String(lowPerfMode));
  document.body.classList.toggle('low-perf', lowPerfMode);
  const perfStatus = document.getElementById('perfStatus');
  if(perfStatus) perfStatus.textContent = lowPerfMode ? 'LITE' : 'FULL';
  if(globe){
    globe.controls().autoRotate = !lowPerfMode;
    globe.arcDashAnimateTime(lowPerfMode ? 0 : 2000);
  }
  if(lowPerfMode && isMobileLayout() && !isFlat){
    toggleMapMode();
  } else {
    renderLower();
    renderRight();
  }
}

// === TOPBAR ===
function getRegionControlsMarkup(){
  return ['world','americas','europe','middleEast','asiaPacific','africa'].map(r=>
    `<button class="region-btn ${r===currentRegion?'active':''}" data-region="${r}" onclick="setRegion('${r}')">${r==='middleEast'?'MIDDLE EAST':r==='asiaPacific'?'ASIA PACIFIC':r.toUpperCase()}</button>`
  ).join('');
}

function renderRegionControls(){
  const mapRegionBar = document.getElementById('mapRegionBar');
  if(!mapRegionBar) return;
  if(isMobileLayout()){
    mapRegionBar.innerHTML = '';
    mapRegionBar.style.display = 'none';
    return;
  }
  mapRegionBar.innerHTML = getRegionControlsMarkup();
  mapRegionBar.style.display = 'flex';
}

function renderTopbar(){
  const mobile = isMobileLayout();
  const ts = new Date(D.meta.timestamp);
  const d = ts.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}).toUpperCase();
  const timeStr = ts.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true});
  const aircraftPill = D.airMeta?.tar1090?.available
    ? `<button class="meta-pill" onclick="toggleAircraftMode()" title="Open authoritative aircraft view">AIRCRAFT <span class="v">${aircraftMode?'MAP':'LIVE'}</span></button>`
    : '';
  document.getElementById('topbar').innerHTML=`
    <div class="top-left">
      <span class="brand">CRUCIX</span>
      <span class="regime-chip"><span class="blink"></span>WARTIME STAGFLATION RISK</span>
    </div>
    ${mobile ? `<div class="top-center">${getRegionControlsMarkup()}</div>` : ''}
    <div class="top-right">
      ${aircraftPill}
      <button class="meta-pill perf-pill" onclick="togglePerfMode()" title="Reduce visual effects and start mobile in flat mode">${t('dashboard.visuals','VISUALS')} <span class="v" id="perfStatus">${lowPerfMode?t('dashboard.visualsLite','LITE'):t('dashboard.visualsFull','FULL')}</span></button>
      <span class="meta-pill">${t('dashboard.sweep','SWEEP')} <span class="v">${(D.meta.totalDurationMs/1000).toFixed(1)}s</span></span>
      <span class="meta-pill">${d} <span class="v">${timeStr}</span></span>
      <span class="meta-pill">${t('dashboard.sources','SOURCES')} <span class="v">${D.meta.sourcesOk}/${D.meta.sourcesQueried}</span></span>
      ${D.delta?.summary ? `<span class="meta-pill">${t('dashboard.delta','DELTA')} <span class="v">${D.delta.summary.direction==='risk-off'?'&#x25B2; '+t('dashboard.riskOff','RISK-OFF'):D.delta.summary.direction==='risk-on'?'&#x25BC; '+t('dashboard.riskOn','RISK-ON'):'&#x25C6; '+t('dashboard.mixed','MIXED')}</span></span>` : ''}
      <button class="guide-btn" onclick="openGlossary()">${t('dashboard.guideBtn','What Signals Mean')}</button>
      <span class="alert-badge">${t('dashboard.highAlert','HIGH ALERT')}</span>
    </div>`;
  renderRegionControls();
}

// === LEFT RAIL ===
function renderLeftRail(){
  const totalAir=D.air.reduce((s,a)=>s+a.total,0);
  const airSummaryLabel = D.airMeta?.summaryLabel || 'Theater Activity';
  const totalThermal=D.thermal.reduce((s,t)=>s+t.det,0);
  const totalNight=D.thermal.reduce((s,t)=>s+t.night,0);
  const newsCount=(D.news||[]).length;
  const layers=[
    {name:airSummaryLabel,count:totalAir,dot:'air',sub:`${D.air.length} ${t('layers.theaters','theaters')}`},
    {name:t('layers.thermalSpikes','Thermal Spikes'),count:totalThermal.toLocaleString(),dot:'thermal',sub:`${totalNight.toLocaleString()} ${t('layers.nightDet','night det.')}`},
    {name:t('layers.sdrCoverage','SDR Coverage'),count:D.sdr.total,dot:'sdr',sub:`${D.sdr.online} ${t('layers.online','online')}`},
    {name:t('layers.maritimeWatch','Maritime Watch'),count:D.chokepoints.length,dot:'maritime',sub:t('layers.chokepoints','chokepoints')},
    {name:t('layers.nuclearSites','Nuclear Sites'),count:D.nuke.length,dot:'nuke',sub:t('layers.monitors','monitors')},
    {name:t('layers.healthWatch','Health Watch'),count:D.who.length,dot:'health',sub:t('layers.whoAlerts','WHO alerts')},
    {name:t('layers.worldNews','World News'),count:newsCount,dot:'news',sub:t('layers.rssGeolocated','RSS geolocated')},
    {name:t('layers.osintFeed','OSINT Feed'),count:D.tg.posts,dot:'incident',sub:`${D.tg.urgent.length} ${t('badges.urgent','urgent').toLowerCase()}`},
    {name:t('layers.spaceActivity','Satellites'),count:D.space?.militarySats||0,dot:'space',sub:`${D.space?.totalNewObjects||0} ${t('space.newLast30d','new (30d)')}`}
  ];
  const allNormal=D.nuke.every(s=>!s.anom);
  const nukeHtml=D.nuke.map(s=>`<div class="site-row"><span>${s.site}</span><span class="site-val">${s.n>0?(s.cpm?.toFixed(1)||'--')+' CPM':'No data'}</span></div>`).join('');
  const vix=D.fred.find(f=>f.id==='VIXCLS');
  const hy=D.fred.find(f=>f.id==='BAMLH0A0HYM2');
  const usd=D.fred.find(f=>f.id==='DTWEXBGS');
  const m2=D.fred.find(f=>f.id==='M2SL');
  const mort=D.fred.find(f=>f.id==='MORTGAGE30US');
  const claims=D.fred.find(f=>f.id==='ICSA');

  const adsbMilCount = adsbAircraft.filter(a => a.military).length;
  const adsbPanelHtml = `
    <div class="g-panel">
      <div class="sec-head"><h3>ADS-B Live Feed</h3><span class="badge" id="adsbPanelBadge" style="${adsbMode?'color:var(--bg);background:var(--accent)':''}">${adsbMode?'LIVE':'STANDBY'}</span></div>
      <div style="margin:8px 0 6px">
        <button class="adsb-panel-btn${adsbMode?' active':''}" onclick="toggleADSB()">
          ${adsbMode?'&#9724;&nbsp;DEACTIVATE FEED':'&#9992;&nbsp;ACTIVATE LIVE FEED'}
        </button>
      </div>
      ${adsbMode && adsbAircraft.length ? `
      <div class="econ-row"><span class="elabel">Airborne</span><span class="eval" style="color:var(--accent)">${adsbAircraft.length.toLocaleString()}</span></div>
      <div class="econ-row"><span class="elabel">Military</span><span class="eval adsb-mil-count">${adsbMilCount.toLocaleString()}</span></div>
      <div class="econ-row"><span class="elabel">Civilian</span><span class="eval">${(adsbAircraft.length-adsbMilCount).toLocaleString()}</span></div>
      <div style="font-family:var(--mono);font-size:8px;color:var(--dim);margin-top:6px;line-height:1.4">ADS-B Exch · Global · 30s refresh</div>
      ` : adsbMode ? `<div style="font-family:var(--mono);font-size:9px;color:var(--dim);padding-top:4px">Loading aircraft data…</div>`
      : `<div style="font-family:var(--mono);font-size:9px;color:var(--dim);line-height:1.5;padding-top:2px">Overlay live global aircraft. Military signatures auto-flagged.</div>`}
    </div>`;
  document.getElementById('leftRail').innerHTML=`
    <div class="g-panel">
      <div class="sec-head"><h3>${t('panels.sensorGrid','Sensor Grid')}</h3><span class="badge">${t('badges.live','LIVE')}</span></div>
      ${layers.map(l=>`<div class="layer-item"><div class="layer-left"><div class="ldot ${l.dot}"></div><div><div class="layer-name">${l.name}</div><div class="layer-sub">${l.sub}</div></div></div><div class="layer-count">${l.count}</div></div>`).join('')}
    </div>
    ${adsbPanelHtml}
    <div class="g-panel">
      <div class="sec-head"><h3>${t('panels.nuclearWatch','Nuclear Watch')}</h3><span class="badge">${t('badges.radiation','RADIATION')}</span></div>
      <div class="nuke-ok">${allNormal?'&#9679; '+t('nuclear.allSitesNormal','ALL SITES NORMAL'):'&#9888; '+t('nuclear.anomalyDetected','ANOMALY DETECTED')}</div>
      ${nukeHtml}
    </div>
    <div class="g-panel">
      <div class="sec-head"><h3>${t('panels.riskGauges','Risk Gauges')}</h3><span class="badge">${t('badges.stress','STRESS')}</span></div>
      <div class="econ-row"><span class="elabel">${t('metrics.vix','VIX')} (Fear)</span><span class="eval" style="color:${vix?.value>20?'var(--warn)':'var(--accent)'}">${vix?.value||'--'}</span></div>
      <div class="econ-row"><span class="elabel">${t('metrics.hySpread','HY Spread')}</span><span class="eval">${hy?.value||'--'}</span></div>
      <div class="econ-row"><span class="elabel">${t('metrics.usdIndex','USD Index')}</span><span class="eval">${usd?.value?.toFixed(1)||'--'}</span></div>
      <div class="econ-row"><span class="elabel">${t('metrics.joblessClaims','Jobless Claims')}</span><span class="eval">${claims?.value?.toLocaleString()||'--'}</span></div>
      <div class="econ-row"><span class="elabel">${t('metrics.mortgage30y','30Y Mortgage')}</span><span class="eval">${mort?.value||'--'}%</span></div>
      <div class="econ-row"><span class="elabel">${t('metrics.m2Supply','M2 Supply')}</span><span class="eval">$${(m2?.value/1000)?.toFixed(1)||'--'}T</span></div>
      <div class="econ-row"><span class="elabel">${t('metrics.natDebt','Nat. Debt')}</span><span class="eval">$${(parseFloat(D.treasury.totalDebt)/1e12).toFixed(2)}T</span></div>
    </div>
    <div class="g-panel">
      <div class="sec-head"><h3>${t('panels.spaceWatch','Space Watch')}</h3><span class="badge">${t('badges.orbital','CELESTRAK')}</span></div>
      ${D.space ? `
        <div class="econ-row"><span class="elabel">New Objects (30d)</span><span class="eval" style="color:var(--accent2)">${D.space.totalNewObjects||0}</span></div>
        <div class="econ-row"><span class="elabel">Military Sats</span><span class="eval">${D.space.militarySats||0}</span></div>
        <div class="econ-row"><span class="elabel">Starlink</span><span class="eval">${D.space.constellations?.starlink||0}</span></div>
        <div class="econ-row"><span class="elabel">OneWeb</span><span class="eval">${D.space.constellations?.oneweb||0}</span></div>
        ${D.space.iss ? `<div class="econ-row"><span class="elabel">ISS</span><span class="eval" style="color:var(--accent)">ALT ${((D.space.iss.apogee+D.space.iss.perigee)/2).toFixed(0)} km</span></div>` : ''}
        ${Object.entries(D.space.militaryByCountry||{}).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([c,n])=>`<div class="econ-row"><span class="elabel" style="padding-left:8px">${c}</span><span class="eval" style="font-size:10px">${n} mil sats</span></div>`).join('')}
        ${(D.space.signals||[]).length ? `<div style="margin-top:6px;padding:6px 8px;border:1px solid rgba(68,204,255,0.2);background:rgba(68,204,255,0.04);font-family:var(--mono);font-size:9px;color:var(--accent2);line-height:1.5">${D.space.signals.slice(0,2).map(cleanUiText).join('<br>')}</div>` : ''}
      ` : '<div style="font-family:var(--mono);font-size:10px;color:var(--dim)">NO SPACE DATA</div>'}
    </div>`;
}

// === MAP ===
let mapLifecycleBound = false;

function bindMapLifecycleEvents(){
  if(mapLifecycleBound) return;
  mapLifecycleBound = true;
  window.addEventListener('resize', () => syncResponsiveLayout());
  window.addEventListener('orientationchange', () => setTimeout(() => syncResponsiveLayout(true), 150));
  document.addEventListener('visibilitychange', () => {
    if(!document.hidden) setTimeout(() => syncResponsiveLayout(true), 150);
  });
  window.addEventListener('pageshow', () => setTimeout(() => syncResponsiveLayout(true), 150));
}

function renderMapLegend(){
  document.getElementById('mapLegend').innerHTML=
    [{c:'#64f0c8',l:t('map.airTraffic','Air Traffic')},{c:'#ff5f63',l:t('map.thermalFire','Thermal/Fire')},{c:'rgba(255,120,80,0.8)',l:t('map.conflict','Conflict')},{c:'#44ccff',l:t('map.sdrReceiver','SDR Receiver')},
     {c:'#ffe082',l:t('map.nuclearSite','Nuclear Site')},{c:'#b388ff',l:t('map.chokepoint','Chokepoint')},{c:'#ffb84c',l:t('map.osintEvent','OSINT Event')},{c:'#69f0ae',l:t('map.healthAlert','Health Alert')},{c:'#81d4fa',l:t('map.worldNews','World News')},{c:'#ff9800',l:t('map.weatherAlert','Weather Alert')},{c:'#cddc39',l:t('map.epaRadNet','EPA RadNet')},{c:'#ffffff',l:t('map.spaceStation','Space Station')},{c:'#6495ed',l:t('map.gdeltEvent','GDELT Event')}]
    .map(x=>`<div class="leg-item"><div class="leg-dot" style="background:${x.c}"></div>${x.l}</div>`).join('');
}

function initMap(){
  bindMapLifecycleEvents();
  renderMapLegend();
  if(isFlat){
    if(globe && typeof globe.pauseAnimation === 'function') globe.pauseAnimation();
    document.getElementById('globeViz').style.display = 'none';
    document.getElementById('flatMapSvg').style.display = 'block';
    document.getElementById('projToggle').textContent = 'GLOBE MODE';
    document.getElementById('mapHint').textContent = 'SCROLL TO ZOOM · DRAG TO PAN';
    if(!flatSvg) initFlatMap();
    else { flatG.selectAll('*').remove(); drawFlatMap(); }
    setMapLoading(false);
    return;
  }
  setMapLoading(true, 'Initializing 3D Globe');
  requestAnimationFrame(() => {
    try {
      initGlobe();
      setMapLoading(false);
    } catch {
      isFlat = true;
      document.getElementById('globeViz').style.display = 'none';
      document.getElementById('flatMapSvg').style.display = 'block';
      document.getElementById('projToggle').textContent = 'GLOBE MODE';
      document.getElementById('mapHint').textContent = '3D LOAD FAILED · FLAT MODE';
      if(!flatSvg) initFlatMap();
      else { flatG.selectAll('*').remove(); drawFlatMap(); }
      setMapLoading(false);
    }
  });
}

function initGlobe(){
  if(globeInitialized && globe){
    if(typeof globe.resumeAnimation === 'function') globe.resumeAnimation();
    document.getElementById('globeViz').style.display = 'block';
    document.getElementById('flatMapSvg').style.display = 'none';
    document.getElementById('projToggle').textContent = 'FLAT MODE';
    document.getElementById('mapHint').textContent = 'DRAG TO ROTATE · SCROLL TO ZOOM';
    return;
  }
  const container = document.getElementById('mapContainer');
  const w = container.clientWidth;
  const h = container.clientHeight || 560;

  globe = Globe()
    .width(w)
    .height(h)
    .globeImageUrl('//unpkg.com/three-globe@2.33.0/example/img/earth-night.jpg')
    .bumpImageUrl('//unpkg.com/three-globe@2.33.0/example/img/earth-topology.png')
    .backgroundImageUrl('')
    .backgroundColor('rgba(0,0,0,0)')
    .atmosphereColor('#64f0c8')
    .atmosphereAltitude(0.18)
    .showGraticules(true)
    // Points layer (main markers)
    .pointAltitude(d => d.alt || 0.01)
    .pointRadius(d => d.size || 0.3)
    .pointColor(d => d.color)
    .pointLabel(d => `<b>${d.popHead||''}</b><br><span style="opacity:0.7">${d.popMeta||''}</span>`)
    .onPointClick((pt, ev) => { showPopup(ev, pt.popHead, pt.popText, pt.popMeta, pt.lat, pt.lng, pt.alt); })
    .onPointHover(pt => { document.getElementById('globeViz').style.cursor = pt ? 'pointer' : 'grab'; })
    // Arcs layer (flight corridors)
    .arcColor(d => d.color)
    .arcStroke(d => d.stroke || 0.4)
    .arcDashLength(0.4)
    .arcDashGap(0.2)
    .arcDashAnimateTime(2000)
    .arcAltitudeAutoScale(0.3)
    .arcLabel(d => d.label || '')
    // Rings layer (pulsing conflict events)
    .ringColor(d => t => `rgba(255,120,80,${1-t})`)
    .ringMaxRadius(d => d.maxR || 3)
    .ringPropagationSpeed(d => d.speed || 2)
    .ringRepeatPeriod(d => d.period || 800)
    // Labels layer
    .labelText(d => d.text)
    .labelSize(d => d.size || 0.4)
    .labelColor(d => d.color || 'rgba(106,138,130,0.9)')
    .labelDotRadius(0)
    .labelAltitude(0.012)
    .labelResolution(2)
    (document.getElementById('globeViz'));

  // Style the WebGL scene
  const scene = globe.scene();
  const renderer = globe.renderer();
  renderer.setClearColor(0x000000, 0);

  // Add subtle stars background
  const starGeom = new THREE.BufferGeometry();
  const starVerts = [];
  for(let i=0; i<2000; i++){
    const r = 800 + Math.random()*200;
    const theta = Math.random()*Math.PI*2;
    const phi = Math.acos(2*Math.random()-1);
    starVerts.push(r*Math.sin(phi)*Math.cos(theta), r*Math.sin(phi)*Math.sin(theta), r*Math.cos(phi));
  }
  starGeom.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
  const starMat = new THREE.PointsMaterial({color:0x88bbaa, size:0.8, transparent:true, opacity:0.6});
  scene.add(new THREE.Points(starGeom, starMat));

  // Customize graticule color
  scene.traverse(obj => {
    if(obj.material && obj.type === 'Line'){
      obj.material.color.set(0x1a3a2a);
      obj.material.opacity = 0.3;
      obj.material.transparent = true;
    }
  });

  // Set initial POV
  globe.pointOfView(regionPOV.world, 0);

  // Auto-rotate slowly
  globe.controls().autoRotate = !lowPerfMode;
  globe.controls().autoRotateSpeed = 0.3;
  globe.controls().enableDamping = true;
  globe.controls().dampingFactor = 0.1;

  // Stop auto-rotate on interaction, resume after 10s
  let rotateTimeout;
  const el = document.getElementById('globeViz');
  el.addEventListener('mousedown', () => {
    globe.controls().autoRotate = false;
    clearTimeout(rotateTimeout);
  });
  el.addEventListener('mouseup', () => {
    rotateTimeout = setTimeout(() => { if(globe && !lowPerfMode) globe.controls().autoRotate = true; }, 10000);
  });

  // Plot globe markers (preloaded but hidden)
  plotMarkers();

  // Start in flat mode — hide globe, show flat map
  if(isFlat){
    document.getElementById('globeViz').style.display = 'none';
    document.getElementById('flatMapSvg').style.display = 'block';
    initFlatMap();
  } else {
    document.getElementById('globeViz').style.display = 'block';
    document.getElementById('flatMapSvg').style.display = 'none';
    document.getElementById('projToggle').textContent = 'FLAT MODE';
    document.getElementById('mapHint').textContent = 'DRAG TO ROTATE · SCROLL TO ZOOM';
  }

  globeInitialized = true;
}

function plotMarkers(){
  if(!globe) return;
  const points = [];
  const labels = [];

  // === Air hotspots (green) ===
  const airCoords=[{lat:30,lon:44},{lat:24,lon:120},{lat:49,lon:32},{lat:57,lon:24},{lat:14,lon:114},{lat:37,lon:127},{lat:25,lon:-80},{lat:4,lon:2},{lat:-34,lon:18},{lat:10,lon:51}];
  if(flightsVisible) D.air.forEach((a,i)=>{
    const c=airCoords[i]; if(!c) return;
    points.push({
      lat:c.lat, lng:c.lon, size:0.25+a.total/200, alt:0.015,
      color:'rgba(100,240,200,0.8)', type:'air', priority:1,
      label: a.region.replace(' Region','')+' '+a.total,
      popHead: a.region, popMeta: 'Air Activity',
      popText: `${a.total} aircraft tracked<br>No callsign: ${a.noCallsign}<br>High altitude: ${a.highAlt}<br>Top: ${a.top.slice(0,3).map(t=>t[0]+' ('+t[1]+')').join(', ')}`
    });
    labels.push({lat:c.lat, lng:c.lon+2, text:a.region.replace(' Region','')+' '+a.total, size:0.35, color:'rgba(106,138,130,0.8)'});
  });

  // === Thermal/fire (red) ===
  D.thermal.forEach(t=>{
    t.fires.forEach(f=>{
      points.push({
        lat:f.lat, lng:f.lon, size:0.12+Math.min(f.frp/200,0.3), alt:0.008,
        color:'rgba(255,95,99,0.7)', type:'thermal', priority:3,
        popHead:'Thermal Detection', popMeta:'FIRMS Satellite',
        popText:`Region: ${t.region}<br>FRP: ${f.frp.toFixed(1)} MW<br>Total: ${t.det.toLocaleString()}<br>Night: ${t.night.toLocaleString()}`
      });
    });
  });

  // === Maritime chokepoints (purple) ===
  D.chokepoints.forEach(cp=>{
    points.push({
      lat:cp.lat, lng:cp.lon, size:0.35, alt:0.02,
      color:'rgba(179,136,255,0.8)', type:'maritime', priority:1,
      popHead:cp.label, popMeta:'Maritime Intelligence', popText:cp.note
    });
    labels.push({lat:cp.lat, lng:cp.lon+1.5, text:cp.label, size:0.3, color:'rgba(179,136,255,0.6)'});
  });

  // === Nuclear sites (yellow) ===
  const nukeCoords=[{lat:47.5,lon:34.6},{lat:51.4,lon:30.1},{lat:28.8,lon:50.9},{lat:39.8,lon:125.8},{lat:37.4,lon:141},{lat:31.0,lon:35.1}];
  D.nuke.forEach((n,i)=>{
    const c=nukeCoords[i]; if(!c) return;
    points.push({
      lat:c.lat, lng:c.lon, size:0.3, alt:0.012,
      color: n.anom ? 'rgba(255,95,99,0.9)' : 'rgba(255,224,130,0.8)', type:'nuke', priority:2,
      popHead:n.site, popMeta:'Radiation Monitoring',
      popText:`Status: ${n.anom?'ANOMALY':'Normal'}<br>Avg CPM: ${n.cpm?.toFixed(1)||'No data'}<br>Readings: ${n.n}`
    });
  });

  // === SDR receivers (cyan) ===
  D.sdr.zones.forEach(z=>{
    z.receivers.forEach(r=>{
      points.push({
        lat:r.lat, lng:r.lon, size:0.15, alt:0.005,
        color:'rgba(68,204,255,0.6)', type:'sdr', priority:3,
        popHead:'SDR Receiver', popMeta:'KiwiSDR Network',
        popText:`${r.name}<br>Zone: ${z.region}<br>${z.count} in zone`
      });
    });
  });

  // === OSINT events from Telegram (orange) ===
  const osintGeo=[{lat:45,lon:41,idx:0},{lat:48,lon:37,idx:1},{lat:48.5,lon:37.5,idx:2},{lat:45,lon:40.2,idx:3},{lat:50.6,lon:36.6,idx:5},{lat:48.5,lon:35,idx:6}];
  osintGeo.forEach(o=>{
    const post=D.tg.urgent[o.idx]; if(!post) return;
    points.push({
      lat:o.lat, lng:o.lon, size:0.3, alt:0.018,
      color:'rgba(255,184,76,0.8)', type:'osint', priority:2,
      popHead:(post.channel||'').toUpperCase(), popMeta:`${post.views?.toLocaleString()||'?'} views`,
      popText:cleanText(post.text?.substring(0,200)||'')
    });
  });

  // === WHO health alerts (green) ===
  const whoGeo=[{lat:0.3,lon:32.6},{lat:-6.2,lon:106.8},{lat:-4.3,lon:15.3},{lat:35,lon:105},{lat:12.5,lon:105},{lat:35,lon:105},{lat:28,lon:84},{lat:24,lon:45},{lat:30,lon:70},{lat:-0.8,lon:11.6}];
  D.who.slice(0,10).forEach((w,i)=>{
    const c=whoGeo[i]; if(!c) return;
    points.push({
      lat:c.lat, lng:c.lon, size:0.25, alt:0.01,
      color:'rgba(105,240,174,0.7)', type:'health', priority:2,
      popHead:w.title, popMeta:'WHO Outbreak', popText:w.summary||''
    });
  });

  // === News markers (light blue) ===
  (D.news||[]).forEach(n=>{
    points.push({
      lat:n.lat, lng:n.lon, size:0.2, alt:0.008,
      color:'rgba(129,212,250,0.7)', type:'news', priority:3,
      popHead:n.source+' NEWS', popMeta:n.region+' · '+getAge(n.date),
      popText:cleanText(n.title)
    });
  });

  // === NOAA severe weather alerts (orange) ===
  (D.noaa?.alerts||[]).forEach(a=>{
    points.push({
      lat:a.lat, lng:a.lon, size:0.22, alt:0.01,
      color:'rgba(255,152,0,0.8)', type:'weather', priority:2,
      popHead:a.event, popMeta:'NOAA/NWS · '+a.severity,
      popText:a.headline||''
    });
  });

  // === EPA RadNet stations (lime green) ===
  (D.epa?.stations||[]).forEach(s=>{
    points.push({
      lat:s.lat, lng:s.lon, size:0.18, alt:0.006,
      color:'rgba(205,220,57,0.7)', type:'radiation', priority:3,
      popHead:'RadNet: '+s.location, popMeta:'EPA Radiation Monitor',
      popText:`${s.analyte||'--'}: ${s.result||'--'} ${s.unit||''}<br>State: ${s.state}`
    });
  });

  // === ISS + Space Stations (bright white, pulsing) ===
  (D.space?.stationPositions||[]).forEach(s=>{
    points.push({
      lat:s.lat, lng:s.lon, size:0.4, alt:0.04,
      color:'rgba(255,255,255,0.95)', type:'space', priority:1,
      popHead:s.name, popMeta:'Space Station (approx.)',
      popText:`Orbital position estimate<br>Lat: ${s.lat}° Lon: ${s.lon}°`
    });
    labels.push({lat:s.lat, lng:s.lon+3, text:s.name.split('(')[0].trim(), size:0.35, color:'rgba(255,255,255,0.7)'});
  });

  // === GDELT geo events (steel blue) ===
  (D.gdelt?.geoPoints||[]).forEach(g=>{
    points.push({
      lat:g.lat, lng:g.lon, size:0.15+Math.min(g.count/50,0.2), alt:0.007,
      color:'rgba(100,149,237,0.6)', type:'gdelt', priority:3,
      popHead:'GDELT Event', popMeta:g.count+' reports',
      popText:g.name||'Global event detection'
    });
  });

  // Set points on globe
  globe.pointsData(points);
  globe.labelsData(labels);

  // === ACLED CONFLICT EVENTS (pulsing rings) ===
  const conflictRings = (D.acled?.deadliestEvents || []).filter(e => e.lat && e.lon).map(e => {
    const logFatal = Math.log2(Math.max(e.fatalities, 1));
    return {
      lat: e.lat, lng: e.lon,
      maxR: Math.max(2, Math.min(6, 1 + logFatal)),
      speed: 1.5 + Math.random(),
      period: 600 + Math.random()*600,
      popHead: e.type || 'CONFLICT', popMeta: 'ACLED Conflict Data',
      popText: `${e.fatalities} fatalities<br>${e.location}, ${e.country}<br>Date: ${e.date}`
    };
  });
  globe.ringsData(conflictRings);

  // === FLIGHT CORRIDORS (3D arcs) ===
  const arcs = [];
  if(flightsVisible){
  const airCoordsFlight = [
    {region:'Middle East',lat:30,lon:44}, {region:'Taiwan Strait',lat:24,lon:120},
    {region:'Ukraine Region',lat:49,lon:32}, {region:'Baltic Region',lat:57,lon:24},
    {region:'South China Sea',lat:14,lon:114}, {region:'Korean Peninsula',lat:37,lon:127},
    {region:'Caribbean',lat:25,lon:-80}, {region:'Gulf of Guinea',lat:4,lon:2},
    {region:'Cape Route',lat:-34,lon:18}, {region:'Horn of Africa',lat:10,lon:51}
  ];
  const globalHubs = [
    {lat:40.6,lon:-73.8},{lat:51.5,lon:-0.5},{lat:25.3,lon:55.4},
    {lat:1.4,lon:103.8},{lat:-33.9,lon:151.2},{lat:-23.4,lon:-46.5}
  ];
  // Inter-hotspot corridors
  for(let i=0; i<D.air.length; i++){
    for(let j=i+1; j<D.air.length; j++){
      const a=D.air[i], b=D.air[j];
      const from=airCoordsFlight[i], to=airCoordsFlight[j];
      if(!from||!to) continue;
      const traffic=a.total+b.total;
      if(traffic<30) continue;
      const ncRatio=(a.noCallsign+b.noCallsign)/Math.max(traffic,1);
      const color = ncRatio>0.15 ? ['rgba(255,95,99,0.6)','rgba(255,95,99,0.15)'] :
                    ncRatio>0.05 ? ['rgba(255,184,76,0.5)','rgba(255,184,76,0.1)'] :
                                   ['rgba(100,240,200,0.4)','rgba(100,240,200,0.08)'];
      arcs.push({
        startLat:from.lat, startLng:from.lon, endLat:to.lat, endLng:to.lon,
        color, stroke:Math.max(0.3, Math.min(1.2, traffic/120)),
        label:`${from.region} ↔ ${to.region}: ${traffic} aircraft`
      });
    }
  }
  // Hub corridors
  D.air.forEach((a,i)=>{
    if(!airCoordsFlight[i]||a.total<25) return;
    globalHubs.forEach(hub=>{
      const dLat=Math.abs(airCoordsFlight[i].lat-hub.lat);
      const dLon=Math.abs(airCoordsFlight[i].lon-hub.lon);
      if(dLat+dLon<20) return;
      arcs.push({
        startLat:airCoordsFlight[i].lat, startLng:airCoordsFlight[i].lon,
        endLat:hub.lat, endLng:hub.lon,
        color:['rgba(100,240,200,0.2)','rgba(100,240,200,0.05)'],
        stroke:0.3
      });
    });
  });
  }
  globe.arcsData(arcs);

  // Zoom-aware marker sizing: scale markers and labels with camera altitude
  const onGlobeZoom = () => {
    const alt = globe.pointOfView().altitude;
    const sf = Math.max(0.6, Math.min(2.5, 1.5 / alt));
    globe.pointRadius(d => (d.size || 0.3) * sf);
    // Hide labels when zoomed far out to reduce clutter
    const showLabels = alt < 1.8;
    globe.labelSize(d => showLabels ? (d.size || 0.4) : 0);
    // Scale arc strokes with zoom
    globe.arcStroke(d => (d.stroke || 0.4) * Math.max(0.5, Math.min(1.5, 1.2 / alt)));
    globe.arcDashAnimateTime(lowPerfMode ? 0 : 2000);
    // Priority-based point visibility: hide low-priority markers when zoomed out
    if(alt > 2.0){
      globe.pointsData(points.filter(p => (p.priority||3) <= 1));
    } else if(alt > 1.2){
      globe.pointsData(points.filter(p => (p.priority||3) <= 2));
    } else {
      globe.pointsData(points);
    }
  };
  if(typeof globe.onZoom==='function') globe.onZoom(onGlobeZoom);
}

function showPopup(event,head,text,meta,lat,lng,alt){
  const popup=document.getElementById('mapPopup');
  const container=document.getElementById('mapContainer');
  const rect=container.getBoundingClientRect();
  let left, top;
  if(!isFlat && lat!=null && globe && typeof globe.getScreenCoords==='function'){
    const sc=globe.getScreenCoords(lat,lng,alt||0.01);
    if(!sc||isNaN(sc.x)||isNaN(sc.y)||sc.x<0||sc.y<0||sc.x>rect.width||sc.y>rect.height){
      if(event&&event.clientX!=null){left=event.clientX-rect.left+10;top=event.clientY-rect.top-10;}
      else return;
    } else {left=sc.x+10;top=sc.y-10;}
  } else if(event && event.clientX != null){
    left=event.clientX - rect.left + 10;
    top=event.clientY - rect.top - 10;
  } else {
    left=rect.width/2 - 140; top=rect.height/2 - 60;
  }
  if(left+290>rect.width) left=left-300;
  if(top+150>rect.height) top=top-160;
  if(left<0) left=10;
  if(top<0) top=10;
  popup.style.left=left+'px';popup.style.top=top+'px';
  popup.querySelector('.pp-head').textContent=head||'';
  popup.querySelector('.pp-text').innerHTML=text||'';
  popup.querySelector('.pp-meta').textContent=meta||'';
  popup.classList.add('show');
}
function closePopup(){document.getElementById('mapPopup').classList.remove('show')}

// === MAP CONTROLS ===
function toggleFlights() {
  flightsVisible = !flightsVisible;
  const btn = document.getElementById('flightToggle');
  btn.classList.toggle('off', !flightsVisible);
  if(isFlat){
    if(flatG){
      flatG.selectAll('*').remove();
      drawFlatMap();
    }
    return;
  }
  if(!globe){
    return;
  }
  if(flightsVisible) {
    plotMarkers(); // re-render with arcs
  } else {
    globe.arcsData([]); // hide arcs
    // Remove air-type points
    const pts = globe.pointsData().filter(p => p.type !== 'air');
    globe.pointsData(pts);
    const lbls = globe.labelsData().filter(l => l.text && !l.text.match(/\d+$/));
    globe.labelsData(lbls);
  }
}

// === FLAT/GLOBE TOGGLE ===
const flatRegionBounds = {
  world:[[-180,-60],[180,80]], americas:[[-130,10],[-60,55]], europe:[[-12,34],[45,72]],
  middleEast:[[24,10],[65,45]], asiaPacific:[[60,-12],[180,55]], africa:[[-20,-36],[55,38]]
};

function toggleMapMode(){
  if(aircraftMode) toggleAircraftMode(false);
  isFlat = !isFlat;
  const btn = document.getElementById('projToggle');
  const hint = document.getElementById('mapHint');
  btn.textContent = isFlat ? 'GLOBE MODE' : 'FLAT MODE';
  hint.textContent = isFlat ? 'SCROLL TO ZOOM · DRAG TO PAN' : 'DRAG TO ROTATE · SCROLL TO ZOOM';
  const globeEl = document.getElementById('globeViz');
  const flatEl = document.getElementById('flatMapSvg');
  const aircraftEl = document.getElementById('aircraftFrame');
  if(aircraftEl) aircraftEl.style.display = 'none';
  if(isFlat){
    if(globe && typeof globe.pauseAnimation === 'function') globe.pauseAnimation();
    globeEl.style.display = 'none';
    flatEl.style.display = 'block';
    setMapLoading(false);
    if(!flatSvg) initFlatMap();
    else { flatG.selectAll('*').remove(); drawFlatMap(); }
    if(adsbMode && adsbAircraft.length) renderADSBFlat(adsbAircraft);
  } else {
    flatEl.style.display = 'none';
    setMapLoading(true, 'Initializing 3D Globe');
    requestAnimationFrame(() => {
      try {
        initGlobe();
        if(globe && typeof globe.resumeAnimation === 'function') globe.resumeAnimation();
        globeEl.style.display = 'block';
        setMapLoading(false);
        if(adsbMode && adsbAircraft.length) renderADSBGlobe(adsbAircraft);
      } catch {
        isFlat = true;
        globeEl.style.display = 'none';
        flatEl.style.display = 'block';
        btn.textContent = 'GLOBE MODE';
        hint.textContent = '3D LOAD FAILED · FLAT MODE';
        if(!flatSvg) initFlatMap();
        else { flatG.selectAll('*').remove(); drawFlatMap(); }
        setMapLoading(false);
      }
    });
  }
}

function toggleAircraftMode(force){
  if(!D.airMeta?.tar1090?.available) return;
  aircraftMode = typeof force === 'boolean' ? force : !aircraftMode;
  const frame = document.getElementById('aircraftFrame');
  const globeEl = document.getElementById('globeViz');
  const flatEl = document.getElementById('flatMapSvg');
  const hint = document.getElementById('mapHint');
  const projBtn = document.getElementById('projToggle');
  const aircraftBtn = document.getElementById('aircraftToggle');
  if(aircraftBtn) {
    aircraftBtn.style.display = 'inline-flex';
    aircraftBtn.textContent = aircraftMode ? 'RETURN TO MAP' : 'AIRCRAFT';
  }
  if(!frame) return;
  if(aircraftMode){
    if(!frame.src) frame.src = D.airMeta.tar1090.url;
    frame.style.display = 'block';
    globeEl.style.display = 'none';
    flatEl.style.display = 'none';
    hint.textContent = 'LIVE AIRCRAFT VIEW';
    if(projBtn) projBtn.style.display = 'none';
    setMapLoading(false);
    return;
  }
  frame.style.display = 'none';
  if(projBtn) projBtn.style.display = 'inline-flex';
  hint.textContent = isFlat ? 'SCROLL TO ZOOM · DRAG TO PAN' : 'DRAG TO ROTATE · SCROLL TO ZOOM';
  if(isFlat){
    flatEl.style.display = 'block';
    globeEl.style.display = 'none';
    if(!flatSvg) initFlatMap();
    else { flatG.selectAll('*').remove(); drawFlatMap(); }
  } else {
    globeEl.style.display = 'block';
    flatEl.style.display = 'none';
    if(globe && typeof globe.resumeAnimation === 'function') globe.resumeAnimation();
  }
}

// === ADS-B LIVE AIRCRAFT ===
const ADSB_MIL_CALLSIGNS = [
  /^RCH\d/,/^REACH\d/,/^DUKE\d/,/^NAVY\d/,/^ARMY\d/,/^USAF\d/,
  /^SAM\d/,/^AIR\d/,/^PAT\d/,/^VENUS\d/,/^IRON\d/,/^HOMER\d/,
  /^WOLF\d/,/^COBRA\d/,/^VIPER\d/,/^HAWK\d/,/^EAGLE\d/,/^JOLLY\d/,
  /^STING\d/,/^MAGMA\d/,/^MOOSE\d/,/^MYSTIC\d/,/^EVAD\d/,/^SKILL\d/,
  /^ROCKY\d/,/^TOPAZ/,/^SPAR\d/,/^CNV\d/,/^FORD\d/,/^BRONCO/
];
const ADSB_MIL_HEX = [
  [0xAE0000,0xAFFFFF],[0x43C000,0x43FFFF],[0x440000,0x447FFF],
  [0x448000,0x44FFFF],[0x3E0000,0x3EFFFF],[0x3A8000,0x3AFFFF]
];

function isMilitaryADSB(icao24, callsign) {
  const cs = (callsign || '').trim().toUpperCase();
  if (ADSB_MIL_CALLSIGNS.some(p => p.test(cs))) return true;
  const hex = parseInt(icao24, 16);
  if (!isNaN(hex)) {
    if (ADSB_MIL_HEX.some(([lo, hi]) => hex >= lo && hex <= hi)) return true;
  }
  return false;
}

async function fetchADSBData() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch('/api/adsb', { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !Array.isArray(json.ac)) return null;
    // Filter: must have lat/lon, airborne (alt_baro > 200 ft or alt_geom > 200 ft)
    let ac = json.ac.filter(a => a.lat != null && a.lon != null &&
      ((a.alt_baro != null && a.alt_baro !== 'ground' && Number(a.alt_baro) > 200) ||
       (a.alt_geom != null && Number(a.alt_geom) > 200)));
    // Cap at 4000, prioritize military (dbFlags & 1 = military in adsb.lol)
    const mil = ac.filter(a => (a.dbFlags & 1) || isMilitaryADSB(a.hex, a.flight));
    const civ = ac.filter(a => !((a.dbFlags & 1) || isMilitaryADSB(a.hex, a.flight)));
    const civCapped = civ.slice(0, Math.max(0, 4000 - mil.length));
    ac = [...mil, ...civCapped];
    return ac.map(a => ({
      icao24:   a.hex,
      callsign: (a.flight || '').trim() || a.hex,
      country:  a.r || '?',          // registration prefix (e.g. N, G-, etc.)
      lon:      a.lon,
      lat:      a.lat,
      alt:      a.alt_baro != null ? Math.round(a.alt_baro) : null, // feet
      speed:    a.gs != null ? Math.round(a.gs) : null,             // knots
      heading:  a.track,
      military: !!(a.dbFlags & 1) || isMilitaryADSB(a.hex, a.flight)
    }));
  } catch { return null; }
}

function renderADSBGlobe(aircraft) {
  if (!globe || !aircraft) return;
  globe.arcsData([]); // hide flight corridors while ADS-B is active
  const base = globe.pointsData().filter(p => p._adsb !== true);
  const pts = aircraft.map(a => ({
    lat: a.lat, lng: a.lon,
    size: a.military ? 0.28 : 0.14,
    // alt_ft → globe altitude fraction: 35000ft cruise ≈ 0.02, surface ≈ 0.008
    alt: 0.008 + Math.min((a.alt || 0) / 2500000, 0.025),
    color: a.military ? 'rgba(255,80,80,0.95)' : 'rgba(0,255,220,0.55)',
    type: 'adsb', _adsb: true,
    popHead: (a.military ? '[MIL] ' : '') + a.callsign,
    popMeta: `${a.country} · ${a.alt != null ? a.alt.toLocaleString() + ' ft' : '?'} · ${a.speed != null ? a.speed + ' kt' : '?'}`,
    popText: `ICAO: ${a.icao24}<br>Alt: ${a.alt != null ? a.alt.toLocaleString() + ' ft' : 'unknown'}<br>Speed: ${a.speed != null ? a.speed + ' kt' : 'unknown'}<br>Heading: ${a.heading != null ? Math.round(a.heading) + '°' : '?'}`
  }));
  globe.pointsData([...base, ...pts]);
}

function renderADSBFlat(aircraft) {
  if (!flatG || !aircraft) return;
  flatG.select('.adsb-layer').remove();
  const layer = flatG.append('g').attr('class', 'adsb-layer');
  const proj = flatProjection;
  // Show all military + capped civilian to avoid blob at world zoom
  const mil = aircraft.filter(a => a.military);
  const civ = aircraft.filter(a => !a.military).slice(0, 800);
  const visible = [...mil, ...civ];
  visible.forEach(a => {
    const xy = proj([a.lon, a.lat]);
    if (!xy || !xy[0] || !xy[1]) return;
    const [x, y] = xy;
    const g = layer.append('g').attr('transform', `translate(${x},${y})`).style('cursor', 'pointer');
    g.on('click', ev => {
      ev.stopPropagation();
      showPopup(ev,
        (a.military ? '[MIL] ' : '') + a.callsign,
        `ICAO: ${a.icao24}<br>Alt: ${a.alt != null ? a.alt.toLocaleString() + ' ft' : 'unknown'}<br>Speed: ${a.speed != null ? a.speed + ' kt' : 'unknown'}<br>Heading: ${a.heading != null ? Math.round(a.heading) + '°' : '?'}`,
        a.country
      );
    });
    const r = a.military ? 3.5 : 1.8;
    const fill = a.military ? 'rgba(255,80,80,0.9)' : 'rgba(0,255,220,0.45)';
    const stroke = a.military ? 'rgba(255,80,80,0.5)' : 'rgba(0,255,220,0.15)';
    g.append('circle').attr('r', r).attr('fill', fill).attr('stroke', stroke).attr('stroke-width', 0.5);
    // Heading line for military only
    if (a.military && a.heading != null) {
      const rad = (a.heading - 90) * Math.PI / 180;
      g.append('line').attr('x1', 0).attr('y1', 0)
        .attr('x2', Math.cos(rad) * 9).attr('y2', Math.sin(rad) * 9)
        .attr('stroke', 'rgba(255,120,80,0.7)').attr('stroke-width', 1);
    }
  });
}

function updateADSBPanel() {
  const panel = document.querySelector('#leftRail .g-panel:nth-child(2)');
  if (!panel) return; // panel not rendered yet
  const milCount = adsbAircraft.filter(a => a.military).length;
  const badge = document.getElementById('adsbPanelBadge');
  if (badge) { badge.textContent = adsbMode ? 'LIVE' : 'STANDBY'; badge.style.cssText = adsbMode ? 'color:var(--bg);background:var(--accent)' : ''; }
  // Update stats rows if they exist
  const rows = panel.querySelectorAll('.econ-row .eval');
  if (rows.length >= 3 && adsbAircraft.length) {
    rows[0].textContent = adsbAircraft.length.toLocaleString();
    rows[1].textContent = milCount.toLocaleString();
    rows[2].textContent = (adsbAircraft.length - milCount).toLocaleString();
  } else if (adsbMode) {
    // Re-render left rail to show stats once data arrives
    renderLeftRail();
  }
}

async function refreshADSB() {
  const btn = document.getElementById('adsbToggle');
  if (btn) btn.textContent = 'ADS-B …';
  const data = await fetchADSBData();
  if (!adsbMode) return; // turned off while fetching
  if (data) {
    adsbAircraft = data;
    const milCount = data.filter(a => a.military).length;
    if (btn) btn.textContent = `ADS-B ${data.length} (${milCount} MIL)`;
    if (!isFlat) renderADSBGlobe(data);
    else renderADSBFlat(data);
    updateADSBPanel();
  } else {
    if (btn) btn.textContent = 'ADS-B ERR';
  }
}

function toggleADSB() {
  adsbMode = !adsbMode;
  const btn = document.getElementById('adsbToggle');
  if (!adsbMode) {
    // Deactivate
    if (adsbInterval) { clearInterval(adsbInterval); adsbInterval = null; }
    adsbAircraft = [];
    if (btn) { btn.textContent = 'ADS-B'; btn.classList.remove('active'); }
    // Remove ADS-B points from globe, restore arcs
    if (!isFlat && globe) {
      globe.pointsData(globe.pointsData().filter(p => p._adsb !== true));
      if (flightsVisible) plotMarkers(); // restore arcs
    }
    if (isFlat && flatG) {
      flatG.select('.adsb-layer').remove();
    }
    renderLeftRail();
    return;
  }
  // Activate
  if (btn) btn.classList.add('active');
  renderLeftRail();
  // Hide flight arcs while ADS-B is active on globe
  if (!isFlat && globe) globe.arcsData([]);
  refreshADSB();
  adsbInterval = setInterval(refreshADSB, 30000);
}

function initFlatMap(){
  const container = document.getElementById('mapContainer');
  flatW = container.clientWidth; flatH = container.clientHeight || 560;
  flatSvg = d3.select('#flatMapSvg').attr('viewBox',`0 0 ${flatW} ${flatH}`).attr('preserveAspectRatio','xMidYMid meet');
  flatProjection = d3.geoNaturalEarth1().fitSize([flatW-20,flatH-20],{type:'Sphere'}).translate([flatW/2,flatH/2]);
  flatPath = d3.geoPath(flatProjection);
  flatG = flatSvg.append('g');
  flatZoom = d3.zoom().scaleExtent([1,12]).on('zoom',(event)=>{
    flatG.attr('transform',event.transform);
    const k=event.transform.k;
    flatG.selectAll('.marker-circle').attr('r',function(){return +this.dataset.baseR/Math.sqrt(k)});
    flatG.selectAll('.marker-label').style('font-size',Math.max(7,9/Math.sqrt(k))+'px')
      .style('display',k>=2.5?'block':'none');
  });
  flatSvg.call(flatZoom);
  drawFlatMap();
}

function drawFlatMap(){
  flatG.append('path').datum(d3.geoGraticule()()).attr('class','graticule').attr('d',flatPath);
  fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
    .then(r=>r.json()).then(world=>{
      const countries=topojson.feature(world,world.objects.countries);
      flatG.selectAll('path.land').data(countries.features).enter().append('path').attr('class','land').attr('d',flatPath);
      flatG.append('path').datum(topojson.mesh(world,world.objects.countries,(a,b)=>a!==b)).attr('class','border').attr('d',flatPath);
      plotFlatMarkers();
    });
}

function plotFlatMarkers(){
  const mg=flatG.append('g').attr('class','markers');
  const proj=flatProjection;
  const addPt=(lat,lon,r,fill,stroke,onClick,priority)=>{
    const[x,y]=proj([lon,lat]);if(!x||!y)return null;
    const g=mg.append('g').attr('transform',`translate(${x},${y})`).style('cursor','pointer').attr('data-priority',priority||3);
    if(onClick) g.on('click',ev=>{ev.stopPropagation();onClick(ev)});
    g.append('circle').attr('class','marker-circle').attr('r',r).attr('data-base-r',r).attr('fill',fill).attr('stroke',stroke).attr('stroke-width',0.8);
    return g;
  };
  // Air
  const airCoords=[{lat:30,lon:44},{lat:24,lon:120},{lat:49,lon:32},{lat:57,lon:24},{lat:14,lon:114},{lat:37,lon:127},{lat:25,lon:-80},{lat:4,lon:2},{lat:-34,lon:18},{lat:10,lon:51}];
  if(flightsVisible){
    D.air.forEach((a,i)=>{
      const c=airCoords[i];if(!c)return;
      const g=addPt(c.lat,c.lon,4+a.total/40,'rgba(100,240,200,0.7)','rgba(100,240,200,0.3)',
        ev=>showPopup(ev,a.region,`${a.total} aircraft<br>No callsign: ${a.noCallsign}<br>High alt: ${a.highAlt}`,'Air Activity'),1);
      if(g) g.append('text').attr('class','marker-label').attr('x',10).attr('y',3).attr('fill','var(--dim)').attr('font-size','9px').attr('font-family','var(--mono)').text(a.region.replace(' Region','')+' '+a.total);
    });
  }
  // Thermal
  D.thermal.forEach(t=>t.fires.forEach(f=>{
    addPt(f.lat,f.lon,2+Math.min(f.frp/50,5),'rgba(255,95,99,0.6)','rgba(255,95,99,0.2)',
      ev=>showPopup(ev,'Thermal',`${t.region}<br>FRP: ${f.frp.toFixed(1)} MW`,'FIRMS'),3);
  }));
  // Chokepoints
  D.chokepoints.forEach(cp=>{
    const[x,y]=proj([cp.lon,cp.lat]);if(!x||!y)return;
    const g=mg.append('g').attr('transform',`translate(${x},${y})`).style('cursor','pointer').attr('data-priority',1)
      .on('click',ev=>{ev.stopPropagation();showPopup(ev,cp.label,cp.note,'Maritime')});
    g.append('rect').attr('x',-4).attr('y',-4).attr('width',8).attr('height',8).attr('fill','rgba(179,136,255,0.7)').attr('stroke','rgba(179,136,255,0.3)').attr('stroke-width',0.5).attr('transform','rotate(45)');
    g.append('text').attr('class','marker-label').attr('x',8).attr('y',3).attr('fill','var(--dim)').attr('font-size','8px').attr('font-family','var(--mono)').text(cp.label);
  });
  // Nuclear
  const nukeCoords=[{lat:47.5,lon:34.6},{lat:51.4,lon:30.1},{lat:28.8,lon:50.9},{lat:39.8,lon:125.8},{lat:37.4,lon:141},{lat:31.0,lon:35.1}];
  D.nuke.forEach((n,i)=>{const c=nukeCoords[i];if(!c)return;addPt(c.lat,c.lon,4,'rgba(255,224,130,0.7)','rgba(255,224,130,0.3)',ev=>showPopup(ev,n.site,`CPM: ${n.cpm?.toFixed(1)||'--'}`,'Radiation'),2)});
  // SDR
  D.sdr.zones.forEach(z=>z.receivers.forEach(r=>{addPt(r.lat,r.lon,2.5,'rgba(68,204,255,0.5)','rgba(68,204,255,0.2)',ev=>showPopup(ev,'SDR',`${r.name}<br>${z.region}`,'KiwiSDR'),3)}));
  // OSINT
  const osintGeo=[{lat:45,lon:41,idx:0},{lat:48,lon:37,idx:1},{lat:48.5,lon:37.5,idx:2},{lat:45,lon:40.2,idx:3},{lat:50.6,lon:36.6,idx:5},{lat:48.5,lon:35,idx:6}];
  osintGeo.forEach(o=>{const p=D.tg.urgent[o.idx];if(!p)return;addPt(o.lat,o.lon,4,'rgba(255,184,76,0.7)','rgba(255,184,76,0.3)',ev=>showPopup(ev,(p.channel||'').toUpperCase(),cleanText(p.text?.substring(0,200)||''),`${p.views||'?'} views`),2)});
  // WHO
  const whoGeo=[{lat:0.3,lon:32.6},{lat:-6.2,lon:106.8},{lat:-4.3,lon:15.3},{lat:35,lon:105},{lat:12.5,lon:105},{lat:35,lon:105},{lat:28,lon:84},{lat:24,lon:45},{lat:30,lon:70},{lat:-0.8,lon:11.6}];
  D.who.slice(0,10).forEach((w,i)=>{const c=whoGeo[i];if(!c)return;addPt(c.lat,c.lon,3.5,'rgba(105,240,174,0.6)','rgba(105,240,174,0.2)',ev=>showPopup(ev,w.title,w.summary||'','WHO'),2)});
  // News
  (D.news||[]).forEach(n=>{addPt(n.lat,n.lon,3,'rgba(129,212,250,0.6)','rgba(129,212,250,0.2)',ev=>showPopup(ev,n.source+' NEWS',cleanText(n.title),n.region),3)});
  // NOAA weather
  (D.noaa?.alerts||[]).forEach(a=>{addPt(a.lat,a.lon,4,'rgba(255,152,0,0.7)','rgba(255,152,0,0.3)',ev=>showPopup(ev,a.event,a.headline||'','NOAA/NWS'),2)});
  // EPA RadNet
  (D.epa?.stations||[]).forEach(s=>{addPt(s.lat,s.lon,3,'rgba(205,220,57,0.6)','rgba(205,220,57,0.2)',ev=>showPopup(ev,'RadNet: '+s.location,`${s.analyte||'--'}: ${s.result||'--'} ${s.unit||''}`,'EPA'),3)});
  // Space stations
  (D.space?.stationPositions||[]).forEach(s=>{
    const g=addPt(s.lat,s.lon,5,'rgba(255,255,255,0.9)','rgba(255,255,255,0.4)',ev=>showPopup(ev,s.name,'Orbital position estimate','Space Station'),1);
    if(g) g.append('text').attr('class','marker-label').attr('x',8).attr('y',3).attr('fill','rgba(255,255,255,0.7)').attr('font-size','8px').attr('font-family','var(--mono)').text(s.name.split('(')[0].trim());
  });
  // GDELT geo events
  (D.gdelt?.geoPoints||[]).forEach(g=>{addPt(g.lat,g.lon,2.5,'rgba(100,149,237,0.5)','rgba(100,149,237,0.2)',ev=>showPopup(ev,'GDELT Event',g.name||'','GDELT · '+g.count+' reports'),3)});
  // ACLED
  (D.acled?.deadliestEvents||[]).filter(e=>e.lat&&e.lon).forEach(e=>{
    const[x,y]=proj([e.lon,e.lat]);if(!x||!y)return;
    const r=Math.max(4,Math.min(14,2+Math.log2(Math.max(e.fatalities,1))*1.5));
    const g=mg.append('g').attr('transform',`translate(${x},${y})`).style('cursor','pointer').attr('data-priority',1)
      .on('click',ev=>{ev.stopPropagation();showPopup(ev,e.type||'CONFLICT',`${e.fatalities} fatalities<br>${e.location}, ${e.country}`,'ACLED')});
    g.append('circle').attr('class','conflict-ring marker-circle').attr('r',r).attr('data-base-r',r).attr('fill','none').attr('stroke','rgba(255,120,80,0.7)').attr('stroke-width',1.5);
    g.append('circle').attr('r',r*0.4).attr('fill','rgba(255,120,80,0.3)');
  });
  // Flight corridors
  if(flightsVisible){
    const airCoordsFlight=[{lat:30,lon:44},{lat:24,lon:120},{lat:49,lon:32},{lat:57,lon:24},{lat:14,lon:114},{lat:37,lon:127},{lat:25,lon:-80},{lat:4,lon:2},{lat:-34,lon:18},{lat:10,lon:51}];
    const hubs=[{lat:40.6,lon:-73.8},{lat:51.5,lon:-0.5},{lat:25.3,lon:55.4},{lat:1.4,lon:103.8},{lat:-33.9,lon:151.2},{lat:-23.4,lon:-46.5}];
    const cG=flatG.append('g').attr('class','corridors-layer');
    for(let i=0;i<D.air.length;i++){for(let j=i+1;j<D.air.length;j++){
      const a=D.air[i],b=D.air[j],from=airCoordsFlight[i],to=airCoordsFlight[j];
      if(!from||!to)continue;const traffic=a.total+b.total;if(traffic<30)continue;
      const ncR=(a.noCallsign+b.noCallsign)/Math.max(traffic,1);
      const clr=ncR>0.15?'rgba(255,95,99,0.4)':ncR>0.05?'rgba(255,184,76,0.35)':'rgba(100,240,200,0.25)';
      const interp=d3.geoInterpolate([from.lon,from.lat],[to.lon,to.lat]);
      const coords=[];for(let k=0;k<=40;k++)coords.push(interp(k/40));
      const feat={type:'Feature',geometry:{type:'LineString',coordinates:coords}};
      cG.append('path').datum(feat).attr('d',flatPath).attr('fill','none').attr('stroke',clr).attr('stroke-width',Math.max(0.8,Math.min(3,traffic/80)));
    }}
    D.air.forEach((a,i)=>{if(!airCoordsFlight[i]||a.total<25)return;hubs.forEach(hub=>{
      if(Math.abs(airCoordsFlight[i].lat-hub.lat)+Math.abs(airCoordsFlight[i].lon-hub.lon)<20)return;
      const interp=d3.geoInterpolate([airCoordsFlight[i].lon,airCoordsFlight[i].lat],[hub.lon,hub.lat]);
      const coords=[];for(let k=0;k<=40;k++)coords.push(interp(k/40));
      cG.append('path').datum({type:'Feature',geometry:{type:'LineString',coordinates:coords}}).attr('d',flatPath).attr('fill','none').attr('stroke','rgba(100,240,200,0.15)').attr('stroke-width',0.6);
    })});
  }
}

// Update setRegion for flat mode
const _origSetRegion = setRegion;

// Override mapZoom for flat mode
const _origMapZoom = mapZoom;

function setRegion(r){
  currentRegion = r;
  document.querySelectorAll('.region-btn').forEach(b=>b.classList.toggle('active',b.dataset.region===r));
  closePopup();
  if(isFlat && flatSvg && flatZoom){
    if(r==='world'){flatSvg.transition().duration(750).call(flatZoom.transform,d3.zoomIdentity);return;}
    const bounds=flatRegionBounds[r];
    const p0=flatProjection(bounds[0]),p1=flatProjection(bounds[1]);if(!p0||!p1)return;
    const dx=Math.abs(p1[0]-p0[0]),dy=Math.abs(p1[1]-p0[1]);
    const cx=(p0[0]+p1[0])/2,cy=(p0[1]+p1[1])/2;
    const scale=Math.min(flatW/dx,flatH/dy)*0.85;
    flatSvg.transition().duration(750).call(flatZoom.transform,d3.zoomIdentity.translate(flatW/2-scale*cx,flatH/2-scale*cy).scale(scale));
  } else {
    const pov=regionPOV[r]||regionPOV.world;
    globe.pointOfView(pov,1000);
  }
}

function mapZoom(factor){
  if(isFlat && flatSvg && flatZoom){
    flatSvg.transition().duration(300).call(flatZoom.scaleBy,factor);
  } else if(globe){
    const pov=globe.pointOfView();
    globe.pointOfView({altitude:pov.altitude/factor},300);
  }
}

// Sparkline SVG generator
function mkSparkSvg(values, isGood){
  if(!values || values.length < 2) return '';
  const w=52, h=18, pad=2;
  const min=Math.min(...values), max=Math.max(...values);
  const range=max-min||1;
  const pts=values.map((v,i)=>{
    const x=pad+(i/(values.length-1))*(w-pad*2);
    const y=pad+((max-v)/range)*(h-pad*2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const cls=isGood?'spark-good':'spark-bad';
  const last=pts[pts.length-1];
  return `<svg class="spark-svg" viewBox="0 0 ${w} ${h}"><polyline class="spark-line ${cls}" points="${pts.join(' ')}"/><circle class="${cls} spark-dot" cx="${last.split(',')[0]}" cy="${last.split(',')[1]}" r="2" fill="${isGood?'var(--accent)':'var(--danger)'}"/></svg>`;
}

// === LOWER GRID ===
function renderLower(){
  const mobile = isMobileLayout();
  const spread=D.fred.find(f=>f.id==='T10Y2Y');
  const ff=D.fred.find(f=>f.id==='DFF');
  const ue=D.bls.find(b=>b.id==='LNS14000000');
  const cpi=D.bls.find(b=>b.id==='CUUR0000SA0');
  const payrolls=D.bls.find(b=>b.id==='CES0000000001');
  const gscpi=D.gscpi;
  const mkt=D.markets||{};
  const metals=D.metals||{};

  const wtiH = D.energy.wtiRecent||[];
  const wtiMax=Math.max(...wtiH),wtiMin=Math.min(...wtiH);
  const sparkHtml=wtiH.map(v=>{
    const pct=wtiMax===wtiMin?50:((v-wtiMin)/(wtiMax-wtiMin))*100;
    return `<div class="spark-bar" style="height:${Math.max(pct,8)}%"></div>`;
  }).join('');

  // Helper: format market quote card
  const mktCard = (q) => {
    if(!q||q.error) return '';
    const clr = q.changePct>=0?'var(--accent)':'var(--warn)';
    const arrow = q.changePct>=0?'&#9650;':'&#9660;';
    const isCrypto = q.symbol.includes('BTC') || q.symbol.includes('ETH');
    const isIndex = q.symbol.startsWith('^');
    const price = isCrypto
      ? `$${q.price.toLocaleString()}`
      : isIndex
        ? q.price.toLocaleString(undefined, {maximumFractionDigits: 2})
        : `$${q.price}`;
    return `<div class="mc"><div class="ml">${q.name||q.symbol}</div><span class="mv" style="color:${clr}">${price}</span><span class="ms" style="color:${clr}">${arrow} ${q.changePct>=0?'+':''}${q.changePct}%</span></div>`;
  };

  // VIX from Yahoo Finance live data (fallback to FRED)
  const vixLive = mkt.vix;
  const vixFred = D.fred.find(f=>f.id==='VIXCLS');
  const vixVal = vixLive?.value || vixFred?.value;
  const vixChg = vixLive?.changePct != null ? `${vixLive.changePct>=0?'+':''}${vixLive.changePct}%` : '';
  const fmtMarketPrice = (price) => price != null ? `$${price.toLocaleString(undefined,{maximumFractionDigits:2})}` : '--';
  const dayMove = (pct) => pct != null ? `${pct>=0?'+':''}${pct}% today` : '';

  const metrics=[
    {l:'WTI Crude',v:`$${D.energy.wti}`,s:'$/bbl',p:70},
    {l:'Brent',v:`$${D.energy.brent}`,s:'$/bbl',p:75},
    {l:'Nat Gas',v:`$${D.energy.natgas||'--'}`,s:'$/MMBtu',p:30},
    {l:'Gold',v:fmtMarketPrice(metals.gold),s:dayMove(metals.goldChangePct)||'COMEX proxy',p:58},
    {l:'Silver',v:fmtMarketPrice(metals.silver),s:dayMove(metals.silverChangePct)||'COMEX proxy',p:54},
    {l:'VIX',v:vixVal?vixVal.toFixed(1):'--',s:vixChg||'volatility index',p:vixVal?Math.min(vixVal*2.5,100):30},
    {l:'Fed Funds',v:ff?`${ff.value}%`:'--',s:ff?.date||'',p:36},
    {l:'GSCPI',v:gscpi?gscpi.value.toFixed(2):'--',s:gscpi?.interpretation||'',p:49},
    {l:'CPI MoM',v:cpi?`+${cpi.momChangePct?.toFixed(2)}%`:'--',s:cpi?.date||'',p:37},
    {l:'Unemployment',v:ue?`${ue.value}%`:'--',s:ue?`${ue.momChange>0?'+':''}${ue.momChange} vs prior`:'',p:44},
  ];

  // Attach sparklines from FRED recent data
  const fredSpark = (id, up) => {
    const f = D.fred.find(f=>f.id===id);
    return f?.recent?.length > 1 ? {spark: f.recent, sparkUp: up} : {};
  };
  metrics[0] = {...metrics[0], spark: D.energy.wtiRecent, sparkUp: false};
  metrics[3] = {...metrics[3], spark: metals.goldRecent, sparkUp: (metals.goldChangePct ?? 0) >= 0};
  metrics[4] = {...metrics[4], spark: metals.silverRecent, sparkUp: (metals.silverChangePct ?? 0) >= 0};

  // Build live market cards from Yahoo Finance
  const indexCards = (mkt.indexes||[]).map(mktCard).join('');
  const cryptoCards = (mkt.crypto||[]).map(mktCard).join('');
  const rateCards = (mkt.rates||[]).map(mktCard).join('');
  const hasMarkets = indexCards || cryptoCards;

  const srcHtml=D.health.map(s=>`<div class="src-item"><div class="sd ${s.err?'err':'ok'}"></div><span>${s.n}</span></div>`).join('');

  // NEWS TICKER — merges RSS + GDELT + Telegram into flowing cards (moved from right rail)
  const feed = (D.newsFeed || []).slice(0, 20);
  const srcClass = s => {
    if (!s) return 'other';
    const sl = s.toLowerCase();
    // Africa-focused sources first (before generic DW/NYT)
    if (sl.includes('dw africa') || sl.includes('africa news') || sl.includes('nyt africa') || sl.includes('rfi')) return 'af';
    if (sl.includes('mercopress')) return 'sa';
    if (sl.includes('indian express') || sl.includes('the hindu')) return 'ind';
    if (sl.includes('sbs')) return 'anz';
    if (sl.includes('bbc')) return 'bbc';
    if (sl.includes('jazeera') || sl.includes('alj')) return 'alj';
    if (sl.includes('gdelt')) return 'gdelt';
    if (sl.includes('telegram')) return 'tg';
    if (sl.includes('npr')) return 'us';
    if (sl.includes('dw') || sl.includes('deutsche')) return 'dw';
    if (sl.includes('france') || sl.includes('euronews')) return 'eu';
    if (sl.includes('nyt') || sl.includes('times')) return 'nyt';
    return 'other';
  };
  const tickerCards = feed.map(n => {
    const sc = srcClass(n.source);
    const age = n.timestamp ? getAge(n.timestamp) : '';
    const urlAttr = n.url ? ` data-url="${String(n.url).replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"` : '';
    return `<div class="tk-card ${n.urgent?'urgent':''} ${n.url?'clickable':''}"${urlAttr}><span class="tk-src ${sc}">${(n.source||'NEWS').substring(0,12)}</span><span class="tk-time">${age}</span><div class="tk-head">${cleanText(n.headline||'')}</div>${n.url?'<span class="tk-link">&#8599;</span>':''}</div>`;
  }).join('');
  const tickerDuration = Math.max(20, feed.length * 2.5);

  // Leverageable Ideas (LLM-only feature)
  const hasIdeas = D.ideas && D.ideas.length > 0;
  const ideasHtml = hasIdeas ? (D.ideas||[]).map(idea=>`
    <div class="idea-card">
      <span class="idea-type ${(idea.type||'').toLowerCase()}">${(idea.type||'').toUpperCase()}</span>
      ${idea.ticker ? `<span class="idea-horizon">${idea.ticker}</span>` : ''}
      ${idea.horizon ? `<span class="idea-horizon">${idea.horizon}</span>` : ''}
      <span class="idea-conf">${idea.confidence} confidence</span>
      <div class="idea-title">${idea.title}</div>
      <div class="idea-text">${idea.text||idea.rationale||''}</div>
      ${idea.risk ? `<div class="idea-text" style="color:var(--warn);margin-top:3px">Risk: ${idea.risk}</div>` : ''}
    </div>`).join('') : `<div style="padding:20px;text-align:center;color:var(--dim);font-family:var(--mono);font-size:11px">
      <div style="font-size:24px;margin-bottom:8px;opacity:0.3">&#9888;</div>
      <div>LLM NOT CONFIGURED</div>
      <div style="font-size:9px;margin-top:6px;opacity:0.6">Set LLM_PROVIDER + credentials in .env to enable AI-powered trade ideas</div>
    </div>`;


  const tar1090Card = D.airMeta?.tar1090?.available ? `<div class="g-panel lp-airview">
      <div class="sec-head"><h3>Aircraft View</h3><span class="badge">AUTHORITATIVE</span></div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--dim);line-height:1.6">
        <div style="margin-bottom:8px;color:var(--text)">${cleanUiText(D.airMeta?.summaryDescription || 'Curated hotspot snapshot from OpenSky, not a full global aircraft picture.')}</div>
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px">
          <span>${cleanUiText(D.airMeta?.tar1090?.label || 'tar1090')}</span>
          <a href="${D.airMeta.tar1090.url}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none;font-weight:600">OPEN LIVE VIEW &#8599;</a>
        </div>
        <div style="font-size:9px;opacity:0.75">Use this for the full aircraft picture. The left-rail air count is a theater-focused intelligence slice.</div>
      </div>
    </div>` : '';

  const tickerPanel = `<div class="g-panel lp-ticker" style="display:flex;flex-direction:column">
      <div class="sec-head"><h3>${t('panels.newsTicker','Live News Ticker')}</h3><span class="badge">${feed.length} ${t('badges.items','ITEMS')}</span></div>
      <div class="ticker-wrap" style="--ticker-duration:${tickerDuration}s">
        <div class="ticker-track">${tickerCards}${lowPerfMode ? '' : tickerCards}</div>
      </div>
    </div>`;
  const osintPanel = mobile ? buildOsintPanel('lp-osint', 240) : '';
  const macroPanel = `<div class="g-panel lp-macro">
      <div class="sec-head"><h3>${t('panels.macroMarkets','Macro + Markets')}</h3><span class="badge">${mkt.timestamp?t('badges.live','LIVE'):t('badges.delayed','DELAYED')}</span></div>
      ${hasMarkets?`<div style="margin-bottom:8px">
        <div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-bottom:4px;letter-spacing:1px">INDEXES</div>
        <div class="metrics-row">${indexCards}</div>
      </div>
      <div style="margin-bottom:8px">
        <div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-bottom:4px;letter-spacing:1px">CRYPTO</div>
        <div class="metrics-row">${cryptoCards}</div>
      </div>`:''}
      <div style="margin-bottom:8px">
        <div style="font-family:var(--mono);font-size:9px;color:var(--dim);margin-bottom:4px;letter-spacing:1px">ENERGY + METALS + MACRO</div>
        <div class="metrics-row">${metrics.map(m=>{
          const sparkSvg = m.spark ? mkSparkSvg(m.spark, m.sparkUp) : '';
          return `<div class="mc"><div class="ml">${m.l}</div><span class="mv">${m.v}${sparkSvg}</span><span class="ms">${m.s}</span><div class="mbar"><span style="width:${m.p}%"></span></div></div>`;
        }).join('')}</div>
      </div>
      <div style="margin-top:6px">
        <div style="font-family:var(--mono);font-size:10px;color:var(--dim);margin-bottom:4px">WTI 5-DAY</div>
        <div class="spark">${sparkHtml}</div>
      </div>
    </div>`;
  const ideasPanel = `<div class="g-panel lp-ideas">
      <div class="sec-head"><h3>${t('panels.tradeIdeas','Leverageable Ideas')}</h3>${D.ideasSource==='llm'?'<span class="ideas-src llm">'+t('ideas.aiEnhanced','AI ENHANCED')+'</span>':D.ideasSource==='disabled'?'<span class="ideas-src static">'+t('ideas.llmOff','LLM OFF')+'</span>':'<span class="ideas-src static">'+t('ideas.pending','PENDING')+'</span>'}</div>
      ${ideasHtml}
      <div class="disclosure">FOR INFORMATIONAL PURPOSES ONLY. This is not financial advice, a recommendation to buy or sell any security, or a solicitation of any kind. All signal-based observations are derived from publicly available OSINT data and should not be relied upon for investment decisions. Consult a licensed financial advisor before making any investment. Past performance does not guarantee future results.</div>
    </div>`;
  document.getElementById('lowerGrid').innerHTML=`${tar1090Card}${tickerPanel}${osintPanel}${macroPanel}${ideasPanel}`;
}

// === RIGHT RAIL ===
function renderRight(){
  const mobile = isMobileLayout();
  // CROSS-SOURCE SIGNALS — moved from lower grid to right rail
  const signals=D.tSignals.slice(0,6).map((s,i)=>`<div class="signal-row"><strong>Signal ${i+1}</strong><p>${s}</p></div>`).join('');

  // OSINT TICKER — Telegram + WHO as flowing cards
  const signalMetrics=[
    {l:'Incident Tempo',v:D.tg.urgent.length,p:70},
    {l:'Air Theaters',v:D.air.length,p:60},
    {l:'Thermal Spikes',v:D.thermal.reduce((s,t)=>s+t.hc,0),p:80},
    {l:'SDR Nodes',v:D.sdr.total,p:92},
    {l:'Chokepoints',v:D.chokepoints.length,p:50},
    {l:'WHO Alerts',v:D.who.length,p:40}
  ];

  // DELTA PANEL — what changed since last sweep
  const delta = D.delta || {};
  const ds = delta.summary || {};
  const deltaState = delta.state || (ds.totalChanges > 0 ? 'ok' : 'ok');
  const hasDelta = ds.totalChanges > 0;
  const dirEmoji = {'risk-off':'&#9650;','risk-on':'&#9660;','mixed':'&#9670;','baseline':'&#9670;'}[ds.direction]||'&#9670;';
  const dirClass = {'risk-off':'up','risk-on':'down','mixed':'','baseline':''}[ds.direction]||'';
  const escalated = (delta.signals?.escalated || []).slice(0,6);
  const deescalated = (delta.signals?.deescalated || []).slice(0,4);
  const newSigs = (delta.signals?.new || []).slice(0,4);
  const deltaRows = [];
  for(const s of newSigs){
    deltaRows.push(`<div class="delta-row new"><span class="delta-badge new">NEW</span><span class="delta-label">${s.reason||s.label||s.key}</span></div>`);
  }
  for(const s of escalated){
    const sev = s.severity==='critical'?'style="color:var(--warn);font-weight:600"':s.severity==='high'?'style="color:#ffab40"':'';
    const val = s.pctChange!==undefined?`${s.pctChange>0?'+':''}${s.pctChange}%`:`${s.change>0?'+':''}${s.change}`;
    deltaRows.push(`<div class="delta-row"><span class="delta-badge up">&#9650;</span><span class="delta-label" ${sev}>${s.label}</span><span class="delta-val">${s.from}→${s.to} (${val})</span></div>`);
  }
  for(const s of deescalated){
    const val = s.pctChange!==undefined?`${s.pctChange}%`:`${s.change}`;
    deltaRows.push(`<div class="delta-row"><span class="delta-badge down">&#9660;</span><span class="delta-label">${s.label||s.key}</span><span class="delta-val">${s.from}→${s.to} (${val})</span></div>`);
  }
  let deltaHtml;
  if (deltaState === 'no-baseline') {
    deltaHtml = `<div style="padding:12px;text-align:center;color:var(--warn);font-family:var(--mono);font-size:10px">NO BASELINE YET</div>`;
  } else if (deltaState === 'degraded' && !hasDelta) {
    deltaHtml = `<div style="padding:12px;text-align:center;color:var(--warn);font-family:var(--mono);font-size:10px">DEGRADED COMPARISON, CHANGES MAY BE INCOMPLETE</div>`;
  } else {
    deltaHtml = hasDelta ? deltaRows.join('') : `<div style="padding:12px;text-align:center;color:var(--dim);font-family:var(--mono);font-size:10px">${t('delta.noChanges','No changes since last sweep')}</div>`;
  }

  document.getElementById('rightRail').innerHTML=`
    <div class="g-panel right-signals">
      <div class="sec-head"><h3>${t('panels.crossSourceSignals','Cross-Source Signals')}</h3><span class="badge">${t('badges.worldview','WORLDVIEW')}</span></div>
      ${signals}
    </div>
    ${mobile ? '' : buildOsintPanel('right-osint', 260)}
    <div class="g-panel right-core">
      <div class="sec-head"><h3>${t('panels.signalCore','Signal Core')}</h3><span class="badge">${t('badges.hotMetrics','HOT METRICS')}</span></div>
      ${signalMetrics.map(s=>`<div class="sm"><span class="sml">${s.l}</span><div class="smb"><span style="width:${s.p}%"></span></div><span class="smv">${s.v}</span></div>`).join('')}
    </div>
    <div class="g-panel right-delta">
      <div class="sec-head"><h3>${t('panels.sweepDelta','Sweep Delta')}</h3><span class="badge ${dirClass}">${deltaState==='no-baseline'?'&#9670; NO BASELINE':deltaState==='degraded'&&!hasDelta?'&#9888; DEGRADED':dirEmoji+' '+(ds.direction?t('delta.'+ds.direction,ds.direction.toUpperCase()):t('delta.baseline','BASELINE'))}</span></div>
      ${(hasDelta || deltaState==='degraded')?`<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px;font-family:var(--mono);font-size:10px">
        <span style="color:var(--dim)">${t('delta.changes','Changes')}: <span style="color:var(--accent)">${ds.totalChanges||0}</span></span>
        <span style="color:var(--dim)">${t('delta.critical','Critical')}: <span style="color:${ds.criticalChanges>0?'var(--warn)':'var(--dim)'}">${ds.criticalChanges||0}</span></span>
        ${ds.signalBreakdown?`<span style="color:var(--dim)">${t('delta.new','New')}: <span style="color:#4dd0e1">${ds.signalBreakdown.new}</span> &#8593;${ds.signalBreakdown.escalated} &#8595;${ds.signalBreakdown.deescalated}</span>`:''}
      </div>`:''}
      <div class="delta-list">${deltaHtml}</div>
    </div>`;
}

// === HELPERS ===
function getAge(d){const ms=Date.now()-new Date(d).getTime();const h=Math.floor(ms/3600000);if(h<1)return 'just now';if(h<24)return h+'h ago';return Math.floor(h/24)+'d ago'}
function cleanText(t){return t.replace(/&#39;/g,"'").replace(/&#33;/g,"!").replace(/&amp;/g,"&").replace(/<[^>]+>/g,'')}
function safeExternalUrl(raw){try{const u=new URL(raw,location.href);return u.protocol==='http:'||u.protocol==='https:'?u.toString():null}catch{return null}}
function cleanUiText(t){return String(t||'').replace(/[«»]/g,' ').replace(/\s+/g,' ').trim()}

// === BOOT SEQUENCE ===
function runBoot(){
  const aircraftBtn = document.getElementById('aircraftToggle');
  if(aircraftBtn && D.airMeta?.tar1090?.available) aircraftBtn.style.display = 'inline-flex';
  const lines=[
    {text:t('boot.initializing','INITIALIZING CRUCIX ENGINE v2.1.0'),delay:0},
    {text:t('boot.connecting','CONNECTING {count} OSINT SOURCES...').replace('{count}',D.meta.sourcesQueried),delay:400},
    {text:'&#9500;&#9472; '+t('boot.sourceGroup1','OPENSKY · FIRMS · KIWISDR · MARITIME'),delay:700},
    {text:'&#9500;&#9472; '+t('boot.sourceGroup2','FRED · BLS · EIA · TREASURY · GSCPI'),delay:900},
    {text:'&#9500;&#9472; '+t('boot.sourceGroup3','TELEGRAM · SAFECAST · EPA · WHO · OFAC'),delay:1100},
    {text:'&#9492;&#9472; '+t('boot.sourceGroup4','GDELT · NOAA · PATENTS · BLUESKY · REDDIT'),delay:1300},
    {text:t('boot.sweepComplete','SWEEP COMPLETE — {ok}/{total} SOURCES').replace('{ok}',`<span class="count">${D.meta.sourcesOk}</span>`).replace('{total}',D.meta.sourcesQueried)+' <span class="ok">'+t('boot.ok','OK')+'</span>',delay:1700},
    {text:t('boot.flightCorridors','FLIGHT CORRIDORS')+': <span class="ok">'+t('boot.active','ACTIVE')+'</span> &#183; '+t('boot.dualProjection','DUAL PROJECTION')+': <span class="ok">'+t('boot.ready','READY')+'</span>',delay:1900},
    {text:t('boot.intelligenceSynthesis','INTELLIGENCE SYNTHESIS')+': <span class="ok">'+t('boot.active','ACTIVE')+'</span>',delay:2400},
  ];
  const container=document.getElementById('bootLines');
  document.getElementById('bootFinal').textContent=t('dashboard.terminalActive','TERMINAL ACTIVE');
  const tl=gsap.timeline();
  tl.to('.logo-ring',{opacity:1,duration:0.6,ease:'power2.out'},0);
  tl.to(container,{opacity:1,duration:0.3},0.3);
  lines.forEach(line=>{
    tl.call(()=>{
      const div=document.createElement('div');div.innerHTML=line.text;div.style.opacity='0';
      container.appendChild(div);gsap.to(div,{opacity:1,duration:0.2});
      },[],line.delay/1000+0.5);
    });
  tl.to('#bootFinal',{opacity:1,duration:0.4},3.1);
  tl.to('#boot',{opacity:0,duration:0.5,ease:'power2.in'},3.7);
  tl.set('#boot',{display:'none'},4.2);
  tl.to('#bgRadial',{opacity:1,duration:1},3.8);
  tl.to('#bgGrid',{opacity:1,duration:1.2},4.0);
  tl.to('#scanline',{opacity:1,duration:0.8},4.3);
  tl.to('#main',{opacity:1,duration:0.6},3.9);
  tl.call(()=>{
    gsap.from('.g-panel,.topbar,.map-container',{opacity:0,y:20,scale:0.97,duration:0.5,stagger:0.06,ease:'power2.out'});
    setTimeout(()=>gsap.from('.layer-item,.site-row,.econ-row',{opacity:0,x:-12,duration:0.25,stagger:0.03,ease:'power1.out'}),500);
    setTimeout(()=>gsap.from('.ic',{opacity:0,y:12,duration:0.25,stagger:0.03,ease:'power1.out'}),600);
    setTimeout(()=>gsap.from('.mc',{opacity:0,y:8,duration:0.25,stagger:0.04,ease:'power1.out'}),800);
    setTimeout(()=>gsap.from('.idea-card',{opacity:0,x:12,duration:0.3,stagger:0.06,ease:'power1.out'}),900);
    setTimeout(()=>{
      document.querySelectorAll('.mbar span,.smb span').forEach(bar=>{const w=bar.style.width;bar.style.width='0%';gsap.to(bar,{width:w,duration:1,ease:'power2.out'})});
      document.querySelectorAll('.spark-bar').forEach(bar=>{const h=bar.style.height;bar.style.height='0%';gsap.to(bar,{height:h,duration:0.8,ease:'power2.out'})});
    },1000);
  },[],4.0);
}

function isMobileLayout(){ return window.innerWidth <= 1100; }

function buildOsintPanel(panelClass='', maxHeight=260){
  const allPosts=[...D.tg.urgent,...D.tg.topPosts].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
  const whoItems=D.who.slice(0,4).map(w=>({channel:'WHO ALERT',text:w.title,date:w.date,isWho:true}));
  const osintItems=[...allPosts.slice(0,15),...whoItems];
  const osintCards=osintItems.map(p=>{
    const isU=p.urgentFlags&&p.urgentFlags.length>0;
    const views=p.views?p.views>=1000?`${(p.views/1000).toFixed(0)}K`:p.views:'';
    const age=p.date?getAge(p.date):'';
    const flags=(p.urgentFlags||[]).map(f=>`<span class="tk-src tg" style="margin-right:2px">${f}</span>`).join('');
    const srcCls=p.isWho?'style="color:#69f0ae;border-color:rgba(105,240,174,0.4)"':'class="tk-src tg"';
    return `<div class="tk-card ${isU?'urgent':''}"><span ${srcCls}>${(p.channel||'OSINT').toUpperCase().substring(0,14)}</span>${views?`<span class="tk-src other">${views}</span>`:''}<span class="tk-time">${age}</span>${flags}<div class="tk-head">${cleanText((p.text||'').substring(0,160))}</div></div>`;
  }).join('');
  const osintDuration=Math.max(25,osintItems.length*3);
  return `<div class="g-panel ${panelClass}" style="display:flex;flex-direction:column">
      <div class="sec-head"><h3>${t('panels.osintStream','OSINT Stream')}</h3><span class="badge">${D.tg.urgent.length} ${t('badges.urgent','URGENT')}</span></div>
      <div class="ticker-wrap" style="--ticker-duration:${osintDuration}s;max-height:${maxHeight}px">
        <div class="ticker-track">${osintCards}${lowPerfMode ? '' : osintCards}</div>
      </div>
    </div>`;
}

function renderGlossary(){
  const body = document.getElementById('glossaryBody');
  if(!body) return;
  body.innerHTML = signalGuideItems.map(item => `
    <div class="glossary-card">
      <div class="glossary-term">
        <strong>${item.term}</strong>
        <span class="glossary-tag">${item.category}</span>
      </div>
      <div class="glossary-line"><span class="glossary-label">Meaning</span>${item.meaning}</div>
      <div class="glossary-line"><span class="glossary-label">Why it matters</span>${item.matters}</div>
      <div class="glossary-line"><span class="glossary-label">Not proof of</span>${item.notMeaning}</div>
      <div class="glossary-line"><span class="glossary-label">Example</span>${item.example}</div>
    </div>
  `).join('');
}

function openGlossary(){
  const overlay = document.getElementById('glossaryOverlay');
  if(!overlay) return;
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeGlossary(){
  const overlay = document.getElementById('glossaryOverlay');
  if(!overlay) return;
  overlay.classList.remove('show');
  document.body.style.overflow = '';
}

function refreshMapViewport(forceGlobeReflow=false){
  const container = document.getElementById('mapContainer');
  if(!container) return;
  const width = container.clientWidth;
  const height = container.clientHeight || (isMobileLayout() ? 420 : 560);
  if(globe){
    globe.width(width).height(height);
    if(forceGlobeReflow && !isFlat){
      const globeEl = document.getElementById('globeViz');
      globeEl.style.display = 'none';
      requestAnimationFrame(() => {
        globeEl.style.display = 'block';
        globe.width(width).height(height);
      });
    }
  }
  if(flatSvg){
    flatW = width;
    flatH = height;
    flatSvg.attr('viewBox',`0 0 ${flatW} ${flatH}`).attr('preserveAspectRatio','xMidYMid meet');
    if(flatProjection && flatG){
      flatProjection = d3.geoNaturalEarth1().fitSize([flatW-20,flatH-20],{type:'Sphere'}).translate([flatW/2,flatH/2]);
      flatPath = d3.geoPath(flatProjection);
      flatG.selectAll('*').remove();
      drawFlatMap();
    }
  }
}

let lastResponsiveMobile = null;
function syncResponsiveLayout(force=false){
  const mobileNow = isMobileLayout();
  if(force || lastResponsiveMobile === null || mobileNow !== lastResponsiveMobile){
    lastResponsiveMobile = mobileNow;
    renderTopbar();
    renderLeftRail();
    renderLower();
    renderRight();
  }
  refreshMapViewport(force && !isFlat);
}

// === REINIT (for live updates without boot sequence) ===
function reinit(){
  renderTopbar();renderLeftRail();renderLower();renderRight();
  plotMarkers();
}

// === SSE: Live Updates from Server ===
function connectSSE(){
  if (typeof EventSource === 'undefined') return;
  // Only connect if served from localhost (not file://)
  if (location.protocol === 'file:') return;

  const es = new EventSource('/events');
  es.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'update' && msg.data) {
        D = msg.data;
        reinit();
        // Flash the topbar to indicate update
        const topbar = document.querySelector('.topbar');
        if (topbar) {
          topbar.style.borderColor = 'var(--accent)';
          setTimeout(() => topbar.style.borderColor = '', 1500);
        }
      } else if (msg.type === 'sweep_start') {
        const badge = document.querySelector('.alert-badge');
        if (badge) { badge.textContent = 'SWEEPING...'; badge.style.borderColor = 'var(--accent)'; }
      }
    } catch {}
  };
  es.onerror = () => {
    // Reconnect after 5s on error
    es.close();
    setTimeout(connectSSE, 5000);
  };
}

// === INIT ===
let booted = false;
function init(){
  renderTopbar();renderLeftRail();renderLower();renderRight();
  renderGlossary();
  initMap();
  if (!booted) { runBoot(); booted = true; }
  // Close popup on click outside markers
  document.getElementById('mapContainer').addEventListener('click',e=>{
    if(!e.target.closest('.map-popup')) closePopup();
  });
  // Open article links from ticker cards
  document.addEventListener('click',e=>{
    const card=e.target.closest('.tk-card[data-url]');
    if(card){
      const url=safeExternalUrl(card.dataset.url);
      if(url) window.open(url,'_blank','noopener');
    }
  });
  document.addEventListener('keydown',e=>{
    if(e.key === 'Escape') closeGlossary();
  });
  syncResponsiveLayout(true);
}

document.addEventListener('DOMContentLoaded', () => {
  const hasInlineData = !!(D && D.meta);
  const canProbeApi = location.protocol !== 'file:';

  if (canProbeApi && !hasInlineData) {
    // Server mode: always fetch live data from API (ignore any stale inline D)
    fetch('/api/data')
      .then(r => r.json())
      .then(data => { D = data; init(); connectSSE(); })
      .catch(() => {
        // Should not reach here — server routes to loading.html when no data
        if (D && D.meta) { init(); connectSSE(); }
      });
  } else if (hasInlineData) {
    // File mode: use inline data
    init();
  }
});
