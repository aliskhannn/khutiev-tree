"use strict";

window.FamilyTreeExport = (() => {
  const paper = "#fffefa";
  const ink = "#27382e";
  const margin = 40;
  const measure = document.createElement("canvas").getContext("2d");
  const svgNS = "http://www.w3.org/2000/svg";
  let pdfResources;

  function element(tag, attributes) {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  }

  function fitLabel(person) {
    const { name, depth, w, h } = person;
    const width = Math.max(1, w - 6);
    measure.font = "16px sans-serif";
    const widthAt16 = text => Math.max(1, measure.measureText(text).width);
    const normal = Math.min(depth < 2 ? 19 : 16, h * 0.72);
    let lines = [name];
    if (16 * width / widthAt16(name) < 10 && name.length > 5) {
      const chars = Array.from(name);
      const middle = Math.floor(chars.length / 2);
      let split = middle;
      for (let offset = 0; offset < middle / 2; offset++) {
        const at = [middle - offset, middle + offset].find(i => /[\s-]/u.test(chars[i]));
        if (at !== undefined) { split = at + 1; break; }
      }
      lines = [chars.slice(0, split).join("").trimEnd(), chars.slice(split).join("").trimStart()];
    }
    const size = Math.min(normal, (h - 3) / (lines.length * 1.12),
      ...lines.map(line => 16 * width / widthAt16(line)));
    return { lines, size };
  }

  function scene(map, title) {
    const b = { ...map.bounds };
    for (const edge of map.edges) {
      b.l = Math.min(b.l, edge.bounds.l);
      b.r = Math.max(b.r, edge.bounds.r);
      b.t = Math.min(b.t, edge.bounds.t);
      b.b = Math.max(b.b, edge.bounds.b);
    }
    const legendTitle = map.callbacks.t("Поколения");
    measure.font = "32px sans-serif";
    const titleWidth = measure.measureText(title).width;
    measure.font = "20px sans-serif";
    const keyStart = Math.ceil(measure.measureText(legendTitle).width) + 18;
    const innerWidth = Math.max(b.r - b.l, titleWidth, keyStart + 46);
    const width = Math.ceil(innerWidth + 2 * margin);
    const columns = Math.max(1, Math.floor((innerWidth - keyStart) / 46));
    const count = map.ordered.reduce((max, n) => Math.max(max, n.depth + 1), 0);
    const key = Array.from({ length: count }, (_, i) => {
      const colors = FamilyTreeMap.generationColor(i + 1);
      return {
        x: margin + keyStart + 19 + (i % columns) * 46,
        y: margin + 65 + Math.floor(i / columns) * 33,
        w: 38, h: 25, color: colors.fill, ...colors, lines: [String(i + 1)], size: 17,
      };
    });
    const headingHeight = 64 + Math.ceil(count / columns) * 33;
    const dx = margin - b.l, dy = margin + headingHeight - b.t;
    const height = Math.ceil(b.b - b.t + 2 * margin + headingHeight);
    const paths = map.edges.map(({ node, route }) => {
      const ops = [
        { op: "m", c: [node.parent.x + dx, node.parent.y + dy] },
        { op: "l", c: [route[0] + dx, route[1] + dy] },
      ];
      for (let i = 2; i < route.length; i += 6) {
        ops.push({ op: "c", c: [route[i] + dx, route[i+1] + dy, route[i+2] + dx,
          route[i+3] + dy, route[i+4] + dx, route[i+5] + dy] });
      }
      ops.push({ op: "l", c: [node.x + dx, node.y + dy] });
      return { ops, color: node.ink, weight: node.depth <= 1 ? 2.6 : 1.15 };
    });
    const cards = map.ordered.map(p => ({
      x: p.x + dx, y: p.y + dy, w: p.w, h: p.h,
      color: p.ink, ...p.generation, ...fitLabel(p),
    }));
    return { width, height, title, legendTitle, paths, cards: key.concat(cards) };
  }

  function labels(card, write) {
    const { x, y, w, lines, size, text } = card;
    lines.forEach((line, i) => {
      const baseline = y + size * 0.34 + (i - (lines.length - 1) / 2) * size * 1.12;
      write(line, x, baseline, size, text, w - 5);
    });
  }

  function renderSvg(s) {
    const svg = element("svg", { xmlns: svgNS, viewBox: '0 0 ' + s.width + ' ' + s.height,
      "font-family": "sans-serif", role: "img", "aria-label": s.title });
    svg.append(element("rect", { width: s.width, height: s.height, fill: paper }));
    function text(value, x, y, size, color, align) {
      const label = element("text", { x, y, "font-size": size, fill: color, "text-anchor": align });
      label.textContent = value;
      svg.append(label);
    }
    text(s.title, margin, margin + 30, 32, ink, "start");
    text(s.legendTitle, margin, margin + 72, 20, ink, "start");
    for (const { ops, weight, color } of s.paths) {
      const d = ops.map(({ op, c }) => op.toUpperCase() + c.join(" ")).join(" ");
      svg.append(element("path", { d, stroke: color, fill: "none", "stroke-width": weight }));
    }
    for (const card of s.cards) {
      svg.append(element("rect", { x: card.x - card.w / 2, y: card.y - card.h / 2,
        width: card.w, height: card.h, rx: 5, fill: card.fill,
        stroke: card.color, "stroke-width": 1 }));
      labels(card, (v, x, y, size, color) => text(v, x, y, size, color, "middle"));
    }
    return svg;
  }

  function loadPdfLibrary() {
    if (window.jspdf) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/vendor/jspdf.umd.min.js";
      script.onload = resolve;
      script.onerror = () => { script.remove(); reject(new Error("PDF library")); };
      document.head.append(script);
    });
  }

  async function pdf(s) {
    pdfResources ??= Promise.all([loadPdfLibrary(), fetch("/vendor/dejavu-sans.b64").then(response => {
      if (!response.ok) throw Error("PDF font");
      return response.text();
    })]).catch(error => { pdfResources = undefined; throw error; });
    const [, font] = await pdfResources;
    // PDF limits a page to 14,400 points. Scale future large trees as one vector page.
    const k = Math.min(1, 14400 / Math.max(s.width, s.height));
    const width = s.width * k, height = s.height * k;
    const doc = new window.jspdf.jsPDF({ unit: "pt", format: [width, height],
      orientation: width >= height ? "landscape" : "portrait", compress: true, putOnlyUsedFonts: true });
    doc.setProperties({ title: s.title });
    doc.addFileToVFS("DejaVuSans.ttf", font);
    doc.addFont("DejaVuSans.ttf", "Tree", "normal");
    doc.setFont("Tree");
    doc.setFillColor(paper).rect(0, 0, width, height, "F");
    doc.setFontSize(32 * k).setTextColor(ink).text(s.title, margin * k, (margin + 30) * k);
    doc.setFontSize(20 * k).text(s.legendTitle, margin * k, (margin + 72) * k);
    for (const { color, weight, ops } of s.paths) {
      doc.setDrawColor(color).setLineWidth(weight * k);
      doc.path(k === 1 ? ops : ops.map(({op, c}) => ({ op, c: c.map(v => v * k) }))).stroke();
    }
    for (const card of s.cards) {
      doc.setFillColor(card.fill).setDrawColor(card.color).setLineWidth(k);
      doc.roundedRect((card.x - card.w / 2) * k, (card.y - card.h / 2) * k,
        card.w * k, card.h * k, 5 * k, 5 * k, "FD");
      labels(card, (value, x, y, size, color, maxWidth) => {
        doc.setFontSize(size * k);
        const ratio = Math.min(1, maxWidth * k / Math.max(0.01, doc.getTextWidth(value)));
        doc.setFontSize(size * k * ratio).setTextColor(color).text(value, x * k, y * k, { align: "center" });
      });
    }
    return doc.output("blob");
  }

  async function png(s) {
    const mobile = matchMedia("(pointer: coarse)").matches;
    const limits = mobile ? [15e6, 8e6] : [32e6, 15e6, 8e6];
    for (const pixels of limits) {
      const scale = Math.min(2, (mobile ? 4096 : 8192) / Math.max(s.width, s.height),
        Math.sqrt(pixels / (s.width * s.height)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(s.width * scale);
      canvas.height = Math.ceil(s.height * scale);
      try {
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) continue;
        ctx.scale(scale, scale);
        ctx.fillStyle = paper;
        ctx.fillRect(0, 0, canvas.width / scale, canvas.height / scale);
        ctx.fillStyle = ink;
        ctx.font = "32px sans-serif";
        ctx.fillText(s.title, margin, margin + 30);
        ctx.font = "20px sans-serif";
        ctx.fillText(s.legendTitle, margin, margin + 72);
        for (const { ops, color, weight } of s.paths) {
          ctx.strokeStyle = color;
          ctx.lineWidth = weight;
          ctx.beginPath();
          for (const { op, c } of ops) {
            if (op === "m") ctx.moveTo(...c);
            else if (op === "l") ctx.lineTo(...c);
            else ctx.bezierCurveTo(...c);
          }
          ctx.stroke();
        }
        ctx.textAlign = "center";
        ctx.lineWidth = 1;
        for (const card of s.cards) {
          ctx.fillStyle = card.fill;
          ctx.strokeStyle = card.color;
          ctx.beginPath();
          ctx.roundRect(card.x - card.w / 2, card.y - card.h / 2, card.w, card.h, 5);
          ctx.fill();
          ctx.stroke();
          labels(card, (value, x, y, size, color, width) => {
            ctx.fillStyle = color;
            ctx.font = size + "px sans-serif";
            ctx.fillText(value, x, y, width);
          });
        }
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        if (blob) return blob;
      } finally {
        canvas.width = canvas.height = 1;
      }
    }
    throw Error("PNG canvas allocation");
  }

  return {
    svg: (map, title) => renderSvg(scene(map, title)),
    async download(map, title, format) {
      const s = scene(map, title);
      const blob = await (format === "PDF" ? pdf(s) : png(s));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = title + "." + format.toLowerCase();
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
  };
})();
