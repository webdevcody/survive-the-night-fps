// Crows wheeling over every hiding place that still holds a car supply (#287): the world's own signpost, seen from a
// street or two away against the sky. Where they circle is shared/supplyhelp.js crowsAt; they leave once the supply
// has been taken. Every bird is two wings of two instanced meshes: two draw calls for the lot.
import * as THREE from 'three';
import { CROWS, crowsAt } from '../../shared/supplyhelp.js';

const MAX = 7 * CROWS.COUNT; // seven hints
const SPAN = 1.3; // m from wingtip to wingtip (a big crow, so it reads as one a long way off)
const FLAP = 3; // wingbeats a second
const SPEED = 0.35; // rad/s round the circle
const BANK = 0.3; // rad they lean in to it

function wing(side) {
  // a body-to-tip triangle, the body along x; side = +1 / -1
  const g = new THREE.BufferGeometry();
  const s = SPAN / 2;
  g.setAttribute('position', new THREE.Float32BufferAttribute([0.28, 0, 0, -0.32, 0, 0, -0.1, 0, s * side], 3));
  g.computeVertexNormals();
  return g;
}

export class Crows {
  constructor(scene) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x14110f, side: THREE.DoubleSide });
    this.wings = [1, -1].map((side) => {
      const m = new THREE.InstancedMesh(wing(side), mat, MAX);
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
      return m;
    });
    this.world = null;
    this.centres = new Map(); // partSpots index -> where its crows circle
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  setWorld(world) {
    this.world = world;
    this.centres.clear();
    for (const w of this.wings) w.count = 0;
  }

  // spots: the partSpots indices of the supplies still hidden
  update(time, spots) {
    const w = this.world;
    let n = 0;
    if (w)
      for (const si of spots) {
        const sp = w.partSpots[si];
        if (!sp) continue;
        let c = this.centres.get(si);
        if (!c) this.centres.set(si, (c = crowsAt(w, sp)));
        for (let b = 0; b < CROWS.COUNT && n < MAX; b++, n++) {
          // each on its own circle a little wider or higher than the next, some a lap behind
          const seed = si * 7.31 + b * 1.618;
          const r = CROWS.RADIUS * (0.7 + 0.5 * ((seed * 0.37) % 1));
          const a = time * SPEED * (1 + 0.15 * ((seed * 0.53) % 1)) + (b / CROWS.COUNT) * Math.PI * 2;
          const y = c.y + 3 * Math.sin(time * 0.4 + seed);
          this._p.set(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r);
          const flap = Math.sin(time * FLAP * Math.PI * 2 * (1 + 0.1 * (b % 3)) + seed) * 0.6;
          // (the body is along the wing's x, so it turns to the circle's tangent; a beat rolls each wing about the body,
          // and the bank lowers the inner one: wings[0] is the +z wing, which faces the middle)
          for (let side = 0; side < 2; side++) {
            this._e.set(BANK + (side ? flap : -flap), -a - Math.PI / 2, 0);
            this._q.setFromEuler(this._e);
            this._m.compose(this._p, this._q, this._s);
            this.wings[side].setMatrixAt(n, this._m);
          }
        }
      }
    for (const m of this.wings) {
      m.count = n;
      if (n) m.instanceMatrix.needsUpdate = true;
    }
  }

  clear() {
    for (const m of this.wings) m.count = 0;
  }
}
