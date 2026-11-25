/* The source coordinates and Bézier curves use the same coordinate system as
   the original PDF. Typography and hit targets are measured in CSS pixels. */
(() => {
  "use strict";

  const branchColors = {
    p6654: "#83602e",
    p6317: "#316a87",
    p2195: "#52724c",
    p2303: "#995548",
  };
  const extraColors = ["#78618b", "#537872", "#926a4a", "#516e90"];
  const rootInk = "#243e32";
  const paper = "#fffdf6";
  // Generations count from Khuti (1). Warm and cool groups follow the source palette.
  const generations = [
    [rootInk, "#ffffff"], ["#c8c55e", "#232713"], ["#e6ac61", "#302016"],
    ["#246578", "#ffffff"], ["#255c50", "#ffffff"], ["#e6ca68", "#29220f"],
    ["#e4a07c", "#322017"], ["#903e4b", "#ffffff"], ["#d5a5d0", "#301c32"],
    ["#554773", "#ffffff"], ["#a3c3e4", "#182a3c"], ["#76c3b2", "#142e28"],
  ].map(([fill, text]) => ({ fill, text }));
  const systemFont = '"Instrument Sans", system-ui, sans-serif';
  const serifFont = '"PT Serif", Georgia, "Times New Roman", serif';
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function rgba(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    return (
      "rgba(" +
      [(value >> 16) & 255, (value >> 8) & 255, value & 255, alpha].join(",") +
      ")"
    );
  }

  function overlaps(a, b) {
    return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  }

  // A quarter turn maps source (x, y) to view (y, -x). Keep the source
  // geometry immutable, so resizing never introduces rounding drift.
  function quarterBounds(b) {
    return { l: b.t, t: -b.r, r: b.b, b: -b.l };
  }
  function sourceBounds(b) {
    return { l: -b.b, t: b.l, r: -b.t, b: b.r };
  }

  function box(x, y, width, height, padding = 0) {
    return {
      l: x - width / 2 - padding,
      r: x + width / 2 + padding,
      t: y - height / 2 - padding,
      b: y + height / 2 + padding,
    };
  }

  function include(bounds, x, y) {
    bounds.l = Math.min(bounds.l, x);
    bounds.r = Math.max(bounds.r, x);
    bounds.t = Math.min(bounds.t, y);
    bounds.b = Math.max(bounds.b, y);
  }

  const newBounds = () => ({
    l: Infinity,
    t: Infinity,
    r: -Infinity,
    b: -Infinity,
  });

  function roundBox(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.roundRect(x - width / 2, y - height / 2, width, height, r);
  }

  function wrapName(ctx, name, maxWidth) {
    const lines = [];
    let rest = name;
    while (ctx.measureText(rest).width > maxWidth) {
      let line = "", lastBreak = 0;
      for (const character of rest) {
        if (line && ctx.measureText(line + character).width > maxWidth) break;
        line += character;
        if (/[\s-]/u.test(character)) lastBreak = line.length;
      }
      const end = lastBreak || line.length;
      lines.push(rest.slice(0, end).trimEnd());
      rest = rest.slice(end).trimStart();
    }
    if (rest) lines.push(rest);
    return lines;
  }

  class LabelSpace {
    constructor() {
      this.buckets = new Map();
    }

    keys(bounds) {
      const keys = [];
      for (
        let x = Math.floor(bounds.l / 72);
        x <= Math.floor(bounds.r / 72);
        x++
      ) {
        for (
          let y = Math.floor(bounds.t / 48);
          y <= Math.floor(bounds.b / 48);
          y++
        )
          keys.push(x + "," + y);
      }
      return keys;
    }

    available(bounds) {
      return this.keys(bounds).every(
        (key) =>
          !(this.buckets.get(key) || []).some((existing) =>
            overlaps(bounds, existing),
          ),
      );
    }

    add(bounds) {
      for (const key of this.keys(bounds)) {
        if (!this.buckets.has(key)) this.buckets.set(key, []);
        this.buckets.get(key).push(bounds);
      }
    }
  }

  function placeNew(node, occupied) {
    const p = node.parent,
      g = p?.parent;
    const angle = p && g ? Math.atan2(p.y - g.y, p.x - g.x) : 0;
    node.w = Math.max(68, 14 + node.name.length * 7);
    node.h = 24;
    if (!p) {
      node.x = 0;
      node.y = 0;
      occupied.push(box(0, 0, node.w, node.h, 10));
      return;
    }
    // Try the outward half-plane first. Incremental rings give siblings room
    // without moving any of the existing records or their original links.
    for (let ring = 1; ; ring++) {
      const distance = 95 + 53 * ring;
      const steps = 12 + 4 * ring;
      for (let i = 0; i < steps; i++) {
        const offset = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 === 1 ? 1 : -1);
        const a = angle + (offset * 2 * Math.PI) / steps;
        const x = p.x + Math.cos(a) * distance,
          y = p.y + Math.sin(a) * distance;
        const bounds = box(x, y, node.w, node.h, 12);
        if (!occupied.some((other) => overlaps(other, bounds))) {
          node.x = x;
          node.y = y;
          occupied.push(bounds);
          return;
        }
      }
    }
  }

  function derivedEdge(p, n) {
    const mx = (p.x + n.x) / 2,
      my = (p.y + n.y) / 2;
    return Math.abs(p.x - n.x) > Math.abs(p.y - n.y)
      ? [p.x, p.y, mx, p.y, mx, n.y, n.x, n.y]
      : [p.x, p.y, p.x, my, n.x, my, n.x, n.y];
  }

  class FamilyTreeMap {
    static generationColor(number) {
      if (!generations[number - 1]) {
        generations[number - 1] = {
          fill: d3.hsl((number * 137.508) % 360, 0.5, 0.29).formatHex(),
          text: "#ffffff",
        };
      }
      return generations[number - 1];
    }

    constructor(canvas, callbacks = {}) {
      if (!window.d3) throw new Error("Missing D3 runtime");
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.callbacks = callbacks;
      this.nodes = new Map();
      this.ordered = [];
      this.edges = [];
      this.root = null;
      this.selectedId = null;
      this.hoveredId = null;
      this.path = new Set();
      this.transform = d3.zoomIdentity;
      this.fitScale = 1;
      this.width = 0;
      this.height = 0;
      this.frame = null;
      this.hits = [];
      this.points = [];
      this.zoomPercent = null;
      this.panelOpen = false;
      this.rotated = false;
      this.branchFocusId = null;
      this.suppressClickUntil = 0;
      this.gesture = null;
      canvas.tabIndex = canvas.hasAttribute("tabindex") ? canvas.tabIndex : 0;
      if (!canvas.hasAttribute("aria-label"))
        canvas.setAttribute(
          "aria-label",
          callbacks.t?.("Родовое древо") || "Родовое древо",
        );
      canvas.style.touchAction = "none";
      canvas.style.cursor = "grab";
      const surface = (this.surface = d3.select(canvas));
      this.zoom = d3
        .zoom()
        .extent(() => [
          [0, 0],
          [Math.max(1, this.width), Math.max(1, this.height)],
        ])
        .scaleExtent([0.001, 8])
        .clickDistance(5)
        .tapDistance(10)
        .touchable(() => true)
        .on("start.map", (event) => this.startGesture(event))
        .on("zoom.map", (event) => {
          this.transform = event.transform;
          if (this.gesture) {
            const t = this.gesture.start;
            if (
              Math.hypot(t.x - event.transform.x, t.y - event.transform.y) >
                4 ||
              Math.abs(t.k - event.transform.k) > 0.002
            )
              this.gesture.moved = true;
          }
          this.invalidate();
        })
        .on("end.map", () => {
          if (this.gesture?.moved) {
            this.suppressClickUntil = performance.now() + 180;
          }
          this.gesture = null;
          canvas.style.cursor = this.hoveredId ? "pointer" : "grab";
        });
      surface.call(this.zoom);
      surface.on("dblclick.zoom", null);
      canvas.addEventListener("pointermove", (e) => this.hover(e));
      canvas.addEventListener("pointerleave", () => this.setHover(null));
      canvas.addEventListener("click", (e) => this.click(e));
      canvas.addEventListener("dblclick", (e) => {
        if (performance.now() < this.suppressClickUntil) return;
        const pos = this.local(e),
          id = this.hit(pos.x, pos.y, e.pointerType === "touch");
        if (id) this.focusPerson(id, { openPanel: this.panelOpen });
        else this.surface.call(this.zoom.scaleBy, 1.6, [pos.x, pos.y]);
      });
      canvas.addEventListener("keydown", (e) => this.key(e));
      const resize = () => this.resize();
      this.observer = new ResizeObserver(resize);
      this.observer.observe(canvas);
      // A display can change DPR without changing the canvas's layout size.
      window.addEventListener("resize", resize);
      this.removeWindowListener = () =>
        window.removeEventListener("resize", resize);
      this.resize();
    }

    setData(people, layout = {}) {
      const previousRoot = this.root?.id;
      const oldSelected = this.selectedId;
      const wasFit = this.atOverview();
      const priorAnchor = this.sourceAtCentre();
      this.nodes = new Map(
        people.map((p) => [
          String(p.id),
          {
            id: String(p.id),
            name: String(p.name),
            parentId: p.parent == null ? null : String(p.parent),
            children: [],
            depth: 0,
          },
        ]),
      );
      this.ordered = [];
      this.edges = [];
      this.root = null;
      for (const n of this.nodes.values()) {
        n.parent = this.nodes.get(n.parentId) || null;
        if (n.parent) n.parent.children.push(n);
        else if (!this.root) this.root = n;
      }
      if (!this.root) {
        this.path.clear();
        this.hits = [];
        this.points = [];
        this.invalidate();
        return;
      }
      const queue = [this.root],
        visited = new Set();
      for (let i = 0; i < queue.length; i++) {
        const n = queue[i];
        if (visited.has(n.id)) continue;
        visited.add(n.id);
        n.depth = n.parent ? n.parent.depth + 1 : 0;
        n.generation = FamilyTreeMap.generationColor(n.depth + 1);
        n.branch = n.depth === 1 ? n : n.parent?.branch || null;
        n.ink =
          n.depth === 0
            ? rootInk
            : n.depth === 1
              ? branchColors[n.id] ||
                extraColors[this.root.children.indexOf(n) % extraColors.length]
              : n.parent.ink;
        this.ordered.push(n);
        queue.push(...n.children);
      }
      const occupied = [];
      for (const n of this.ordered) {
        const rect = layout?.nodes?.[n.id];
        if (rect?.length === 4 && rect.every(Number.isFinite)) {
          [n.x, n.y, n.w, n.h] = rect;
          occupied.push(box(n.x, n.y, n.w, n.h, 7));
        }
      }
      for (const n of this.ordered) if (n.x == null) placeNew(n, occupied);
      this.bounds = newBounds();
      for (const n of this.ordered) {
        include(this.bounds, n.x - n.w / 2, n.y - n.h / 2);
        include(this.bounds, n.x + n.w / 2, n.y + n.h / 2);
        if (!n.parent) continue;
        let route = layout?.edges?.[n.id];
        if (
          !route ||
          route.length < 8 ||
          (route.length - 2) % 6 ||
          !route.every(Number.isFinite)
        )
          route = derivedEdge(n.parent, n);
        const bounds = newBounds();
        const shape = new Path2D();
        shape.moveTo(n.parent.x, n.parent.y);
        shape.lineTo(route[0], route[1]);
        include(bounds, n.parent.x, n.parent.y);
        for (let i = 0; i < route.length; i += 2)
          include(bounds, route[i], route[i + 1]);
        for (let i = 2; i < route.length; i += 6)
          shape.bezierCurveTo(...route.slice(i, i + 6));
        shape.lineTo(n.x, n.y);
        include(bounds, n.x, n.y);
        this.edges.push({ node: n, shape, bounds, route });
      }
      this.refreshScale();
      this.select(this.nodes.has(oldSelected) ? oldSelected : null);
      if (
        !previousRoot ||
        previousRoot !== this.root.id ||
        (oldSelected && !this.selectedId) ||
        wasFit
      )
        this.fit(false);
      else this.restoreView(priorAnchor);
      this.invalidate();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect(),
        w = rect.width,
        h = rect.height;
      if (w <= 0 || h <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      if (this.width === w && this.height === h && this.dpr === dpr) return;
      const wasFit = !this.overview || this.atOverview();
      const anchor = this.sourceAtCentre();
      this.width = w;
      this.height = h;
      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(w * dpr));
      this.canvas.height = Math.max(1, Math.round(h * dpr));
      if (this.root) {
        this.refreshScale();
        if (wasFit) this.fit(false);
        else this.restoreView(anchor);
      }
      this.invalidate();
    }

    area(openPanel = false) {
      const w = this.width,
        h = this.height;
      if (!openPanel) return { l: 0, t: 0, r: w, b: h };
      if (w >= 740) return { l: 0, t: 0, r: w - Math.min(w * 0.36, 326), b: h };
      return { l: 0, t: 0, r: w, b: h - Math.min(h * 0.47, 315) };
    }

    forBounds(bounds, area, padding) {
      const width = Math.max(1, area.r - area.l - 2 * padding),
        height = Math.max(1, area.b - area.t - 2 * padding);
      const k = Math.min(
        width / Math.max(bounds.r - bounds.l, 1),
        height / Math.max(bounds.b - bounds.t, 1),
        2.3,
      );
      return this.at((bounds.l + bounds.r) / 2, (bounds.t + bounds.b) / 2, k, [
        (area.r + area.l) / 2,
        (area.t + area.b) / 2,
      ]);
    }

    at(x, y, k, centre) {
      return d3.zoomIdentity
        .translate(centre[0] - x * k, centre[1] - y * k)
        .scale(k);
    }

    orient(x, y) {
      return this.rotated ? [y, -x] : [x, y];
    }

    screenPoint(n) {
      return this.transform.apply(this.orient(n.x, n.y));
    }

    sourceAtCentre() {
      const [x, y] = this.transform.invert([this.width / 2, this.height / 2]);
      return this.rotated ? [-y, x] : [x, y];
    }

    atOverview() {
      return Boolean(
        this.overview &&
        Math.abs(this.transform.k - this.overview.k) <
          0.005 * this.overview.k &&
        Math.abs(this.transform.x - this.overview.x) < 2 &&
        Math.abs(this.transform.y - this.overview.y) < 2,
      );
    }

    restoreView(anchor) {
      if (this.panelOpen && this.selectedId) {
        this.focusPerson(this.selectedId, { openPanel: true, animate: false });
      } else if (this.branchFocusId && this.nodes.has(this.branchFocusId)) {
        this.focusBranch(this.branchFocusId, false);
      } else {
        const [x, y] = this.orient(...anchor);
        this.move(
          this.at(x, y, this.transform.k, [this.width / 2, this.height / 2]),
          false,
        );
      }
    }

    refreshScale() {
      if (!this.bounds || !this.width || !this.height) return;
      const area = this.area(),
        padding = this.width < 600 ? 18 : 35;
      const original = this.forBounds(this.bounds, area, padding);
      const turned = this.forBounds(quarterBounds(this.bounds), area, padding);
      this.rotated =
        this.width <= 900 &&
        this.height > this.width &&
        turned.k > original.k * 1.12;
      this.overview = this.rotated ? turned : original;
      this.fitScale = this.overview.k;
      this.zoom.scaleExtent([
        Math.min(this.fitScale * 0.6, 1),
        Math.max(6.5, this.fitScale * 2.5),
      ]);
    }

    move(t, animate = true) {
      if (!t) return;
      this.surface.interrupt();
      if (
        animate &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        this.surface
          .transition()
          .duration(270)
          .ease(d3.easeCubicInOut)
          .call(this.zoom.transform, t);
      } else this.surface.call(this.zoom.transform, t);
    }

    fit(animate = true) {
      this.panelOpen = false;
      this.branchFocusId = null;
      this.companionId = null;
      this.move(this.overview, animate);
    }

    focusPerson(id, { openPanel = true, animate = true } = {}) {
      const n = this.nodes.get(String(id));
      if (!n) return;
      this.panelOpen = openPanel;
      this.branchFocusId = null;
      this.select(n.id);
      const a = this.area(openPanel);
      const [minimum, maximum] = this.zoom.scaleExtent();
      let k = clamp(
        Math.max(1.25, this.transform.k, this.fitScale * 1.6),
        minimum,
        maximum,
      );
      this.companionId = null;
      if (n.depth <= 2) {
        // In the early generations the original lines can span hundreds of
        // units. Keep their destination visible beside the selected ancestor.
        const radiusX = Math.max(12, (a.r - a.l) / 2 - 42);
        const radiusY = Math.max(12, (a.b - a.t) / 2 - 37);
        const adjacent = n.children.slice();
        if (n.parent) adjacent.push(n.parent);
        const room = adjacent
          .map((relative) => {
            const [dx, dy] = this.orient(relative.x - n.x, relative.y - n.y);
            return {
              relative,
              scale: Math.min(
                radiusX / Math.max(0.1, Math.abs(dx)),
                radiusY / Math.max(0.1, Math.abs(dy)),
              ),
            };
          })
          .sort((u, v) => v.scale - u.scale);
        if (room.length) {
          this.companionId = room[0].relative.id;
          // Show all four first branches around the root when they fit. A
          // branch with several close neighbours gets at least two in view.
          const index =
            n.depth === 0
              ? Math.min(3, room.length - 1)
              : n.depth === 1 && room.length >= 3
                ? 1
                : 0;
          k = clamp(Math.max(this.transform.k, Math.min(k, room[index].scale)), minimum, maximum);
        }
      }
      this.move(
        this.at(...this.orient(n.x, n.y), k, [
          (a.l + a.r) / 2,
          (a.t + a.b) / 2,
        ]),
        animate,
      );
    }

    focusBranch(id, animate = true) {
      const n = this.nodes.get(String(id));
      if (!n) return;
      const bounds = newBounds(),
        queue = [n];
      for (let i = 0; i < queue.length; i++) {
        const child = queue[i];
        queue.push(...child.children);
        include(bounds, child.x - child.w / 2, child.y - child.h / 2);
        include(bounds, child.x + child.w / 2, child.y + child.h / 2);
      }
      this.panelOpen = false;
      this.companionId = null;
      this.select(n.id);
      this.branchFocusId = n.id;
      this.move(
        this.forBounds(
          this.rotated ? quarterBounds(bounds) : bounds,
          this.area(),
          this.width < 600 ? 25 : 48,
        ),
        animate,
      );
    }

    zoomBy(factor) {
      if (!Number.isFinite(factor) || factor <= 0) return;
      this.branchFocusId = null;
      const t = this.transform,
        a = this.area(this.panelOpen),
        c = [(a.l + a.r) / 2, (a.t + a.b) / 2],
        loc = t.invert(c);
      const [min, max] = this.zoom.scaleExtent();
      this.move(this.at(loc[0], loc[1], clamp(t.k * factor, min, max), c));
    }

    select(id) {
      const n = id == null ? null : this.nodes.get(String(id));
      if ((n?.id || null) !== this.selectedId) this.companionId = null;
      this.selectedId = n?.id || null;
      this.path = new Set();
      for (
        let ancestor = n;
        ancestor && !this.path.has(ancestor.id);
        ancestor = ancestor.parent
      )
        this.path.add(ancestor.id);
      if (!n) this.panelOpen = false;
      if (!n) this.branchFocusId = null;
      this.invalidate();
    }

    dismissPanel() {
      this.panelOpen = false;
    }
    invalidate() {
      if (this.frame != null) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.draw();
      });
    }
    draw() {
      const ctx = this.ctx,
        t = this.transform,
        k = t.k,
        w = this.width,
        h = this.height;
      if (!w || !h) return;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      this.hits = [];
      this.points = [];
      if (!this.root) return;
      const zoom = Math.round((k / this.fitScale) * 100);
      const fontScale = parseFloat(getComputedStyle(this.canvas).fontSize) / 16;
      if (this.canvas.closest(".large-text")) {
        const size = 22 * (1 + 0.3 * Math.max(0, Math.log2(k / this.fitScale)));
        this.labelSizes = [size + 6, size + 2, size].map(value => Math.round(value) * fontScale);
      } else {
        this.labelSizes = [
          clamp(17 + k, 18, 23),
          clamp(13.5 + k * 0.8, 14, 18),
          clamp(11.5 + k * 0.95, 12, 17),
        ].map(value => value * fontScale);
      }
      const byGeneration = k / this.fitScale >= 1.55;
      if (zoom !== this.zoomPercent) {
        this.zoomPercent = zoom;
        this.callbacks.onZoom?.(zoom);
      }
      const projectedView = {
        l: (-10 - t.x) / k,
        t: (-10 - t.y) / k,
        r: (w + 10 - t.x) / k,
        b: (h + 10 - t.y) / k,
      };
      const view = this.rotated ? sourceBounds(projectedView) : projectedView;
      const pathActive = this.path.size > 1;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(k, k);
      if (this.rotated) ctx.rotate(-Math.PI / 2);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const visibleEdges = this.edges.filter((e) => overlaps(e.bounds, view));
      const weight = [0, 3.15, 2.5, 1.9, 1.45, 1.16, 0.93, 0.82];
      const scaleWeight = clamp(Math.pow(k / 0.23, 0.12), 0.75, 1.32);
      for (const e of visibleEdges) {
        const n = e.node;
        if (pathActive && this.path.has(n.id)) continue;
        const base = weight[Math.min(weight.length - 1, n.depth)];
        const alpha = n.depth <= 3 ? 0.88 : n.depth <= 6 ? 0.78 : 0.65;
        ctx.strokeStyle = rgba(n.ink, alpha * (pathActive ? 0.63 : 1));
        ctx.lineWidth = (base * scaleWeight) / k;
        ctx.stroke(e.shape);
      }
      if (pathActive) {
        for (const e of visibleEdges) {
          if (!this.path.has(e.node.id)) continue;
          const lineWidth = (e.node.depth <= 2 ? 3.5 : 2.7) * scaleWeight;
          ctx.strokeStyle = paper;
          ctx.lineWidth = (lineWidth + 2.5) / k;
          ctx.stroke(e.shape);
          ctx.strokeStyle = e.node.ink;
          ctx.lineWidth = lineWidth / k;
          ctx.stroke(e.shape);
        }
      }
      ctx.restore();
      const visible = [];
      for (const n of this.ordered) {
        const [x, y] = this.screenPoint(n);
        if (x < -100 || x > w + 100 || y < -32 || y > h + 32) continue;
        visible.push({ n, x, y });
      }
      const labels = this.planLabels(visible);
      const hasLabel = new Set(labels.map((p) => p.n.id));
      for (const point of visible) {
        const { n, x, y } = point;
        const dim = pathActive && !this.path.has(n.id);
        if (!hasLabel.has(n.id)) {
          // Preserve the horizontal silhouette of the name plates in the source.
          const width = clamp(n.w * k * 0.64, 3.3, 24),
            height = clamp(n.h * k * 0.62, 1.95, 8.5),
            strong = n.depth <= 3;
          ctx.fillStyle = byGeneration ? n.generation.fill : rgba(n.ink, dim ? 0.42 : strong ? 0.96 : 0.76);
          roundBox(ctx, x, y, width, height, Math.min(1.8, height * 0.28));
          ctx.fill();
        }
        this.points.push(point);
      }
      // Paint all leaders under the labels so a displaced caption never scribbles
      // over the text of a neighbouring branch.
      for (const p of labels) {
        if (Math.hypot(p.cx - p.x, p.cy - p.y) < 5) continue;
        ctx.strokeStyle = rgba(p.n.ink, 0.8);
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.cx, p.cy);
        ctx.stroke();
        ctx.fillStyle = p.n.ink;
        roundBox(ctx, p.x, p.y, 4.4, 2.7, 1);
        ctx.fill();
      }
      for (const p of labels.reverse()) this.drawLabel(p, byGeneration);
    }

    labelStyle(n) {
      const root = n.depth === 0,
        top = n.depth === 1,
        selected = n.id === this.selectedId,
        hover = n.id === this.hoveredId;
      const size = this.labelSizes[Math.min(n.depth, 2)];
      const font = root
        ? "600 " + size + "px " + serifFont
        : top
          ? "600 " + size + "px " + systemFont
          : "500 " + size + "px " + systemFont;
      this.ctx.font = font;
      const padding = root ? 27 : top ? 19 : 14;
      const maxWidth = Math.max(40, this.area(this.panelOpen).r - padding - 18);
      const lines = wrapName(this.ctx, n.name, maxWidth);
      const width = padding + Math.ceil(Math.max(...lines.map(line => this.ctx.measureText(line).width)));
      const lineHeight = Math.ceil(size * 1.18);
      const height = Math.ceil(size) + (root ? 14 : top ? 11 : 9) + (lines.length - 1) * lineHeight;
      return { root, top, selected, hover, font, lines, lineHeight, width, height };
    }

    planLabels(visible) {
      const t = this.transform,
        k = t.k,
        ratio = k / this.fitScale;
      let maxDepth = 1;
      if (ratio > 1.55 || k >= 0.4) maxDepth = 2;
      if (ratio > 2.45 || k >= 0.49) maxDepth = 3;
      if (ratio > 3.4 || k >= 0.6) maxDepth = 5;
      if (k >= 0.72) maxDepth = 7;
      if (k >= 0.91) maxDepth = Infinity;
      const priority = (n) =>
        n.id === this.selectedId
          ? -4
          : n.depth === 0
            ? -3
            : n.depth === 1
              ? -2
              : n.id === this.hoveredId
                ? -1
                : this.path.has(n.id)
                  ? 0
                  : n.id === this.companionId
                    ? 0
                    : n.depth;
      const candidates = visible.filter(
        ({ n }) =>
          n.depth <= maxDepth ||
          n.id === this.hoveredId ||
          this.path.has(n.id) ||
          n.id === this.companionId,
      );
      candidates.sort(
        (a, b) =>
          priority(a.n) - priority(b.n) ||
          b.n.children.length - a.n.children.length,
      );
      const collision = new LabelSpace(),
        labels = [];
      for (const p of candidates) {
        const { n, x, y } = p,
          style = this.labelStyle(n),
          { width, height, root, top, selected, hover } = style;
        if (
          x < -width / 2 ||
          x > this.width + width / 2 ||
          y < -height / 2 ||
          y > this.height + height / 2
        )
          continue;
        let positions = [[x, y]];
        if (hover && this.hoverOffset) {
          positions.unshift([x + this.hoverOffset[0], y + this.hoverOffset[1]]);
        }
        if (top || selected || hover || n.id === this.companionId) {
          const angle = n.parent
            ? Math.atan2(n.y - n.parent.y, n.x - n.parent.x) -
              (this.rotated ? Math.PI / 2 : 0)
            : 0;
          const distance = Math.max(width * 0.63, 20);
          const angles = [
            angle,
            angle - 0.58,
            angle + 0.58,
            angle - Math.PI / 2,
            angle + Math.PI / 2,
            angle + Math.PI,
          ];
          for (const radius of [distance, distance + 18, distance + 36]) {
            for (const a of angles)
              positions.push([
                x + radius * Math.cos(a),
                y + radius * Math.sin(a),
              ]);
          }
        }
        for (let [cx, cy] of positions) {
          if (root || top || selected || hover) {
            cx = clamp(cx, width / 2 + 3, this.width - width / 2 - 3);
            cy = clamp(cy, height / 2 + 3, this.height - height / 2 - 3);
          }
          const bounds = box(cx, cy, width, height, root || top ? 3 : 1.5);
          if (!collision.available(bounds)) continue;
          collision.add(bounds);
          labels.push({ ...p, ...style, cx, cy });
          break;
        }
      }
      if (maxDepth <= 2) this.addOverviewNames(visible, labels, collision);
      return labels;
    }

    addOverviewNames(visible, labels, collision) {
      const limit =
        this.width < 420 ? 2 : this.width < 650 ? 4 : this.width < 900 ? 7 : 11;
      const already = new Set(labels.map((label) => label.n.id));
      const remaining =
        limit - labels.filter((label) => label.n.depth >= 2).length;
      if (remaining <= 0) return;
      const nearby = visible.filter((p) => p.n.depth === 2 || p.n.depth === 3);
      const markerBoxes = visible.map((p) => ({
        id: p.n.id,
        bounds: box(
          p.x,
          p.y,
          clamp(p.n.w * this.transform.k * 0.64, 3.3, 24),
          clamp(p.n.h * this.transform.k * 0.62, 1.95, 8.5),
        ),
      }));
      const placements = [];
      for (const p of nearby) {
        if (already.has(p.n.id)) continue;
        const style = this.labelStyle(p.n);
        const { width, height } = style;
        const dx = width / 2 + 4,
          dy = height / 2 + 6;
        const offsets = [
          [0, 0],
          [0, -dy],
          [0, dy],
          [-dx, 0],
          [dx, 0],
          [-dx * 0.7, -dy],
          [dx * 0.7, -dy],
          [-dx * 0.7, dy],
          [dx * 0.7, dy],
          [-dx - 19, 0],
          [dx + 19, 0],
          [-dx - 11, -dy],
          [dx + 11, -dy],
          [-dx - 11, dy],
          [dx + 11, dy],
          [0, -dy - 16],
          [0, dy + 16],
        ];
        for (const [x, y] of offsets) {
          const cx = p.x + x,
            cy = p.y + y,
            bounds = box(cx, cy, width, height, 2);
          if (
            bounds.l < 3 ||
            bounds.r > this.width - 3 ||
            bounds.t < 3 ||
            bounds.b > this.height - 3 ||
            !collision.available(bounds)
          )
            continue;
          // Read the negative space between branches instead of putting a
          // neighbour's caption over another, as yet unlabelled, name plate.
          if (
            markerBoxes.some(
              (m) => m.id !== p.n.id && overlaps(m.bounds, bounds),
            )
          )
            continue;
          placements.push({
            ...p,
            ...style,
            cx,
            cy,
            bounds,
            overviewDetail: true,
            displacement: Math.hypot(x, y),
          });
        }
      }
      const perBranch = new Map();
      for (let i = 0; i < remaining; i++) {
        let best = null,
          score = Infinity;
        for (const option of placements) {
          if (already.has(option.n.id) || !collision.available(option.bounds))
            continue;
          const nearest = Math.min(
            ...labels.map((l) =>
              Math.hypot(l.cx - option.cx, l.cy - option.cy),
            ),
          );
          const cost =
            (perBranch.get(option.n.branch.id) || 0) * 22 +
            option.displacement * 0.7 +
            (option.n.depth - 2) * 4 -
            Math.min(nearest, 145) * 0.18 -
            Math.min(option.n.children.length, 4);
          if (cost < score) {
            best = option;
            score = cost;
          }
        }
        if (!best) break;
        labels.push(best);
        collision.add(best.bounds);
        already.add(best.n.id);
        perBranch.set(
          best.n.branch.id,
          (perBranch.get(best.n.branch.id) || 0) + 1,
        );
      }
    }

    drawLabel(p, byGeneration) {
      const { n, cx, cy, width, height, selected, hover, root, top } = p,
        ctx = this.ctx;
      const ink = n.ink;
      const radius = root ? 6 : top ? 5 : 3.5;
      if (selected || hover) {
        ctx.strokeStyle = rgba(rootInk, selected ? 0.9 : 0.67);
        ctx.lineWidth = selected ? 2.5 : 1.5;
        roundBox(ctx, cx, cy, width + 5, height + 5, radius + 2);
        ctx.stroke();
      }
      ctx.fillStyle = byGeneration ? n.generation.fill : ink;
      roundBox(ctx, cx, cy, width, height, radius);
      ctx.fill();
      if (!root && !top) {
        ctx.strokeStyle = rgba(
          ink,
          this.path.has(n.id) || hover ? 0.94 : p.overviewDetail ? 0.33 : 0.54,
        );
        ctx.lineWidth = selected || hover ? 1.65 : 0.85;
        ctx.stroke();
      }
      ctx.font = p.font;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillStyle = byGeneration ? n.generation.text : "#ffffff";
      const firstLineY = cy + 0.5 - (p.lines.length - 1) * p.lineHeight / 2;
      p.lines.forEach((line, i) => ctx.fillText(line, cx, firstLineY + i * p.lineHeight));
      this.hits.push({ id: n.id, bounds: box(cx, cy, width, height), cx, cy });
    }

    startGesture(event) {
      if (!event.sourceEvent) return;
      this.branchFocusId = null;
      this.surface.interrupt();
      this.gesture = { start: event.transform, moved: false };
      if (event.sourceEvent.type !== "wheel") {
        this.canvas.style.cursor = "grabbing";
        this.setHover(null);
      }
    }

    local(event) {
      const r = this.canvas.getBoundingClientRect();
      return { x: event.clientX - r.left, y: event.clientY - r.top };
    }

    hit(x, y, touch = false) {
      const radius = touch ? 10 : 5;
      const candidates = this.hits.filter(
        (h) =>
          x >= h.bounds.l - radius &&
          x <= h.bounds.r + radius &&
          y >= h.bounds.t - radius &&
          y <= h.bounds.b + radius,
      );
      if (candidates.length) {
        const distance = (h) =>
          Math.hypot(
            Math.max(h.bounds.l - x, 0, x - h.bounds.r),
            Math.max(h.bounds.t - y, 0, y - h.bounds.b),
          );
        return candidates.sort(
          (a, b) =>
            distance(a) - distance(b) ||
            Math.hypot(a.cx - x, a.cy - y) - Math.hypot(b.cx - x, b.cy - y),
        )[0].id;
      }
      let id = null,
        best = (touch ? 11 : 5.5) ** 2;
      for (const p of this.points) {
        const dx = p.x - x,
          dy = p.y - y,
          d = dx * dx + dy * dy;
        if (d < best) {
          id = p.n.id;
          best = d;
        }
      }
      return id;
    }

    setHover(id) {
      if (this.hoveredId === id) return;
      const previous = this.hits.find((label) => label.id === id);
      const node = this.nodes.get(id);
      const centre = node && this.screenPoint(node);
      this.hoverOffset =
        previous && centre
          ? [previous.cx - centre[0], previous.cy - centre[1]]
          : null;
      this.hoveredId = id;
      this.callbacks.onHover?.(id);
      this.canvas.style.cursor = this.gesture
        ? "grabbing"
        : id
          ? "pointer"
          : "grab";
      this.invalidate();
    }

    hover(event) {
      if (event.pointerType === "touch" || this.gesture || event.buttons)
        return;
      const { x, y } = this.local(event);
      this.setHover(this.hit(x, y));
    }

    click(event) {
      if (
        event.defaultPrevented ||
        performance.now() < this.suppressClickUntil ||
        !this.root
      )
        return;
      const { x, y } = this.local(event),
        id = this.hit(x, y, event.pointerType === "touch");
      if (id == null) return;
      this.select(id);
      this.callbacks.onSelect?.(id);
    }

    key(event) {
      if (event.ctrlKey || event.altKey || event.metaKey || !this.root) return;
      const node = this.nodes.get(this.selectedId) || this.root;
      const choose = (n) => {
        if (n) {
          this.focusPerson(n.id, { openPanel: true });
          this.callbacks.onSelect?.(n.id);
        }
      };
      const t = this.transform,
        pan = event.shiftKey ? 130 : 48;
      const delta = {
        ArrowLeft: [pan, 0],
        ArrowRight: [-pan, 0],
        ArrowUp: [0, pan],
        ArrowDown: [0, -pan],
      };
      if (delta[event.key]) {
        const [x, y] = delta[event.key];
        this.branchFocusId = null;
        this.surface.interrupt().call(this.zoom.translateBy, x / t.k, y / t.k);
      } else if (event.key === "+" || event.key === "=") this.zoomBy(1.35);
      else if (event.key === "-") this.zoomBy(1 / 1.35);
      else if (event.key === "Home" || event.key === "0") this.fit();
      else if (event.key === "PageUp") choose(node.parent);
      else if (event.key === "PageDown") choose(node.children[0]);
      else if (event.key === "[" || event.key === "]") {
        const peers = node.parent?.children || [node],
          offset = event.key === "]" ? 1 : -1;
        choose(
          peers[(peers.indexOf(node) + peers.length + offset) % peers.length],
        );
      } else if (event.key === "Enter" || event.key === " ") {
        if (this.selectedId) choose(node);
        else {
          const c = this.area(this.panelOpen),
            cx = (c.l + c.r) / 2,
            cy = (c.t + c.b) / 2;
          const closest = this.points.reduce(
            (best, p) =>
              Math.hypot(p.x - cx, p.y - cy) < best.distance
                ? { node: p.n, distance: Math.hypot(p.x - cx, p.y - cy) }
                : best,
            { node: this.root, distance: Infinity },
          );
          choose(closest.node);
        }
      } else if (event.key === "Escape") {
        this.select(null);
        this.callbacks.onSelect?.(null);
      } else return;
      event.preventDefault();
    }
  }

  window.FamilyTreeMap = FamilyTreeMap;
})();
