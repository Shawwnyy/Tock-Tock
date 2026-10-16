import { describe, it, expect } from 'bun:test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildChroniclePdf, toWinAnsi } from '../supabase/functions/_shared/pdf.ts';

const text = (bytes: Uint8Array) => {
  const f = join(mkdtempSync(join(tmpdir(), 'pdf-')), 'a.pdf');
  writeFileSync(f, bytes);
  const r = spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null; // null si pdftotext indisponible
};

describe('PDF de chronique', () => {
  const chronicle = {
    date: '2026-10-16',
    title: 'Chronique de minuit — vendredi 16 octobre 2026',
    sections: { summary: 'Moyenne générale 5,0/10 « œuvre » — très bien… ça va 😊 €', pain: 'Douleur notée : 6/10 (zone : dos).', remember: 'Événements notés : « dentiste »', conclusion: 'Merci.' },
  };
  it('produit un vrai PDF avec accents, sans planter sur les emoji', async () => {
    const pdf = await buildChroniclePdf(chronicle, { includeSensitive: true });
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    const t = text(pdf);
    if (t) {
      expect(t).toContain('Chronique de minuit');
      expect(t).toContain('générale');
      expect(t).toContain('Douleur notée');
      expect(t).toContain('page 1/1');
    }
  });
  it('exclut douleur et notes si pdf_include_sensitive est désactivé', async () => {
    const pdf = await buildChroniclePdf(chronicle, { includeSensitive: false });
    const t = text(pdf);
    if (t) {
      expect(t).not.toContain('Douleur');
      expect(t).not.toContain('dentiste');
      expect(t).toContain('Merci');
    }
  });
  it('pagine les longs textes et coupe les mots géants', async () => {
    const long = Array.from({ length: 120 }, (_, i) => `Ligne ${i} avec du texte pour remplir la page de façon réaliste.`).join('\n');
    const pdf = await buildChroniclePdf({ ...chronicle, sections: { summary: long, remember: 'x'.repeat(400) } }, { includeSensitive: true });
    const t = text(pdf);
    if (t) expect(t).toMatch(/page \d+\/[2-9]/);
    expect(pdf.length).toBeGreaterThan(1000);
  });
  it('conversion WinAnsi', () => {
    expect(toWinAnsi('é à œ – … 😊  ​')).toBe('é à œ – … ?  ');
  });
});
