/* =====================================================================
 * Legal Workbench — Charts (charts.js)
 * 轻量 SVG 图表，无第三方依赖，适配深色主题
 * ===================================================================== */
(function (global) {
  'use strict';
  const LB = (global.LB = global.LB || {});

  const PALETTE = ['#4f8cff', '#36c5a8', '#f6a609', '#e0586b', '#9b6cf0', '#3fb6e8', '#7ed957', '#d98cff'];
  const C = { text: '#cdd6e4', sub: '#8a96ad', grid: '#2a3242', arc: '#1c2433' };

  function color(i) { return PALETTE[i % PALETTE.length]; }

  // 环形图（占比）
  function donut(data, opts) {
    opts = opts || {};
    const size = opts.size || 180, r = size / 2 - 14, cx = size / 2, cy = size / 2;
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    let angle = -Math.PI / 2;
    const segs = data.map((d, i) => {
      const a2 = angle + (d.value / total) * Math.PI * 2;
      const large = a2 - angle > Math.PI ? 1 : 0;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const path = `M${cx} ${cy} L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
      angle = a2;
      return `<path d="${path}" fill="${color(i)}"><title>${d.label}: ${d.value}</title></path>`;
    }).join('');
    const legend = data.map((d, i) => `<div class="lg"><i style="background:${color(i)}"></i>${d.label} <b>${d.value}</b></div>`).join('');
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="donut">${segs}<circle cx="${cx}" cy="${cy}" r="${r - 26}" fill="${C.arc}"/><text x="${cx}" y="${cy - 2}" text-anchor="middle" fill="${C.text}" font-size="22" font-weight="700">${total}</text><text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="${C.sub}" font-size="11">合计</text></svg><div class="legend">${legend}</div>`;
  }

  // 水平条形图
  function hbar(data, opts) {
    opts = opts || {};
    const max = Math.max(1, ...data.map((d) => d.value));
    const rows = data.map((d, i) => {
      const w = (d.value / max) * 100;
      return `<div class="hbar-row"><span class="hbar-label">${d.label}</span><span class="hbar-track"><span class="hbar-fill" style="width:${w}%;background:${color(i)}"></span></span><span class="hbar-val">${d.value}</span></div>`;
    }).join('');
    return `<div class="hbar-wrap">${rows}</div>`;
  }

  // 垂直柱状图
  function vbar(data, opts) {
    opts = opts || {};
    const max = Math.max(1, ...data.map((d) => d.value));
    const cols = data.map((d, i) => {
      const h = (d.value / max) * 100;
      return `<div class="vbar-col"><div class="vbar-bar" style="height:${h}%;background:${color(i)}" title="${d.label}:${d.value}"></div><div class="vbar-val">${d.value}</div><div class="vbar-label">${d.label}</div></div>`;
    }).join('');
    return `<div class="vbar-wrap">${cols}</div>`;
  }

  LB.charts = { donut, hbar, vbar, color };
})(window);
