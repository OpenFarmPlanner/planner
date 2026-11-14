# Translation glossary (DE / EN / FR / ES / IT / PT / NL)

Binding terminology for every OpenFarmPlanner translation: locale bundles
(`frontend/src/i18n/locales/<code>/`), email templates
(`backend/accounts/templates/accounts/emails/<code>/`) and the legal texts.
A new or changed string must use the term listed here; if a concept is
missing, add it here in the same change.

- **Source language for FR, ES, IT, PT and NL is English.** German is the reference for
  meaning: where the English wording is ambiguous or inconsistent (the English
  bundle uses both "Plot" and "Field" for *Parzelle*), the German term decides.
- **Domain register:** vegetable-growing (market-gardening) vocabulary —
  French *maraîchage*, Spanish *horticultura*. Canonical variants are
  **fr-FR** and **es-ES**; regional forms (fr-CA, es-419/es-MX) are not
  separate bundles.
- Terms marked † have no single established translation; the choice is
  deliberate and documented in the notes below the tables. Every other term
  was checked against French and Spanish horticultural sources (chambers of
  agriculture, regional plant-health bulletins, Junta de Andalucía, FAO
  AGROVOC).

Italian is introduced first in #949; PT and NL columns record the agreed
terminology for the following language PRs, not shipped-language availability.
Canonical variants: it-IT, pt-PT (Acordo Ortográfico), nl-NL. Portuguese uses
*sementeira, utilizador, ficheiro, ecrã*; browser pt-BR selects the pt-PT bundle,
never a mixed regional bundle. Formatting and plurals must use pt-PT explicitly.

## Form of address

| Language | App UI, emails | Legal texts (imprint, privacy policy, terms) |
| --- | --- | --- |
| DE | *du* | *Sie* |
| EN | *you* | *you* |
| FR | *vous* throughout | *vous* |
| ES | *tú* | *usted* |
| IT | *tu* | *Lei* |
| PT (pt-PT) | neutral/polite third person, no *você* | third person, *o Utilizador* |
| NL | *je* | *u* |

The provider speaks as **we** everywhere: *wir* / *we* / *nous* /
*nosotros*.

## Short labels (navigation and toggles)

Navigation labels (sidebar, mobile drawer) and segmented toggles use the
**core word**; page titles (topbar, page heading, browser tab) use the
**full term**. Wherever a label is shortened, the full term stays reachable
as the control's `aria-label` and tooltip. Menu labels live in their own
keys (`navigation:short.<key>`), page titles in the existing keys; German
and English currently use the same text for both.

| DE (page title) | FR short / page title | ES short / page title | IT short / page title | PT short / page title | NL short / page title |
| --- | --- | --- | --- | --- | --- |
| Übersicht | Vue d'ensemble / Vue d'ensemble | Resumen / Resumen | Panoramica / Panoramica | Visão geral / Visão geral | Overzicht / Overzicht |
| Anbauflächen | Parcellaire / Surfaces de culture | Superficies / Superficies de cultivo | Superfici / Superfici coltivate | Áreas / Áreas de cultivo | Areaal † / Teeltoppervlakken |
| Kulturen | Cultures / Cultures | Cultivos / Cultivos | Colture / Colture | Culturas / Culturas | Gewassen / Gewassen |
| Kulturbibliothek | Bibliothèque / Bibliothèque de cultures | Biblioteca / Biblioteca de cultivos | Biblioteca / Biblioteca delle colture | Biblioteca / Biblioteca de culturas | Bibliotheek / Gewassenbibliotheek |
| Lieferanten | Fournisseurs / Fournisseurs | Proveedores / Proveedores | Fornitori / Fornitori | Fornecedores / Fornecedores | Leveranciers / Leveranciers |
| Anbaupläne | Plan de culture / Plan de culture | Plan de cultivos / Plan de cultivos | Piano colturale / Piano colturale | Plano de cultivo / Plano de cultivo | Teeltplan / Teeltplan |
| Anbaukalender | Calendrier / Calendrier de culture | Calendario / Calendario de cultivos | Calendario / Calendario colturale | Calendário / Calendário de cultivo | Kalender / Teeltkalender |
| Ertragsübersicht | Rendements / Aperçu des rendements | Rendimientos / Resumen de rendimientos | Rese / Panoramica delle rese | Rendimentos / Visão geral dos rendimentos | Opbrengsten / Opbrengstoverzicht |
| Saatgutbedarf | Semences / Besoin en semences | Semillas / Necesidad de semillas | Sementi / Fabbisogno di sementi | Sementes / Necessidades de sementes | Zaad / Zaadbehoefte |
| Jungpflanzenbedarf | Plants / Besoin en plants | Plantel / Necesidad de plantel | Piantine / Fabbisogno di piantine | Plantas / Necessidades de plantas de viveiro | Plantgoed / Plantgoedbehoefte |
| Feldbelegung (Kalender-Modus) | Occupation / Occupation des parcelles | Ocupación / Ocupación de parcelas | Occupazione / Occupazione degli appezzamenti | Ocupação / Ocupação das parcelas | Bezetting / Perceelbezetting |
| Anzucht (Kalender-Modus) | Pépinière / Pépinière | Semillero / Semillero | Vivaio / Vivaio | Viveiro / Viveiro | Opkweek / Opkweek |

Add actions name only the object: *Ajouter une parcelle*, *Añadir
parcela* — never *Ajouter une nouvelle …* / *Añadir nuevo …* unless the
German says *neu*.

## Typography

- **French:** a narrow no-break space (U+202F) before `:` `?` `!` `;` and
  inside guillemets `« … »`. Quotation marks are `« … »`, never `"…"`.
  Ellipsis `…`.
- **Spanish:** opening `¿` and `¡`; quotation marks `«…»`; no space before
  punctuation.
- Numbers, dates and months are never written into strings; they are
  formatted through `Intl` with the active locale (`fr-FR`, `es-ES`).

## Plurals

i18next selects plural forms through `Intl.PluralRules`. Every pluralized
key needs every category of its language — DE/EN: `_one`, `_other`;
FR/ES/IT: `_one`, `_many`, `_other`. French treats **0 as singular**
(`_one`); FR, ES and IT use `_many` for large round numbers
(1 000 000). Guarded by `src/__tests__/i18nKeyParity.test.ts` and
`src/__tests__/i18nPlurals.test.ts`.

## Structure and areas

| DE | EN | FR | ES | IT | PT (pt-PT) | NL |
| --- | --- | --- | --- | --- | --- | --- |
| Standort | Location | Site | Ubicación | sito | exploração † | locatie |
| Parzelle | Field / Plot | Parcelle | Parcela | appezzamento | parcela | perceel |
| Beet | Bed | Planche | Bancal | aiuola † | canteiro | bed |
| Anbaufläche(n) | Growing area(s) | Surface(s) de culture | Superficie(s) de cultivo | superficie coltivata | área de cultivo | teeltoppervlak |
| Anbauflächen (Gesamtheit, Navigation) | Growing areas | Parcellaire | Superficies | superfici coltivate | áreas de cultivo | teeltoppervlakken |
| Feldplanung (Gantt) | Field planning | Planification des parcelles | Planificación de parcelas | piano degli appezzamenti | planeamento das parcelas | perceelplanning |
| Flächenbelegung | Field occupancy | Occupation des parcelles | Ocupación de parcelas | occupazione degli appezzamenti | ocupação das parcelas | perceelbezetting |
| Projekt | Project | Projet | Proyecto | progetto | projeto | project |
| Mitglied | Member | Membre | Miembro | membro | membro | lid |
| Admin (Rolle) | Admin | Administrateur | Administrador | amministratore | administrador | beheerder |
| Region (Projekt) | Region | Région | Región | regione | região | regio |

## Crops and crop library

| DE | EN | FR | ES | IT | PT (pt-PT) | NL |
| --- | --- | --- | --- | --- | --- | --- |
| Kultur | Crop | Culture | Cultivo | coltura | cultura | gewas |
| Kulturen | Crops | Cultures | Cultivos | colture | culturas | gewassen |
| Sorte | Variety | Variété | Variedad | varietà | variedade | ras |
| Handelsname (Sorte) | Trade name | Nom commercial | Nombre comercial | nome commerciale | nome comercial | handelsnaam |
| Kulturart | Crop species | Espèce cultivée | Especie de cultivo | specie coltivata | espécie cultivada | gewassoort |
| Kulturbibliothek | Crop library | Bibliothèque de cultures | Biblioteca de cultivos | biblioteca delle colture | biblioteca de culturas | gewassenbibliotheek |
| Pflanzenfamilie | Crop family | Famille botanique | Familia botánica | famiglia botanica | família botânica | plantenfamilie |
| Lateinischer Name | Latin name | Nom latin | Nombre latino | nome latino | nome latino | Latijnse naam |
| Tag (eigenes Tag einer Kultur, code: tag) | Tag | Étiquette | Etiqueta | etichetta | etiqueta | tag |
| Lieferant | Supplier | Fournisseur | Proveedor | fornitore | fornecedor | leverancier |
| Anbauart | Cultivation type | Mode de culture | Tipo de cultivo | tipo di coltivazione | tipo de cultivo | teeltwijze |
| Direktsaat | Direct sowing | Semis direct | Siembra directa | semina diretta | sementeira direta | directe zaai |
| Pflanzung (Anbauart) | Transplanting | Plantation | Trasplante | trapianto | transplantação | uitplanten |
| Pflanzung (eigene Anzucht) | Transplant (home-raised) | Plantation (plants autoproduits) | Trasplante (plantel propio) | trapianto di piantine autoprodotte | transplantação de plantas de viveiro próprias | uitplanten van eigen opkweek |
| Pflanzung mit gekauften Pflanzen | Transplant with bought-in plants | Plantation de plants achetés | Trasplante de plantel comprado | trapianto di piantine acquistate | transplantação de plantas compradas | uitplanten van gekocht plantgoed |
| Pfl. Zukauf (short label) | Bought-in | Plant. achat | Trasp. compra | piantine acquistate | plantas compradas | gekocht plantgoed |
| Jungpflanzenbedarf | Young plant demand | Besoin en plants | Necesidad de plantel | fabbisogno di piantine | necessidades de plantas de viveiro † | plantgoedbehoefte |
| Reserve für Ausfälle | Reserve for losses | Réserve pour pertes | Reserva por pérdidas | riserva per le perdite | reserva para perdas | reserve voor uitval |
| Pflanzwoche | Planting week | Semaine de plantation | Semana de trasplante | settimana di trapianto | semana de transplantação | plantweek |
| Anzucht | Propagation | Pépinière † | Semillero † | vivaio † | viveiro † | opkweek |
| Zeitraum (Anzucht-, Direktsaat-, Pflanzungs-) | Time window | Période | Periodo | periodo | período | periode |
| Anzuchtzeitraum | Propagation window | Période de semis en pépinière | Periodo de siembra en semillero | periodo di semina in vivaio | período de sementeira em viveiro | opkweekperiode |
| Direktsaatzeitraum | Direct sowing window | Période de semis direct | Periodo de siembra directa | periodo di semina diretta | período de sementeira direta | directezaaiperiode |
| Pflanzzeitraum | Transplanting window | Période de plantation | Periodo de trasplante | periodo di trapianto | período de transplantação | uitplantperiode |
| Ernte (berechnet) | Harvest (calculated) | Récolte (calculée) | Cosecha (calculada) | raccolta calcolata | colheita calculada | berekende oogst |
| Monatsdrittel (Anfang / Mitte / Ende) | Third of the month (early / mid / late) | Décade (début / mi- / fin) | Decena del mes (principios / mediados / finales) | decade (inizio / metà / fine) | decêndio (início / meados / fim) | maanddeel (begin / midden / eind) |
| Kalenderwoche (KW) | Calendar week (week) | Semaine (sem.) | Semana (sem.) | settimana (sett.) | semana (sem.) | week (wk.) |
| Über den Jahreswechsel | Across the turn of the year | À cheval sur deux années | Abarca el cambio de año | a cavallo di due anni | entre dois anos | over de jaarwisseling |
| Anzuchtdauer | Propagation duration | Durée en pépinière | Duración en semillero | durata in vivaio | duração em viveiro | opkweekduur |
| Kulturdauer / Wachstumszeit | Growth duration | Durée de culture | Duración del cultivo | durata della coltura | duração da cultura | groeiduur |
| Erntedauer / Erntezeit | Harvest duration | Durée de récolte | Duración de la cosecha | durata della raccolta | duração da colheita | oogstduur |
| Pflanzabstand | In-row spacing | Espacement sur le rang | Distancia entre plantas | distanza sulla fila | distância entre plantas | plantafstand |
| Reihenabstand | Row spacing | Espacement entre les rangs | Distancia entre filas | distanza tra le file | distância entre linhas | rijafstand |
| Abstände | Spacing | Espacements | Distancias | distanze | distâncias | afstanden |
| Saatgutbedarf | Seed demand / Seed requirement | Besoin en semences | Necesidad de semillas | fabbisogno di sementi | necessidades de sementes | zaadbehoefte |
| Saatgutmenge | Seed quantity | Quantité de semences | Cantidad de semillas | quantità di sementi | quantidade de sementes | zaadhoeveelheid |
| TKG (Tausendkorngewicht) | TKW (thousand-kernel weight) | PMG (poids de mille grains) | PMS (peso de mil semillas) | peso di mille semi | peso de mil sementes | duizendkorrelgewicht |
| Keimung | Germination | Germination | Germinación | germinazione | germinação | kieming |
| Keimtemperatur optimal (°C) | Optimal germination temperature (°C) | Température optimale de germination (°C) | Temperatura óptima de germinación (°C) | temperatura ottimale di germinazione (°C) | temperatura ótima de germinação (°C) | optimale kiemtemperatuur (°C) |
| Mindestkeimtemperatur (°C) | Minimum germination temperature (°C) | Température min. de germination (°C) | Temperatura mínima de germinación (°C) | temperatura minima di germinazione (°C) | temperatura mínima de germinação (°C) | minimale kiemtemperatuur (°C) |
| Keimdauer (Tage) | Germination time (days) | Durée de germination (jours) | Tiempo de germinación (días) | tempo di germinazione (giorni) | tempo de germinação (dias) | kiemtijd (dagen) |
| Temperaturvorbehandlung | Temperature pretreatment | Prétraitement thermique | Pretratamiento térmico | pretrattamento termico | pré-tratamento térmico | temperatuurvoorbehandeling |
| Kaltstratifikation | Cold stratification | Stratification à froid | Estratificación en frío | stratificazione a freddo | estratificação a frio | koude stratificatie |
| Frostbehandlung | Frost treatment | Traitement par le gel | Tratamiento con heladas | trattamento con gelo | tratamento com geada | vorstbehandeling |
| Lichtbedarf bei der Keimung | Germination light requirement | Lumière à la germination | Luz para la germinación | fabbisogno di luce per la germinazione | necessidade de luz na germinação | lichtbehoefte bij kieming |
| Stratifikationsdauer (Tage) | Stratification duration (days) | Durée de stratification (jours) | Duración de estratificación (días) | durata della stratificazione (giorni) | duração da estratificação (dias) | stratificatieduur (dagen) |
| Stratifikationstemperatur (°C) | Stratification temperature (°C) | Température de stratification (°C) | Temperatura de estratificación (°C) | temperatura di stratificazione (°C) | temperatura de estratificação (°C) | stratificatietemperatuur (°C) |
| Keimverhalten | Germination type | Type de germination | Tipo de germinación | tipo di germinazione | tipo de germinação | kiemgedrag |
| Kaltkeimer | Cold germinator | Germination au froid | Germinación en frío | germinazione al freddo | germinação a frio | koudekiemer |
| Frostkeimer | Frost germinator | Germination après gel | Germinación tras heladas | germinazione dopo il gelo | germinação após geada | vorstkiemer |
| Lichtkeimer | Light germinator | Germination à la lumière | Germinación con luz | germinazione alla luce | germinação à luz | lichtkiemer |
| Dunkelkeimer | Dark germinator | Germination dans l’obscurité | Germinación en oscuridad | germinazione al buio | germinação no escuro | donkerkiemer |
| Vorbehandlung | Pre-treatment | Prétraitement | Tratamiento previo | pretrattamento | pré-tratamento | voorbehandeling |
| Auflaufen | Emergence | Levée | Emergencia | emergenza | emergência | opkomst |
| Keimrate | Germination rate | Taux de germination | Tasa de germinación | tasso di germinazione | taxa de germinação | kiempercentage |
| Nährstoffbedarf | Nutrient demand | Besoins nutritifs | Necesidades de nutrientes | fabbisogno nutritivo | necessidades de nutrientes | voedingsbehoefte |
| Schwach-/Mittel-/Starkzehrer | Light/medium/heavy feeder | Culture peu / moyennement / très exigeante | Cultivo poco / medianamente / muy exigente | coltura poco / mediamente / molto esigente | cultura pouco / moderadamente / muito exigente | lage / gemiddelde / hoge voedingsbehoefte |
| Ertrag | Yield | Rendement | Rendimiento | resa | rendimento | opbrengst |
| Ertragseinheit | Yield unit | Unité de rendement | Unidad de rendimiento | unità di resa | unidade de rendimento | opbrengsteenheid |
| Ertragsübersicht | Yield overview | Aperçu des rendements | Resumen de rendimientos | panoramica delle rese | visão geral dos rendimentos | opbrengstoverzicht |
| Fruchtfolge | Crop rotation | Rotation des cultures | Rotación de cultivos | rotazione colturale | rotação de culturas | vruchtwisseling |
| Anbaupause / Familienpause | Rotation break | Délai de retour | Pausa de rotación † | intervallo di rotazione | intervalo de rotação | rotatiepauze |
| Mischkultur | Companion planting | Association de cultures | Asociación de cultivos | consociazione | consociação | combinatieteelt |
| Guter / schlechter Nachbar | Good / bad neighbor | Bon / mauvais voisin | Buen / mal vecino | buon / cattivo vicino | bom / mau vizinho | goede / slechte buur |
| Kulturbibliothek-Eintrag | Library entry | Fiche de la bibliothèque | Ficha de la biblioteca | voce della biblioteca | entrada da biblioteca | bibliotheekitem |
| Synonym | Synonym | Synonyme | Sinónimo | sinonimo | sinónimo | synoniem |

## Planning

| DE | EN | FR | ES | IT | PT (pt-PT) | NL |
| --- | --- | --- | --- | --- | --- | --- |
| Anbauplan (Eintrag) | Planting plan | Série † | Serie † | serie † | série † | teelt † |
| Anbaupläne (Einträge) | Planting plans | Séries | Series | serie | séries | teelten |
| Anbaupläne (Seite, Gesamtplanung) | Planting plans | Plan de culture | Plan de cultivos | piano colturale | plano de cultivo | teeltplan |
| Anbaukalender | Crop calendar | Calendrier de culture | Calendario de cultivos | calendario colturale | calendário de cultivo | teeltkalender |
| Saison | Season | Saison | Temporada | stagione | época † | seizoen |
| Saison-Muster | Season pattern | Modèle de saison | Patrón de temporada | modello di stagione | modelo de época | seizoenspatroon |
| Pflanztermin | Planting date | Date de plantation | Fecha de plantación | data di trapianto | data de transplantação | plantdatum |
| Aussaat / Aussaattermin | Sowing / sowing date | Semis / date de semis | Siembra / fecha de siembra | semina / data di semina | sementeira / data de sementeira | zaai / zaaidatum |
| Erntebeginn | Harvest start | Début de récolte | Inicio de cosecha | inizio della raccolta | início da colheita | begin oogst |
| Ernteende | Harvest end | Fin de récolte | Fin de cosecha | fine della raccolta | fim da colheita | einde oogst |
| Ernte | Harvest | Récolte | Cosecha | raccolta | colheita | oogst |
| Satz (Folgesatz) | Succession | Série | Serie | serie successiva | série sucessiva | opvolgende teelt |
| Vorkultur | Previous crop | Culture précédente | Cultivo anterior | coltura precedente | cultura anterior | voorteelt |
| Folgekultur | Follow-up crop | Culture suivante | Cultivo siguiente | coltura successiva | cultura seguinte | nateelt |
| Ernteüberlappung | Harvest overlap | Chevauchement de récolte | Solapamiento de cosecha | sovrapposizione delle raccolte | sobreposição de colheitas | oogstoverlap |
| Anbauplanung (Einstellungen) | Crop planning | Planification des cultures | Planificación de cultivos | pianificazione colturale | planeamento de culturas | teeltplanning |
| Pflanzen (Anzahl) | Plants | Plants | Plantas | piante | plantas | planten |
| Aufgabe | Task | Tâche | Tarea | attività | tarefa | taak |

## Community and moderation

| DE | EN | FR | ES | IT | PT (pt-PT) | NL |
| --- | --- | --- | --- | --- | --- | --- |
| Moderation | Moderation | Modération | Moderación | moderazione | moderação | moderatie |
| Moderator:in | Moderator | Modérateur | Moderador | moderatore | moderador | moderator |
| veröffentlichen | publish | publier | publicar | pubblicare | publicar | publiceren |
| Vorschlag / Änderungsvorschlag | Proposal / change proposal | Proposition / proposition de modification | Propuesta / propuesta de cambio | proposta / proposta di modifica | proposta / proposta de alteração | voorstel / wijzigingsvoorstel |
| Änderung vorschlagen | Suggest change | Proposer une modification | Proponer un cambio | proporre una modifica | sugerir alteração | wijziging voorstellen |
| Einladung | Invitation | Invitation | Invitación | invito | convite | uitnodiging |
| Rückmeldung (Feedback) | Feedback | Retour | Comentarios | feedback | comentários | feedback |
| GeLaWi / SoLaWi (Gemeinschaftsgetragene / Solidarische Landwirtschaft) | CSA (community-supported agriculture) | agriculture soutenue par la communauté (ASC); in France: AMAP | agricultura sostenida por la comunidad (ASC) | agricoltura sostenuta dalla comunità (CSA) | agricultura apoiada pela comunidade (CSA) | gemeenschapslandbouw (CSA) |
| Gemüsebau / Gemüseanbau | Vegetable growing | Maraîchage | Horticultura | orticoltura | horticultura | groenteteelt |
| Gärtnerei / Betrieb | Farm | Ferme maraîchère / exploitation | Explotación hortícola / finca | azienda orticola | exploração hortícola | tuinderij |

## Account and app

| DE | EN | FR | ES | IT | PT (pt-PT) | NL |
| --- | --- | --- | --- | --- | --- | --- |
| Konto | Account | Compte | Cuenta | account | conta | account |
| Anmelden | Sign in | Se connecter | Iniciar sesión | accedere | iniciar sessão | aanmelden |
| Registrieren | Register | S'inscrire | Registrarse | registrarsi | registar-se | registreren |
| Abmelden | Sign out | Se déconnecter | Cerrar sesión | uscire | terminar sessão | afmelden |
| Passwort | Password | Mot de passe | Contraseña | password | palavra-passe | wachtwoord |
| Einstellungen | Settings | Paramètres | Ajustes | impostazioni | definições | instellingen |
| Sprache | Language | Langue | Idioma | lingua | idioma | taal |
| Rückgängig | Undo | Annuler | Deshacer | annullare | anular | ongedaan maken |
| Speichern | Save | Enregistrer | Guardar | salvare | guardar | opslaan |
| Abbrechen | Cancel | Annuler | Cancelar | annullare | cancelar | annuleren |
| Löschen | Delete | Supprimer | Eliminar | eliminare | eliminar | verwijderen |
| Verlauf | History | Historique | Historial | cronologia | histórico | geschiedenis |
| Startseite | Home | Accueil | Inicio | pagina iniziale | página inicial | startpagina |
| Übersicht (Dashboard) | Dashboard | Tableau de bord | Panel | panoramica | visão geral | overzicht |

## Legal

| DE | EN | FR | ES | IT | PT (pt-PT) | NL |
| --- | --- | --- | --- | --- | --- | --- |
| Impressum | Legal notice | Mentions légales | Aviso legal | note legali | aviso legal | juridische informatie |
| Datenschutzerklärung | Privacy policy | Politique de confidentialité | Política de privacidad | informativa sulla privacy | política de privacidade | privacyverklaring |
| Nutzungsbedingungen | Terms of use | Conditions d'utilisation | Términos de uso | condizioni d'uso | termos de utilização | gebruiksvoorwaarden |
| DSGVO | GDPR | RGPD | RGPD | GDPR | RGPD | AVG |
| Verantwortlicher | Controller | Responsable du traitement | Responsable del tratamiento | titolare del trattamento | responsável pelo tratamento | verwerkingsverantwoordelijke |
| Auftragsverarbeiter | Processor | Sous-traitant | Encargado del tratamiento | responsabile del trattamento | subcontratante | verwerker |
| betroffene Person | Data subject | Personne concernée | Interesado | interessato | titular dos dados | betrokkene |
| berechtigtes Interesse | Legitimate interest | Intérêt légitime | Interés legítimo | legittimo interesse | interesse legítimo | gerechtvaardigd belang |
| Einwilligung | Consent | Consentement | Consentimiento | consenso | consentimento | toestemming |
| Aufsichtsbehörde | Supervisory authority | Autorité de contrôle | Autoridad de control | autorità di controllo | autoridade de controlo | toezichthoudende autoriteit |
| Stand | Last updated | Dernière mise à jour | Última actualización | ultimo aggiornamento | última atualização | laatst bijgewerkt |
| maßgeblich (Sprachfassung) | prevails | fait foi | prevalece | prevale | prevalece | is doorslaggevend |

### Citations and content of the legal texts

- **One citation notation in every language**, including German:
  `Art. 6(1)(f)`, `Art. 7(3)`, `Art. 46(2)(c)`, `Art. 4(2)`, `§ 165(3)`,
  `§ 5 ECG`. Never the German `Abs.`/`lit.`/`Nr.` form, never the
  spelled-out French or Spanish form ("paragraphe 1, point f)"). Only the
  abbreviation of the regulation changes (DSGVO, GDPR, RGPD) and French and
  Spanish write `art.` in lower case inside a sentence.
- **All shipped language versions say the same.** Every paragraph cites the
  same articles and names the same numbers, deadlines, URLs and email
  addresses (guarded by `src/__tests__/legalTextConsistency.test.ts`). A
  change to a legal text is made in all shipped languages in the same commit.

### Notes on terms marked †

- **Série / serie (Anbauplan as an entry):** French market-gardening
  planning (e.g. Qrop) calls one planned planting a *série*; Spanish
  follows with *serie*. The whole planning, and the page, is the *plan de
  culture* / *plan de cultivos* (singular). *Série* also covers the
  succession (*Satz*), since each succession is one entry. Both nouns are
  feminine: *une série supprimée*, *una serie eliminada*.
- **Pépinière / semillero (Anzucht):** the established terms for raising
  transplants; they replace the earlier descriptive *élevage de plants*.
  Durations are *durée en pépinière* / *duración en semillero*, the start
  is *mise en pépinière*.

- **Pausa de rotación (es):** Spanish horticultural sources describe the
  rule ("no repetir la misma familia … años") but have no established single
  term; the form's helper text explains it. French uses the established
  *délai de retour*.
- **CSA:** the general term is *agriculture soutenue par la communauté (ASC)*
  (OQLF, FAO AGROVOC) and *agricultura sostenida por la comunidad (ASC)*
  (Urgenci, MITECO). *AMAP* is the French form of the model and is named
  alongside, never as a translation of an Austrian GeLaWi.

## Seed type (variety trait)

Not to be confused with the supplier seed status below: seed type describes the
variety, seed status describes one supplier's offer.

| DE | EN | FR | ES | IT | PT (pt-PT) | NL |
| --- | --- | --- | --- | --- | --- | --- |
| Saatguttyp | Seed type | Type de semence | Tipo de semilla | tipo di sementi | tipo de sementes | zaadtype |
| Samenfest | Open-pollinated | Reproductible | De polinización abierta | a impollinazione libera | de polinização livre | zaadvast |
| F1-Hybrid | F1 hybrid | Hybride F1 | Híbrido F1 | ibrido F1 | híbrido F1 | F1-hybride |
| Unbekannt | Unknown | Inconnu | Desconocido | sconosciuto | desconhecido | onbekend |

## Site, life cycle and plant health (crop traits)

| DE | EN | FR | ES | IT | PT (pt-PT) | NL |
| --- | --- | --- | --- | --- | --- | --- |
| Standort und Pflanzengesundheit | Site and plant health | Exposition et santé des plantes | Ubicación y sanidad vegetal | sito e salute delle piante | local e saúde das plantas | standplaats en plantgezondheid |
| Lichtbedarf | Light requirement | Besoin en lumière | Necesidad de luz | fabbisogno di luce | necessidade de luz | lichtbehoefte |
| Sonnig / Halbschattig / Schattig | Full sun / Partial shade / Shade | Plein soleil / Mi-ombre / Ombre | Pleno sol / Semisombra / Sombra | pieno sole / mezz'ombra / ombra | pleno sol / meia-sombra / sombra | volle zon / halfschaduw / schaduw |
| Wasserbedarf | Water requirement | Besoin en eau | Necesidad de agua | fabbisogno idrico | necessidade de água | waterbehoefte |
| Lebensdauer | Life cycle | Cycle de vie | Ciclo de vida | ciclo di vita | ciclo de vida | levenscyclus |
| Einjährig / Zweijährig / Mehrjährig | Annual / Biennial / Perennial | Annuelle / Bisannuelle / Vivace | Anual / Bienal / Perenne | annuale / biennale / perenne | anual / bienal / perene | eenjarig / tweejarig / meerjarig |
| Winterhärte | Winter hardiness | Rusticité | Resistencia al frío | resistenza al freddo | resistência ao frio | winterhardheid |
| Winterhart / Mit Winterschutz / Nicht winterhart | Hardy / Hardy with winter protection / Not hardy | Rustique / Rustique avec protection hivernale / Non rustique | Resistente / Resistente con protección invernal / No resistente | resistente al freddo / con protezione invernale / non resistente al freddo | resistente ao frio / com proteção de inverno / não resistente ao frio | winterhard / met winterbescherming / niet winterhard |
| Schädlinge und Krankheiten | Pests and diseases | Ravageurs et maladies | Plagas y enfermedades | parassiti e malattie | pragas e doenças | plagen en ziekten |

Biennial labels remain valid for existing data and import/export. They are not
new choices in the life-cycle selector. Existing values use the localized
suffix “Bestandswert” / “existing value” / “valeur existante” / “valor existente”
and a hint explaining that other edits preserve the value.

## Supplier seed status

| DE | EN | FR | ES | IT | PT (pt-PT) | NL |
| --- | --- | --- | --- | --- | --- | --- |
| Saatgutstatus | Seed status | Statut des semences | Estado de las semillas | stato delle sementi | estatuto das sementes | zaadstatus |
| Bio | Organic | Biologique | Ecológico | biologico | biológico | biologisch |
| Umstellung | In conversion | En conversion | En conversión | in conversione | em conversão | in omschakeling |
| Konventionell | Conventional | Conventionnel | Convencional | convenzionale | convencional | gangbaar |
| Ausnahmegenehmigung | Seed exemption | Dérogation pour les semences | Excepción para las semillas | deroga per le sementi | autorização de derrogação para sementes | zaadontheffing |

## Crop-specific properties

| DE | EN | FR | ES | IT | PT (pt-PT) | NL |
| --- | --- | --- | --- | --- | --- | --- |
| Kochtyp | Cooking type | Type de cuisson | Tipo de cocción | tipo di cottura | tipo de cozedura | kooktype |
| Reifegruppe | Maturity group | Groupe de maturité | Grupo de maduración | gruppo di maturazione | grupo de maturação | rijpheidsgroep |
| Festkochend | Waxy | Chair ferme | Firme | a pasta soda | firme | vastkokend |
| Vorwiegend festkochend | Mostly waxy | Chair plutôt ferme | Mayormente firme | prevalentemente a pasta soda | predominantemente firme | vrij vastkokend |
| Mehligkochend | Floury | Chair farineuse | Harinosa | farinoso | farinhento | kruimig |
| Sehr früh | Very early | Très précoce | Muy precoz | molto precoce | muito precoce | zeer vroeg |
| Früh | Early | Précoce | Precoz | precoce | precoce | vroeg |
| Mittelfrüh | Medium early | Demi-précoce | Semiprecoz | medio-precoce | semiprecoce | middenvroeg |
| Mittelspät | Medium late | Demi-tardive | Semitardía | medio-tardivo | semitardio | middenlaat |
| Spät | Late | Tardive | Tardía | tardivo | tardio | laat |

## Companion note language

| DE | EN | FR | ES | IT | PT (pt-PT) | NL |
| --- | --- | --- | --- | --- | --- | --- |
| Sprache der Nachbarnotizen | Companion note language | Langue des notes de voisinage | Idioma de las notas de asociación | lingua delle note di consociazione | idioma das notas de consociação | taal van combinatieteeltnotities |

Companion notes may include source references as user-written prose. No source
model or automatic translation is implied.

### IT / PT / NL domain review notes (#949)

Terms marked † for domain review: IT *aiuola* (alternative *prosa*), *vivaio*,
*serie*; PT *exploração*, *viveiro*, *plantas de viveiro*, *época*, *série*;
NL *areaal*, *teelt* as one planting-plan entry. These choices distinguish the
whole planning page from one succession; they do not imply database translations.
