"""Tests ensuring invitation tokens are not written verbatim to logs (CWE-532)."""

from django.test import SimpleTestCase, TestCase

from farm.services.project_invitations import (
    InvitationFlowError,
    _mask_token,
    get_invitation_by_token,
    mask_email,
)


class MaskTokenTest(SimpleTestCase):
    def test_masks_long_token_to_short_prefix(self):
        token = 'abcdef0123456789verylongtoken'
        masked = _mask_token(token)
        self.assertNotEqual(masked, token)
        self.assertNotIn('0123456789', masked)
        self.assertTrue(masked.startswith('abcdef'))

    def test_short_or_empty_tokens_are_fully_hidden(self):
        self.assertEqual(_mask_token(''), '***')
        self.assertEqual(_mask_token(None), '***')
        self.assertEqual(_mask_token('short'), '***')


class InvitationTokenLoggingTest(TestCase):
    def test_failed_lookup_does_not_log_raw_token(self):
        raw_token = 'super-secret-invitation-token-value-1234567890'
        with self.assertLogs('farm.services.project_invitations', level='WARNING') as captured:
            with self.assertRaises(InvitationFlowError):
                get_invitation_by_token(raw_token)

        joined = '\n'.join(captured.output)
        # The full bearer token must never appear in log output.
        self.assertNotIn(raw_token, joined)


class MaskEmailTest(SimpleTestCase):
    """The public invitation-status endpoint is reachable without logging in,
    so the invitee's address is masked before it goes out."""

    def test_keeps_only_the_first_letter_of_the_local_part(self):
        self.assertEqual(mask_email('martina@example.com'), 'm***@example.com')

    def test_keeps_the_domain_intact_so_the_invitee_recognises_it(self):
        # A user who cannot tell which of their addresses was invited cannot
        # act on the invitation at all.
        self.assertEqual(mask_email('a.b+tag@sub.example.org'), 'a***@sub.example.org')

    def test_masks_a_one_letter_local_part_no_less_than_a_long_one(self):
        self.assertEqual(mask_email('x@example.com'), 'x***@example.com')

    def test_normalizes_before_masking(self):
        self.assertEqual(mask_email('  Martina@Example.COM  '), 'm***@example.com')

    def test_hides_a_value_that_is_not_an_address_entirely(self):
        # With no @ there is no domain worth showing, and the whole string
        # could be anything — so none of it is echoed back.
        for value in ('', '   ', 'nonsense'):
            with self.subTest(value=value):
                self.assertEqual(mask_email(value), '***')

    def test_masks_the_local_part_when_the_address_starts_with_an_at_sign(self):
        # The `if local else '***'` fallback is redundant here: `''[:1]` is
        # itself `''`, so both branches produce '***@example.com'.
        self.assertEqual(mask_email('@example.com'), '***@example.com')

    def test_never_echoes_the_local_part_beyond_its_first_character(self):
        masked = mask_email('verylongsecretlocalpart@example.com')
        self.assertNotIn('erylongsecretlocalpart', masked)
