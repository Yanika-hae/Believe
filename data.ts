export const CATS=['Sport','Santé','Esprit','Études','Créativité'];
/** Rôle d'une habitude : il survit au renommage (les cases cochées automatiquement retrouvent l'habitude par son rôle, pas par son nom). */
export const ROLES=['sport','pas','sante','apprendre','priere','cours','livre','creatif'] as const;
export type Role=typeof ROLES[number];
/** Début du nom d'origine de chaque rôle : sert à retrouver l'habitude dans les données créées avant les rôles. */
export const ROLE_PREFIX:Record<Role,string>={sport:'Sport',pas:'10 000',sante:'Santé',apprendre:'Apprendre',priere:'Prier',cours:'20 pages de cours',livre:'20 pages de mon',creatif:'Activité'};
export const DH:[string,string,Role][]=[['Sport : marche, course ou salle','Sport','sport'],['10 000 pas','Sport','pas'],['Santé : pas de grignotage, peu de sucre','Santé','sante'],['Apprendre une chose (mini-carnet)','Études','apprendre'],['Prier le matin','Esprit','priere'],['20 pages de cours','Études','cours'],['20 pages de mon livre','Études','livre'],['Activité créative','Créativité','creatif']];
export { VF, VM, TR, refSpoken, trLabel } from './verses';
export type { TrKey, Verse } from './verses';
export const NOTE_CATS=['Rêves','Cauchemars','Chants','Poèmes','Apprentissages'] as const;
export type NoteCat=typeof NOTE_CATS[number];
/** Catégories du quiz de l'Académie (rubrique 13). */
export const QCATS=['Vocabulaire','Définitions','Rhétorique','Culture générale','Biblique'] as const;
export type QCat=typeof QCATS[number];
/** Éléments partageables avec des amis (tout est masqué par défaut, les sensibles demandent en plus une confirmation). Les autres données ne sont jamais partagées. */
export const SHARE_KEYS=['name','habits','badges','steps','quiz','books','weight','weightPct','cycle','food','prayers','notes'] as const;
export type ShareKey=typeof SHARE_KEYS[number];
/** Domaines autorisés pour les liens et couvertures de livres (client et serveur). */
export const BOOK_HOSTS=['openlibrary.org','archive.org','books.google.com','play.google.com','www.google.com','gutenberg.org','gutendex.com','librivox.org','wikisource.org','wikimedia.org','classics.mit.edu'] as const;
