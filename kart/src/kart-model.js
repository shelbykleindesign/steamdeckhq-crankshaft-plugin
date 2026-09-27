// Low-poly kart built from primitives. Faces -Z, origin on the ground under
// the kart's centre. The same model is used for rivals and for the player's
// own cockpit (with the driver's body hidden, since the camera is their head).

import * as THREE from 'three';
import { CAMERA } from './config.js';
import * as TX from './textures.js';

const DARK = '#23272e';
const TYRE = '#18191c';
const METAL = '#9aa3ad';

let shadowTex = null;
let sparkTex = null;

function lambert(color, extra = {}) {
  return new THREE.MeshLambertMaterial({ color, ...extra });
}

function noseGeometry() {
  // Side profile (z forward-negative, y up), extruded across the width.
  const s = new THREE.Shape();
  s.moveTo(-1.42, 0.1);
  s.lineTo(-1.42, 0.25);
  s.lineTo(-1.0, 0.36);
  s.lineTo(-0.42, 0.5);
  s.lineTo(-0.3, 0.5);
  s.lineTo(-0.3, 0.1);
  s.closePath();
  const width = 0.66;
  const g = new THREE.ExtrudeGeometry(s, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  // Shape x -> world z; extrusion -> world x, centred.
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2, 0, 0);
  return g;
}

function wheel(radius, width, rimColor) {
  const pivot = new THREE.Group(); // steers about Y
  const spin = new THREE.Group(); // rolls about X
  const tyreGeo = new THREE.CylinderGeometry(radius, radius, width, 16);
  tyreGeo.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(tyreGeo, lambert(TYRE)));
  const rimGeo = new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, width + 0.02, 12);
  rimGeo.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(rimGeo, lambert(rimColor)));
  // Spokes make the roll visible.
  const spokeMat = lambert(DARK);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, radius * 1.05, 0.05), spokeMat);
    spoke.rotation.x = (i * Math.PI) / 3;
    spin.add(spoke);
  }
  pivot.add(spin);
  return { pivot, spin, radius };
}

/**
 * @param {string} color body colour
 * @param {{ cockpit?: boolean }} opts cockpit = first-person player kart
 */
export function buildKart(color, { cockpit = false } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = lambert(color);
  const dark = lambert(DARK);
  const metal = lambert(METAL);

  // Chassis plate.
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.07, 2.2), dark);
  chassis.position.set(0, 0.13, -0.2);
  body.add(chassis);

  // Nose fairing and front bumper.
  body.add(new THREE.Mesh(noseGeometry(), paint));
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.09, 0.12), dark);
  bumper.position.set(0, 0.15, -1.5);
  body.add(bumper);

  // Side pods.
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.9), paint);
    pod.position.set(side * 0.58, 0.26, -0.15);
    body.add(pod);
  }

  // Seat.
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.5), dark);
  seat.position.set(0, 0.24, 0.3);
  body.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.1), dark);
  back.position.set(0, 0.5, 0.58);
  back.rotation.x = -0.25;
  body.add(back);

  // Engine, exhaust and rear bumper.
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.36), metal);
  engine.position.set(0.3, 0.35, 0.72);
  body.add(engine);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.4, 8), dark);
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(-0.2, 0.34, 0.98);
  body.add(pipe);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.12), dark);
  rear.position.set(0, 0.22, 1.1);
  body.add(rear);

  // Steering wheel: placed so that from the driver's eye its hub sits just
  // above the bottom of the frame and only the top of the rim is in view.
  const eye = new THREE.Vector3(0, CAMERA.eyeHeight, CAMERA.eyeBack);
  const reach = 0.72;
  const below = 29 * (Math.PI / 180);
  const hub = new THREE.Vector3(0, eye.y - reach * Math.sin(below), eye.z - reach * Math.cos(below));
  const tilt = Math.atan2(eye.y - hub.y, eye.z - hub.z); // wheel face points at the eye
  const axis = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), dark);
  column.position.copy(hub).addScaledVector(axis, -0.35);
  column.rotation.x = Math.PI / 2 - tilt;
  body.add(column);
  const steerMount = new THREE.Group();
  steerMount.position.copy(hub);
  // Rotating local +Y toward +Z points the wheel's axis at the eye.
  steerMount.rotation.x = Math.PI / 2 - tilt;
  body.add(steerMount);
  const steerWheel = new THREE.Group(); // rotates about its own axis (local Y after mount tilt)
  steerMount.add(steerWheel);
  const R = 0.15;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.022, 8, 28), dark);
  rim.rotation.x = Math.PI / 2;
  steerWheel.add(rim);
  const hubMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), paint);
  steerWheel.add(hubMesh);
  // T-shaped spokes at 3, 9 and 6 o'clock (+Z points down once the mount tilts).
  for (const a of [0, Math.PI, Math.PI / 2]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(R * 0.9, 0.02, 0.024), dark);
    spoke.position.set(Math.cos(a) * R * 0.52, 0, Math.sin(a) * R * 0.52);
    spoke.rotation.y = -a;
    steerWheel.add(spoke);
  }
  // Gloves at quarter-to-three.
  const glove = lambert('#2c3138');
  const cuff = lambert(color);
  for (const side of [-1, 1]) {
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), glove);
    g.scale.set(1.15, 1.25, 1.6);
    g.position.set(side * R, 0.018, 0);
    steerWheel.add(g);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.03, 10), cuff);
    c.position.set(side * (R + 0.012), 0.05, 0.02);
    c.rotation.z = side * 0.5;
    steerWheel.add(c);
  }

  // Wheels.
  const wheels = [];
  const fl = wheel(0.24, 0.2, METAL);
  const fr = wheel(0.24, 0.2, METAL);
  const rl = wheel(0.28, 0.28, METAL);
  const rr = wheel(0.28, 0.28, METAL);
  fl.pivot.position.set(-0.7, 0.24, -1.02);
  fr.pivot.position.set(0.7, 0.24, -1.02);
  rl.pivot.position.set(-0.74, 0.28, 0.62);
  rr.pivot.position.set(0.74, 0.28, 0.62);
  for (const w of [fl, fr, rl, rr]) {
    root.add(w.pivot);
    wheels.push(w);
  }

  // Driver (rivals only; the player's head is the camera).
  let driver = null;
  if (!cockpit) {
    driver = new THREE.Group();
    const suit = lambert(color);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.32, 4, 10), suit);
    torso.position.set(0, 0.68, 0.34);
    torso.rotation.x = -0.25;
    driver.add(torso);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), lambert(color));
    helmet.position.set(0, 1.12, 0.3);
    driver.add(helmet);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 6, 20, Math.PI), lambert('#ffffff'));
    stripe.position.copy(helmet.position);
    stripe.rotation.y = Math.PI / 2;
    driver.add(stripe);
    // Partial sphere centred on phi = -90°, which faces -Z (forward).
    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 14, 8, -Math.PI * 0.85, Math.PI * 0.7, Math.PI * 0.32, Math.PI * 0.3),
      lambert('#101418', { emissive: '#1b2a3a' }),
    );
    visor.position.set(0, 1.12, 0.26);
    visor.scale.setScalar(1.08);
    driver.add(visor);
    // Arms from the shoulders to the rim at quarter-to-three.
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Vector3(side * 0.2, 0.92, 0.28);
      const grip = new THREE.Vector3(side * R, hub.y, hub.z);
      const len = shoulder.distanceTo(grip);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, Math.max(0.1, len - 0.11), 4, 8), suit);
      arm.position.copy(shoulder).add(grip).multiplyScalar(0.5);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), grip.clone().sub(shoulder).normalize());
      driver.add(arm);
    }
    body.add(driver);
  }

  // Blob shadow.
  if (!shadowTex) shadowTex = TX.shadowTexture();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 3.1),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  shadow.geometry.rotateX(-Math.PI / 2);
  shadow.position.set(0, 0.045, -0.2);
  shadow.renderOrder = 1;
  root.add(shadow);

  // Boost flame at the exhaust.
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.6, 8),
    new THREE.MeshBasicMaterial({ color: '#ffb020', transparent: true, opacity: 0.85, depthWrite: false }),
  );
  flame.rotation.x = Math.PI / 2;
  flame.position.set(-0.2, 0.34, 1.45);
  flame.visible = false;
  body.add(flame);

  // Drift sparks behind the rear wheels.
  if (!sparkTex) sparkTex = TX.sparkTexture();
  const sparks = [];
  for (const side of [-1, 1]) {
    const m = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sparkTex,
        color: '#5ac8ff',
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    m.position.set(side * 0.74, 0.12, 0.95);
    m.scale.setScalar(0.5);
    m.visible = false;
    root.add(m);
    sparks.push(m);
  }

  return {
    root,
    body,
    wheels,
    steerWheel,
    driver,
    flame,
    sparks,
    roll: 0,
  };
}

const SPARK_COLORS = ['#5ac8ff', '#ff9a1f', '#ff4fd8'];

/**
 * Pose a kart model from simulation state.
 * state: { x, z, h, speed, steer, drift, driftLevel, boost, hop }
 */
export function poseKart(model, st, dt, time) {
  model.root.position.set(st.x, 0, st.z);
  model.root.rotation.y = st.h;
  // Front wheels steer, all wheels roll.
  const steerAngle = -st.steer * 0.45;
  model.wheels[0].pivot.rotation.y = steerAngle;
  model.wheels[1].pivot.rotation.y = steerAngle;
  for (const w of model.wheels) w.spin.rotation.x -= (st.speed / w.radius) * dt;
  // Body lean into corners and hop.
  const targetRoll = (st.drift ? -st.drift * 0.06 : 0) + st.steer * -0.03 * Math.min(1, st.speed / 20);
  model.roll += (targetRoll - model.roll) * Math.min(1, dt * 8);
  model.body.rotation.z = model.roll;
  model.body.position.y = st.hop > 0 ? Math.sin((1 - st.hop / 0.28) * Math.PI) * 0.18 : 0;
  model.flame.visible = st.boost > 0;
  if (model.flame.visible) model.flame.scale.set(1, 0.8 + Math.sin(time * 60) * 0.25, 1);
  const lvl = st.drift ? st.driftLevel : 0;
  for (const s of model.sparks) {
    s.visible = lvl > 0 && Math.sin(time * 90 + s.position.x * 10) > -0.3;
    if (s.visible) {
      s.material.color.set(SPARK_COLORS[lvl - 1]);
      s.scale.setScalar(0.35 + Math.random() * 0.35);
    }
  }
}
