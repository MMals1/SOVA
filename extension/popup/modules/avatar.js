'use strict';

(function initPopupAvatar(root) {
  function hashAvatarSeed(value) {
    let h1 = 0xdeadbeef ^ value.length;
    let h2 = 0x41c6ce57 ^ value.length;

    for (let i = 0; i < value.length; i++) {
      const ch = value.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return [h1 >>> 0, h2 >>> 0];
  }

  function createSvgNode(tag, attrs = {}) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }

  function buildAvatarSvg(address) {
    const normalized = String(address).trim().toLowerCase();
    const [seedA, seedB] = hashAvatarSeed(normalized);

    const hueBase = seedA % 360;
    const hueAccent = (hueBase + 35 + (seedB % 110)) % 360;
    const huePattern = (hueBase + 150 + (seedB % 90)) % 360;

    const bgStart = `hsl(${hueBase}, 72%, 56%)`;
    const bgEnd = `hsl(${hueAccent}, 68%, 30%)`;
    const tileColor = `hsla(${huePattern}, 90%, 92%, 0.7)`;
    const emblemColor = `hsl(${(huePattern + 18) % 360}, 100%, 97%)`;

    const svg = createSvgNode('svg', {
      viewBox: '0 0 100 100',
      'aria-hidden': 'true',
      focusable: 'false',
    });

    const defs = createSvgNode('defs');
    const gradientId = `avatar-grad-${seedA.toString(16)}-${seedB.toString(16)}`;
    const gradient = createSvgNode('linearGradient', {
      id: gradientId,
      x1: '0%',
      y1: '0%',
      x2: '100%',
      y2: '100%',
    });
    gradient.appendChild(createSvgNode('stop', { offset: '0%', 'stop-color': bgStart }));
    gradient.appendChild(createSvgNode('stop', { offset: '100%', 'stop-color': bgEnd }));
    defs.appendChild(gradient);
    svg.appendChild(defs);

    svg.appendChild(createSvgNode('rect', {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rx: 24,
      fill: `url(#${gradientId})`,
    }));

    const grid = createSvgNode('g', { opacity: 0.95 });
    const cellSize = 12;
    const gap = 3;
    const origin = 18;

    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        const bit = row * 3 + col;
        const isOn = ((seedA >>> bit) ^ (seedB >>> ((bit + 7) % 24))) & 1;
        if (!isOn) continue;

        const x = origin + col * (cellSize + gap);
        const y = origin + row * (cellSize + gap);
        const mirrorX = origin + (4 - col) * (cellSize + gap);
        const round = 3 + ((seedB >>> ((bit + 11) % 24)) & 0x03);

        grid.appendChild(createSvgNode('rect', {
          x,
          y,
          width: cellSize,
          height: cellSize,
          rx: round,
          fill: tileColor,
        }));

        if (mirrorX !== x) {
          grid.appendChild(createSvgNode('rect', {
            x: mirrorX,
            y,
            width: cellSize,
            height: cellSize,
            rx: round,
            fill: tileColor,
          }));
        }
      }
    }

    svg.appendChild(grid);

    const emblem = createSvgNode('g', {
      transform: 'translate(50 50)',
      fill: emblemColor,
      opacity: 0.94,
    });
    const emblemVariant = seedB % 4;

    if (emblemVariant === 0) {
      emblem.appendChild(createSvgNode('circle', { cx: 0, cy: 0, r: 10 }));
      emblem.appendChild(createSvgNode('circle', { cx: 0, cy: 0, r: 4, fill: bgEnd }));
    } else if (emblemVariant === 1) {
      emblem.appendChild(createSvgNode('rect', {
        x: -10,
        y: -10,
        width: 20,
        height: 20,
        rx: 5,
        transform: 'rotate(45)',
      }));
      emblem.appendChild(createSvgNode('rect', {
        x: -4,
        y: -4,
        width: 8,
        height: 8,
        rx: 2,
        fill: bgEnd,
        transform: 'rotate(45)',
      }));
    } else if (emblemVariant === 2) {
      emblem.appendChild(createSvgNode('path', {
        d: 'M0 -13 L11 -4 L7 12 L-7 12 L-11 -4 Z',
      }));
      emblem.appendChild(createSvgNode('circle', { cx: 0, cy: 0, r: 3.5, fill: bgEnd }));
    } else {
      emblem.appendChild(createSvgNode('path', {
        d: 'M0 -14 L12 8 L-12 8 Z',
      }));
      emblem.appendChild(createSvgNode('rect', {
        x: -2.5,
        y: -2,
        width: 5,
        height: 12,
        rx: 2,
        fill: bgEnd,
      }));
    }

    svg.appendChild(emblem);
    return svg;
  }

  function setAvatar(elementId, address) {
    const el = document.getElementById(elementId);
    if (!el || !address) return;
    if (el.dataset.avatarAddress === address) return;

    el.dataset.avatarAddress = address;
    el.style.background = 'none';
    el.replaceChildren(buildAvatarSvg(address));
  }

  root.WolfPopupAvatar = {
    setAvatar,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
