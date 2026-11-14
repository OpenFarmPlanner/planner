FROM python:3.12.12-slim-bookworm

WORKDIR /app/backend
RUN pip install --no-cache-dir pdm==2.29.5 hishel==1.4.0
COPY --chown=10001:10001 backend/pyproject.toml backend/pdm.lock backend/README.md ./
RUN pdm sync --prod --no-self
COPY --chown=10001:10001 backend/manage.py ./
COPY --chown=10001:10001 backend/accounts ./accounts
COPY --chown=10001:10001 backend/config ./config
COPY --chown=10001:10001 backend/crops ./crops
COPY --chown=10001:10001 backend/farm ./farm
COPY --chown=10001:10001 backend/notifications ./notifications
COPY --chown=10001:10001 frontend/dist /app/frontend/dist
COPY --chown=10001:10001 scripts/ci/zap/target.py scripts/ci/zap/zap_settings.py /app/scripts/ci/zap/

ENV PATH="/app/backend/.venv/bin:$PATH" \
    PYTHONPATH="/app/backend:/app/scripts/ci/zap" \
    DJANGO_SETTINGS_MODULE=zap_settings \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
USER 10001:10001
CMD ["python", "/app/scripts/ci/zap/target.py"]
