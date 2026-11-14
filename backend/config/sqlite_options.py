"""Fixed SQLite concurrency options shared with the guarded local fixture command."""

SQLITE_CONCURRENCY_OPTIONS: dict[str, int | str] = {
    'timeout': 20,
    'transaction_mode': 'IMMEDIATE',
    'init_command': 'PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL;',
}
