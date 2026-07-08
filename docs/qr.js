// Self-contained QR Code generator — no dependencies.
// Supports byte mode, error-correction level M, versions 1-10 (auto-selected),
// full mask evaluation. Produces a boolean module matrix and an SVG string.
//
// This is deliberately vendored (not an npm package) to keep the project at
// zero third-party runtime dependencies. Implements ISO/IEC 18004.

// --- Galois field GF(256) with primitive polynomial 0x11D ---
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

// Reed-Solomon generator polynomial of given degree.
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

// Compute EC codewords for a block of data codewords.
function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const b of data) {
    const factor = b ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i], factor);
  }
  return res;
}

// --- Version characteristics (level M), versions 1-10 ---
// Total codewords (data + EC) per version.
const TOTAL_CODEWORDS = [null, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
// EC codewords per block (level M).
const EC_PER_BLOCK_M = [null, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
// Number of EC blocks (level M).
const NUM_BLOCKS_M = [null, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
// Remainder bits per version.
const REMAINDER_BITS = [null, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0];
// Alignment pattern center coordinates per version.
const ALIGN_POS = [
  null, [], [6, 18], [6, 22], [6, 26], [6, 30],
  [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

function dataCodewords(version) {
  return TOTAL_CODEWORDS[version] - EC_PER_BLOCK_M[version] * NUM_BLOCKS_M[version];
}

// Smallest version (1-10) whose byte-mode capacity fits `len` bytes.
function chooseVersion(len) {
  for (let v = 1; v <= 10; v++) {
    // header = 4 (mode) + 8 (char count, byte mode v<=9) bits; v10 uses 16-bit count.
    const countBits = v <= 9 ? 8 : 16;
    const capacityBytes = Math.floor((dataCodewords(v) * 8 - 4 - countBits) / 8);
    if (len <= capacityBytes) return v;
  }
  throw new Error("Data too long for QR versions 1-10");
}

// --- Bit buffer ---
function bitPush(bits, value, len) {
  for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
}

function encodeData(text, version) {
  const bytes = new TextEncoder().encode(text);
  const bits = [];
  bitPush(bits, 0b0100, 4); // byte mode
  bitPush(bits, bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) bitPush(bits, b, 8);
  const capacityBits = dataCodewords(version) * 8;
  // terminator
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  // byte-align
  while (bits.length % 8 !== 0) bits.push(0);
  // pad bytes
  const pad = [0xec, 0x11];
  let pi = 0;
  while (bits.length < capacityBits) {
    bitPush(bits, pad[pi++ % 2], 8);
  }
  // to codewords
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let cw = 0;
    for (let j = 0; j < 8; j++) cw = (cw << 1) | bits[i + j];
    codewords.push(cw);
  }
  return codewords;
}

// Split into blocks, compute EC, interleave.
function buildCodewordSequence(dataCw, version) {
  const numBlocks = NUM_BLOCKS_M[version];
  const ecLen = EC_PER_BLOCK_M[version];
  const totalData = dataCw.length;
  const shortLen = Math.floor(totalData / numBlocks);
  const numLong = totalData % numBlocks;

  const blocks = [];
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = shortLen + (b >= numBlocks - numLong ? 1 : 0);
    const data = dataCw.slice(offset, offset + len);
    offset += len;
    blocks.push({ data, ec: rsEncode(data, ecLen) });
  }

  const result = [];
  // interleave data codewords
  const maxData = shortLen + (numLong > 0 ? 1 : 0);
  for (let i = 0; i < maxData; i++) {
    for (const blk of blocks) if (i < blk.data.length) result.push(blk.data[i]);
  }
  // interleave EC codewords
  for (let i = 0; i < ecLen; i++) {
    for (const blk of blocks) result.push(blk.ec[i]);
  }
  return result;
}

// --- Matrix construction ---
function makeMatrix(size) {
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  return { modules, reserved };
}

function placeFinder(m, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c;
      if (rr < 0 || rr >= m.modules.length || cc < 0 || cc >= m.modules.length) continue;
      const isBorder = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark =
        isBorder &&
        ((r === 0 || r === 6 || c === 0 || c === 6) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      m.modules[rr][cc] = dark;
      m.reserved[rr][cc] = true;
    }
  }
}

function placeAlignment(m, version) {
  const pos = ALIGN_POS[version];
  const size = m.modules.length;
  for (const r of pos) {
    for (const c of pos) {
      // skip if overlapping a finder pattern
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          m.modules[r + dr][c + dc] = dark;
          m.reserved[r + dr][c + dc] = true;
        }
      }
    }
  }
}

function placeTiming(m) {
  const size = m.modules.length;
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    if (!m.reserved[6][i]) { m.modules[6][i] = dark; m.reserved[6][i] = true; }
    if (!m.reserved[i][6]) { m.modules[i][6] = dark; m.reserved[i][6] = true; }
  }
}

function reserveFormat(m) {
  const size = m.modules.length;
  // around top-left finder + dark module + top-right + bottom-left
  for (let i = 0; i <= 8; i++) {
    m.reserved[8][i] = true;
    m.reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    m.reserved[8][size - 1 - i] = true;
    m.reserved[size - 1 - i][8] = true;
  }
  // dark module
  m.modules[size - 8][8] = true;
  m.reserved[size - 8][8] = true;
}

function reserveVersion(m, version) {
  if (version < 7) return;
  const size = m.modules.length;
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 3; j++) {
      m.reserved[i][size - 11 + j] = true;
      m.reserved[size - 11 + j][i] = true;
    }
  }
}

function placeData(m, codewords) {
  const size = m.modules.length;
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip timing column
    const range = upward
      ? [...Array(size).keys()].reverse()
      : [...Array(size).keys()];
    for (const row of range) {
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (m.reserved[row][cc]) continue;
        m.modules[row][cc] = bitIdx < bits.length ? bits[bitIdx] === 1 : false;
        bitIdx++;
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(m, maskFn) {
  const size = m.modules.length;
  const out = m.modules.map((row) => row.slice());
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!m.reserved[r][c] && maskFn(r, c)) out[r][c] = !out[r][c];
    }
  }
  return out;
}

// BCH format info: EC level M = 0b00, mask 3 bits.
function formatBits(mask) {
  const data = (0b00 << 3) | mask; // 5 bits
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}

function placeFormat(modules, reserved, mask) {
  const size = modules.length;
  const bits = formatBits(mask);
  for (let i = 0; i <= 5; i++) modules[8][i] = ((bits >> i) & 1) === 1;
  modules[8][7] = ((bits >> 6) & 1) === 1;
  modules[8][8] = ((bits >> 7) & 1) === 1;
  modules[7][8] = ((bits >> 8) & 1) === 1;
  for (let i = 9; i <= 14; i++) modules[14 - i][8] = ((bits >> i) & 1) === 1;
  // second copy
  for (let i = 0; i <= 7; i++) modules[size - 1 - i][8] = ((bits >> i) & 1) === 1;
  for (let i = 8; i <= 14; i++) modules[8][size - 15 + i] = ((bits >> i) & 1) === 1;
}

function versionInfoBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >> i) & 1) rem ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | (rem & 0xfff);
}

function placeVersion(modules, version) {
  if (version < 7) return;
  const size = modules.length;
  const bits = versionInfoBits(version);
  for (let i = 0; i < 18; i++) {
    const bit = ((bits >> i) & 1) === 1;
    const r = Math.floor(i / 3);
    const c = i % 3;
    modules[r][size - 11 + c] = bit;
    modules[size - 11 + c][r] = bit;
  }
}

// --- Penalty scoring for mask selection ---
function penalty(modules) {
  const size = modules.length;
  let score = 0;
  // Rule 1: runs of 5+ same color
  for (let r = 0; r < size; r++) {
    let runColor = null, runLen = 0;
    for (let c = 0; c < size; c++) {
      const v = modules[r][c];
      if (v === runColor) { runLen++; } else { runColor = v; runLen = 1; }
      if (runLen === 5) score += 3; else if (runLen > 5) score += 1;
    }
  }
  for (let c = 0; c < size; c++) {
    let runColor = null, runLen = 0;
    for (let r = 0; r < size; r++) {
      const v = modules[r][c];
      if (v === runColor) { runLen++; } else { runColor = v; runLen = 1; }
      if (runLen === 5) score += 3; else if (runLen > 5) score += 1;
    }
  }
  // Rule 2: 2x2 blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
    }
  }
  // Rule 3: finder-like 1:1:3:1:1 patterns
  const pattern = [true, false, true, true, true, false, true];
  const check = (arr, i) => {
    for (let k = 0; k < 7; k++) if (arr[i + k] !== pattern[k]) return false;
    return true;
  };
  const hasQuiet = (arr, i, before) => {
    if (before) return i >= 4 && arr.slice(i - 4, i).every((x) => x === false);
    return i + 11 <= arr.length && arr.slice(i + 7, i + 11).every((x) => x === false);
  };
  for (let r = 0; r < size; r++) {
    const row = modules[r];
    for (let c = 0; c + 7 <= size; c++) {
      if (check(row, c) && (hasQuiet(row, c, true) || hasQuiet(row, c, false))) score += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    const col = modules.map((row) => row[c]);
    for (let r = 0; r + 7 <= size; r++) {
      if (check(col, r) && (hasQuiet(col, r, true) || hasQuiet(col, r, false))) score += 40;
    }
  }
  // Rule 4: dark ratio
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) dark++;
  const pct = (dark * 100) / (size * size);
  const k = Math.floor(Math.abs(pct - 50) / 5);
  score += k * 10;
  return score;
}

// --- Public API ---
export function generateMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const size = 17 + 4 * version;

  const dataCw = encodeData(text, version);
  const codewords = buildCodewordSequence(dataCw, version);

  const m = makeMatrix(size);
  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);
  placeAlignment(m, version);
  placeTiming(m);
  reserveFormat(m);
  reserveVersion(m, version);
  placeData(m, codewords);

  // choose best mask
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const masked = applyMask(m, MASKS[mask]);
    placeFormat(masked, m.reserved, mask);
    placeVersion(masked, version);
    const p = penalty(masked);
    if (best === null || p < best.penalty) best = { penalty: p, modules: masked, mask };
  }
  return best.modules.map((row) => row.map((v) => v === true));
}

export function toSVG(text, { scale = 8, margin = 4, dark = "#000", light = "#fff" } = {}) {
  const matrix = generateMatrix(text);
  const size = matrix.length;
  const dim = (size + margin * 2) * scale;
  let rects = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        const x = (c + margin) * scale;
        const y = (r + margin) * scale;
        rects += `<rect x="${x}" y="${y}" width="${scale}" height="${scale}"/>`;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" ` +
    `viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">` +
    `<rect width="${dim}" height="${dim}" fill="${light}"/>` +
    `<g fill="${dark}">${rects}</g></svg>`
  );
}

// ASCII render for terminal verification.
export function toASCII(text) {
  const matrix = generateMatrix(text);
  let out = "";
  for (const row of matrix) {
    out += row.map((v) => (v ? "██" : "  ")).join("") + "\n";
  }
  return out;
}
