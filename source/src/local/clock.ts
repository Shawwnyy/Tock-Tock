// Heure affichée en haut de l'écran : HH:MM:SS dans le fuseau choisi (repli sur celui de l'appareil si le fuseau est invalide).
function formatter(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try { return new Intl.DateTimeFormat('fr-FR', { ...opts, timeZone: tz || undefined }); } catch { return new Intl.DateTimeFormat('fr-FR', opts); }
}
export const formatClock = (d: Date, tz: string): string => formatter(tz, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(d);
export const formatClockDate = (d: Date, tz: string): string => formatter(tz, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
/** Délai en ms jusqu'à la prochaine seconde pleine (l'horloge reste calée sans dérive). */
export const msToNextSecond = (now = Date.now()): number => 1000 - (now % 1000) + 5;
