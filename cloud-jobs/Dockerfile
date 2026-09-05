FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /job
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir . && playwright install --with-deps chromium

USER 65532:65532
ENTRYPOINT ["hiking-member-sync"]
