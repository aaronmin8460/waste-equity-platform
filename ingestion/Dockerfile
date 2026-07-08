FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/pyproject.toml ./backend/
COPY backend/src ./backend/src
RUN pip install --no-cache-dir ./backend

COPY ingestion/pyproject.toml ./ingestion/
COPY ingestion/src ./ingestion/src
RUN pip install --no-cache-dir ./ingestion

RUN useradd --create-home appuser
USER appuser

ENTRYPOINT ["python", "-m", "waste_equity_ingestion.cli"]
CMD ["--help"]
