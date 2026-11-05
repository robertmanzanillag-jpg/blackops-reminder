// Imperative three.js scene for the BlackOps agents office.
//
// three.js is loaded lazily by the React wrapper and passed in as `THREE` (typed loosely on purpose:
// this repo has no bundled three types, and production keeps its own minimal declarations).
// Everything visual here is driven by real agent states: a figure only types, its monitor only
// "runs" and its data line only flows fast when the agent's real endpoint says it is working.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type SceneAgentState = "working" | "needs-setup" | "error" | "offline" | "checking";

export type SceneAgent = {
  id: string;
  name: string;
  label: string;
  state: SceneAgentState;
  color: string;
  screen: "timeline" | "chart" | "code" | "list";
  activity: string[];
  cityRole?: string;
  // Company layer: nickname/battery shown on the floating label, crown for the deputy.
  badge?: string;
  battery?: number;
  deputy?: boolean;
  student?: boolean;
};

export type SceneDepartment = {
  id: string;
  name: string;
  color: string;
  agents: SceneAgent[];
};

export type SceneDebate = { from: string; to: string };

export type SceneData = {
  departments: SceneDepartment[];
  debates: SceneDebate[];
  cityLayout?: "overview" | "detail";
};

export type SceneCallbacks = {
  onFocusDepartment: (departmentId: string | null) => void;
  onSelectAgent: (agentId: string) => void;
  onOpenCityDirector: () => void;
};

const STATE_HEX: Record<SceneAgentState, string> = {
  working: "#34d399",
  "needs-setup": "#fbbf24",
  error: "#fb7185",
  offline: "#71717a",
  checking: "#7dd3fc",
};

const RING_RADIUS = 17;
const DESK_SPACING_X = 3.1;
const DESK_SPACING_Z = 3.6;
const CITY_RING_SPACING = 12;

export function officeCityMapPosition(index: number, count: number) {
  let start = 0;
  let x = 0;
  let z = 0;
  let radius = 0;
  for (let ring = 0; start < count; ring++) {
    const slots = Math.min(8 + ring * 9, count - start);
    radius = (ring + 1) * CITY_RING_SPACING;
    if (index >= start && index < start + slots) {
      const angle = -Math.PI / 2 + ((index - start + (ring % 2) * 0.5) / slots) * Math.PI * 2;
      x = radius * Math.cos(angle);
      z = radius * Math.sin(angle);
    }
    start += slots;
  }
  const span = radius * 2 + 8;
  return { x, z, width: span, depth: span, centerX: 0, centerZ: 0 };
}

export function officeCityDeskPosition(index: number) {
  const firstRow = index < 4;
  return { x: ((index % 4) - (firstRow ? 1.5 : 1)) * 1.34, z: firstRow ? -1 : 1 };
}

type DeskRuntime = {
  agent: SceneAgent;
  departmentId: string;
  group: any;
  body: any;
  head: any;
  leftArm: any;
  rightArm: any;
  light: any;
  canvas: HTMLCanvasElement;
  texture: any;
  label: HTMLDivElement;
  phase: number;
  worldPos: any;
};

type PlatformRuntime = {
  department: SceneDepartment;
  group: any;
  center: any;
  angle: number;
  label: HTMLElement;
  flow?: { curve: any; particles: any[]; speed: number; color: string };
  desks: DeskRuntime[];
  size: { width: number; depth: number };
};

function hexToNumber(hex: string) {
  return parseInt(hex.replace("#", ""), 16);
}

function drawMonitor(ctx: CanvasRenderingContext2D, agent: SceneAgent, t: number) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const accent = STATE_HEX[agent.state];
  const live = agent.state === "working";
  ctx.fillStyle = "#050a14";
  ctx.fillRect(0, 0, w, h);
  // Title bar
  ctx.fillStyle = "#0f1a2c";
  ctx.fillRect(0, 0, w, 22);
  ["#fb7185", "#fbbf24", "#34d399"].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(10 + i * 11, 11, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "bold 12px ui-monospace, monospace";
  ctx.fillText(agent.name.slice(0, 24), 46, 15);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(w - 12, 11, 4.5 + (live ? Math.sin(t * 4) * 1.2 : 0), 0, Math.PI * 2);
  ctx.fill();

  const top = 30;
  const area = h - top - 46;
  if (agent.screen === "timeline") {
    const tracks = ["#38bdf8", "#a78bfa", "#34d399", "#f472b6"];
    tracks.forEach((c, i) => {
      const y = top + 6 + i * (area / 4);
      for (let x = 8; x < w - 8; x += 22) {
        const len = 10 + ((x * 7 + i * 13) % 14);
        ctx.fillStyle = c;
        ctx.globalAlpha = live ? 0.85 : 0.35;
        ctx.fillRect(x, y, len, area / 4 - 8);
      }
    });
    ctx.globalAlpha = 1;
    const playhead = live ? 8 + ((t * 40) % (w - 16)) : w * 0.4;
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(playhead, top, 2, area);
  } else if (agent.screen === "chart") {
    const bars = 12;
    for (let i = 0; i < bars; i++) {
      const base = 0.35 + 0.5 * Math.abs(Math.sin(i * 1.7));
      const wave = live ? 0.12 * Math.sin(t * 2 + i) : 0;
      const bh = Math.max(4, (base + wave) * area);
      ctx.fillStyle = i % 3 === 0 ? accent : "#38bdf8";
      ctx.globalAlpha = live ? 0.9 : 0.4;
      ctx.fillRect(10 + i * ((w - 20) / bars), top + area - bh, (w - 20) / bars - 4, bh);
    }
    ctx.globalAlpha = 1;
  } else if (agent.screen === "code") {
    const offset = live ? Math.floor(t * 3) : 0;
    for (let i = 0; i < 7; i++) {
      const seed = (i + offset) * 37;
      const indent = (seed % 3) * 10;
      const len = 40 + (seed % 120);
      ctx.fillStyle = ["#7dd3fc", "#c4b5fd", "#86efac", "#fda4af"][(i + offset) % 4];
      ctx.globalAlpha = live ? 0.9 : 0.4;
      ctx.fillRect(10 + indent, top + 4 + i * (area / 7), Math.min(len, w - 30 - indent), 5);
    }
    ctx.globalAlpha = 1;
  } else {
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(10, top + 4 + i * (area / 5), w - 20, area / 5 - 6);
      ctx.fillStyle = accent;
      const fill = live ? ((t * 0.3 + i * 0.21) % 1) : 0.3 + i * 0.1;
      ctx.fillRect(10, top + 4 + i * (area / 5), (w - 20) * fill, area / 5 - 6);
    }
  }

  // Real activity lines from the agent's data.
  const lines = agent.activity.length ? agent.activity : [agent.label];
  const scroll = live && lines.length > 2 ? Math.floor(t / 2) % lines.length : 0;
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, h - 44, w, 44);
  ctx.font = "11px ui-monospace, monospace";
  for (let i = 0; i < 2; i++) {
    const line = lines[(scroll + i) % lines.length];
    if (!line) continue;
    ctx.fillStyle = i === 0 ? "#e2e8f0" : "#94a3b8";
    ctx.fillText(`> ${line}`.slice(0, 40), 8, h - 26 + i * 15);
  }
  if (live && Math.floor(t * 2) % 2 === 0) {
    ctx.fillStyle = accent;
    ctx.fillRect(w - 14, h - 18, 7, 11);
  }
}

export function createOfficeScene(THREE: any, host: HTMLDivElement, labelLayer: HTMLDivElement, callbacks: SceneCallbacks, options: { reducedMotion: boolean }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.setClearColor(0x04060b, 1);
  if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x04060b, 45, 110);
  const camera = new THREE.PerspectiveCamera(42, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 400);

  scene.add(new THREE.AmbientLight(0x8fa3c7, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(20, 40, 15);
  scene.add(key);
  const hubLight = new THREE.PointLight(0xffd27a, 2.2, 60, 1.6);
  hubLight.position.set(0, 6, 0);
  scene.add(hubLight);

  // Ground with a faint grid.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.MeshStandardMaterial({ color: 0x070b13, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.2;
  scene.add(ground);
  const grid = new THREE.GridHelper(160, 80, 0x1e293b, 0x0f172a);
  grid.position.y = -1.19;
  scene.add(grid);

  // Central hub: the CEO / orchestrator core with a light beam.
  const hub = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 0.8, 48), new THREE.MeshStandardMaterial({ color: 0x0b1220, metalness: 0.4, roughness: 0.5 }));
  hub.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.08, 12, 96), new THREE.MeshBasicMaterial({ color: 0x67e8f9 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.45;
  hub.add(ring);
  const core = new THREE.Mesh(new THREE.SphereGeometry(1.15, 32, 32), new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb84d, emissiveIntensity: 1.6 }));
  core.position.y = 2;
  hub.add(core);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.55, 26, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  beam.position.y = 15;
  hub.add(beam);
  scene.add(hub);

  const hubLabel = document.createElement("button");
  hubLabel.type = "button";
  hubLabel.addEventListener("click", callbacks.onOpenCityDirector);
  hubLabel.className = "pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md border border-amber-200/40 bg-black/70 px-2 py-1 text-[11px] font-bold tracking-[0.2em] text-amber-100";
  hubLabel.textContent = "CEO · ORQUESTADOR";
  hubLabel.dataset.testid = "world-ceo-orb";
  labelLayer.appendChild(hubLabel);

  const raycastTargets: any[] = [];
  let platforms: PlatformRuntime[] = [];
  let debateArcs: { curve: any; particles: any[]; line: any }[] = [];
  let focused: string | null = null;
  let cityLayout: SceneData["cityLayout"];
  let cityMapSize = officeCityMapPosition(0, 0);
  let overviewDesks: { group: any; animate: (time: number) => void } | undefined;

  // Camera orbit state.
  const target = new THREE.Vector3(0, 0, 0);
  const goalTarget = new THREE.Vector3(0, 0, 0);
  let radius = 52;
  let goalRadius = 52;
  let theta = 0.6;
  let goalTheta = 0.6;
  let phi = 0.95;
  let goalPhi = 0.95;
  let dragging = false;
  let dragMoved = 0;
  let lastX = 0;
  let lastY = 0;
  let lastInteraction = 0;
  let hoveringLabel = false;
  let hoveringStage = false;
  const stage = host.parentElement || host;
  const onStageEnter = () => { hoveringStage = true; };
  const onStageLeave = () => { hoveringStage = false; lastInteraction = performance.now(); };
  stage.addEventListener("pointerenter", onStageEnter);
  stage.addEventListener("pointerleave", onStageLeave);

  // When a department is open, the side panel covers the right side: shift the render so the
  // platform sits in the middle of the free space.
  function applyViewOffset() {
    const w = host.clientWidth;
    const h = Math.max(1, host.clientHeight);
    const panel = focused && w > 900 ? Math.min(400, w * 0.3) : 0;
    if (panel > 0) camera.setViewOffset(w + panel, h, panel, 0, w, h);
    else camera.clearViewOffset();
    camera.aspect = panel > 0 ? (w + panel) / h : w / h;
    camera.updateProjectionMatrix();
  }

  function frameCityOverview() {
    const width = host.clientWidth;
    const height = Math.max(1, host.clientHeight);
    const aspect = Math.max(0.25, width / height);
    const headerSpace = width < 900 ? Math.min(210, height * 0.47) : 0;
    const span = Math.max(cityMapSize.depth / (1 - headerSpace / height), cityMapSize.width / aspect);
    const frustumScale = 2 * Math.tan(Math.PI * camera.fov / 360);
    goalRadius = Math.max(18, span / frustumScale * 1.18);
    camera.far = Math.max(400, goalRadius + 150);
    camera.updateProjectionMatrix();
    scene.fog.near = Math.max(45, goalRadius * 0.85);
    scene.fog.far = Math.max(110, goalRadius * 1.7 + 20);
    goalTarget.set(cityMapSize.centerX + (width >= 900 ? cityMapSize.width * 0.13 : 0), 0, cityMapSize.centerZ + headerSpace / 2 * goalRadius * frustumScale / height);
    goalPhi = 0.22;
    goalTheta = -Math.PI / 2;
  }

  function placeCamera() {
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.cos(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.sin(theta)
    );
    camera.lookAt(target);
  }

  function disposeObject(object: any) {
    object.traverse?.((child: any) => {
      if (child.isInstancedMesh) child.dispose();
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
      materials.forEach((material: any) => {
        material.map?.dispose?.();
        material.dispose?.();
      });
    });
  }

  function clearDynamic() {
    if (overviewDesks) {
      scene.remove(overviewDesks.group);
      disposeObject(overviewDesks.group);
      overviewDesks = undefined;
    }
    platforms.forEach((platform) => {
      scene.remove(platform.group);
      disposeObject(platform.group);
      const lineHolder = platform.group.userData.lineHolder;
      if (lineHolder) {
        scene.remove(lineHolder);
        disposeObject(lineHolder);
      }
      platform.flow?.particles.forEach((particle) => {
        scene.remove(particle);
        disposeObject(particle);
      });
      platform.label.remove();
      platform.desks.forEach((desk) => desk.label.remove());
    });
    debateArcs.forEach((arc) => {
      scene.remove(arc.line);
      disposeObject(arc.line);
      arc.particles.forEach((particle) => {
        scene.remove(particle);
        disposeObject(particle);
      });
    });
    platforms = [];
    debateArcs = [];
    raycastTargets.length = 0;
  }

  function buildDesk(agent: SceneAgent, departmentId: string, x: number, z: number, platformGroup: any): DeskRuntime {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const dark = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8 });
    const wood = new THREE.MeshStandardMaterial({ color: 0xd6c7a8, roughness: 0.7 });
    const desk = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.12, 1.2), wood);
    desk.position.set(0, 1.05, 0);
    group.add(desk);
    [-1, 1].forEach((side) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 1.1), dark);
      leg.position.set(side * 1.05, 0.5, 0);
      group.add(leg);
    });
    // Monitor faces outward (local -z), toward the camera when a department is focused.
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 160;
    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.19), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    screen.position.set(0, 1.95, 0.32);
    screen.rotation.y = Math.PI;
    group.add(screen);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(2.02, 1.3, 0.06), new THREE.MeshStandardMaterial({ color: 0x0b0f17 }));
    bezel.position.set(0, 1.95, 0.36);
    group.add(bezel);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.08), dark);
    stand.position.set(0, 1.25, 0.36);
    group.add(stand);
    // Chair + seated figure, back to the camera, facing the monitor.
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.8), dark);
    seat.position.set(0, 0.62, -1.0);
    group.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.1), dark);
    back.position.set(0, 1.05, -1.4);
    group.add(back);
    const shirt = new THREE.MeshStandardMaterial({ color: hexToNumber(agent.color), roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.45, 6, 12), shirt);
    body.position.set(0, 1.12, -1.0);
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 20), new THREE.MeshStandardMaterial({ color: 0xc58b5c, roughness: 0.6 }));
    head.position.set(0, 1.72, -1.0);
    group.add(head);
    const armGeometry = new THREE.BoxGeometry(0.12, 0.12, 0.6);
    const leftArm = new THREE.Mesh(armGeometry, shirt);
    leftArm.position.set(-0.28, 1.18, -0.68);
    group.add(leftArm);
    const rightArm = new THREE.Mesh(armGeometry.clone(), shirt);
    rightArm.position.set(0.28, 1.18, -0.68);
    group.add(rightArm);
    if (agent.deputy) {
      const crown = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 8, 24), new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xb45309, emissiveIntensity: 0.8, metalness: 0.6 }));
      crown.rotation.x = Math.PI / 2;
      crown.position.set(0, 2.02, -1.0);
      group.add(crown);
    }
    if (agent.student) {
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.4), new THREE.MeshStandardMaterial({ color: 0x60a5fa }));
      book.position.set(0, 1.14, -0.35);
      group.add(book);
    }
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), new THREE.MeshBasicMaterial({ color: hexToNumber(STATE_HEX[agent.state]) }));
    light.position.set(0.85, 2.75, 0.36);
    group.add(light);

    const hit = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 2.8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(0, 1.3, -0.4);
    hit.userData = { agentId: agent.id, departmentId };
    group.add(hit);
    raycastTargets.push(hit);

    platformGroup.add(group);

    const label = document.createElement("div");
    label.className = "pointer-events-none absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-white/15 bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-lg";
    if (agent.cityRole) {
      label.dataset.testid = `world-avatar-${agent.id}`;
      label.className += " flex max-w-[88px] items-center gap-1 overflow-hidden";
    }
    labelLayer.appendChild(label);

    const ctx = canvas.getContext("2d");
    if (ctx) drawMonitor(ctx, agent, 0);
    texture.needsUpdate = true;
    return { agent, departmentId, group, body, head, leftArm, rightArm, light, canvas, texture, label, phase: Math.random() * Math.PI * 2, worldPos: new THREE.Vector3() };
  }

  function updateDeskLabel(desk: DeskRuntime) {
    const color = STATE_HEX[desk.agent.state];
    desk.label.innerHTML = "";
    const name = document.createElement("span");
    if (desk.agent.cityRole) {
      name.className = "min-w-0 truncate";
      name.textContent = desk.agent.cityRole;
      const dot = document.createElement("span");
      dot.className = "size-1.5 shrink-0 rounded-full";
      dot.style.backgroundColor = color;
      desk.label.setAttribute("aria-label", `${desk.agent.name} · ${desk.agent.label}`);
      desk.label.append(dot, name);
      return;
    }
    name.textContent = desk.agent.deputy ? `👑 ${desk.agent.name}` : desk.agent.name;
    const dot = document.createElement("span");
    dot.style.cssText = `display:inline-block;width:6px;height:6px;border-radius:9999px;margin:0 5px 1px 6px;background:${color}`;
    const status = document.createElement("span");
    status.textContent = desk.agent.label;
    status.style.color = color;
    status.style.fontWeight = "500";
    desk.label.append(name, dot, status);
    if (desk.agent.badge) {
      const badge = document.createElement("span");
      badge.textContent = ` · ${desk.agent.badge}`;
      badge.style.color = "#a1a1aa";
      desk.label.append(badge);
    }
    if (typeof desk.agent.battery === "number") {
      const bar = document.createElement("span");
      const pct = Math.max(0, Math.min(100, desk.agent.battery));
      const color = pct > 60 ? "#34d399" : pct > 25 ? "#fbbf24" : "#fb7185";
      bar.style.cssText = `display:block;height:3px;margin-top:2px;border-radius:9999px;background:linear-gradient(90deg,${color} ${pct}%,rgba(255,255,255,0.12) ${pct}%)`;
      desk.label.append(bar);
    }
  }

  function buildCityOverviewDesks() {
    const desks = platforms.flatMap(({ department, center }) => department.agents.map((agent, index) => {
      const position = officeCityDeskPosition(index);
      return { agent, x: center.x + position.x, z: center.z + position.z };
    }));
    host.dataset.cityDeskCount = String(desks.length);
    const running = desks.flatMap((desk, index) => desk.agent.state === "working" ? [index] : []);
    host.dataset.cityRunningDeskCount = String(running.length);
    if (!desks.length) return;
    const group = new THREE.Group();
    const instance = (geometry: any, color: number, count = desks.length) => {
      const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }), count);
      group.add(mesh);
      return mesh;
    };
    const tabletops = instance(new THREE.BoxGeometry(1.16, 0.16, 0.74), 0xd6c7a8);
    const bases = instance(new THREE.BoxGeometry(0.87, 0.59, 0.53), 0x344258);
    const screens = instance(new THREE.BoxGeometry(0.85, 0.57, 0.14), 0xffffff);
    const screenLines = instance(new THREE.BoxGeometry(0.55, 0.065, 0.025), 0xffffff, desks.length * 2);
    const chairs = instance(new THREE.BoxGeometry(0.49, 0.73, 0.25), 0x243145);
    const bodies = instance(new THREE.CapsuleGeometry(0.16, 0.26, 2, 6), 0xffffff);
    const heads = instance(new THREE.SphereGeometry(0.17, 8, 6), 0xc58b5c);
    const arms = instance(new THREE.BoxGeometry(0.10, 0.11, 0.37), 0xffffff, desks.length * 2);
    const transform = new THREE.Object3D();
    const set = (mesh: any, index: number, x: number, y: number, z: number) => {
      transform.position.set(x, y, z);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    };
    desks.forEach(({ agent, x, z }, index) => {
      set(tabletops, index, x, 0.66, z - 0.12);
      set(bases, index, x, 0.30, z - 0.12);
      set(screens, index, x, 1.02, z - 0.40);
      set(chairs, index, x, 0.50, z + 0.61);
      set(bodies, index, x, 0.69, z + 0.37);
      set(heads, index, x, 1.12, z + 0.37);
      set(arms, index * 2, x - 0.20, 0.77, z + 0.14);
      set(arms, index * 2 + 1, x + 0.20, 0.77, z + 0.14);
      const shirt = new THREE.Color(agent.color);
      bodies.setColorAt(index, shirt);
      arms.setColorAt(index * 2, shirt);
      arms.setColorAt(index * 2 + 1, shirt);
      screens.setColorAt(index, new THREE.Color(0x152034));
      set(screenLines, index * 2, x - 0.05, 1.12, z - 0.48);
      set(screenLines, index * 2 + 1, x + 0.03, 0.96, z - 0.48);
      screenLines.setColorAt(index * 2, new THREE.Color(STATE_HEX[agent.state]));
      screenLines.setColorAt(index * 2 + 1, new THREE.Color(0x64748b));
    });
    if (running.length && !options.reducedMotion) arms.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(group);
    overviewDesks = {
      group,
      animate(time) {
        if (!running.length || options.reducedMotion) return;
        running.forEach(index => {
          const { x, z } = desks[index];
          const phase = time * 13 + index;
          set(arms, index * 2, x - 0.20, 0.77 + Math.max(0, Math.sin(phase)) * 0.13, z + 0.14);
          set(arms, index * 2 + 1, x + 0.20, 0.77 + Math.max(0, -Math.sin(phase)) * 0.13, z + 0.14);
        });
        arms.instanceMatrix.needsUpdate = true;
      },
    };
  }

  function build(data: SceneData) {
    clearDynamic();
    cityLayout = data.cityLayout;
    const cityOverview = cityLayout === "overview";
    cityMapSize = officeCityMapPosition(0, data.departments.length);
    hub.visible = cityLayout !== "detail";
    hub.scale.setScalar(cityOverview ? 0.78 : 1);
    beam.visible = cityLayout !== "detail";
    hubLabel.textContent = "CEO · ORQUESTADOR";
    hubLabel.disabled = !cityOverview;
    hubLabel.classList.toggle("pointer-events-none", !cityOverview);
    hubLabel.classList.toggle("pointer-events-auto", cityOverview);
    if (cityOverview) hubLabel.setAttribute("aria-label", "Abrir Director de Ciudades de KONG");
    else hubLabel.removeAttribute("aria-label");
    if (!cityOverview) {
      scene.fog.near = 45;
      scene.fog.far = 110;
      delete host.dataset.cityDeskCount;
      delete host.dataset.cityRunningDeskCount;
    }
    const count = Math.max(1, data.departments.length);
    data.departments.forEach((department, index) => {
      const angle = cityLayout ? -Math.PI / 2 : (index / count) * Math.PI * 2 - Math.PI / 2;
      const cityPosition = cityOverview ? officeCityMapPosition(index, count) : { x: 0, z: 0 };
      const cx = cityLayout ? cityPosition.x : Math.cos(angle) * RING_RADIUS;
      const cz = cityLayout ? cityPosition.z : Math.sin(angle) * RING_RADIUS;
      const group = new THREE.Group();
      group.position.set(cx, 0, cz);
      // Local +z points to the hub; monitors face outward.
      if (!cityLayout) group.lookAt(0, 0, 0);
      scene.add(group);

      // One row of up to 5 desks so no desk hides behind another when the camera looks in.
      const cols = Math.min(5, Math.max(1, department.agents.length));
      const rows = Math.max(1, Math.ceil(department.agents.length / cols));
      const width = cityOverview ? 6.1 : cols * DESK_SPACING_X + 1.4;
      const depth = cityOverview ? 4.9 : rows * DESK_SPACING_Z + 1.2;
      const colorNum = hexToNumber(department.color);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(width, 0.5, depth), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 }));
      slab.position.y = -0.25;
      group.add(slab);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.3, depth - 0.3), new THREE.MeshStandardMaterial({ color: colorNum, roughness: 0.95, transparent: true, opacity: 0.28 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.01;
      group.add(floor);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(width, 0.5, depth)), new THREE.LineBasicMaterial({ color: colorNum }));
      edges.position.y = -0.25;
      group.add(edges);
      if (!cityOverview) {
        const glow = new THREE.PointLight(colorNum, 0.9, 14, 1.5);
        glow.position.set(0, 4, 0);
        group.add(glow);
      }
      const platformHit = new THREE.Mesh(new THREE.BoxGeometry(width, 0.6, depth), new THREE.MeshBasicMaterial({ visible: false }));
      platformHit.userData = { departmentId: department.id };
      group.add(platformHit);
      raycastTargets.push(platformHit);

      const desks = cityOverview ? [] : department.agents.map((agent, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = (col - (cols - 1) / 2) * DESK_SPACING_X;
        const z = (row - (rows - 1) / 2) * DESK_SPACING_Z;
        return buildDesk(agent, department.id, x, z, group);
      });
      desks.forEach(updateDeskLabel);

      const label = document.createElement(cityOverview ? "button" : "div");
      if (label instanceof HTMLButtonElement) label.type = "button";
      label.className = cityOverview
        ? "pointer-events-auto absolute max-w-[65px] -translate-x-1/2 -translate-y-full cursor-pointer rounded border px-1 py-0.5 text-center text-[9px] font-semibold leading-tight shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 sm:max-w-[110px] sm:text-[11px]"
        : "pointer-events-auto absolute -translate-x-1/2 -translate-y-full cursor-pointer whitespace-nowrap rounded-lg border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] shadow-xl";
      label.style.borderColor = `${department.color}99`;
      label.style.background = "rgba(2,6,23,0.82)";
      label.style.color = department.color;
      label.dataset.testid = `world-dept-${department.id}`;
      const working = department.agents.filter((agent) => agent.state === "working").length;
      label.textContent = cityOverview ? department.name : `${department.name} · ${working}/${department.agents.length}`;
      if (cityOverview) label.setAttribute("aria-label", `Abrir ${department.name}, ${working} agentes en ejecución verificada`);
      label.addEventListener("click", () => focusDepartment(department.id));
      label.addEventListener("pointerenter", () => { lastInteraction = performance.now(); hoveringLabel = true; });
      label.addEventListener("pointerleave", () => { hoveringLabel = false; });
      labelLayer.appendChild(label);

      if (cityLayout === "detail") {
        platforms.push({ department, group, center: new THREE.Vector3(cx, 0, cz), angle, label, desks, size: { width, depth } });
        return;
      }

      // Data flow from the hub to the department.
      const start = new THREE.Vector3(0, 2, 0);
      const end = new THREE.Vector3(cx * 0.82, 0.4, cz * 0.82);
      const mid = start.clone().lerp(end, 0.5);
      mid.y = cityOverview ? 2.5 : 7;
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const points = curve.getPoints(48);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: colorNum, dashSize: 0.35, gapSize: 0.35, transparent: true, opacity: cityOverview && !working ? 0.26 : 0.55 }));
      line.computeLineDistances();
      const lineHolder = new THREE.Group();
      lineHolder.add(line);
      group.userData.lineHolder = lineHolder;
      scene.add(lineHolder);
      const busy = department.agents.filter((agent) => agent.state === "working").length / Math.max(1, department.agents.length);
      const hasProblem = department.agents.some((agent) => agent.state === "error" || agent.state === "needs-setup");
      const flowColor = busy > 0 ? department.color : "#52525b";
      const particles = Array.from({ length: cityOverview ? (working ? 3 : 0) : (busy > 0 ? 6 : 2) }, () => {
        const particle = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), new THREE.MeshBasicMaterial({ color: hexToNumber(flowColor), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
        scene.add(particle);
        return particle;
      });
      platforms.push({
        department,
        group,
        center: new THREE.Vector3(cx, 0, cz),
        angle,
        label,
        flow: { curve, particles, speed: 0.05 + busy * 0.18, color: hasProblem ? "#fbbf24" : flowColor },
        desks,
        size: { width, depth },
      });
    });

    if (cityOverview) buildCityOverviewDesks();
    // World positions for desks (after platforms are oriented).
    scene.updateMatrixWorld(true);
    platforms.forEach((platform) => platform.desks.forEach((desk) => desk.group.getWorldPosition(desk.worldPos)));

    // Debates: violet arcs between reviewer and subject desks.
    const deskById = new Map<string, DeskRuntime>();
    platforms.forEach((platform) => platform.desks.forEach((desk) => deskById.set(desk.agent.id, desk)));
    data.debates.forEach((debate) => {
      const from = deskById.get(debate.from);
      const to = deskById.get(debate.to);
      if (!from || !to || from === to) return;
      const a = from.worldPos.clone().setY(3);
      const b = to.worldPos.clone().setY(3);
      const mid = a.clone().lerp(b, 0.5);
      mid.y = 10;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)), new THREE.LineBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.45 }));
      scene.add(line);
      const particles = Array.from({ length: 3 }, () => {
        const particle = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), new THREE.MeshBasicMaterial({ color: 0xc4b5fd, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        scene.add(particle);
        return particle;
      });
      debateArcs.push({ curve, particles, line });
    });
  }

  function focusDepartment(departmentId: string | null, notify = true) {
    focused = departmentId;
    const platform = platforms.find((item) => item.department.id === departmentId);
    if (!platform && cityLayout === "overview") {
      frameCityOverview();
    } else if (!platform) {
      goalTarget.set(0, 0, 0);
      goalRadius = 52;
      goalPhi = 0.95;
    } else {
      goalTarget.copy(platform.center).setY(1.4);
      // Far enough to fit every desk of the platform.
      goalRadius = 9 + Math.max(platform.size.width * 0.9, platform.size.depth * 1.5);
      goalPhi = 1.08;
      goalTheta = platform.angle;
    }
    lastInteraction = performance.now();
    applyViewOffset();
    if (notify) callbacks.onFocusDepartment(focused);
  }

  // Pointer controls: drag to orbit, wheel / pinch to zoom, click to focus.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const el = renderer.domElement as HTMLCanvasElement;
  const onPointerDown = (event: PointerEvent) => {
    dragging = true;
    dragMoved = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    el.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    lastInteraction = performance.now();
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    dragMoved += Math.abs(dx) + Math.abs(dy);
    lastX = event.clientX;
    lastY = event.clientY;
    goalTheta += dx * 0.006;
    goalPhi = Math.min(1.35, Math.max(0.35, goalPhi - dy * 0.004));
    lastInteraction = performance.now();
  };
  const onPointerUp = (event: PointerEvent) => {
    dragging = false;
    if (dragMoved > 6) return;
    const rect = el.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(raycastTargets, false)[0];
    if (!hit) return;
    const { agentId, departmentId } = hit.object.userData || {};
    if (departmentId && departmentId !== focused) focusDepartment(departmentId);
    // Clicking the floor of the already-focused KONG room reopens its office (other rooms keep their panels).
    else if (departmentId === "kong" && !agentId) callbacks.onFocusDepartment(departmentId);
    if (agentId) callbacks.onSelectAgent(agentId);
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const maxRadius = cityLayout === "overview" ? camera.far - 50 : 80;
    goalRadius = Math.min(maxRadius, Math.max(9, goalRadius * (1 + Math.sign(event.deltaY) * 0.08)));
    lastInteraction = performance.now();
  };
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("wheel", onWheel, { passive: false });

  const resizeObserver = new ResizeObserver(() => {
    const w = host.clientWidth;
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h);
    applyViewOffset();
    if (cityLayout === "overview" && !focused) frameCityOverview();
  });
  resizeObserver.observe(host);

  const projected = new THREE.Vector3();
  function placeLabel(element: HTMLElement, position: any, visible: boolean) {
    projected.copy(position).project(camera);
    const onScreen = projected.z < 1 && Math.abs(projected.x) < 1.2 && Math.abs(projected.y) < 1.2;
    if (!visible || !onScreen) {
      if (element.style.display !== "none") element.style.display = "none";
      return;
    }
    if (element.style.display === "none") element.style.removeProperty("display");
    // Whole pixels only: avoids sub-pixel jitter that makes labels hard to click.
    const left = `${Math.round(((projected.x + 1) / 2) * host.clientWidth)}px`;
    const top = `${Math.round(((1 - projected.y) / 2) * host.clientHeight)}px`;
    if (element.style.left !== left) element.style.left = left;
    if (element.style.top !== top) element.style.top = top;
  }

  let lastScreenDraw = 0;
  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    const motion = options.reducedMotion ? 0 : 1;

    // Idle auto-orbit for the overview.
    // Auto-orbit only while nobody is pointing at the office, so labels hold still to be clicked.
    if (!cityLayout && !focused && !dragging && !hoveringLabel && !hoveringStage && motion && performance.now() - lastInteraction > 4000) goalTheta += dt * 0.05;
    const ease = 1 - Math.pow(0.001, dt);
    target.lerp(goalTarget, ease);
    radius += (goalRadius - radius) * ease;
    theta += (goalTheta - theta) * ease;
    phi += (goalPhi - phi) * ease;
    placeCamera();

    const hubMotion = cityLayout ? 0 : motion;
    core.scale.setScalar(1 + Math.sin(t * 2) * 0.06 * hubMotion);
    ring.rotation.z += dt * 0.4 * hubMotion;
    beam.material.opacity = 0.08 + Math.sin(t * 1.5) * 0.03 * hubMotion;
    overviewDesks?.animate(t);

    platforms.forEach((platform) => {
      platform.desks.forEach((desk) => {
        const state = desk.agent.state;
        const cityJob = desk.agent.id.startsWith("kong-city:");
        const avatarMotion = cityJob && state !== "working" ? 0 : motion;
        const speed = state === "working" ? 1 : state === "error" ? 0.3 : state === "needs-setup" ? 0.45 : 0.18;
        const p = t * 6 * speed + desk.phase;
        // City figures only move during verified work; retain the main office's ambient motion.
        desk.body.position.y = 1.12 + Math.sin(p * 0.35) * 0.03 * avatarMotion;
        desk.head.position.y = 1.72 + Math.sin(p * 0.35) * 0.03 * avatarMotion;
        desk.head.rotation.y = state === "working" ? Math.sin(p * 0.2) * 0.25 * avatarMotion : Math.sin(p * 0.1) * 0.6 * avatarMotion;
        const typing = state === "working" ? 1 : cityJob || state === "error" ? 0 : 0.25;
        desk.leftArm.position.y = 1.18 + Math.max(0, Math.sin(p * 2)) * 0.06 * typing * avatarMotion;
        desk.rightArm.position.y = 1.18 + Math.max(0, Math.sin(p * 2 + Math.PI)) * 0.06 * typing * avatarMotion;
        const pulse = 0.75 + Math.sin(t * 3 + desk.phase) * 0.25 * avatarMotion;
        const alarm = Math.sin(t * 8 + desk.phase) > 0 ? 1.15 : 0.45;
        desk.light.scale.setScalar(state === "working" ? pulse : state === "error" ? (avatarMotion ? alarm : 1) : 0.8);
        tmp.copy(desk.worldPos).setY(3.25);
        placeLabel(desk.label, tmp, focused ? focused === platform.department.id : radius < 24);
      });
      tmp.copy(platform.center).setY(cityLayout === "overview" ? 2.2 : platform.desks.length > 3 ? 6.4 : 5.2);
      placeLabel(platform.label, tmp, focused !== platform.department.id);
      const flow = platform.flow;
      flow?.particles.forEach((particle, i) => {
        const u = (t * flow.speed * motion + i / flow.particles.length) % 1;
        particle.position.copy(flow.curve.getPoint(u));
      });
    });
    debateArcs.forEach((arc) => arc.particles.forEach((particle, i) => {
      const u = (t * 0.25 * motion + i / arc.particles.length) % 1;
      particle.position.copy(arc.curve.getPoint(u));
    }));
    tmp.set(0, cityLayout === "overview" ? 3.2 : 4.4, 0);
    placeLabel(hubLabel, tmp, cityLayout !== "detail");

    if (t - lastScreenDraw > 0.25) {
      lastScreenDraw = t;
      platforms.forEach((platform) => platform.desks.forEach((desk) => {
        const ctx = desk.canvas.getContext("2d");
        if (!ctx) return;
        drawMonitor(ctx, desk.agent, motion ? t : 0);
        desk.texture.needsUpdate = true;
      }));
    }
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(frame);

  function update(data: SceneData) {
    const keepFocus = focused;
    const priorLayout = cityLayout;
    const priorCount = platforms.length;
    build(data);
    if (keepFocus && platforms.some((platform) => platform.department.id === keepFocus)) focusDepartment(keepFocus, false);
    else if (priorLayout !== cityLayout || (cityLayout === "overview" && priorCount !== platforms.length)) {
      if (!cityLayout) goalTheta = 0.6;
      focusDepartment(null, false);
    }
  }

  function dispose() {
    renderer.setAnimationLoop(null);
    resizeObserver.disconnect();
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("wheel", onWheel);
    stage.removeEventListener("pointerenter", onStageEnter);
    stage.removeEventListener("pointerleave", onStageLeave);
    clearDynamic();
    disposeObject(scene);
    hubLabel.remove();
    renderer.dispose();
    renderer.domElement.remove();
  }

  placeCamera();
  return { update, focusDepartment, dispose, getFocused: () => focused };
}
