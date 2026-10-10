FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as a non-root user; chown so the app can create/write vector_store/
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 5050

# workers MUST stay 1: indexing_lock in model_server.py is a process-local
# threading.Lock, so multiple workers would allow concurrent indexing runs
# and each worker would hold its own retriever cache. Threaded workers
# handle concurrency instead.
CMD ["gunicorn", "--bind", "0.0.0.0:5050", "--workers", "1", "--threads", "8", "--timeout", "600", "model_server:app"]
