# Production sandbox image for the code grader.
# Local dev falls back to a subprocess (Docker not required to run the MVP).
# Usage (production): docker run --rm -i --network=none --read-only \
#   --memory=512m --cpus=1 --pids-limit=64 driftsentinel-sandbox < job.json
FROM python:3.12-slim

# Non-root user
RUN useradd -m -u 10001 grader
WORKDIR /app
COPY grader_runner.py /app/grader_runner.py
USER grader

ENTRYPOINT ["python3", "/app/grader_runner.py"]
