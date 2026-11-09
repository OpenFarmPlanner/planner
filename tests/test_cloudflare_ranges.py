import ipaddress
import unittest

from scripts.ci.check_cloudflare_ranges import (
    ENV_EXAMPLE,
    compare,
    parse_cloudflare_response,
    read_reference,
    render_report,
)


def _payload(ipv4: list[str], ipv6: list[str], success: bool = True) -> dict:
    return {'success': success, 'result': {'ipv4_cidrs': ipv4, 'ipv6_cidrs': ipv6, 'etag': 'x'}}


class CloudflareRangeCheckTests(unittest.TestCase):
    def test_reads_the_commented_example_line(self) -> None:
        text = '# TRUSTED_PROXY_CIDRS=100.65.136.1/32\n# TRUSTED_PROXY_UPSTREAM_CIDRS=173.245.48.0/20,2400:cb00::/32\n'

        self.assertEqual(
            read_reference(text),
            {ipaddress.ip_network('173.245.48.0/20'), ipaddress.ip_network('2400:cb00::/32')},
        )

    def test_the_committed_example_has_a_parseable_list(self) -> None:
        self.assertGreater(len(read_reference(ENV_EXAMPLE.read_text(encoding='utf-8'))), 10)

    def test_missing_line_is_an_error_not_a_change(self) -> None:
        with self.assertRaises(ValueError):
            read_reference('# nothing here\n')

    def test_unsuccessful_or_empty_responses_are_errors(self) -> None:
        for payload in (_payload([], [], success=False), _payload([], []), {'success': True}, []):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                parse_cloudflare_response(payload)

    def test_identical_lists_in_any_order_are_unchanged(self) -> None:
        reference = read_reference('# TRUSTED_PROXY_UPSTREAM_CIDRS=2400:cb00::/32,173.245.48.0/20\n')
        current = parse_cloudflare_response(_payload(['173.245.48.0/20'], ['2400:cb00::/32']))

        self.assertFalse(compare(reference, current).changed)

    def test_reports_added_and_removed_ranges(self) -> None:
        reference = read_reference('# TRUSTED_PROXY_UPSTREAM_CIDRS=173.245.48.0/20,103.21.244.0/22\n')
        current = parse_cloudflare_response(_payload(['173.245.48.0/20', '198.51.100.0/24'], []))

        diff = compare(reference, current)
        report = render_report(diff, current)

        self.assertEqual(diff.added, [ipaddress.ip_network('198.51.100.0/24')])
        self.assertEqual(diff.removed, [ipaddress.ip_network('103.21.244.0/22')])
        self.assertIn('`198.51.100.0/24`', report)
        self.assertIn('`103.21.244.0/22`', report)
        self.assertIn('TRUSTED_PROXY_UPSTREAM_CIDRS=173.245.48.0/20,198.51.100.0/24', report)


if __name__ == '__main__':
    unittest.main()
