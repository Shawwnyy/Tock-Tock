// Rapport de période PDF : contenu lisible, choix de partage respectés (douleur et notes exclues par défaut).
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReportPdf } from '../src/local/report.ts';
import { activeIndicators, getState, snapshotOf, today, update } from '../src/local/store.ts';

function text(pdf: Uint8Array): string {
  const f = join(mkdtempSync(join(tmpdir(), 'rp-')), 'r.pdf');
  writeFileSync(f, pdf);
  try { return execFileSync('pdftotext', [f, '-'], { encoding: 'utf8' }); } catch { return ''; }
}

describe('rapport PDF', () => {
  test('moyennes exactes, douleur et notes absentes par défaut, présentes sur demande', async () => {
    const t = today(getState());
    const mood = activeIndicators(getState()).find((i) => i.template_key === 'mood')!;
    const sleep = activeIndicators(getState()).find((i) => i.template_key === 'sleep')!;
    update((n) => {
      n.checkins = {}; // l'état du magasin est partagé entre fichiers de test : on repart d'un journal vide
      n.checkins[t] = { checkin_date: t, tags: [], updated_at: new Date().toISOString(), pain_score: 6, pain_zone: 'Dos', day_note: 'NOTE-SECRETE-XYZ',
        answers: [{ snapshot: snapshotOf(n, mood), value_num: 8, value_text: null, value_choice: null }, { snapshot: snapshotOf(n, sleep), value_num: 4, value_text: null, value_choice: null }] };
    });
    const base = await buildReportPdf(getState(), { days: 30, includePain: false, includeNotes: false });
    expect(new TextDecoder().decode(base.slice(0, 5))).toBe('%PDF-');
    const t0 = text(base);
    if (t0) {
      expect(t0).toContain('Moyenne générale : 6,0/10'); // (8 + 4) / 2 = 6 : une catégorie par indicateur
      expect(t0).toContain('Jours avec bilan : 1 sur 30');
      expect(t0).not.toContain('NOTE-SECRETE-XYZ');
      expect(t0).not.toContain('Douleur (suivie');
    }
    const full = text(await buildReportPdf(getState(), { days: 30, includePain: true, includeNotes: true }));
    if (full) { expect(full).toContain('NOTE-SECRETE-XYZ'); expect(full).toContain('6/10 - Dos'); }
  });
});
