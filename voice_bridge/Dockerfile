FROM python:3.12-slim
WORKDIR /opt/bridge
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd -u 10001 -m bridge
COPY --chown=bridge:bridge agent.py protocol.py healthcheck.py ./
USER bridge
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 CMD ["python", "healthcheck.py"]
CMD ["python", "agent.py"]
