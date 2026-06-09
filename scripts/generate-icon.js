const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

function drawNotepadIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = size / 256; // scale factor

  // Background - rounded rectangle (notepad page)
  const pad = 20 * s;
  const w = size - pad * 2;
  const h = size - pad * 2;
  const r = 20 * s;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  roundRect(ctx, pad + 4 * s, pad + 4 * s, w, h, r);
  ctx.fill();

  // Page background
  ctx.fillStyle = '#F5F0E8';
  roundRect(ctx, pad, pad, w, h, r);
  ctx.fill();

  // Page border
  ctx.strokeStyle = '#D4CFC5';
  ctx.lineWidth = 2 * s;
  roundRect(ctx, pad, pad, w, h, r);
  ctx.stroke();

  // Top bar (notepad binding)
  ctx.fillStyle = '#E8B44C';
  roundRect(ctx, pad, pad, w, 36 * s, r);
  ctx.fill();
  // Clip bottom corners of top bar
  ctx.fillStyle = '#E8B44C';
  ctx.fillRect(pad, pad + 20 * s, w, 16 * s);

  // Darker stripe on binding
  ctx.fillStyle = '#D4A03C';
  ctx.fillRect(pad, pad + 28 * s, w, 8 * s);

  // Lines on the notepad
  const lineStartY = pad + 56 * s;
  const lineSpacing = 28 * s;
  const lineLeft = pad + 28 * s;
  const lineRight = pad + w - 28 * s;

  ctx.strokeStyle = '#C8D4E8';
  ctx.lineWidth = 1.5 * s;

  for (let i = 0; i < 5; i++) {
    const y = lineStartY + i * lineSpacing;
    ctx.beginPath();
    ctx.moveTo(lineLeft, y);
    ctx.lineTo(lineRight, y);
    ctx.stroke();
  }

  // "Text" scribbles on lines
  ctx.strokeStyle = '#5A6A7A';
  ctx.lineWidth = 2.5 * s;
  ctx.lineCap = 'round';

  // Line 1 - long text
  drawScribble(ctx, lineLeft, lineStartY - 4 * s, lineRight - 40 * s, 3 * s, s);
  // Line 2 - medium text
  drawScribble(ctx, lineLeft, lineStartY + lineSpacing - 4 * s, lineRight - 80 * s, 3 * s, s);
  // Line 3 - long text
  drawScribble(ctx, lineLeft, lineStartY + lineSpacing * 2 - 4 * s, lineRight - 30 * s, 3 * s, s);
  // Line 4 - short text
  drawScribble(ctx, lineLeft, lineStartY + lineSpacing * 3 - 4 * s, lineLeft + 100 * s, 3 * s, s);

  // Small pencil icon in bottom right
  const px = pad + w - 50 * s;
  const py = pad + h - 50 * s;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(-0.7);
  // Pencil body
  ctx.fillStyle = '#E8B44C';
  ctx.fillRect(-4 * s, -20 * s, 8 * s, 30 * s);
  // Pencil tip
  ctx.fillStyle = '#5A6A7A';
  ctx.beginPath();
  ctx.moveTo(-4 * s, 10 * s);
  ctx.lineTo(4 * s, 10 * s);
  ctx.lineTo(0, 18 * s);
  ctx.closePath();
  ctx.fill();
  // Eraser
  ctx.fillStyle = '#E87070';
  ctx.fillRect(-4 * s, -24 * s, 8 * s, 6 * s);
  ctx.restore();

  return canvas.toBuffer('image/png');
}

function drawScribble(ctx, x1, y, x2, amplitude, s) {
  ctx.beginPath();
  ctx.moveTo(x1, y);
  const segments = Math.floor((x2 - x1) / (6 * s));
  for (let i = 0; i < segments; i++) {
    const sx = x1 + (i + 1) * 6 * s;
    const sy = y + (i % 2 === 0 ? -amplitude : amplitude) * 0.5;
    ctx.lineTo(sx, sy);
  }
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function createIco(pngBuffers, sizes) {
  // ICO format: Header (6 bytes) + Directory entries (16 bytes each) + Image data
  const numImages = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * numImages;
  let dataOffset = headerSize + dirSize;

  const parts = [];

  // Header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);     // reserved
  header.writeUInt16LE(1, 2);     // type: 1 = ICO
  header.writeUInt16LE(numImages, 4);
  parts.push(header);

  // Directory entries
  let currentOffset = dataOffset;
  for (let i = 0; i < numImages; i++) {
    const entry = Buffer.alloc(16);
    const s = sizes[i] >= 256 ? 0 : sizes[i]; // 0 means 256
    entry.writeUInt8(s, 0);            // width
    entry.writeUInt8(s, 1);            // height
    entry.writeUInt8(0, 2);            // color palette
    entry.writeUInt8(0, 3);            // reserved
    entry.writeUInt16LE(1, 4);         // color planes
    entry.writeUInt16LE(32, 6);        // bits per pixel
    entry.writeUInt32LE(pngBuffers[i].length, 8);   // image size
    entry.writeUInt32LE(currentOffset, 12);          // offset
    parts.push(entry);
    currentOffset += pngBuffers[i].length;
  }

  // Image data
  for (const buf of pngBuffers) {
    parts.push(buf);
  }

  return Buffer.concat(parts);
}

// Generate icon at multiple sizes
const sizes = [16, 32, 48, 64, 128, 256];
const pngBuffers = sizes.map(s => drawNotepadIcon(s));

// Save ICO
const icoBuffer = createIco(pngBuffers, sizes);
const outPath = path.join(__dirname, '..', 'build', 'icon.ico');
fs.writeFileSync(outPath, icoBuffer);
console.log(`Icon saved to ${outPath} (${sizes.join(', ')}px sizes)`);

// Also save 256px PNG for reference
const pngPath = path.join(__dirname, '..', 'build', 'icon.png');
fs.writeFileSync(pngPath, pngBuffers[pngBuffers.length - 1]);
console.log(`PNG preview saved to ${pngPath}`);
