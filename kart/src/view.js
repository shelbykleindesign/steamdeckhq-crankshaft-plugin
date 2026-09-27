// Renderer, cameras and kart visuals.
//
// The first-person camera never pitches: its view axis stays parallel to the
// ground. Its only roll is the horizon lock, which counter-rotates the view by
// exactly the device's rotation so the horizon stays level with the real world
// while the iPad is turned like a steering wheel.

import * as THREE from 'three';
import { CAMERA } from './config.js';
import { buildKart, poseKart } from './kart-model.js';
import { nameTagTexture } from './textures.js';
import { buildWorld } from './world.js';

const DEG = Math.PI / 180;

export class View {
  constructor(canvas, track) {
    this.canvas = canvas;
    this.track = track;
    const hiDpi = window.devicePixelRatio >= 2;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !hiDpi,
      powerPreference: 'high-performance',
    });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.minPixelRatio = 1;
    this.world = buildWorld(track);
    this.scene = this.world.scene;
    // Near plane at 10 cm: the closest cockpit part (the wheel) is ~0.6 m away.
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 3000);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.cockpit = null; // player's first-person kart
    this.playerBody = null; // player's full kart, shown in chase view
    this.rivals = new Map();
    this.mode = 'attract';
    this.fovKick = 0;
    this.shake = 0;
    this.chase = { x: 0, z: 0, h: 0, init: false };

    this.frameMs = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyFov();
  }

  applyFov() {
    // Hold the horizontal FOV steady so landscape and portrait feel the same.
    const hf = (CAMERA.hFov + this.fovKick) * DEG;
    const vf = (2 * Math.atan(Math.tan(hf / 2) / this.camera.aspect)) / DEG;
    this.camera.fov = Math.min(vf, CAMERA.maxVFov + this.fovKick);
    this.camera.updateProjectionMatrix();
  }

  setPlayer(color) {
    if (this.cockpit && this.playerColor === color) return;
    for (const m of [this.cockpit, this.playerBody]) if (m) dispose(this.scene, m.root);
    this.playerColor = color;
    this.cockpit = buildKart(color, { cockpit: true });
    this.playerBody = buildKart(color);
    this.playerBody.root.visible = false;
    this.scene.add(this.cockpit.root, this.playerBody.root);
  }

  setRival(id, name, color) {
    this.removeRival(id);
    const model = buildKart(color);
    const tag = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: nameTagTexture(name, color), transparent: true, depthWrite: false }),
    );
    tag.scale.set(2.6, 0.65, 1);
    tag.position.set(0, 2.05, 0);
    model.root.add(tag);
    this.scene.add(model.root);
    this.rivals.set(id, { model, tag });
  }

  removeRival(id) {
    const r = this.rivals.get(id);
    if (!r) return;
    r.tag.material.map.dispose();
    dispose(this.scene, r.model.root);
    this.rivals.delete(id);
  }

  clearRivals() {
    for (const id of [...this.rivals.keys()]) this.removeRival(id);
  }

  poseRival(id, st, dt, time) {
    const r = this.rivals.get(id);
    if (!r) return;
    r.model.root.visible = !!st;
    if (st) poseKart(r.model, st, dt, time);
  }

  /**
   * First-person view from the player's seat.
   * @param st kart visual state
   * @param roll camera roll in radians (negative device rotation, or 0)
   * @param wheelAngle steering wheel rotation (radians, clockwise positive)
   */
  firstPerson(st, roll, wheelAngle, dt, time) {
    this.mode = 'first';
    this.cockpit.root.visible = true;
    this.playerBody.root.visible = false;
    poseKart(this.cockpit, st, dt, time);
    this.cockpit.steerWheel.rotation.y = -wheelAngle;

    const hop = this.cockpit.body.position.y;
    this.shake = Math.max(0, this.shake - dt * 3);
    const jitter = (st.onRoad ? 0 : 0.035 * Math.min(1, st.speed / 8)) + this.shake * 0.08;
    const sy = jitter ? (Math.random() - 0.5) * jitter : 0;
    const sx = jitter ? (Math.random() - 0.5) * jitter : 0;
    const sinH = Math.sin(st.h);
    const cosH = Math.cos(st.h);
    this.camera.position.set(
      st.x + sinH * CAMERA.eyeBack + cosH * sx,
      CAMERA.eyeHeight + hop + sy,
      st.z + cosH * CAMERA.eyeBack - sinH * sx,
    );
    // Pitch is always zero: the view stays parallel to the ground.
    this.camera.rotation.set(0, st.h, roll);

    const speedKick = Math.min(1, st.speed / 30) * 4;
    const target = speedKick + (st.boost > 0 ? CAMERA.boostFovKick : 0);
    this.fovKick += (target - this.fovKick) * Math.min(1, dt * 5);
    this.applyFov();
  }

  /** Third-person chase camera (after the finish line). */
  chaseView(st, dt, time) {
    this.mode = 'chase';
    this.cockpit.root.visible = false;
    this.playerBody.root.visible = true;
    poseKart(this.playerBody, st, dt, time);
    const c = this.chase;
    if (!c.init) {
      c.h = st.h;
      c.init = true;
    }
    c.h += Math.atan2(Math.sin(st.h - c.h), Math.cos(st.h - c.h)) * Math.min(1, dt * 3);
    const back = 6.5;
    this.camera.position.set(st.x + Math.sin(c.h) * back, 2.6, st.z + Math.cos(c.h) * back);
    this.camera.rotation.set(-0.12, c.h, 0);
    this.fovKick += (0 - this.fovKick) * Math.min(1, dt * 3);
    this.applyFov();
  }

  /** Slow drone flight along the circuit behind the menus. */
  attract(time) {
    this.mode = 'attract';
    if (this.cockpit) this.cockpit.root.visible = false;
    if (this.playerBody) this.playerBody.root.visible = false;
    this.chase.init = false;
    const s = time * 11;
    const p = this.track.frameAt(s, -3);
    const look = this.track.frameAt(s + 45, 2);
    this.camera.position.set(p.x, 9 + Math.sin(time * 0.2) * 2, p.z);
    this.camera.lookAt(look.x, 1.5, look.z);
    this.fovKick = 0;
    this.applyFov();
  }

  bump(amount) {
    this.shake = Math.min(1, this.shake + amount);
  }

  render(time, dt) {
    this.world.update(time, this.camera.position);
    this.renderer.render(this.scene, this.camera);
    if (this.mode === 'first') this.adapt(dt);
  }

  /** Drop resolution on devices that can't hold ~50 fps. */
  adapt(dt) {
    if (!(dt > 0) || dt > 0.25) return;
    this.frameMs.push(dt * 1000);
    if (this.frameMs.length < 120) return;
    const avg = this.frameMs.reduce((a, b) => a + b, 0) / this.frameMs.length;
    this.frameMs.length = 0;
    this.fps = 1000 / avg;
    if (avg > 21 && this.pixelRatio > this.minPixelRatio) {
      this.pixelRatio = Math.max(this.minPixelRatio, this.pixelRatio - 0.25);
      this.resize();
    }
  }
}

/** Remove a model and free its GPU resources (shared textures are kept). */
function dispose(scene, root) {
  scene.remove(root);
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) for (const m of [].concat(o.material)) m.dispose();
  });
}
