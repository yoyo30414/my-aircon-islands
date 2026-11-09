/*
 * 五步島的 3D 世界：可以拖曳旋轉、滾輪縮放、點島登島的低多邊形群島。
 * 用 three.js（MIT 授權，放在 js/vendor/）。沒有 WebGL 的電腦會退回平面地圖。
 * 這個檔案只管「看起來的樣子」，遊戲規則在 app.js。
 */
window.IsleWorld = (function () {
  const T = window.THREE;
  let ok = false;
  let renderer, scene, camera, clock, raycaster, container, labelLayer;
  let hemi, sun, water, waterBase;
  const isles = {};
  let order = [];
  let routes = [];
  let player, playerAt = null, playerAnim = null, playerStyle = null;
  const boats = [], walkers = [], lamps = [], snow = [];
  let calm = false, panelOpen = false, panelW = 460, mood = "dawn";
  let onPick = () => {};
  let onNear = () => {};
  // 走路：方向鍵或 WASD；橋接起相鄰兩座島，橋頭的門要等前一座島過關才打開
  const keys = new Set();
  const bridges = [];
  let nearId = null, walking = false, placed = false;
  const WALK_SPEED = 6, NEAR = 2.6;
  let hover = null;

  // 鏡頭：繞著一個目標點轉
  const cam = { target: new T.Vector3(0, 0, 0), theta: Math.PI / 4, phi: 0.95, dist: 95, goal: null };
  const OVERVIEW = { target: new T.Vector3(0, 0, 2), theta: Math.PI / 4, phi: 1.0, dist: 95 };
  function overview() {
    const a = container ? container.clientWidth / Math.max(1, container.clientHeight) : 1.6;
    return Object.assign({}, OVERVIEW, { target: OVERVIEW.target.clone(), dist: a < 1 ? 95 * Math.min(1.95, 0.92 / a) : OVERVIEW.dist });
  }

  /* ---------- 小工具 ---------- */
  function rand(seed) {
    let s = (seed * 9301 + 49297) % 233280;
    return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  }
  function mat(color, extra) {
    return new T.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: 0.9, metalness: 0 }, extra || {}));
  }
  function mesh(geo, m, cast = true) {
    const o = new T.Mesh(geo, m);
    o.castShadow = cast; o.receiveShadow = true;
    return o;
  }
  function wobble(geo, seed, amount) {
    const p = geo.attributes.position, r = rand(seed);
    const b = [r() * 6, r() * 6, r() * 6, r() * 6];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z);
      if (d < 0.01) continue;
      const a = Math.atan2(z, x);
      const k = 1 + amount * (Math.sin(a * 2 + b[0]) * 0.45 + Math.sin(a * 3 + b[1]) * 0.35 + Math.sin(a * 5 + b[2]) * 0.2 + Math.sin(a * 7 + b[3]) * 0.1);
      p.setX(i, x * k); p.setZ(i, z * k);
    }
    geo.computeVertexNormals();
    return geo;
  }
  function shade(hex, f) { return new T.Color(hex).multiplyScalar(f); }

  /* ---------- 小人 ---------- */
  function figure(style, scale = 1) {
    const g = new T.Group();
    const skin = mat(0xf0c9a0);
    const legs = mesh(new T.CylinderGeometry(0.22, 0.26, 0.6, 6), mat(style.pants || 0x3b4a52)); legs.position.y = 0.3; g.add(legs);
    const body = mesh(new T.CylinderGeometry(0.3, 0.38, 0.75, 7), mat(style.body)); body.position.y = 0.95; g.add(body);
    const head = mesh(new T.IcosahedronGeometry(0.3, 1), skin); head.position.y = 1.55; g.add(head);
    if (style.hair) {
      // 及肩短髮：後方一片、頭頂一片、兩側各一小片
      const back = mesh(new T.BoxGeometry(0.6, 0.62, 0.26), mat(style.hair)); back.position.set(0, 1.4, -0.13); g.add(back);
      const top = mesh(new T.SphereGeometry(0.325, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(style.hair)); top.position.y = 1.6; g.add(top);
      [-1, 1].forEach(sx => {
        const side = mesh(new T.BoxGeometry(0.1, 0.42, 0.2), mat(style.hair)); side.position.set(sx * 0.26, 1.42, -0.02); g.add(side);
      });
    } else {
      let hat;
      if (style.hat === "cone") { hat = mesh(new T.ConeGeometry(0.36, 0.5, 7), mat(style.hatColor)); hat.position.y = 1.95; }
      else if (style.hat === "cap") { hat = mesh(new T.CylinderGeometry(0.32, 0.33, 0.2, 8), mat(style.hatColor)); hat.position.y = 1.8; }
      else { hat = mesh(new T.SphereGeometry(0.34, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(style.hatColor)); hat.position.y = 1.72; }
      g.add(hat);
    }
    if (style.worried) {
      [-1, 1].forEach(sx => {
        const brow = mesh(new T.BoxGeometry(0.1, 0.026, 0.03), mat(0x2a2320), false);
        brow.position.set(sx * 0.1, 1.63, 0.29);
        brow.rotation.z = -sx * 0.35; g.add(brow);
      });
    }
    if (style.slippers) {
      [-0.14, 0.14].forEach(x => {
        const sl = mesh(new T.BoxGeometry(0.2, 0.08, 0.34), mat(0xd8d3c8)); sl.position.set(x, 0.04, 0.06); g.add(sl);
      });
    }
    if (style.pack) { const pack = mesh(new T.BoxGeometry(0.4, 0.45, 0.22), mat(style.pack)); pack.position.set(0, 1.0, -0.35); g.add(pack); }
    g.scale.setScalar(scale);
    return g;
  }
  function ring(color) {
    const m = new T.Mesh(new T.RingGeometry(0.55, 0.72, 24), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.04;
    return m;
  }

  /* ---------- 怪獸 ---------- */
  function monster(color) {
    const g = new T.Group();
    const body = mesh(new T.IcosahedronGeometry(0.9, 1), mat(color, { roughness: 0.6 }));
    const p = body.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 3) { const v = new T.Vector3(p.getX(i), p.getY(i), p.getZ(i)); v.multiplyScalar(1.12); p.setXYZ(i, v.x, v.y, v.z); }
    body.geometry.computeVertexNormals();
    g.add(body);
    [-0.32, 0.32].forEach(x => {
      const eye = mesh(new T.SphereGeometry(0.2, 10, 8), mat(0xffffff, { flatShading: false }), false); eye.position.set(x, 0.25, 0.75); g.add(eye);
      const pupil = mesh(new T.SphereGeometry(0.09, 8, 6), mat(0x111111, { flatShading: false }), false); pupil.position.set(x, 0.24, 0.93); g.add(pupil);
    });
    return g;
  }

  /* ---------- 島上的東西 ---------- */
  function tree(r) {
    const g = new T.Group();
    const trunk = mesh(new T.CylinderGeometry(0.12, 0.18, 0.9, 6), mat(0x7a5236)); trunk.position.y = 0.45; g.add(trunk);
    const greens = [0x35704f, 0x468a5f, 0x2c5f45, 0x5a9a72];
    if (r() < 0.55) {
      for (let k = 0; k < 2; k++) {
        const c = mesh(new T.ConeGeometry(0.85 - k * 0.22, 1.3, 7), mat(greens[Math.floor(r() * 4)]));
        c.position.y = 1.3 + k * 0.65; g.add(c);
      }
    } else {
      const c = mesh(new T.DodecahedronGeometry(0.85, 0), mat(greens[Math.floor(r() * 4)])); c.position.y = 1.5; g.add(c);
    }
    g.scale.setScalar(0.8 + r() * 0.6);
    return g;
  }
  function lamp() {
    const g = new T.Group();
    const post = mesh(new T.CylinderGeometry(0.06, 0.08, 1.8, 6), mat(0x2b2f33)); post.position.y = 0.9; g.add(post);
    const head = mesh(new T.BoxGeometry(0.3, 0.32, 0.3), mat(0xfff2c2, { emissive: 0xffc96b, emissiveIntensity: 0.15 })); head.position.y = 1.9; g.add(head);
    const cap = mesh(new T.ConeGeometry(0.26, 0.2, 4), mat(0x2b2f33)); cap.position.y = 2.15; cap.rotation.y = Math.PI / 4; g.add(cap);
    lamps.push(head.material);
    return g;
  }
  function house(roof, r) {
    const g = new T.Group();
    const w = 1.3 + r() * 0.6, d = 1.1 + r() * 0.4;
    const body = mesh(new T.BoxGeometry(w, 1.05, d), mat(0xf1e6cf)); body.position.y = 0.52; g.add(body);
    const top = mesh(new T.ConeGeometry(Math.max(w, d) * 0.82, 0.9, 4), mat(roof)); top.position.y = 1.5; top.rotation.y = Math.PI / 4; g.add(top);
    const door = mesh(new T.BoxGeometry(0.3, 0.55, 0.05), mat(0x6b4429)); door.position.set(0, 0.28, d / 2 + 0.01); g.add(door);
    const win = mesh(new T.BoxGeometry(0.28, 0.25, 0.05), mat(0xbfe3ef, { emissive: 0xffd27a, emissiveIntensity: 0 })); win.position.set(w * 0.28, 0.65, d / 2 + 0.01); g.add(win);
    lamps.push(win.material);
    g.userData.w = w; g.userData.d = d;
    return g;
  }
  // 壁掛式分離式冷氣：白色機身、灰色出風口、右側運轉指示燈、下方導風葉片
  function aircon() {
    const g = new T.Group();
    const body = mesh(new T.BoxGeometry(1.25, 0.36, 0.3), mat(0xf7fbfd)); g.add(body);
    const face = mesh(new T.BoxGeometry(1.15, 0.28, 0.02), mat(0xffffff)); face.position.set(0, 0.01, 0.155); g.add(face);
    const brand = mesh(new T.BoxGeometry(0.3, 0.035, 0.012), mat(0xbcd6e2)); brand.position.set(-0.32, 0.09, 0.17); g.add(brand);
    const vent = mesh(new T.BoxGeometry(1.02, 0.09, 0.05), mat(0x8fa3ad)); vent.position.set(0, -0.13, 0.14); g.add(vent);
    for (let k = 0; k < 4; k++) {
      const lv = mesh(new T.BoxGeometry(1.0, 0.018, 0.06), mat(0xb9c9d0));
      lv.position.set(0, -0.1 - k * 0.045, 0.16); lv.rotation.x = -0.35; g.add(lv);
    }
    const light = mesh(new T.SphereGeometry(0.035, 8, 6),
      new T.MeshStandardMaterial({ color: 0x8fe3ff, emissive: 0x4fc3e8, emissiveIntensity: 1.4, flatShading: false }), false);
    light.position.set(0.52, -0.02, 0.17); g.add(light);
    const puffs = [];
    for (let k = 0; k < 4; k++) {
      const p = mesh(new T.IcosahedronGeometry(0.09, 0), mat(0xdff4ff, { transparent: true, opacity: 0.45 }), false);
      g.add(p); puffs.push(p);
    }
    g.userData.ac = { light, puffs };
    return g;
  }
  function dock(len) {
    const g = new T.Group();
    for (let k = 0; k < len; k++) {
      const plank = mesh(new T.BoxGeometry(1.6, 0.12, 0.42), mat(k % 2 ? 0x8a6142 : 0x9b6f4b)); plank.position.set(0, 0.35, k * 0.46); g.add(plank);
    }
    [[-0.75, 0.2], [0.75, 0.2], [-0.75, len * 0.46 - 0.2], [0.75, len * 0.46 - 0.2]].forEach(([x, z]) => {
      const post = mesh(new T.CylinderGeometry(0.09, 0.09, 1.1, 6), mat(0x5d4330)); post.position.set(x, 0.1, z); g.add(post);
    });
    return g;
  }
  const landmarks = {
    ask(accent, r) { // 小村子：去問人
      const g = new T.Group();
      const a = house(accent, r); g.add(a);
      const b = house(0x2f5d86, r); b.position.set(-2.2, 0, 1.2); b.rotation.y = 0.5; g.add(b);
      const well = mesh(new T.CylinderGeometry(0.45, 0.5, 0.5, 8), mat(0x9aa0a3)); well.position.set(1.6, 0.25, 1.4); g.add(well);
      // 小安家的老房子牆上，掛著一台白色分離式冷氣
      const ac = aircon(); ac.scale.setScalar(0.85); ac.position.set(a.userData.w / 2 + 0.02, 0.86, 0); ac.rotation.y = Math.PI / 2; g.add(ac);
      g.userData.ac = ac.userData.ac;
      return g;
    },
    define(accent) { // 燈塔
      const g = new T.Group();
      for (let k = 0; k < 5; k++) {
        const s = mesh(new T.CylinderGeometry(0.62 - k * 0.07, 0.7 - k * 0.07, 0.75, 10), mat(k % 2 ? accent : 0xf6f2ea));
        s.position.y = 0.37 + k * 0.75; g.add(s);
      }
      const glow = mesh(new T.CylinderGeometry(0.42, 0.42, 0.5, 10), mat(0xfff0b5, { emissive: 0xffd36b, emissiveIntensity: 0.8 })); glow.position.y = 4.05; g.add(glow);
      const cap = mesh(new T.ConeGeometry(0.62, 0.65, 10), mat(0x2d3e48)); cap.position.y = 4.65; g.add(cap);
      g.userData.glow = glow;
      return g;
    },
    ideate(accent) { // 風車
      const g = new T.Group();
      const tw = mesh(new T.CylinderGeometry(0.75, 1.1, 3, 8), mat(0xe9dcc2)); tw.position.y = 1.5; g.add(tw);
      const cap = mesh(new T.ConeGeometry(1.0, 1.0, 8), mat(accent)); cap.position.y = 3.5; g.add(cap);
      const hub = new T.Group(); hub.position.set(0, 2.9, 1.0); g.add(hub);
      for (let k = 0; k < 4; k++) {
        const arm = new T.Group(); arm.rotation.z = (k / 4) * Math.PI * 2;
        const pole = mesh(new T.BoxGeometry(0.1, 2.2, 0.08), mat(0x6b4a30)); pole.position.y = 1.1; arm.add(pole);
        const sail = mesh(new T.BoxGeometry(0.55, 1.5, 0.04), mat(0xf7f2e6)); sail.position.set(0.3, 1.3, 0); arm.add(sail);
        hub.add(arm);
      }
      g.userData.spin = hub;
      return g;
    },
    build(accent) { // 工坊
      const g = new T.Group();
      const shop = mesh(new T.BoxGeometry(2.6, 1.5, 1.8), mat(0xd9c2a0)); shop.position.y = 0.75; g.add(shop);
      const roof = mesh(new T.BoxGeometry(2.9, 0.25, 2.1), mat(accent)); roof.position.y = 1.62; g.add(roof);
      const chim = mesh(new T.CylinderGeometry(0.22, 0.26, 1.3, 6), mat(0x5e5e5e)); chim.position.set(0.8, 2.3, -0.4); g.add(chim);
      const anvil = mesh(new T.BoxGeometry(0.7, 0.4, 0.35), mat(0x3d4246)); anvil.position.set(-1.8, 0.2, 1.2); g.add(anvil);
      const crate = mesh(new T.BoxGeometry(0.6, 0.6, 0.6), mat(0xc79a5a)); crate.position.set(1.8, 0.3, 1.3); g.add(crate);
      // 工坊牆上也放一台冷氣，當作這一趟要做的家電
      const ac = aircon(); ac.scale.setScalar(1.15); ac.position.set(0, 1.0, 0.93); g.add(ac);
      g.userData.ac = ac.userData.ac;
      const smoke = [];
      for (let k = 0; k < 3; k++) {
        const puff = mesh(new T.IcosahedronGeometry(0.28, 0), mat(0xe6e6e6, { transparent: true }), false);
        g.add(puff); smoke.push(puff);
      }
      g.userData.smoke = smoke;
      return g;
    },
    test(accent) { // 帳篷和觀察台
      const g = new T.Group();
      const tent = mesh(new T.ConeGeometry(1.4, 1.8, 6), mat(accent)); tent.position.y = 0.9; g.add(tent);
      const deck = mesh(new T.BoxGeometry(1.4, 0.15, 1.4), mat(0x8a6142)); deck.position.set(-2, 1.6, 0.4); g.add(deck);
      [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]].forEach(([x, z]) => {
        const leg = mesh(new T.CylinderGeometry(0.07, 0.07, 1.6, 5), mat(0x5d4330)); leg.position.set(-2 + x, 0.8, 0.4 + z); g.add(leg);
      });
      const pole = mesh(new T.CylinderGeometry(0.05, 0.05, 2.6, 5), mat(0x6b6b6b)); pole.position.set(1.5, 1.3, 0.6); g.add(pole);
      const flag = mesh(new T.BoxGeometry(0.8, 0.48, 0.03), mat(0xe8743b)); flag.position.set(1.9, 2.35, 0.6); g.add(flag);
      g.userData.flag = flag;
      return g;
    },
    center(accent) { // 鐘塔與小廣場
      const g = new T.Group();
      const plaza = mesh(new T.CylinderGeometry(3, 3.1, 0.12, 16), mat(0xcfc3a8)); plaza.position.y = 0.06; g.add(plaza);
      const base = mesh(new T.CylinderGeometry(0.95, 1.1, 4.2, 8), mat(0xefe6d2)); base.position.y = 2.1; g.add(base);
      const face = mesh(new T.CylinderGeometry(0.62, 0.62, 0.1, 20), mat(0xffffff, { flatShading: false })); face.rotation.x = Math.PI / 2; face.position.set(0, 3.4, 1.0); g.add(face);
      const hand = mesh(new T.BoxGeometry(0.07, 0.5, 0.05), mat(0x2f3a44)); hand.position.set(0, 3.4, 1.07); g.add(hand);
      const roof = mesh(new T.ConeGeometry(1.35, 1.8, 8), mat(accent)); roof.position.y = 5.1; g.add(roof);
      for (let k = 0; k < 3; k++) {
        const bench = mesh(new T.BoxGeometry(1, 0.2, 0.35), mat(0x8a6142)); const a = (k / 3) * Math.PI * 2 + 0.5;
        bench.position.set(Math.cos(a) * 2.3, 0.3, Math.sin(a) * 2.3); bench.rotation.y = -a; g.add(bench);
      }
      g.userData.hand = hand;
      return g;
    }
  };

  function makeIsland(spec, seed) {
    const g = new T.Group();
    const r = spec.r, rnd = rand(seed * 13 + 5);
    const mats = [];
    const keep = (m) => { if (!mats.find(x => x.m === m)) mats.push({ m, base: m.color.clone() }); return m; };

    const shallow = new T.Mesh(wobble(new T.CircleGeometry(r * 1.42, 40), seed, 0.1), new T.MeshBasicMaterial({ color: 0x8fd6e6, transparent: true, opacity: 0.3, depthWrite: false }));
    shallow.geometry.rotateX(-Math.PI / 2); shallow.position.y = 0.02; g.add(shallow);
    const sand = mesh(wobble(new T.CylinderGeometry(r * 1.15, r * 1.3, 1.2, 40, 1), seed, 0.1), keep(mat(0xe2cf9f))); sand.position.y = -0.3; g.add(sand);
    const earth = mesh(wobble(new T.CylinderGeometry(r * 1.0, r * 1.08, 0.8, 40, 1), seed, 0.1), keep(mat(0x7c6046))); earth.position.y = 0.3; g.add(earth);
    const grassCol = shade(0x74a98a, 0.92 + rnd() * 0.14);
    const grass = mesh(wobble(new T.CylinderGeometry(r * 0.98, r * 1.0, 0.25, 40, 1), seed, 0.1), keep(mat(grassCol))); grass.position.y = 0.78; g.add(grass);
    const top = 0.9;

    const lm = landmarks[spec.landmark](spec.accent, rnd);
    lm.position.set(0, top, -r * 0.15);
    g.add(lm);
    // 碼頭朝向群島中央
    const toCenter = Math.atan2(-spec.x, -spec.z);
    if (spec.landmark !== "center") {
      const d = dock(6);
      d.position.set(Math.sin(toCenter) * r * 0.85, 0, Math.cos(toCenter) * r * 0.85);
      d.rotation.y = toCenter; g.add(d);
    }
    for (let k = 0; k < 3; k++) {
      const a = toCenter + (k - 1) * 0.9;
      const l = lamp(); l.position.set(Math.sin(a) * r * 0.62, top, Math.cos(a) * r * 0.62); g.add(l);
    }
    if (spec.landmark !== "ask" && spec.landmark !== "center") {
      const h = house(spec.accent, rnd); h.position.set(-r * 0.5, top, r * 0.25); h.rotation.y = rnd() * 6; g.add(h);
    }
    const nTrees = 9 + Math.floor(rnd() * 5);
    for (let k = 0; k < nTrees; k++) {
      const a = rnd() * Math.PI * 2, d = r * (0.45 + rnd() * 0.45);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.hypot(x, z + r * 0.15) < 2.8) continue;
      if (Math.abs(((a - (Math.PI / 2 - toCenter)) + Math.PI * 3) % (Math.PI * 2) - Math.PI) < 0.4) continue;
      const t = tree(rnd); t.position.set(x, top, z); t.rotation.y = rnd() * 6; g.add(t);
    }
    for (let k = 0; k < 6; k++) {
      const a = rnd() * Math.PI * 2;
      const rock = mesh(new T.DodecahedronGeometry(0.25 + rnd() * 0.35, 0), mat(0x8c9599));
      rock.position.set(Math.cos(a) * r * 1.12, 0.25, Math.sin(a) * r * 1.12); g.add(rock);
    }
    for (let k = 0; k < 10; k++) {
      const a = rnd() * Math.PI * 2, d = r * (0.3 + rnd() * 0.6);
      const f = mesh(new T.SphereGeometry(0.1, 5, 4), mat([0xf2c94c, 0xeb7b9a, 0xffffff, 0xb48ae6][k % 4]), false);
      f.position.set(Math.cos(a) * d, top + 0.08, Math.sin(a) * d); g.add(f);
    }
    g.traverse(o => { if (o.isMesh && o.material !== shallow.material && !o.material.emissive?.getHex?.()) keep(o.material); });

    const keeper = figure(spec.keeperStyle, 1.05);
    keeper.position.set(r * 0.35, top, r * 0.2); keeper.rotation.y = toCenter; g.add(keeper);
    const keeperRing = ring(0xf2b866); keeperRing.position.set(r * 0.35, top + 0.02, r * 0.2); g.add(keeperRing);

    // 小安：去問島過關之前站在去問島（她就是那裡的守門人），過關之後改站到給他用島的守門人旁邊
    let partner = null;
    if (spec.partnerStyle) {
      partner = figure(spec.partnerStyle, 1.05);
      partner.position.set(r * 0.35 + 1.4, top, r * 0.2 - 0.6); partner.rotation.y = toCenter; partner.visible = false; g.add(partner);
    }

    let mon = null;
    if (spec.monsterColor) { mon = monster(spec.monsterColor); g.add(mon); }

    // 兩位走來走去的居民
    for (let k = 0; k < 2; k++) {
      const w = figure({ body: [0x7aa6c2, 0xc98b6b, 0x9c7cc4, 0x6aa77a][(seed + k) % 4], hat: "dome", hatColor: 0x3d3d3d }, 0.75);
      g.add(w);
      walkers.push({ o: w, r: r * (0.5 + k * 0.15), speed: 0.15 + k * 0.08, phase: seed + k * 3, y: top });
    }

    g.position.set(spec.x, 0, spec.z);
    g.traverse(o => { o.userData.isleId = spec.id; });
    scene.add(g);
    isles[spec.id] = { group: g, mats, mon, lm, keeper, partner, partnerFrom: spec.partnerFrom, r, phase: seed * 1.7, top };
  }

  function makeRoutes() {
    for (let i = 0; i < order.length - 1; i++) {
      const a = isles[order[i]].group.position, b = isles[order[i + 1]].group.position;
      const mid = a.clone().add(b).multiplyScalar(0.5).multiplyScalar(0.8);
      const curve = new T.QuadraticBezierCurve3(a.clone(), mid, b.clone());
      const pts = curve.getSpacedPoints(22).slice(5, 18);
      const buoys = pts.map(p => {
        const m = mesh(new T.CylinderGeometry(0.16, 0.2, 0.3, 8), new T.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.5 }));
        m.position.set(p.x, 0.1, p.z); scene.add(m); return m;
      });
      routes.push({ from: order[i], buoys });
    }
  }

  function makeBridges() {
    const plank = mat(0xb08456), rail = mat(0x6e5139), gateM = mat(0xc0563a), postM = mat(0x5b4636);
    for (let i = 0; i < order.length - 1; i++) {
      const A = isles[order[i]], B = isles[order[i + 1]];
      const P = A.group.position.clone(), Q = B.group.position.clone();
      const dir = Q.clone().sub(P); dir.y = 0; dir.normalize();
      const a = P.clone().add(dir.clone().multiplyScalar(A.r * 0.9)); a.y = 0;
      const b = Q.clone().sub(dir.clone().multiplyScalar(B.r * 0.9)); b.y = 0;
      const len = a.distanceTo(b), ang = Math.atan2(dir.x, dir.z);
      const g = new T.Group();
      g.position.copy(a.clone().add(b).multiplyScalar(0.5)); g.rotation.y = ang;
      const deck = mesh(new T.BoxGeometry(2.2, 0.22, len + 1.2), plank); deck.position.y = 0.78; g.add(deck);
      [-1.15, 1.15].forEach(x => {
        const r = mesh(new T.BoxGeometry(0.12, 0.12, len + 1.2), rail); r.position.set(x, 1.45, 0); g.add(r);
        for (let k = 0; k <= Math.floor(len / 2.5); k++) {
          const post = mesh(new T.BoxGeometry(0.14, 0.75, 0.14), rail); post.position.set(x, 1.1, -len / 2 + k * (len / Math.max(1, Math.floor(len / 2.5)))); g.add(post);
        }
      });
      // 橋頭的門：兩根柱子加一片門板，過關後門板往上收
      const gate = new T.Group(); gate.position.set(0, 0.9, -len / 2 + 0.6);
      [-1.25, 1.25].forEach(x => { const pst = mesh(new T.BoxGeometry(0.3, 2.6, 0.3), postM); pst.position.set(x, 1.3, 0); gate.add(pst); });
      const top = mesh(new T.BoxGeometry(2.8, 0.25, 0.32), postM); top.position.y = 2.6; gate.add(top);
      const door = mesh(new T.BoxGeometry(2.2, 1.7, 0.16), gateM); door.position.y = 0.85; gate.add(door);
      g.add(gate);
      scene.add(g);
      bridges.push({ from: order[i], to: order[i + 1], a, b, len, door, open: false, lift: 0 });
    }
  }

  function makeScenery() {
    // 遠山：被霧吃掉一半，讓群島有深度
    const r = rand(7);
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI * 2 + r() * 0.2;
      const d = 150 + r() * 50, h = 18 + r() * 40;
      const m = mesh(new T.ConeGeometry(10 + r() * 14, h, 5), mat(0x4a7a8c), false);
      m.position.set(Math.cos(a) * d, h / 2 - 2, Math.sin(a) * d); m.rotation.y = r() * 3;
      scene.add(m);
    }
    // 小帆船
    for (let k = 0; k < 4; k++) {
      const b = new T.Group();
      const hull = mesh(new T.BoxGeometry(0.8, 0.35, 2), mat(0x8a5a3b)); hull.position.y = 0.15; b.add(hull);
      const mast = mesh(new T.CylinderGeometry(0.05, 0.05, 2, 5), mat(0x5d4330)); mast.position.y = 1.2; b.add(mast);
      const sailGeo = new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0.4, 0.1), new T.Vector3(0, 2.1, 0.1), new T.Vector3(0, 0.4, 1.1)]);
      sailGeo.computeVertexNormals();
      const sail = new T.Mesh(sailGeo, new T.MeshStandardMaterial({ color: 0xf6f0e2, side: T.DoubleSide, flatShading: true }));
      b.add(sail);
      b.userData = { rad: 45 + k * 6, speed: 0.02 + k * 0.006, phase: k * 1.6 };
      scene.add(b); boats.push(b);
    }
    // 少量雪花：慢慢飄，不擋視線
    for (let k = 0; k < 16; k++) {
      const s = mesh(new T.OctahedronGeometry(0.09, 0),
        new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbfeaff, emissiveIntensity: 0.45, flatShading: true }), false);
      s.position.set((r() - 0.5) * 90, 3 + r() * 12, (r() - 0.5) * 90);
      s.userData = { speed: 0.35 + r() * 0.45, phase: r() * 6, base: (r() - 0.5) * 90 };
      scene.add(s); snow.push(s);
    }
  }

  /* ---------- 天色 ---------- */
  const MOODS = {
    dawn: { bg: 0xa9d6e6, fog: [0xa9d6e6, 90, 260], hemi: [0xffffff, 0x2a6a80, 1.05], sun: [0xffffff, 1.9], water: 0x2a7f9c, lamp: 0.15 },
    fog: { bg: 0xc8dfe8, fog: [0xc8dfe8, 25, 140], hemi: [0xf2fbff, 0x5b7f8c, 1.2], sun: [0xffffff, 0.9], water: 0x4b93a8, lamp: 0.35 },
    night: { bg: 0x14324a, fog: [0x14324a, 80, 240], hemi: [0xa9c8e8, 0x153040, 0.95], sun: [0xc9dcff, 1.0], water: 0x144a63, lamp: 1.8 }
  };
  function applyMood(name) {
    mood = MOODS[name] ? name : "dawn";
    const m = MOODS[mood];
    scene.background.set(m.bg);
    scene.fog.color.set(m.fog[0]); scene.fog.near = m.fog[1]; scene.fog.far = m.fog[2];
    hemi.color.set(m.hemi[0]); hemi.groundColor.set(m.hemi[1]); hemi.intensity = m.hemi[2];
    sun.color.set(m.sun[0]); sun.intensity = m.sun[1];
    water.material.color.set(m.water);
    lamps.forEach(l => { l.emissiveIntensity = m.lamp; });
  }

  /* ---------- 初始化 ---------- */
  function init(el, spec) {
    container = el;
    try {
      if (!T) return false;
      renderer = new T.WebGLRenderer({ antialias: true });
      if (!renderer.getContext()) return false;
    } catch (e) { return false; }
    ok = true;
    onPick = spec.onPick || onPick;
    onNear = spec.onNear || onNear;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.domElement.className = "world-canvas";
    container.appendChild(renderer.domElement);
    labelLayer = document.createElement("div");
    labelLayer.className = "world-labels";
    container.appendChild(labelLayer);

    scene = new T.Scene();
    scene.background = new T.Color(0xa9d6e6);
    scene.fog = new T.Fog(0xa9d6e6, 90, 260);
    camera = new T.PerspectiveCamera(38, 1, 0.5, 600);

    hemi = new T.HemisphereLight(0xffffff, 0x2a6a80, 1.05); scene.add(hemi);
    sun = new T.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-35, 60, 25); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 160 });
    sun.shadow.bias = -0.0006;
    scene.add(sun);

    const wg = new T.PlaneGeometry(700, 700, 110, 110); wg.rotateX(-Math.PI / 2);
    water = new T.Mesh(wg, new T.MeshStandardMaterial({ color: 0x2a7f9c, roughness: 0.25, metalness: 0.1, flatShading: true }));
    water.receiveShadow = true; water.position.y = -0.1; scene.add(water);
    waterBase = Float32Array.from(wg.attributes.position.array);

    order = spec.islands.map(s => s.id).concat([spec.center.id]);
    spec.islands.forEach((s, i) => makeIsland(s, i + 1));
    makeIsland(spec.center, 9);
    makeBridges();
    makeScenery();

    playerStyle = spec.player;
    player = new T.Group();
    player.add(figure(spec.player, 1.15));
    player.add(ring(0xffffff));
    // 出生在碼頭邊，離守門人有一段路，要自己走過去
    const home = isles[spec.start] ? spec.start : order[0], hp = isles[home].group.position, ha = Math.atan2(-hp.x, -hp.z);
    player.position.set(hp.x + Math.sin(ha) * isles[home].r * 0.78, isles[home].top, hp.z + Math.cos(ha) * isles[home].r * 0.78);
    if (home === "center") player.position.set(hp.x, isles[home].top, hp.z + isles[home].r * 0.7);
    placed = true;
    scene.add(player);

    spec.islands.concat([spec.center]).forEach(s => {
      const b = document.createElement("button");
      b.className = "world-label"; b.dataset.id = s.id;
      b.addEventListener("click", () => onPick(s.id));
      labelLayer.appendChild(b);
      isles[s.id].label = b;
    });

    raycaster = new T.Raycaster();
    bindControls();
    bindKeys();
    makePad();
    window.addEventListener("resize", resize);
    resize();
    const ov = overview(); Object.assign(cam, { theta: ov.theta, phi: ov.phi, dist: ov.dist }); cam.target.copy(ov.target);
    applyMood("dawn");
    clock = new T.Clock();
    renderer.setAnimationLoop(loop);
    return true;
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    // 直的螢幕把鏡頭拉遠一點，才裝得下整個群島
    camera.fov = w / h < 0.8 ? 52 : 38;
    if (panelOpen && w > 720) camera.setViewOffset(w, h, panelW / 2, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  /* ---------- 操作：拖曳旋轉、滾輪或兩指縮放、點一下登島 ---------- */
  function bindControls() {
    const el = renderer.domElement;
    const pts = new Map();
    let start = null, moved = 0, pinch = 0;
    el.addEventListener("pointerdown", e => {
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = { x: e.clientX, y: e.clientY }; moved = 0; cam.goal = null;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    el.addEventListener("pointermove", e => {
      if (!pts.has(e.pointerId)) { hover = pickAt(e.clientX, e.clientY); el.style.cursor = hover ? "pointer" : "grab"; return; }
      const prev = pts.get(e.pointerId);
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved += Math.abs(dx) + Math.abs(dy);
      if (pts.size === 1) {
        cam.theta -= dx * 0.006;
        cam.phi = Math.min(1.35, Math.max(0.35, cam.phi - dy * 0.005));
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) cam.dist = Math.min(150, Math.max(14, cam.dist * pinch / d));
        pinch = d;
      }
    });
    const up = e => {
      if (pts.size === 1 && moved < 6 && start) { const id = pickAt(e.clientX, e.clientY); if (id) onPick(id); }
      pts.delete(e.pointerId); if (pts.size < 2) pinch = 0;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", e => { pts.delete(e.pointerId); });
    el.addEventListener("wheel", e => {
      e.preventDefault(); cam.goal = null;
      cam.dist = Math.min(150, Math.max(14, cam.dist * (1 + Math.sign(e.deltaY) * 0.08)));
    }, { passive: false });
  }
  function pickAt(x, y) {
    const r = renderer.domElement.getBoundingClientRect();
    const p = new T.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(p, camera);
    const hits = raycaster.intersectObjects(Object.values(isles).map(i => i.group), true);
    return hits.length ? hits[0].object.userData.isleId : null;
  }

  /* ---------- 鏡頭移動 ---------- */
  function flyTo(view) {
    if (calm) { Object.assign(cam, { theta: view.theta, phi: view.phi, dist: view.dist }); cam.target.copy(view.target); cam.goal = null; return; }
    cam.goal = { target: view.target.clone(), theta: view.theta, phi: view.phi, dist: view.dist };
  }
  function focus(id) {
    if (!ok) return;
    if (!id || !isles[id]) return flyTo(overview());
    const p = isles[id].group.position;
    const outward = Math.atan2(p.x, p.z);
    flyTo({ target: new T.Vector3(p.x, 1, p.z), theta: id === "center" ? cam.theta : outward, phi: 0.82, dist: 34 });
  }
  function followPlayer() {
    if (!ok) return;
    flyTo({ target: player.position.clone(), theta: cam.theta, phi: 0.7, dist: 18 });
  }

  /* ---------- 狀態 ---------- */
  const gray = new T.Color(0x8c9497);
  function update(v) {
    if (!ok) return;
    calm = !!v.calm;
    if (!!v.panelOpen !== panelOpen) { panelOpen = !!v.panelOpen; resize(); }
    if (v.mood && v.mood !== mood) applyMood(v.mood);
    Object.entries(isles).forEach(([id, it]) => {
      const locked = !!(v.locked && v.locked[id]);
      it.mats.forEach(({ m, base }) => m.color.copy(base).lerp(gray, locked ? 0.55 : 0));
      if (it.mon) it.mon.visible = !(v.passed && v.passed[id]);
      if (it.partner && isles[it.partnerFrom]) {
        const moved = !!(v.passed && v.passed[it.partnerFrom]);
        it.partner.visible = moved;
        isles[it.partnerFrom].keeper.visible = !moved;
      }
      const lab = v.labels[id];
      it.label.innerHTML = `<span class="wl-num">${lab.num}</span><span class="wl-text"><b>${lab.title}</b><small>${lab.sub}</small></span>`;
      it.label.classList.toggle("locked", locked);
      it.label.classList.toggle("done", !!(v.passed && v.passed[id]));
      it.label.classList.toggle("current", v.current === id);
      it.label.setAttribute("aria-label", lab.aria);
    });
    bridges.forEach(br => { br.open = !!(v.passed && v.passed[br.from]); });
    if (v.player && v.player !== playerStyle) {
      playerStyle = v.player;
      player.remove(player.children[0]); player.add(figure(v.player, 1.15));
    }
    if (!placed) { const target = v.current && isles[v.current] ? v.current : null; if (target !== playerAt) movePlayer(target); }
  }
  function spot(id) {
    if (!id) return new T.Vector3(0, 0.9, 14);
    const it = isles[id];
    const p = it.group.position, a = Math.atan2(-p.x, -p.z);
    return new T.Vector3(p.x + Math.sin(a) * it.r * 0.45 + 1.2, it.top, p.z + Math.cos(a) * it.r * 0.45);
  }
  function movePlayer(id) {
    playerAt = id;
    const to = spot(id);
    if (calm) { player.position.copy(to); playerAnim = null; return; }
    playerAnim = { from: player.position.clone(), to, t: 0 };
  }

  /* ---------- 走路 ---------- */
  function bindKeys() {
    const map = { ArrowUp: "u", KeyW: "u", ArrowDown: "d", KeyS: "d", ArrowLeft: "l", KeyA: "l", ArrowRight: "r", KeyD: "r" };
    window.addEventListener("keydown", e => {
      const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = map[e.code]; if (!k) return;
      keys.add(k); e.preventDefault();
    });
    window.addEventListener("keyup", e => { const k = map[e.code]; if (k) keys.delete(k); });
    window.addEventListener("blur", () => keys.clear());
  }
  function makePad() {
    const pad = document.createElement("div"); pad.className = "walk-pad";
    pad.setAttribute("aria-label", "方向鍵");
    [["u", "▲", "往前走"], ["l", "◀", "往左走"], ["r", "▶", "往右走"], ["d", "▼", "往後走"]].forEach(([k, t, label]) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "walk-" + k; b.textContent = t; b.setAttribute("aria-label", label);
      const on = e => { e.preventDefault(); keys.add(k); }, off = () => keys.delete(k);
      b.addEventListener("pointerdown", on); b.addEventListener("pointerup", off); b.addEventListener("pointerleave", off); b.addEventListener("pointercancel", off);
      pad.appendChild(b);
    });
    container.appendChild(pad);
  }
  function onBridge(x, z) {
    for (const br of bridges) {
      if (!br.open) continue;
      const dx = br.b.x - br.a.x, dz = br.b.z - br.a.z, L2 = dx * dx + dz * dz;
      let t = ((x - br.a.x) * dx + (z - br.a.z) * dz) / L2;
      if (t < -0.15 || t > 1.15) continue;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - (br.a.x + dx * t), z - (br.a.z + dz * t)) < 0.95) return true;
    }
    return false;
  }
  function walkable(x, z) {
    for (const it of Object.values(isles)) {
      const p = it.group.position;
      if (Math.hypot(x - p.x, z - p.z) < it.r * 0.92) return true;
    }
    return onBridge(x, z);
  }
  function keeperPos(it) { return it.group.position.clone().add(it.keeper.position); }
  function walk(dt) {
    if (!keys.size || playerAnim) return;
    let fx = 0, fz = 0;
    if (keys.has("u")) fz += 1; if (keys.has("d")) fz -= 1; if (keys.has("l")) fx -= 1; if (keys.has("r")) fx += 1;
    if (!fx && !fz) return;
    const sx = -Math.sin(cam.theta), sz = -Math.cos(cam.theta);   // 鏡頭看出去的方向
    let mx = sx * fz + (-sz) * fx, mz = sz * fz + sx * fx;
    const n = Math.hypot(mx, mz); mx /= n; mz /= n;
    const step = WALK_SPEED * dt, p = player.position;
    if (walkable(p.x + mx * step, p.z + mz * step)) { p.x += mx * step; p.z += mz * step; }
    else if (walkable(p.x + mx * step, p.z)) p.x += mx * step;
    else if (walkable(p.x, p.z + mz * step)) p.z += mz * step;
    p.y = 0.9 + Math.abs(Math.sin(clock.elapsedTime * 10)) * 0.08;
    player.rotation.y = Math.atan2(mx, mz);
    if (!walking) { walking = true; cam.goal = null; cam.phi = Math.min(cam.phi, 0.9); cam.dist = Math.min(cam.dist, 34); }
    cam.target.lerp(tmp.set(p.x, 1, p.z), 0.15);
    // 走到守門人身邊
    let near = null;
    for (const [id, it] of Object.entries(isles)) if (keeperPos(it).distanceTo(tmp.set(p.x, it.top, p.z)) < NEAR) near = id;
    if (near !== nearId) { nearId = near; if (near) onNear(near); }
  }
  function isNear(id) { return nearId === id; }

  /* ---------- 每一格 ---------- */
  const tmp = new T.Vector3();
  function loop() {
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;

    if (cam.goal) {
      const k = 1 - Math.pow(0.002, dt);
      cam.target.lerp(cam.goal.target, k);
      let dTheta = cam.goal.theta - cam.theta;
      dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
      cam.theta += dTheta * k; cam.phi += (cam.goal.phi - cam.phi) * k; cam.dist += (cam.goal.dist - cam.dist) * k;
      if (cam.target.distanceTo(cam.goal.target) < 0.05 && Math.abs(cam.goal.dist - cam.dist) < 0.05) cam.goal = null;
    }
    camera.position.set(
      cam.target.x + cam.dist * Math.sin(cam.phi) * Math.sin(cam.theta),
      cam.target.y + cam.dist * Math.cos(cam.phi),
      cam.target.z + cam.dist * Math.sin(cam.phi) * Math.cos(cam.theta)
    );
    camera.lookAt(cam.target);

    if (!calm) {
      const p = water.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = waterBase[i * 3], z = waterBase[i * 3 + 2];
        p.array[i * 3 + 1] = Math.sin(x * 0.12 + t * 0.9) * 0.18 + Math.cos(z * 0.15 + t * 0.7) * 0.14;
      }
      p.needsUpdate = true;
      if (Math.floor(t * 20) % 2 === 0) water.geometry.computeVertexNormals();

      Object.entries(isles).forEach(([id, it]) => {
        const s = hover === id ? 1.03 : 1;
        it.group.scale.lerp(tmp.set(s, s, s), 0.12);
        if (it.mon && it.mon.visible) {
          const a = t * 0.3 + it.phase;
          it.mon.position.set(Math.cos(a) * it.r * 1.35, 1.6 + Math.sin(t * 1.8 + it.phase) * 0.35, Math.sin(a) * it.r * 1.35);
          it.mon.rotation.y = -a + Math.PI;
        }
        const u = it.lm.userData;
        if (u.spin) u.spin.rotation.z += dt * 1.1;
        if (u.flag) u.flag.rotation.y = Math.sin(t * 3) * 0.3;
        if (u.hand) u.hand.rotation.z = -t * 0.4;
        if (u.glow) u.glow.material.emissiveIntensity = (mood === "night" ? 2.2 : 0.8) + Math.sin(t * 2.5) * 0.3;
        if (u.smoke) u.smoke.forEach((s2, k) => {
          const f = (t * 0.35 + k / 3) % 1;
          s2.position.set(0.8 + f * 0.3, 3 + f * 2, -0.4); s2.scale.setScalar(0.6 + f * 1.1); s2.material.opacity = 0.85 * (1 - f);
        });
        if (u.ac) {
          // 指示燈：平常冷冷藍，偶爾轉成琥珀色警告；出風口飄出淡淡冷氣流
          const warn = Math.sin(t * 0.9) > 0.86;
          u.ac.light.material.color.setHex(warn ? 0xffc46b : 0x8fe3ff);
          u.ac.light.material.emissive.setHex(warn ? 0xffa63b : 0x4fc3e8);
          u.ac.light.material.emissiveIntensity = 1.1 + Math.sin(t * 3) * 0.35;
          u.ac.puffs.forEach((p, k) => {
            const f = (t * 0.28 + k / 4) % 1;
            p.position.set(-0.2 + f * 0.4, -0.28 - f * 0.6, 0.24);
            p.scale.setScalar(0.6 + f * 1.4); p.material.opacity = 0.4 * (1 - f);
          });
        }
      });
      walkers.forEach(w => {
        const a = t * w.speed + w.phase;
        w.o.position.set(Math.cos(a) * w.r, w.y + Math.abs(Math.sin(t * 6 + w.phase)) * 0.06, Math.sin(a) * w.r);
        w.o.rotation.y = -a;
      });
      boats.forEach(b => {
        const u = b.userData, a = t * u.speed + u.phase;
        b.position.set(Math.cos(a) * u.rad, Math.sin(t + u.phase) * 0.12, Math.sin(a) * u.rad);
        b.rotation.y = -a; b.rotation.z = Math.sin(t * 1.3 + u.phase) * 0.06;
      });
      snow.forEach(s2 => {
        const u = s2.userData;
        s2.position.y -= u.speed * dt;
        s2.position.x = u.base + Math.sin(t * 0.5 + u.phase) * 1.2;
        s2.rotation.y += dt * 0.6; s2.rotation.x += dt * 0.4;
        if (s2.position.y < 1.2) s2.position.y = 15;
      });
    }

    walk(dt);
    bridges.forEach(br => {
      br.lift += ((br.open ? 1 : 0) - br.lift) * Math.min(1, dt * 3);
      br.door.position.y = 0.85 + br.lift * 2.2; br.door.scale.y = 1 - br.lift * 0.85;
    });

    if (playerAnim) {
      playerAnim.t = Math.min(1, playerAnim.t + dt / 1.1);
      const k = playerAnim.t, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      player.position.lerpVectors(playerAnim.from, playerAnim.to, e);
      player.position.y += Math.sin(k * Math.PI) * 5;
      const dir = tmp.copy(playerAnim.to).sub(playerAnim.from);
      if (dir.lengthSq() > 0.01) player.rotation.y = Math.atan2(dir.x, dir.z);
      if (k >= 1) playerAnim = null;
    }

    renderer.render(scene, camera);

    const w = container.clientWidth, h = container.clientHeight;
    Object.values(isles).forEach(it => {
      tmp.copy(it.group.position); tmp.y = 7;
      tmp.project(camera);
      const vis = tmp.z < 1;
      it.label.style.display = vis ? "" : "none";
      it.label.style.transform = `translate(-50%, -100%) translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h}px)`;
    });
  }

  return { init, update, focus, followPlayer, isNear, get ok() { return ok; } };
})();
