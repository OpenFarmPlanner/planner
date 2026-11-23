"""Currency and package price validation for supplier offers."""

from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError

# ISO codes recognized by the currency picker. Keep support for codes on
# existing offers even when the currency is no longer available for new sales.
CURRENCY_CODES = frozenset("""
    AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND
    BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK
    DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD
    HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF
    KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP
    MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP
    PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS
    SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD
    UYU UZS VES VND VUV WST XAF XCD XCG XDR XOF XPF XSU YER ZAR ZMW ZWG ZWL
""".split())

PRICE_DECIMAL_PLACES = Decimal('0.0001')
MAX_PACKAGE_PRICE = Decimal('99999999.9999')


def validate_currency_code(value: str) -> None:
    if value not in CURRENCY_CODES:
        raise ValidationError('Select a valid currency.', code='invalid_currency')


def _package_key(package: object) -> tuple[str, int | float] | None:
    if not isinstance(package, dict):
        return None
    unit = package.get('size_unit')
    size = package.get('size_value')
    if unit not in ('g', 'seeds') or type(size) not in (int, float) or not 0 < size < float('inf'):
        return None
    return unit, size


def _normalize_amount(value: object) -> str:
    try:
        value_decimal = Decimal(str(value))
        if not value_decimal.is_finite() or not 0 <= value_decimal <= MAX_PACKAGE_PRICE:
            raise ValueError
        quantized = value_decimal.quantize(PRICE_DECIMAL_PLACES)
        if quantized != value_decimal:
            raise ValueError
    except (InvalidOperation, ValueError) as exc:
        raise ValidationError(
            'Enter a non-negative package price with at most four decimal places.',
            code='invalid_package_price',
        ) from exc
    return format(abs(quantized), 'f')


def normalize_offer_packages(
    packages: object, currency: str, previous_packages: object = None,
) -> list:
    """Keep legacy size rows, preserving prices omitted by older clients."""
    if not isinstance(packages, list):
        raise ValidationError('Provide the package sizes as a list.', code='invalid_packages')
    previous_prices = {
        _package_key(package): package['price']
        for package in previous_packages
        if isinstance(package, dict) and package.get('price') is not None
        and _package_key(package) is not None
    } if isinstance(previous_packages, list) else {}
    keys = [_package_key(package) for package in packages]
    seen: set[tuple[str, int | float]] = set()
    duplicates: set[tuple[str, int | float]] = set()
    for key in keys:
        if key is not None:
            if key in seen:
                duplicates.add(key)
            seen.add(key)
    normalized = []
    for package, key in zip(packages, keys, strict=True):
        if not isinstance(package, dict):
            normalized.append(package)
            continue
        if 'price' not in package and key not in previous_prices:
            normalized.append(package)
            continue
        price = package.get('price', previous_prices.get(key))
        if price is not None:
            if key is None or key in duplicates:
                raise ValidationError(
                    'A priced package must have a unique positive size and unit.',
                    code='invalid_priced_package_size',
                )
            validate_currency_code(currency)
            price = _normalize_amount(price)
        normalized.append({**package, 'price': price})
    return normalized
