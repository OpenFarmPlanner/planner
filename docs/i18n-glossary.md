# Translation glossary (DE / EN / FR / ES)

Binding terminology for every OpenFarmPlanner translation: locale bundles
(`frontend/src/i18n/locales/<code>/`), email templates
(`backend/accounts/templates/accounts/emails/<code>/`) and the legal texts.
A new or changed string must use the term listed here; if a concept is
missing, add it here in the same change.

- **Source language for FR and ES is English.** German is the reference for
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

## Form of address

| Language | App UI, emails | Legal texts (imprint, privacy policy, terms) |
| --- | --- | --- |
| DE | *du* | *Sie* |
| EN | *you* | *you* |
| FR | *vous* throughout | *vous* |
| ES | *tú* | *usted* |

The provider speaks as **we** everywhere: *wir* / *we* / *nous* /
*nosotros*.

## Short labels (navigation and toggles)

Navigation labels (sidebar, mobile drawer) and segmented toggles use the
**core word**; page titles (topbar, page heading, browser tab) use the
**full term**. Wherever a label is shortened, the full term stays reachable
as the control's `aria-label` and tooltip. Menu labels live in their own
keys (`navigation:short.<key>`), page titles in the existing keys; German
and English currently use the same text for both.

| DE (page title) | FR short / page title | ES short / page title |
| --- | --- | --- |
| Übersicht | Vue d'ensemble / Vue d'ensemble | Resumen / Resumen |
| Anbauflächen | Parcellaire / Surfaces de culture | Superficies / Superficies de cultivo |
| Kulturen | Cultures / Cultures | Cultivos / Cultivos |
| Kulturbibliothek | Bibliothèque / Bibliothèque de cultures | Biblioteca / Biblioteca de cultivos |
| Lieferanten | Fournisseurs / Fournisseurs | Proveedores / Proveedores |
| Anbaupläne | Plan de culture / Plan de culture | Plan de cultivos / Plan de cultivos |
| Anbaukalender | Calendrier / Calendrier de culture | Calendario / Calendario de cultivos |
| Ertragsübersicht | Rendements / Aperçu des rendements | Rendimientos / Resumen de rendimientos |
| Saatgutbedarf | Semences / Besoin en semences | Semillas / Necesidad de semillas |
| Jungpflanzenbedarf | Plants / Besoin en plants | Plantel / Necesidad de plantel |
| Feldbelegung (Kalender-Modus) | Occupation / Occupation des parcelles | Ocupación / Ocupación de parcelas |
| Anzucht (Kalender-Modus) | Pépinière / Pépinière | Semillero / Semillero |

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
FR/ES: `_one`, `_many`, `_other`. French treats **0 as singular**
(`_one`); both FR and ES use `_many` for large round numbers
(1 000 000). Guarded by `src/__tests__/i18nKeyParity.test.ts` and
`src/__tests__/i18nPlurals.test.ts`.

## Structure and areas

| DE | EN | FR | ES |
| --- | --- | --- | --- |
| Standort | Location | Site | Ubicación |
| Parzelle | Field / Plot | Parcelle | Parcela |
| Beet | Bed | Planche | Bancal |
| Anbaufläche(n) | Growing area(s) | Surface(s) de culture | Superficie(s) de cultivo |
| Anbauflächen (Gesamtheit, Navigation) | Growing areas | Parcellaire | Superficies |
| Feldplanung (Gantt) | Field planning | Planification des parcelles | Planificación de parcelas |
| Flächenbelegung | Field occupancy | Occupation des parcelles | Ocupación de parcelas |
| Projekt | Project | Projet | Proyecto |
| Mitglied | Member | Membre | Miembro |
| Admin (Rolle) | Admin | Administrateur | Administrador |
| Region (Projekt) | Region | Région | Región |

## Crops and crop library

| DE | EN | FR | ES |
| --- | --- | --- | --- |
| Kultur | Crop | Culture | Cultivo |
| Kulturen | Crops | Cultures | Cultivos |
| Sorte | Variety | Variété | Variedad |
| Handelsname (Sorte) | Trade name | Nom commercial | Nombre comercial |
| Kulturart | Crop species | Espèce cultivée | Especie de cultivo |
| Kulturbibliothek | Crop library | Bibliothèque de cultures | Biblioteca de cultivos |
| Pflanzenfamilie | Crop family | Famille botanique | Familia botánica |
| Lateinischer Name | Latin name | Nom latin | Nombre latino |
| Gruppe (eigene Gruppe einer Kultur, code: tag) | Group | Groupe | Grupo |
| Lieferant | Supplier | Fournisseur | Proveedor |
| Anbauart | Cultivation type | Mode de culture | Tipo de cultivo |
| Direktsaat | Direct sowing | Semis direct | Siembra directa |
| Pflanzung (Anbauart) | Transplanting | Plantation | Trasplante |
| Pflanzung (eigene Anzucht) | Transplant (home-raised) | Plantation (plants autoproduits) | Trasplante (plantel propio) |
| Pflanzung mit gekauften Pflanzen | Transplant with bought-in plants | Plantation de plants achetés | Trasplante de plantel comprado |
| Pfl. Zukauf (short label) | Bought-in | Plant. achat | Trasp. compra |
| Jungpflanzenbedarf | Young plant demand | Besoin en plants | Necesidad de plantel |
| Reserve für Ausfälle | Reserve for losses | Réserve pour pertes | Reserva por pérdidas |
| Pflanzwoche | Planting week | Semaine de plantation | Semana de trasplante |
| Anzucht | Propagation | Pépinière † | Semillero † |
| Anzuchtdauer | Propagation duration | Durée en pépinière | Duración en semillero |
| Kulturdauer / Wachstumszeit | Growth duration | Durée de culture | Duración del cultivo |
| Erntedauer / Erntezeit | Harvest duration | Durée de récolte | Duración de la cosecha |
| Pflanzabstand | In-row spacing | Espacement sur le rang | Distancia entre plantas |
| Reihenabstand | Row spacing | Espacement entre les rangs | Distancia entre filas |
| Abstände | Spacing | Espacements | Distancias |
| Saatgutbedarf | Seed demand / Seed requirement | Besoin en semences | Necesidad de semillas |
| Saatgutmenge | Seed quantity | Quantité de semences | Cantidad de semillas |
| TKG (Tausendkorngewicht) | TKW (thousand-kernel weight) | PMG (poids de mille grains) | PMS (peso de mil semillas) |
| Keimrate | Germination rate | Taux de germination | Tasa de germinación |
| Nährstoffbedarf | Nutrient demand | Besoins nutritifs | Necesidades de nutrientes |
| Schwach-/Mittel-/Starkzehrer | Light/medium/heavy feeder | Culture peu / moyennement / très exigeante | Cultivo poco / medianamente / muy exigente |
| Ertrag | Yield | Rendement | Rendimiento |
| Ertragseinheit | Yield unit | Unité de rendement | Unidad de rendimiento |
| Ertragsübersicht | Yield overview | Aperçu des rendements | Resumen de rendimientos |
| Fruchtfolge | Crop rotation | Rotation des cultures | Rotación de cultivos |
| Anbaupause / Familienpause | Rotation break | Délai de retour | Pausa de rotación † |
| Mischkultur | Companion planting | Association de cultures | Asociación de cultivos |
| Guter / schlechter Nachbar | Good / bad neighbor | Bon / mauvais voisin | Buen / mal vecino |
| Kulturbibliothek-Eintrag | Library entry | Fiche de la bibliothèque | Ficha de la biblioteca |
| Synonym | Synonym | Synonyme | Sinónimo |

## Planning

| DE | EN | FR | ES |
| --- | --- | --- | --- |
| Anbauplan (Eintrag) | Planting plan | Série † | Serie † |
| Anbaupläne (Einträge) | Planting plans | Séries | Series |
| Anbaupläne (Seite, Gesamtplanung) | Planting plans | Plan de culture | Plan de cultivos |
| Anbaukalender | Crop calendar | Calendrier de culture | Calendario de cultivos |
| Saison | Season | Saison | Temporada |
| Saison-Muster | Season pattern | Modèle de saison | Patrón de temporada |
| Pflanztermin | Planting date | Date de plantation | Fecha de plantación |
| Aussaat / Aussaattermin | Sowing / sowing date | Semis / date de semis | Siembra / fecha de siembra |
| Erntebeginn | Harvest start | Début de récolte | Inicio de cosecha |
| Ernteende | Harvest end | Fin de récolte | Fin de cosecha |
| Ernte | Harvest | Récolte | Cosecha |
| Satz (Folgesatz) | Succession | Série | Serie |
| Vorkultur | Previous crop | Culture précédente | Cultivo anterior |
| Folgekultur | Follow-up crop | Culture suivante | Cultivo siguiente |
| Ernteüberlappung | Harvest overlap | Chevauchement de récolte | Solapamiento de cosecha |
| Anbauplanung (Einstellungen) | Crop planning | Planification des cultures | Planificación de cultivos |
| Pflanzen (Anzahl) | Plants | Plants | Plantas |
| Aufgabe | Task | Tâche | Tarea |

## Community and moderation

| DE | EN | FR | ES |
| --- | --- | --- | --- |
| Moderation | Moderation | Modération | Moderación |
| Moderator:in | Moderator | Modérateur | Moderador |
| veröffentlichen | publish | publier | publicar |
| Vorschlag / Änderungsvorschlag | Proposal / change proposal | Proposition / proposition de modification | Propuesta / propuesta de cambio |
| Änderung vorschlagen | Suggest change | Proposer une modification | Proponer un cambio |
| Einladung | Invitation | Invitation | Invitación |
| Rückmeldung (Feedback) | Feedback | Retour | Comentarios |
| GeLaWi / SoLaWi (Gemeinschaftsgetragene / Solidarische Landwirtschaft) | CSA (community-supported agriculture) | agriculture soutenue par la communauté (ASC); in France: AMAP | agricultura sostenida por la comunidad (ASC) |
| Gemüsebau / Gemüseanbau | Vegetable growing | Maraîchage | Horticultura |
| Gärtnerei / Betrieb | Farm | Ferme maraîchère / exploitation | Explotación hortícola / finca |

## Account and app

| DE | EN | FR | ES |
| --- | --- | --- | --- |
| Konto | Account | Compte | Cuenta |
| Anmelden | Sign in | Se connecter | Iniciar sesión |
| Registrieren | Register | S'inscrire | Registrarse |
| Abmelden | Sign out | Se déconnecter | Cerrar sesión |
| Passwort | Password | Mot de passe | Contraseña |
| Einstellungen | Settings | Paramètres | Ajustes |
| Sprache | Language | Langue | Idioma |
| Rückgängig | Undo | Annuler | Deshacer |
| Speichern | Save | Enregistrer | Guardar |
| Abbrechen | Cancel | Annuler | Cancelar |
| Löschen | Delete | Supprimer | Eliminar |
| Verlauf | History | Historique | Historial |
| Startseite | Home | Accueil | Inicio |
| Übersicht (Dashboard) | Dashboard | Tableau de bord | Panel |

## Legal

| DE | EN | FR | ES |
| --- | --- | --- | --- |
| Impressum | Legal notice | Mentions légales | Aviso legal |
| Datenschutzerklärung | Privacy policy | Politique de confidentialité | Política de privacidad |
| Nutzungsbedingungen | Terms of use | Conditions d'utilisation | Términos de uso |
| DSGVO | GDPR | RGPD | RGPD |
| Verantwortlicher | Controller | Responsable du traitement | Responsable del tratamiento |
| Auftragsverarbeiter | Processor | Sous-traitant | Encargado del tratamiento |
| betroffene Person | Data subject | Personne concernée | Interesado |
| berechtigtes Interesse | Legitimate interest | Intérêt légitime | Interés legítimo |
| Einwilligung | Consent | Consentement | Consentimiento |
| Aufsichtsbehörde | Supervisory authority | Autorité de contrôle | Autoridad de control |
| Stand | Last updated | Dernière mise à jour | Última actualización |
| maßgeblich (Sprachfassung) | prevails | fait foi | prevalece |

### Citations and content of the legal texts

- **One citation notation in every language**, including German:
  `Art. 6(1)(f)`, `Art. 7(3)`, `Art. 46(2)(c)`, `Art. 4(2)`, `§ 165(3)`,
  `§ 5 ECG`. Never the German `Abs.`/`lit.`/`Nr.` form, never the
  spelled-out French or Spanish form ("paragraphe 1, point f)"). Only the
  abbreviation of the regulation changes (DSGVO, GDPR, RGPD) and French and
  Spanish write `art.` in lower case inside a sentence.
- **All four language versions say the same.** Every paragraph cites the
  same articles and names the same numbers, deadlines, URLs and email
  addresses (guarded by `src/__tests__/legalTextConsistency.test.ts`). A
  change to a legal text is made in all four languages in the same commit.

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
