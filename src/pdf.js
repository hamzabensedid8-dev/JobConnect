/* ==========================================================================
   JobConnect — générateur PDF (contrats)
   Aucune dépendance externe : un écrivain PDF minimal mais correct.

   Objectifs :
     • texte justifié à gauche, césure sur les mots, jamais de ligne coupée
     • pagination automatique : aucun bloc (titre, paragraphe, ligne de tableau)
       n'est jamais coupé entre deux pages
     • en-tête avec le logo sur la première page, rappel discret ensuite
     • pied de page « Page X sur Y » calculé après coup (double passe)
   ========================================================================== */

/* ---------------------------------------------------------- métriques des
   polices standard (largeurs AFM, unités 1/1000 em, ASCII 32 → 126) ------- */

const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
];

const TIMES = [
  250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444,
  921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722,
  556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500,
  333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500,
  500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541
];

const FONTS = {
  regular: { base: 'Helvetica', widths: HELVETICA },
  bold: { base: 'Helvetica-Bold', widths: HELVETICA_BOLD },
  serif: { base: 'Times-Roman', widths: TIMES }
};

// Caractères accentués : on réutilise la largeur de la lettre de base.
const ACCENTS = {
  À: 'A', Á: 'A', Â: 'A', Ã: 'A', Ä: 'A', Å: 'A', Ç: 'C', È: 'E', É: 'E', Ê: 'E',
  Ë: 'E', Ì: 'I', Í: 'I', Î: 'I', Ï: 'I', Ñ: 'N', Ò: 'O', Ó: 'O', Ô: 'O', Õ: 'O',
  Ö: 'O', Ù: 'U', Ú: 'U', Û: 'U', Ü: 'U', Ý: 'Y', à: 'a', á: 'a', â: 'a', ã: 'a',
  ä: 'a', å: 'a', ç: 'c', è: 'e', é: 'e', ê: 'e', ë: 'e', ì: 'i', í: 'i', î: 'i',
  ï: 'i', ñ: 'n', ò: 'o', ó: 'o', ô: 'o', õ: 'o', ö: 'o', ù: 'u', ú: 'u', û: 'u',
  ü: 'u', ý: 'y', ÿ: 'y', '€': 'E', '’': "'", '‘': "'", '“': '"', '”': '"',
  '–': '-', '—': '-', '•': '-', '…': '.'
};

function widthOf(text, font, size) {
  const table = FONTS[font].widths;
  let total = 0;
  for (const ch of String(text)) {
    const mapped = ACCENTS[ch] || ch;
    const code = mapped.charCodeAt(0);
    const w = code >= 32 && code <= 126 ? table[code - 32] : 556;
    total += w;
  }
  return (total * size) / 1000;
}

/* ------------------------------------------------ encodage WinAnsi ------- */

const WIN_ANSI_EXTRA = {
  '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136,
  '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147,
  '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155,
  'œ': 156, 'ž': 158, 'Ÿ': 159
};

function encodePdfString(text) {
  let out = '';
  for (const ch of String(text)) {
    const code = ch.charCodeAt(0);
    let byte;
    if (WIN_ANSI_EXTRA[ch] != null) byte = WIN_ANSI_EXTRA[ch];
    else if (code >= 32 && code <= 126) byte = code;
    else if (code >= 160 && code <= 255) byte = code;
    else byte = 63; // « ? »
    if (byte === 40 || byte === 41 || byte === 92) out += '\\' + String.fromCharCode(byte);
    else if (byte < 32 || byte > 126) out += '\\' + byte.toString(8).padStart(3, '0');
    else out += String.fromCharCode(byte);
  }
  return out;
}

/* ------------------------------------------------------- mise en page ----- */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = { top: 56, right: 56, bottom: 62, left: 56 };

function cleanText(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

class Document {
  constructor({ logo = null, title = '', subtitle = '', footer = '' } = {}) {
    this.pages = [];
    this.ops = null;
    this.pageIndex = 0;
    this.y = 0;
    this.logo = logo;          // { bytes: Uint8Array, width, height }
    this.title = title;
    this.subtitle = subtitle;
    this.footer = footer;
    this.newPage();
  }

  get contentWidth() {
    return A4.width - MARGIN.left - MARGIN.right;
  }

  get bottomLimit() {
    return MARGIN.bottom;
  }

  newPage() {
    if (this.ops) this.pages.push(this.ops);
    this.ops = [];
    this.pageIndex += 1;
    this.y = A4.height - MARGIN.top;
    if (this.pageIndex === 1) this.drawFirstHeader();
    else this.drawRunningHeader();
  }

  /* --- blocs de base ---------------------------------------------------- */

  text(value, { font = 'regular', size = 10.5, x = MARGIN.left, color = [0.13, 0.16, 0.22], leading = 1.45 } = {}) {
    const line = cleanText(value).replace(/\n/g, ' ');
    if (!line) return;
    const str = encodePdfString(line);
    this.ops.push(
      `BT /${pdfFontName(font)} ${size} Tf ${color[0]} ${color[1]} ${color[2]} rg ` +
        `1 0 0 1 ${x.toFixed(2)} ${this.y.toFixed(2)} Tm (${str}) Tj ET`
    );
    this.y -= size * leading;
  }

  /** Paragraphe avec retour à la ligne mot par mot — jamais de ligne coupée. */
  paragraph(value, { font = 'regular', size = 10.5, leading = 1.45, indent = 0, spaceAfter = 6, color = [0.13, 0.16, 0.22], align = 'left' } = {}) {
    const text = cleanText(value);
    if (!text) return;
    const maxWidth = this.contentWidth - indent;
    const lineHeight = size * leading;

    for (const rawLine of text.split('\n')) {
      const words = [];
      for (const word of rawLine.split(' ').filter(Boolean)) {
        words.push(...breakLongWord(word, font, size, maxWidth));
      }
      let current = '';
      const flush = (line, isLast) => {
        if (!line) return;
        this.ensure(lineHeight);
        let x = MARGIN.left + indent;
        let draw = line;
        if (align === 'center') {
          x = MARGIN.left + indent + (maxWidth - widthOf(line, font, size)) / 2;
        } else if (align === 'right') {
          x = MARGIN.left + indent + maxWidth - widthOf(line, font, size);
        } else if (align === 'justify' && !isLast) {
          // micro-justification : uniquement si la ligne a plusieurs mots
          const gaps = line.split(' ').length - 1;
          if (gaps > 0) {
            const natural = widthOf(line, font, size);
            const extra = (maxWidth - natural) / gaps;
            if (extra > 0 && extra < size * 1.6) {
              this.justifiedLine(line, { font, size, x, color, extra });
              this.y -= lineHeight;
              return;
            }
          }
        }
        this.ops.push(
          `BT /${pdfFontName(font)} ${size} Tf ${color[0]} ${color[1]} ${color[2]} rg ` +
            `1 0 0 1 ${x.toFixed(2)} ${this.y.toFixed(2)} Tm (${encodePdfString(draw)}) Tj ET`
        );
        this.y -= lineHeight;
      };

      if (!words.length) {
        this.ensure(lineHeight);
        this.y -= lineHeight;
        continue;
      }
      for (const word of words) {
        const candidate = current ? current + ' ' + word : word;
        if (widthOf(candidate, font, size) <= maxWidth || !current) {
          current = candidate;
        } else {
          flush(current, false);
          current = word;
        }
      }
      flush(current, true);
    }
    this.y -= spaceAfter;
  }

  justifiedLine(line, { font, size, x, color, extra }) {
    // Écrit chaque mot séparément pour répartir l'espace (Tw n'est pas fiable
    // avec les polices standard et certains lecteurs).
    let cursor = x;
    const words = line.split(' ');
    for (let i = 0; i < words.length; i++) {
      this.ops.push(
        `BT /${pdfFontName(font)} ${size} Tf ${color[0]} ${color[1]} ${color[2]} rg ` +
          `1 0 0 1 ${cursor.toFixed(2)} ${this.y.toFixed(2)} Tm (${encodePdfString(words[i])}) Tj ET`
      );
      cursor += widthOf(words[i], font, size) + (i === words.length - 1 ? 0 : extra);
    }
    this.y -= 0;
  }

  heading(value, { size = 13, spaceBefore = 10, spaceAfter = 6 } = {}) {
    // un titre ne doit jamais rester seul en bas de page (lignes d'orphelin)
    const needed = size * 1.6 + spaceBefore + spaceAfter + size * 3.2;
    if (this.y - needed < this.bottomLimit) this.newPage();
    else this.y -= spaceBefore;
    this.text(value, { font: 'bold', size, color: [0.05, 0.12, 0.3], leading: 1.3 });
    this.y -= spaceAfter;
    return this;
  }

  rule({ space = 6, color = [0.78, 0.83, 0.9] } = {}) {
    this.ensure(space * 2);
    this.ops.push(
      `${color[0]} ${color[1]} ${color[2]} RG 0.7 w ` +
        `${MARGIN.left} ${this.y.toFixed(2)} m ${(A4.width - MARGIN.right).toFixed(2)} ${this.y.toFixed(2)} l S`
    );
    this.y -= space;
  }

  /** Ligne « libellé : valeur » qui ne se coupe jamais entre deux pages. */
  field(label, value, { size = 10.5, labelWidth = 150 } = {}) {
    const text = cleanText(value);
    if (!text) return this;
    const lineHeight = size * 1.45;
    const maxValueWidth = this.contentWidth - labelWidth;
    const lines = wrapText(text, 'regular', size, maxValueWidth);
    const needed = Math.max(lineHeight, lines.length * lineHeight) + 3;
    this.ensure(needed);

    const startY = this.y;
    this.ops.push(
      `BT /Helvetica-Bold ${size} Tf 0.29 0.34 0.42 rg ` +
        `1 0 0 1 ${MARGIN.left.toFixed(2)} ${startY.toFixed(2)} Tm (${encodePdfString(cleanText(label))}) Tj ET`
    );
    let y = startY;
    for (const line of lines) {
      this.ops.push(
        `BT /Helvetica ${size} Tf 0.09 0.11 0.16 rg ` +
          `1 0 0 1 ${(MARGIN.left + labelWidth).toFixed(2)} ${y.toFixed(2)} Tm (${encodePdfString(line)}) Tj ET`
      );
      y -= lineHeight;
    }
    this.y = y - 3;
    return this;
  }

  /** Encadré (conditions particulières, total à payer…). */
  box(title, lines, { accent = [0.11, 0.31, 0.85], fill = [0.96, 0.97, 1] } = {}) {
    const size = 10;
    const lineHeight = size * 1.5;
    const inner = this.contentWidth - 28;
    const wrapped = [];
    for (const line of lines) {
      for (const piece of cleanText(line).split('\n')) {
        if (!piece) { wrapped.push(''); continue; }
        wrapped.push(...wrapText(piece, 'regular', size, inner));
      }
    }
    const titleHeight = title ? lineHeight + 4 : 0;
    const height = titleHeight + wrapped.length * lineHeight + 22;

    if (this.y - height < this.bottomLimit) this.newPage();

    const top = this.y;
    const bottom = top - height;
    const left = MARGIN.left;
    const right = A4.width - MARGIN.right;

    this.ops.push(
      `${fill[0]} ${fill[1]} ${fill[2]} rg ${left} ${bottom.toFixed(2)} ` +
        `${(right - left).toFixed(2)} ${height.toFixed(2)} re f`
    );
    this.ops.push(
      `${accent[0]} ${accent[1]} ${accent[2]} RG 1.1 w ${left} ${top.toFixed(2)} m ` +
        `${left} ${bottom.toFixed(2)} l S`
    );

    let y = top - 16;
    if (title) {
      this.ops.push(
        `BT /Helvetica-Bold ${size + 1} Tf ${accent[0]} ${accent[1]} ${accent[2]} rg ` +
          `1 0 0 1 ${(left + 14).toFixed(2)} ${y.toFixed(2)} Tm (${encodePdfString(cleanText(title))}) Tj ET`
      );
      y -= lineHeight + 4;
    }
    for (const line of wrapped) {
      if (line) {
        this.ops.push(
          `BT /Helvetica ${size} Tf 0.12 0.15 0.22 rg ` +
            `1 0 0 1 ${(left + 14).toFixed(2)} ${y.toFixed(2)} Tm (${encodePdfString(line)}) Tj ET`
        );
      }
      y -= lineHeight;
    }
    this.y = bottom - 14;
    return this;
  }

  signatureBlock(leftLabel, rightLabel, { lines = 3 } = {}) {
    const height = 74;
    if (this.y - height < this.bottomLimit) this.newPage();
    const half = this.contentWidth / 2;
    const baselineY = this.y - 14;
    const lineEnd = baselineY - lines * 16;

    this.ops.push(
      `0.72 0.77 0.85 RG 0.7 w ` +
        `${MARGIN.left} ${lineEnd.toFixed(2)} m ${(MARGIN.left + half - 24).toFixed(2)} ${lineEnd.toFixed(2)} l S ` +
        `${(MARGIN.left + half + 24)} ${lineEnd.toFixed(2)} m ${(A4.width - MARGIN.right).toFixed(2)} ${lineEnd.toFixed(2)} l S`
    );
    this.ops.push(
      `BT /Helvetica-Bold 9 Tf 0.35 0.4 0.48 rg 1 0 0 1 ${MARGIN.left.toFixed(2)} ${(lineEnd - 13).toFixed(2)} Tm (${encodePdfString(leftLabel)}) Tj ET`
    );
    this.ops.push(
      `BT /Helvetica-Bold 9 Tf 0.35 0.4 0.48 rg 1 0 0 1 ${(MARGIN.left + half + 24).toFixed(2)} ${(lineEnd - 13).toFixed(2)} Tm (${encodePdfString(rightLabel)}) Tj ET`
    );
    this.y = lineEnd - 30;
    return this;
  }

  ensure(height) {
    if (this.y - height < this.bottomLimit) this.newPage();
  }

  /* --- en-têtes et pieds de page --------------------------------------- */

  drawFirstHeader() {
    const top = A4.height - MARGIN.top;
    let textLeft = MARGIN.left;
    if (this.logo) {
      const h = 50;
      const w = Math.min(180, (this.logo.width / this.logo.height) * h);
      this.ops.push(
        `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${MARGIN.left} ${(top - h + 12).toFixed(2)} cm /Im1 Do Q`
      );
      textLeft = MARGIN.left + w + 18;
    }
    let y = top - 26;
    if (this.title) {
      this.ops.push(
        `BT /Helvetica-Bold 17 Tf 0.04 0.1 0.28 rg 1 0 0 1 ${textLeft.toFixed(2)} ${y.toFixed(2)} Tm (${encodePdfString(this.title)}) Tj ET`
      );
      y -= 16;
    }
    if (this.subtitle) {
      this.ops.push(
        `BT /Helvetica 9 Tf 0.38 0.43 0.52 rg 1 0 0 1 ${textLeft.toFixed(2)} ${y.toFixed(2)} Tm (${encodePdfString(this.subtitle)}) Tj ET`
      );
    }
    this.y = top - 74;
    this.rule({ space: 4 });
    this.y -= 6;
  }

  drawRunningHeader() {
    const top = A4.height - MARGIN.top + 18;
    this.ops.push(
      `BT /Helvetica 8.5 Tf 0.45 0.5 0.58 rg 1 0 0 1 ${MARGIN.left.toFixed(2)} ${top.toFixed(2)} Tm (${encodePdfString(this.title || 'JobConnect')}) Tj ET`
    );
    this.ops.push(
      `0.85 0.88 0.93 RG 0.6 w ${MARGIN.left} ${(top - 8).toFixed(2)} m ` +
        `${(A4.width - MARGIN.right).toFixed(2)} ${(top - 8).toFixed(2)} l S`
    );
    this.y = top - 26;
  }

  drawFooters() {
    const total = this.pages.length;
    this.pages.forEach((ops, index) => {
      const y = MARGIN.bottom - 26;
      ops.push(
        `0.85 0.88 0.93 RG 0.6 w ${MARGIN.left} ${(y + 14).toFixed(2)} m ` +
          `${(A4.width - MARGIN.right).toFixed(2)} ${(y + 14).toFixed(2)} l S`
      );
      if (this.footer) {
        ops.push(
          `BT /Helvetica 8 Tf 0.45 0.5 0.58 rg 1 0 0 1 ${MARGIN.left.toFixed(2)} ${y.toFixed(2)} Tm (${encodePdfString(this.footer)}) Tj ET`
        );
      }
      ops.push(
        `BT /Helvetica 8 Tf 0.45 0.5 0.58 rg 1 0 0 1 ${(A4.width - MARGIN.right - 60).toFixed(2)} ${y.toFixed(2)} Tm (${encodePdfString(`Page ${index + 1} / ${total}`)}) Tj ET`
      );
    });
  }

  /* --- sortie ----------------------------------------------------------- */

  toBytes() {
    if (this.ops) {
      this.pages.push(this.ops);
      this.ops = null;
    }
    this.drawFooters();

    const objects = [];
    const add = (body) => {
      objects.push(body);
      return objects.length; // numéro d'objet (commence à 1)
    };

    const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const fontSerif = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>');

    let imageObj = null;
    if (this.logo && this.logo.bytes) {
      const stream = latin1(this.logo.bytes);
      imageObj = add(
        `<< /Type /XObject /Subtype /Image /Width ${this.logo.width} /Height ${this.logo.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${this.logo.bytes.length} >>\nstream\n` +
          stream +
          '\nendstream'
      );
    }

    const pageObjNumbers = [];
    const pagesObjNumber = objects.length + this.pages.length * 2 + 1; // réservé plus bas

    const pagesRefs = [];
    const contentRefs = [];
    for (let i = 0; i < this.pages.length; i++) {
      const content = this.pages[i].join('\n');
      const contentObj = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      contentRefs.push(contentObj);
    }

    for (let i = 0; i < this.pages.length; i++) {
      const resources =
        `<< /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R /F3 ${fontSerif} 0 R >>` +
        (imageObj ? ` /XObject << /Im1 ${imageObj} 0 R >>` : '') +
        ' >>';
      const page = add(
        `<< /Type /Page /Parent ${pagesObjNumber} 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] ` +
          `/Resources ${resources} /Contents ${contentRefs[i]} 0 R >>`
      );
      pagesRefs.push(page);
      pageObjNumbers.push(page);
    }

    const pagesObj = add(
      `<< /Type /Pages /Count ${pagesRefs.length} /Kids [${pagesRefs.map((n) => `${n} 0 R`).join(' ')}] >>`
    );
    // le numéro de l'objet /Pages doit correspondre à ce qui a été annoncé
    const catalogObj = add(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
    const infoObj = add(
      `<< /Title (${encodePdfString(this.title || 'JobConnect')}) /Producer (JobConnect) /Creator (JobConnect) >>`
    );

    const chunks = [];
    const offsets = [];
    let position = 0;
    const push = (text) => {
      chunks.push(text);
      position += latin1Bytes(text).length;
    };

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    objects.forEach((body, index) => {
      offsets[index] = position;
      push(`${index + 1} 0 obj\n${body}\nendobj\n`);
    });

    const xrefStart = position;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    push(xref);
    push(
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObj} 0 R /Info ${infoObj} 0 R >>\n` +
        `startxref\n${xrefStart}\n%%EOF\n`
    );

    const bytes = [];
    for (const chunk of chunks) {
      for (const b of latin1Bytes(chunk)) bytes.push(b);
    }
    return new Uint8Array(bytes);
  }
}

function pdfFontName(font) {
  if (font === 'bold') return 'F2';
  if (font === 'serif') return 'F3';
  return 'F1';
}

function latin1(input) {
  const bytes = input instanceof Uint8Array ? input : latin1Bytes(input);
  let out = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
  }
  return out;
}

function latin1Bytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

/** Coupe un mot plus large que la ligne (URL, adresse e-mail, référence). */
function breakLongWord(word, font, size, maxWidth) {
  if (widthOf(word, font, size) <= maxWidth) return [word];
  const parts = [];
  let current = '';
  for (const ch of String(word)) {
    const next = current + ch;
    if (widthOf(next, font, size) > maxWidth && current) {
      parts.push(current);
      current = ch;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function wrapText(text, font, size, maxWidth) {
  const words = [];
  for (const word of cleanText(text).split(/\s+/).filter(Boolean)) {
    words.push(...breakLongWord(word, font, size, maxWidth));
  }
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (widthOf(candidate, font, size) <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export function createDocument(options) {
  return new Document(options);
}

export function textWidth(text, font = 'regular', size = 10.5) {
  return widthOf(text, font, size);
}

export { A4, MARGIN };
