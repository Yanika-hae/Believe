/** `r` : échéance pour laquelle le rappel a déjà été donné (ou volontairement passé) ; si l'échéance change, le rappel est de nouveau armé. */
export interface Task { id: string; t: string; imp: boolean; due: string | null; done: boolean; p: 1 | 2 | 3 | 4 | null; r?: string }
export const QL = ['', 'Urgent et important : à faire maintenant', 'Important, non urgent : à planifier', 'Urgent, peu important : à déléguer', 'Ni urgent ni important : à éliminer']

/** Quadrant d'Eisenhower : choix manuel s'il existe, sinon automatique (urgent = échéance dans moins de 48 h ou dépassée). */
export const quad = (t: Task, now = Date.now()): 1 | 2 | 3 | 4 => {
  if (t.p) return t.p
  const urgent = !!t.due && new Date(t.due).getTime() - now <= 48 * 3600e3
  return t.imp ? (urgent ? 1 : 2) : (urgent ? 3 : 4)
}
const z = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, '')
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
/** Pliage RFC 5545 : 75 octets maximum par ligne, suites préfixées d'une espace, sans couper un caractère. */
export const fold = (line: string) => {
  const enc = new TextEncoder(), out: string[] = []
  let cur = '', n = 0
  for (const ch of line) {
    const b = enc.encode(ch).length
    if (n + b > 75) { out.push(cur); cur = ' '; n = 1 }
    cur += ch; n += b
  }
  out.push(cur)
  return out.join('\r\n')
}
/** Fichier .ics (heures en UTC, rappel 30 min avant). Seules les tâches non terminées avec échéance valide sont exportées. */
export const ics = (tasks: Task[], now = new Date()) => {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Believe//FR', 'CALSCALE:GREGORIAN']
  for (const t of tasks) {
    if (!t.due || t.done) continue
    const s = new Date(t.due)
    if (isNaN(s.getTime())) continue
    L.push('BEGIN:VEVENT', 'UID:' + t.id + '@believe', 'DTSTAMP:' + z(now), 'DTSTART:' + z(s), 'DTEND:' + z(new Date(s.getTime() + 3600e3)),
      'SUMMARY:' + esc('P' + quad(t, now.getTime()) + ' ' + t.t), 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(t.t), 'TRIGGER:-PT30M', 'END:VALARM', 'END:VEVENT')
  }
  L.push('END:VCALENDAR')
  return L.map(fold).join('\r\n') + '\r\n'
}
/** Lien « Ajouter à Google Agenda » (durée 1 h). */
export const gcal = (t: Task) => {
  const s = new Date(t.due ?? '')
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(t.t) + '&dates=' + z(s) + '/' + z(new Date(s.getTime() + 3600e3))
}
/** Secondes restantes jusqu'à une échéance (jamais négatif). */
export const left = (end: number, now = Date.now()) => Math.max(0, Math.ceil((end - now) / 1000))
