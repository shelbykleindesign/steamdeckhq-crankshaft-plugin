// Per-device preferences, stored locally. Storage can be unavailable (private
// mode, blocked site data), so every access is guarded and defaults always work.

import { KART_COLORS, RACE, STEER } from './config.js';

const KEY = 'tiltkart.settings.v1';

function defaults() {
  return {
    name: `Racer ${Math.floor(10 + Math.random() * 90)}`,
    // Random first colour, so two new players rarely show up as twins.
    color: KART_COLORS[Math.floor(Math.random() * KART_COLORS.length)].id,
    maxAngle: STEER.defaultMaxAngle,
    horizonLock: true,
    sound: true,
    laps: RACE.laps,
  };
}

export function loadSettings() {
  const base = defaults();
  let stored = false;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      Object.assign(base, JSON.parse(raw));
      stored = true;
    }
  } catch {
    // ignore
  }
  if (!KART_COLORS.some((c) => c.id === base.color)) base.color = KART_COLORS[0].id;
  base.maxAngle = Math.min(
    STEER.maxMaxAngle,
    Math.max(STEER.minMaxAngle, Number(base.maxAngle) || STEER.defaultMaxAngle),
  );
  base.name = cleanName(base.name) || defaults().name;
  // Keep the generated name and colour stable across visits.
  if (!stored) saveSettings(base);
  return base;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export function cleanName(n) {
  return String(n || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 16);
}

export function colorHex(id) {
  return (KART_COLORS.find((c) => c.id === id) || KART_COLORS[0]).hex;
}
