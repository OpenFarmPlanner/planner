"""Language normalization, fallback order and request resolution."""

from django.test import SimpleTestCase

from config.languages import (
    DEFAULT_LANGUAGE_CODE,
    SUPPORTED_LANGUAGE_CODES,
    UI_LANGUAGE_AUTO,
    build_fallback_chain,
    normalize_language_tag,
    normalize_ui_language_preference,
    parse_accept_language,
    resolve_language_tag,
    resolve_translation,
)


class NormalizeLanguageTagTest(SimpleTestCase):
    def test_german_regional_tags_normalize_to_de(self):
        for tag in ('de', 'de-AT', 'de-DE', 'de-CH', 'DE-at', 'de_DE', '  de-AT  '):
            self.assertEqual(normalize_language_tag(tag), 'de', tag)

    def test_english_regional_tags_normalize_to_en(self):
        for tag in ('en', 'en-US', 'en-GB', 'EN-au', 'en_GB'):
            self.assertEqual(normalize_language_tag(tag), 'en', tag)

    def test_french_regional_tags_normalize_to_fr(self):
        for tag in ('fr', 'fr-FR', 'fr-CA', 'fr-CH', 'FR-be', 'fr_FR'):
            self.assertEqual(normalize_language_tag(tag), 'fr', tag)

    def test_spanish_regional_tags_normalize_to_es(self):
        for tag in ('es', 'es-ES', 'es-419', 'es-MX', 'ES-ar', 'es_ES'):
            self.assertEqual(normalize_language_tag(tag), 'es', tag)

    def test_supported_codes_are_ordered_english_german_french_spanish(self):
        self.assertEqual(SUPPORTED_LANGUAGE_CODES, ('en', 'de', 'fr', 'es'))

    def test_unsupported_tags_return_empty(self):
        for tag in ('it', 'it-IT', 'pt-BR', 'zh-Hans', 'xx', '', '   ', None):
            self.assertEqual(normalize_language_tag(tag), '', repr(tag))

    def test_resolve_language_tag_never_returns_empty(self):
        self.assertEqual(resolve_language_tag('it'), DEFAULT_LANGUAGE_CODE)
        self.assertEqual(resolve_language_tag('fr-CA'), 'fr')
        self.assertEqual(resolve_language_tag(None), DEFAULT_LANGUAGE_CODE)
        self.assertEqual(resolve_language_tag('de-AT'), 'de')


class AcceptLanguageTest(SimpleTestCase):
    def test_picks_the_first_supported_language(self):
        self.assertEqual(parse_accept_language('de-AT,de;q=0.9,en;q=0.8'), 'de')
        self.assertEqual(parse_accept_language('en-GB,en;q=0.9'), 'en')

    def test_honours_quality_values_over_position(self):
        # Italian is unsupported and German outranks English, so German wins
        # even though English appears first among the supported entries.
        self.assertEqual(parse_accept_language('it;q=1.0, en;q=0.5, de;q=0.9'), 'de')

    def test_resolves_french_and_spanish(self):
        self.assertEqual(parse_accept_language('fr-FR,fr;q=0.9,en;q=0.8'), 'fr')
        self.assertEqual(parse_accept_language('es-419,es;q=0.9'), 'es')

    def test_returns_empty_for_missing_or_unsupported_headers(self):
        self.assertEqual(parse_accept_language(''), '')
        self.assertEqual(parse_accept_language(None), '')
        self.assertEqual(parse_accept_language('pt-BR,it;q=0.8'), '')


class UiLanguagePreferenceTest(SimpleTestCase):
    def test_accepts_auto_and_every_supported_code(self):
        self.assertEqual(normalize_ui_language_preference(UI_LANGUAGE_AUTO), UI_LANGUAGE_AUTO)
        for code in SUPPORTED_LANGUAGE_CODES:
            self.assertEqual(normalize_ui_language_preference(code.upper()), code)

    def test_rejects_unsupported_values(self):
        for value in ('it', 'de-AT', 'fr-CA', '', None, 'nonsense'):
            with self.assertRaises(ValueError, msg=repr(value)):
                normalize_ui_language_preference(value)


class FallbackChainTest(SimpleTestCase):
    def test_requested_language_comes_first_then_english_then_the_rest(self):
        self.assertEqual(build_fallback_chain('de'), ('de', 'en', 'fr', 'es'))
        self.assertEqual(build_fallback_chain('en'), ('en', 'de', 'fr', 'es'))
        self.assertEqual(build_fallback_chain('fr'), ('fr', 'en', 'de', 'es'))
        self.assertEqual(build_fallback_chain('es-419'), ('es', 'en', 'de', 'fr'))

    def test_unsupported_request_falls_back_to_english_first(self):
        self.assertEqual(build_fallback_chain('it')[0], DEFAULT_LANGUAGE_CODE)


class ResolveTranslationTest(SimpleTestCase):
    def test_prefers_the_requested_language(self):
        text, used = resolve_translation({'de': 'Tomate', 'en': 'Tomato'}, 'de')
        self.assertEqual((text, used), ('Tomate', 'de'))

    def test_falls_back_to_english_when_the_request_language_is_missing(self):
        text, used = resolve_translation({'en': 'Tomato'}, 'de')
        self.assertEqual((text, used), ('Tomato', 'en'))

    def test_french_and_spanish_requests_fall_back_to_english(self):
        translations = {'de': 'Lauch', 'en': 'Leek'}
        self.assertEqual(resolve_translation(translations, 'fr'), ('Leek', 'en'))
        self.assertEqual(resolve_translation(translations, 'es'), ('Leek', 'en'))
        self.assertEqual(resolve_translation({'de': 'Lauch'}, 'fr'), ('Lauch', 'de'))
        self.assertEqual(resolve_translation({**translations, 'fr': 'Poireau'}, 'fr'), ('Poireau', 'fr'))

    def test_falls_back_to_any_other_translation_before_giving_up(self):
        text, used = resolve_translation({'de': 'Tomate'}, 'en')
        self.assertEqual((text, used), ('Tomate', 'de'))

    def test_blank_values_count_as_missing(self):
        text, used = resolve_translation({'de': '   ', 'en': 'Tomato'}, 'de')
        self.assertEqual((text, used), ('Tomato', 'en'))

    def test_uses_the_technical_fallback_and_reports_no_language(self):
        text, used = resolve_translation({}, 'de', fallback='Solanum lycopersicum')
        self.assertEqual((text, used), ('Solanum lycopersicum', ''))

    def test_never_returns_none_or_a_placeholder_string(self):
        text, used = resolve_translation({}, 'de')
        self.assertEqual(text, '')
        self.assertEqual(used, '')
