function pctChange(current, baseline) {
  if (current == null || baseline == null) return null;
  if (baseline === 0) return current === 0 ? 0 : null;
  return +(((current - baseline) / Math.abs(baseline)) * 100).toFixed(2);
}

function direction(current, baseline) {
  if (current == null || baseline == null) return 'unknown';
  if (current > baseline) return 'up';
  if (current < baseline) return 'down';
  return 'flat';
}

function numericEntry(label, current, baseline, kind = 'count') {
  if (current == null || baseline == null) return null;
  return {
    label,
    current,
    baseline,
    change: +(current - baseline).toFixed(2),
    pctChange: pctChange(current, baseline),
    direction: direction(current, baseline),
    kind,
  };
}

function findFred(data, id) {
  return data?.fred?.find(x => x.id === id)?.value ?? null;
}

function findCommodity(data, symbol) {
  const marketPrice = data?.markets?.commodities?.find(x => x.symbol === symbol)?.price;
  if (marketPrice != null) return marketPrice;
  if (symbol === 'BZ=F') return data?.energy?.brent ?? null;
  if (symbol === 'CL=F') return data?.energy?.wti ?? null;
  if (symbol === 'NG=F') return data?.energy?.natgas ?? null;
  if (symbol === 'GC=F') return data?.metals?.gold ?? null;
  if (symbol === 'SI=F') return data?.metals?.silver ?? null;
  return null;
}

function findIndex(data, symbol) {
  return data?.markets?.indexes?.find(x => x.symbol === symbol)?.price ?? null;
}

export function buildSixHourBaseline(current, baseline) {
  if (!current || !baseline) return null;

  const signalTypes = [
    numericEntry('Urgent OSINT Posts', current.tg?.urgent?.length || 0, baseline.tg?.urgent?.length || 0),
    numericEntry('Thermal Detections', current.thermal?.reduce((s, t) => s + (t.det || 0), 0) || 0, baseline.thermal?.reduce((s, t) => s + (t.det || 0), 0) || 0),
    numericEntry('Air Activity', current.air?.reduce((s, a) => s + (a.total || 0), 0) || 0, baseline.air?.reduce((s, a) => s + (a.total || 0), 0) || 0),
    numericEntry('WHO Alerts', current.who?.length || 0, baseline.who?.length || 0),
    numericEntry('Conflict Events', current.acled?.totalEvents || 0, baseline.acled?.totalEvents || 0),
    numericEntry('Conflict Fatalities', current.acled?.totalFatalities || 0, baseline.acled?.totalFatalities || 0),
    numericEntry('SDR Receivers', current.sdr?.online || 0, baseline.sdr?.online || 0),
    numericEntry('News Items', current.news?.length || current.news?.count || 0, baseline.news?.length || baseline.news?.count || 0),
    numericEntry('Sources OK', current.meta?.sourcesOk || 0, baseline.meta?.sourcesOk || 0),
    numericEntry('Nuclear Anomaly Sites', current.nuke?.filter(n => n.anom).length || 0, baseline.nuke?.filter(n => n.anom).length || 0),
  ].filter(Boolean);

  const markets = [
    numericEntry('Brent Crude', findCommodity(current, 'BZ=F'), findCommodity(baseline, 'BZ=F'), 'market'),
    numericEntry('WTI Crude', findCommodity(current, 'CL=F'), findCommodity(baseline, 'CL=F'), 'market'),
    numericEntry('Natural Gas', findCommodity(current, 'NG=F'), findCommodity(baseline, 'NG=F'), 'market'),
    numericEntry('Gold', findCommodity(current, 'GC=F'), findCommodity(baseline, 'GC=F'), 'market'),
    numericEntry('Silver', findCommodity(current, 'SI=F'), findCommodity(baseline, 'SI=F'), 'market'),
    numericEntry('S&P 500', findIndex(current, '^GSPC'), findIndex(baseline, '^GSPC'), 'market'),
    numericEntry('Nasdaq Composite', findIndex(current, '^IXIC'), findIndex(baseline, '^IXIC'), 'market'),
    numericEntry('Dow Jones', findIndex(current, '^DJI'), findIndex(baseline, '^DJI'), 'market'),
    numericEntry('Russell 2000', findIndex(current, '^RUT'), findIndex(baseline, '^RUT'), 'market'),
    numericEntry('VIX', current.markets?.vix?.value ?? findFred(current, 'VIXCLS'), baseline.markets?.vix?.value ?? findFred(baseline, 'VIXCLS'), 'market'),
  ].filter(Boolean);

  const noteworthy = [...signalTypes, ...markets]
    .filter(item => Math.abs(item.pctChange || 0) >= 5 || Math.abs(item.change || 0) >= 1)
    .sort((a, b) => Math.abs(b.pctChange || 0) - Math.abs(a.pctChange || 0))
    .slice(0, 10);

  return {
    baselineTimestamp: baseline.meta?.timestamp || null,
    currentTimestamp: current.meta?.timestamp || null,
    signalTypes,
    markets,
    noteworthy,
  };
}
