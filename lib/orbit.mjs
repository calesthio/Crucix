const EARTH_RADIUS_KM = 6378.137;
const EARTH_FLATTENING = 1 / 298.257223563;
const EARTH_ECCENTRICITY_SQ = EARTH_FLATTENING * (2 - EARTH_FLATTENING);
const MU_KM3_S2 = 398600.4418;
const DEG = Math.PI / 180;

const number = value => (value === null || value === undefined || value === '' ? NaN : Number(value));

function orbitElements(satellite) {
  const meanMotion = number(satellite?.meanMotion ?? satellite?.MEAN_MOTION);
  const periodMinutes = number(satellite?.period ?? satellite?.PERIOD) || 1440 / meanMotion;
  const elements = {
    epochMs: Date.parse(satellite?.epoch ?? satellite?.EPOCH),
    inclination: number(satellite?.inclination ?? satellite?.INCLINATION) * DEG,
    raan: number(satellite?.raan ?? satellite?.RA_OF_ASC_NODE) * DEG,
    eccentricity: number(satellite?.eccentricity ?? satellite?.ECCENTRICITY),
    argPerigee: number(satellite?.argPerigee ?? satellite?.ARG_OF_PERICENTER) * DEG,
    meanAnomaly: number(satellite?.meanAnomaly ?? satellite?.MEAN_ANOMALY) * DEG,
    meanMotion,
    periodMinutes,
  };
  return Object.values(elements).every(Number.isFinite) && meanMotion > 0 && elements.eccentricity >= 0 && elements.eccentricity < 1
    ? elements : null;
}

function gmstRadians(timestampMs) {
  const julianDate = timestampMs / 86400000 + 2440587.5;
  const centuries = (julianDate - 2451545) / 36525;
  const degrees = 280.46061837 + 360.98564736629 * (julianDate - 2451545)
    + 0.000387933 * centuries ** 2 - centuries ** 3 / 38710000;
  return ((degrees % 360) + 360) % 360 * DEG;
}

function solveEccentricAnomaly(meanAnomaly, eccentricity) {
  let eccentricAnomaly = meanAnomaly;
  for (let iteration = 0; iteration < 8; iteration++) {
    eccentricAnomaly -= (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly)
      / (1 - eccentricity * Math.cos(eccentricAnomaly));
  }
  return eccentricAnomaly;
}

export function propagateOrbit(satellite, at = new Date()) {
  const elements = orbitElements(satellite);
  const timestampMs = at instanceof Date ? at.getTime() : Number(at);
  if (!elements || !Number.isFinite(timestampMs)) return null;

  const angularRate = elements.meanMotion * 2 * Math.PI / 86400;
  const elapsedSeconds = (timestampMs - elements.epochMs) / 1000;
  const meanAnomaly = ((elements.meanAnomaly + angularRate * elapsedSeconds) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const eccentricAnomaly = solveEccentricAnomaly(meanAnomaly, elements.eccentricity);
  const trueAnomaly = 2 * Math.atan2(
    Math.sqrt(1 + elements.eccentricity) * Math.sin(eccentricAnomaly / 2),
    Math.sqrt(1 - elements.eccentricity) * Math.cos(eccentricAnomaly / 2),
  );
  const semiMajorAxis = Math.cbrt(MU_KM3_S2 / angularRate ** 2);
  const radius = semiMajorAxis * (1 - elements.eccentricity * Math.cos(eccentricAnomaly));
  const argumentOfLatitude = elements.argPerigee + trueAnomaly;
  const cosRaan = Math.cos(elements.raan);
  const sinRaan = Math.sin(elements.raan);
  const cosU = Math.cos(argumentOfLatitude);
  const sinU = Math.sin(argumentOfLatitude);
  const cosI = Math.cos(elements.inclination);
  const sinI = Math.sin(elements.inclination);
  const xEci = radius * (cosRaan * cosU - sinRaan * sinU * cosI);
  const yEci = radius * (sinRaan * cosU + cosRaan * sinU * cosI);
  const zEci = radius * sinU * sinI;
  const sidereal = gmstRadians(timestampMs);
  const x = Math.cos(sidereal) * xEci + Math.sin(sidereal) * yEci;
  const y = -Math.sin(sidereal) * xEci + Math.cos(sidereal) * yEci;
  const longitude = Math.atan2(y, x);
  const horizontal = Math.hypot(x, y);
  let latitude = Math.atan2(zEci, horizontal * (1 - EARTH_ECCENTRICITY_SQ));
  let altitude = 0;
  for (let iteration = 0; iteration < 6; iteration++) {
    const primeVertical = EARTH_RADIUS_KM / Math.sqrt(1 - EARTH_ECCENTRICITY_SQ * Math.sin(latitude) ** 2);
    altitude = horizontal / Math.cos(latitude) - primeVertical;
    latitude = Math.atan2(zEci, horizontal * (1 - EARTH_ECCENTRICITY_SQ * primeVertical / (primeVertical + altitude)));
  }
  return {
    lat: +(latitude / DEG).toFixed(3),
    lon: +(longitude / DEG).toFixed(3),
    altitude: +altitude.toFixed(1),
    timestamp: new Date(timestampMs).toISOString(),
  };
}

function sampleOrbit(satellite, startMs, endMs, sampleSeconds) {
  const points = [];
  const stepMs = sampleSeconds * 1000;
  for (let timestamp = startMs; timestamp < endMs; timestamp += stepMs) {
    const point = propagateOrbit(satellite, timestamp);
    if (point) points.push(point);
  }
  const finalPoint = propagateOrbit(satellite, endMs);
  if (finalPoint) points.push(finalPoint);
  return points;
}

export function buildOrbitTrack(satellite, at = new Date(), sampleSeconds = 60) {
  const elements = orbitElements(satellite);
  const timestampMs = at instanceof Date ? at.getTime() : Number(at);
  if (!elements || !Number.isFinite(timestampMs) || sampleSeconds <= 0) return null;
  const periodMs = elements.periodMinutes * 60 * 1000;
  return {
    generatedAt: new Date(timestampMs).toISOString(),
    periodMinutes: +elements.periodMinutes.toFixed(2),
    current: propagateOrbit(satellite, timestampMs),
    previous: sampleOrbit(satellite, timestampMs - periodMs, timestampMs, sampleSeconds),
    next: sampleOrbit(satellite, timestampMs, timestampMs + periodMs, sampleSeconds),
  };
}
