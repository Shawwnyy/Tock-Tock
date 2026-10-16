// Petit « traceur » PDF (pdf-lib) pour les sauvegardes et les tickets : titres, paragraphes, sauts de page, pied de page.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { toWinAnsi } from '../../supabase/functions/_shared/pdf.ts';

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ').filter((w) => w.length > 0);
    if (words.length === 0) { lines.push(''); continue; }
    let line = '';
    for (let word of words) {
      while (font.widthOfTextAtSize(word, size) > maxWidth) {
        let cut = word.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > maxWidth) cut--;
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) line = test;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines;
}

const W = 595.28, H = 841.89, M = 50;

export class PdfWriter {
  doc!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = 0;

  static async create(title: string, author = 'Tock Tock'): Promise<PdfWriter> {
    const w = new PdfWriter();
    w.doc = await PDFDocument.create();
    w.doc.setTitle(toWinAnsi(title));
    w.doc.setAuthor(author);
    w.doc.setProducer('Tock Tock');
    w.doc.setCreator('Tock Tock');
    w.font = await w.doc.embedFont(StandardFonts.Helvetica);
    w.bold = await w.doc.embedFont(StandardFonts.HelveticaBold);
    w.newPage();
    return w;
  }

  newPage(): void { this.page = this.doc.addPage([W, H]); this.y = H - M; }
  private ensure(h: number): void { if (this.y - h < M + 24) this.newPage(); }
  gap(n = 6): void { this.y -= n; }

  heading(text: string, size = 15): void {
    this.ensure(size * 2.6);
    this.gap(size * 0.7);
    this.y -= size;
    this.page.drawText(toWinAnsi(text), { x: M, y: this.y, size, font: this.bold, color: rgb(0.11, 0.2, 0.35) });
    this.y -= 5;
  }

  para(text: string, opts: { size?: number; bold?: boolean; indent?: number; color?: [number, number, number] } = {}): void {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const indent = opts.indent ?? 0;
    const color = opts.color ? rgb(...opts.color) : rgb(0.1, 0.1, 0.12);
    for (const line of wrapText(toWinAnsi(text), font, size, W - 2 * M - indent)) {
      this.ensure(size * 1.45);
      this.y -= size * 1.35;
      if (line) this.page.drawText(line, { x: M + indent, y: this.y, size, font, color });
    }
    this.y -= 3;
  }

  /** Courbe sur 0-10 ; une valeur absente (null) crée un TROU, jamais un zéro. */
  lineChart(values: (number | null)[], labels: [string, string], height = 110): void {
    this.ensure(height + 36);
    const x0 = M + 22, w = W - 2 * M - 22, top = this.y - 8, bottom = top - height;
    const y = (v: number) => bottom + (v / 10) * height;
    for (const g of [0, 5, 10]) {
      this.page.drawLine({ start: { x: x0, y: y(g) }, end: { x: x0 + w, y: y(g) }, thickness: 0.4, color: rgb(0.8, 0.82, 0.86) });
      this.page.drawText(String(g), { x: M + 6, y: y(g) - 3, size: 7.5, font: this.font, color: rgb(0.4, 0.4, 0.45) });
    }
    const n = Math.max(values.length - 1, 1);
    const px = (i: number) => x0 + (values.length === 1 ? w / 2 : (i * w) / n);
    let prev: number | null = null;
    values.forEach((v, i) => {
      if (v === null) { prev = null; return; }
      if (prev !== null) this.page.drawLine({ start: { x: px(prev), y: y(values[prev] as number) }, end: { x: px(i), y: y(v) }, thickness: 1.4, color: rgb(0.17, 0.32, 0.51) });
      this.page.drawCircle({ x: px(i), y: y(v), size: 1.8, color: rgb(0.17, 0.32, 0.51) });
      prev = i;
    });
    this.page.drawText(toWinAnsi(labels[0]), { x: x0, y: bottom - 11, size: 7.5, font: this.font, color: rgb(0.4, 0.4, 0.45) });
    this.page.drawText(toWinAnsi(labels[1]), { x: x0 + w - this.font.widthOfTextAtSize(toWinAnsi(labels[1]), 7.5), y: bottom - 11, size: 7.5, font: this.font, color: rgb(0.4, 0.4, 0.45) });
    this.y = bottom - 20;
  }

  async finish(footer: string): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => p.drawText(toWinAnsi(`${footer}  -  page ${i + 1}/${pages.length}`), { x: M, y: 28, size: 8, font: this.font, color: rgb(0.4, 0.4, 0.45) }));
    return this.doc.save();
  }
}
