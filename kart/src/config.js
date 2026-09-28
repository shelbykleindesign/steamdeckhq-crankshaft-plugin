// Central tuning. Everything that affects feel lives here so it can be tweaked
// without digging through the simulation code.

export const GAME_NAME = 'Tilt Kart';

// Bump when the network message format changes; mismatched clients refuse to pair.
export const PROTOCOL_VERSION = 1;

// Pairing codes are consonants only so they can't spell words and are easy to read aloud.
export const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE_LENGTH = 4;

export const PHYS = {
  dt: 1 / 120,
  maxSpeed: 24, // m/s on tarmac (~54 mph)
  offroadMaxSpeed: 11,
  boostMaxSpeed: 32,
  reverseMaxSpeed: 7,
  accel: 12, // m/s² from standstill, tapers toward max speed
  boostAccel: 20,
  brakeDecel: 28,
  reverseAccel: 8,
  coastDecel: 2,
  overspeedDrag: 2.2, // how quickly speed bleeds off when above the surface limit (1/s)
  maxYawRate: 2.2, // rad/s at full steering lock
  steerFullSpeed: 7, // m/s: below this, steering authority ramps down...
  pivotAuthority: 0.3, // ...but never below this while on the pedals, so a kart can turn off a wall
  highSpeedSteerLoss: 0.22, // fraction of yaw authority lost at top speed
  yawResponse: 10, // 1/s: how quickly yaw rate chases the target
  grip: 10, // 1/s lateral velocity decay on tarmac
  offroadGrip: 7,
  driftGrip: 2.4,
  gripTransfer: 0.9, // share of scrubbed lateral speed converted back into forward speed
  driftMinSpeed: 9,
  driftYawMin: 0.45, // rad/s while counter-steering a drift
  driftYawMax: 1.9, // rad/s while steering hard into a drift
  hopWindow: 0.3, // s after pressing drift during which a steer input commits the drift
  // Mini-turbo: charge thresholds (s of drifting) and the boost each level fires.
  miniTurbo: [
    { charge: 0.9, boost: 0.6 },
    { charge: 1.9, boost: 1.1 },
    { charge: 3.2, boost: 1.6 },
  ],
  padBoost: 1.2,
  kartRadius: 1.0,
  wallRestitution: 0.3,
};

export const TRACK = {
  roadHalfWidth: 8,
  curbWidth: 1.3,
  wallOffset: 13.5,
  spacing: 1, // metres between centerline samples
};

export const STEER = {
  // Device rotation (degrees) that gives full steering lock. Settings slider range.
  defaultMaxAngle: 28,
  minMaxAngle: 16,
  maxMaxAngle: 42,
  deadzone: 1.5, // degrees
  curve: 1.2, // >1 softens small inputs for finer control near centre
  filterTau: 0.045, // s low-pass on the accelerometer vector
};

export const CAMERA = {
  eyeHeight: 1.18,
  eyeBack: 0.32, // metres behind kart origin (the seat)
  hFov: 88, // horizontal field of view in degrees, held constant across aspect ratios
  maxVFov: 80,
  boostFovKick: 9,
};

export const NET = {
  sendHz: 20,
  interpDelay: 0.11, // s: remote karts are drawn this far in the past for smoothness
  extrapolateMax: 0.35,
  timeoutMs: 6000,
  connectTimeoutMs: 15000,
  pingIntervalMs: 1000,
  relayTimeoutMs: 45000, // no word from the relay (it sends a keepalive every 20 s) = socket is dead
};

export const RACE = {
  laps: 3,
  countdown: 3, // seconds of 3-2-1
  startLead: 1.2, // extra seconds before the countdown so both devices are synced
  gridBack: 7, // metres behind the start line
  gridLateral: 3.6,
};

export const KART_COLORS = [
  { id: 'red', hex: '#ff3b30', name: 'Red' },
  { id: 'blue', hex: '#1e6bff', name: 'Blue' },
  { id: 'yellow', hex: '#ffc400', name: 'Yellow' },
  { id: 'green', hex: '#1fbf5a', name: 'Green' },
  { id: 'purple', hex: '#8c4bff', name: 'Purple' },
  { id: 'orange', hex: '#ff7a1a', name: 'Orange' },
];
