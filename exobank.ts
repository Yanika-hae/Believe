// Banque d'exercices d'éloquence : 72 exercices en 6 familles. Textes originaux (ou virelangues traditionnels et citations du domaine public, avec leur auteur).
export type ExoKind = 'diction' | 'articulation' | 'souffle' | 'figures' | 'repartie' | 'posture'
/** `txt` : texte à lire à voix haute (diction, articulation, souffle), définition et exemple (figures) ou réplique de l'interlocuteur (répartie). `sec` : durée conseillée. */
export interface ExoItem { id: string; k: ExoKind; t: string; how: string[]; txt?: string; sec: number; tip: string }
export const KINDS: Record<ExoKind, string> = { diction: 'Diction', articulation: 'Articulation', souffle: 'Souffle', figures: 'Figures de style', repartie: 'Répartie', posture: 'Posture vocale' }
export const KIND_KEYS = Object.keys(KINDS) as ExoKind[]

const ARR = (id: string, t: string, txt: string, how: string[], sec: number, tip: string): ExoItem => ({ id, k: 'articulation', t, txt, how, sec, tip })
const DI = (id: string, t: string, txt: string, how: string[], sec: number, tip: string): ExoItem => ({ id, k: 'diction', t, txt, how, sec, tip })
const FI = (id: string, t: string, txt: string, how: string[], sec: number, tip: string): ExoItem => ({ id, k: 'figures', t, txt, how, sec, tip })
const RE = (id: string, t: string, txt: string, how: string[], sec: number, tip: string): ExoItem => ({ id, k: 'repartie', t, txt, how, sec, tip })
const SO = (id: string, t: string, how: string[], sec: number, tip: string, txt?: string): ExoItem => ({ id, k: 'souffle', t, how, sec, tip, ...(txt ? { txt } : {}) })
const PO = (id: string, t: string, how: string[], sec: number, tip: string): ExoItem => ({ id, k: 'posture', t, how, sec, tip })

const TWIST = ['Lisez lentement, en articulant chaque syllabe.', 'Accélérez par paliers, sans vous tromper.', 'Dès que vous butez, revenez à la vitesse précédente : la précision vient avant la vitesse.']
const AAR = ['Imaginez la scène et entendez la réplique ci-dessus.', 'Répondez à voix haute en 20 à 30 secondes : accueillez (« Je comprends… »), recentrez (sur les faits ou le sujet), puis répondez en une ou deux phrases.', 'Recommencez plus calmement, puis avec une touche d’humour bienveillant. Évitez l’ironie qui blesse.']
const RESP = 'Respirez avant de répondre : une seconde de silence donne de la force à ce que vous dites.'

export const EXOS: ExoItem[] = [
  // ---------------------------------------------------------------- diction
  DI('di01', 'Les pauses qui donnent du sens', 'Parler, ce n’est pas courir. Chaque idée mérite son souffle : je m’arrête, je respire, puis je continue. Le silence, bien placé, parle aussi.',
    ['Lisez le texte lentement, à voix haute.', 'Marquez une vraie pause à chaque point (comptez « un » dans votre tête) et une demi-pause à chaque virgule.', 'Recommencez en gardant le même calme, sans accélérer.'], 90, 'Un auditeur retient mieux ce qui est suivi d’une pause.'),
  DI('di02', 'Chaque mot compte', 'Un mot dit trop vite se perd ; un mot bien posé arrive jusqu’au fond de la salle.',
    ['Lisez en détachant chaque mot, comme si vous les posiez un à un.', 'Relisez en les reliant naturellement, sans les écraser.', 'Comparez les deux lectures et gardez la plus claire.'], 60, 'Visez la clarté plutôt que la vitesse.'),
  DI('di03', 'Des voyelles pleines', 'La lune claire éclaire la mer ; le vent léger lève les voiles.',
    ['Lisez en donnant à chaque voyelle toute sa durée.', 'Gardez la bouche bien ouverte sur les « a » et les « è ».', 'Relisez à vitesse normale en gardant cette netteté.'], 75, 'Des voyelles tenues rendent la voix pleine.'),
  DI('di04', 'Des consonnes nettes', 'Le temps trace sa route : chaque minute compte, chaque pas construit.',
    ['Lisez en faisant bien sentir les « t », « p », « k » et « c ».', 'Sentez la pointe de la langue et les lèvres travailler.', 'Relisez sans exagérer : la netteté doit rester naturelle.'], 75, 'Une consonne précise vaut mieux qu’une voix forte.'),
  DI('di05', 'La phrase qui monte et qui descend', 'Vous pensez que c’est impossible ? C’est pourtant ce que nous allons faire.',
    ['Montez légèrement la voix à la fin de la question.', 'Redescendez sur l’affirmation pour conclure avec assurance.', 'Évitez de monter à la fin d’une affirmation : cela ressemble à un doute.'], 60, 'Une phrase qui descend à la fin paraît sûre d’elle.'),
  DI('di06', 'Ralentir d’un cinquième', 'Quand je ralentis, ma voix devient plus posée, mes idées plus claires et mon public plus attentif.',
    ['Lisez à votre vitesse habituelle.', 'Relisez en ralentissant d’un cinquième environ.', 'Écoutez la différence : le second passage paraît souvent plus sûr de lui.'], 90, 'Quand on est stressé, on parle plus vite qu’on ne le croit.'),
  DI('di07', 'Le mot important', 'Je n’ai pas dit qu’il avait volé mon argent.',
    ['Lisez la phrase plusieurs fois en appuyant à chaque fois sur un mot différent : je, dit, il, volé, mon, argent.', 'Remarquez comme le sens change selon le mot accentué.', 'Avant chaque phrase importante d’un discours, choisissez le mot à mettre en valeur.'], 120, 'L’accent donne le sens, pas seulement le volume.'),
  DI('di08', 'Lire une liste sans monotonie', 'Il nous faut du courage, de la patience, de la méthode et du temps.',
    ['Montez légèrement la voix sur chaque élément de la liste.', 'Descendez franchement sur le dernier pour conclure.', 'Marquez une petite pause après chaque virgule.'], 60, 'Une liste lue sur un seul ton endort ; une liste qui monte puis descend retient l’attention.'),
  DI('di09', 'Les liaisons', 'Les enfants ont aimé ces histoires amusantes et leurs aventures incroyables.',
    ['Lisez en faisant les liaisons naturelles : « les enfants », « ces histoires », « leurs aventures ».', 'Ne faites pas de liaison après « et » : on dit « et / leurs aventures ».', 'Relisez avec un rythme fluide, sans appuyer les liaisons.'], 75, 'Jamais de liaison après « et ».'),
  DI('di10', 'Du murmure à la salle', 'Un secret murmuré s’entend de près ; une idée portée s’entend de loin.',
    ['Lisez d’abord en chuchotant, avec une articulation très nette.', 'Lisez ensuite à voix de conversation.', 'Lisez enfin comme si vous parliez à quelqu’un au fond d’une salle, sans crier.'], 120, 'Projeter la voix, c’est la porter, pas la forcer.'),
  DI('di11', 'Le début qui accroche', 'Imaginez un instant que demain, tout soit possible.',
    ['Prononcez cette phrase d’ouverture avec calme, en regardant un point précis devant vous.', 'Gardez le silence deux secondes après la phrase.', 'Recommencez trois fois en variant légèrement le ton.'], 60, 'Une ouverture lente et calme installe l’attention.'),
  DI('di12', 'La fin qui reste', 'Voilà ce que je voulais vous dire. Maintenant, à vous de jouer.',
    ['Dites la dernière phrase en ralentissant légèrement.', 'Baissez la voix sur le dernier mot, puis gardez le silence deux secondes.', 'Observez : une fin posée donne de l’autorité.'], 60, 'Ne vous excusez pas à la fin : terminez sur votre idée la plus forte.'),

  // ---------------------------------------------------------------- articulation
  ARR('ar01', 'Les chaussettes de l’archiduchesse', 'Les chaussettes de l’archiduchesse sont-elles sèches, archi-sèches ?', TWIST, 90, 'Dites-la dix fois de suite sans accrocher.'),
  ARR('ar02', 'Un chasseur sachant chasser', 'Un chasseur sachant chasser doit savoir chasser sans son chien.', TWIST, 90, 'Gardez les « ch » bien doux et les « s » bien nets.'),
  ARR('ar03', 'Cinq chiens, six chats', 'Cinq chiens chassent six chats.', TWIST, 60, 'Court, mais piégeux : gardez un rythme régulier.'),
  ARR('ar04', 'Papier, panier, piano', 'Papier, panier, piano. Papier, panier, piano.', TWIST, 60, 'Les trois « p » demandent des lèvres souples.'),
  ARR('ar05', 'Ton thé t’a-t-il ôté ta toux ?', 'Ton thé t’a-t-il ôté ta toux ?', TWIST, 60, 'Placez bien la pointe de la langue sur les « t ».'),
  ARR('ar06', 'Six scies', 'Si six scies scient six cyprès, six cent six scies scient six cent six cyprès.', TWIST, 90, 'Respirez avant de commencer : la phrase est longue.'),
  ARR('ar07', 'Didon dîna', 'Didon dîna, dit-on, du dos d’un dodu dindon.', TWIST, 75, 'Les « d » demandent une langue précise derrière les dents du haut.'),
  ARR('ar08', 'Les saucissons', 'Combien sont ces six saucissons-ci ? Ces six saucissons-ci sont six sous.', TWIST, 90, 'Ne sifflez pas les « s » : gardez-les doux et brefs.'),
  ARR('ar09', 'Trois gros rats', 'Trois gros rats gris grignotent trois gros grains de riz.', TWIST, 75, 'Faites rouler les « r » sans les forcer.'),
  { id: 'ar10', k: 'articulation', t: 'Le crayon entre les dents', how: ['Placez un crayon propre à l’horizontale entre les dents de devant, sans serrer.', 'Lisez à voix haute un paragraphe de votre choix, lentement et très distinctement.', 'Retirez le crayon et relisez : la bouche travaille plus librement.'], sec: 120, tip: 'Arrêtez si vous ressentez une gêne à la mâchoire.' },
  { id: 'ar11', k: 'articulation', t: 'Échauffement des lèvres', how: ['Faites vibrer vos lèvres comme un petit moteur (« brrr ») pendant dix secondes.', 'Dites « ou – i – ou – i » en exagérant les mouvements, dix fois.', 'Dites « p – t – k » rapidement et distinctement pendant vingt secondes.'], sec: 90, tip: 'Les lèvres souples précisent toute la parole.' },
  { id: 'ar12', k: 'articulation', t: 'Échauffement de la langue', how: ['Dessinez un grand cercle avec la pointe de la langue derrière les lèvres, cinq tours dans chaque sens.', 'Dites « la – la – la » en touchant le palais derrière les dents du haut.', 'Répétez « ta – ka – ta – ka » en accélérant progressivement, sans crispation.'], sec: 90, tip: 'Relâchez la mâchoire entre deux séries.' },

  // ---------------------------------------------------------------- souffle
  SO('so01', 'Respiration abdominale 4-6', ['Asseyez-vous droit ou tenez-vous debout, une main sur le ventre.', 'Inspirez par le nez pendant 4 secondes : le ventre se gonfle doucement.', 'Expirez par la bouche pendant 6 secondes, lentement.', 'Continuez à ce rythme pendant toute la durée.'], 180, 'Si la tête tourne, reprenez une respiration normale.'),
  SO('so02', 'Rythme régulier 5-5', ['Inspirez par le nez pendant 5 secondes.', 'Expirez doucement pendant 5 secondes, sans pause.', 'Gardez ce rythme régulier, soit six respirations par minute.'], 300, 'Un rythme lent et régulier peut aider à se calmer avant de parler en public.'),
  SO('so03', 'Le « s » tenu', ['Inspirez calmement, puis soufflez un « ssss » régulier, sans forcer.', 'Comptez mentalement les secondes jusqu’à la fin du souffle.', 'Reposez-vous quelques respirations, puis recommencez trois fois en cherchant une ou deux secondes de plus.'], 120, 'Ne forcez jamais : arrêtez-vous avant d’être à bout de souffle.'),
  SO('so04', 'Le « f » doux', ['Inspirez par le nez, puis soufflez un « fff » léger et constant.', 'Gardez un filet d’air régulier, comme si vous refroidissiez une boisson.', 'Recommencez cinq fois en vous reposant entre deux essais.'], 90, 'Un souffle régulier vaut mieux qu’un souffle long mais inégal.'),
  SO('so05', 'Compter sur un souffle', ['Inspirez, puis comptez à voix haute « un, deux, trois… » sur une seule expiration.', 'Arrêtez-vous avant de ressentir un manque d’air.', 'Notez jusqu’où vous êtes allé et comparez demain.'], 120, 'Comptez à voix posée, pas à toute vitesse.'),
  SO('so06', 'La phrase longue', ['Lisez la phrase en un seul souffle confortable.', 'Si l’air manque, placez une pause à l’une des virgules et reprenez.', 'Recommencez en gardant une voix stable jusqu’au dernier mot.'], 90, 'Reprendre de l’air à une virgule vaut mieux que finir la phrase dans un souffle.', 'Quand je prends le temps de respirer, je choisis mes mots, je tiens mon rythme, et ceux qui m’écoutent me suivent sans effort.'),
  SO('so07', 'Respiration latérale', ['Posez les mains sur les côtés des côtes.', 'Inspirez en sentant les côtes s’écarter sur les côtés.', 'Expirez lentement en gardant les côtes ouvertes le plus longtemps possible.', 'Continuez à ce rythme.'], 120, 'Gardez les épaules basses et détendues.'),
  SO('so08', 'Respiration en carré', ['Inspirez par le nez pendant 4 secondes.', 'Gardez les poumons pleins pendant 4 secondes.', 'Expirez doucement pendant 4 secondes, puis restez poumons vides pendant 4 secondes.', 'Recommencez le carré à votre rythme.'], 180, 'Si retenir votre souffle vous gêne, raccourcissez les pauses ou supprimez-les.'),
  SO('so09', 'La bougie', ['Imaginez une bougie à trente centimètres devant vous.', 'Soufflez doucement pour la faire vaciller sans l’éteindre, le plus longtemps possible.', 'Reprenez de l’air par le nez et recommencez cinq fois.'], 90, 'Le souffle doit rester doux et constant.'),
  SO('so10', 'La paille', ['Munissez-vous d’une paille et d’un verre d’eau.', 'Soufflez doucement dans la paille pour faire des bulles régulières pendant dix secondes.', 'Faites une pause, puis recommencez cinq fois.'], 120, 'Régularité avant puissance : des petites bulles constantes.'),
  SO('so11', 'Le soupir sonore', ['Inspirez par le nez.', 'Laissez sortir l’air en un long « aaah » détendu, en glissant d’une note aiguë vers une note grave.', 'Répétez cinq fois en relâchant les épaules à chaque fois.'], 90, 'Le soupir détend la gorge : il ne doit pas la serrer.'),
  SO('so12', 'Respirer avant de parler', ['Avant chaque phrase d’un court texte de votre choix, inspirez calmement par le nez.', 'Lisez la phrase en une seule expiration.', 'Marquez une pause respirée avant la suivante.'], 120, 'Respirer avant de parler, c’est déjà commencer à convaincre.'),

  // ---------------------------------------------------------------- figures de style
  FI('fi01', 'L’anaphore', 'Anaphore : répétition d’un mot ou d’un groupe de mots au début de phrases successives. Exemple : « Ici, on apprend. Ici, on tombe. Ici, on se relève. »',
    ['Choisissez un thème (la persévérance, l’amitié, le courage…).', 'Dites à voix haute trois phrases qui commencent par le même groupe de mots.', 'Ajoutez une quatrième phrase, plus forte, pour conclure.'], 150, 'L’anaphore donne du rythme : insistez sur le mot répété.'),
  FI('fi02', 'L’antithèse', 'Antithèse : rapprochement de deux idées opposées pour les faire ressortir. Exemple : « Petit par la taille, grand par le cœur. »',
    ['Pensez à une qualité et à son contraire.', 'Formez trois phrases qui les opposent.', 'Dites-les à voix haute en changeant de ton pour chaque pôle.'], 150, 'Un contraste net se dit avec deux voix différentes.'),
  FI('fi03', 'Comparaison et métaphore', 'Comparaison : avec un outil (« fort comme un chêne »). Métaphore : sans outil de comparaison (« cet homme est un chêne »).',
    ['Choisissez une idée abstraite (le temps, la confiance, l’espoir).', 'Formulez une comparaison avec « comme », puis transformez-la en métaphore.', 'Dites les deux versions à voix haute et gardez la plus parlante.'], 150, 'Une bonne image se voit : choisissez-en une que l’auditoire peut imaginer.'),
  FI('fi04', 'La gradation', 'Gradation : suite de termes d’intensité croissante ou décroissante. Exemple : « Va, cours, vole, et nous venge » (Corneille, Le Cid).',
    ['Choisissez une idée (un effort, une émotion, une décision).', 'Alignez quatre mots ou groupes de mots de plus en plus forts.', 'Dites-les en montant légèrement la voix à chaque étape.'], 120, 'Placez l’élément le plus fort en dernier.'),
  FI('fi05', 'Hyperbole et litote', 'Hyperbole : exagération (« je suis mort de fatigue »). Litote : dire moins pour faire entendre plus (« ce n’est pas mauvais » pour « c’est très bon »).',
    ['Décrivez une journée très chargée avec une hyperbole.', 'Faites ensuite un compliment sincère avec une litote.', 'Dites les deux à voix haute avec le ton qui convient.'], 120, 'L’hyperbole se dit avec énergie, la litote avec retenue.'),
  FI('fi06', 'Le chiasme', 'Chiasme : structure croisée (A-B / B-A). Exemple : « Il faut manger pour vivre, et non pas vivre pour manger » (Molière, L’Avare).',
    ['Choisissez deux mots liés (travail et vie, parler et penser…).', 'Construisez une phrase où ils se retrouvent dans l’ordre inverse.', 'Dites-la lentement, en marquant le milieu de la phrase.'], 150, 'Le chiasme marque les esprits : réservez-le à une idée essentielle.'),
  FI('fi07', 'La question rhétorique', 'Question rhétorique : question posée sans attendre de réponse, pour faire réfléchir. Exemple : « Qui ne rêve pas de liberté ? »',
    ['Choisissez une conviction qui vous tient à cœur.', 'Transformez-la en une question dont la réponse est évidente.', 'Posez-la à voix haute, puis gardez deux secondes de silence.'], 120, 'Une question rhétorique n’en vaut la peine que si elle est suivie d’un silence.'),
  FI('fi08', 'La règle de trois', 'Règle de trois : trois éléments de rythme proche, souvent de plus en plus forts. Exemple : « Je suis venu, j’ai vu, j’ai vaincu » (attribué à Jules César).',
    ['Choisissez un message important.', 'Exprimez-le en trois éléments courts et rythmés.', 'Ralentissez sur le troisième, le plus fort.'], 120, 'Trois, c’est assez pour être complet et assez court pour être retenu.'),
  FI('fi09', 'La personnification', 'Personnification : attribuer des traits humains à une chose ou à une idée. Exemple : « La fortune sourit aux audacieux. »',
    ['Choisissez une idée (le temps, la peur, l’espoir).', 'Faites-en un personnage qui agit ou qui parle, en une ou deux phrases.', 'Dites ces phrases en donnant une voix à votre personnage.'], 120, 'Un personnage qui agit se retient mieux qu’une idée abstraite.'),
  FI('fi10', 'L’oxymore', 'Oxymore : association de deux mots de sens contraire. Exemple : « cette obscure clarté » (Corneille, Le Cid).',
    ['Cherchez deux oxymores (un silence assourdissant, une douce violence…).', 'Intégrez chacun dans une phrase qui a du sens pour vous.', 'Dites les phrases en marquant légèrement la rencontre des deux mots.'], 120, 'Un oxymore doit surprendre sans perdre son sens.'),
  FI('fi11', 'La prétérition', 'Prétérition : annoncer qu’on ne parlera pas d’une chose pour en parler quand même. Exemple : « Je ne vous rappellerai pas ses retards, ni ses oublis… »',
    ['Choisissez un sujet sensible, sans nommer de personne réelle.', 'Formez une phrase qui annonce que vous n’en parlerez pas, puis qui en parle.', 'Dites-la avec un ton neutre et un léger sourire.'], 120, 'Utilisez-la avec bienveillance : elle peut vite devenir une pique.'),
  FI('fi12', 'L’accumulation', 'Accumulation : énumération de termes qui insiste sur une idée. Exemple : « Il faut du courage, de la patience, de la rigueur, du temps. »',
    ['Choisissez une idée à renforcer.', 'Alignez cinq éléments, du plus court au plus long.', 'Dites-les sans reprendre votre souffle avant le dernier.'], 120, 'Variez la longueur des éléments pour éviter la monotonie.'),

  // ---------------------------------------------------------------- répartie
  RE('re01', 'On vous coupe la parole', '« Oui, oui, mais laissez-moi vous interrompre… »', AAR, 90, RESP),
  RE('re02', 'Un reproche injuste', '« Tu ne fais jamais attention à ce que je dis. »', AAR, 90, RESP),
  RE('re03', 'Une question piège', '« Alors, vous n’avez aucune solution à proposer ? »', AAR, 90, RESP),
  RE('re04', 'Votre idée est critiquée en public', '« Votre idée me semble totalement irréaliste. »', AAR, 90, RESP),
  RE('re05', 'Un compliment embarrassant', '« Vous, au moins, vous êtes toujours parfait ! »', AAR, 90, RESP),
  RE('re06', 'Une moquerie amicale', '« Encore en retard, comme d’habitude ! »', AAR, 90, RESP),
  RE('re07', 'Dire non poliment', '« Tu peux me rendre un petit service ce week-end ? Ça te prendra trois heures. »', ['Imaginez la scène et entendez la demande ci-dessus.', 'Refusez à voix haute en 20 secondes : remerciez pour la confiance, dites non clairement, proposez éventuellement une alternative.', 'Recommencez en évitant de vous justifier longuement : un refus court est plus clair.'], 90, RESP),
  RE('re08', 'Une question dont vous ignorez la réponse', '« Et quel est le chiffre exact, selon vous ? »', ['Imaginez la scène et entendez la question ci-dessus.', 'Répondez à voix haute en 20 secondes : reconnaissez que vous ne savez pas, dites ce que vous savez, proposez de revenir avec la réponse.', 'Recommencez avec une voix sûre : avouer ses limites calmement inspire confiance.'], 90, RESP),
  RE('re09', 'Quelqu’un hausse le ton', '« Mais enfin, c’est inadmissible ! »', ['Imaginez la scène et entendez la réplique ci-dessus.', 'Répondez à voix haute en baissant volontairement le ton et le rythme, en 20 à 30 secondes.', 'Recommencez en nommant calmement ce que vous percevez (« Je vois que c’est important pour vous ») avant de répondre.'], 90, RESP),
  RE('re10', 'On vous interrompt pendant une présentation', '« Pardon, je peux poser une question tout de suite ? »', AAR, 90, RESP),
  RE('re11', 'On remet en cause votre compétence', '« Vous êtes sûr que vous savez de quoi vous parlez ? »', AAR, 90, RESP),
  RE('re12', 'Un silence gênant', '(Vous venez de poser une question. Personne ne répond.)', ['Imaginez la salle silencieuse après votre question.', 'Comptez cinq secondes dans votre tête sans rien dire, en regardant tranquillement l’auditoire.', 'Relancez à voix haute avec une phrase courte (« Prenez votre temps » ou une question plus simple), puis attendez encore.'], 90, 'Le silence paraît plus long à celui qui parle qu’à celui qui écoute.'),

  // ---------------------------------------------------------------- posture vocale
  PO('po01', 'L’ancrage', ['Debout, placez les pieds à la largeur du bassin, genoux légèrement souples.', 'Répartissez le poids sur les deux pieds et relâchez les épaules.', 'Dites « Bonjour, je m’appelle… et je vais vous parler de… » en restant stable.'], 90, 'Une posture stable donne une voix stable.'),
  PO('po02', 'Nuque et épaules', ['Roulez les épaules vers l’arrière dix fois.', 'Inclinez doucement la tête à droite puis à gauche, sans forcer.', 'Redressez-vous, menton parallèle au sol, et dites une phrase de votre choix.'], 90, 'Aucune douleur ne doit apparaître : arrêtez si c’est le cas.'),
  PO('po03', 'Le fil sur la tête', ['Imaginez un fil qui tire doucement le sommet de votre crâne vers le plafond.', 'Laissez le menton parallèle au sol et la nuque longue.', 'Dites une phrase en gardant cette sensation de hauteur.'], 60, 'Se grandir sans se raidir.'),
  PO('po04', 'Assis ou debout', ['Lisez un court paragraphe assis, le dos voûté.', 'Relisez-le assis bien droit, puis debout.', 'Comparez la place du souffle et la netteté de la voix.'], 120, 'La voix aime les côtes libres : redressez-vous avant de parler.'),
  PO('po05', 'Porter sans crier', ['Choisissez un point au fond de la pièce.', 'Dites une phrase comme si vous vouliez qu’elle y arrive, sans serrer la gorge.', 'Appuyez-vous sur le souffle plutôt que sur la gorge : la voix gagne en portée sans fatigue.'], 90, 'Si la gorge brûle, vous forcez : diminuez et reprenez.'),
  PO('po06', 'La zone de votre voix', ['Fredonnez « mmm » sur une note confortable, bouche fermée.', 'Ouvrez la bouche en gardant la même hauteur et dites « Bonjour à tous ».', 'Parlez ensuite dans cette zone pendant une minute.'], 90, 'Une voix posée est souvent plus grave que celle du stress.'),
  PO('po07', 'Trois volumes', ['Lisez une phrase en chuchotant.', 'Relisez-la à voix de conversation, puis comme si vous parliez à une petite salle.', 'Choisissez le volume adapté à votre prochain discours.'], 120, 'Le volume juste se règle sur l’auditoire, pas sur l’émotion.'),
  PO('po08', 'Le regard', ['Lisez un texte en levant les yeux à chaque fin de phrase.', 'Fixez un point imaginaire (un auditeur) pendant une phrase entière.', 'Changez de point à chaque nouvelle idée.'], 120, 'Un regard posé suffit à rassurer l’auditoire comme vous-même.'),
  PO('po09', 'Les mains', ['Parlez en gardant les mains visibles, à hauteur de la taille.', 'Accompagnez une idée importante par un seul geste ample.', 'Revenez à la position neutre et laissez la phrase finir sans geste.'], 90, 'Un geste ample vaut mieux que dix petits gestes agités.'),
  PO('po10', 'Le sourire dans la voix', ['Dites « Bonjour, ravi de vous voir » sans sourire.', 'Redites la phrase en souriant légèrement.', 'Écoutez la différence : la voix paraît plus chaleureuse.'], 60, 'Souriez avec les yeux autant qu’avec la bouche.'),
  PO('po11', 'La sirène', ['Dites « ou » en glissant doucement du grave à l’aigu, puis de l’aigu au grave, comme une sirène.', 'Gardez le son léger, sans forcer dans les aigus.', 'Répétez cinq fois et terminez par une phrase parlée.'], 90, 'Arrêtez si la gorge est irritée.'),
  PO('po12', 'Le calme avant de parler', ['Posez vos pieds, relâchez vos épaules et inspirez calmement.', 'Attendez deux secondes en regardant votre public.', 'Commencez par une phrase courte.'], 60, 'Les deux premières secondes de silence disent « j’ai le temps ».')
]
