// The demo vault's pictures, drawn here as SVG: nothing borrowed, nothing with a logo.

const FONT = `font-family="-apple-system, Helvetica, Arial, sans-serif"`
const INK = '#2f3437'
const MUTED = '#7c8388'

function floorPlan() {
  const label = (x, y, text, size = 22) =>
    `<text x="${x}" y="${y}" ${FONT} font-size="${size}" fill="${INK}" text-anchor="middle">${text}</text>`
  const unit = (x, y, w, h, text, fill = '#e7ece4') =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${INK}" stroke-width="2"/>${label(x + w / 2, y + h / 2 + 7, text, 20)}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
    <rect width="960" height="640" fill="#fbfaf6"/>
    <rect x="80" y="60" width="800" height="520" fill="#fff" stroke="${INK}" stroke-width="8"/>
    <rect x="360" y="52" width="240" height="16" fill="#bcd4e6" stroke="${INK}" stroke-width="2"/>
    ${label(480, 44, 'Window', 18)}
    ${unit(84, 64, 270, 90, 'Oven and hob')}
    ${unit(354, 64, 260, 90, 'Sink', '#dfe9f0')}
    ${unit(614, 64, 262, 90, 'Dishwasher')}
    ${unit(84, 154, 90, 300, 'Fridge', '#efe7dc')}
    ${unit(786, 154, 90, 422, 'Pantry', '#efe7dc')}
    ${unit(310, 300, 340, 120, 'Island', '#ece3d3')}
    <path d="M84 500 h96 a96 96 0 0 1 -96 76" fill="none" stroke="${MUTED}" stroke-width="2" stroke-dasharray="6 6"/>
    ${label(190, 560, 'Door', 18)}
    <path d="M330 170 V288 M630 170 V288" stroke="${MUTED}" stroke-width="2" marker-end="none"/>
    ${label(480, 236, '110 cm clearance', 18)}
  </svg>`
}

function tiles() {
  const colours = ['#f4efe6', '#ece6da', '#e4dfd3', '#d7dcd3', '#c4cfc9', '#a9b8b3']
  let cells = ''
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 12; col++) {
      const c = colours[(row * 5 + col * 7) % colours.length]
      cells += `<rect x="${40 + col * 74}" y="${40 + row * 140}" width="68" height="134" rx="3" fill="${c}"/>`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><rect width="960" height="640" fill="#b9b3a7"/>${cells}</svg>`
}

function axes(title, xLabel) {
  return `<rect width="960" height="600" fill="#fff"/>
    <text x="60" y="56" ${FONT} font-size="30" font-weight="600" fill="${INK}">${title}</text>
    <line x1="150" y1="520" x2="910" y2="520" stroke="${MUTED}" stroke-width="2"/>
    <text x="530" y="576" ${FONT} font-size="20" fill="${MUTED}" text-anchor="middle">${xLabel}</text>`
}

function sleepStages() {
  // A night as (hours in, stage), stages drawn top to bottom.
  const rows = { Awake: 120, REM: 220, N1: 300, N2: 390, N3: 480 }
  const night = [
    [0, 'Awake'],
    [0.2, 'N1'],
    [0.4, 'N2'],
    [0.8, 'N3'],
    [1.5, 'N2'],
    [1.7, 'REM'],
    [1.95, 'N2'],
    [2.3, 'N3'],
    [3, 'N2'],
    [3.3, 'REM'],
    [3.8, 'N2'],
    [4.3, 'N3'],
    [4.6, 'N2'],
    [5, 'REM'],
    [5.7, 'N2'],
    [6.3, 'REM'],
    [7.2, 'N1'],
    [7.4, 'Awake'],
    [7.5, 'Awake'],
  ]
  const x = (h) => 150 + (h / 7.5) * 760
  const line = night
    .map(([h, s], i) => `${i === 0 ? 'M' : `H${x(h).toFixed(1)} V`}${i === 0 ? `${x(h).toFixed(1)} ` : ''}${rows[s]}`)
    .join(' ')
  const labels = Object.entries(rows)
    .map(
      ([name, y]) =>
        `<text x="130" y="${y + 7}" ${FONT} font-size="20" fill="${MUTED}" text-anchor="end">${name}</text><line x1="150" y1="${y}" x2="910" y2="${y}" stroke="#eceeef" stroke-width="2"/>`,
    )
    .join('')
  const hours = [0, 1, 2, 3, 4, 5, 6, 7]
    .map((h) => `<text x="${x(h)}" y="548" ${FONT} font-size="18" fill="${MUTED}" text-anchor="middle">${h}</text>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">${axes('One night of sleep', 'Hours asleep')}${labels}${hours}<path d="${line}" fill="none" stroke="#4a6fa5" stroke-width="5" stroke-linejoin="round"/></svg>`
}

function forgetting() {
  const x = (d) => 150 + (d / 30) * 760
  const y = (r) => 500 - r * 400
  const curve = (start, strength, from, to) => {
    const points = []
    for (let d = from; d <= to + 0.001; d += 0.25)
      points.push(`${x(d).toFixed(1)},${y(start * Math.exp(-(d - from) / strength)).toFixed(1)}`)
    return points.join(' ')
  }
  const reviews = [
    [0, 1.5, 1],
    [1, 4, 3],
    [4, 9, 7],
    [11, 20, 19],
  ]
  const paths = reviews
    .map(
      ([from, strength, span]) =>
        `<polyline points="${curve(1, strength, from, from + span)}" fill="none" stroke="#4a6fa5" stroke-width="5"/>`,
    )
    .join('')
  const days = [0, 5, 10, 15, 20, 25, 30]
    .map((d) => `<text x="${x(d)}" y="548" ${FONT} font-size="18" fill="${MUTED}" text-anchor="middle">${d}</text>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">${axes('Forgetting, with reviews', 'Days since learning')}
    <text x="130" y="108" ${FONT} font-size="20" fill="${MUTED}" text-anchor="end">100%</text><text x="130" y="507" ${FONT} font-size="20" fill="${MUTED}" text-anchor="end">0%</text>
    ${days}<polyline points="${curve(1, 1.5, 0, 30)}" fill="none" stroke="#c9ccce" stroke-width="4" stroke-dasharray="10 8"/>${paths}</svg>`
}

export const IMAGES = {
  'kitchen-floor-plan.png': { width: 960, height: 640, svg: floorPlan() },
  'tile-samples.png': { width: 960, height: 640, svg: tiles() },
  'sleep-stages-chart.png': { width: 960, height: 600, svg: sleepStages() },
  'forgetting-curve.png': { width: 960, height: 600, svg: forgetting() },
}
