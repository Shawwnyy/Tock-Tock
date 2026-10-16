import { describe, it, expect } from 'bun:test';
import { detectFile, sanitizeDisplayName, storagePathFor, checkUploadAllowed, decideMediaStatus, DEFAULT_LIMITS } from '../supabase/functions/_shared/files.ts';

const pad = (head: number[] | string, total = 64) => {
  const h = typeof head === 'string' ? [...head].map((c) => c.charCodeAt(0)) : head;
  const out = new Uint8Array(Math.max(total, h.length));
  out.set(h);
  return out;
};
const png = () => pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpg = () => pad([0xff, 0xd8, 0xff, 0xe0]);
const withText = (b: Uint8Array, text: string) => { const o = new Uint8Array(b.length + text.length); o.set(b); o.set([...text].map((c) => c.charCodeAt(0)), b.length); return o; };

describe('détection par le contenu', () => {
  it('accepte de vraies images / PDF / audio / vidéo', () => {
    expect(detectFile(png(), 'photo.png', 'image/png')).toMatchObject({ ok: true, kind: 'image', mime: 'image/png' });
    expect(detectFile(jpg(), 'photo.JPEG', 'image/jpeg')).toMatchObject({ ok: true, ext: 'jpg' });
    expect(detectFile(pad('%PDF-1.7\n'), 'doc.pdf', 'application/pdf')).toMatchObject({ ok: true, kind: 'document' });
    expect(detectFile(pad('RIFF\0\0\0\0WAVEfmt '), 'a.wav')).toMatchObject({ ok: true, kind: 'audio' });
    expect(detectFile(pad('OggS\0'), 'a.ogg')).toMatchObject({ ok: true, kind: 'audio' });
    expect(detectFile(pad('ID3\x03\0'), 'a.mp3')).toMatchObject({ ok: true, mime: 'audio/mpeg' });
    expect(detectFile(pad('\0\0\0\x18ftypisom'), 'v.mp4')).toMatchObject({ ok: true, kind: 'video' });
    expect(detectFile(pad('\0\0\0\x18ftypM4A '), 'a.m4a')).toMatchObject({ ok: true, kind: 'audio' });
  });
  it('rejette un exécutable renommé en image', () => {
    const exe = pad('MZ\x90\0\x03');
    const r = detectFile(exe, 'vacances.png', 'image/png');
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toContain('exécutable');
  });
  it('rejette extension ou type annoncé qui ne correspondent pas au contenu', () => {
    expect(detectFile(png(), 'photo.jpg', 'image/png').ok).toBe(false);
    expect(detectFile(png(), 'photo.png', 'image/jpeg').ok).toBe(false);
    expect(detectFile(png(), 'photo', 'image/png').ok).toBe(false);
  });
  it('rejette SVG, HTML, scripts, archives, fichiers inconnus ou vides', () => {
    expect(detectFile(pad('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'a.svg').ok).toBe(false);
    expect(detectFile(pad('<!DOCTYPE html><html>'), 'a.png').ok).toBe(false);
    expect(detectFile(pad('#!/bin/sh\nrm -rf /'), 'a.png').ok).toBe(false);
    expect(detectFile(pad([0x50, 0x4b, 3, 4]), 'a.zip').ok).toBe(false);
    expect(detectFile(pad('hello world, plain text'), 'a.txt').ok).toBe(false);
    expect(detectFile(new Uint8Array(0), 'a.png').ok).toBe(false);
  });
  it('détecte une image polyglotte (script caché) et la met en quarantaine', () => {
    const r = detectFile(withText(png(), '<script>fetch("//evil")</script>'), 'x.png', 'image/png');
    expect(r.ok).toBe(false);
    expect(r.suspicious).toBe(true);
    expect(decideMediaStatus({ detection: r, scan: { provider: 'none' } }).status).toBe('quarantined');
  });
  it('rejette un PDF contenant du JavaScript', () => {
    const r = detectFile(withText(pad('%PDF-1.7\n'), '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>'), 'a.pdf', 'application/pdf');
    expect(r.ok).toBe(false);
    expect(r.suspicious).toBe(true);
  });
});

describe('nom, chemin, limites', () => {
  it('nettoie le nom d\'affichage (traversée, contrôle, inversion de texte)', () => {
    expect(sanitizeDisplayName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeDisplayName('C:\\Users\\moi\\photo.png')).toBe('photo.png');
    expect(sanitizeDisplayName('fa\u202Egpj.exe')).toBe('fagpj.exe');
    expect(sanitizeDisplayName('...')).toBe('fichier');
    expect(sanitizeDisplayName('a'.repeat(300)).length).toBe(100);
  });
  it('chemin de stockage généré, jamais dérivé du nom', () => {
    const u = '11111111-1111-1111-1111-111111111111';
    const f = '22222222-2222-2222-2222-222222222222';
    expect(storagePathFor(u, f, 'png')).toBe(`${u}/${f}.png`);
    expect(() => storagePathFor('../x', f, 'png')).toThrow();
    expect(() => storagePathFor(u, f, '../png')).toThrow();
  });
  it('taille, quota, quota journalier, durée', () => {
    const usage = { bytes: 0, uploadsToday: 0 };
    expect(checkUploadAllowed({ kind: 'image', sizeBytes: 1000, usage }).ok).toBe(true);
    expect(checkUploadAllowed({ kind: 'image', sizeBytes: 6 * 1024 * 1024, usage }).ok).toBe(false);
    expect(checkUploadAllowed({ kind: 'video', sizeBytes: 51 * 1024 * 1024, usage }).ok).toBe(false);
    expect(checkUploadAllowed({ kind: 'image', sizeBytes: 1000, usage: { bytes: DEFAULT_LIMITS.quotaBytesPerUser - 500, uploadsToday: 0 } }).ok).toBe(false);
    expect(checkUploadAllowed({ kind: 'image', sizeBytes: 1000, usage: { bytes: 0, uploadsToday: 20 } }).ok).toBe(false);
    expect(checkUploadAllowed({ kind: 'audio', sizeBytes: 1000, durationSeconds: 601, usage }).ok).toBe(false);
    expect(checkUploadAllowed({ kind: 'video', sizeBytes: 1000, durationSeconds: 121, usage }).ok).toBe(false);
    expect(checkUploadAllowed({ kind: 'image', sizeBytes: 0, usage }).ok).toBe(false);
  });
  it('jamais d\'approbation automatique, même fichier sain', () => {
    const ok = detectFile(png(), 'a.png', 'image/png');
    for (const scan of [{ provider: 'none' as const }, { provider: 'clamav', verdict: 'clean' as const }, { provider: 'clamav', verdict: 'error' as const }]) {
      expect(decideMediaStatus({ detection: ok, scan }).status).toBe('pending_review');
    }
    expect(decideMediaStatus({ detection: ok, scan: { provider: 'clamav', verdict: 'infected' } }).status).toBe('quarantined');
    expect(decideMediaStatus({ detection: detectFile(pad('plain text file...'), 'a.png'), scan: { provider: 'none' } }).status).toBe('rejected');
  });
});
