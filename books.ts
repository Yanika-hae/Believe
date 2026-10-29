import { norm, terms, matches } from './util'
import { safeUrl } from './schema'
import { BOOK_HOSTS } from './data'

// Bibliothèque intégrée : résumés ORIGINAUX rédigés pour Believe (aucun extrait de livre protégé). Les citations ne sont reproduites que pour des textes du domaine public,
// courtes, avec leur référence et la source où le texte a été vérifié. Les livres récents n'ont donc aucune citation.
export type Lang = 'fr' | 'en'
export const BCATS = ['Classique', 'Développement personnel', 'Manipulation & Persuasion', 'Biblique', 'Art de la rhétorique'] as const
export type BCat = typeof BCATS[number]
/** Citation courte vérifiée : texte, langue du texte, référence précise et source consultée. */
export interface Quote { l: Lang; t: string; r: string; s: string }
export interface Book {
  id: string; t: string; alt?: string; a: string; y: string; c: BCat
  /** Langues proposées pour ce livre (titre principal, résumé, citations, textes libres). */
  l: Lang[]
  /** Vrai si l'œuvre est dans le domaine public : seules ces œuvres peuvent avoir des citations et un lien de lecture libre. */
  pd: boolean
  th: string[]; idee: string; pts: string[]; retenir: string; en: string; q: Quote[]
  /** Numéro Project Gutenberg vérifié (page du livre consultée). */
  gu?: number
  /** Autre adresse de lecture libre vérifiée. */
  lib?: string
  /** Chapitre de départ dans la Bible Louis Segond 1910 (lecture libre en français sur BibleGateway, adresse vérifiée). */
  bg?: string
}

const GUT = (n: number) => 'Project Gutenberg n° ' + n
const LSG = 'Bible Louis Segond 1910 (domaine public)', KJV = 'Bible King James (domaine public)'

export const BOOKS: Book[] = [
  // ------------------------------------------------------------------ Classique
  {
    id: 'orgueil-prejuges', t: 'Pride and Prejudice', alt: 'Orgueil et Préjugés', a: 'Jane Austen', y: '1813', c: 'Classique', l: ['en'], pd: true, gu: 1342,
    th: ['roman', 'amour', 'mariage', 'société anglaise', 'préjugés', 'orgueil', 'premières impressions', 'novel', 'romance', 'regency'],
    idee: 'Dans la campagne anglaise du début du XIXᵉ siècle, Elizabeth Bennet et le riche Mr Darcy se jugent mal dès leur première rencontre : lui par orgueil de rang, elle par préjugé. Le roman suit leur lente remise en question.',
    pts: ['Les Bennet, famille sans fils, doivent marier leurs cinq filles pour assurer leur avenir : le mariage est aussi une question d’argent et de statut.', 'Elizabeth se laisse séduire par le charme de Wickham et condamne Darcy sur des apparences.', 'La lettre de Darcy, après son premier refus, l’oblige à revoir ses jugements.', 'Darcy corrige lui aussi son orgueil et agit discrètement pour réparer la fuite de la jeune Lydia.', 'Les deux couples, Jane et Bingley puis Elizabeth et Darcy, s’unissent une fois les illusions tombées.'],
    retenir: 'Nos premières impressions sont souvent des filtres : prendre le temps de vérifier avant de juger, et savoir reconnaître ses torts, est une force.',
    en: 'A sharp comedy of manners in which Elizabeth Bennet and Mr Darcy must overcome pride and prejudice before they can love each other.',
    q: [{ l: 'en', t: 'It is a truth universally acknowledged, that a single man in possession of a good fortune must be in want of a wife.', r: 'Pride and Prejudice, chapitre 1', s: GUT(1342) }]
  },
  {
    id: 'les-miserables', t: 'Les Misérables', a: 'Victor Hugo', y: '1862', c: 'Classique', l: ['fr'], pd: true,
    th: ['roman', 'justice', 'rédemption', 'pauvreté', 'miséricorde', 'Paris', 'XIXe siècle', 'Jean Valjean', 'Javert'],
    idee: 'L’ancien forçat Jean Valjean, bouleversé par la bonté d’un évêque, choisit de devenir un homme juste, tandis que l’inspecteur Javert, fidèle à la lettre de la loi, le poursuit toute sa vie.',
    pts: ['Condamné à dix-neuf ans de bagne pour un vol de pain et des tentatives d’évasion, Valjean sort aigri, puis reçoit le pardon de Mgr Myriel.', 'Devenu maire et industriel sous un autre nom, il recueille Cosette, la fille de Fantine, morte dans la misère.', 'Javert incarne une justice sans pitié ; sa certitude s’effondre quand Valjean l’épargne.', 'L’insurrection parisienne de 1832 réunit les destins, notamment ceux de Marius et de Cosette.', 'Hugo décrit aussi la société de son temps : misère, enfance abandonnée, injustice des lois.'],
    retenir: 'La miséricorde peut transformer une vie, et la loi sans compassion peut devenir elle-même injuste.',
    en: 'Hugo’s epic of mercy and justice: an ex-convict is remade by forgiveness while a rigid policeman hunts him across a suffering France.', q: []
  },
  {
    id: 'candide', t: 'Candide ou l’Optimisme', a: 'Voltaire', y: '1759', c: 'Classique', l: ['fr'], pd: true,
    th: ['conte philosophique', 'optimisme', 'satire', 'guerre', 'tolérance', 'Leibniz', 'Lumières', 'Pangloss'],
    idee: 'Un jeune homme naïf, à qui son précepteur Pangloss enseigne que tout est pour le mieux, traverse guerres, catastrophes et injustices qui démentent cette philosophie.',
    pts: ['Chassé du château de Westphalie, Candide est enrôlé de force, puis échappe aux massacres et au tremblement de terre de Lisbonne.', 'Voltaire raille l’optimisme inspiré de Leibniz, qu’il juge incapable d’expliquer le mal réel.', 'Le pays d’Eldorado, idéal et inaccessible, montre que l’or ne fait pas le bonheur.', 'Le pessimiste Martin et l’optimiste Pangloss s’opposent sans jamais convaincre.', 'Le conte s’achève sur une petite métairie : agir et travailler ensemble plutôt que discuter de l’ordre du monde.'],
    retenir: 'Face au mal et aux beaux discours, Voltaire invite à une sagesse modeste : un travail utile, ici et maintenant.',
    en: 'Voltaire’s satirical tale: a naive young man tests the doctrine that “all is for the best” against a world of war, disaster and cruelty.', q: []
  },
  {
    id: 'monte-cristo', t: 'Le Comte de Monte-Cristo', a: 'Alexandre Dumas', y: '1844-1846', c: 'Classique', l: ['fr'], pd: true,
    th: ['roman d’aventures', 'vengeance', 'justice', 'patience', 'trahison', 'Marseille', 'Edmond Dantès', 'prison'],
    idee: 'Injustement emprisonné au château d’If, le marin Edmond Dantès s’évade quatorze ans plus tard, devenu riche et savant, et met en œuvre une vengeance minutieuse contre ceux qui l’ont trahi.',
    pts: ['Trahi par Danglars, Fernand et Caderousse, et condamné par le substitut Villefort, Dantès perd sa liberté la veille de son mariage.', 'En prison, l’abbé Faria l’instruit et lui révèle l’existence d’un trésor.', 'Revenu à Paris sous le nom de comte de Monte-Cristo, il agit en coulisses auprès de chacun de ses ennemis.', 'Sa vengeance frappe aussi des innocents ; il en vient à douter de son rôle de justicier.', 'Le roman finit sur l’apaisement et l’espérance.'],
    retenir: 'La patience et l’instruction peuvent reconstruire une vie, mais la vengeance dépasse souvent son but : le roman invite à y renoncer.',
    en: 'A wrongly imprisoned sailor returns as a wealthy, mysterious count to settle accounts with the men who betrayed him.', q: []
  },
  {
    id: 'frankenstein', t: 'Frankenstein; or, The Modern Prometheus', alt: 'Frankenstein ou le Prométhée moderne', a: 'Mary Shelley', y: '1818', c: 'Classique', l: ['en'], pd: true, gu: 84,
    th: ['roman gothique', 'science', 'responsabilité', 'créature', 'solitude', 'ambition', 'horror', 'science fiction'],
    idee: 'Victor Frankenstein donne la vie à une créature, puis l’abandonne, horrifié ; rejetée de tous, elle se retourne contre son créateur.',
    pts: ['Le récit est encadré par les lettres du capitaine Walton, qui recueille Victor sur la glace de l’Arctique.', 'Victor, étudiant passionné, assemble la créature, puis la fuit dès qu’elle ouvre les yeux.', 'Instruite en secret, la créature réclame l’affection que personne ne lui accorde ; le refus la rend violente.', 'Elle frappe les proches de Victor, qui la poursuit jusqu’au Grand Nord.', 'Le livre interroge la responsabilité de celui qui crée puis délaisse.'],
    retenir: 'Créer, c’est s’engager : une invention, une idée ou un être dont on est responsable ne se délaisse pas.',
    en: 'Shelley’s gothic classic: a scientist creates life, abandons it, and learns that a rejected creature can become a relentless avenger.',
    q: [{ l: 'en', t: 'It was on a dreary night of November that I beheld the accomplishment of my toils.', r: 'Frankenstein, chapitre 5, première phrase', s: GUT(84) }]
  },
  {
    id: 'petit-prince', t: 'Le Petit Prince', a: 'Antoine de Saint-Exupéry', y: '1943', c: 'Classique', l: ['fr'], pd: false,
    th: ['conte', 'amitié', 'enfance', 'apprivoiser', 'amour', 'désert', 'aviateur', 'responsabilité'],
    idee: 'Un aviateur en panne dans le désert rencontre un petit garçon venu d’une minuscule planète ; ses questions simples dévoilent ce que les adultes ont oublié.',
    pts: ['Le petit prince a quitté sa planète et sa rose, dont il est responsable, après une querelle.', 'Au fil de son voyage, il croise des adultes enfermés dans leurs obsessions : pouvoir, vanité, possession, chiffres.', 'Sur Terre, le renard lui explique ce qu’est apprivoiser : créer des liens qui rendent un être unique.', 'Le prince comprend que sa rose compte à cause du temps qu’il lui a consacré.', 'Le récit se termine par un adieu mystérieux et une invitation à regarder les étoiles autrement.'],
    retenir: 'Ce qui nous attache à quelqu’un se tisse dans le temps donné et les soins apportés, bien plus que dans ce qui se compte.',
    en: 'A pilot stranded in the desert meets a small prince whose simple questions reveal what grown-ups have forgotten about friendship and responsibility.', q: []
  },
  // ------------------------------------------------------------------ Développement personnel
  {
    id: 'as-a-man-thinketh', t: 'As a Man Thinketh', alt: 'Un homme est ce qu’il pense', a: 'James Allen', y: '1903', c: 'Développement personnel', l: ['en'], pd: true, gu: 4507,
    th: ['pensée', 'caractère', 'maîtrise de soi', 'sérénité', 'volonté', 'but', 'mindset', 'thoughts'],
    idee: 'Notre vie extérieure reflète nos pensées habituelles : en les orientant, nous façonnons notre caractère et nos circonstances.',
    pts: ['L’esprit est comparé à un jardin : cultivé avec soin ou laissé aux mauvaises herbes.', 'Les pensées répétées deviennent des habitudes, puis un caractère.', 'Les circonstances révèlent la personne plus qu’elles ne la créent.', 'Un but clair et la maîtrise de soi donnent force et calme.', 'La santé et la sérénité accompagnent une pensée apaisée et droite.'],
    retenir: 'Changer sa vie commence par surveiller ses pensées répétées. Ce court livre exprime des convictions morales, non des résultats scientifiques, et il ne nie pas le poids des circonstances réelles.',
    en: 'A short classic arguing that character and circumstances grow from habitual thought, and that mastering thought brings purpose and calm.',
    q: [
      { l: 'en', t: 'A man is literally what he thinks, his character being the complete sum of all his thoughts.', r: 'As a Man Thinketh, « Thought and Character »', s: GUT(4507) },
      { l: 'en', t: 'Circumstance does not make the man; it reveals him to himself.', r: 'As a Man Thinketh, « Effect of Thought on Circumstances »', s: GUT(4507) }
    ]
  },
  {
    id: 'marc-aurele', t: 'Pensées pour moi-même', alt: 'Meditations', a: 'Marc Aurèle', y: 'vers 170-180', c: 'Développement personnel', l: ['fr', 'en'], pd: true, gu: 2680,
    th: ['stoïcisme', 'sagesse', 'maîtrise de soi', 'devoir', 'mort', 'acceptation', 'empereur romain', 'philosophie', 'stoicism'],
    idee: 'Carnets personnels d’un empereur romain stoïcien : des rappels adressés à lui-même pour agir avec justice et garder son calme.',
    pts: ['Distinguer ce qui dépend de nous (nos jugements, nos actes) de ce qui n’en dépend pas.', 'Accepter les événements comme faisant partie d’un ordre plus vaste.', 'Penser à la brièveté de la vie pour relativiser les soucis.', 'Agir pour les autres : l’être humain est fait pour la coopération.', 'Commencer chaque journée en se préparant aux difficultés prévisibles.'],
    retenir: 'Ces notes n’étaient pas destinées à être publiées : elles servent d’exercice quotidien pour examiner ses jugements avant d’agir.',
    en: 'Private notebooks of a Roman emperor: Stoic reminders to act justly, accept what cannot be changed and keep a steady mind.',
    q: [{ l: 'en', t: 'At what time soever thou wilt, it is in thy power to retire into thyself, and to be at rest, and free from all businesses.', r: 'Pensées, livre IV, 3 (ancienne traduction anglaise)', s: GUT(2680) }]
  },
  {
    id: 'atomic-habits', t: 'Atomic Habits', alt: 'Un rien peut tout changer', a: 'James Clear', y: '2018', c: 'Développement personnel', l: ['en'], pd: false,
    th: ['habitudes', 'discipline', 'identité', 'environnement', 'progrès', 'systèmes', 'habits', 'productivité'],
    idee: 'De petits changements répétés produisent de grands résultats : mieux vaut construire des systèmes d’habitudes que viser des objectifs spectaculaires.',
    pts: ['Quatre lois pour créer une habitude : la rendre évidente, attirante, facile et satisfaisante (et l’inverse pour en défaire une).', 'L’identité compte plus que le résultat : il s’agit de devenir quelqu’un qui fait telle chose.', 'L’environnement guide les comportements : on le règle pour que le bon geste soit le plus simple.', 'La règle des deux minutes : commencer par une version minuscule de l’habitude.', 'Suivre ses habitudes, par exemple avec un tableau, renforce la régularité.'],
    retenir: 'Une petite action répétée chaque jour pèse plus qu’un grand élan occasionnel. Les rubriques Habitudes de Believe appliquent cette idée.',
    en: 'A practical guide to building good habits through tiny, consistent changes, focusing on identity, environment and simple systems.', q: []
  },
  {
    id: 'frankl', t: 'Découvrir un sens à sa vie', alt: 'Man’s Search for Meaning', a: 'Viktor E. Frankl', y: '1946', c: 'Développement personnel', l: ['fr'], pd: false,
    th: ['sens', 'logothérapie', 'souffrance', 'camps de concentration', 'résilience', 'psychologie', 'meaning', 'liberté intérieure'],
    idee: 'Psychiatre survivant des camps nazis, Frankl montre que l’être humain peut supporter presque tout s’il garde un sens à sa vie, et fonde sur ce constat la logothérapie.',
    pts: ['La première partie raconte son expérience des camps, vue à travers les réactions psychologiques des prisonniers.', 'Même privé de tout, on garde une liberté intérieure : choisir son attitude face à ce qu’on ne peut changer.', 'La seconde partie présente la logothérapie : la quête de sens est la motivation première de l’être humain.', 'Le sens se trouve dans une œuvre accomplie, dans une rencontre ou un amour, et dans l’attitude face à une souffrance inévitable.', 'Il oppose ce qu’il appelle l’« optimisme tragique » à la fuite devant la douleur.'],
    retenir: 'Ce récit témoigne d’un vécu extrême ; il ne minimise pas la souffrance mais montre que le sens peut être un appui.',
    en: 'A survivor-psychiatrist’s account of the camps and of logotherapy: the search for meaning can sustain a person through unavoidable suffering.', q: []
  },
  {
    id: 'quatre-accords', t: 'Les Quatre Accords toltèques', alt: 'The Four Agreements', a: 'Don Miguel Ruiz', y: '1997', c: 'Développement personnel', l: ['fr'], pd: false,
    th: ['sagesse', 'toltèque', 'parole', 'relations', 'croyances', 'développement personnel', 'responsabilité', 'agreements'],
    idee: 'Un petit guide de quatre engagements envers soi-même pour se libérer des croyances limitantes et vivre plus sereinement.',
    pts: ['Que ta parole soit impeccable : parler avec vérité et bienveillance, sans se critiquer ni médire.', 'N’en fais pas une affaire personnelle : les paroles des autres parlent d’eux, pas de toi.', 'Ne fais pas de suppositions : poser des questions plutôt que deviner.', 'Fais toujours de ton mieux, selon ton état du jour, sans te juger.', 'L’auteur présente ces accords comme un enseignement d’inspiration toltèque, sous forme de récit symbolique.'],
    retenir: 'Le livre relève d’une tradition spirituelle revendiquée par l’auteur, non d’une étude scientifique : on peut en retenir des règles simples de communication et de bienveillance.',
    en: 'Four simple personal commitments — impeccable words, no taking things personally, no assumptions, doing your best — presented as a Toltec-inspired path to freedom.', q: []
  },
  {
    id: 'sept-habitudes', t: 'The 7 Habits of Highly Effective People', alt: 'Les 7 habitudes de ceux qui réalisent tout ce qu’ils entreprennent', a: 'Stephen R. Covey', y: '1989', c: 'Développement personnel', l: ['en'], pd: false,
    th: ['efficacité', 'proactivité', 'priorités', 'leadership', 'gagnant-gagnant', 'habitudes', 'temps', 'effectiveness'],
    idee: 'Un cadre pour passer de la dépendance à l’indépendance puis à l’interdépendance, en sept habitudes de caractère plutôt qu’en simples techniques.',
    pts: ['Être proactif : choisir sa réponse plutôt que subir les circonstances.', 'Commencer avec la fin en tête : définir ce qui compte avant d’agir.', 'Faire passer les priorités en premier : se concentrer sur l’important plutôt que sur l’urgent.', 'Penser gagnant-gagnant, chercher d’abord à comprendre avant d’être compris, puis créer des synergies.', 'Se renouveler régulièrement : corps, esprit, cœur et relations.'],
    retenir: 'La distinction entre l’important et l’urgent aide à trier ses tâches : on la retrouve dans la matrice d’Eisenhower de la rubrique 9.',
    en: 'Covey’s principle-centred approach to effectiveness: seven habits that move a person from dependence to independence to cooperation.', q: []
  },
  {
    id: 'mindset', t: 'Mindset', a: 'Carol S. Dweck', y: '2006', c: 'Développement personnel', l: ['en'], pd: false,
    th: ['état d’esprit', 'apprentissage', 'échec', 'croissance', 'talent', 'éducation', 'growth mindset', 'effort'],
    idee: 'Croire que nos capacités peuvent se développer (état d’esprit de croissance) plutôt qu’être figées (état d’esprit fixe) change notre rapport à l’effort, à l’échec et à la réussite.',
    pts: ['L’état d’esprit fixe voit l’échec comme un verdict et évite les défis.', 'L’état d’esprit de croissance voit l’échec comme une information pour progresser.', 'Féliciter l’effort et la stratégie soutient mieux la persévérance que féliciter le talent.', 'Ces états d’esprit se retrouvent à l’école, au travail, dans le sport et dans le couple.', 'Des recherches ultérieures montrent des effets variables selon les contextes : l’idée est utile, mais pas magique.'],
    retenir: 'Dire que l’on ne sait pas encore faire quelque chose, plutôt que de dire que l’on en est incapable, aide à rester en mouvement.',
    en: 'Dweck’s case that believing abilities can grow — a growth mindset — changes how we handle effort, failure and learning.', q: []
  },
  // ------------------------------------------------------------------ Manipulation & Persuasion
  {
    id: 'the-prince', t: 'The Prince', alt: 'Le Prince', a: 'Nicolas Machiavel', y: '1532 (écrit en 1513)', c: 'Manipulation & Persuasion', l: ['en', 'fr'], pd: true, gu: 1232,
    th: ['pouvoir', 'politique', 'stratégie', 'réalisme politique', 'vertu', 'fortune', 'princes', 'Renaissance', 'machiavélisme'],
    idee: 'Traité de gouvernement qui décrit, sans prétention morale, comment un prince acquiert et conserve le pouvoir dans l’Italie divisée de la Renaissance.',
    pts: ['Distingue les principautés héréditaires, nouvelles et ecclésiastiques, et les moyens de les conquérir : armes propres ou étrangères, vertu ou fortune.', 'Recommande de s’appuyer sur ses propres troupes plutôt que sur des mercenaires.', 'Affirme que, s’il faut choisir, mieux vaut être craint qu’aimé, mais jamais haï.', 'Compare le prince au lion et au renard : force et ruse.', 'L’œuvre est lue tantôt comme un manuel cynique, tantôt comme une analyse lucide du réel politique.'],
    retenir: 'Le texte aide à reconnaître les ressorts du pouvoir et de la persuasion ; il décrit des pratiques, il ne les recommande pas comme une morale.',
    en: 'Machiavelli’s short treatise on how rulers win and hold power, describing political realities rather than moral ideals.',
    q: [{ l: 'en', t: '… the nature of the people is variable, and whilst it is easy to persuade them, it is difficult to fix them in that persuasion.', r: 'The Prince, chapitre VI (trad. W. K. Marriott)', s: GUT(1232) }]
  },
  {
    id: 'art-of-war', t: 'The Art of War', alt: 'L’Art de la guerre', a: 'Sun Tzu', y: 'Ve siècle av. J.-C. (attribué)', c: 'Manipulation & Persuasion', l: ['en', 'fr'], pd: true, gu: 132,
    th: ['stratégie', 'guerre', 'tromperie', 'conflit', 'négociation', 'Chine ancienne', 'leadership', 'Sunzi'],
    idee: 'Traité chinois de stratégie en treize chapitres : la meilleure victoire est celle qui évite le combat, par la préparation, l’information et l’adaptation.',
    pts: ['Connaître l’adversaire et se connaître soi-même réduit le risque de défaite.', 'La guerre coûte cher : mieux vaut agir vite et éviter les conflits prolongés.', 'La tromperie, la rapidité et le choix du terrain comptent autant que le nombre.', 'Le renseignement et les espions sont essentiels.', 'Un chef juste et discipliné obtient l’adhésion de ses troupes.'],
    retenir: 'Utilisé aujourd’hui en négociation ou en gestion, le texte rappelle de préparer, d’observer et de choisir ses combats.',
    en: 'An ancient Chinese treatise on strategy: prepare, gather intelligence, and win, if possible, without fighting.',
    q: [{ l: 'en', t: 'All warfare is based on deception.', r: 'The Art of War, chapitre I, § 18 (trad. Lionel Giles)', s: GUT(132) }]
  },
  {
    id: 'influence', t: 'Influence: The Psychology of Persuasion', alt: 'Influence et manipulation', a: 'Robert B. Cialdini', y: '1984', c: 'Manipulation & Persuasion', l: ['en'], pd: false,
    th: ['persuasion', 'psychologie sociale', 'réciprocité', 'preuve sociale', 'autorité', 'rareté', 'engagement', 'influence', 'manipulation'],
    idee: 'Un psychologue décrit les raccourcis mentaux qui nous poussent à dire oui, afin de les reconnaître, de s’en protéger et de les utiliser honnêtement.',
    pts: ['Réciprocité : on se sent redevable de ce qu’on a reçu.', 'Engagement et cohérence : après un premier petit oui, on tend à rester cohérent.', 'Preuve sociale : on imite ce que font les autres.', 'Sympathie et autorité : on dit plus facilement oui à ceux qu’on apprécie ou qu’on juge compétents.', 'Rareté : ce qui est limité paraît plus précieux. Une édition récente ajoute un septième principe, l’unité.'],
    retenir: 'Connaître ces leviers sert d’abord à se protéger : face à une offre pressante, se demander quel levier est actionné.',
    en: 'Cialdini’s research-based guide to six principles of persuasion, useful for spotting manipulation as much as for ethical influence.', q: []
  },
  {
    id: '48-laws', t: 'The 48 Laws of Power', alt: 'Les 48 lois du pouvoir', a: 'Robert Greene', y: '1998', c: 'Manipulation & Persuasion', l: ['en'], pd: false,
    th: ['pouvoir', 'stratégie', 'manipulation', 'séduction', 'cour', 'histoire', 'ambition', 'power'],
    idee: 'Quarante-huit maximes illustrées d’anecdotes historiques sur la conquête et la conservation du pouvoir, présentées sans souci de morale.',
    pts: ['Chaque loi est illustrée par des exemples de réussite et d’échec tirés de l’histoire ou de la littérature.', 'L’ouvrage insiste sur l’apparence, la discrétion sur ses intentions et la maîtrise de sa réputation.', 'Il décrit la cour des rois comme modèle des rapports de pouvoir, y compris en entreprise.', 'Le ton est cynique : de nombreux lecteurs critiquent son approche manipulatrice des relations.', 'Lu avec esprit critique, il aide à repérer les tactiques employées par les autres.'],
    retenir: 'À lire comme un catalogue de tactiques à reconnaître, pas comme un mode de vie : la confiance et l’honnêteté durent plus longtemps que la ruse.',
    en: 'A cynical catalogue of 48 power tactics drawn from history; most useful as a guide for recognising manipulation.', q: []
  },
  {
    id: 'la-boetie', t: 'Discours de la servitude volontaire', a: 'Étienne de La Boétie', y: 'vers 1548-1553 (publié en 1576)', c: 'Manipulation & Persuasion', l: ['fr'], pd: true,
    th: ['tyrannie', 'obéissance', 'liberté', 'pouvoir', 'habitude', 'Renaissance', 'politique', 'servitude'],
    idee: 'Pourquoi des milliers de personnes obéissent-elles à un seul homme ? La Boétie répond que la tyrannie tient par le consentement, l’habitude et les intérêts qu’elle distribue.',
    pts: ['Un tyran n’a que le pouvoir que les gens lui laissent : il suffirait de cesser de le soutenir.', 'L’habitude fait oublier la liberté, surtout aux générations nées sous le joug.', 'Les divertissements et les faveurs endorment le peuple.', 'Autour du tyran, une chaîne de bénéficiaires relaie son pouvoir à tous les niveaux.', 'Texte de jeunesse, devenu un classique de la pensée politique et de la désobéissance civile.'],
    retenir: 'Une liberté commence par ne plus donner son accord à ce qui nous asservit.',
    en: 'A teenage jurist’s 16th-century essay asking why people obey tyrants — and answering that tyranny rests on consent, habit and favours.', q: []
  },
  {
    id: 'le-bon', t: 'Psychologie des foules', alt: 'The Crowd', a: 'Gustave Le Bon', y: '1895', c: 'Manipulation & Persuasion', l: ['fr', 'en'], pd: true, gu: 445,
    th: ['foule', 'psychologie collective', 'suggestion', 'contagion', 'propagande', 'meneurs', 'opinion', 'crowd'],
    idee: 'Au sein d’une foule, l’individu perd une part de son esprit critique : il devient plus impulsif, plus influençable et plus sensible aux images et aux meneurs.',
    pts: ['L’anonymat et la contagion émotionnelle diminuent le sentiment de responsabilité.', 'Les foules pensent surtout par images et par affirmations répétées, plus que par raisonnements.', 'Les meneurs agissent par l’affirmation, la répétition et le prestige.', 'Le livre a beaucoup circulé parmi les théoriciens de la communication et de la propagande politique.', 'Ses thèses, formulées à la fin du XIXᵉ siècle, sont jugées aujourd’hui datées, élitistes et peu scientifiques sur plusieurs points.'],
    retenir: 'À lire avec distance critique : un document d’histoire des idées plus qu’une science établie.',
    en: 'Le Bon’s 1895 study of how individuals change inside crowds — suggestible, emotional, led by images and persuasive leaders.',
    q: [{ l: 'en', t: 'The age we are about to enter will in truth be the ERA OF CROWDS.', r: 'The Crowd, introduction', s: GUT(445) }]
  },
  {
    id: 'joule-beauvois', t: 'Petit traité de manipulation à l’usage des honnêtes gens', a: 'Robert-Vincent Joule et Jean-Léon Beauvois', y: '1987', c: 'Manipulation & Persuasion', l: ['fr'], pd: false,
    th: ['manipulation', 'soumission librement consentie', 'psychologie sociale', 'pied-dans-la-porte', 'engagement', 'influence', 'persuasion', 'expériences'],
    idee: 'Deux psychologues sociaux expliquent, expériences à l’appui, comment obtenir ou subir un comportement sans contrainte, par l’engagement préalable de la personne.',
    pts: ['Le pied-dans-la-porte : une petite demande acceptée rend plus probable l’acceptation d’une demande plus grande.', 'La porte-dans-le-nez : une demande excessive refusée rend la demande suivante plus acceptable.', 'L’amorçage : on engage quelqu’un sur une décision avant d’en révéler le coût réel.', 'La « soumission librement consentie » repose sur le sentiment d’avoir agi de son plein gré.', 'Connaître ces mécanismes aide à repérer les situations où l’on est manipulé et à s’en défendre.'],
    retenir: 'Avant de dire oui, se demander si la demande suit un petit engagement antérieur ou une demande exagérée.',
    en: 'A French social-psychology classic on “freely consented compliance”: how small commitments lead people to agree to more.', q: []
  },
  // ------------------------------------------------------------------ Biblique
  {
    id: 'psaumes', t: 'Les Psaumes', alt: 'Psalms', a: 'Recueil biblique (David et d’autres auteurs)', y: 'composé sur plusieurs siècles', c: 'Biblique', l: ['fr', 'en'], pd: true, gu: 10, bg: 'Psaumes 23',
    th: ['prière', 'louange', 'confiance', 'lamentation', 'chant', 'David', 'berger', 'consolation', 'psalms', 'worship'],
    idee: 'Recueil de 150 chants et prières hébraïques qui expriment toute la gamme de l’expérience humaine devant Dieu : louange, plainte, confiance, pardon.',
    pts: ['Les psaumes de louange célèbrent la grandeur de Dieu et la beauté de la création.', 'Les psaumes de lamentation expriment sans détour la peur, la colère ou le découragement avant de revenir à la confiance.', 'Le psaume 23 compare Dieu à un berger qui guide et protège.', 'Le psaume 51 est une prière de repentance, le psaume 121 une prière de secours pour le voyage, le psaume 150 un appel final à louer.', 'Les Psaumes sont chantés et priés depuis des siècles dans le judaïsme et le christianisme.'],
    retenir: 'On peut prier avec les psaumes ses propres joies et ses détresses : ils donnent des mots quand on n’en trouve plus.',
    en: 'A collection of 150 Hebrew songs and prayers covering praise, lament, trust and repentance.',
    q: [{ l: 'fr', t: 'L’Éternel est mon berger: je ne manquerai de rien.', r: 'Psaume 23:1', s: LSG }, { l: 'en', t: 'The LORD is my shepherd; I shall not want.', r: 'Psalm 23:1', s: KJV }]
  },
  {
    id: 'proverbes', t: 'Les Proverbes', alt: 'Proverbs', a: 'Recueil de sagesse attribué en grande partie à Salomon', y: 'Antiquité', c: 'Biblique', l: ['fr', 'en'], pd: true, gu: 10, bg: 'Proverbes 3',
    th: ['sagesse', 'parole', 'travail', 'humilité', 'discernement', 'Salomon', 'conseils', 'proverbs', 'wisdom'],
    idee: 'Recueil de sentences et d’instructions pour vivre avec sagesse : discernement, travail, parole, justice, amitié et crainte de l’Éternel.',
    pts: ['Le livre oppose la sagesse, qui construit, à la folie, qui détruit.', 'Il insiste sur la parole : elle peut blesser ou guérir.', 'Il valorise le travail régulier et met en garde contre la paresse et la précipitation.', 'Il recommande l’écoute des conseils, l’humilité et la droiture.', 'Le dernier chapitre dresse le portrait d’une femme de valeur, active et sage.'],
    retenir: 'Chaque proverbe résume une expérience : à méditer plutôt qu’à lire comme une promesse automatique.',
    en: 'A book of practical wisdom: short sayings on choices, speech, work, humility and integrity.',
    q: [{ l: 'fr', t: 'Confie-toi en l’Éternel de tout ton cœur, Et ne t’appuie pas sur ta sagesse; Reconnais-le dans toutes tes voies, Et il aplanira tes sentiers.', r: 'Proverbes 3:5-6', s: LSG }, { l: 'en', t: 'Trust in the LORD with all thine heart; and lean not unto thine own understanding. In all thy ways acknowledge him, and he shall direct thy paths.', r: 'Proverbs 3:5-6', s: KJV }]
  },
  {
    id: 'ecclesiaste', t: 'L’Ecclésiaste', alt: 'Ecclesiastes', a: 'Qohéleth (« le Prédicateur »)', y: 'Antiquité', c: 'Biblique', l: ['fr', 'en'], pd: true, gu: 10, bg: 'Ecclésiaste 3',
    th: ['sagesse', 'vanité', 'temps', 'sens de la vie', 'travail', 'plaisir', 'mort', 'ecclesiastes', 'qohelet'],
    idee: 'Un sage se demande ce qui reste de tout ce que l’on poursuit sous le soleil, et en tire une sagesse sobre : accueillir les dons du quotidien et craindre Dieu.',
    pts: ['Le refrain « vanité des vanités » dit la fragilité et le caractère fugitif des réussites humaines.', 'Il y a un temps pour chaque chose : naître, mourir, planter, guérir, pleurer, rire.', 'Plaisirs, richesses et savoir ne suffisent pas à combler le cœur.', 'Le sage recommande de goûter simplement le travail, le repas et l’amitié comme des dons.', 'Le livre se conclut sur la crainte de Dieu et l’observation de ses commandements.'],
    retenir: 'Lire ce livre invite à relativiser l’agitation et à savourer le présent.',
    en: 'A philosophical meditation on the limits of human striving, urging simple gratitude for daily gifts.',
    q: [{ l: 'fr', t: 'Il y a un temps pour tout, un temps pour toute chose sous les cieux:', r: 'Ecclésiaste 3:1', s: LSG }, { l: 'en', t: 'To every thing there is a season, and a time to every purpose under the heaven:', r: 'Ecclesiastes 3:1', s: KJV }]
  },
  {
    id: 'jean', t: 'L’Évangile selon Jean', alt: 'Gospel of John', a: 'Jean', y: 'fin du Iᵉʳ siècle', c: 'Biblique', l: ['fr', 'en'], pd: true, gu: 10, bg: 'Jean 3',
    th: ['évangile', 'Jésus', 'foi', 'lumière', 'vie éternelle', 'signes', 'amour', 'gospel', 'john'],
    idee: 'Quatrième évangile : il présente Jésus comme la Parole venue révéler Dieu et donner la vie.',
    pts: ['Le prologue présente Jésus comme la Parole présente auprès de Dieu dès le commencement.', 'Sept « signes », comme le changement de l’eau en vin à Cana ou la résurrection de Lazare, manifestent sa mission.', 'Sept déclarations « Je suis » : le pain de vie, la lumière du monde, la porte, le bon berger, la résurrection et la vie, le chemin, la vérité et la vie, la vigne véritable.', 'Les dialogues avec Nicodème ou la Samaritaine montrent un accueil personnel de chacun.', 'Le récit de la Passion et de la résurrection se conclut sur le but du livre : croire pour avoir la vie.'],
    retenir: 'Un bon point de départ pour lire l’Évangile : on peut suivre un « signe » ou une déclaration « Je suis » à la fois.',
    en: 'The fourth Gospel presents Jesus as the Word made flesh through signs, “I am” sayings and personal encounters.',
    q: [{ l: 'fr', t: 'Car Dieu a tant aimé le monde qu’il a donné son Fils unique, afin que quiconque croit en lui ne périsse point, mais qu’il ait la vie éternelle.', r: 'Jean 3:16', s: LSG }, { l: 'en', t: 'For God so loved the world, that he gave his only begotten Son, …', r: 'John 3:16 (début du verset)', s: KJV }]
  },
  {
    id: 'sermon-montagne', t: 'Le Sermon sur la montagne', alt: 'Sermon on the Mount', a: 'Évangile selon Matthieu, chapitres 5 à 7', y: 'Iᵉʳ siècle', c: 'Biblique', l: ['fr', 'en'], pd: true, gu: 10, bg: 'Matthieu 5',
    th: ['béatitudes', 'Jésus', 'prière', 'inquiétude', 'justice', 'amour des ennemis', 'règle d’or', 'matthieu', 'sermon'],
    idee: 'Le plus long discours de Jésus rapporté par Matthieu : un portrait de la vie à laquelle il invite, fondée sur l’humilité, la miséricorde et la confiance en Dieu.',
    pts: ['Les Béatitudes ouvrent le discours en déclarant heureux les humbles, les doux, les artisans de paix et ceux qui ont faim de justice.', 'Les disciples sont comparés au sel de la terre et à la lumière du monde.', 'Jésus approfondit la loi : colère, regard, parole, amour même des ennemis.', 'Il enseigne à prier simplement (le « Notre Père »), à donner et à jeûner sans ostentation, et à ne pas s’inquiéter du lendemain.', 'Il conclut par l’image de deux maisons : l’une bâtie sur le roc, l’autre sur le sable.'],
    retenir: 'À méditer chapitre par chapitre ; la « règle d’or » (faire aux autres ce que l’on voudrait qu’ils fassent pour nous) en est un résumé pratique.',
    en: 'Jesus’ great teaching on the hill: Beatitudes, love of enemies, simple prayer, freedom from anxiety, and building a life on solid ground.',
    q: [{ l: 'fr', t: 'Cherchez premièrement le royaume et la justice de Dieu; et toutes ces choses vous seront données par-dessus.', r: 'Matthieu 6:33', s: LSG }, { l: 'en', t: 'But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you.', r: 'Matthew 6:33', s: KJV }]
  },
  {
    id: 'romains', t: 'L’Épître aux Romains', alt: 'Epistle to the Romans', a: 'Paul de Tarse', y: 'vers 57', c: 'Biblique', l: ['fr', 'en'], pd: true, gu: 10, bg: 'Romains 8',
    th: ['grâce', 'foi', 'justification', 'Esprit', 'Paul', 'épître', 'vie chrétienne', 'romans'],
    idee: 'Paul expose à l’Église de Rome que tous ont besoin de la grâce de Dieu, qui offre le salut par la foi en Jésus-Christ, puis il en tire les conséquences pour la vie quotidienne.',
    pts: ['Chapitres 1 à 3 : tous les humains, juifs ou non, sont atteints par le péché et ont besoin de pardon.', 'Chapitres 4 et 5 : Abraham illustre la justification par la foi ; la paix avec Dieu est offerte gratuitement.', 'Chapitres 6 à 8 : la vie nouvelle dans l’Esprit, y compris l’assurance de l’amour de Dieu en toutes circonstances.', 'Chapitres 9 à 11 : réflexion sur Israël et le plan de Dieu.', 'Chapitres 12 à 16 : conseils concrets — humilité, service, amour, respect des autorités, accueil des différences.'],
    retenir: 'Un texte dense, à lire lentement ; le chapitre 12 réunit des consignes très concrètes pour la vie en communauté.',
    en: 'Paul’s letter explaining grace and faith, and then what a transformed life looks like in practice.',
    q: [{ l: 'fr', t: 'Nous savons, du reste, que toutes choses concourent au bien de ceux qui aiment Dieu, de ceux qui sont appelés selon son dessein.', r: 'Romains 8:28', s: LSG }, { l: 'en', t: 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.', r: 'Romans 8:28', s: KJV }]
  },
  // ------------------------------------------------------------------ Art de la rhétorique
  {
    id: 'aristote-rhetorique', t: 'Rhétorique', alt: 'Rhetoric', a: 'Aristote', y: 'IVᵉ siècle av. J.-C.', c: 'Art de la rhétorique', l: ['fr', 'en'], pd: true, lib: 'https://classics.mit.edu/Aristotle/rhetoric.html',
    th: ['persuasion', 'ethos', 'pathos', 'logos', 'discours', 'argumentation', 'Grèce antique', 'rhétorique', 'enthymème'],
    idee: 'Premier grand traité d’art oratoire : la rhétorique est l’art de découvrir, pour chaque sujet, les moyens de persuader.',
    pts: ['Trois preuves : l’ethos (le caractère crédible de l’orateur), le pathos (les émotions du public), le logos (le raisonnement).', 'Trois genres de discours : délibératif (décider de l’avenir), judiciaire (juger le passé), épidictique (louer ou blâmer le présent).', 'L’enthymème (raisonnement abrégé) et l’exemple sont les outils principaux de l’argumentation oratoire.', 'Il étudie les passions (colère, pitié, crainte…) et les caractères des auditoires pour mieux s’y adapter.', 'Le livre III traite de la mise en forme : style, clarté, métaphores, composition du discours.'],
    retenir: 'Persuader honnêtement suppose de combiner crédibilité, émotion juste et raisons solides.',
    en: 'Aristotle’s foundational treatise: rhetoric as the art of finding the available means of persuasion, through character, emotion and argument.',
    q: [{ l: 'en', t: 'Rhetoric may be defined as the faculty of observing in any given case the available means of persuasion.', r: 'Rhétorique, livre I, partie 2 (trad. W. Rhys Roberts)', s: 'MIT Internet Classics Archive' }]
  },
  {
    id: 'cicero-orateur', t: 'De l’orateur', alt: 'De Oratore', a: 'Cicéron', y: '55 av. J.-C.', c: 'Art de la rhétorique', l: ['fr'], pd: true,
    th: ['éloquence', 'orateur', 'Rome', 'culture', 'mémoire', 'rhétorique', 'dialogue', 'cicero'],
    idee: 'Dialogue romain sur l’orateur idéal : un homme d’une vaste culture, capable d’instruire, de plaire et d’émouvoir.',
    pts: ['L’éloquence demande à la fois du talent, de l’exercice et une culture étendue (droit, histoire, philosophie).', 'Le discours se prépare en cinq temps : trouver les idées, les ordonner, les mettre en style, les retenir, les prononcer.', 'L’orateur doit instruire, charmer et émouvoir son public.', 'Le dialogue met en scène de grands orateurs romains, dont Crassus et Antoine.', 'Cicéron défend l’union de l’éloquence et de la sagesse.'],
    retenir: 'Pour bien parler : cultiver son esprit, travailler son plan et s’exercer régulièrement.',
    en: 'Cicero’s dialogue on the ideal orator: broad learning, careful preparation and the power to teach, please and move.', q: []
  },
  {
    id: 'quintilien', t: 'Institution oratoire', alt: 'Institutio Oratoria', a: 'Quintilien', y: 'vers 95', c: 'Art de la rhétorique', l: ['fr'], pd: true,
    th: ['éducation', 'orateur', 'enseignement', 'style', 'mémoire', 'geste', 'Rome', 'pédagogie'],
    idee: 'Douze livres consacrés à la formation complète de l’orateur, de l’enfance à la maturité, avec l’idée que l’éloquence suppose l’honnêteté.',
    pts: ['Les premiers livres traitent de l’éducation de l’enfant et de l’enseignement par étapes.', 'Les livres suivants détaillent la préparation du discours : invention, disposition, style.', 'Quintilien consacre des pages à la mémoire et à l’action (voix, gestes, tenue).', 'Il recommande la lecture, l’écriture quotidienne et l’exercice.', 'Pour lui, l’orateur idéal est un homme de bien habile à parler.'],
    retenir: 'Le talent se travaille, et la valeur morale de l’orateur renforce la confiance qu’on lui accorde.',
    en: 'Quintilian’s twelve-book programme for training an orator, resting on the idea that a good speaker must also be a good person.', q: []
  },
  {
    id: 'schopenhauer', t: 'L’Art d’avoir toujours raison', a: 'Arthur Schopenhauer', y: 'vers 1830-1831 (publié en 1864)', c: 'Art de la rhétorique', l: ['fr'], pd: true,
    th: ['dialectique éristique', 'débat', 'sophismes', 'stratagèmes', 'argumentation', 'polémique', 'logique', 'discussion'],
    idee: 'Un court traité recense 38 stratagèmes pour l’emporter dans une discussion, qu’on ait raison ou non — utiles pour les reconnaître et s’en défendre.',
    pts: ['Distingue la recherche de la vérité (logique) de la volonté de gagner un débat (dialectique éristique).', 'Parmi les ruses : étendre l’affirmation de l’adversaire au-delà de ce qu’il a dit, détourner la discussion, ou le mettre en colère.', 'Souligne que l’on cherche souvent la victoire par vanité plutôt que la vérité.', 'Chaque stratagème appelle une parade : le repérer, l’annoncer, revenir au sujet.', 'Texte posthume, resté à l’état de notes de travail.'],
    retenir: 'À utiliser comme un guide de vigilance : face à une manœuvre, rester calme et ramener l’échange aux faits.',
    en: 'Schopenhauer’s short manual of 38 debating tricks: read it to spot manipulative arguments and defend against them.', q: []
  },
  {
    id: 'perelman', t: 'Traité de l’argumentation : la nouvelle rhétorique', a: 'Chaïm Perelman et Lucie Olbrechts-Tyteca', y: '1958', c: 'Art de la rhétorique', l: ['fr'], pd: false,
    th: ['argumentation', 'auditoire', 'rhétorique moderne', 'droit', 'philosophie', 'raisonnable', 'persuasion', 'nouvelle rhétorique'],
    idee: 'Les auteurs réhabilitent l’art d’argumenter : en matière de choix, de droit ou de morale, on ne démontre pas comme en mathématiques, on cherche l’adhésion d’un auditoire.',
    pts: ['L’argumentation s’adapte toujours à un auditoire : particulier, ou « universel » (l’ensemble des personnes raisonnables).', 'Elle part d’accords préalables (faits, valeurs, lieux communs) que l’orateur peut invoquer.', 'Les techniques d’association (liens de cause, de comparaison…) et de dissociation structurent les arguments.', 'Le raisonnable remplace ici l’évidence absolue qu’on ne trouve pas en matière de valeurs.', 'Ouvrage de référence pour la philosophie du droit et la théorie de l’argumentation.'],
    retenir: 'Pour convaincre, partir de ce que l’auditoire admet déjà, et justifier ses choix par des raisons que d’autres peuvent examiner.',
    en: 'A 1958 landmark that revives rhetoric as a theory of argument aimed at an audience’s adherence rather than proof.', q: []
  },
  {
    id: 'made-to-stick', t: 'Made to Stick', a: 'Chip Heath et Dan Heath', y: '2007', c: 'Art de la rhétorique', l: ['en'], pd: false,
    th: ['message', 'communication', 'mémorisation', 'histoires', 'idées', 'storytelling', 'pédagogie', 'sticky ideas'],
    idee: 'Pourquoi certaines idées se retiennent et se transmettent-elles ? Les frères Heath proposent six qualités, résumées par le sigle SUCCESs.',
    pts: ['Simple : aller à l’essentiel.', 'Inattendu : surprendre pour éveiller l’attention.', 'Concret : s’appuyer sur des images et des exemples sensoriels.', 'Crédible : fournir de quoi y croire, par des détails ou des témoignages.', 'Émotionnel : toucher ; et raconter des histoires, qui donnent envie d’agir.'],
    retenir: 'Avant de présenter une idée : la résumer en une phrase, puis choisir un exemple concret.',
    en: 'The Heath brothers’ six principles — Simple, Unexpected, Concrete, Credible, Emotional, Stories — for making ideas memorable.', q: []
  },
  {
    id: 'talk-like-ted', t: 'Talk Like TED', a: 'Carmine Gallo', y: '2014', c: 'Art de la rhétorique', l: ['en'], pd: false,
    th: ['prise de parole', 'conférence', 'présentation', 'storytelling', 'TED', 'public speaking', 'confiance', 'émotion'],
    idee: 'Analyse de conférences TED très suivies pour en tirer neuf pratiques de prise de parole : passion, histoires, nouveauté, brièveté.',
    pts: ['Parler d’un sujet qui nous passionne et qui touche le public.', 'Raconter des histoires personnelles ou réelles pour émouvoir et faire comprendre.', 'Apporter une information nouvelle ou une manière nouvelle de voir.', 'Garder des moments marquants, un peu d’humour et un format court (autour de 18 minutes).', 'Rester soi-même et répéter longuement avant la scène.'],
    retenir: 'Une prise de parole mémorable combine un message clair, une émotion juste et beaucoup de préparation.',
    en: 'Gallo’s nine public-speaking practices drawn from popular TED talks: passion, stories, novelty, brevity and authenticity.', q: []
  }
]

// ---------------------------------------------------------------- recherche interne
/** Texte indexé (sans accents ni majuscules) en trois niveaux : titre et auteur, thèmes et catégorie, contenu. */
interface Idx { head: string; mid: string; body: string }
const IDX = new Map<string, Idx>(BOOKS.map(b => [b.id, {
  head: norm(b.t + ' ' + (b.alt ?? '') + ' ' + b.a),
  mid: norm(b.c + ' ' + b.th.join(' ') + ' ' + b.l.join(' ') + ' ' + (b.l.includes('fr') ? 'français' : '') + ' ' + (b.l.includes('en') ? 'anglais english' : '')),
  body: norm(b.idee + ' ' + b.pts.join(' ') + ' ' + b.retenir + ' ' + b.en + ' ' + b.q.map(q => q.t + ' ' + q.r).join(' ') + ' ' + b.y)
}]))
export interface Hit { b: Book; score: number }
/** Recherche instantanée dans la bibliothèque : tous les mots saisis doivent apparaître (titre, auteur, thème, mot-clé, langue, contenu) ; titre et auteur passent en premier. */
export function searchBooksLocal(q: string, cat: BCat | '', lang: Lang | ''): Hit[] {
  const ts = terms(q), out: Hit[] = []
  for (const b of BOOKS) {
    if ((cat && b.c !== cat) || (lang && !b.l.includes(lang))) continue
    const x = IDX.get(b.id)!
    if (!matches(x.head + ' ' + x.mid + ' ' + x.body, ts)) continue
    const score = ts.reduce((s, t) => s + (x.head.includes(t) ? 4 : 0) + (x.mid.includes(t) ? 2 : 0) + (x.body.includes(t) ? 1 : 0), 0)
    out.push({ b, score })
  }
  return ts.length ? out.sort((a, b) => b.score - a.score) : out
}

// ---------------------------------------------------------------- liens légaux
export interface BookLink { k: 'read' | 'listen' | 'find'; label: string; url: string }
/** Domaines des liens du catalogue intégré : ceux des catalogues en ligne (BOOK_HOSTS) et BibleGateway pour la Bible Louis Segond (domaine public). */
export const LINK_HOSTS = [...BOOK_HOSTS, 'biblegateway.com'] as const
const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+')
/**
 * Liens légaux d'un livre : lecture libre (domaine public) ou recherche dans des catalogues autorisés. Seuls les numéros Gutenberg et les chapitres dont la page a été vérifiée
 * sont des liens directs ; les autres sont des recherches. Un livre encore protégé n'a jamais de lien de téléchargement : seulement une recherche d'édition ou d'emprunt.
 */
export function bookLinks(b: Book): BookLink[] {
  const q = enc(b.t + ' ' + b.a.split(',')[0]), out: BookLink[] = []
  if (b.pd) {
    if (b.bg) out.push({ k: 'read', label: 'Lire en français (Louis Segond 1910) : BibleGateway, ' + b.bg, url: 'https://www.biblegateway.com/passage/?search=' + enc(b.bg) + '&version=LSG' })
    if (b.gu) out.push({ k: 'read', label: b.c === 'Biblique' ? 'Lire en anglais (King James) : Project Gutenberg' : 'Lire gratuitement (texte anglais) : Project Gutenberg', url: 'https://www.gutenberg.org/ebooks/' + b.gu })
    else if (!b.lib) out.push({ k: 'find', label: 'Chercher sur Project Gutenberg', url: 'https://www.gutenberg.org/ebooks/search/?query=' + q })
    if (b.lib) out.push({ k: 'read', label: 'Lire gratuitement (texte anglais) : MIT Internet Classics Archive', url: b.lib })
    if (b.l.includes('fr') && !b.bg) out.push({ k: 'find', label: 'Chercher le texte français sur Wikisource', url: 'https://fr.wikisource.org/w/index.php?search=' + q })
    out.push({ k: 'listen', label: 'Chercher une version audio libre (LibriVox, via Internet Archive)', url: 'https://archive.org/search?query=' + enc('librivox ' + (b.alt ?? b.t)) })
  } else out.push({ k: 'find', label: 'Trouver une édition ou l’emprunter (Open Library)', url: 'https://openlibrary.org/search?q=' + q })
  return out.filter(l => safeUrl(l.url, LINK_HOSTS))
}
/** Titre anglais des livres dont le titre principal est français (utilisé pour la lecture vocale en anglais). */
const TE: Record<string, string> = {
  'les-miserables': 'Les Misérables', candide: 'Candide, or Optimism', 'monte-cristo': 'The Count of Monte Cristo', 'petit-prince': 'The Little Prince', 'marc-aurele': 'Meditations',
  frankl: 'Man’s Search for Meaning', 'quatre-accords': 'The Four Agreements', 'la-boetie': 'Discourse on Voluntary Servitude', 'le-bon': 'The Crowd',
  psaumes: 'The Book of Psalms', proverbes: 'The Book of Proverbs', ecclesiaste: 'Ecclesiastes', jean: 'The Gospel of John', 'sermon-montagne': 'The Sermon on the Mount', romains: 'The Epistle to the Romans',
  'aristote-rhetorique': 'Rhetoric', 'cicero-orateur': 'On the Orator', quintilien: 'Institutio Oratoria', schopenhauer: 'The Art of Being Right', perelman: 'The New Rhetoric'
}
/** Titre en anglais : le titre principal si le livre est d'abord anglais, sinon la traduction usuelle. */
export const enTitle = (b: Book): string => (b.l[0] === 'en' ? b.t : TE[b.id] ?? b.t)
/** Texte lu à voix haute pour un livre de la bibliothèque : résumé complet en français, ou phrase de présentation en anglais. */
export const readAloud = (b: Book, lang: Lang): { text: string; tag: string } =>
  lang === 'fr' ? { text: b.t + ', de ' + b.a + '. ' + b.idee + ' ' + b.pts.join(' ') + ' ' + b.retenir, tag: 'fr-FR' } : { text: enTitle(b) + '. ' + b.en, tag: 'en-US' }
export const BOOK_BY_ID = new Map(BOOKS.map(b => [b.id, b]))
