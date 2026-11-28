# Varagh — bilingual book reader
#   docker compose up -d        (recommended; see docker-compose.yml)
#   docker build -t varagh . && docker run -p 127.0.0.1:8765:8765 -v varagh-data:/data varagh
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VARAGH_HOST=0.0.0.0 \
    VARAGH_PORT=8765 \
    VARAGH_DATA=/data \
    VARAGH_TRUST_ALL=1 \
    VARAGH_OLLAMA_URL=http://host.docker.internal:11434

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY backend/ backend/
COPY frontend/ frontend/
COPY cli_to_api/ cli_to_api/
COPY run.py .

RUN useradd --create-home --uid 1000 varagh \
    && mkdir -p /data && chown varagh:varagh /data
USER varagh

VOLUME ["/data"]
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"VARAGH_PORT\"]}/static/manifest.webmanifest', timeout=4)"

CMD ["python", "run.py", "--no-browser"]
