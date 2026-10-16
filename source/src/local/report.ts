// Rapport de période en PDF, à montrer à un professionnel de santé ou à garder : moyennes, semaines, douleur, notes (au choix).
import { addDays, aggregatePeriods, buildDailySeries, formatScore, periodGeneralAverage } from '../../supabase/functions/_shared/stats.ts';
import { formatDateFr } from '../../supabase/functions/_shared/chronicle.ts';
import { PdfWriter } from './pdfkit';
import { checkinsSorted, today, type Store } from './store';

export interface ReportOptions { days: 30 | 90 | 365; includePain: boolean; includeNotes: boolean; now?: Date }

export async function buildReportPdf(s: Store, o: ReportOptions): Promise<Uint8Array> {
  const t = today(s);
  const from = addDays(t, -(o.days - 1));
  const list = checkinsSorted(s);
  const series = buildDailySeries(list, from, t);
  const avg = periodGeneralAverage(series);
  const w = await PdfWriter.create('Tock Tock - Rapport de période');
  w.heading('Rapport de suivi - Tock Tock', 20);
  w.para(`${s.settings.name ? `${s.settings.name} - ` : ''}du ${formatDateFr(from)} au ${formatDateFr(t)} (${o.days} jours)`, { bold: true });
  w.para('Outil de suivi personnel : ce document reprend ce que la personne a saisi. Ce n\'est ni un diagnostic ni un avis médical. Les jours sans bilan sont des jours sans information (jamais des zéros).', { size: 9, color: [0.4, 0.4, 0.45] });

  w.heading('Vue d\'ensemble');
  w.para(`Jours avec bilan : ${avg.days} sur ${o.days}`);
  w.para(avg.value === null ? 'Moyenne générale : indisponible (aucune réponse numérique).' : `Moyenne générale : ${formatScore(avg.value)}/10`, { bold: true });
  const cats = s.categories.slice().sort((a, b) => a.sort_order - b.sort_order);
  for (const c of cats) {
    const vals = series.map((p) => p.categories[c.id]).filter((v): v is number => v !== null && v !== undefined);
    w.para(`${c.name} : ${vals.length ? `${formatScore(vals.reduce((a, b) => a + b, 0) / vals.length)}/10 (${vals.length} jour${vals.length > 1 ? 's' : ''})` : 'pas de donnée'}`, { size: 9.5, indent: 8 });
  }
  w.para('Méthode : chaque réponse est ramenée sur 10 ; la moyenne générale est la moyenne des catégories qui ont des données. La douleur, les textes et les oui/non ne sont pas dans les moyennes.', { size: 8.5, color: [0.4, 0.4, 0.45] });

  w.heading('Évolution de la moyenne générale');
  w.lineChart(series.map((p) => p.general), [from.split('-').reverse().join('/'), t.split('-').reverse().join('/')]);
  const weeks = aggregatePeriods(series, 'week').filter((x) => x.value !== null);
  if (weeks.length) {
    w.heading('Semaine par semaine', 12);
    for (const x of weeks) w.para(`Semaine du ${x.key.split('-').reverse().join('/')} : ${formatScore(x.value)}/10 (${x.days} jour${x.days > 1 ? 's' : ''} avec données)`, { size: 9.5, indent: 8 });
  }

  const inRange = list.filter((c) => c.checkin_date >= from && c.checkin_date <= t);
  if (o.includePain) {
    const pains = inRange.filter((c) => c.pain_score !== null && c.pain_score !== undefined);
    w.heading('Douleur (suivie séparément des moyennes)');
    if (!pains.length) w.para('Aucune douleur notée sur la période.');
    else {
      const mean = pains.reduce((a, c) => a + (c.pain_score as number), 0) / pains.length;
      w.para(`${pains.length} jour(s) avec douleur notée - intensité moyenne ${formatScore(mean)}/10 - maximale ${Math.max(...pains.map((c) => c.pain_score as number))}/10`, { bold: true });
      for (const c of pains) w.para(`${c.checkin_date} : ${c.pain_score}/10${c.pain_zone ? ` - ${c.pain_zone}` : ''}${o.includeNotes && c.pain_note ? ` - ${c.pain_note}` : ''}`, { size: 9, indent: 8 });
    }
  }
  if (o.includeNotes) {
    const notes = inRange.filter((c) => c.day_note || c.events_note);
    w.heading('Notes personnelles');
    if (!notes.length) w.para('Aucune note sur la période.');
    for (const c of notes) w.para(`${c.checkin_date} : ${[c.events_note, c.day_note].filter(Boolean).join(' / ')}`, { size: 9, indent: 8 });
  }
  w.para(`Rapport généré le ${(o.now ?? new Date()).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}. Douleur incluse : ${o.includePain ? 'oui' : 'non'} - notes incluses : ${o.includeNotes ? 'oui' : 'non'}.`, { size: 8.5, color: [0.4, 0.4, 0.45] });
  return w.finish('Tock Tock - rapport de suivi');
}
