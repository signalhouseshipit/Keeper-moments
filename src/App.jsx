import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload, ArrowRight, ArrowLeft, Download, RefreshCcw,
  Image as ImageIcon, Check, AlertTriangle, Loader2,
  Grid3x3, ZoomIn, ZoomOut, Move, Sparkles, Package, Layers,
  FileImage, Printer, Info, Scissors, Eye
} from 'lucide-react';

/* ============================================================
   KEEPER MOMENTS — Mosaic Production System · v2
   Change log from v1:
   - Added customer-facing "Your mosaic" preview on export screen
     (shows only the visible 2.5" tile regions, no bleed)
   - Relabeled print sheets as "Production files" with clear
     explanation that mirror bleed gets trimmed during die-cutting
   ============================================================ */

// --- Production constants (NON-NEGOTIABLE per spec) ---
const DPI = 300;
const TILE_VISIBLE_IN = 2.5;
const TILE_CUT_IN = 3.204;
const BLEED_IN = (TILE_CUT_IN - TILE_VISIBLE_IN) / 2;
const TILE_VISIBLE_PX = Math.round(TILE_VISIBLE_IN * DPI); // 750
const TILE_CUT_PX = Math.round(TILE_CUT_IN * DPI);         // 961
const BLEED_PX = Math.round(BLEED_IN * DPI);               // 106

const SHEET_W_IN = 8.5;
const SHEET_H_IN = 11;
const SHEET_W_PX = SHEET_W_IN * DPI;
const SHEET_H_PX = SHEET_H_IN * DPI;
const SHEET_COLS = 2;
const SHEET_ROWS = 3;
const MAX_TILES_PER_SHEET = SHEET_COLS * SHEET_ROWS;

const MIN_IMAGE_SHORT_SIDE = 1200;

const PRODUCTS = [
  { id: 'mini',       name: 'Mini',        cols: 2, rows: 2, desc: '5 × 5 inches',      price: '$18' },
  { id: 'finishline', name: 'Finish Line', cols: 2, rows: 3, desc: '5 × 7.5 inches',    price: '$22' },
  { id: 'hero',       name: 'Hero',        cols: 3, rows: 3, desc: '7.5 × 7.5 inches',  price: '$25', popular: true },
  { id: 'statement',  name: 'Statement',   cols: 3, rows: 4, desc: '7.5 × 10 inches',   price: '$42' },
  { id: 'grand',      name: 'Grand',       cols: 4, rows: 5, desc: '10 × 12.5 inches',  price: '$75' },
];

const STEPS = [
  { id: 'select',  label: 'Size' },
  { id: 'upload',  label: 'Upload' },
  { id: 'crop',    label: 'Crop' },
  { id: 'preview', label: 'Preview' },
  { id: 'export',  label: 'Export' },
];

/* ===================== Utility helpers ===================== */

const loadImageFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

const downloadCanvas = (canvas, filename) =>
  new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve();
    }, 'image/png');
  });

const coverScale = (imgW, imgH, frameW, frameH) =>
  Math.max(frameW / imgW, frameH / imgH);

function renderMosaic(image, crop, product, frame) {
  const outW = product.cols * TILE_VISIBLE_PX;
  const outH = product.rows * TILE_VISIBLE_PX;
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const base = coverScale(image.width, image.height, frame.w, frame.h);
  const scale = base * crop.zoom;
  const dispW = image.width * scale;
  const dispH = image.height * scale;
  const imgLeft = (frame.w - dispW) / 2 + crop.offsetX;
  const imgTop  = (frame.h - dispH) / 2 + crop.offsetY;

  const srcX = (-imgLeft) / scale;
  const srcY = (-imgTop)  / scale;
  const srcW = frame.w / scale;
  const srcH = frame.h / scale;

  ctx.drawImage(image, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
  return canvas;
}

/* NEW: Customer-facing preview — shows only visible tiles with small gaps
   between them so it reads as "individual magnets", not a smeared sheet. */
function renderCustomerPreview(mosaic, product, maxDisplay = 520) {
  const mosaicW = product.cols * TILE_VISIBLE_PX;
  const mosaicH = product.rows * TILE_VISIBLE_PX;
  const scale = Math.min(maxDisplay / mosaicW, maxDisplay / mosaicH);
  const dispTile = Math.floor(TILE_VISIBLE_PX * scale);
  const gap = 3;
  const pad = 0;
  const w = dispTile * product.cols + gap * (product.cols - 1) + pad * 2;
  const h = dispTile * product.rows + gap * (product.rows - 1) + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // Background shows through the inter-tile gaps
  ctx.fillStyle = '#e8dec8';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (let r = 0; r < product.rows; r++) {
    for (let c = 0; c < product.cols; c++) {
      const sx = c * TILE_VISIBLE_PX;
      const sy = r * TILE_VISIBLE_PX;
      const dx = pad + c * (dispTile + gap);
      const dy = pad + r * (dispTile + gap);
      ctx.drawImage(
        mosaic,
        sx, sy, TILE_VISIBLE_PX, TILE_VISIBLE_PX,
        dx, dy, dispTile, dispTile
      );
    }
  }
  return canvas;
}

function generateTileWithBleed(mosaic, col, row) {
  const srcX = col * TILE_VISIBLE_PX;
  const srcY = row * TILE_VISIBLE_PX;

  const tile = document.createElement('canvas');
  tile.width = TILE_CUT_PX;
  tile.height = TILE_CUT_PX;
  const ctx = tile.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(
    mosaic,
    srcX, srcY, TILE_VISIBLE_PX, TILE_VISIBLE_PX,
    BLEED_PX, BLEED_PX, TILE_VISIBLE_PX, TILE_VISIBLE_PX
  );

  const mirror = (sx, sy, sw, sh, dx, dy, dw, dh, flipX, flipY) => {
    ctx.save();
    ctx.translate(dx + (flipX ? dw : 0), dy + (flipY ? dh : 0));
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(mosaic, sx, sy, sw, sh, 0, 0, dw, dh);
    ctx.restore();
  };

  mirror(srcX, srcY, TILE_VISIBLE_PX, BLEED_PX,
         BLEED_PX, 0, TILE_VISIBLE_PX, BLEED_PX, false, true);
  mirror(srcX, srcY + TILE_VISIBLE_PX - BLEED_PX, TILE_VISIBLE_PX, BLEED_PX,
         BLEED_PX, BLEED_PX + TILE_VISIBLE_PX, TILE_VISIBLE_PX, BLEED_PX, false, true);
  mirror(srcX, srcY, BLEED_PX, TILE_VISIBLE_PX,
         0, BLEED_PX, BLEED_PX, TILE_VISIBLE_PX, true, false);
  mirror(srcX + TILE_VISIBLE_PX - BLEED_PX, srcY, BLEED_PX, TILE_VISIBLE_PX,
         BLEED_PX + TILE_VISIBLE_PX, BLEED_PX, BLEED_PX, TILE_VISIBLE_PX, true, false);
  mirror(srcX, srcY, BLEED_PX, BLEED_PX,
         0, 0, BLEED_PX, BLEED_PX, true, true);
  mirror(srcX + TILE_VISIBLE_PX - BLEED_PX, srcY, BLEED_PX, BLEED_PX,
         BLEED_PX + TILE_VISIBLE_PX, 0, BLEED_PX, BLEED_PX, true, true);
  mirror(srcX, srcY + TILE_VISIBLE_PX - BLEED_PX, BLEED_PX, BLEED_PX,
         0, BLEED_PX + TILE_VISIBLE_PX, BLEED_PX, BLEED_PX, true, true);
  mirror(srcX + TILE_VISIBLE_PX - BLEED_PX, srcY + TILE_VISIBLE_PX - BLEED_PX, BLEED_PX, BLEED_PX,
         BLEED_PX + TILE_VISIBLE_PX, BLEED_PX + TILE_VISIBLE_PX, BLEED_PX, BLEED_PX, true, true);

  // Punch-die alignment octagon — faint outline, discarded by the punch itself
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 1.5;
  drawOctagonPath(
    ctx,
    TILE_CUT_PX / 2,
    TILE_CUT_PX / 2,
    TILE_CUT_PX,
    OCTAGON_CHAMFER_PX
  );
  ctx.stroke();
  ctx.restore();return tile;
}

function generateSheets(tiles) {
  const sheets = [];
  const total = Math.ceil(tiles.length / MAX_TILES_PER_SHEET);
  for (let i = 0; i < tiles.length; i += MAX_TILES_PER_SHEET) {
    const batch = tiles.slice(i, i + MAX_TILES_PER_SHEET);
    sheets.push(renderSheet(batch, Math.floor(i / MAX_TILES_PER_SHEET), total));
  }
  return sheets;
}

function renderSheet(batch, sheetIdx, totalSheets) {
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_W_PX;
  canvas.height = SHEET_H_PX;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SHEET_W_PX, SHEET_H_PX);

  const gridW = SHEET_COLS * TILE_CUT_PX;
  const gridH = SHEET_ROWS * TILE_CUT_PX;
  const marginX = Math.round((SHEET_W_PX - gridW) / 2);
  const marginY = Math.round((SHEET_H_PX - gridH) / 2);

  batch.forEach((tile, idx) => {
    const col = idx % SHEET_COLS;
    const row = Math.floor(idx / SHEET_COLS);
    const x = marginX + col * TILE_CUT_PX;
    const y = marginY + row * TILE_CUT_PX;
    ctx.drawImage(tile.canvas, x, y);
    drawCutGuides(ctx, x, y, tile.label);
  });drawSheetCutLines(ctx, marginX, marginY, batch.length);

  ctx.fillStyle = '#888';
  ctx.font = '28px sans-serif';
  ctx.fillText(
    `Keeper Moments · Sheet ${sheetIdx + 1}/${totalSheets} · Cut along dashed lines · 300 DPI`,
    40, 40
  );
  return canvas;
}
/* Full-sheet dashed cut lines, drawn only through bleed zones (never through
   visible tile content so they don't appear on the finished magnet). */
function drawSheetCutLines(ctx, marginX, marginY, numBatchTiles) {
  const colsUsed = Math.min(SHEET_COLS, numBatchTiles);
  const rowsUsed = Math.ceil(numBatchTiles / SHEET_COLS);

  const cutsX = [];
  for (let c = 0; c < colsUsed; c++) {
    cutsX.push(marginX + c * TILE_CUT_PX + BLEED_PX);
    cutsX.push(marginX + c * TILE_CUT_PX + BLEED_PX + TILE_VISIBLE_PX);
  }
  const cutsY = [];
  for (let r = 0; r < rowsUsed; r++) {
    cutsY.push(marginY + r * TILE_CUT_PX + BLEED_PX);
    cutsY.push(marginY + r * TILE_CUT_PX + BLEED_PX + TILE_VISIBLE_PX);
  }

  const visibleYRanges = [];
  for (let r = 0; r < rowsUsed; r++) {
    visibleYRanges.push([
      marginY + r * TILE_CUT_PX + BLEED_PX,
      marginY + r * TILE_CUT_PX + BLEED_PX + TILE_VISIBLE_PX,
    ]);
  }
  const visibleXRanges = [];
  for (let c = 0; c < colsUsed; c++) {
    visibleXRanges.push([
      marginX + c * TILE_CUT_PX + BLEED_PX,
      marginX + c * TILE_CUT_PX + BLEED_PX + TILE_VISIBLE_PX,
    ]);
  }

  ctx.save();
  ctx.strokeStyle = 'rgba(210, 30, 30, 0.85)';
  ctx.lineWidth = 2;

  cutsX.forEach((x) => {
    let y = 0;
    visibleYRanges.forEach(([yStart, yEnd]) => {
      if (y < yStart) {
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x, yStart); ctx.stroke();
      }
      y = yEnd;
    });
    if (y < SHEET_H_PX) {
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x, SHEET_H_PX); ctx.stroke();
    }
  });

  cutsY.forEach((y) => {
    let x = 0;
    visibleXRanges.forEach(([xStart, xEnd]) => {
      if (x < xStart) {
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(xStart, y); ctx.stroke();
      }
      x = xEnd;
    });
    if (x < SHEET_W_PX) {
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(SHEET_W_PX, y); ctx.stroke();
    }
  });

  ctx.restore();
}
// Octagon shape of the punch die — tune chamfer if the die's cut doesn't match
const OCTAGON_CHAMFER_IN = 0.7;
const OCTAGON_CHAMFER_PX = Math.round(OCTAGON_CHAMFER_IN * DPI);

function drawOctagonPath(ctx, cx, cy, size, chamfer) {
  const h = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx - h + chamfer, cy - h);
  ctx.lineTo(cx + h - chamfer, cy - h);
  ctx.lineTo(cx + h, cy - h + chamfer);
  ctx.lineTo(cx + h, cy + h - chamfer);
  ctx.lineTo(cx + h - chamfer, cy + h);
  ctx.lineTo(cx - h + chamfer, cy + h);
  ctx.lineTo(cx - h, cy + h - chamfer);
  ctx.lineTo(cx - h, cy - h + chamfer);
  ctx.closePath();
}

function drawCutGuides(ctx, x, y, label) {
  const visX = x + BLEED_PX;
  const visY = y + BLEED_PX;
  const visW = TILE_VISIBLE_PX;
  const visH = TILE_VISIBLE_PX;
  const len = 36;
  const gap = 8;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  const corners = [
    [visX, visY, -1, -1],
    [visX + visW, visY, 1, -1],
    [visX, visY + visH, -1, 1],
    [visX + visW, visY + visH, 1, 1],
  ];
  corners.forEach(([cx, cy, dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy + dy * gap);
    ctx.lineTo(cx, cy + dy * (gap + len));
    ctx.moveTo(cx + dx * gap, cy);
    ctx.lineTo(cx + dx * (gap + len), cy);
    ctx.stroke();
  });

  if (label) {
    ctx.fillStyle = '#aaa';
    ctx.font = '18px sans-serif';
    ctx.fillText(label, x + 8, y + TILE_CUT_PX - 8);
  }
}

/* ===================== UI components ===================== */

function StepIndicator({ current }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <React.Fragment key={s.id}>
            <div className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium transition-all ${
                  active
                    ? 'bg-[#b84a1a] text-[#faf6ee] ring-4 ring-[#b84a1a]/15'
                    : done
                    ? 'bg-[#1a1410] text-[#faf6ee]'
                    : 'bg-[#e5d9c2] text-[#8a7d6e]'
                }`}
              >
                {done ? <Check size={13} strokeWidth={2.5} /> : i + 1}
              </div>
              <span
                className={`text-[13px] tracking-wide ${
                  active ? 'text-[#1a1410] font-medium' : done ? 'text-[#1a1410]' : 'text-[#8a7d6e]'
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-6 h-px ${i < idx ? 'bg-[#1a1410]' : 'bg-[#d9cdb8]'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Button({ children, onClick, variant = 'primary', disabled, icon: Icon, iconRight, className = '' }) {
  const base = 'inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed';
  const styles = {
    primary: 'bg-[#b84a1a] text-[#faf6ee] hover:bg-[#9a3d14] active:scale-[0.98]',
    dark: 'bg-[#1a1410] text-[#faf6ee] hover:bg-[#2a2218] active:scale-[0.98]',
    ghost: 'bg-transparent text-[#1a1410] hover:bg-[#1a1410]/5',
    outline: 'border border-[#1a1410]/20 text-[#1a1410] hover:border-[#1a1410]/40 hover:bg-[#1a1410]/[0.03]',
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]} ${className}`}>
      {Icon && <Icon size={16} strokeWidth={2} />}
      {children}
      {iconRight && React.createElement(iconRight, { size: 16, strokeWidth: 2 })}
    </button>
  );
}

/* ---------- Step 1: Product selection ---------- */
function ProductStep({ onSelect }) {
  return (
    <div>
      <div className="mb-10">
        <div className="text-[11px] tracking-[0.2em] text-[#b84a1a] uppercase mb-3">Step One</div>
        <h2 className="text-[44px] leading-[1.05] font-serif text-[#1a1410] mb-3">Pick your mosaic.</h2>
        <p className="text-[#5a4f42] max-w-xl text-[15px] leading-relaxed">
          Each tile is a hand-pressed 2.5-inch photo magnet. Choose how many tiles make up your finished image.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {PRODUCTS.map((p) => {
          const tiles = p.cols * p.rows;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              className="group relative text-left bg-[#faf6ee] border border-[#d9cdb8] rounded-xl p-6 hover:border-[#1a1410] hover:-translate-y-0.5 transition-all"
            >
              {p.popular && (
                <div className="absolute top-4 right-4 text-[10px] tracking-[0.15em] uppercase text-[#b84a1a] font-medium bg-[#b84a1a]/10 px-2 py-1 rounded-full">
                  Best seller
                </div>
              )}
              <div
                className="bg-[#1a1410]/5 rounded-md p-3 mb-5 flex items-center justify-center"
                style={{ aspectRatio: `${p.cols}/${p.rows}`, maxHeight: 140 }}
              >
                <div
                  className="grid gap-1 w-full h-full"
                  style={{
                    gridTemplateColumns: `repeat(${p.cols}, 1fr)`,
                    gridTemplateRows: `repeat(${p.rows}, 1fr)`,
                  }}
                >
                  {Array.from({ length: tiles }).map((_, i) => (
                    <div key={i} className="bg-[#1a1410]/15 rounded-[2px] group-hover:bg-[#b84a1a]/30 transition-colors" />
                  ))}
                </div>
              </div>
              <div className="flex items-baseline justify-between mb-1">
                <div className="font-serif text-[24px] text-[#1a1410]">{p.name}</div>
                <div className="text-[#1a1410] font-medium text-[15px]">{p.price}</div>
              </div>
              <div className="text-[13px] text-[#8a7d6e] mb-4 font-mono tracking-tight">
                {p.cols} × {p.rows} · {tiles} tiles · {p.desc}
              </div>
              <div className="flex items-center gap-1 text-[13px] text-[#b84a1a] font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                Select <ArrowRight size={13} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Step 2: Upload ---------- */
function UploadStep({ onUpload, onBack, product }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('That file isn\'t an image. Try a JPG or PNG.');
      return;
    }
    setLoading(true);
    try {
      const img = await loadImageFile(file);
      const shortSide = Math.min(img.width, img.height);
      if (shortSide < MIN_IMAGE_SHORT_SIDE) {
        setError(
          `That photo is ${img.width}×${img.height}. For crisp magnets we need at least ${MIN_IMAGE_SHORT_SIDE}px on the short side. Try a higher-res version.`
        );
        setLoading(false);
        return;
      }
      onUpload(img);
    } catch (e) {
      setError(e.message || 'Something went wrong loading that image.');
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-8">
        <div className="text-[11px] tracking-[0.2em] text-[#b84a1a] uppercase mb-3">Step Two</div>
        <h2 className="text-[44px] leading-[1.05] font-serif text-[#1a1410] mb-3">Drop your photo in.</h2>
        <p className="text-[#5a4f42] text-[15px]">
          For <span className="font-medium">{product.name}</span> we'll need a {product.cols}:{product.rows} aspect
          ratio — don't worry about it, you can crop in the next step.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFile(e.dataTransfer.files[0]);
        }}
        onClick={() => inputRef.current?.click()}
        className={`relative cursor-pointer border-2 border-dashed rounded-2xl py-20 px-8 text-center transition-all ${
          dragging
            ? 'border-[#b84a1a] bg-[#b84a1a]/5'
            : 'border-[#d9cdb8] bg-[#faf6ee] hover:border-[#1a1410]/40'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => handleFile(e.target.files[0])}
        />
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={32} className="animate-spin text-[#b84a1a]" />
            <div className="text-[#5a4f42] text-[14px]">Reading photo…</div>
          </div>
        ) : (
          <>
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#1a1410] text-[#faf6ee] mb-5">
              <Upload size={22} />
            </div>
            <div className="font-serif text-[26px] text-[#1a1410] mb-1">Drag a photo here</div>
            <div className="text-[14px] text-[#8a7d6e]">or click to browse · JPG or PNG · min {MIN_IMAGE_SHORT_SIDE}px</div>
          </>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-3 p-4 bg-[#fef5f0] border border-[#b84a1a]/30 rounded-lg text-[14px] text-[#8a3d14]">
          <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      <div className="mt-8">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
          Back to sizes
        </Button>
      </div>
    </div>
  );
}

/* ---------- Step 3: Crop ---------- */
function CropStep({ image, product, onConfirm, onBack }) {
  const frameRef = useRef(null);
  const [frameSize, setFrameSize] = useState({ w: 1, h: 1 });
  const [crop, setCrop] = useState({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  useEffect(() => {
    const containerW = 560;
    const ar = product.cols / product.rows;
    let w, h;
    if (ar >= 1) { w = containerW; h = containerW / ar; }
    else { h = 500; w = 500 * ar; }
    setFrameSize({ w, h });
  }, [product]);

  const clamp = useCallback((next) => {
    const base = coverScale(image.width, image.height, frameSize.w, frameSize.h);
    const dispW = image.width * base * next.zoom;
    const dispH = image.height * base * next.zoom;
    const maxX = Math.max(0, (dispW - frameSize.w) / 2);
    const maxY = Math.max(0, (dispH - frameSize.h) / 2);
    return {
      zoom: next.zoom,
      offsetX: Math.max(-maxX, Math.min(maxX, next.offsetX)),
      offsetY: Math.max(-maxY, Math.min(maxY, next.offsetY)),
    };
  }, [image, frameSize]);

  useEffect(() => { setCrop((c) => clamp(c)); }, [clamp]);

  const onMouseDown = (e) => {
    e.preventDefault();
    setDragging(true);
    const pt = e.touches ? e.touches[0] : e;
    dragStart.current = { x: pt.clientX, y: pt.clientY, ox: crop.offsetX, oy: crop.offsetY };
  };
  const onMouseMove = (e) => {
    if (!dragging) return;
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - dragStart.current.x;
    const dy = pt.clientY - dragStart.current.y;
    setCrop((c) => clamp({ ...c, offsetX: dragStart.current.ox + dx, offsetY: dragStart.current.oy + dy }));
  };
  const onMouseUp = () => setDragging(false);

  useEffect(() => {
    if (!dragging) return;
    const mv = (e) => onMouseMove(e);
    const up = () => onMouseUp();
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', mv);
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', mv);
      window.removeEventListener('touchend', up);
    };
  }, [dragging]);

  const base = coverScale(image.width, image.height, frameSize.w, frameSize.h);
  const scale = base * crop.zoom;
  const dispW = image.width * scale;
  const dispH = image.height * scale;
  const imgLeft = (frameSize.w - dispW) / 2 + crop.offsetX;
  const imgTop = (frameSize.h - dispH) / 2 + crop.offsetY;

  return (
    <div>
      <div className="mb-8">
        <div className="text-[11px] tracking-[0.2em] text-[#b84a1a] uppercase mb-3">Step Three</div>
        <h2 className="text-[44px] leading-[1.05] font-serif text-[#1a1410] mb-3">Frame it up.</h2>
        <p className="text-[#5a4f42] text-[15px]">Drag to reposition. Use the slider to zoom. The grid shows where each tile will split.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div>
          <div
            ref={frameRef}
            onMouseDown={onMouseDown}
            onTouchStart={onMouseDown}
            className={`relative overflow-hidden bg-[#1a1410] rounded-lg shadow-[0_20px_60px_-20px_rgba(26,20,16,0.3)] ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            style={{ width: frameSize.w, height: frameSize.h, userSelect: 'none' }}
          >
            <img
              src={image.src}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                left: imgLeft,
                top: imgTop,
                width: dispW,
                height: dispH,
                maxWidth: 'none',
                pointerEvents: 'none',
              }}
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: `
                  linear-gradient(to right, rgba(255,255,255,0.5) 1px, transparent 1px),
                  linear-gradient(to bottom, rgba(255,255,255,0.5) 1px, transparent 1px)
                `,
                backgroundSize: `${frameSize.w / product.cols}px ${frameSize.h / product.rows}px`,
              }}
            />
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-white" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-white" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-white" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-white" />
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-[240px] space-y-6">
          <div className="bg-[#faf6ee] border border-[#d9cdb8] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-[13px] text-[#1a1410] font-medium">
                <ZoomIn size={15} /> Zoom
              </div>
              <div className="font-mono text-[13px] text-[#8a7d6e]">{crop.zoom.toFixed(2)}×</div>
            </div>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={crop.zoom}
              onChange={(e) => setCrop((c) => clamp({ ...c, zoom: parseFloat(e.target.value) }))}
              className="w-full accent-[#b84a1a]"
            />
            <button
              onClick={() => setCrop({ zoom: 1, offsetX: 0, offsetY: 0 })}
              className="mt-3 text-[12px] text-[#8a7d6e] hover:text-[#1a1410] inline-flex items-center gap-1"
            >
              <RefreshCcw size={11} /> Reset
            </button>
          </div>

          <div className="bg-[#1a1410] text-[#faf6ee] rounded-xl p-5">
            <div className="text-[11px] tracking-[0.2em] uppercase text-[#c9ac8f] mb-3 flex items-center gap-2">
              <Layers size={12} /> Production specs
            </div>
            <dl className="space-y-1.5 font-mono text-[12px]">
              <div className="flex justify-between"><dt className="text-[#c9ac8f]">Mosaic</dt><dd>{product.cols}×{product.rows} · {product.cols * product.rows} tiles</dd></div>
              <div className="flex justify-between"><dt className="text-[#c9ac8f]">Visible tile</dt><dd>2.5" · 750px</dd></div>
              <div className="flex justify-between"><dt className="text-[#c9ac8f]">Cut size</dt><dd>3.204" · 961px</dd></div>
              <div className="flex justify-between"><dt className="text-[#c9ac8f]">Bleed</dt><dd>0.352" mirrored</dd></div>
              <div className="flex justify-between"><dt className="text-[#c9ac8f]">Output</dt><dd>300 DPI</dd></div>
            </dl>
          </div>
        </div>
      </div>

      <div className="mt-10 flex items-center justify-between">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>Re-upload</Button>
        <Button variant="primary" iconRight={ArrowRight} onClick={() => onConfirm(crop, frameSize)}>
          Preview mosaic
        </Button>
      </div>
    </div>
  );
}

/* ---------- Step 4: Preview ---------- */
function PreviewStep({ image, product, crop, frameSize, onBack, onGenerate }) {
  const canvasRef = useRef(null);
  const [showSeams, setShowSeams] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ar = product.cols / product.rows;
    const maxW = 640;
    const maxH = 520;
    let dispW, dispH;
    if (ar >= maxW / maxH) { dispW = maxW; dispH = maxW / ar; }
    else { dispH = maxH; dispW = maxH * ar; }
    canvas.width = dispW;
    canvas.height = dispH;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1410';
    ctx.fillRect(0, 0, dispW, dispH);

    const base = coverScale(image.width, image.height, frameSize.w, frameSize.h);
    const scale = base * crop.zoom;
    const srcX = (-((frameSize.w - image.width * scale) / 2 + crop.offsetX)) / scale;
    const srcY = (-((frameSize.h - image.height * scale) / 2 + crop.offsetY)) / scale;
    const srcW = frameSize.w / scale;
    const srcH = frameSize.h / scale;

    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, srcX, srcY, srcW, srcH, 0, 0, dispW, dispH);

    if (showSeams) {
      const tileW = dispW / product.cols;
      const tileH = dispH / product.rows;
      ctx.strokeStyle = 'rgba(244, 237, 224, 0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      for (let c = 1; c < product.cols; c++) {
        ctx.beginPath();
        ctx.moveTo(c * tileW, 0);
        ctx.lineTo(c * tileW, dispH);
        ctx.stroke();
      }
      for (let r = 1; r < product.rows; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * tileH);
        ctx.lineTo(dispW, r * tileH);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }, [image, product, crop, frameSize, showSeams]);

  return (
    <div>
      <div className="mb-8">
        <div className="text-[11px] tracking-[0.2em] text-[#b84a1a] uppercase mb-3">Step Four</div>
        <h2 className="text-[44px] leading-[1.05] font-serif text-[#1a1410] mb-3">This is what you'll get.</h2>
        <p className="text-[#5a4f42] text-[15px]">Dashed lines show where magnets split. Happy? Send it to production.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div>
          <canvas ref={canvasRef} className="rounded-lg shadow-[0_20px_60px_-20px_rgba(26,20,16,0.3)]" />
          <label className="mt-4 inline-flex items-center gap-2 text-[13px] text-[#5a4f42] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showSeams}
              onChange={(e) => setShowSeams(e.target.checked)}
              className="accent-[#b84a1a]"
            />
            Show tile seams
          </label>
        </div>

        <div className="flex-1 space-y-4 min-w-[240px]">
          <div className="bg-[#faf6ee] border border-[#d9cdb8] rounded-xl p-5">
            <div className="font-serif text-[22px] text-[#1a1410] mb-1">{product.name}</div>
            <div className="text-[13px] text-[#8a7d6e] font-mono mb-4">{product.cols * product.rows} tiles · {product.desc}</div>
            <div className="pt-4 border-t border-[#d9cdb8] space-y-2 text-[13px]">
              <div className="flex justify-between text-[#5a4f42]">
                <span>Print sheets</span>
                <span className="font-mono text-[#1a1410]">{Math.ceil(product.cols * product.rows / MAX_TILES_PER_SHEET)}</span>
              </div>
              <div className="flex justify-between text-[#5a4f42]">
                <span>Dry time required</span>
                <span className="font-mono text-[#1a1410]">12–24 hrs</span>
              </div>
              <div className="flex justify-between text-[#5a4f42]">
                <span>Est. ship</span>
                <span className="font-mono text-[#1a1410]">3 biz days</span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 bg-[#fef5f0] border border-[#b84a1a]/20 rounded-lg">
            <Info size={16} className="text-[#b84a1a] flex-shrink-0 mt-0.5" />
            <div className="text-[12px] text-[#5a4f42] leading-relaxed">
              Check faces near tile seams. If a subject sits right on a seam line, go back and nudge the crop.
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 flex items-center justify-between">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>Adjust crop</Button>
        <Button variant="primary" iconRight={Sparkles} onClick={onGenerate}>
          Generate production files
        </Button>
      </div>
    </div>
  );
}

/* ---------- Step 5: Export ---------- */
function ExportStep({ image, product, crop, frameSize, onBack, onRestart }) {
  const [generating, setGenerating] = useState(true);
  const [progress, setProgress] = useState('');
  const [tiles, setTiles] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [sheetPreviews, setSheetPreviews] = useState([]);
  const [customerPreview, setCustomerPreview] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setProgress('Building mosaic at 300 DPI…');
      await new Promise((r) => setTimeout(r, 50));
      if (cancelled) return;
      const mosaic = renderMosaic(image, crop, product, frameSize);

      // Build customer preview from the mosaic (just visible tiles, no bleed)
      const previewCanvas = renderCustomerPreview(mosaic, product);
      setCustomerPreview(previewCanvas.toDataURL('image/png'));

      setProgress(`Generating ${product.cols * product.rows} tiles with mirror bleed…`);
      await new Promise((r) => setTimeout(r, 50));
      const generatedTiles = [];
      for (let r = 0; r < product.rows; r++) {
        for (let c = 0; c < product.cols; c++) {
          if (cancelled) return;
          const tile = generateTileWithBleed(mosaic, c, r);
          generatedTiles.push({
            row: r,
            col: c,
            label: `R${r + 1}C${c + 1}`,
            canvas: tile,
          });
        }
      }
      setTiles(generatedTiles);

      setProgress('Laying out print sheets…');
      await new Promise((r) => setTimeout(r, 50));
      if (cancelled) return;
      const generatedSheets = generateSheets(generatedTiles);
      setSheets(generatedSheets);

      const previews = generatedSheets.map((s) => {
        const pc = document.createElement('canvas');
        pc.width = 340;
        pc.height = Math.round(340 * (SHEET_H_PX / SHEET_W_PX));
        const pctx = pc.getContext('2d');
        pctx.fillStyle = '#fff';
        pctx.fillRect(0, 0, pc.width, pc.height);
        pctx.drawImage(s, 0, 0, pc.width, pc.height);
        return pc.toDataURL('image/png');
      });
      setSheetPreviews(previews);
      setGenerating(false);
    };
    run();
    return () => { cancelled = true; };
  }, [image, product, crop, frameSize]);

  const downloadSheet = (idx) =>
    downloadCanvas(sheets[idx], `keeper-moments-${product.id}-sheet-${idx + 1}.png`);

  const downloadAllSheets = async () => {
    for (let i = 0; i < sheets.length; i++) {
      await downloadCanvas(sheets[i], `keeper-moments-${product.id}-sheet-${i + 1}.png`);
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  const downloadAllTiles = async () => {
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      await downloadCanvas(t.canvas, `keeper-moments-${product.id}-tile-${t.label}.png`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };

  if (generating) {
    return (
      <div className="py-20 text-center">
        <Loader2 size={40} className="animate-spin text-[#b84a1a] mx-auto mb-5" />
        <div className="font-serif text-[26px] text-[#1a1410] mb-2">Cooking tiles…</div>
        <div className="text-[#8a7d6e] text-[14px] font-mono">{progress}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <div className="text-[11px] tracking-[0.2em] text-[#b84a1a] uppercase mb-3">Step Five</div>
        <h2 className="text-[44px] leading-[1.05] font-serif text-[#1a1410] mb-3">Here's your mosaic.</h2>
        <p className="text-[#5a4f42] text-[15px] max-w-2xl">
          {tiles.length} magnets, ready to press. Below is what your finished piece will look like on the fridge.
        </p>
      </div>

      {/* CUSTOMER PREVIEW — the hero */}
      <div className="mb-14">
        <div className="bg-gradient-to-br from-[#faf6ee] to-[#f0e5d0] border border-[#d9cdb8] rounded-2xl p-8 md:p-12 flex items-center justify-center">
          {customerPreview && (
            <div className="relative">
              <img
                src={customerPreview}
                alt="Your finished mosaic"
                className="max-w-full h-auto rounded-sm"
                style={{
                  filter: 'drop-shadow(0 20px 40px rgba(26, 20, 16, 0.15)) drop-shadow(0 4px 8px rgba(26, 20, 16, 0.08))',
                  maxHeight: 520,
                }}
              />
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 text-[12px] text-[#8a7d6e]">
          <Eye size={12} />
          <span>Preview of your finished {product.name.toLowerCase()} · {tiles.length} magnets at 2.5" each</span>
        </div>
      </div>

      {/* PRODUCTION FILES — operator-facing */}
      <div className="border-t border-[#d9cdb8] pt-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="mb-5">
              <div className="text-[11px] tracking-[0.2em] uppercase text-[#8a7d6e] mb-2 flex items-center gap-2">
                <Printer size={12} /> Production files
              </div>
              <h3 className="font-serif text-[26px] text-[#1a1410] mb-2">Print sheets</h3>
              <p className="text-[13px] text-[#5a4f42] leading-relaxed max-w-xl">
                These are the raw sheets that go to the printer. The doubled edges you see at each
                tile boundary are mirrored bleed — the die-cut punch trims them away so finished magnets butt
                up clean with no white edges.
              </p>
            </div>

            <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 text-[12px] text-[#8a7d6e]">
                <Scissors size={12} />
                <span className="font-mono">{sheets.length} sheets · 8.5 × 11" · 300 DPI · 0.352" bleed (trimmed)</span>
              </div>
              <Button variant="primary" icon={Download} onClick={downloadAllSheets}>
                Download all sheets
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {sheetPreviews.map((src, i) => (
                <div key={i} className="bg-[#faf6ee] border border-[#d9cdb8] rounded-lg p-4">
                  <img src={src} alt={`Sheet ${i + 1}`} className="w-full border border-[#d9cdb8] mb-3 rounded" />
                  <div className="flex items-center justify-between">
                    <div className="text-[13px] text-[#1a1410] font-mono">Sheet {i + 1} of {sheets.length}</div>
                    <button
                      onClick={() => downloadSheet(i)}
                      className="text-[12px] text-[#b84a1a] hover:text-[#9a3d14] inline-flex items-center gap-1 font-medium"
                    >
                      <Download size={12} /> PNG
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            <div className="bg-[#1a1410] text-[#faf6ee] rounded-xl p-5">
              <div className="text-[11px] tracking-[0.2em] uppercase text-[#c9ac8f] mb-4 flex items-center gap-2">
                <Package size={12} /> This batch
              </div>
              <dl className="space-y-2 font-mono text-[12px]">
                <div className="flex justify-between"><dt className="text-[#c9ac8f]">Product</dt><dd>{product.name}</dd></div>
                <div className="flex justify-between"><dt className="text-[#c9ac8f]">Tiles</dt><dd>{tiles.length}</dd></div>
                <div className="flex justify-between"><dt className="text-[#c9ac8f]">Sheets</dt><dd>{sheets.length}</dd></div>
                <div className="flex justify-between"><dt className="text-[#c9ac8f]">Resolution</dt><dd>300 DPI</dd></div>
                <div className="flex justify-between"><dt className="text-[#c9ac8f]">Bleed</dt><dd>0.352" mirror</dd></div>
              </dl>
            </div>

            <div className="bg-[#faf6ee] border border-[#d9cdb8] rounded-xl p-5">
              <div className="text-[11px] tracking-[0.2em] uppercase text-[#8a7d6e] mb-3">Need raw tiles?</div>
              <p className="text-[12px] text-[#5a4f42] mb-3 leading-relaxed">
                Download individual tile files with bleed for custom ganging or reprints.
              </p>
              <Button variant="outline" icon={FileImage} onClick={downloadAllTiles} className="w-full justify-center">
                Download {tiles.length} tiles
              </Button>
            </div>

            <div className="border border-[#d9cdb8] rounded-xl p-5">
              <div className="text-[11px] tracking-[0.2em] uppercase text-[#8a7d6e] mb-3">Press checklist</div>
              <ul className="space-y-2 text-[12px] text-[#5a4f42]">
                <li className="flex gap-2"><span className="text-[#b84a1a] font-mono">01</span> Dry printed sheets 12–24 hrs before pressing</li>
                <li className="flex gap-2"><span className="text-[#b84a1a] font-mono">02</span> Bi-directional printing: OFF</li>
                <li className="flex gap-2"><span className="text-[#b84a1a] font-mono">03</span> Paper weight under 30 lb</li>
                <li className="flex gap-2"><span className="text-[#b84a1a] font-mono">04</span> Mylar dust check before Die A</li>
                <li className="flex gap-2"><span className="text-[#b84a1a] font-mono">05</span> Magnet backing · Die B · final press</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 flex items-center justify-between">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>Back to preview</Button>
        <Button variant="dark" icon={RefreshCcw} onClick={onRestart}>Start over</Button>
      </div>
    </div>
  );
}

/* ===================== Root ===================== */

export default function App() {
  const [step, setStep] = useState('select');
  const [product, setProduct] = useState(null);
  const [image, setImage] = useState(null);
  const [crop, setCrop] = useState({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [frameSize, setFrameSize] = useState({ w: 1, h: 1 });

  const restart = () => {
    setStep('select');
    setProduct(null);
    setImage(null);
    setCrop({ zoom: 1, offsetX: 0, offsetY: 0 });
  };

  return (
    <div
      className="min-h-screen"
      style={{
        background: '#f4ede0',
        fontFamily: "'DM Sans', -apple-system, sans-serif",
        color: '#1a1410',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        .font-serif { font-family: 'Fraunces', Georgia, serif; font-optical-sizing: auto; }
        .font-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
        input[type="range"] { height: 4px; border-radius: 2px; }
        input[type="range"]::-webkit-slider-thumb {
          appearance: none; width: 18px; height: 18px;
          border-radius: 50%; background: #b84a1a; cursor: pointer;
          border: 3px solid #faf6ee; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
      `}</style>

      <header className="border-b border-[#d9cdb8] bg-[#f4ede0]/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#1a1410] text-[#faf6ee] flex items-center justify-center">
              <Grid3x3 size={16} strokeWidth={2} />
            </div>
            <div>
              <div className="font-serif text-[18px] leading-none text-[#1a1410]">Keeper Moments</div>
              <div className="text-[10px] tracking-[0.2em] uppercase text-[#8a7d6e] mt-1">Mosaic Production System</div>
            </div>
          </div>
          <div className="text-[11px] font-mono text-[#8a7d6e] hidden sm:block">
            v1.1 · Carmel, IN
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 border-b border-[#d9cdb8]/60">
        <StepIndicator current={step} />
      </div>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {step === 'select' && (
          <ProductStep onSelect={(p) => { setProduct(p); setStep('upload'); }} />
        )}
        {step === 'upload' && product && (
          <UploadStep
            product={product}
            onBack={() => setStep('select')}
            onUpload={(img) => { setImage(img); setStep('crop'); }}
          />
        )}
        {step === 'crop' && image && product && (
          <CropStep
            image={image}
            product={product}
            onBack={() => setStep('upload')}
            onConfirm={(c, fs) => { setCrop(c); setFrameSize(fs); setStep('preview'); }}
          />
        )}
        {step === 'preview' && image && product && (
          <PreviewStep
            image={image}
            product={product}
            crop={crop}
            frameSize={frameSize}
            onBack={() => setStep('crop')}
            onGenerate={() => setStep('export')}
          />
        )}
        {step === 'export' && image && product && (
          <ExportStep
            image={image}
            product={product}
            crop={crop}
            frameSize={frameSize}
            onBack={() => setStep('preview')}
            onRestart={restart}
          />
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-6 py-10 border-t border-[#d9cdb8]/60">
        <div className="flex flex-col sm:flex-row justify-between gap-4 text-[12px] text-[#8a7d6e] font-mono">
          <div>keepermoments.com</div>
          <div>2.5" visible · 3.204" cut · 0.352" bleed · 300 DPI</div>
        </div>
      </footer>
    </div>
  );
}