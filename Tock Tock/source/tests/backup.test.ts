// Sauvegarde PDF : aller-retour complet (le PDF est lisible ET restaurable), refus des fichiers invalides, PIN non exporté.
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBackupPdf, mergeRestored, readBackup } from '../src/local/backup.ts';
import { activeIndicators, getState, snapshotOf, update } from '../src/local/store.ts';

describe('sauvegarde PDF', () => {
  test('aller-retour : bilans, objectifs et chroniques identiques ; PIN jamais exporté ; PDF lisible', async () => {
    const mood = activeIndicators(getState()).find((i) => i.template_key === 'mood')!;
    update((n) => {
      n.settings.name = 'Léo'; n.settings.pinHash = 'secret-hash'; n.settings.pinSalt = 'salt';
      n.checkins['2026-10-01'] = { checkin_date: '2026-10-01', answers: [{ snapshot: snapshotOf(n, mood), value_num: 8, value_text: null, value_choice: null }], tags: ['Sport'], updated_at: '2026-10-01T20:00:00Z', day_note: 'Une journée « calme » — très œuf 🙂' };
      n.goals.push({ id: 'g1', title: 'Marcher', status: 'todo', due_date: null, steps: [{ id: 's1', title: 'Chaussures', done: true, done_at: '2026-10-01' }], created_at: '2026-10-01T00:00:00Z' });
    });
    const pdf = await buildBackupPdf(getState(), new Date('2026-10-16T18:00:00Z'));
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    const dir = mkdtempSync(join(tmpdir(), 'tt-'));
    writeFileSync(join(dir, 'b.pdf'), pdf);
    let txt = '';
    try { txt = execFileSync('pdftotext', [join(dir, 'b.pdf'), '-'], { encoding: 'utf8' }); } catch { /* pdftotext absent : on saute la relecture */ }
    if (txt) { expect(txt).toContain('Sauvegarde'); expect(txt).toContain('Moral général'); expect(txt).toContain('Marcher'); }

    const restored = await readBackup(pdf);
    expect(restored.checkins['2026-10-01'].answers[0].value_num).toBe(8);
    expect(restored.checkins['2026-10-01'].day_note).toContain('œuf');
    expect(restored.goals[0].steps[0].done).toBe(true);
    expect(restored.settings.pinHash).toBeNull(); // le PIN n'est pas dans la sauvegarde
    expect(restored.settings.lastBackupAt).toBe('2026-10-16T18:00:00.000Z'); // pas de rappel de sauvegarde juste après une restauration
    const merged = mergeRestored(restored, getState());
    expect(merged.settings.pinHash).toBe('secret-hash'); // et celui de l'appareil est conservé
  });

  test('refuse un PDF sans données jointes, du texte quelconque et des données de structure invalide', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const d = await PDFDocument.create(); d.addPage();
    await expect(readBackup(await d.save())).rejects.toThrow();
    await expect(readBackup(new TextEncoder().encode('bonjour'))).rejects.toThrow();
    await expect(readBackup(new TextEncoder().encode('{"v":1,"settings":{}}'))).rejects.toThrow();
    await expect(readBackup(new TextEncoder().encode('{"v":1,"settings":{},"indicators":[],"categories":[],"checkins":{"pas-une-date":{"answers":[]}}}'))).rejects.toThrow();
  });

  test('un ancien fichier JSON de sauvegarde reste restaurable', async () => {
    const legacy = new TextEncoder().encode(JSON.stringify(getState()));
    const s = await readBackup(legacy);
    expect(Object.keys(s.checkins).length).toBeGreaterThan(0);
  });
});
