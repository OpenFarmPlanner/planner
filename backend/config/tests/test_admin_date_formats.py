from __future__ import annotations

import datetime

from django import forms
from django.contrib.admin.widgets import AdminDateWidget
from django.template import Context, Template
from django.test import SimpleTestCase
from django.utils import translation


class AdminDateFormatTests(SimpleTestCase):
    """The admin runs under the default `en-us` locale but shows European dates."""

    moment = datetime.datetime(2026, 10, 9, 20, 12)

    def _render(self, template: str) -> str:
        with translation.override('en-us'):
            return Template(template).render(Context({'value': self.moment}))

    def test_short_datetime_is_day_month_year_with_24_hour_time(self) -> None:
        rendered = self._render('{{ value|date:"SHORT_DATETIME_FORMAT" }}')
        self.assertEqual(rendered, '09.10.2026 20:12')

    def test_default_datetime_and_date_formats_are_european(self) -> None:
        self.assertEqual(self._render('{{ value }}'), '09.10.2026 20:12')
        self.assertEqual(self._render('{{ value|date }}'), '09.10.2026')

    def test_admin_date_widget_displays_and_parses_day_month_year(self) -> None:
        class DateForm(forms.Form):
            day = forms.DateField(widget=AdminDateWidget)

        with translation.override('en-us'):
            rendered = DateForm(initial={'day': self.moment.date()}).as_p()
            form = DateForm(data={'day': '25.10.2026'})
            iso_form = DateForm(data={'day': '2026-10-25'})

            self.assertIn('value="09.10.2026"', rendered)
            self.assertTrue(form.is_valid())
            self.assertEqual(form.cleaned_data['day'], datetime.date(2026, 10, 25))
            self.assertTrue(iso_form.is_valid())
