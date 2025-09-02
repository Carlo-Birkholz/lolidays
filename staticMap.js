// staticMap.js
export function buildStaticMapUrl(stops, { width = 800, height = 500, zoom = 4 } = {}) {
  const valid = stops.filter(s => s.lon != null && s.lat != null);
  if (!valid.length) {
    return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/10,51,3/${width}x${height}@2x?access_token=${process.env.MAPBOX_TOKEN}`;
  }

  const pts = valid.map(s => `${s.lon},${s.lat}`);
  const pins = pts.map(p => `pin-s+000(${p})`).join(',');
  const path = pts.length > 1 ? `,path-3+000(${pts.join(';')})` : '';

  const [clon, clat] = pts[0].split(',').map(Number);
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${pins}${path}/${clon},${clat},${zoom}/${width}x${height}@2x?access_token=${process.env.MAPBOX_TOKEN}`;
}
