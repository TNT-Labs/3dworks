/* =====================================================================
   STAGE · la scena Three.js attorno a un DesignModel.
   La usano sia lo studio sia la pagina pubblica: identica luce, identico
   piatto, identico materiale, così il pezzo che il cliente vede col codice
   è esattamente quello che l'autore ha disegnato.
   Non contiene un solo comando che modifichi il design: tutto ciò che
   espone (orbita, zoom, sezione, sfaccettato) cambia solo il punto di vista.
   ===================================================================== */
import * as THREE from '/vendor/three/build/three.module.js';
import { OrbitControls } from '/vendor/three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from '/vendor/three/examples/jsm/environments/RoomEnvironment.js';
import { BED } from './design-model.js';

const BG = 0x0f0e0c;
const ACCENT = 0xff6a2b;

/* luce del fondo: radente e sfalsata rispetto alla camera, così le pareti dei
   solchi prendono ombra e l'incisione si legge orbitando sotto il pezzo */
const UNDER = { I:2.1, AZ:.7, EL:.6, FADE:40, R:500 };
const HEMI_GROUND = 0x0c0b09, HEMI_GROUND_UNDER = 0x3a3129;

export class Stage {
  /**
   * @param {object}      opts
   * @param {HTMLElement} opts.container   elemento che ospita il canvas
   * @param {DesignModel} opts.model
   * @param {boolean}     opts.autoRotate
   * @param {boolean}     opts.showBed     piatto e piano della stampante
   */
  constructor({ container, model, autoRotate = true, showBed = true }){
    this.container = container;
    this.model = model;
    this.intro = true;
    this.smooth = true;
    this.cutOn = false;
    this.cutC = 400;
    this.underK = 0;
    this.last = performance.now();
    this.onFrame = null;

    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.localClippingEnabled = true;
    container.prepend(renderer.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.Fog(BG, 620, 1500);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 3000);
    this.camHome = new THREE.Vector3(235, 175, 300);
    this.camera.position.set(430, 330, 520);

    const controls = this.controls = new OrbitControls(this.camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = .06;
    controls.enablePan = false;
    controls.minDistance = 110; controls.maxDistance = 980;
    controls.maxPolarAngle = Math.PI * .72;
    controls.autoRotate = autoRotate; controls.autoRotateSpeed = 1.1;
    controls.target.set(0, 70, 0);
    controls.addEventListener('start', () => {
      this.intro = false;
      if (controls.autoRotate){ controls.autoRotate = false; this.emit('spin', false); }
    });

    this.#buildBed(showBed);
    this.#buildLights();
    this.#buildMeshes();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /* ---------------------------- piatto ---------------------------- */
  #plateTexture(){
    const S = 1024, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#141210'; g.fillRect(0, 0, S, S);
    const step = S / 22;
    for (let i = 0; i <= 22; i++){
      const p = Math.round(i * step) + .5;
      g.strokeStyle = i % 5 === 0 ? 'rgba(235,225,210,.10)' : 'rgba(235,225,210,.04)';
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    }
    g.strokeStyle = 'rgba(235,225,210,.22)'; g.lineWidth = 2; g.strokeRect(1, 1, S-2, S-2);
    g.strokeStyle = 'rgba(255,106,43,.5)';
    g.beginPath(); g.moveTo(S/2-26, S/2); g.lineTo(S/2+26, S/2);
    g.moveTo(S/2, S/2-26); g.lineTo(S/2, S/2+26); g.stroke();
    g.fillStyle = 'rgba(235,225,210,.28)'; g.font = '500 22px monospace';
    g.fillText('ELEGOO NEPTUNE 3 PRO', 34, S - 40);
    g.textAlign = 'right'; g.fillText(`${BED} × ${BED}`, S - 34, S - 40);
    const tx = new THREE.CanvasTexture(c);
    tx.anisotropy = 8; tx.colorSpace = THREE.SRGBColorSpace;
    return tx;
  }

  #buildBed(show){
    this.plateMat = new THREE.MeshStandardMaterial({ roughness:.95, metalness:0, map:this.#plateTexture() });
    this.plate = new THREE.Mesh(new THREE.PlaneGeometry(BED, BED), this.plateMat);
    this.plate.rotation.x = -Math.PI / 2;
    this.plate.receiveShadow = true;
    this.bed = new THREE.Mesh(new THREE.BoxGeometry(BED + 9, 7, BED + 9),
      new THREE.MeshStandardMaterial({ color:0x0a0908, roughness:.9 }));
    this.bed.position.y = -3.6;
    this.showBed = show;
    if (show) this.scene.add(this.plate, this.bed);
  }

  #buildLights(){
    const key = new THREE.DirectionalLight(0xfff0dd, 1.5);
    key.position.set(170, 330, 130);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -240; sc.right = 240; sc.top = 280; sc.bottom = -140; sc.near = 40; sc.far = 900;
    sc.updateProjectionMatrix();
    key.shadow.bias = -3e-4; key.shadow.normalBias = 2.2;

    const rim = new THREE.DirectionalLight(0x9db4c8, .45);
    rim.position.set(-260, 150, -240);

    this.hemi = new THREE.HemisphereLight(0x59503f, HEMI_GROUND, .35);
    /* colori preallocati: la dissolvenza gira a ogni fotogramma e non deve
       creare un oggetto Color per volta */
    this.groundUp = new THREE.Color(HEMI_GROUND);
    this.groundDown = new THREE.Color(HEMI_GROUND_UNDER);

    /* Resta sempre nella scena con intensità 0 quando non serve: accenderla e
       spegnerla con `visible` cambierebbe il numero di luci e costringerebbe
       il browser a ricompilare gli shader, con uno scatto visibile. */
    this.underLight = new THREE.DirectionalLight(0xfff0e2, 0);
    this.scene.add(key, rim, this.hemi, this.underLight);
  }

  #buildMeshes(){
    this.clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 400);
    this.material = new THREE.MeshStandardMaterial({
      color: ACCENT, roughness:.34, metalness:.05, envMapIntensity:.6,
      side: THREE.DoubleSide, clippingPlanes:[this.clipPlane], clipShadows:true,
    });

    const footMat = new THREE.LineBasicMaterial({ color: ACCENT, transparent:true, opacity:.55 });
    const footPts = [];
    for (let i = 0; i <= 72; i++){
      const a = i / 72 * Math.PI * 2;
      footPts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const footGeo = new THREE.BufferGeometry().setFromPoints(footPts);

    this.views = this.model.slots.map(slot => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(slot.pos, 3));
      geo.setIndex(new THREE.BufferAttribute(slot.idx, 1));
      geo.setDrawRange(0, 0);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.rotation.x = -Math.PI / 2;          // dati Z-up, mondo Y-up
      mesh.position.y = .12;
      mesh.castShadow = mesh.receiveShadow = true;
      const foot = new THREE.LineLoop(footGeo, footMat);
      foot.position.y = .6; foot.visible = false;
      this.scene.add(mesh, foot);
      return { slot, geo, mesh, foot };
    });
  }

  /* ---------------------------- aggiornamento ---------------------------- */

  /** Porta sulla GPU i buffer che il modello ha appena riempito. */
  sync(){
    for (const v of this.views){
      const { slot, geo, mesh, foot } = v;
      mesh.visible = slot.visible;
      if (!slot.visible){ foot.visible = false; continue; }
      geo.attributes.position.needsUpdate = true;
      geo.index.needsUpdate = true;
      geo.setDrawRange(0, slot.draw);
      geo.boundingSphere.center.set(slot.sphere.x, slot.sphere.y, slot.sphere.z);
      geo.boundingSphere.radius = slot.sphere.r;
      if (this.smooth) geo.computeVertexNormals();
      mesh.position.set(slot.place.x, .12, -slot.place.y);
      foot.visible = this.model.plateMode && slot.place.footR > 0;
      if (foot.visible){
        foot.position.set(slot.place.x, .6, -slot.place.y);
        foot.scale.set(slot.place.footR, 1, slot.place.footR);
      }
    }
  }

  /* ---------------------------- comandi di vista ---------------------------- */

  setAutoRotate(on){
    this.controls.autoRotate = !!on;
    if (on) this.intro = false;
    this.emit('spin', !!on);
  }
  toggleAutoRotate(){ this.setAutoRotate(!this.controls.autoRotate); }

  resetView(){
    this.intro = false;
    this.camera.position.copy(this.camHome);
    this.controls.target.set(0, (this.model.slots[0].ctx.Ht || 160) * .45, 0);
  }

  setCut(on){ this.cutOn = !!on; this.emit('cut', this.cutOn); }
  toggleCut(){ this.setCut(!this.cutOn); }

  setSmooth(on){
    this.smooth = !!on;
    this.material.flatShading = !this.smooth;
    this.material.needsUpdate = true;
    if (this.smooth) for (const v of this.views) v.geo.computeVertexNormals();
    this.emit('smooth', this.smooth);
  }
  toggleSmooth(){ this.setSmooth(!this.smooth); }

  /** PNG del fotogramma corrente. @returns {Promise<Blob>} */
  snapshot(type = 'image/png'){
    this.renderer.render(this.scene, this.camera);
    return new Promise(resolve => this.renderer.domElement.toBlob(resolve, type));
  }

  resize(){
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------------------- eventi ---------------------------- */
  /* Lo stage non tocca il DOM dell'interfaccia: annuncia i cambi di stato
     (rotazione, sezione, sfaccettato) e chi lo ospita aggiorna i propri bottoni. */
  #handlers = new Map();

  on(name, fn){
    if (!this.#handlers.has(name)) this.#handlers.set(name, []);
    this.#handlers.get(name).push(fn);
    return this;
  }

  emit(name, value){
    for (const fn of this.#handlers.get(name) ?? []) fn(value);
  }

  /* ---------------------------- ciclo ---------------------------- */

  /**
   * Avvia il ciclo di animazione.
   * @param {(dt:number)=>void} onFrame  chiamato prima del disegno: è qui che
   *        lo studio fa avanzare il modello e ricostruisce la geometria
   */
  start(onFrame){
    this.onFrame = onFrame;
    const tick = now => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(.05, (now - this.last) / 1000);
      this.last = now;
      try{ this.onFrame?.(dt); }
      catch(err){ this.emit('error', err); }
      this.#frame(dt);
    };
    this.raf = requestAnimationFrame(tick);

    /* A scheda nascosta il disegno non serve a nessuno: fermarlo libera CPU e
       batteria, e il cronometro riparte da zero al ritorno per non recuperare
       tutto il tempo passato in un solo salto. */
    this.onVisibility = () => {
      if (document.hidden){ this.stop(); return; }
      if (!this.raf){ this.last = performance.now(); this.raf = requestAnimationFrame(tick); }
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  stop(){
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  #frame(dt){
    const under = this.camera.position.y < 0;
    if (this.showBed){ this.plate.visible = !under; this.bed.visible = !under; }

    /* dissolvenza della luce del fondo mentre la camera scende sotto il piatto */
    const k = Math.min(1, Math.max(0, -this.camera.position.y / UNDER.FADE));
    this.underK += (k*k*(3 - 2*k) - this.underK) * Math.min(1, dt * 6);
    if (this.underK < 1e-3 && k === 0) this.underK = 0;
    this.underLight.intensity = UNDER.I * this.underK;
    this.hemi.groundColor.copy(this.groundUp).lerp(this.groundDown, this.underK);
    if (this.underK > 0){
      const az = Math.atan2(this.camera.position.z, this.camera.position.x) + UNDER.AZ;
      const ce = Math.cos(UNDER.EL) * UNDER.R;
      this.underLight.position.set(Math.cos(az) * ce, -Math.sin(UNDER.EL) * UNDER.R, Math.sin(az) * ce);
    }

    const cutTarget = this.cutOn ? 2.5 : 400;
    if (Math.abs(this.cutC - cutTarget) > .1){
      this.cutC += (cutTarget - this.cutC) * Math.min(1, dt * 5);
      this.clipPlane.constant = this.cutC;
    }

    if (this.intro){
      this.camera.position.lerp(this.camHome, 1 - Math.exp(-dt * 2.2));
      if (this.camera.position.distanceTo(this.camHome) < 1.5) this.intro = false;
    }

    const h = this.model.slots[0].ctx.Ht || 160;
    this.controls.target.y += (h * .45 - this.controls.target.y) * Math.min(1, dt * 3.5);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(){
    this.stop();
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
