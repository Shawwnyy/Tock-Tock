// Génération du PDF d'une chronique avec pdf-lib (pur JavaScript : fonctionne sous Deno et Node, sans navigateur).
// Les polices standard PDF n'encodent que WinAnsi : tout caractère hors de ce jeu (emoji…) est remplacé par « ? »
// au lieu de faire planter la génération.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import type { Chronicle, ChronicleSections } from './types.ts';
import { SECTION_LABELS, SECTION_ORDER } from './chronicle.ts';

const WIN_ANSI_EXTRA = new Set('œŒšŠžŽŸƒˆ˜–—‘’‚“”„†‡•…‰‹›€™'.split(''));

export function toWinAnsi(input: string): string {
  let out = '';
  for (const ch of input.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    if (ch === '\n' || ch === '\t') out += ch === '\t' ? '  ' : ch;
    else if (c === 0x202f || c === 0x2009 || c === 0x200a || c === 0x2002 || c === 0x2003) out += ' ';
    else if (c === 0x200b || c === 0x200c || c === 0x200d || c === 0xfeff || (c >= 0x202a && c <= 0x202e)) out += '';
    else if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else out += '?';
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ').filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (let word of words) {
      // Mot plus large que la ligne : on le coupe.
      while (font.widthOfTextAtSize(word, size) > maxWidth) {
        let cut = word.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > maxWidth) cut--;
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) line = test;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export interface PdfOptions {
  /** false : le PDF n'inclut ni douleur ni notes personnelles (réglage « pdf_include_sensitive »). */
  includeSensitive: boolean;
  generatedAt?: Date;
}

const SENSITIVE: (keyof ChronicleSections)[] = ['pain', 'remember'];

export async function buildChroniclePdf(chronicle: Pick<Chronicle, 'title' | 'sections' | 'date'>, opts: PdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(toWinAnsi(chronicle.title));
  doc.setAuthor('Tock Tock');
  doc.setProducer('Tock Tock');
  doc.setCreator('Tock Tock');
  doc.setCreationDate(opts.generatedAt ?? new Date());
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28, H = 841.89, M = 56;
  const maxW = W - 2 * M;
  const ink = rgb(0.12, 0.13, 0.17);
  const muted = rgb(0.4, 0.42, 0.48);
  const accent = rgb(0.17, 0.32, 0.55);

  let page = doc.addPage([W, H]);
  let y = H - M;
  const ensure = (needed: number) => {
    if (y - needed < M + 24) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  const draw = (text: string, f: PDFFont, size: number, color = ink, lead = 1.45) => {
    for (const line of wrap(toWinAnsi(text), f, size, maxW)) {
      ensure(size * lead);
      if (line) page.drawText(line, { x: M, y: y - size, size, font: f, color });
      y -= size * lead;
    }
  };

  draw('Tock Tock — chronique de minuit', bold, 10, accent);
  y -= 6;
  draw(chronicle.title, bold, 20, ink, 1.3);
  y -= 4;
  draw('Document personnel et privé, généré à partir de tes propres réponses.', font, 9.5, muted);
  y -= 14;

  for (const key of SECTION_ORDER) {
    const text = chronicle.sections[key];
    if (!text || !text.trim()) continue;
    if (!opts.includeSensitive && SENSITIVE.includes(key)) continue;
    ensure(48);
    draw(SECTION_LABELS[key], bold, 12.5, accent, 1.5);
    y -= 2;
    draw(text.trim(), font, 11);
    y -= 12;
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(toWinAnsi(`Tock Tock — ne remplace pas un avis médical · page ${i + 1}/${pages.length}`), { x: M, y: 30, size: 8.5, font, color: muted });
  });
  return doc.save();
}
